// City of Santa Monica open-data provider.
// VERIFIED OPEN DATA ONLY: imports street sweeping routes from the City's
// ArcGIS Hub. Posted sign restrictions are not in open data; fall back to
// `unknown`.
import { normalizeSide, resolveRuleConflicts } from "./normalize";
import { arcgisPolyline, fetchArcgis, parseDays, parseTime, unknownRule } from "./_la-shared.server";
import type { NormalizedSegment, ParkingProvider } from "./types";

const SWEEP_ENDPOINT =
  "https://gisservices.smgov.net/arcgis/rest/services/OpenData/StreetSweepingRoutes/MapServer/0/query";

interface Attrs {
  OBJECTID?: number;
  STREET_NAME?: string;
  DAY?: string;
  START_TIME?: string;
  END_TIME?: string;
}

export const SantaMonicaProvider: ParkingProvider = {
  id: "santa-monica-opendata",
  name: "Santa Monica Open Data",
  cities: ["santa-monica"],

  async fetchSegments(_citySlug, bbox) {
    const out: NormalizedSegment[] = [];
    try {
      const json = await fetchArcgis(SWEEP_ENDPOINT, {
        geometry: `${bbox.minLng},${bbox.minLat},${bbox.maxLng},${bbox.maxLat}`,
        geometryType: "esriGeometryEnvelope",
        inSR: "4326",
        spatialRel: "esriSpatialRelIntersects",
        resultRecordCount: "2000",
      });
      for (const f of json.features ?? []) {
        const a = f.attributes as Attrs;
        const coords = arcgisPolyline(f.geometry);
        if (coords.length < 2 || !a.OBJECTID) continue;
        const sweep = {
          priority: 25,
          restriction_code: "street_cleaning",
          days_of_week: parseDays(a.DAY),
          time_start: parseTime(a.START_TIME),
          time_end: parseTime(a.END_TIME),
          permit_zone: null,
          time_limit_minutes: null,
          effective_from: null,
          effective_to: null,
          notes: "Santa Monica street sweeping (open data).",
        };
        out.push({
          external_id: `smgov:sweep/${a.OBJECTID}`,
          name: a.STREET_NAME ?? "Unnamed street",
          side: normalizeSide(null),
          coordinates: coords,
          metadata: {
            source_provider: "Santa Monica Open Data",
            dataset: "Street Sweeping Routes",
            sweep_day: a.DAY ?? null,
            posted_restrictions: "unknown",
          },
          rules: resolveRuleConflicts([sweep, unknownRule(
            "Santa Monica publishes sweeping for this block, but posted permit/meter/time-limit signs are not in open data. Verify local signage.",
          )]),
        });
      }
    } catch (e) {
      console.warn("[SantaMonicaProvider] sweeping fetch failed:", (e as Error).message);
    }
    return out;
  },
};
