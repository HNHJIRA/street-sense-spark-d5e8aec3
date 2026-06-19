// New York City — Parking Signs overlay (Phase 2A.1).
//
// Source: NYC Open Data — Parking Regulation Locations and Signs
//   dataset id `nfid-uabd` (~440k Current rows citywide).
//   sign_x_coord/sign_y_coord are NY State Plane Long Island ftUS (EPSG:2263).
//
// We classify ONLY by what the City explicitly publishes in
// sign_description text. We do NOT infer restrictions, days, or hours.
//
// Phase 2A.1: process borough-by-borough so each pass fits in the
// statement-timeout budget and progress is persisted to provider_health
// after every borough chunk. The first borough wipes existing nyc-signs
// rules ('replace'); subsequent boroughs append ('append').

import proj4 from "proj4";
import type {
  OverlayContext,
  OverlayProvider,
  OverlayResult,
  SyncBbox,
} from "./types";

const ENDPOINT = "https://data.cityofnewyork.us/resource/nfid-uabd.json";

const NY_SP =
  "+proj=lcc +lat_1=40.66666666666666 +lat_2=41.03333333333333 " +
  "+lat_0=40.16666666666666 +lon_0=-74 +x_0=300000 +y_0=0 " +
  "+ellps=GRS80 +datum=NAD83 +units=us-ft +no_defs";
proj4.defs("EPSG:2263", NY_SP);

const PAGE_SIZE = 50_000; // Socrata supports up to 50k.
const HARD_CAP_PER_BOROUGH = 200_000;
const SNAP_METERS = 25;

const BOROUGHS = ["M", "B", "Bx", "Q", "S"] as const;
const BOROUGH_LABEL: Record<string, string> = {
  M: "Manhattan",
  B: "Brooklyn",
  Bx: "Bronx",
  Q: "Queens",
  S: "Staten Island",
};

