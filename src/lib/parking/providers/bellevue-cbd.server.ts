// Bellevue Downtown CBD curb regulations — polyline overlay provider.
//
// VERIFIED OPEN DATA: City of Bellevue Enterprise Transportation MapServer
//   gis-web.bellevuewa.gov/gisext/rest/services/Enterprise/
//     Enterprise_Transportation/MapServer/95   (140 polylines, downtown only)
//
// Schema: OBJECTID, PRK_TYPE (text label), polyline geometry in WGS84.
//
// Mapping (only EXPLICIT, currently-active restrictions are imported —
// "Proposed" entries are skipped because they are not enforceable today):
//
//   "<N> Hr Parking <start>-<end> Except Sundays & Holidays"
//        → time_limited, hours window, days Mon..Sat, time_limit = N*60
//   "No Parking <start>-<end> Except Sundays & Holidays"
//        → no_parking, hours window, days Mon..Sat
//   "<N> Min Load Zone" / "Shuttle Load Zone Only"
//   "<N> Min Passenger Load/Unload Only"
//        → loading_zone (always)
//   "Metro Layover Only"               → bus_zone (always)
//   "Charging Station for Electric Vehicles Only"
//   "Private Employer Shuttle Zone"    → no_parking (always; not general parking)
//   "Proposed ..."                      → SKIPPED
//
// Snapped to Bellevue street_segments via apply_curb_zone_polyline_overlay.

import type {
  OverlayContext,
  OverlayProvider,
  OverlayResult,
  SyncBbox,
} from "./types";

const ENDPOINT =
  "https://gis-web.bellevuewa.gov/gisext/rest/services/Enterprise/Enterprise_Transportation/MapServer/95/query";

const SNAP_METERS = 15;
const PAGE_SIZE = 2000;
const HARD_CAP = 5000;

interface Attrs {
  OBJECTID?: number;
  PRK_TYPE?: string;
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

const MON_SAT = [1, 2, 3, 4, 5, 6];
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

function parseHour(tok: string): string | null {
  // "7am", "12pm", "6pm"
  const m = tok.trim().toLowerCase().match(/^(\d{1,2})(am|pm)$/);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  if (h < 0 || h > 12) return null;
  if (m[2] === "pm" && h < 12) h += 12;
  if (m[2] === "am" && h === 12) h = 0;
  return `${String(h).padStart(2, "0")}:00`;
}

function parseHourRange(text: string): { start: string; end: string } | null {
  // "7am - 6pm" or "7am-6pm"
  const m = text.match(/(\d{1,2}\s*[ap]m)\s*[-–]\s*(\d{1,2}\s*[ap]m)/i);
  if (!m) return null;
  const start = parseHour(m[1].replace(/\s+/g, ""));
  const end = parseHour(m[2].replace(/\s+/g, ""));
  if (!start || !end) return null;
  return { start, end };
}

interface Mapped {
  code: string;
  priority: number;
  time_start: string | null;
  time_end: string | null;
  days_of_week: number[];
  time_limit_minutes: number | null;
  reason: string;
}

function classify(prkType: string | undefined): Mapped | null {
  if (!prkType) return null;
  const t = prkType.trim();
  if (!t) return null;
  if (/^proposed\b/i.test(t)) return null; // not enforceable

  // "<N> Hr Parking 7am - 6pm Except Sundays & Holidays"
  const hrMatch = t.match(/^(\d+)\s*Hr\s+Parking\s+(.*?)\s+Except/i);
  if (hrMatch) {
    const hours = parseInt(hrMatch[1], 10);
    const range = parseHourRange(hrMatch[2]);
    if (range) {
      return {
        code: "time_limited",
        priority: 60,
        time_start: range.start,
        time_end: range.end,
        days_of_week: MON_SAT,
        time_limit_minutes: hours * 60,
        reason: `${hours}-hour limit, ${range.start}-${range.end} Mon–Sat`,
      };
    }
  }

  // "No Parking 7am - 6pm Except Sundays & Holidays"
  const noParkMatch = t.match(/^No\s+Parking\s+(.*?)\s+Except/i);
  if (noParkMatch) {
    const range = parseHourRange(noParkMatch[1]);
    if (range) {
      return {
        code: "no_parking",
        priority: 20,
        time_start: range.start,
        time_end: range.end,
        days_of_week: MON_SAT,
        time_limit_minutes: null,
        reason: `no parking ${range.start}-${range.end} Mon–Sat`,
      };
    }
  }

  // Load zones (always-active)
  if (/load\s*zone|load\/?unload|passenger\s+load/i.test(t)) {
    return {
      code: "loading_zone",
      priority: 30,
      time_start: null,
      time_end: null,
      days_of_week: ALL_DAYS,
      time_limit_minutes: null,
      reason: t,
    };
  }

  if (/metro\s+layover/i.test(t)) {
    return {
      code: "bus_zone",
      priority: 28,
      time_start: null,
      time_end: null,
      days_of_week: ALL_DAYS,
      time_limit_minutes: null,
      reason: "Metro layover",
    };
  }

  if (/charging\s+station|electric\s+vehicles?\s+only|employer\s+shuttle/i.test(t)) {
    return {
      code: "no_parking",
      priority: 25,
      time_start: null,
      time_end: null,
      days_of_week: ALL_DAYS,
      time_limit_minutes: null,
      reason: t,
    };
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

export const BellevueCbdOverlay: OverlayProvider = {
  kind: "overlay",
  id: "bellevue-cbd",
  name: "Bellevue Downtown CBD Curb Regulations",
  cities: ["bellevue"],

  async applyOverlay(
    _citySlug: string,
    bbox: SyncBbox,
    ctx: OverlayContext,
  ): Promise<OverlayResult> {
    let features_fetched = 0;
    let features_after_bbox = 0;
    let skipped_proposed = 0;
    let skipped_unclassified = 0;
    let skipped_bad_geometry = 0;
    const lines: Line[] = [];

    try {
      let offset = 0;
      while (offset < HARD_CAP) {
        const qs = new URLSearchParams({
          f: "json",
          where: "1=1",
          outFields: "OBJECTID,PRK_TYPE",
          returnGeometry: "true",
          outSR: "4326",
          resultRecordCount: String(PAGE_SIZE),
          resultOffset: String(offset),
        });
        const res = await fetch(`${ENDPOINT}?${qs.toString()}`);
        if (!res.ok) {
          throw new Error(`ArcGIS responded ${res.status}`);
        }
        const json = (await res.json()) as {
          features?: Array<{ attributes: Attrs; geometry?: unknown }>;
          exceededTransferLimit?: boolean;
        };
        const feats = json.features ?? [];
        if (feats.length === 0) break;
        features_fetched += feats.length;

        for (const f of feats) {
          const a = f.attributes;
          const prk = (a.PRK_TYPE ?? "").toString();
          if (/^\s*proposed\b/i.test(prk)) {
            skipped_proposed++;
            continue;
          }
          const cls = classify(prk);
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
          lines.push({
            restriction_code: cls.code,
            priority: cls.priority,
            stname: null,
            time_start: cls.time_start,
            time_end: cls.time_end,
            days_of_week: cls.days_of_week,
            permit_zone: null,
            time_limit_minutes: cls.time_limit_minutes,
            notes: `Bellevue CBD: ${prk.trim()}`,
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
        error: `Bellevue CBD fetch failed: ${(e as Error).message}`,
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
      p_provider: "bellevue-cbd",
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
        skipped_proposed,
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
