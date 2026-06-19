// New York City — Parking Signs overlay (Phase 2A).
//
// VERIFIED OPEN DATA: NYC Open Data — Parking Regulation Locations and Signs
//   dataset id `nfid-uabd` (~440k Current rows citywide).
//   Owned by NYC DOT. Each row is a single authoritative parking sign
//   with sign_code (PS-* / SP-* / SI-*), sign_description (the literal
//   posted text), borough, on_street, side_of_street, and sign_x/y_coord
//   in NY State Plane Long Island ftUS (EPSG:2263).
//
// We classify ONLY by what the City explicitly publishes in
// sign_description text (the authoritative regulatory copy on the sign).
// We do NOT infer restrictions, days, or hours from anything else.
//
// Mapping (description-text driven; first match wins, in this order):
//
//   no_stopping       — /\bNO STOPPING\b/
//   bus_zone          — /\bBUS STOP\b/                   (must precede NO STANDING)
//   commercial_loading— /\bCOMMERCIAL VEHICLES? ONLY\b/  | /\bTRUCK LOADING\b/
//   taxi_zone         — /\bTAXI(?: STAND| ZONE)?\b/
//   loading_zone      — /\bLOADING (?:ONLY|ZONE)\b/      | /\bAUTHORIZED VEHICLES ONLY\b/
//   no_standing       — /\bNO STANDING\b/
//   no_parking        — /\bNO PARKING\b/
//   time_limited      — /\b\d+\s?HMP\b/                  | /\b\d+\s?HOUR\b/ | /\b\d+\s?MIN\b/
//                       (Hour Metered Parking — the sign caps duration)
//
// Skipped (advisory / informational, not a parking restriction):
//   "PAY-BY-CELL", "METERS ARE NOT IN EFFECT", "LOCATOR",
//   MTA bus destination panels, location/identifier panels (most SI-*),
//   and any row whose sign_description contains no rule pattern above.
//
// Snap: each sign point is reprojected from EPSG:2263 to WGS84, emitted
// as a GeoJSON Point, and snapped to the nearest NYC street_segment via
// the existing apply_curb_zone_polyline_overlay RPC. NYC blocks are short
// (~80m) and signs mount on the curb side, so 25m balances match rate
// against picking up the wrong street.

import proj4 from "proj4";
import type {
  OverlayContext,
  OverlayProvider,
  OverlayResult,
  SyncBbox,
} from "./types";

// Socrata JSON endpoint (not GeoJSON — sign coords are NY State Plane).
const ENDPOINT = "https://data.cityofnewyork.us/resource/nfid-uabd.json";

const NY_SP =
  "+proj=lcc +lat_1=40.66666666666666 +lat_2=41.03333333333333 " +
  "+lat_0=40.16666666666666 +lon_0=-74 +x_0=300000 +y_0=0 " +
  "+ellps=GRS80 +datum=NAD83 +units=us-ft +no_defs";
proj4.defs("EPSG:2263", NY_SP);

const PAGE_SIZE = 50_000; // Socrata supports up to 50k.
const HARD_CAP = 600_000; // dataset is ~440k Current + headroom.
const SNAP_METERS = 25;

