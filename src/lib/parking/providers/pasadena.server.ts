// City of Pasadena open-data provider.
// VERIFIED OPEN DATA ONLY: street sweeping routes from City of Pasadena GIS.
import { normalizeSide, resolveRuleConflicts } from "./normalize";
import { arcgisPolyline, fetchArcgis, parseDays, parseTime, unknownRule } from "./_la-shared.server";
import type { NormalizedSegment, ParkingProvider } from "./types";

const SWEEP_ENDPOINT =
  "https://www.cityofpasadena.net/gis/rest/services/OpenData/StreetSweeping/MapServer/0/query";

interface Attrs {
  OBJECTID?: number;
  STREET?: string;
  DAY?: string;
  START?: string;
  END?: string;
}

export const PasadenaProvider: ParkingProvider = {
  id: "pasadena-opendata",
  name: "Pasadena Open Data",
  cities: ["pasadena"],

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
          time_start: parseTime(a.START),
          time_end: parseTime(a.END),
          permit_zone: null,
          time_limit_minutes: null,
          effective_from: null,
          effective_to: null,
          notes: "Pasadena street sweeping (open data).",
        };
        out.push({
          external_id: `pasadena:sweep/${a.OBJECTID}`,
          name: a.STREET ?? "Unnamed street",
          side: normalizeSide(null),
          coordinates: coords,
          metadata: {
            source_provider: "Pasadena Open Data",
            dataset: "Street Sweeping",
            posted_restrictions: "unknown",
          },
          rules: resolveRuleConflicts([sweep, unknownRule(
            "Pasadena publishes sweeping for this block, but posted permit/meter signs are not in open data. Verify local signage.",
          )]),
        });
      }
    } catch (e) {
      console.warn("[PasadenaProvider] sweeping fetch failed:", (e as Error).message);
    }
    return out;
  },
};
