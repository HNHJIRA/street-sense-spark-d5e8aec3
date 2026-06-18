// Bellevue Bus Layover Zones — polygon overlay provider.
//
// VERIFIED OPEN DATA: City of Bellevue Enterprise Transportation MapServer
//   gis-web.bellevuewa.gov/gisext/rest/services/Enterprise/
//     Enterprise_Transportation/MapServer/108   (7 polygons, citywide)
//
// Schema: OBJECTID, polygon geometry in EPSG:4326. The layer carries no
// scheduling fields, so rules apply 24/7 (matches transit-layover signage
// practice — these spaces are reserved for buses any time they are in use).
//
// Mapping:
//   layer polygon → bus_zone (priority 28)
//
// Snapped to Bellevue street_segments via apply_zone_polygon_overlay.

import { fetchArcgis } from "./_la-shared.server";
import type {
  OverlayContext,
  OverlayProvider,
  OverlayResult,
  SyncBbox,
} from "./types";

const ENDPOINT =
  "https://gis-web.bellevuewa.gov/gisext/rest/services/Enterprise/Enterprise_Transportation/MapServer/108/query";

interface Attrs {
  OBJECTID?: number;
}

export const BellevueBusLayoversOverlay: OverlayProvider = {
  kind: "overlay",
  id: "bellevue-bus-layovers",
  name: "Bellevue Bus Layover Zones",
  cities: ["bellevue"],

  async applyOverlay(
    _citySlug: string,
    bbox: SyncBbox,
    ctx: OverlayContext,
  ): Promise<OverlayResult> {
    let polygons_fetched = 0;
    let polygons_in_bbox = 0;
    let json: {
      features?: Array<{ attributes: Attrs; geometry?: { rings?: number[][][] } }>;
    } = {};
    try {
      json = (await fetchArcgis(ENDPOINT, {
        geometry: `${bbox.minLng},${bbox.minLat},${bbox.maxLng},${bbox.maxLat}`,
        geometryType: "esriGeometryEnvelope",
        inSR: "4326",
        spatialRel: "esriSpatialRelIntersects",
        resultRecordCount: "2000",
      })) as typeof json;
    } catch (e) {
      return {
        segments_touched: 0,
        rules_inserted: 0,
        polygons_fetched: 0,
        error: `Bellevue Bus Layovers fetch failed: ${(e as Error).message}`,
      };
    }

    const polys: Array<{ zone: string; geometry: string }> = [];
    for (const f of json.features ?? []) {
      polygons_fetched++;
      const rings = f.geometry?.rings;
      if (!rings || rings.length === 0) continue;
      let hit = false;
      outer: for (const r of rings) {
        for (const c of r) {
          const x = Number(c[0]);
          const y = Number(c[1]);
          if (
            x >= bbox.minLng && x <= bbox.maxLng &&
            y >= bbox.minLat && y <= bbox.maxLat
          ) {
            hit = true;
            break outer;
          }
        }
      }
      if (!hit) continue;
      polygons_in_bbox++;
      const zone = `layover-${f.attributes.OBJECTID ?? polygons_in_bbox}`;
      polys.push({
        zone,
        geometry: JSON.stringify({ type: "Polygon", coordinates: rings }),
      });
    }

    if (polys.length === 0) {
      return {
        segments_touched: 0,
        rules_inserted: 0,
        polygons_fetched,
        diagnostics: {
          lines_input: polygons_fetched,
          lines_parsed: polygons_in_bbox,
          polygons_fetched,
          polygons_in_bbox,
          matched_segments: 0,
          rows_updated: 0,
          timeout_stage: "no-polygons",
        },
      };
    }

    const t0 = Date.now();
    const { data, error } = await ctx.admin.rpc("apply_zone_polygon_overlay", {
      p_city_id: ctx.cityId,
      p_provider: "bellevue-bus-layovers",
      p_polygons: polys,
      p_restriction_code: "bus_zone",
      p_priority: 28,
      p_notes_prefix: "Bellevue bus layover zone",
    });
    const wallMs = Date.now() - t0;

    if (error) {
      const msg =
        (error as { message?: string }).message ?? "polygon overlay RPC failed";
      return {
        segments_touched: 0,
        rules_inserted: 0,
        polygons_fetched,
        error: msg,
        diagnostics: {
          lines_input: polygons_fetched,
          lines_parsed: polygons_in_bbox,
          polygons_fetched,
          polygons_in_bbox,
          matched_segments: 0,
          rows_updated: 0,
          ms_total: wallMs,
          timeout_stage: /timeout/i.test(msg) ? "rpc-timeout" : "rpc-error",
          rpc_error: msg,
        },
      };
    }

    const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
    const num = (k: string) => Number((row?.[k] as number | string | undefined) ?? 0);
    const segments_touched = num("segments_touched");
    const rules_inserted = num("rules_inserted");
    return {
      segments_touched,
      rules_inserted,
      polygons_fetched,
      diagnostics: {
        lines_input: polygons_fetched,
        lines_parsed: polygons_in_bbox,
        polygons_fetched,
        polygons_in_bbox,
        matched_segments: segments_touched,
        rows_updated: rules_inserted,
        ms_total: wallMs,
        timeout_stage: "done",
      },
    };
  },
};
