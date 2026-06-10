// Santa Monica Preferential Parking polyline provider.
// VERIFIED OPEN DATA: City of Santa Monica ArcGIS, Preferential_Parking
// FeatureServer/0 (1,647 polylines as of 2026-06). Each feature carries
// `zone`, `rule_`, `st_from`, `st_to`, `status`. We emit one segment per
// polyline with a permit-only rule keyed on the zone.
import { normalizeSide, resolveRuleConflicts } from "./normalize";
import { arcgisPolyline, fetchArcgis } from "./_la-shared.server";
import type { NormalizedRule, NormalizedSegment, ParkingProvider } from "./types";

const ENDPOINT =
  "https://gis.santamonica.gov/server/rest/services/Preferential_Parking/FeatureServer/0/query";

interface Attrs {
  objectid?: number;
  fullname?: string;
  st_from?: string;
  st_to?: string;
  status?: string;
  zone?: string | number;
  rule_?: string;
}

export const SantaMonicaPermitProvider: ParkingProvider = {
  id: "santa-monica-permit",
  name: "Santa Monica Preferential Parking",
  cities: ["santa-monica"],

  async fetchSegments(_citySlug, bbox) {
    const out: NormalizedSegment[] = [];
    const PAGE = 2000;
    let offset = 0;
    let more = true;
    while (more) {
      const json = await fetchArcgis(ENDPOINT, {
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
        if (coords.length < 2 || a.objectid == null) continue;
        const zone = a.zone != null ? String(a.zone) : null;
        const status = String(a.status ?? "").toLowerCase();
        if (status && status !== "active" && status !== "adopted") continue;
        const permit: NormalizedRule = {
          priority: 50,
          restriction_code: "permit",
          days_of_week: [0, 1, 2, 3, 4, 5, 6],
          time_start: null,
          time_end: null,
          permit_zone: zone,
          time_limit_minutes: null,
          effective_from: null,
          effective_to: null,
          notes: `Santa Monica Preferential Parking${zone ? ` zone ${zone}` : ""}${a.rule_ ? ` — ${a.rule_}` : ""}. Permit required.`,
        };
        out.push({
          external_id: `smgov:ppd/${a.objectid}`,
          name: a.fullname || `${a.st_from ?? ""} → ${a.st_to ?? ""}`.trim() || `PPD ${a.objectid}`,
          side: normalizeSide(null),
          coordinates: coords,
          metadata: {
            source_provider: "Santa Monica Preferential Parking",
            dataset: "Preferential_Parking/FeatureServer/0",
            permit_zone: zone,
            rule: a.rule_ ?? null,
            status: a.status ?? null,
          },
          rules: resolveRuleConflicts([permit]),
        });
      }
      more = Boolean(json.exceededTransferLimit) && feats.length === PAGE;
      offset += feats.length;
      if (offset > 20000) break;
    }
    return out;
  },
};