interface Row {
  order_number?: string;
  record_type?: string;
  borough?: string;
  on_street?: string;
  side_of_street?: string;
  sign_code?: string;
  sign_description?: string;
  sign_x_coord?: string;
  sign_y_coord?: string;
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

function parseDays(desc: string): number[] {
  const d = desc.toUpperCase();
  const tokens = Array.from(d.matchAll(/\b(SUN|MON|TUE|TUES|WED|THU|THUR|THURS|FRI|SAT)(?:DAY)?\b/g)).map(
    (m) => DAY_NAME[m[1]],
  );
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
  const except = Array.from(d.matchAll(/\bEXCEPT\s+(SUN|MON|TUE|TUES|WED|THU|THUR|THURS|FRI|SAT)(?:DAY)?\b/g)).map(
    (m) => DAY_NAME[m[1]],
  );
  if (except.length > 0 && tokens.length === except.length) {
    return ALL_DAYS.filter((x) => !except.includes(x));
  }
  if (tokens.length === 0) return ALL_DAYS;
  return Array.from(new Set(tokens)).sort((a, b) => a - b);
}

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

interface BoroughResult {
  borough: string;
  borough_label: string;
  signs_fetched: number;
  parking_signs: number;
  signs_classified: number;
  signs_matched: number;
  unmatched_signs: number;
  rules_inserted: number;
  segments_touched: number;
  ms_elapsed: number;
  error?: string;
}

async function processBorough(
  bcode: string,
  bbox: SyncBbox,
  ctx: OverlayContext,
  wipe: "replace" | "append",
  histogram: Record<string, number>,
  descSamples: Record<string, number>,
): Promise<BoroughResult> {
  const t0 = Date.now();
  let signs_fetched = 0;
  let parking_signs = 0;
  let skipped_unclassified = 0;
  let skipped_bad_geometry = 0;
  const lines: Line[] = [];

  let offset = 0;
  while (offset < HARD_CAP_PER_BOROUGH) {
    const qs = new URLSearchParams({
      $select:
        "order_number,record_type,borough,on_street,side_of_street," +
        "sign_code,sign_description,sign_x_coord,sign_y_coord",
      $where:
        `record_type='Current' AND borough='${bcode}' ` +
        `AND sign_x_coord IS NOT NULL AND sign_y_coord IS NOT NULL`,
      $limit: String(PAGE_SIZE),
      $offset: String(offset),
      $order: "order_number,sign_code",
    });
    const res = await fetch(`${ENDPOINT}?${qs.toString()}`);
    if (!res.ok) {
      return {
        borough: bcode,
        borough_label: BOROUGH_LABEL[bcode] ?? bcode,
        signs_fetched, parking_signs,
        signs_classified: lines.length,
        signs_matched: 0, unmatched_signs: 0, rules_inserted: 0,
        segments_touched: 0, ms_elapsed: Date.now() - t0,
        error: `nfid-uabd ${res.status}: ${(await res.text()).slice(0, 160)}`,
      };
    }
    const rows = (await res.json()) as Row[];
    if (rows.length === 0) break;
    signs_fetched += rows.length;

    for (const r of rows) {
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
      } catch { skipped_bad_geometry++; continue; }
      if (!Number.isFinite(lng) || !Number.isFinite(lat) || !inBbox(lng, lat, bbox)) {
        skipped_bad_geometry++; continue;
      }

      const code = (r.sign_code ?? "").trim();
      if (code) histogram[code] = (histogram[code] ?? 0) + 1;
      const descKey = desc.slice(0, 80).toUpperCase();
      descSamples[descKey] = (descSamples[descKey] ?? 0) + 1;

      const window = parseWindow(desc);
      const days = parseDays(desc);
      const tlm = parseTimeLimit(desc);

      lines.push({
        restriction_code: cls.code,
        priority: cls.priority,
        stname: (r.on_street ?? "").trim() || null,
        time_start: window?.start ?? null,
        time_end: window?.end ?? null,
        days_of_week: days,
        permit_zone: null,
        time_limit_minutes: tlm,
        notes:
          `NYC sign ${code || "?"} ${cls.reason}: "${desc.slice(0, 120)}" ` +
          `(${BOROUGH_LABEL[bcode] ?? bcode}` +
          (r.on_street ? `, ${r.on_street}` : "") +
          (r.side_of_street ? `, ${r.side_of_street}` : "") + ")",
        geometry: JSON.stringify({ type: "Point", coordinates: [lng, lat] }),
      });
    }

    if (rows.length < PAGE_SIZE) break;
    offset += rows.length;
  }

  if (lines.length === 0) {
    return {
      borough: bcode, borough_label: BOROUGH_LABEL[bcode] ?? bcode,
      signs_fetched, parking_signs,
      signs_classified: 0, signs_matched: 0, unmatched_signs: 0,
      rules_inserted: 0, segments_touched: 0,
      ms_elapsed: Date.now() - t0,
    };
  }

  const { data, error } = await ctx.admin.rpc("apply_curb_zone_polyline_overlay", {
    p_city_id: ctx.cityId,
    p_provider: "nyc-signs",
    p_lines: lines,
    p_max_meters: SNAP_METERS,
    p_wipe_existing: wipe,
  });

  if (error) {
    const msg = (error as { message?: string }).message ?? "RPC failed";
    return {
      borough: bcode, borough_label: BOROUGH_LABEL[bcode] ?? bcode,
      signs_fetched, parking_signs,
      signs_classified: lines.length,
      signs_matched: 0, unmatched_signs: lines.length,
      rules_inserted: 0, segments_touched: 0,
      ms_elapsed: Date.now() - t0,
      error: msg,
    };
  }

  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
  const num = (k: string) => Number((row?.[k] as number | string | undefined) ?? 0);
  const matched = num("matched_segments");
  const inserted = num("rules_inserted");
  return {
    borough: bcode,
    borough_label: BOROUGH_LABEL[bcode] ?? bcode,
    signs_fetched, parking_signs,
    signs_classified: lines.length,
    signs_matched: matched,
    unmatched_signs: Math.max(lines.length - matched, 0),
    rules_inserted: inserted,
    segments_touched: num("segments_touched"),
    ms_elapsed: Date.now() - t0,
  };
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
    // Optional borough filter via params (e.g. "M" or "M,B").
    const param = (ctx.params?.boroughs as string | undefined)?.trim();
    const boroughs = (param && param.length > 0
      ? param.split(",").map((s) => s.trim()).filter(Boolean)
      : [...BOROUGHS]
    ).filter((b) => (BOROUGHS as readonly string[]).includes(b));

