// Shared helpers for Los Angeles–region open-data providers.
// These providers only emit rules backed by VERIFIED open data. When posted
// restriction information is unavailable, segments carry an `unknown` rule
// so the engine renders an explicit UNKNOWN state rather than fabricating
// parking legality.

import type { NormalizedRule } from "./types";

/** Full-week, all-day "unknown — verify sign" rule. Lowest priority so any
 *  verified sweeping / permit / red-curb rule wins ahead of it. */
export function unknownRule(notes = "Open data does not contain posted parking restrictions for this segment."): NormalizedRule {
  return {
    priority: 900,
    restriction_code: "unknown",
    days_of_week: [0, 1, 2, 3, 4, 5, 6],
    time_start: null,
    time_end: null,
    permit_zone: null,
    time_limit_minutes: null,
    effective_from: null,
    effective_to: null,
    notes,
  };
}

/** Convert an ArcGIS REST FeatureServer JSON result into [lng,lat][] coords.
 *  Accepts both polylines (`paths`) and polygons (`rings`) in WGS84, picking
 *  the longest path/ring as the representative line. */
export function arcgisPolyline(geometry: unknown): [number, number][] {
  const g = geometry as { paths?: number[][][]; rings?: number[][][] } | null;
  const lines = g?.paths ?? g?.rings ?? [];
  if (!lines.length) return [];
  let longest = lines[0];
  for (const p of lines) if (p.length > longest.length) longest = p;
  return longest.map((c) => [Number(c[0]), Number(c[1])] as [number, number]);
}

export async function fetchArcgis(url: string, params: Record<string, string>) {
  const qs = new URLSearchParams({
    f: "json",
    outSR: "4326",
    where: "1=1",
    outFields: "*",
    returnGeometry: "true",
    ...params,
  });
  const res = await fetch(`${url}?${qs.toString()}`);
  if (!res.ok) throw new Error(`ArcGIS ${url} responded ${res.status}`);
  return (await res.json()) as { features?: Array<{ attributes: Record<string, unknown>; geometry?: unknown }> };
}

/** Parse common open-data day-of-week strings ("M-F", "Tuesday", "Mon, Wed") to
 *  the 0–6 (Sun..Sat) array the engine expects. */
export function parseDays(raw: string | null | undefined): number[] {
  if (!raw) return [0, 1, 2, 3, 4, 5, 6];
  const s = raw.toLowerCase();
  if (s.includes("m-f") || s.includes("weekday")) return [1, 2, 3, 4, 5];
  if (s.includes("daily") || s.includes("everyday")) return [0, 1, 2, 3, 4, 5, 6];
  const map: Record<string, number> = {
    sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
  };
  const out = new Set<number>();
  for (const k of Object.keys(map)) if (s.includes(k)) out.add(map[k]);
  return out.size ? [...out].sort() : [0, 1, 2, 3, 4, 5, 6];
}

/** Convert "8:00 AM" / "08:00" / "830" to "HH:MM" or null. */
export function parseTime(raw: string | number | null | undefined): string | null {
  if (raw == null || raw === "") return null;
  const s = String(raw).trim().toUpperCase();
  const m = s.match(/^(\d{1,2}):?(\d{2})?\s*(AM|PM)?$/);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const mm = m[2] ? parseInt(m[2], 10) : 0;
  if (m[3] === "PM" && h < 12) h += 12;
  if (m[3] === "AM" && h === 12) h = 0;
  if (h > 23 || mm > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}
