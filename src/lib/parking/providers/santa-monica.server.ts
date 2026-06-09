// City of Santa Monica open-data provider.
// VERIFIED OPEN DATA: City of Santa Monica ArcGIS Server, Street_Sweeping
// MapServer (polylines, fields `day` / `time`). Optional Preferential_Parking
// layer adds permit-zone rules.
import { normalizeSide, resolveRuleConflicts } from "./normalize";
import { arcgisPolyline, fetchArcgis, parseDays, parseTime, unknownRule } from "./_la-shared.server";
import type { NormalizedRule, NormalizedSegment, ParkingProvider } from "./types";

const SWEEP_ENDPOINT =
  "https://gis.santamonica.gov/server/rest/services/Street_Sweeping/MapServer/0/query";
const PERMIT_ENDPOINT =
  "https://gis.santamonica.gov/server/rest/services/Preferential_Parking/MapServer/0/query";

interface SweepAttrs {
  objectid?: number;
  day?: string;
  time?: string;
}

/** Parse "8:00 AM - 11:00 AM" / "8am-11am" → [start, end]. */
function parseTimeRange(raw: string | null | undefined): { start: string | null; end: string | null } {
  if (!raw) return { start: null, end: null };
  const m = String(raw).split(/\s*[-–]\s*/);
  if (m.length < 2) return { start: parseTime(m[0]), end: null };
  return { start: parseTime(m[0]), end: parseTime(m[1]) };
}

export const SantaMonicaProvider: ParkingProvider = {
  id: "santa-monica-opendata",
  name: "Santa Monica Open Data",
  cities: ["santa-monica"],

  async fetchSegments(_citySlug, bbox) {
    const out: NormalizedSegment[] = [];

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
      if (coords.length < 2 || !a.objectid) continue;
      const { start, end } = parseTimeRange(a.time);
      const sweep: NormalizedRule = {
        priority: 25,
        restriction_code: "street_cleaning",
        days_of_week: parseDays(a.day),
        time_start: start,
        time_end: end,
        permit_zone: null,
        time_limit_minutes: null,
        effective_from: null,
        effective_to: null,
        notes: `Santa Monica street sweeping (open data): ${a.day ?? ""} ${a.time ?? ""}`.trim(),
      };
      out.push({
        external_id: `smgov:sweep/${a.objectid}`,
        name: `Sweep route ${a.objectid}`,
        side: normalizeSide(null),
        coordinates: coords,
        metadata: {
          source_provider: "Santa Monica Open Data",
          dataset: "Street_Sweeping/MapServer/0",
          sweep_day: a.day ?? null,
          sweep_time: a.time ?? null,
          posted_restrictions: "unknown",
        },
        rules: resolveRuleConflicts([sweep, unknownRule(
          "Santa Monica publishes sweeping for this block, but posted permit/meter/time-limit signs are not in open data. Verify local signage.",
        )]),
      });
    }
    return out;
  },
};