    const histogram: Record<string, number> = {};
    const descSamples: Record<string, number> = {};
    const perBorough: BoroughResult[] = [];
    let firstError: string | undefined;
    let isFirst = true;

    // Detect prior nyc-signs rules: if param is supplied (validation run), do
    // NOT wipe; otherwise wipe on the first borough only.
    const wipeFirst = !param;

    for (const bcode of boroughs) {
      const wipe: "replace" | "append" = isFirst && wipeFirst ? "replace" : "append";
      const r = await processBorough(bcode, bbox, ctx, wipe, histogram, descSamples);
      perBorough.push(r);
      if (r.error && !firstError) firstError = `${r.borough_label}: ${r.error}`;

      // Persist incremental progress on provider_health.notes after each borough.
      try {
        const fromFn = (ctx.admin as { from?: (t: string) => any }).from;
        if (fromFn) {
          const note =
            `NYC signs progress (${perBorough.length}/${boroughs.length}): ` +
            perBorough.map((p) =>
              `${p.borough_label}=${p.rules_inserted}r/${p.signs_classified}c/${p.signs_fetched}f` +
              (p.error ? `[ERR]` : "")
            ).join(" | ");
          await fromFn("provider_health")
            .update({ notes: note.slice(0, 1000) })
            .eq("provider", "nyc-signs")
            .eq("city_id", ctx.cityId);
        }
      } catch { /* non-fatal */ }

      isFirst = false;
    }

    const totals = perBorough.reduce(
      (a, b) => ({
        signs_fetched: a.signs_fetched + b.signs_fetched,
        parking_signs: a.parking_signs + b.parking_signs,
        signs_classified: a.signs_classified + b.signs_classified,
        signs_matched: a.signs_matched + b.signs_matched,
        unmatched_signs: a.unmatched_signs + b.unmatched_signs,
        rules_inserted: a.rules_inserted + b.rules_inserted,
        segments_touched: a.segments_touched + b.segments_touched,
        ms_elapsed: a.ms_elapsed + b.ms_elapsed,
      }),
      { signs_fetched: 0, parking_signs: 0, signs_classified: 0, signs_matched: 0,
        unmatched_signs: 0, rules_inserted: 0, segments_touched: 0, ms_elapsed: 0 },
    );

    const topCodes = Object.entries(histogram)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 25);
    const topDescs = Object.entries(descSamples)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20);

    const result: OverlayResult = {
      segments_touched: totals.segments_touched,
      rules_inserted: totals.rules_inserted,
      polygons_fetched: totals.signs_fetched,
      diagnostics: {
        signs_fetched: totals.signs_fetched,
        parking_signs: totals.parking_signs,
        signs_classified: totals.signs_classified,
        signs_matched: totals.signs_matched,
        unmatched_signs: totals.unmatched_signs,
        rules_inserted: totals.rules_inserted,
        ms_total: totals.ms_elapsed,
        timeout_stage: firstError ? "borough-error" : "done",
        neighborhood_counts: Object.fromEntries(topCodes),
        // Stash extra reporting in neighborhood_counts-shaped fields:
        // top sign descriptions, per-borough rollup.
        ...({
          top_sign_descriptions: Object.fromEntries(topDescs),
          per_borough: perBorough,
          boroughs_processed: boroughs,
        } as Record<string, unknown>),
      },
    };
    if (firstError) result.error = firstError;
    return result;
  },
};
