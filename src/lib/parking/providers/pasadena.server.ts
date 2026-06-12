// City of Pasadena open-data provider.
// VERIFIED OPEN DATA:
//   - Sweep ZONES (polygons, single SWEEPING_DAY): CityOfPasadenaCAGIS,
//     Street_Sweeping/FeatureServer/0 (≈6 city-wide zones).
//   - STREETS (polylines, named): CityOfPasadenaCAGIS,
//     Streets/FeatureServer/1 (≈7k blockfaces).
// The published sweep dataset is zone-level, so we join: for every street
// polyline whose midpoint falls inside a zone polygon, we emit that street
// with the zone's sweep day. This gives one map segment per real street
// (instead of 6 giant zone outlines) and lets the engine render green on
// non-sweep days, red on sweep days.
import { normalizeSide, resolveRuleConflicts } from "./normalize";
import { arcgisPolyline, fetchArcgis, parseDays, unknownRule } from "./_la-shared.server";
import type { NormalizedRule, NormalizedSegment, ParkingProvider } from "./types";

const SWEEP_ENDPOINT =
  "https://services2.arcgis.com/zNjnZafDYCAJAbN0/arcgis/rest/services/Street_Sweeping/FeatureServer/0/query";
const STREETS_ENDPOINT =
  "https://services2.arcgis.com/zNjnZafDYCAJAbN0/arcgis/rest/services/Streets/FeatureServer/1/query";

interface SweepAttrs { OBJECTID?: number; SWEEPING_DAY?: string }
interface StreetAttrs {
  OBJECTID?: number;
  FULL_ST_NAME?: string;
  STREET_NAME?: string;
  LABEL?: string;
  ONEWAY?: string | number | null;
}

type Ring = Array<[number, number]>;
interface SweepZone { id: number; day: string | null; rings: Ring[] }

/** Ray-casting point-in-polygon for a single ring (lng/lat). */
function pointInRing(pt: [number, number], ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersect = yi > pt[1] !== yj > pt[1] &&
      pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function midpoint(coords: [number, number][]): [number, number] {
  const m = coords[Math.floor(coords.length / 2)];
  return [m[0], m[1]];
}

/** Pull all rings (not just longest) from an ArcGIS polygon geometry. */
function polygonRings(geometry: unknown): Ring[] {
  const g = geometry as { rings?: number[][][] } | null;
  const rings = g?.rings ?? [];
  return rings.map((r) => r.map((c) => [Number(c[0]), Number(c[1])] as [number, number]));
}

export const PasadenaProvider: ParkingProvider = {
  id: "pasadena-opendata",
  name: "Pasadena Open Data",
  cities: ["pasadena"],

  async fetchSegments(_citySlug, bbox) {
    // 1) Sweep zones (small set — ≈6 features for the whole city).
    const zonesRaw = await fetchArcgis(SWEEP_ENDPOINT, {
      geometry: `${bbox.minLng},${bbox.minLat},${bbox.maxLng},${bbox.maxLat}`,
      geometryType: "esriGeometryEnvelope",
      inSR: "4326",
      spatialRel: "esriSpatialRelIntersects",
      resultRecordCount: "2000",
    }) as { features?: Array<{ attributes: SweepAttrs; geometry?: unknown }> };

    const zones: SweepZone[] = (zonesRaw.features ?? [])
      .filter((f) => f.attributes.OBJECTID != null)
      .map((f) => ({
        id: f.attributes.OBJECTID!,
        day: f.attributes.SWEEPING_DAY ?? null,
        rings: polygonRings(f.geometry),
      }))
      .filter((z) => z.rings.length > 0);

    // 2) Streets (paginated). FeatureServer caps at 2000/page.
    const out: NormalizedSegment[] = [];
    const PAGE = 2000;
    let offset = 0;
    let more = true;
    let total = 0;
    while (more) {
      const json = await fetchArcgis(STREETS_ENDPOINT, {
        geometry: `${bbox.minLng},${bbox.minLat},${bbox.maxLng},${bbox.maxLat}`,
        geometryType: "esriGeometryEnvelope",
        inSR: "4326",
        spatialRel: "esriSpatialRelIntersects",
        outFields: "OBJECTID,FULL_ST_NAME,STREET_NAME,LABEL,ONEWAY",
        resultRecordCount: String(PAGE),
        resultOffset: String(offset),
      }) as {
        features?: Array<{ attributes: StreetAttrs; geometry?: unknown }>;
        exceededTransferLimit?: boolean;
      };

      const feats = json.features ?? [];
      for (const f of feats) {
        const a = f.attributes;
        const coords = arcgisPolyline(f.geometry);
        if (coords.length < 2 || a.OBJECTID == null) continue;

        // Match street midpoint to a sweep zone.
        const mp = midpoint(coords);
        const zone = zones.find((z) => z.rings.some((r) => pointInRing(mp, r))) ?? null;

        const name = a.FULL_ST_NAME || a.LABEL || a.STREET_NAME || `Street ${a.OBJECTID}`;
        const sweepDays = parseDays(zone?.day);
        const nonSweepDays = [0, 1, 2, 3, 4, 5, 6].filter((d) => !sweepDays.includes(d));

        const rules: NormalizedRule[] = [];

        if (zone) {
          rules.push({
            priority: 25,
            restriction_code: "street_cleaning",
            days_of_week: sweepDays,
            time_start: null,
            time_end: null,
            permit_zone: null,
            time_limit_minutes: null,
            effective_from: null,
            effective_to: null,
            notes: `Pasadena street sweeping (open data): ${zone.day ?? "unknown day"}. Posted time-of-day not in open data — verify sign.`,
          });
          if (nonSweepDays.length) {
            rules.push({
              priority: 800,
              restriction_code: "allowed",
              days_of_week: nonSweepDays,
              time_start: null,
              time_end: null,
              permit_zone: null,
              time_limit_minutes: null,
              effective_from: null,
              effective_to: null,
              notes: "No posted Pasadena street-sweeping restriction on this day. Verify any local sign before parking.",
            });
          }
        } else {
          // Street is outside any published sweep zone — show as allowed
          // every day. Catch-all unknown still wins only if engine prefers it.
          rules.push({
            priority: 800,
            restriction_code: "allowed",
            days_of_week: [0, 1, 2, 3, 4, 5, 6],
            time_start: null,
            time_end: null,
            permit_zone: null,
            time_limit_minutes: null,
            effective_from: null,
            effective_to: null,
            notes: "No Pasadena street-sweeping zone matches this street. Verify any local sign before parking.",
          });
        }

        rules.push(
          unknownRule(
            "Pasadena publishes sweeping zones but not posted time-of-day, permit, or meter signs. Verify local signage.",
          ),
        );

        out.push({
          external_id: `pasadena:street/${a.OBJECTID}`,
          name,
          side: normalizeSide(null),
          coordinates: coords,
          metadata: {
            source_provider: "Pasadena Open Data",
            dataset: "Streets/FeatureServer/1 + Street_Sweeping/FeatureServer/0",
            street_name: name,
            sweep_zone_id: zone?.id ?? null,
            sweep_day: zone?.day ?? null,
            oneway: a.ONEWAY ?? null,
            posted_restrictions: "unknown",
          },
          rules: resolveRuleConflicts(rules),
        });
      }
      total += feats.length;
      more = Boolean(json.exceededTransferLimit) && feats.length === PAGE;
      offset += feats.length;
      if (total > 20000) break; // hard safety cap
    }
    return out;
  },
};
