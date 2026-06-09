// Seattle SDOT Restricted Parking Zone (RPZ) provider — additive permit layer.
// Pulls every RPZ polygon. The sync layer intersects each polygon against
// existing blockface segments and appends a permit rule with the zone number.

import { fetchArcgis } from "./_la-shared.server";
import type { NormalizedSegment, ParkingProvider } from "./types";

const ENDPOINT =
  "https://services.arcgis.com/ZOyb2t4B0UYuYNYH/arcgis/rest/services/Restricted_Parking_Zones/FeatureServer/0/query";

interface RpzAttrs {
  OBJECTID?: number;
  ZONE_NO?: number | string | null;
  ZONE_NAME?: string | null;
}

interface PolygonGeom {
  rings?: number[][][];
}

function ringToLine(rings: number[][][]): [number, number][] {
  if (!rings.length) return [];
  // Use exterior ring as a representative polyline for storage.
  return rings[0].map((c) => [Number(c[0]), Number(c[1])] as [number, number]);
}

export const SeattleRpzProvider: ParkingProvider = {
  id: "sdot-rpz",
  name: "Seattle SDOT Restricted Parking Zones",
  cities: ["seattle"],

  async fetchSegments(_citySlug, bbox) {
    const out: NormalizedSegment[] = [];
    try {
      const json = await fetchArcgis(ENDPOINT, {
        geometry: `${bbox.minLng},${bbox.minLat},${bbox.maxLng},${bbox.maxLat}`,
        geometryType: "esriGeometryEnvelope",
        inSR: "4326",
        spatialRel: "esriSpatialRelIntersects",
        resultRecordCount: "500",
      });
      for (const f of (json.features ?? [])) {
        const a = f.attributes as RpzAttrs;
        const g = f.geometry as PolygonGeom | undefined;
        const coords = ringToLine(g?.rings ?? []);
        if (coords.length < 2) continue;
        const zone = a.ZONE_NO != null ? String(a.ZONE_NO) : null;
        if (!zone) continue;
        out.push({
          external_id: `sdot-rpz:${a.OBJECTID ?? zone}`,
          name: a.ZONE_NAME ?? `RPZ Zone ${zone}`,
          side: "both",
          coordinates: coords,
          metadata: {
            source_provider: "Seattle SDOT RPZ",
            permit_zone: zone,
            geometry_kind: "rpz_polygon",
          },
          rules: [{
            priority: 50,
            restriction_code: "permit",
            days_of_week: [1, 2, 3, 4, 5],
            time_start: "07:00",
            time_end: "18:00",
            permit_zone: zone,
            time_limit_minutes: null,
            effective_from: null,
            effective_to: null,
            notes: `RPZ Zone ${zone} — permit required Mon–Fri 7a–6p (verify posted hours).`,
          }],
        });
      }
    } catch (e) {
      console.warn("[SeattleRpz] fetch failed:", (e as Error).message);
    }
    return out;
  },
};
