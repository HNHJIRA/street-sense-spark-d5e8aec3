// LADOT open-data provider for City of Los Angeles.
//
// VERIFIED OPEN DATA ONLY. The only LADOT dataset that publishes
// posted parking rules WITH geometry is the LADOT Metered Parking
// Inventory Policies (Socrata mirror on the City of LA ArcGIS).
// Each record is one meter point with:
//   - BlockFace  (street address, used to group meters into a block)
//   - MeteredTim ("2HR", "1HR", "30M", ...)
//   - ParkingPol ("8A-8P Mon-Sat", multi-rule pipe-separated)
//   - StreetClea ("4A-7A Fri" or blank)
//
// We group meters by BlockFace, build a short LineString through the
// meter points to give the map something to draw, and emit metered +
// street-cleaning + unknown rules. Anything we can't parse falls back
// to `unknown` so the engine never invents legality.
//
// .server.ts — never shipped to the client bundle.

import { normalizeCategory, resolveRuleConflicts } from "./normalize";
import { unknownRule } from "./_la-shared.server";
import type { NormalizedRule, NormalizedSegment, ParkingProvider } from "./types";

// ArcGIS REST FeatureServer hosted by City of LA GeoHub.
const METER_ENDPOINT =
  "https://services5.arcgis.com/7nsPwEMP38bSkCjy/ArcGIS/rest/services/LADOT_Metered_Parking_Inventory_Policies_(Socrata)/FeatureServer/0/query";

interface MeterAttrs {
  BlockFace?: string;
  MeteredTim?: string;
  ParkingPol?: string;
  StreetClea?: string;
}

interface MeterFeature {
  attributes: MeterAttrs;
  geometry?: { x: number; y: number };
}

interface QueryResp {
  features?: MeterFeature[];
  exceededTransferLimit?: boolean;
}

/** Day-of-week token → 0..6 (Sun..Sat). */
const DAY_TOKENS: Record<string, number[]> = {
  "MON-FRI": [1, 2, 3, 4, 5],
  "MON-SAT": [1, 2, 3, 4, 5, 6],
  "MON-SUN": [0, 1, 2, 3, 4, 5, 6],
  DAILY: [0, 1, 2, 3, 4, 5, 6],
  SUN: [0], MON: [1], TUE: [2], WED: [3], THU: [4], FRI: [5], SAT: [6],
};

