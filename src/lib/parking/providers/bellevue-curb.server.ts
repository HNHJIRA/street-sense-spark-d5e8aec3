// Bellevue Curb Space Typology overlay provider.
//
// VERIFIED OPEN DATA: Curb_Space_Typology FeatureServer/23 (926 polylines).
// Distribution by neighborhood (verified 2026-06): BelRed 484, Downtown 322,
// Wilburton 90, unassigned 30. All four are equally authoritative — they
// are the same published curb-typology dataset, not extrapolation. We
// import every row and let the typology flags speak for themselves.
//
// Each polyline has seven boolean typology flags:
//
//   typ_m_auto / typ_m_bicycle / typ_m_transit  -- Movement (no parking)
//   typ_a                                       -- Access  (loading)
//   typ_p                                       -- Place   (no parking)
//   typ_s_auto                                  -- Storage (parking ok)
//   typ_s_transit                               -- Transit storage (bus zone)
//
// Documented mapping → restriction_code (priority):
//   typ_s_auto = 1 AND no exclusive movement/place flag    → allowed (200)
//   typ_s_transit = 1                                      → bus_zone (40)
//   typ_m_transit = 1 AND typ_s_auto = 0                   → bus_zone (40)
//   typ_a = 1 AND typ_s_auto = 0                           → loading_zone (40)
//   any movement/place flag with all storage flags 0       → no_parking (30)
//
// IMPORTANT — Upstream coordinate registration is currently broken on
// the published FeatureServer. Layer metadata reports
// spatialReference=3857 but the stored geometry is in a custom local
// coordinate system, so `outSR=4326` returns coordinates that fall far
// outside Bellevue's WGS84 bbox (e.g. [11.7365, 2.0807]) and any
// PostGIS spatial join produces zero matches.
//
// This provider therefore validates every fetched coordinate against
// the requested bbox before sending anything to the curb-overlay RPC.
// When validation fails it surfaces an explicit diagnostic and inserts
// zero rules — we do not invent geometry to compensate. The provider
// remains in the registry so coverage automatically lights up the day
// Bellevue corrects the layer's projection.

import proj4 from "proj4";

import type { OverlayContext, OverlayProvider, OverlayResult, SyncBbox } from "./types";

// EPSG:2926 — NAD83(HARN) / Washington State Plane North, US survey feet.
// Verified by audit: Layer 23 advertises WKID 3857 but stores geometry in
// this CRS. Forward transform to WGS84 is mathematically deterministic.
const EPSG_2926 =
  "+proj=lcc +lat_1=48.73333333333333 +lat_2=47.5 +lat_0=47 " +
  "+lon_0=-120.8333333333333 +x_0=500000.0001016 +y_0=0 " +
  "+ellps=GRS80 +datum=NAD83 +units=us-ft +no_defs";
const EPSG_4326 = "+proj=longlat +datum=WGS84 +no_defs";
const reproject2926to4326 = (x: number, y: number): [number, number] => {
  const [lng, lat] = proj4(EPSG_2926, EPSG_4326, [x, y]) as [number, number];
  return [lng, lat];
};

const ENDPOINT =
  "https://services1.arcgis.com/EYzEZbDhXZjURPbP/arcgis/rest/services/Curb_Space_Typology/FeatureServer/23/query";

const SNAP_METERS = 15;
const PAGE_SIZE = 2000;
const HARD_CAP = 5000;

interface Attrs {
  OBJECTID?: number;
  neighborhood?: string;
  main_street?: string;
  side_of_street?: string;
  typ_m_auto?: number;
  typ_m_bicycle?: number;
  typ_m_transit?: number;
  typ_a?: number;
  typ_p?: number;
  typ_s_auto?: number;
  typ_s_transit?: number;
}

interface Line {
  restriction_code: string;
  priority: number;
  stname: string | null;
  time_start: string | null;
  time_end: string | null;
  days_of_week: number[];
  permit_zone: string | null;
  time_limit_minutes: number | null;
  notes: string;
  geometry: string;
}

