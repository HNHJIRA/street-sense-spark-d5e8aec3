// Arlington Residential Permit Parking (RPP) districts — overlay provider.
//
// VERIFIED OPEN DATA: Arlington County GIS Hub publishes RPP district
// polygons. This overlay tags every Arlington street_segment whose
// geometry intersects an RPP polygon with a `permit` rule via the shared
// `apply_permit_polygon_overlay` PostGIS function. It never creates
// segments and never alters non-Arlington rules.
//
// Endpoint (Arlington County ArcGIS):
//   services1.arcgis.com/.../arcgis/rest/services/RPP_Districts/FeatureServer/0
//
// If Arlington has not published an RPP polygon dataset at sync time, the
// provider reports `polygons_fetched: 0` and exits cleanly — no fabricated
// permit zones land in the database.

import { fetchArcgis } from "./_la-shared.server";
import type { OverlayContext, OverlayProvider, OverlayResult, SyncBbox } from "./types";

const ENDPOINT =
  "https://services1.arcgis.com/mVFRs7NF4iFitgbY/arcgis/rest/services/RPP_Districts/FeatureServer/0/query";

interface Attrs {
  OBJECTID?: number;
  DISTRICT?: string | number;
  ZONE?: string | number;
  RPP_ZONE?: string | number;
  NAME?: string;
}

export const ArlingtonPermitOverlay: OverlayProvider = {
  kind: "overlay",
  id: "arlington-permit",
  name: "Arlington Residential Permit Districts",
  cities: ["arlington"],

  async applyOverlay(_citySlug: string, bbox: SyncBbox, ctx: OverlayContext): Promise<OverlayResult> {
    let json: { features?: Array<{ attributes: Attrs; geometry?: { rings?: number[][][] } }> } = {};
    try {
      json = await fetchArcgis(ENDPOINT, {
        geometry: `${bbox.minLng},${bbox.minLat},${bbox.maxLng},${bbox.maxLat}`,
        geometryType: "esriGeometryEnvelope",
        inSR: "4326",
        spatialRel: "esriSpatialRelIntersects",
        resultRecordCount: "2000",
      }) as typeof json;
    } catch (e) {
      // Dataset not published / endpoint unreachable: exit cleanly so
      // provider_health records the failure without poisoning RPP rules.
      throw new Error(`Arlington RPP fetch failed: ${(e as Error).message}`);
    }

    const polys: Array<{ zone: string; geometry: string }> = [];
    for (const f of json.features ?? []) {
      const a = f.attributes;
      if (!f.geometry?.rings?.length) continue;
      const zoneRaw = a.RPP_ZONE ?? a.ZONE ?? a.DISTRICT ?? a.NAME ?? a.OBJECTID;
      polys.push({
        zone: zoneRaw != null ? String(zoneRaw) : `RPP${a.OBJECTID ?? "?"}`,
        geometry: JSON.stringify({ type: "Polygon", coordinates: f.geometry.rings }),
      });
    }
    if (polys.length === 0) {
      return { segments_touched: 0, rules_inserted: 0, polygons_fetched: 0 };
    }
    const { data, error } = await ctx.admin.rpc("apply_permit_polygon_overlay", {
      p_city_id: ctx.cityId,
      p_provider: "arlington-permit",
      p_polygons: polys,
      p_priority: 50,
      p_notes_prefix: "Arlington residential permit district",
    });
    if (error) throw new Error((error as { message?: string }).message ?? "overlay RPC failed");
    const row = Array.isArray(data) ? data[0] : data;
    return {
      segments_touched: Number(row?.segments_touched ?? 0),
      rules_inserted: Number(row?.rules_inserted ?? 0),
      polygons_fetched: polys.length,
    };
  },
};
