// City of West Hollywood open-data provider.
// VERIFIED OPEN DATA: City of WeHo ArcGIS Server, DPW/Street_Sweeping MapServer.
// Six day-specific sublayers (0=Early Morning daily, 1=Mon, 2=Tue, 3=Wed,
// 4=Thu, 5=Fri). Each feature carries `Zone`, `Day`, `Schedule` (e.g. "4am-7am").
// Permit-zone polygons live on OnlineLookups/MapServer/6.
import { normalizeSide, resolveRuleConflicts } from "./normalize";
import { arcgisPolyline, fetchArcgis, parseDays, parseTime, unknownRule } from "./_la-shared.server";
import type { NormalizedRule, NormalizedSegment, ParkingProvider } from "./types";

const SWEEP_LAYERS: Array<{ id: number; name: string; defaultDays: number[] }> = [
  { id: 0, name: "Early_Morning",          defaultDays: [0, 1, 2, 3, 4, 5, 6] },
  { id: 1, name: "Monday_StreetSweeping",  defaultDays: [1] },
  { id: 2, name: "Tuesday_StreetSweeping", defaultDays: [2] },
  { id: 3, name: "Wednesday_StreetSweeping", defaultDays: [3] },
  { id: 4, name: "Thursday_StreetSweeping", defaultDays: [4] },
  { id: 5, name: "Friday_StreetSweeping",  defaultDays: [5] },
];
const SWEEP_BASE = "https://gis.weho.org/arcgis/rest/services/DPW/Street_Sweeping/MapServer";

interface Attrs {
  OBJECTID?: number;
  Zone?: string;
  Day?: string;
  Schedule?: string;
}

function parseSchedule(raw: string | null | undefined): { start: string | null; end: string | null } {
  if (!raw) return { start: null, end: null };
  const parts = String(raw).split(/\s*[-–]\s*/);
  if (parts.length < 2) return { start: parseTime(parts[0]), end: null };
  return { start: parseTime(parts[0]), end: parseTime(parts[1]) };
}

export const WestHollywoodProvider: ParkingProvider = {
  id: "weho-opendata",
  name: "West Hollywood Open Data",
  cities: ["west-hollywood"],

  async fetchSegments(_citySlug, bbox) {
    const out: NormalizedSegment[] = [];
    const errors: string[] = [];

    for (const layer of SWEEP_LAYERS) {
      try {
        const json = await fetchArcgis(`${SWEEP_BASE}/${layer.id}/query`, {
          geometry: `${bbox.minLng},${bbox.minLat},${bbox.maxLng},${bbox.maxLat}`,
          geometryType: "esriGeometryEnvelope",
          inSR: "4326",
          spatialRel: "esriSpatialRelIntersects",
          resultRecordCount: "2000",
        });
        for (const f of json.features ?? []) {
          const a = f.attributes as Attrs;
          const coords = arcgisPolyline(f.geometry);
          if (coords.length < 2 || a.OBJECTID == null) continue;
          const { start, end } = parseSchedule(a.Schedule);
          const days = a.Day && a.Day.toLowerCase() !== "daily" ? parseDays(a.Day) : layer.defaultDays;
          const sweep: NormalizedRule = {
            priority: 25,
            restriction_code: "street_cleaning",
            days_of_week: days,
            time_start: start,
            time_end: end,
            permit_zone: null,
            time_limit_minutes: null,
            effective_from: null,
            effective_to: null,
            notes: `WeHo street sweeping (zone ${a.Zone ?? "?"}, ${layer.name}): ${a.Day ?? ""} ${a.Schedule ?? ""}`.trim(),
          };
          out.push({
            external_id: `weho:sweep/${layer.id}/${a.OBJECTID}`,
            name: `Sweep zone ${a.Zone ?? a.OBJECTID}`,
            side: normalizeSide(null),
            coordinates: coords,
            metadata: {
              source_provider: "West Hollywood Open Data",
              dataset: `DPW/Street_Sweeping/${layer.name}`,
              zone: a.Zone ?? null,
              sweep_day: a.Day ?? null,
              sweep_schedule: a.Schedule ?? null,
              posted_restrictions: "unknown",
            },
            rules: resolveRuleConflicts([sweep, unknownRule(
              "WeHo publishes sweeping data, but posted permit/meter/time-limit signs are not in open data. Verify local signage.",
            )]),
          });
        }
      } catch (e) {
        errors.push(`${layer.name}: ${(e as Error).message}`);
      }
    }

    if (out.length === 0 && errors.length) {
      throw new Error(`WeHo sweeping fetch failed for all layers: ${errors.join(" | ")}`);
    }
    return out;
  },
};
