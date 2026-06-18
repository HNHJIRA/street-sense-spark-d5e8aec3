// Bellevue Sign Status — point overlay provider (Phase 3B).
//
// VERIFIED OPEN DATA: City of Bellevue Enterprise Transportation MapServer
//   gis-web.bellevuewa.gov/gisext/rest/services/Enterprise/
//     Enterprise_Transportation/MapServer/137   (Sign Status, ~19,500 points)
//
// Each row is a single physical sign, identified by an MUTCD-style
// SignTypeDescription such as "R7-101_NO PARKING ANY TIME (PLAIN)".
// The City's own naming convention follows MUTCD: R7-* and R8-* are the
// authoritative parking sign series. We map ONLY parking-relevant codes
// that are explicitly encoded in the SignTypeDescription. We do not infer
// hours, days, permit zones, or restriction types from anything else.
//
// MUTCD → restriction_code mapping (only explicit, attribute-supported):
//
//   no_parking
//     R7-1   — NO PARKING ANY TIME W/ ARROW(S)
//     R7-2   — NO PARKING X:XX AM TO X:XX PM   (hours not parsed; conservative no_parking)
//     R7-101 — NO PARKING ANY TIME (PLAIN / MOD / L / R variants)
//     R7-201 — TOW AWAY ZONE
//     R7-202 — NO PARKING (VARIOUS TIMES AND DAYS)
//     R7-401 — NO PARKING STOP OR STAND
//     R8-1   — NO PARKING ON PAVEMENT
//     R8-3   — NO PARKING (and MOD/A variants)
//     R8-301 — NO PARK BEYOND THIS POINT
//     R8-4   — EMERGENCY PARKING ONLY (treated as no_parking for general public)
//     R8-8   — DO NOT STOP ON TRACKS
//
//   time_limited
//     R7-108 — XX HR PARKING X:XX AM TO X:XX PM  (hours not parsed; flagged time_limited only)
//
//   loading_zone
//     R7-6     — NO PARKING LOADING ZONE WITH ARROW
//     R7-10801 — LOADING ZONE (VARIOUS)
//
//   bus_zone
//     R7-107 — NO PARKING BUS STOP SYMBOL
//     R7-701 — NO PARKING BUS STOP
//
// Skipped (informational, not a restriction):
//     R7-10802 — PARALLEL PARKING ONLY  (advisory only)
//
// Not present in this inventory and therefore not mapped:
//     permit            (Bellevue permits live in RPZ layers 10/97 — not on signs here)
//     passenger_loading (white-curb attribute lives in painted-curbs layer 647)
//     taxi_zone         (no R7-/R8- code observed)
//
// Snap: each sign point is converted to a GeoJSON Point and snapped to the
// nearest Bellevue street_segment within SNAP_METERS via the existing
// apply_curb_zone_polyline_overlay RPC (its `geometry(Geometry,4326)` column
// accepts Point as well as LineString, and it already uses ST_DWithin/
// geography distance which works correctly for points).

import type {
  OverlayContext,
  OverlayProvider,
  OverlayResult,
  SyncBbox,
} from "./types";

const ENDPOINT =
  "https://gis-web.bellevuewa.gov/gisext/rest/services/Enterprise/Enterprise_Transportation/MapServer/137/query";

// Snap tolerance: 30m balances match rate against precision. Bellevue
// signs sit on poles set back from the curb, often across a sidewalk and
// planting strip from the centerline they apply to. At 18m we matched
// 31% (1111/3564); at 30m roughly 50%+ matches without picking up
// adjacent streets at typical block geometries.
const SNAP_METERS = 30;
const PAGE_SIZE = 2000;
const HARD_CAP = 50_000;
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

interface Attrs {
  OBJECTID?: number;
  SignTypeDescription?: string;
  Status?: string;
  OnStreet?: string;
  SideOfRoad?: string;
  Facing?: string;
}

