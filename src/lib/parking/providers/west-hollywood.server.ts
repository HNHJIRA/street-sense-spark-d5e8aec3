// City of West Hollywood open-data provider.
// VERIFIED OPEN DATA ONLY: street sweeping routes from City of WeHo GIS.
import { normalizeSide, resolveRuleConflicts } from "./normalize";
import { arcgisPolyline, fetchArcgis, parseDays, parseTime, unknownRule } from "./_la-shared.server";
import type { NormalizedSegment, ParkingProvider } from "./types";

const SWEEP_ENDPOINT =
  "https://gis.weho.org/arcgis/rest/services/OpenData/StreetSweeping/MapServer/0/query";

interface Attrs {
  OBJECTID?: number;
  Street?: string;
  Day?: string;
  StartTime?: string;
  EndTime?: string;
  PermitZone?: string;
}

export const WestHollywoodProvider: ParkingProvider = {
  id: "weho-opendata",
  name: "West Hollywood Open Data",
  cities: ["west-hollywood"],

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
        const rules: import("./types").NormalizedRule[] = [
          {
            priority: 25,
            restriction_code: "street_cleaning",
            days_of_week: parseDays(a.Day),
            time_start: parseTime(a.StartTime),
            time_end: parseTime(a.EndTime),
            permit_zone: null,
            time_limit_minutes: null,
            effective_from: null,
            effective_to: null,
            notes: "West Hollywood street sweeping (open data).",
          },
        ];
        if (a.PermitZone) {
          rules.push({
            priority: 50,
            restriction_code: "permit",
            days_of_week: [0, 1, 2, 3, 4, 5, 6],
            time_start: null,
            time_end: null,
            permit_zone: String(a.PermitZone),
            time_limit_minutes: null,
            effective_from: null,
            effective_to: null,
            notes: `WeHo Permit Zone ${a.PermitZone} (verify hours posted on sign).`,
          });
        }
        out.push({
          external_id: `weho:sweep/${a.OBJECTID}`,
          name: a.Street ?? "Unnamed street",
          side: normalizeSide(null),
          coordinates: coords,
          metadata: {
            source_provider: "West Hollywood Open Data",
            dataset: "Street Sweeping + Permit Zones",
            permit_zone: a.PermitZone ?? null,
            posted_restrictions: "unknown",
          },
          rules: resolveRuleConflicts([...rules, unknownRule(
            "WeHo publishes sweeping and permit-zone data, but posted meter/time-limit signs are not in open data. Verify local signage.",
          )]),
        });
      }
    } catch (e) {
      console.warn("[WestHollywoodProvider] sweeping fetch failed:", (e as Error).message);
    }
    return out;
  },
};
