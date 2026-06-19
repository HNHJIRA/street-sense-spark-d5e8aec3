// New York City — authoritative centerline provider.
//
// VERIFIED OPEN DATA: NYC Open Data publishes the canonical Citywide Street
// Centerline (CSCL) — dataset id `inkn-q76z`, ~115k polylines citywide,
// owned by NYC DOITT GIS. This provider imports those centerlines as
// street_segments and attaches an explicit `unknown` rule per segment.
//
// Phase 1 (foundation) only:
//   - Curb regulations, signs, ASP, meters, bus zones, curb pilots, and
//     Open Streets are intentionally NOT consumed yet. They land in later
//     phases as separate overlay providers.
//   - Every segment honestly reports `unknown` (priority 900) until those
//     overlays attach authoritative rules.
//
// See docs/nyc-coverage-discovery.md for the full discovery report.

import { normalizeSide, resolveRuleConflicts } from "./normalize";
import { unknownRule } from "./_la-shared.server";
import type { NormalizedRule, NormalizedSegment, ParkingProvider, SyncBbox } from "./types";

// Socrata GeoJSON endpoint for NYC Centerline (DOITT GIS).
const CENTERLINE_GEOJSON =
  "https://data.cityofnewyork.us/resource/inkn-q76z.geojson";

interface CenterlineProps {
  objectid?: string;
  physicalid?: string;
  status?: string;          // "2" = active
  rw_type?: string;         // "1" = street
  boroughcode?: string;     // "1"=MN "2"=BX "3"=BK "4"=QN "5"=SI
  trafdir?: string;
  stname_label?: string;
  full_street_name?: string;
  street_name?: string;
  pre_type?: string;
  post_type?: string;
  l_low_hn?: string;
  l_high_hn?: string;
  r_low_hn?: string;
  r_high_hn?: string;
}

const BORO_NAME: Record<string, string> = {
  "1": "Manhattan",
  "2": "Bronx",
  "3": "Brooklyn",
  "4": "Queens",
  "5": "Staten Island",
};

interface GeoJsonFeature {
  type: "Feature";
  properties: CenterlineProps;
  geometry:
    | { type: "LineString"; coordinates: [number, number][] }
    | { type: "MultiLineString"; coordinates: [number, number][][] }
    | null;
}

interface GeoJsonResponse {
  type: "FeatureCollection";
  features: GeoJsonFeature[];
}

/** Socrata `within_box(field, north_lat, west_lng, south_lat, east_lng)` —
 *  yes, the order is N/W/S/E (counterintuitive). */
function buildWithinBox(bbox: SyncBbox): string {
  return `within_box(the_geom, ${bbox.maxLat}, ${bbox.minLng}, ${bbox.minLat}, ${bbox.maxLng})`;
}

export async function fetchCsclGeoJson(
  bbox: SyncBbox,
): Promise<GeoJsonFeature[]> {
  const PAGE = 10_000;
  // NYC has ~115k centerline records. Allow up to 200k headroom; bbox-scoped
  // syncs (boroughs / neighborhoods) will normally come in well under this.
  const HARD_CAP = 200_000;
  // Filter server-side to active streets only (RW_TYPE=1, STATUS=2). This
  // matches the per-feature filter in the diagnostic.
  const where =
    `${buildWithinBox(bbox)} AND status='2' AND rw_type='1'`;

  const out: GeoJsonFeature[] = [];
  let offset = 0;
  while (offset <= HARD_CAP) {
    const qs = new URLSearchParams({
      $where: where,
      $limit: String(PAGE),
      $offset: String(offset),
      $order: "objectid",
    });
    const url = `${CENTERLINE_GEOJSON}?${qs.toString()}`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`NYC CSCL ${url} responded ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
    const json = (await res.json()) as GeoJsonResponse;
    const feats = json.features ?? [];
    out.push(...feats);
    if (feats.length < PAGE) break;
    offset += feats.length;
  }
  return out;
}

function pickName(p: CenterlineProps): string {
  const n =
    (p.stname_label ?? p.full_street_name ?? p.street_name ?? "")
      .toString()
      .trim();
  if (n) return n;
  return p.objectid != null ? `NYC centerline ${p.objectid}` : "NYC street";
}

/** Pick the longest LineString out of a (Multi)LineString geometry. */
function geomToCoords(
  g: GeoJsonFeature["geometry"],
): [number, number][] {
  if (!g) return [];
  if (g.type === "LineString") return g.coordinates as [number, number][];
  const lines = g.coordinates ?? [];
  if (!lines.length) return [];
  let longest = lines[0];
  for (const l of lines) if (l.length > longest.length) longest = l;
  return longest as [number, number][];
}

export const NycCenterlineProvider: ParkingProvider = {
  id: "nyc-centerline",
  name: "NYC Street Centerline (CSCL)",
  cities: ["nyc"],

  async fetchSegments(_citySlug, bbox) {
    const feats = await fetchCsclGeoJson(bbox);
    const out: NormalizedSegment[] = [];
    for (const f of feats) {
      const p = f.properties ?? {};
      const oid = p.objectid;
      if (oid == null) continue;
      const coords = geomToCoords(f.geometry);
      if (coords.length < 2) continue;

      const physicalId = p.physicalid != null ? String(p.physicalid) : String(oid);
      const boro = BORO_NAME[String(p.boroughcode ?? "")] ?? null;

      const rules: NormalizedRule[] = [
        unknownRule(
          "NYC Phase 1 (centerline only). Authoritative parking regulations " +
            "(Parking Regulation Shapefile, sign feed, ASP, meters, bus zones, " +
            "curb typology, Open Streets) are imported in later phases. " +
            "Until then, every NYC segment honestly reports UNKNOWN.",
        ),
      ];

      out.push({
        external_id: `nyc:cscl/${physicalId}`,
        name: pickName(p),
        side: normalizeSide(null), // CSCL has no curb-side; both curbs share
        coordinates: coords,
        metadata: {
          source_provider: "NYC Street Centerline (CSCL)",
          dataset: "data.cityofnewyork.us/inkn-q76z",
          physical_id: physicalId,
          borough: boro,
          borocode: p.boroughcode ?? null,
          rw_type: p.rw_type ?? null,
          status: p.status ?? null,
          trafdir: p.trafdir ?? null,
          posted_restrictions: "unknown",
        },
        rules: resolveRuleConflicts(rules),
      });
    }
    return out;
  },
};
