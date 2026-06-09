// Santa Monica Parking Meters provider.
// VERIFIED OPEN DATA: City of Santa Monica ArcGIS, Parking_Meters
// FeatureServer/0 (~6,174 points). Each point carries `rate`, `duration`
// (minutes), `timewindow` (e.g. "8AM-6PM Mon-Sat"), `meter_type`,
// `pole_status`, `area`, `sub_area`.
//
// We group points into block-faces using (area, sub_area) — both are
// already block-aligned in the SM dataset — and emit one segment per
// group with a "metered" rule that carries the parsed time window and
// time limit. If we can't parse the window we fall back to all-week and
// rely on the rule's time_limit_minutes for the legality color.
import { normalizeSide, resolveRuleConflicts } from "./normalize";
import { fetchArcgis, parseTime, parseDays } from "./_la-shared.server";
import type { NormalizedRule, NormalizedSegment, ParkingProvider } from "./types";

const ENDPOINT =
  "https://gis.santamonica.gov/server/rest/services/Parking_Meters/FeatureServer/0/query";

interface Attrs {
  objectid?: number;
  zone?: string;
  "geodata.csm.ParkingMeters_Project.area"?: string;
  area?: string;
  sub_area?: string;
  rate?: number | string;
  duration?: number | string;
  timewindow?: string;
  meter_type?: string;
  pole_status?: string;
}

interface Pt { x: number; y: number }

function keyFor(a: Attrs): string {
  const area = a.area ?? a["geodata.csm.ParkingMeters_Project.area"] ?? "?";
  return `${area}|${a.sub_area ?? "?"}`;
}

function parseWindow(raw: string | undefined): { start: string | null; end: string | null; days: number[] } {
  if (!raw) return { start: null, end: null, days: [0, 1, 2, 3, 4, 5, 6] };
  const parts = String(raw).split(/\s+/);
  // expect "8AM-6PM" "Mon-Sat" style
  const range = parts.find((p) => /\d.*[-–].*\d/.test(p));
  const dayPart = parts.filter((p) => p !== range).join(" ");
  let start: string | null = null, end: string | null = null;
  if (range) {
    const [s, e] = range.split(/[-–]/);
    start = parseTime(s);
    end = parseTime(e);
  }
  return { start, end, days: parseDays(dayPart || null) };
}

function parseMin(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

export const SantaMonicaMeterProvider: ParkingProvider = {
  id: "santa-monica-meters",
  name: "Santa Monica Parking Meters",
  cities: ["santa-monica"],

  async fetchSegments(_citySlug, bbox) {
    const groups = new Map<string, { pts: Pt[]; sample: Attrs }>();
    const PAGE = 2000;
    let offset = 0;
    let more = true;
    while (more) {
      const json = await fetchArcgis(ENDPOINT, {
        geometry: `${bbox.minLng},${bbox.minLat},${bbox.maxLng},${bbox.maxLat}`,
        geometryType: "esriGeometryEnvelope",
        inSR: "4326",
        spatialRel: "esriSpatialRelIntersects",
        resultRecordCount: String(PAGE),
        resultOffset: String(offset),
      }) as { features?: Array<{ attributes: Attrs; geometry?: Pt }>; exceededTransferLimit?: boolean };
      const feats = json.features ?? [];
      for (const f of feats) {
        const a = f.attributes;
        const g = f.geometry as Pt | undefined;
        if (!g || !Number.isFinite(g.x) || !Number.isFinite(g.y)) continue;
        const status = String(a.pole_status ?? "").toLowerCase();
        if (status && status.includes("remove")) continue;
        const k = keyFor(a);
        if (!groups.has(k)) groups.set(k, { pts: [], sample: a });
        groups.get(k)!.pts.push(g);
      }
      more = Boolean(json.exceededTransferLimit) && feats.length === PAGE;
      offset += feats.length;
      if (offset > 30000) break;
    }

    const out: NormalizedSegment[] = [];
    for (const [k, grp] of groups) {
      if (grp.pts.length < 2) continue;
      // Sort points west→east then north→south so the line is monotonic.
      const sorted = [...grp.pts].sort((a, b) => a.x - b.x || a.y - b.y);
      const coords = sorted.map((p) => [p.x, p.y] as [number, number]);
      const a = grp.sample;
      const limit = parseMin(a.duration);
      const win = parseWindow(a.timewindow);
      const meter: NormalizedRule = {
        priority: 50,
        restriction_code: "metered",
        days_of_week: win.days,
        time_start: win.start,
        time_end: win.end,
        permit_zone: null,
        time_limit_minutes: limit,
        effective_from: null,
        effective_to: null,
        notes: `Santa Monica meter${a.rate ? ` $${a.rate}` : ""}${limit ? ` (${limit} min limit)` : ""}${a.timewindow ? ` ${a.timewindow}` : ""}`.trim(),
      };
      // If there's also a time limit but no window, emit a time_limited rule for visibility.
      const extra: NormalizedRule[] = [];
      if (limit && !win.start && !win.end) {
        extra.push({
          priority: 60,
          restriction_code: "time_limited",
          days_of_week: [0, 1, 2, 3, 4, 5, 6],
          time_start: null, time_end: null,
          permit_zone: null, time_limit_minutes: limit,
          effective_from: null, effective_to: null,
          notes: `Posted ${limit}-minute time limit at meter`,
        });
      }
      out.push({
        external_id: `smgov:meter-block/${k.replace(/\W+/g, "_")}`,
        name: `Meters ${a.area ?? ""} ${a.sub_area ?? ""}`.trim() || `Meter block ${k}`,
        side: normalizeSide(null),
        coordinates: coords,
        metadata: {
          source_provider: "Santa Monica Parking Meters",
          dataset: "Parking_Meters/FeatureServer/0",
          area: a.area ?? null,
          sub_area: a.sub_area ?? null,
          rate: a.rate ?? null,
          meter_type: a.meter_type ?? null,
          time_window: a.timewindow ?? null,
          meter_count: grp.pts.length,
        },
        rules: resolveRuleConflicts([meter, ...extra]),
      });
    }
    return out;
  },
};
