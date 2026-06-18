// Bellevue Painted Traffic Curbs — polyline overlay provider.
//
// VERIFIED OPEN DATA: City of Bellevue Enterprise Transportation MapServer
//   gis-web.bellevuewa.gov/gisext/rest/services/Enterprise/
//     Enterprise_Transportation/MapServer/647   (915 polylines, citywide)
//
// Schema includes: OBJECTID, Color (YELLOW/WHITE), CurbType
// (ISLAND / DUAL SLOPED C / C / EXTRUDED), OnStreet, FromXStreet,
// ToXStreet, SideofRoad, Status, geometry in EPSG:4326.
//
// Mapping (only EXPLICIT, directly attribute-supported colors):
//   YELLOW painted curb → loading_zone   (per Bellevue municipal practice)
//   WHITE  painted curb → passenger_loading
//   RED    painted curb → no_parking      (none present in current dataset)
//
// Conservative filters:
//   - CurbType = ISLAND  → SKIPPED. These are painted traffic islands /
//     medians, not blockface curbs. Snapping island geometry to the
//     nearest street segment would manufacture a parking restriction
//     where none is published.
//   - Status != 'Operating' → SKIPPED.
//
// Snapped to Bellevue street_segments via apply_curb_zone_polyline_overlay.

import type {
  OverlayContext,
  OverlayProvider,
  OverlayResult,
  SyncBbox,
} from "./types";

const ENDPOINT =
  "https://gis-web.bellevuewa.gov/gisext/rest/services/Enterprise/Enterprise_Transportation/MapServer/647/query";

const SNAP_METERS = 12;
const PAGE_SIZE = 2000;
const HARD_CAP = 5000;

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

interface Attrs {
  OBJECTID?: number;
  Color?: string;
  CurbType?: string;
  Status?: string;
  OnStreet?: string;
  FromXStreet?: string;
  ToXStreet?: string;
  SideofRoad?: string;
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

interface Mapped {
  code: string;
  priority: number;
  reason: string;
}

function classify(a: Attrs): Mapped | null {
  const color = (a.Color ?? "").trim().toUpperCase();
  if (!color) return null;
  if (color === "YELLOW") {
    return { code: "loading_zone", priority: 30, reason: "yellow painted curb" };
  }
  if (color === "WHITE") {
    return { code: "passenger_loading", priority: 28, reason: "white painted curb" };
  }
  if (color === "RED") {
    return { code: "no_parking", priority: 20, reason: "red painted curb" };
  }
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

export const BellevuePaintedCurbsOverlay: OverlayProvider = {
  kind: "overlay",
  id: "bellevue-painted-curbs",
  name: "Bellevue Painted Traffic Curbs",
  cities: ["bellevue"],

  async applyOverlay(
    _citySlug: string,
    bbox: SyncBbox,
    ctx: OverlayContext,
  ): Promise<OverlayResult> {
    let features_fetched = 0;
    let features_after_bbox = 0;
    let skipped_island = 0;
    let skipped_inactive = 0;
    let skipped_unclassified = 0;
    let skipped_bad_geometry = 0;
    const lines: Line[] = [];

    try {
      let offset = 0;
      while (offset < HARD_CAP) {
        const qs = new URLSearchParams({
          f: "json",
          where: "1=1",
          outFields:
            "OBJECTID,Color,CurbType,Status,OnStreet,FromXStreet,ToXStreet,SideofRoad",
          returnGeometry: "true",
          outSR: "4326",
          resultRecordCount: String(PAGE_SIZE),
          resultOffset: String(offset),
        });
        const res = await fetch(`${ENDPOINT}?${qs.toString()}`);
        if (!res.ok) throw new Error(`ArcGIS responded ${res.status}`);
        const json = (await res.json()) as {
          features?: Array<{ attributes: Attrs; geometry?: unknown }>;
          exceededTransferLimit?: boolean;
        };
        const feats = json.features ?? [];
        if (feats.length === 0) break;
        features_fetched += feats.length;

        for (const f of feats) {
          const a = f.attributes;
          const curbType = (a.CurbType ?? "").trim().toUpperCase();
          if (curbType === "ISLAND") {
            skipped_island++;
            continue;
          }
          const status = (a.Status ?? "").trim().toLowerCase();
          if (status && status !== "operating") {
            skipped_inactive++;
            continue;
          }
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
          let allValid = true;
          for (const [lng, lat] of raw) {
            if (!inBbox(lng, lat, bbox)) {
              allValid = false;
              break;
            }
          }
          if (!allValid) {
            skipped_bad_geometry++;
            continue;
          }
          features_after_bbox++;
          const stname = (a.OnStreet ?? "").trim() || null;
          const note =
            `Bellevue painted curb (${cls.reason}` +
            (curbType ? `, ${curbType}` : "") +
            (a.OnStreet ? `, ${a.OnStreet}` : "") +
            (a.SideofRoad ? `, ${a.SideofRoad} side` : "") +
            ")";
          lines.push({
            restriction_code: cls.code,
            priority: cls.priority,
            stname,
            time_start: null,
            time_end: null,
            days_of_week: ALL_DAYS,
            permit_zone: null,
            time_limit_minutes: null,
            notes: note,
            geometry: JSON.stringify({ type: "LineString", coordinates: raw }),
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
        error: `Bellevue painted curbs fetch failed: ${(e as Error).message}`,
      };
    }

    if (lines.length === 0) {
      return {
        segments_touched: 0,
        rules_inserted: 0,
        polygons_fetched: features_fetched,
        diagnostics: {
          lines_input: features_fetched,
          lines_parsed: features_after_bbox,
          matched_segments: 0,
          rows_updated: 0,
          unmatched_lines: features_fetched,
          timeout_stage: "no-lines",
        },
      };
    }

    const t0 = Date.now();
    const { data, error } = await ctx.admin.rpc("apply_curb_zone_polyline_overlay", {
      p_city_id: ctx.cityId,
      p_provider: "bellevue-painted-curbs",
      p_lines: lines,
      p_max_meters: SNAP_METERS,
      p_wipe_existing: "replace",
    });
    const wallMs = Date.now() - t0;

    if (error) {
      const msg =
        (error as { message?: string }).message ?? "curb overlay RPC failed";
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
        skipped_island,
        skipped_inactive,
        skipped_unclassified,
        skipped_bad_geometry,
        candidate_pairs: num("candidate_pairs"),
        matched_segments: num("matched_segments"),
        unmatched_lines:
          num("unmatched_lines") || features_after_bbox - num("matched_segments"),
        rows_updated: num("rows_updated"),
        ms_total: num("ms_total") || wallMs,
        timeout_stage: "done",
      },
    };
  },
};
