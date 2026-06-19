// New York City — authoritative centerline provider.
//
// VERIFIED OPEN DATA: NYC DCP / DOITT publishes the CSCL street centerline
// (NYC_Street_Centerline FeatureServer, ~115k polylines citywide) as the
// canonical street base. This provider imports those centerlines as
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
import { arcgisPolyline, fetchArcgis, unknownRule } from "./_la-shared.server";
import type { NormalizedRule, NormalizedSegment, ParkingProvider } from "./types";

// CSCL — NYC Street Centerline. Hosted FeatureServer published by NYC DOITT
// via the City's ArcGIS Online org. EPSG:4326 source; fetchArcgis forces
// outSR=4326 anyway so we always get [lng,lat] pairs back.
const CENTERLINE_ENDPOINT =
  "https://services5.arcgis.com/GfwWNkhOj9bNBqoJ/arcgis/rest/services/NYC_Street_Centerline/FeatureServer/0/query";

interface CenterlineAttrs {
  OBJECTID?: number;
  PHYSICALID?: number | string;
  L_LOW_HN?: string;
  L_HIGH_HN?: string;
  R_LOW_HN?: string;
  R_HIGH_HN?: string;
  ST_LABEL?: string;
  FULL_STREE?: string;
  FULL_STREET?: string;
  ST_NAME?: string;
  RW_TYPE?: string | number;        // 1=street, 2=highway, 9=alley, 11=walkway, 13=path, etc.
  STATUS?: string | number;          // 2=active, 1=proposed, 4=ramp, etc.
  BOROCODE?: string | number;        // 1=MN 2=BX 3=BK 4=QN 5=SI
  POST_TYPE?: string;
  TRAFDIR?: string;
  SHAPE_Length?: number;
}

const BORO_NAME: Record<string, string> = {
  "1": "Manhattan",
  "2": "Bronx",
  "3": "Brooklyn",
  "4": "Queens",
  "5": "Staten Island",
};

/** Pull every page until the server stops setting exceededTransferLimit. */
async function fetchAllPaginated<T>(
  endpoint: string,
  params: Record<string, string>,
): Promise<Array<{ attributes: T; geometry?: unknown }>> {
  const PAGE = 2000;
  // NYC has ~115k centerline records. Allow up to 200k headroom; bbox-scoped
  // syncs (boroughs / neighborhoods) will normally come in well under this.
  const HARD_CAP = 200_000;
  let offset = 0;
  let more = true;
  const out: Array<{ attributes: T; geometry?: unknown }> = [];
  while (more) {
    const json = (await fetchArcgis(endpoint, {
      ...params,
      resultRecordCount: String(PAGE),
      resultOffset: String(offset),
      orderByFields: "OBJECTID",
    })) as {
      features?: Array<{ attributes: T; geometry?: unknown }>;
      exceededTransferLimit?: boolean;
    };
    const feats = json.features ?? [];
    out.push(...feats);
    more = !!json.exceededTransferLimit && feats.length > 0;
    offset += feats.length;
    if (offset > HARD_CAP) break;
  }
  return out;
}

function pickName(a: CenterlineAttrs): string {
  const n =
    (a.ST_LABEL ?? a.FULL_STREET ?? a.FULL_STREE ?? a.ST_NAME ?? "")
      .toString()
      .trim();
  if (n) return n;
  const oid = a.OBJECTID;
  return oid != null ? `NYC centerline ${oid}` : "NYC street";
}

/** Filter out non-curb-parking geometry: highways, ramps, paths, walkways,
 *  alleys, and proposed/inactive features. CSCL field semantics:
 *    RW_TYPE: 1=street, 2=highway, 3=bridge, 4=tunnel, 9=alley,
 *             11=walkway, 13=path, 14=stair, 5=boardwalk, etc.
 *    STATUS:  2=active. Anything else (proposed, demapped) is dropped. */
function isCurbParkable(a: CenterlineAttrs): boolean {
  const status = String(a.STATUS ?? "").trim();
  if (status && status !== "2") return false;
  const rw = String(a.RW_TYPE ?? "").trim();
  // Keep only "street" (1). NYC has no curb parking on highways/ramps,
  // walkways, paths, stairs, boardwalks, or interior alleys (per DOT).
  if (rw && rw !== "1") return false;
  return true;
}

export const NycCenterlineProvider: ParkingProvider = {
  id: "nyc-centerline",
  name: "NYC Street Centerline (CSCL)",
  cities: ["nyc"],

  async fetchSegments(_citySlug, bbox) {
    const feats = await fetchAllPaginated<CenterlineAttrs>(CENTERLINE_ENDPOINT, {
      geometry: `${bbox.minLng},${bbox.minLat},${bbox.maxLng},${bbox.maxLat}`,
      geometryType: "esriGeometryEnvelope",
      inSR: "4326",
      spatialRel: "esriSpatialRelIntersects",
    });

    const out: NormalizedSegment[] = [];
    for (const f of feats) {
      const a = f.attributes;
      const oid = a.OBJECTID;
      if (oid == null) continue;
      if (!isCurbParkable(a)) continue;

      const coords = arcgisPolyline(f.geometry);
      if (coords.length < 2) continue;

      const physicalId = a.PHYSICALID != null ? String(a.PHYSICALID) : String(oid);
      const boro = BORO_NAME[String(a.BOROCODE ?? "")] ?? null;

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
        name: pickName(a),
        side: normalizeSide(null), // CSCL has no curb-side; both curbs share
        coordinates: coords,
        metadata: {
          source_provider: "NYC Street Centerline (CSCL)",
          dataset: "NYC_Street_Centerline",
          layer_id: 0,
          physical_id: physicalId,
          borough: boro,
          borocode: a.BOROCODE ?? null,
          rw_type: a.RW_TYPE ?? null,
          status: a.STATUS ?? null,
          trafdir: a.TRAFDIR ?? null,
          posted_restrictions: "unknown",
        },
        rules: resolveRuleConflicts(rules),
      });
    }

    return out;
  },
};
