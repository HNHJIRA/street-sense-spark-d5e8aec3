// Arlington County — Curb Management Data overlay (CDS-format).
//
// VERIFIED OPEN DATA. Arlington publishes a CurbLR/CDS-style dataset that
// covers ~132,000 curb-zone polylines countywide. Each row encodes one curb
// regulation: activity (parking | no parking | loading | no loading |
// standing | no standing), days_of_week, time_of_day_start/end, max_stay,
// rate, user_classes, and the polyline geometry of the curb itself.
//
// Source layer:
//   https://arlgis.arlingtonva.us/arcgis/rest/services/Project_Services/Curb_Management_Data/FeatureServer/0
//
// This provider:
//   1. Paginates the FeatureServer in the bbox (resultOffset / 2000 each).
//   2. Maps activity + user_classes + rate + max_stay → restriction_code
//      (allowed / no_parking / no_standing / loading_zone /
//      commercial_loading / passenger_loading / metered / permit /
//      time_limited / taxi_zone / bus_zone).
//   3. Calls `apply_curb_zone_polyline_overlay` in chunks of 5,000 lines to
//      snap each polyline to nearby street_segments within 15m and insert
//      one parking rule per match.
//
// Never creates segments. Never invents legality — every rule comes from a
// row published by Arlington County DES.

import { fetchArcgis, parseTime } from "./_la-shared.server";
import type { OverlayContext, OverlayProvider, OverlayResult, SyncBbox } from "./types";

const ENDPOINT =
  "https://arlgis.arlingtonva.us/arcgis/rest/services/Project_Services/Curb_Management_Data/FeatureServer/0/query";

const SNAP_METERS = 15;
const PAGE_SIZE = 2000;
const CHUNK_SIZE = 4000;        // lines per RPC call
const MAX_LINES = 60000;        // hard cap per sync to keep within request budget