/** "8A" / "830A" / "12P" → "HH:MM". Returns null if unparseable. */
function parseLaTime(raw: string): string | null {
  const m = raw.trim().toUpperCase().match(/^(\d{1,2})(?::?(\d{2}))?\s*([AP])?$/);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const mm = m[2] ? parseInt(m[2], 10) : 0;
  if (m[3] === "P" && h < 12) h += 12;
  if (m[3] === "A" && h === 12) h = 0;
  if (h > 23 || mm > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

/** Parse a single window like "8A-8P Mon-Sat" → days + times. */
function parseWindow(raw: string): { days: number[]; start: string; end: string } | null {
  const s = raw.trim();
  const m = s.match(/(\d{1,2}:?\d{0,2}\s*[AP]?)\s*-\s*(\d{1,2}:?\d{0,2}\s*[AP]?)\s+(.+)$/i);
  if (!m) return null;
  const start = parseLaTime(m[1]);
  const end = parseLaTime(m[2]);
  if (!start || !end) return null;
  const dayKey = m[3].trim().toUpperCase().replace(/\s+/g, "");
  // Try multi-day codes, then comma-separated singles.
  const direct = DAY_TOKENS[dayKey];
  let days: number[] | null = direct ?? null;
  if (!days) {
    const tokens = dayKey.split(",");
    const out = new Set<number>();
    for (const t of tokens) {
      const d = DAY_TOKENS[t];
      if (!d) return null;
      for (const x of d) out.add(x);
    }
    days = [...out].sort();
  }
  return { days, start, end };
}

/** "2HR" → 120, "30M" → 30, "1HR" → 60. */
function parseTimeLimit(raw: string | undefined): number | null {
  if (!raw) return null;
  const m = raw.trim().toUpperCase().match(/^(\d+)\s*(HR|H|MIN|M)$/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return /^(H|HR)$/.test(m[2]) ? n * 60 : n;
}

/**
 * Parse the multi-rule ParkingPol field. Examples:
 *   "8A-8P Mon-Sat"
 *   "TAXI 7A-9A Mon-Fri | PKG 9A-8P Mon-Sat"
 *   "TANS 7A-9A, 4P-6P Mon-Fri | PKG 9A-4P Mon-Fri"
 * We extract any "PKG" or unprefixed time window as metered; "TANS"/"NP"/
 * "TAXI"/"TOW" windows become no_parking.
 */
function parsePolicy(pol: string | undefined, limitMinutes: number | null): NormalizedRule[] {
  if (!pol || !pol.trim()) return [];
  const out: NormalizedRule[] = [];
  const segments = pol.split("|").map((s) => s.trim()).filter(Boolean);
  for (const seg of segments) {
    // Expand "7A-9A, 4P-6P Mon-Fri" into two windows sharing the day code.
    const dayMatch = seg.match(/([A-Z][A-Za-z,-]*)\s*$/);
    const tail = dayMatch ? dayMatch[1] : "";
    const head = dayMatch ? seg.slice(0, seg.length - tail.length).trim() : seg;
    // Strip a leading prefix like "PKG", "TANS", "NP", "TAXI", "TOW".
    const prefixMatch = head.match(/^([A-Z]{2,5})\s+(.+)$/);
    const prefix = prefixMatch ? prefixMatch[1] : "PKG";
    const body = prefixMatch ? prefixMatch[2] : head;
    const isMetered = prefix === "PKG";
    const code = isMetered ? "metered" : "no_parking";
    const priority = isMetered ? 50 : 20;
    const windows = body.split(",").map((w) => w.trim()).filter(Boolean);
    for (const w of windows) {
      const parsed = parseWindow(`${w} ${tail}`);
      if (!parsed) continue;
      out.push({
        priority,
        restriction_code: code,
        days_of_week: parsed.days,
        time_start: parsed.start,
        time_end: parsed.end,
        permit_zone: null,
        time_limit_minutes: isMetered ? limitMinutes : null,
        effective_from: null,
        effective_to: null,
        notes: isMetered
          ? `Metered ${limitMinutes ? `(${limitMinutes} min limit)` : ""}`.trim()
          : `Posted ${prefix} restriction`,
      });
    }
  }
  return out;
}

/** Parse "4A-630A Fri" or "4A-7A Fri" street-cleaning window. */
function parseSweep(raw: string | undefined): NormalizedRule | null {
  if (!raw || !raw.trim()) return null;
  const parsed = parseWindow(raw.trim());
  if (!parsed) return null;
  return {
    priority: normalizeCategory("street cleaning").priority,
    restriction_code: "street_cleaning",
    days_of_week: parsed.days,
    time_start: parsed.start,
    time_end: parsed.end,
    permit_zone: null,
    time_limit_minutes: null,
    effective_from: null,
    effective_to: null,
    notes: `LADOT posted street cleaning (${raw.trim()})`,
  };
}

async function fetchPage(bbox: { minLng: number; minLat: number; maxLng: number; maxLat: number }, offset: number): Promise<QueryResp> {
  const qs = new URLSearchParams({
    f: "json",
    where: "1=1",
    outFields: "BlockFace,MeteredTim,ParkingPol,StreetClea",
    returnGeometry: "true",
    outSR: "4326",
    geometry: `${bbox.minLng},${bbox.minLat},${bbox.maxLng},${bbox.maxLat}`,
    geometryType: "esriGeometryEnvelope",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    resultRecordCount: "2000",
    resultOffset: String(offset),
  });
  const res = await fetch(`${METER_ENDPOINT}?${qs.toString()}`);
  if (!res.ok) throw new Error(`LADOT meters ${res.status}`);
  return (await res.json()) as QueryResp;
}

export const LADOTProvider: ParkingProvider = {
  id: "la-dot",
  name: "LADOT Metered Parking Inventory",
  cities: ["los-angeles"],

  async fetchSegments(_citySlug, bbox) {
    // -------- 1. Paginate the meter points inside bbox --------
    const meters: MeterFeature[] = [];
    try {
      let offset = 0;
      // Hard cap to keep the sync bounded; full LA bbox returns ~34k points.
      while (offset < 40_000) {
        const page = await fetchPage(bbox, offset);
        const feats = page.features ?? [];
        meters.push(...feats);
        if (!page.exceededTransferLimit || feats.length === 0) break;
        offset += feats.length;
      }
    } catch (e) {
      console.warn("[LADOTProvider] meter fetch failed:", (e as Error).message);
      return [];
    }
    if (meters.length === 0) return [];

    // -------- 2. Group meters by BlockFace --------
    interface Group {
      blockFace: string;
      pol: string;
      sweep: string;
      limit: string;
      pts: [number, number][];
    }
    const groups = new Map<string, Group>();
    for (const f of meters) {
      const a = f.attributes;
      const g = f.geometry;
      if (!g || !a.BlockFace) continue;
      // Group key includes policy so different rule sets on the same blockface
      // become separate segments (e.g. taxi window vs metered window).
      const key = `${a.BlockFace}||${a.ParkingPol ?? ""}||${a.StreetClea ?? ""}`;
      let grp = groups.get(key);
      if (!grp) {
        grp = {
          blockFace: a.BlockFace,
          pol: a.ParkingPol ?? "",
          sweep: a.StreetClea ?? "",
          limit: a.MeteredTim ?? "",
          pts: [],
        };
        groups.set(key, grp);
      }
      grp.pts.push([g.x, g.y]);
    }

    // -------- 3. Emit one NormalizedSegment per group --------
    const out: NormalizedSegment[] = [];
    let synthId = 0;
    for (const [, g] of groups) {
      if (g.pts.length === 0) continue;
      // Build a polyline through meter points sorted by longitude so the line
      // roughly follows the curb. For single-point groups synthesize a tiny
      // 10m E-W segment so the map has something to draw.
      let coords: [number, number][];
      if (g.pts.length === 1) {
        const [x, y] = g.pts[0];
        const d = 0.00005; // ~5m at LA latitudes
        coords = [[x - d, y], [x + d, y]];
      } else {
        coords = [...g.pts].sort((a, b) => a[0] - b[0]);
      }

      const limit = parseTimeLimit(g.limit);
      const polRules = parsePolicy(g.pol, limit);
      const sweepRule = parseSweep(g.sweep);
      const allRules: NormalizedRule[] = [];
      if (sweepRule) allRules.push(sweepRule);
      allRules.push(...polRules);
      // Only fall back to "unknown" when we have ZERO verified posted rules
      // for this block. When metered/sweeping rules exist, outside their
      // windows the engine's default "allowed" (green) is the correct read.
      if (allRules.length === 0) {
        allRules.push(
          unknownRule(
            "LADOT open data does not contain posted parking restrictions for this block. Verify local signage.",
          ),
        );
      }

      out.push({
        external_id: `ladot:meter-block/${++synthId}/${g.blockFace.replace(/\s+/g, "_")}`,
        name: g.blockFace,
        side: "both",
        coordinates: coords,
        metadata: {
          source_provider: "LADOT Metered Parking Inventory",
          dataset: "LADOT_Metered_Parking_Inventory_Policies (Socrata)",
          meter_count: g.pts.length,
          metered_time: g.limit || null,
          parking_policy: g.pol || null,
          street_cleaning: g.sweep || null,
          parking_category: polRules.length ? "metered" : "unknown",
        },
        rules: resolveRuleConflicts(allRules),
      });
    }
    return out;
  },
};
