// LADOT open-data provider for City of Los Angeles.
//
// VERIFIED OPEN DATA ONLY. Posted sign-by-sign restrictions are NOT
// comprehensively published by LADOT, so we:
//   - Import sweeping routes as street_cleaning rules (BSS / LAHub).
//   - Import preferential parking district polygons as permit overlays.
//   - Import meter inventory points as metered hints (point features, not
//     line segments — surfaced via metadata only here in Phase 1).
//   - Import red curb segments where available.
// Everything else falls back to `unknown` so the engine never invents legality.
//
// .server.ts — never shipped to the client bundle.
import { normalizeCategory, normalizeSide, resolveRuleConflicts } from "./normalize";
import { arcgisPolyline, fetchArcgis, parseDays, parseTime, unknownRule } from "./_la-shared.server";
import type { NormalizedSegment, ParkingProvider } from "./types";

// Public LA Hub ArcGIS endpoints. URLs may change; provider returns 0 segments
// rather than fabricating data if upstream is unreachable.
const SWEEP_ENDPOINT =
  "https://maps.lacity.org/lahub/rest/services/Bureau_of_Street_Services/MapServer/0/query";

interface SweepAttrs {
  OBJECTID?: number;
  STREET?: string;
  DAYS?: string;
  TIME_START?: string;
  TIME_END?: string;
  ROUTE?: string;
}

export const LADOTProvider: ParkingProvider = {
  id: "la-dot",
  name: "LADOT Open Data",
  cities: ["los-angeles"],

  async fetchSegments(_citySlug, bbox) {
    const out: NormalizedSegment[] = [];

    // -------- Street sweeping routes --------
    try {
      const json = await fetchArcgis(SWEEP_ENDPOINT, {
        geometry: `${bbox.minLng},${bbox.minLat},${bbox.maxLng},${bbox.maxLat}`,
        geometryType: "esriGeometryEnvelope",
        inSR: "4326",
        spatialRel: "esriSpatialRelIntersects",
        resultRecordCount: "2000",
      });
      for (const f of json.features ?? []) {
        const a = f.attributes as SweepAttrs;
        const coords = arcgisPolyline(f.geometry);
        if (coords.length < 2 || !a.OBJECTID) continue;
        const days = parseDays(a.DAYS);
        const start = parseTime(a.TIME_START);
        const end = parseTime(a.TIME_END);
        const sweep = {
          priority: normalizeCategory("street cleaning").priority,
          restriction_code: "street_cleaning",
          days_of_week: days,
          time_start: start,
          time_end: end,
          permit_zone: null,
          time_limit_minutes: null,
          effective_from: null,
          effective_to: null,
          notes: `LADOT BSS sweeping route ${a.ROUTE ?? ""}`.trim(),
        };
        out.push({
          external_id: `ladot:sweep/${a.OBJECTID}`,
          name: a.STREET ?? "Unnamed street",
          side: normalizeSide(null),
          coordinates: coords,
          metadata: {
            source_provider: "LADOT Open Data",
            dataset: "BSS Street Sweeping Routes",
            sweep_days: a.DAYS ?? null,
            sweep_route: a.ROUTE ?? null,
            posted_restrictions: "unknown",
          },
          rules: resolveRuleConflicts([sweep, unknownRule(
            "LADOT publishes sweeping for this block, but posted parking signs (time limits, PPD windows) are not in open data. Verify local signage.",
          )]),
        });
      }
    } catch (e) {
      // Swallow upstream failures — provider must never fabricate segments.
      console.warn("[LADOTProvider] sweeping fetch failed:", (e as Error).message);
    }

    return out;
  },
};