interface Mapped {
  code: string;
  priority: number;
  reason: string;
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

// Match an R7-/R8- prefix at the start of SignTypeDescription, ignoring any
// (MOD), L, R suffixes. e.g. "R7-101(MOD)_..." → "R7-101".
function extractCode(desc: string): string | null {
  const m = desc.match(/^(R[78])-?(\d{1,4})/i);
  if (!m) return null;
  return `${m[1].toUpperCase()}-${m[2]}`;
}

function classify(desc: string): Mapped | null {
  const code = extractCode(desc);
  if (!code) return null;

  // Loading / bus must be checked before generic no_parking because some
  // R7-6 / R7-107 / R7-701 / R7-10801 codes literally read "NO PARKING".
  switch (code) {
    case "R7-6":
    case "R7-10801":
      return { code: "loading_zone", priority: 30, reason: code };
    case "R7-107":
    case "R7-701":
      return { code: "bus_zone", priority: 25, reason: code };
    case "R7-108":
      return { code: "time_limited", priority: 50, reason: code };
    case "R7-10802":
      return null; // advisory only — "parallel parking only", not a restriction
    case "R7-1":
    case "R7-2":
    case "R7-101":
    case "R7-201":
    case "R7-202":
    case "R7-401":
    case "R8-1":
    case "R8-3":
    case "R8-301":
    case "R8-4":
    case "R8-8":
      return { code: "no_parking", priority: 10, reason: code };
  }
  return null;
}

function inBbox(x: number, y: number, b: SyncBbox) {
  return x >= b.minLng && x <= b.maxLng && y >= b.minLat && y <= b.maxLat;
}

export const BellevueSignsOverlay: OverlayProvider = {
  kind: "overlay",
  id: "bellevue-signs",
  name: "Bellevue Sign Status (MUTCD)",
  cities: ["bellevue"],

  async applyOverlay(
    _citySlug: string,
    bbox: SyncBbox,
    ctx: OverlayContext,
  ): Promise<OverlayResult> {
    let signs_fetched = 0;
    let parking_signs = 0;
    let skipped_inactive = 0;
    let skipped_unclassified = 0;
    let skipped_bad_geometry = 0;
    const lines: Line[] = [];

    try {
      // Server-side prefilter: only R7-* and R8-* (parking sign series).
      const where = "SignTypeDescription LIKE 'R7%' OR SignTypeDescription LIKE 'R8%'";
      let offset = 0;
      while (offset < HARD_CAP) {
        const qs = new URLSearchParams({
          f: "json",
          where,
          outFields:
            "OBJECTID,SignTypeDescription,Status,OnStreet,SideOfRoad,Facing",
          returnGeometry: "true",
          outSR: "4326",
          resultRecordCount: String(PAGE_SIZE),
          resultOffset: String(offset),
          orderByFields: "OBJECTID",
        });
        const res = await fetch(`${ENDPOINT}?${qs.toString()}`);
        if (!res.ok) throw new Error(`ArcGIS responded ${res.status}`);
        const json = (await res.json()) as {
          features?: Array<{
            attributes: Attrs;
            geometry?: { x?: number; y?: number };
          }>;
          exceededTransferLimit?: boolean;
        };
        const feats = json.features ?? [];
        if (feats.length === 0) break;
        signs_fetched += feats.length;

        for (const f of feats) {
          const a = f.attributes;
          const desc = (a.SignTypeDescription ?? "").trim();
          if (!desc) {
            skipped_unclassified++;
            continue;
          }
          parking_signs++;

          const status = (a.Status ?? "").trim().toLowerCase();
          if (status && status !== "operating") {
            skipped_inactive++;
            continue;
          }

          const cls = classify(desc);
          if (!cls) {
            skipped_unclassified++;
            continue;
          }

          const g = f.geometry;
          if (!g || typeof g.x !== "number" || typeof g.y !== "number") {
            skipped_bad_geometry++;
            continue;
          }
          const x = Number(g.x);
          const y = Number(g.y);
          if (!Number.isFinite(x) || !Number.isFinite(y) || !inBbox(x, y, bbox)) {
            skipped_bad_geometry++;
            continue;
          }

          const stname = (a.OnStreet ?? "").trim() || null;
          const note =
            `Bellevue sign ${cls.reason} (${desc}` +
            (a.OnStreet ? `, ${a.OnStreet}` : "") +
            (a.SideOfRoad ? `, ${a.SideOfRoad} side` : "") +
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
            geometry: JSON.stringify({ type: "Point", coordinates: [x, y] }),
          });
        }

        if (!json.exceededTransferLimit || feats.length < PAGE_SIZE) break;
        offset += feats.length;
      }
    } catch (e) {
      return {
        segments_touched: 0,
        rules_inserted: 0,
        polygons_fetched: signs_fetched,
        error: `Bellevue signs fetch failed: ${(e as Error).message}`,
      };
    }

    if (lines.length === 0) {
      return {
        segments_touched: 0,
        rules_inserted: 0,
        polygons_fetched: signs_fetched,
        diagnostics: {
          signs_fetched,
          parking_signs,
          signs_classified: 0,
          skipped_inactive,
          skipped_unclassified,
          skipped_bad_geometry,
          matched_segments: 0,
          signs_matched: 0,
          rules_inserted: 0,
          unmatched_signs: parking_signs,
          timeout_stage: "no-signs",
        },
      };
    }

    const t0 = Date.now();
    const { data, error } = await ctx.admin.rpc("apply_curb_zone_polyline_overlay", {
      p_city_id: ctx.cityId,
      p_provider: "bellevue-signs",
      p_lines: lines,
      p_max_meters: SNAP_METERS,
      p_wipe_existing: "replace",
    });
    const wallMs = Date.now() - t0;

    if (error) {
      const msg =
        (error as { message?: string }).message ?? "signs overlay RPC failed";
      return {
        segments_touched: 0,
        rules_inserted: 0,
        polygons_fetched: signs_fetched,
        error: msg,
        diagnostics: {
          signs_fetched,
          parking_signs,
          signs_classified: lines.length,
          matched_segments: 0,
          signs_matched: 0,
          rules_inserted: 0,
          ms_total: wallMs,
          timeout_stage: /timeout/i.test(msg) ? "rpc-timeout" : "rpc-error",
          rpc_error: msg,
        },
      };
    }

    const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
    const num = (k: string) => Number((row?.[k] as number | string | undefined) ?? 0);
    const matched = num("matched_segments");
    const inserted = num("rules_inserted");
    return {
      segments_touched: num("segments_touched"),
      rules_inserted: inserted,
      polygons_fetched: signs_fetched,
      diagnostics: {
        signs_fetched,
        parking_signs,
        signs_classified: lines.length,
        skipped_inactive,
        skipped_unclassified,
        skipped_bad_geometry,
        candidate_pairs: num("candidate_pairs"),
        matched_segments: matched,
        signs_matched: matched,
        rules_inserted: inserted,
        unmatched_signs: Math.max(lines.length - matched, 0),
        rows_updated: num("rows_updated"),
        ms_total: num("ms_total") || wallMs,
        timeout_stage: "done",
      },
    };
  },
};
