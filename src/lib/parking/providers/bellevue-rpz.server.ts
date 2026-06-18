// Bellevue Residential Parking Zone (RPZ) overlay provider.
//
// VERIFIED OPEN DATA: City of Bellevue Transportation publishes the 16
// official RPZ polygons through the gisext MapServer:
//   gis-web.bellevuewa.gov/gisext/rest/services/Transportation/
//     TIMS_Reference/MapServer/10
//
// Schema: OBJECTID, RPZ_ID, CODENO (zone label), polygon geometry in
// EPSG:4326. The rpz.bellevuewa.gov ASP.NET portal is a permit-purchase
// front-end — these polygons are the geographic source of truth.
//
// This overlay calls the existing apply_permit_polygon_overlay PostGIS
// RPC, which inserts one `permit` rule per Bellevue street_segment whose
// geometry intersects an RPZ polygon. It never creates segments, never
// fabricates legality outside published polygons.

import { fetchArcgis } from "./_la-shared.server";
import type { OverlayContext, OverlayProvider, OverlayResult, SyncBbox } from "./types";

const ENDPOINT =
  "https://gis-web.bellevuewa.gov/gisext/rest/services/Transportation/TIMS_Reference/MapServer/10/query";

interface Attrs {
  OBJECTID?: number;
  RPZ_ID?: number;
  CODENO?: string;
  PARKGZONES_ID?: number;
}

export const BellevueRpzOverlay: OverlayProvider = {
  kind: "overlay",
  id: "bellevue-rpz",
  name: "Bellevue Residential Parking Zones",
  cities: ["bellevue"],

  async applyOverlay(_citySlug: string, bbox: SyncBbox, ctx: OverlayContext): Promise<OverlayResult> {
    let polygons_fetched = 0;
    let polygons_in_bbox = 0;
    let json: { features?: Array<{ attributes: Attrs; geometry?: { rings?: number[][][] } }> } = {};
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
        error: `Bellevue RPZ fetch failed: ${(e as Error).message}`,
      };
    }

    const polys: Array<{ zone: string; geometry: string }> = [];
    for (const f of json.features ?? []) {
      polygons_fetched++;
      const rings = f.geometry?.rings;
      if (!rings || rings.length === 0) continue;
      // Sanity check that geometry actually overlaps Bellevue bbox.
      let hit = false;
      outer: for (const r of rings) {
        for (const c of r) {
          const x = Number(c[0]);
          const y = Number(c[1]);
          if (x >= bbox.minLng && x <= bbox.maxLng && y >= bbox.minLat && y <= bbox.maxLat) {
            hit = true;
            break outer;
          }
        }
      }
      if (!hit) continue;
      polygons_in_bbox++;
      const a = f.attributes;
      const zoneRaw = (a.CODENO ?? "").toString().trim();
      const rpzId = a.RPZ_ID != null ? String(a.RPZ_ID) : null;
      const zone = zoneRaw || rpzId || `RPZ${a.OBJECTID ?? "?"}`;
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
          matched_segments: 0,
          rows_updated: 0,
          timeout_stage: "no-polygons",
        },
      };
    }

    const t0 = Date.now();
    const { data, error } = await ctx.admin.rpc("apply_permit_polygon_overlay", {
      p_city_id: ctx.cityId,
      p_provider: "bellevue-rpz",
      p_polygons: polys,
      p_priority: 50,
      p_notes_prefix: "Bellevue Residential Parking Zone",
    });
    const wallMs = Date.now() - t0;

    if (error) {
      const msg = (error as { message?: string }).message ?? "polygon overlay RPC failed";
      return {
        segments_touched: 0,
        rules_inserted: 0,
        polygons_fetched,
        error: msg,
        diagnostics: {
          lines_input: polygons_fetched,
          lines_parsed: polygons_in_bbox,
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
        matched_segments: segments_touched,
        rows_updated: rules_inserted,
        ms_total: wallMs,
        timeout_stage: "done",
      },
    };
  },
};
