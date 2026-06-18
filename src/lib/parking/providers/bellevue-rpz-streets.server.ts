// Bellevue Residential Permit Zone — STREET-level overlay provider.
//
// VERIFIED OPEN DATA: City of Bellevue Enterprise Transportation MapServer
//   gis-web.bellevuewa.gov/gisext/rest/services/Enterprise/
//     Enterprise_Transportation/MapServer/97  (118 polylines, RPZ-only)
//
// Schema: OBJECTID, RPZ_ID, Restriction (full-text rule), polyline geometry
// in WGS84. Each polyline is one block-face explicitly labelled with the
// hours of the residential permit restriction, e.g.
//   "No parking 8am to 6pm except Saturday, Sunday and Holidays"
//
// This complements bellevue-rpz (Layer 10, 16 zone polygons) by emitting
// finer-grained `permit` rules with parsed time-of-day windows directly
// from the published Restriction string. Snapped to street_segments via
// apply_permit_polyline_overlay.

import type {
  OverlayContext,
  OverlayProvider,
  OverlayResult,
  SyncBbox,
} from "./types";

const ENDPOINT =
  "https://gis-web.bellevuewa.gov/gisext/rest/services/Enterprise/Enterprise_Transportation/MapServer/97/query";

const SNAP_METERS = 15;
const PAGE_SIZE = 2000;
const HARD_CAP = 5000;

interface Attrs {
  OBJECTID?: number;
  RPZ_ID?: number;
  Restriction?: string;
}

interface Line {
  zone: string;
  stname: string | null;
  time_start: string | null;
  time_end: string | null;
  days_of_week: number[];
  geometry: string;
}

function parseHour(tok: string): string | null {
  const m = tok.trim().toLowerCase().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const mm = m[2] ? parseInt(m[2], 10) : 0;
  if (h < 0 || h > 23 || mm > 59) return null;
  if (m[3] === "pm" && h < 12) h += 12;
  if (m[3] === "am" && h === 12) h = 0;
  return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function parseRestriction(text: string): {
  time_start: string | null;
  time_end: string | null;
  days_of_week: number[];
} | null {
  const s = text.trim();
  if (!s) return null;

  // "<start> [to|-] <end>" — both with am/pm or end-only with am/pm
  const m = s.match(
    /(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s*(?:to|-|–|—)\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i,
  );
  if (!m) return null;
  let startTok = m[1].trim();
  const endTok = m[2].trim();
  // If start lacks am/pm, inherit from end ("8 to 6pm" → "8am-6pm").
  if (!/[ap]m/i.test(startTok) && /[ap]m/i.test(endTok)) {
    // Heuristic: "8 to 6pm" usually means morning→evening. Use AM if start<end-12.
    const endIsPm = /pm/i.test(endTok);
    const sNum = parseInt(startTok, 10);
    if (endIsPm && sNum < 12) startTok = `${startTok}am`;
    else startTok = `${startTok}${endIsPm ? "pm" : "am"}`;
  }
  const start = parseHour(startTok.replace(/\s+/g, ""));
  const end = parseHour(endTok.replace(/\s+/g, ""));
  if (!start || !end) return null;

  // Day window
  const lower = s.toLowerCase();
  let days: number[];
  if (/\bdaily\b|every\s*day/.test(lower)) {
    days = [0, 1, 2, 3, 4, 5, 6];
  } else if (/mon[\s-]*fri|monday\s*[-–]\s*friday|except\s+saturday/.test(lower)) {
    days = [1, 2, 3, 4, 5];
  } else if (/except\s+sunday/.test(lower) && !/saturday/.test(lower)) {
    days = [1, 2, 3, 4, 5, 6];
  } else {
    // Default safe assumption for permit: enforce Mon..Fri only.
    days = [1, 2, 3, 4, 5];
  }
  return { time_start: start, time_end: end, days_of_week: days };
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

export const BellevueRpzStreetsOverlay: OverlayProvider = {
  kind: "overlay",
  id: "bellevue-rpz-streets",
  name: "Bellevue RPZ Block-Face Restrictions",
  cities: ["bellevue"],

  async applyOverlay(
    _citySlug: string,
    bbox: SyncBbox,
    ctx: OverlayContext,
  ): Promise<OverlayResult> {
    let features_fetched = 0;
    let features_after_bbox = 0;
    let skipped_unparsable_restriction = 0;
    let skipped_bad_geometry = 0;
    const lines: Line[] = [];

    try {
      let offset = 0;
      while (offset < HARD_CAP) {
        const qs = new URLSearchParams({
          f: "json",
          where: "1=1",
          outFields: "OBJECTID,RPZ_ID,Restriction",
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
          const restrictionText = (a.Restriction ?? "").toString();
          const parsed = parseRestriction(restrictionText);
          if (!parsed) {
            skipped_unparsable_restriction++;
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
          const zone = a.RPZ_ID != null ? `RPZ${a.RPZ_ID}` : `RPZ-OBJ${a.OBJECTID ?? "?"}`;
          lines.push({
            zone,
            stname: null,
            time_start: parsed.time_start,
            time_end: parsed.time_end,
            days_of_week: parsed.days_of_week,
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
        error: `Bellevue RPZ-streets fetch failed: ${(e as Error).message}`,
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
          skipped_unparsable_restriction,
          skipped_bad_geometry,
          matched_segments: 0,
          rows_updated: 0,
          unmatched_lines: features_fetched,
          timeout_stage: "no-lines",
        },
      };
    }

    const t0 = Date.now();
    const { data, error } = await ctx.admin.rpc("apply_permit_polyline_overlay", {
      p_city_id: ctx.cityId,
      p_provider: "bellevue-rpz-streets",
      p_lines: lines,
      p_priority: 50,
      p_max_meters: SNAP_METERS,
      p_notes_prefix: "Bellevue RPZ block-face",
    });
    const wallMs = Date.now() - t0;

    if (error) {
      const msg = (error as { message?: string }).message ?? "polyline overlay RPC failed";
      return {
        segments_touched: 0,
        rules_inserted: 0,
        polygons_fetched: features_fetched,
        error: msg,
        diagnostics: {
          lines_input: features_fetched,
          lines_parsed: features_after_bbox,
          matched_segments: 0,
          unmatched_lines: features_after_bbox,
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
        skipped_unparsable_restriction,
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