function on(v: number | undefined): boolean {
  return Number(v ?? 0) > 0;
}

function classify(a: Attrs): { code: string; priority: number; reason: string } | null {
  const sAuto = on(a.typ_s_auto);
  const sTransit = on(a.typ_s_transit);
  const mTransit = on(a.typ_m_transit);
  const mAuto = on(a.typ_m_auto);
  const mBike = on(a.typ_m_bicycle);
  const access = on(a.typ_a);
  const place = on(a.typ_p);

  if (sTransit) return { code: "bus_zone", priority: 40, reason: "transit storage" };
  if (mTransit && !sAuto) return { code: "bus_zone", priority: 40, reason: "transit movement" };
  if (access && !sAuto) return { code: "loading_zone", priority: 40, reason: "access only" };
  if (sAuto) return { code: "allowed", priority: 200, reason: "auto storage" };
  if (mAuto || mBike || place) return { code: "no_parking", priority: 30, reason: "movement/place curb" };
  return null;
}

function arcgisLineRaw(geometry: unknown): [number, number][] | null {
  const g = geometry as { paths?: number[][][] } | null;
  const paths = g?.paths ?? [];
  if (!paths.length) return null;
  let longest = paths[0];
  for (const p of paths) if (p.length > longest.length) longest = p;
  if (longest.length < 2) return null;
  return longest.map((c) => [Number(c[0]), Number(c[1])] as [number, number]);
}

function inBbox(x: number, y: number, b: SyncBbox) {
  return x >= b.minLng && x <= b.maxLng && y >= b.minLat && y <= b.maxLat;
}

