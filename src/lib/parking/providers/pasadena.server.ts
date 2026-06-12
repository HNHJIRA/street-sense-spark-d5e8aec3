// City of Pasadena open-data provider.
// VERIFIED OPEN DATA: ArcGIS Online (CityOfPasadenaCAGIS), NeighAssocCommunityResources
// FeatureServer, layer 21 ("Street Sweeping"). Geometry is polygons with a
// single `SWEEPING_DAY` attribute — there is no published time-of-day, so we
// emit an all-day street-cleaning rule for the day plus an `unknown` rule.
import { normalizeSide, resolveRuleConflicts } from "./normalize";
import { arcgisPolyline, fetchArcgis, parseDays, unknownRule } from "./_la-shared.server";
import type { NormalizedRule, NormalizedSegment, ParkingProvider } from "./types";

const SWEEP_ENDPOINT =
  "https://services2.arcgis.com/zNjnZafDYCAJAbN0/arcgis/rest/services/NeighAssocCommunityResources/FeatureServer/21/query";

interface Attrs {
  OBJECTID?: number;
  SWEEPING_DAY?: string;
}

export const PasadenaProvider: ParkingProvider = {
  id: "pasadena-opendata",
  name: "Pasadena Open Data",
  cities: ["pasadena"],

  async fetchSegments(_citySlug, bbox) {
    const out: NormalizedSegment[] = [];
    // FeatureServer paginates with `resultOffset`; the layer returns
    // `exceededTransferLimit:true` on a single page. Loop until exhausted.
    const PAGE = 2000;
    let offset = 0;
    let more = true;
    while (more) {
      const json = await fetchArcgis(SWEEP_ENDPOINT, {
        geometry: `${bbox.minLng},${bbox.minLat},${bbox.maxLng},${bbox.maxLat}`,
        geometryType: "esriGeometryEnvelope",
        inSR: "4326",
        spatialRel: "esriSpatialRelIntersects",
        resultRecordCount: String(PAGE),
        resultOffset: String(offset),
      }) as { features?: Array<{ attributes: Attrs; geometry?: unknown }>; exceededTransferLimit?: boolean };

      const feats = json.features ?? [];
      for (const f of feats) {
        const a = f.attributes;
        const coords = arcgisPolyline(f.geometry);
        if (coords.length < 2 || a.OBJECTID == null) continue;
        const sweepDays = parseDays(a.SWEEPING_DAY);
        const nonSweepDays = [0, 1, 2, 3, 4, 5, 6].filter((d) => !sweepDays.includes(d));
        const sweep: NormalizedRule = {
          priority: 25,
          restriction_code: "street_cleaning",
          days_of_week: sweepDays,
          time_start: null,
          time_end: null,
          permit_zone: null,
          time_limit_minutes: null,
          effective_from: null,
          effective_to: null,
          notes: `Pasadena street sweeping (open data): ${a.SWEEPING_DAY ?? "unknown day"}. Posted time-of-day not in open data — verify sign.`,
        };
        // On non-sweep days, Pasadena residential streets are generally
        // unrestricted. Emit an explicit allowed rule so the map shows green
        // instead of falling through to the catch-all unknown rule.
        const allowedOffSweep: NormalizedRule | null = nonSweepDays.length
          ? {
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
            }
          : null;
        out.push({
          external_id: `pasadena:sweep/${a.OBJECTID}`,
          name: `Sweep area ${a.OBJECTID}`,
          side: normalizeSide(null),
          coordinates: coords,
          metadata: {
            source_provider: "Pasadena Open Data",
            dataset: "NeighAssocCommunityResources/FeatureServer/21",
            sweep_day: a.SWEEPING_DAY ?? null,
            posted_restrictions: "unknown",
          },
          rules: resolveRuleConflicts([
            sweep,
            ...(allowedOffSweep ? [allowedOffSweep] : []),
            unknownRule(
              "Pasadena publishes sweeping day but not posted time-of-day, permit, or meter signs. Verify local signage.",
            ),
          ]),
        });
      }
      more = Boolean(json.exceededTransferLimit) && feats.length === PAGE;
      offset += feats.length;
      if (offset > 20000) break; // hard safety cap
    }
    return out;
  },
};