interface Row {
  order_number?: string;
  record_type?: string;
  order_type?: string;
  borough?: string;
  on_street?: string;
  from_street?: string;
  to_street?: string;
  side_of_street?: string;
  sign_code?: string;
  sign_description?: string;
  sign_x_coord?: string;
  sign_y_coord?: string;
  arrow_direction?: string;
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

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

const DAY_NAME: Record<string, number> = {
  SUN: 0, SUNDAY: 0,
  MON: 1, MONDAY: 1,
  TUE: 2, TUES: 2, TUESDAY: 2,
  WED: 3, WEDNESDAY: 3,
  THU: 4, THUR: 4, THURS: 4, THURSDAY: 4,
  FRI: 5, FRIDAY: 5,
  SAT: 6, SATURDAY: 6,
};

function classify(descRaw: string): Mapped | null {
  const d = descRaw.toUpperCase();
  // Skip clearly advisory / informational rows.
  if (/\bPAY-BY-CELL\b|\bMETERS ARE NOT IN EFFECT\b|\bLOCATOR\b/.test(d)) return null;
  if (/\bDESTINATION PANEL\b|\bLOCATION PANEL\b|\bSTREET NAME\b/.test(d)) return null;

  if (/\bNO STOPPING\b/.test(d)) return { code: "no_stopping", priority: 5, reason: "NO STOPPING" };
  if (/\bBUS STOP\b/.test(d))    return { code: "bus_zone", priority: 25, reason: "BUS STOP" };
  if (/\bCOMMERCIAL VEHICLES?\b.*\bONLY\b/.test(d) || /\bTRUCK LOADING\b/.test(d))
    return { code: "commercial_loading", priority: 30, reason: "COMMERCIAL/TRUCK LOADING" };
  if (/\bTAXI\b/.test(d))        return { code: "taxi_zone", priority: 30, reason: "TAXI" };
  if (/\bLOADING (?:ONLY|ZONE)\b/.test(d) || /\bAUTHORIZED VEHICLES ONLY\b/.test(d))
    return { code: "loading_zone", priority: 30, reason: "LOADING" };
  if (/\bNO STANDING\b/.test(d)) return { code: "no_standing", priority: 8, reason: "NO STANDING" };
  if (/\bNO PARKING\b/.test(d))  return { code: "no_parking", priority: 10, reason: "NO PARKING" };
  if (/\b\d+\s?HMP\b/.test(d) || /\b\d+\s?HOUR\b/.test(d) || /\b\d+\s?MIN\b/.test(d))
    return { code: "time_limited", priority: 50, reason: "TIME LIMIT" };
  return null;
}

/** Parse a single time token like "8AM", "11:30AM", "1PM" → "HH:MM" (24h). */
function parseTime(tok: string): string | null {
  const m = tok.toUpperCase().match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/);
  if (!m) return null;
  let h = Number(m[1]);
  const mm = m[2] ? Number(m[2]) : 0;
  const ap = m[3];
  if (h < 1 || h > 12 || mm < 0 || mm > 59) return null;
  if (ap === "AM") { if (h === 12) h = 0; }
  else { if (h !== 12) h += 12; }
  return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

/** Pull "8AM-7PM" / "11:30AM-1PM" out of a description. First window wins. */
function parseWindow(desc: string): { start: string; end: string } | null {
  const m = desc.toUpperCase().match(
    /(\d{1,2}(?::\d{2})?\s*(?:AM|PM))\s*[-–]\s*(\d{1,2}(?::\d{2})?\s*(?:AM|PM))/,
  );
  if (!m) return null;
  const s = parseTime(m[1].replace(/\s+/g, ""));
  const e = parseTime(m[2].replace(/\s+/g, ""));
  if (!s || !e) return null;
  return { start: s, end: e };
}

/** Parse days. Supports MON-FRI ranges, lists, and EXCEPT SUNDAY. */
function parseDays(desc: string): number[] {
  const d = desc.toUpperCase();
  const tokens = Array.from(d.matchAll(/\b(SUN|MON|TUE|TUES|WED|THU|THUR|THURS|FRI|SAT)(?:DAY)?\b/g)).map(
    (m) => DAY_NAME[m[1]],
  );
  // Range form: "MONDAY-FRIDAY" / "MON-FRI"
  const range = d.match(
    /\b(SUN|MON|TUE|TUES|WED|THU|THUR|THURS|FRI|SAT)(?:DAY)?\s*[-–]\s*(SUN|MON|TUE|TUES|WED|THU|THUR|THURS|FRI|SAT)(?:DAY)?\b/,
  );
  if (range) {
    const a = DAY_NAME[range[1]];
    const b = DAY_NAME[range[2]];
    const out: number[] = [];
    for (let i = a; ; i = (i + 1) % 7) {
      out.push(i);
      if (i === b) break;
      if (out.length > 7) break;
    }
    return out;
  }
  // EXCEPT form: "EXCEPT SUNDAY"
  const except = Array.from(d.matchAll(/\bEXCEPT\s+(SUN|MON|TUE|TUES|WED|THU|THUR|THURS|FRI|SAT)(?:DAY)?\b/g)).map(
    (m) => DAY_NAME[m[1]],
  );
  if (except.length > 0 && tokens.length === except.length) {
    return ALL_DAYS.filter((x) => !except.includes(x));
  }
  if (tokens.length === 0) return ALL_DAYS;
  // De-dupe + sort
  return Array.from(new Set(tokens)).sort((a, b) => a - b);
}

/** Time-limit minutes from "2 HMP", "1 HOUR", "30 MIN", etc. */
function parseTimeLimit(desc: string): number | null {
  const d = desc.toUpperCase();
  const hmp = d.match(/\b(\d+)\s?HMP\b/);
  if (hmp) return Number(hmp[1]) * 60;
  const hr = d.match(/\b(\d+)\s?HOUR\b/);
  if (hr) return Number(hr[1]) * 60;
  const mn = d.match(/\b(\d+)\s?MIN\b/);
  if (mn) return Number(mn[1]);
  return null;
}

function inBbox(lng: number, lat: number, b: SyncBbox) {
  return lng >= b.minLng && lng <= b.maxLng && lat >= b.minLat && lat <= b.maxLat;
}

export const NycSignsOverlay: OverlayProvider = {
  kind: "overlay",
  id: "nyc-signs",
  name: "NYC Parking Signs (nfid-uabd)",
  cities: ["nyc"],

  async applyOverlay(
    _citySlug: string,
    bbox: SyncBbox,
    ctx: OverlayContext,
  ): Promise<OverlayResult> {
    let signs_fetched = 0;
    let parking_signs = 0;
    let skipped_unclassified = 0;
    let skipped_bad_geometry = 0;
    let skipped_inactive = 0;
    const histogram: Record<string, number> = {};
    const lines: Line[] = [];

    try {
      let offset = 0;
      while (offset < HARD_CAP) {
        const qs = new URLSearchParams({
          $select:
            "order_number,record_type,order_type,borough,on_street," +
            "side_of_street,sign_code,sign_description,sign_x_coord,sign_y_coord",
          $where: "record_type='Current' AND sign_x_coord IS NOT NULL AND sign_y_coord IS NOT NULL",
          $limit: String(PAGE_SIZE),
          $offset: String(offset),
          $order: "order_number,sign_code",
        });
        const res = await fetch(`${ENDPOINT}?${qs.toString()}`);
        if (!res.ok) {
          throw new Error(`nfid-uabd responded ${res.status}: ${(await res.text()).slice(0, 200)}`);
        }
        const rows = (await res.json()) as Row[];
        if (rows.length === 0) break;
        signs_fetched += rows.length;

        for (const r of rows) {
          if ((r.record_type ?? "").trim() !== "Current") {
            skipped_inactive++;
            continue;
          }
          const desc = (r.sign_description ?? "").trim();
          if (!desc) { skipped_unclassified++; continue; }

          const cls = classify(desc);
          if (!cls) { skipped_unclassified++; continue; }
          parking_signs++;

          const x = Number(r.sign_x_coord);
          const y = Number(r.sign_y_coord);
          if (!Number.isFinite(x) || !Number.isFinite(y)) { skipped_bad_geometry++; continue; }
          let lng: number, lat: number;
          try {
            const out = proj4("EPSG:2263", "EPSG:4326", [x, y]) as [number, number];
            lng = out[0]; lat = out[1];
          } catch {
            skipped_bad_geometry++; continue;
          }
          if (!Number.isFinite(lng) || !Number.isFinite(lat) || !inBbox(lng, lat, bbox)) {
            skipped_bad_geometry++; continue;
          }

          const code = (r.sign_code ?? "").trim();
          if (code) histogram[code] = (histogram[code] ?? 0) + 1;

          const window = parseWindow(desc);
          const days = parseDays(desc);
          const tlm = parseTimeLimit(desc);

          const stname = (r.on_street ?? "").trim() || null;
          const note =
            `NYC sign ${code || "?"} ${cls.reason}: "${desc.slice(0, 140)}"` +
            (r.borough ? ` (${r.borough}` : "") +
            (r.on_street ? `, ${r.on_street}` : "") +
            (r.side_of_street ? `, ${r.side_of_street} side` : "") +
            (r.borough || r.on_street || r.side_of_street ? ")" : "");

          lines.push({
            restriction_code: cls.code,
            priority: cls.priority,
            stname,
            time_start: window?.start ?? null,
            time_end: window?.end ?? null,
            days_of_week: days,
            permit_zone: null,
            time_limit_minutes: tlm,
            notes: note,
            geometry: JSON.stringify({ type: "Point", coordinates: [lng, lat] }),
          });
        }

        if (rows.length < PAGE_SIZE) break;
        offset += rows.length;
      }
    } catch (e) {
      return {
        segments_touched: 0,
        rules_inserted: 0,
        polygons_fetched: signs_fetched,
        error: `NYC signs fetch failed: ${(e as Error).message}`,
        diagnostics: {
          signs_fetched,
          parking_signs,
          signs_classified: lines.length,
          skipped_inactive,
          skipped_unclassified,
          skipped_bad_geometry,
          timeout_stage: "fetch-error",
        },
      };
    }

    const topCodes = Object.entries(histogram)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 25);

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
          neighborhood_counts: Object.fromEntries(topCodes),
        },
      };
    }

    const t0 = Date.now();
    const { data, error } = await ctx.admin.rpc("apply_curb_zone_polyline_overlay", {
      p_city_id: ctx.cityId,
      p_provider: "nyc-signs",
      p_lines: lines,
      p_max_meters: SNAP_METERS,
      p_wipe_existing: "replace",
    });
    const wallMs = Date.now() - t0;

    if (error) {
      const msg = (error as { message?: string }).message ?? "signs overlay RPC failed";
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
          neighborhood_counts: Object.fromEntries(topCodes),
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
        neighborhood_counts: Object.fromEntries(topCodes),
      },
    };
  },
};