export const BellevueCurbOverlay: OverlayProvider = {
  kind: "overlay",
  id: "bellevue-curb",
  name: "Bellevue Curb Space Typology",
  cities: ["bellevue"],

  async applyOverlay(_citySlug: string, bbox: SyncBbox, ctx: OverlayContext): Promise<OverlayResult> {
    let features_fetched = 0;
    let features_reprojected = 0;
    let features_after_bbox = 0;
    const skipped_neighborhood = 0;
    let skipped_unclassified = 0;
    let skipped_bad_geometry = 0;
    let skipped_reproject_error = 0;
    const neighborhood_counts: Record<string, number> = {};
    const lines: Line[] = [];

    try {
      let offset = 0;
      while (offset < HARD_CAP) {
        // Bypass fetchArcgis: it forces outSR=4326, which returns broken
        // coords for this misregistered layer. Request native geometry
        // directly (no outSR ⇒ stored EPSG:2926 feet) and reproject.
        const qs = new URLSearchParams({
          f: "json",
          where: "1=1",
          outFields: "*",
          returnGeometry: "true",
          resultRecordCount: String(PAGE_SIZE),
          resultOffset: String(offset),
        });
        const res = await fetch(`${ENDPOINT}?${qs.toString()}`);
        if (!res.ok) throw new Error(`ArcGIS ${ENDPOINT} responded ${res.status}`);
        const json = (await res.json()) as {
          features?: Array<{ attributes: Attrs; geometry?: unknown }>;
          exceededTransferLimit?: boolean;
        };
        const feats = json.features ?? [];
        if (feats.length === 0) break;
        features_fetched += feats.length;

        for (const f of feats) {
          const a = f.attributes;
          // Track neighborhood for diagnostics but don't gate on it: the
          // upstream feed is the city's published curb-typology dataset
          // and every row is equally authoritative.
          const neighborhood = (a.neighborhood ?? "").toString().trim();
          neighborhood_counts[neighborhood || "(none)"] =
            (neighborhood_counts[neighborhood || "(none)"] ?? 0) + 1;
          const cls = classify(a);
          if (!cls) {
            skipped_unclassified++;
            continue;
          }
          const raw = arcgisLineRaw(f.geometry);
          if (!raw) {
            skipped_bad_geometry++;
            continue;
          }
          // Reproject EPSG:2926 (US survey feet) → EPSG:4326 (WGS84).
          let coords: [number, number][];
          try {
            coords = raw.map(([x, y]) => reproject2926to4326(x, y));
          } catch {
            skipped_reproject_error++;
            continue;
          }
          features_reprojected++;
          // Validate every reprojected vertex lands inside Bellevue.
          let allValid = true;
          for (const [lng, lat] of coords) {
            if (!inBbox(lng, lat, bbox)) { allValid = false; break; }
          }
          if (!allValid) {
            skipped_bad_geometry++;
            continue;
          }
          features_after_bbox++;
          lines.push({
            restriction_code: cls.code,
            priority: cls.priority,
            stname: a.main_street ? String(a.main_street).trim() : null,
            time_start: null,
            time_end: null,
            days_of_week: [0, 1, 2, 3, 4, 5, 6],
            permit_zone: null,
            time_limit_minutes: null,
            notes: `Bellevue curb typology (${cls.reason}, side=${a.side_of_street ?? "?"}, BelRed)`,
            geometry: JSON.stringify({ type: "LineString", coordinates: coords }),

          });
        }

        if (!json.exceededTransferLimit || feats.length < PAGE_SIZE) break;
        offset += feats.length;
      }
    } catch (e) {
      return {
        segments_touched: 0,
        rules_inserted: 0,
        polygons_fetched: features_fetched,
        error: `Bellevue curb fetch failed: ${(e as Error).message}`,
      };
    }

    if (lines.length === 0) {
      const msg =
        features_fetched > 0 && features_after_bbox === 0
          ? `Bellevue curb reprojection produced no in-bbox features: fetched=${features_fetched}, reprojected=${features_reprojected}, in_bbox=0.`
          : "no curb typology features matched";
      return {
        segments_touched: 0,
        rules_inserted: 0,
        polygons_fetched: features_fetched,
        error: features_fetched > 0 && features_after_bbox === 0 ? msg : undefined,
        diagnostics: {
          lines_input: features_fetched,
          lines_parsed: features_after_bbox,
          features_reprojected,
          skipped_neighborhood,
          skipped_unclassified,
          skipped_bad_geometry,
          skipped_reproject_error,
          matched_segments: 0,
          rows_updated: 0,
          unmatched_lines: features_fetched,
          timeout_stage: features_after_bbox === 0 ? "no-in-bbox" : "no-rows",
          rpc_error: features_after_bbox === 0 ? msg : undefined,
        },
      };
    }


    const t0 = Date.now();
    const { data, error } = await ctx.admin.rpc("apply_curb_zone_polyline_overlay", {
      p_city_id: ctx.cityId,
      p_provider: "bellevue-curb",
      p_lines: lines,
      p_max_meters: SNAP_METERS,
      p_wipe_existing: "replace",
    });
    const wallMs = Date.now() - t0;

    if (error) {
      const msg = (error as { message?: string }).message ?? "curb overlay RPC failed";
      return {
        segments_touched: 0,
        rules_inserted: 0,
        polygons_fetched: features_fetched,
        error: msg,
        diagnostics: {
          lines_input: features_fetched,
          lines_parsed: features_after_bbox,
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
    return {
      segments_touched: num("segments_touched"),
      rules_inserted: num("rules_inserted"),
      polygons_fetched: features_fetched,
      diagnostics: {
        lines_input: num("lines_input") || features_fetched,
        lines_parsed: num("lines_parsed") || features_after_bbox,
        features_reprojected,
        skipped_neighborhood,
        skipped_unclassified,
        skipped_bad_geometry,
        skipped_reproject_error,
        candidate_pairs: num("candidate_pairs"),
        matched_segments: num("matched_segments"),
        unmatched_lines: num("unmatched_lines") || (features_after_bbox - num("matched_segments")),
        rows_updated: num("rows_updated"),
        ms_total: num("ms_total") || wallMs,
        timeout_stage: "done",
      },
    };
  },
};

export const __debugBellevueCurbSkipCounters = "exported for diagnostics scripts only";
