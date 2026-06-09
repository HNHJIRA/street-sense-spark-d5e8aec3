// West Hollywood Permit District overlay provider.
// VERIFIED OPEN DATA: WeHo ArcGIS, OnlineLookups/MapServer/6 — 11 permit
// district polygons. Unlike a normal provider this does NOT create new
// segments; it overlays a `permit` rule onto every WeHo street_segment
// whose geometry intersects a district polygon, via the
// `apply_permit_polygon_overlay` PostGIS function.
import type { OverlayProvider } from "./types";
import { fetchArcgis } from "./_la-shared.server";

const ENDPOINT =
  "https://gis.weho.org/arcgis/rest/services/OnlineLookups/MapServer/6/query";

interface Attrs {
  OBJECTID?: number;
  District?: number | string;
}

export const WestHollywoodPermitOverlay: OverlayProvider = {
  kind: "overlay",
  id: "weho-permit",
  name: "West Hollywood Permit Districts",
  cities: ["west-hollywood"],

  async applyOverlay(_citySlug, bbox, ctx) {
    const json = await fetchArcgis(ENDPOINT, {
      geometry: `${bbox.minLng},${bbox.minLat},${bbox.maxLng},${bbox.maxLat}`,
      geometryType: "esriGeometryEnvelope",
      inSR: "4326",
      spatialRel: "esriSpatialRelIntersects",
      resultRecordCount: "2000",
    }) as { features?: Array<{ attributes: Attrs; geometry?: { rings?: number[][][] } }> };

    const polys: Array<{ zone: string; geometry: string }> = [];
    for (const f of json.features ?? []) {
      const a = f.attributes;
      if (!f.geometry?.rings?.length) continue;
      polys.push({
        zone: a.District != null ? String(a.District) : `D${a.OBJECTID ?? "?"}`,
        geometry: JSON.stringify({ type: "Polygon", coordinates: f.geometry.rings }),
      });
    }
    if (polys.length === 0) {
      return { segments_touched: 0, rules_inserted: 0, polygons_fetched: 0 };
    }
    const { data, error } = await ctx.admin.rpc("apply_permit_polygon_overlay", {
      p_city_id: ctx.cityId,
      p_provider: "weho-permit",
      p_polygons: polys,
      p_priority: 50,
      p_notes_prefix: "West Hollywood permit district",
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