interface Attrs {
  OBJECTID?: number;
  street_name?: string;
  street_side?: string;
  curb_policy_id?: string;
  activity?: string;
  user_classes?: string;
  max_stay?: number;
  max_stay_unit?: string;
  rate?: number;
  days_of_week?: string;
  time_of_day_start?: string;
  time_of_day_end?: string;
  num_spaces?: number;
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

const DAY_NAMES: Record<string, number> = {
  sun: 0, sunday: 0,
  mon: 1, monday: 1,
  tue: 2, tues: 2, tuesday: 2,
  wed: 3, weds: 3, wednesday: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4,
  fri: 5, friday: 5,
  sat: 6, saturday: 6,
};

function parseCdsDays(raw: string | null | undefined): number[] {
  if (!raw) return [0, 1, 2, 3, 4, 5, 6];
  const s = raw.trim().toLowerCase();
  if (!s || s === "%" || s === "*") return [0, 1, 2, 3, 4, 5, 6];
  if (s.includes("daily") || s.includes("every day") || s.includes("all days")) {
    return [0, 1, 2, 3, 4, 5, 6];
  }
  if (s.includes("weekday")) return [1, 2, 3, 4, 5];
  if (s.includes("weekend")) return [0, 6];
  const range = s.match(/([a-z]+)\s*[-–—]\s*([a-z]+)/);
  if (range && DAY_NAMES[range[1]] != null && DAY_NAMES[range[2]] != null) {
    const a = DAY_NAMES[range[1]];
    const b = DAY_NAMES[range[2]];
    const out: number[] = [];
    let d = a;
    for (let i = 0; i < 7; i++) {
      out.push(d);
      if (d === b) break;
      d = (d + 1) % 7;
    }
    return out.sort((x, y) => x - y);
  }
  const out = new Set<number>();
  for (const tok of s.split(/[,\s/]+/)) {
    const cleaned = tok.replace(/[^a-z]/g, "");
    if (DAY_NAMES[cleaned] != null) out.add(DAY_NAMES[cleaned]);
  }
  return out.size ? [...out].sort((x, y) => x - y) : [0, 1, 2, 3, 4, 5, 6];
}

function toMinutes(value: number | undefined, unit: string | undefined): number | null {
  if (!value || value <= 0) return null;
  const u = (unit ?? "minute").toLowerCase();
  if (u.startsWith("hour")) return Math.round(value * 60);
  if (u.startsWith("day")) return Math.round(value * 60 * 24);
  return Math.round(value);
}

function arcgisLineToGeoJSON(geometry: unknown): { type: "LineString"; coordinates: [number, number][] } | null {
  const g = geometry as { paths?: number[][][] } | null;
  const paths = g?.paths ?? [];
  if (!paths.length) return null;
  let longest = paths[0];
  for (const p of paths) if (p.length > longest.length) longest = p;
  if (longest.length < 2) return null;
  return {
    type: "LineString",
    coordinates: longest.map((c) => [Number(c[0]), Number(c[1])] as [number, number]),
  };
}

/**
 * Map a CDS curb-policy row → canonical restriction_code + priority.
 * Lower priority number wins in the engine, so explicit overrides
 * (no_parking, loading, metered) beat the broad allowed/time_limited rules.
 */
function classify(a: Attrs): { code: string; priority: number; permit_zone: string | null } | null {
  const act = (a.activity ?? "").trim().toLowerCase();
  const uc = (a.user_classes ?? "").trim().toLowerCase();
  const rate = Number(a.rate ?? 0);
  const maxStay = Number(a.max_stay ?? 0);

  // Bus / taxi sub-codes apply to both parking and no-parking rows.
  if (uc.includes("bus")) return { code: "bus_zone", priority: 40, permit_zone: null };
  if (uc.includes("taxi")) return { code: "taxi_zone", priority: 40, permit_zone: null };

  if (act === "no parking" || act === "no loading" || act === "no standing") {
    // user_classes describes the *reason* (fire hydrant, driveway, etc.) — kept in notes.
    return { code: act === "no standing" ? "no_standing" : "no_parking", priority: 30, permit_zone: null };
  }
  if (act === "loading") {
    if (uc.includes("commercial") || uc.includes("truck") || uc.includes("freight")) {
      return { code: "commercial_loading", priority: 40, permit_zone: null };
    }
    if (uc.includes("passenger") || uc.includes("psgr")) {
      return { code: "passenger_loading", priority: 40, permit_zone: null };
    }
    return { code: "loading_zone", priority: 40, permit_zone: null };
  }
  if (act === "standing") {
    return { code: "passenger_loading", priority: 40, permit_zone: null };
  }
  if (act === "parking") {
    if (uc.includes("permit") || uc.includes("rpp") || uc.match(/zone\s*\d/)) {
      const zone = (uc.match(/zone\s*(\d+)/) ?? [])[1] ?? null;
      return { code: "permit", priority: 50, permit_zone: zone };
    }
    if (rate > 0) return { code: "metered", priority: 40, permit_zone: null };
    if (maxStay > 0) return { code: "time_limited", priority: 60, permit_zone: null };
    // Verified, signed standard parking → first source of *green* segments for Arlington.
    return { code: "allowed", priority: 200, permit_zone: null };
  }
  return null; // 'other' / blank: skip, never fabricate.
}

async function fetchPage(bbox: SyncBbox, offset: number) {
  return await fetchArcgis(ENDPOINT, {
    geometry: `${bbox.minLng},${bbox.minLat},${bbox.maxLng},${bbox.maxLat}`,
    geometryType: "esriGeometryEnvelope",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    resultOffset: String(offset),
    resultRecordCount: String(PAGE_SIZE),
    orderByFields: "OBJECTID",
  }) as { features?: Array<{ attributes: Attrs; geometry?: unknown }> };
}

export const ArlingtonCurbOverlay: OverlayProvider = {
  kind: "overlay",
  id: "arlington-curb",
  name: "Arlington Curb Management Data",
  cities: ["arlington"],

  async applyOverlay(_citySlug: string, bbox: SyncBbox, ctx: OverlayContext): Promise<OverlayResult> {
    // -------- 1) Paginated fetch --------
    const lines: Line[] = [];
    const buckets: Record<string, number> = {};
    let pages = 0;
    let raw = 0;
    let skipped = 0;
    try {
      for (let off = 0; off < MAX_LINES; off += PAGE_SIZE) {
        const json = await fetchPage(bbox, off);
        const feats = json.features ?? [];
        pages++;
        raw += feats.length;
        if (feats.length === 0) break;
        for (const f of feats) {
          const geo = arcgisLineToGeoJSON(f.geometry);
          if (!geo) { skipped++; continue; }
          const cls = classify(f.attributes);
          if (!cls) { skipped++; continue; }
          buckets[cls.code] = (buckets[cls.code] ?? 0) + 1;
          const a = f.attributes;
          // CDS encodes "24/7" as time_of_day_start == time_of_day_end
          // (commonly "0"→"0" or "00:00"→"00:00"). parseTime maps both to
          // "00:00", which the engine's window check (hhmm < end) rejects
          // forever. Treat equal start/end as all-day so the rule fires.
          const tsRaw = parseTime(a.time_of_day_start) ?? null;
          const teRaw = parseTime(a.time_of_day_end) ?? null;
          const allDay =
            (tsRaw === null && teRaw === null) ||
            (tsRaw !== null && teRaw !== null && tsRaw === teRaw);
          lines.push({
            restriction_code: cls.code,
            priority: cls.priority,
            stname: a.street_name ? String(a.street_name).trim() : null,
            time_start: allDay ? null : tsRaw,
            time_end: allDay ? null : teRaw,
            days_of_week: parseCdsDays(a.days_of_week),
            permit_zone: cls.permit_zone,
            time_limit_minutes: toMinutes(a.max_stay, a.max_stay_unit),
            notes:
              `Arlington curb zone (${a.activity ?? "?"}` +
              (a.user_classes ? `, ${a.user_classes}` : "") +
              (a.num_spaces ? `, ~${a.num_spaces} spaces` : "") + ")",
            geometry: JSON.stringify(geo),
          });
        }
        if (feats.length < PAGE_SIZE) break;
      }
    } catch (e) {
      return {
        segments_touched: 0,
        rules_inserted: 0,
        polygons_fetched: raw,
        error: `Arlington curb fetch failed at offset ${pages * PAGE_SIZE}: ${(e as Error).message}`,
      };
    }

    if (lines.length === 0) {
      return { segments_touched: 0, rules_inserted: 0, polygons_fetched: raw };
    }

    // -------- 2) Chunked RPC --------
    let segments_touched = 0;
    let rules_inserted = 0;
    let candidate_pairs = 0;
    let matched_segments = 0;
    let rows_updated = 0;
    let ms_total = 0;
    let firstError: string | null = null;

    const t0 = Date.now();
    for (let i = 0; i < lines.length; i += CHUNK_SIZE) {
      const chunk = lines.slice(i, i + CHUNK_SIZE);
      const mode = i === 0 ? "replace" : "append";
      const { data, error } = await ctx.admin.rpc("apply_curb_zone_polyline_overlay", {
        p_city_id: ctx.cityId,
        p_provider: "arlington-curb",
        p_lines: chunk,
        p_max_meters: SNAP_METERS,
        p_wipe_existing: mode,
      });
      if (error) {
        firstError = firstError ?? (error as { message?: string }).message ?? "rpc failed";
        break;
      }
      const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
      const num = (k: string) => Number((row?.[k] as number | string | undefined) ?? 0);
      segments_touched = Math.max(segments_touched, num("segments_touched"));
      rules_inserted += num("rules_inserted");
      candidate_pairs += num("candidate_pairs");
      matched_segments += num("matched_segments");
      rows_updated += num("rows_updated");
      ms_total += num("ms_total");
    }
    const wallMs = Date.now() - t0;

    return {
      segments_touched,
      rules_inserted,
      polygons_fetched: raw,
      error: firstError ?? undefined,
      diagnostics: {
        lines_input: lines.length,
        lines_parsed: lines.length,
        candidate_pairs,
        matched_segments,
        unmatched_lines: Math.max(lines.length - matched_segments, 0),
        rows_updated,
        ms_total: ms_total || wallMs,
        timeout_stage: firstError ? "rpc-error" : "done",
        rpc_error: firstError ?? undefined,
      },
    };
  },
};

export const __debugArlingtonCurbBuckets = "exported for diagnostics scripts only";
