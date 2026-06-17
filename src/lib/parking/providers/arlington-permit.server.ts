// Arlington Residential Permit Parking (RPP) — polyline overlay provider.
//
// VERIFIED OPEN DATA: Arlington County publishes RPP regulations as
// curb-aligned POLYLINES (one per block face) with attributes:
//   STNAME, RPP_ZONE, StartHour, EndHour, DaysOfTheWeek
//
// This provider:
//   1. Fetches all polylines in the bbox.
//   2. Parses days/hours into the canonical rule shape.
//   3. Calls `apply_permit_polyline_overlay` which snaps each line to nearby
//      street_segments (within a distance threshold) with optional street-name
//      matching, and inserts one `permit` rule per matched segment.
//
// Never creates segments. Never converts polylines into polygons.

import { fetchArcgis, parseTime } from "./_la-shared.server";
import type { OverlayContext, OverlayProvider, OverlayResult, SyncBbox } from "./types";

const ENDPOINT =
  "https://arlgis.arlingtonva.us/arcgis/rest/services/Open_Data/od_Permit_Parking/FeatureServer/0/query";

/** Distance (m) within which a curb-line is considered to belong to a segment. */
const SNAP_METERS = 15;

interface Attrs {
  OBJECTID?: number;
  STNAME?: string;
  RPP_ZONE?: string | number;
  StartHour?: string;
  EndHour?: string;
  DaysOfTheWeek?: string;
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

/** Parse Arlington `DaysOfTheWeek` strings like "Monday - Friday",
 *  "Mon, Wed, Fri", "Daily" into a 0..6 (Sun..Sat) array. */
function parseArlingtonDays(raw: string | null | undefined): number[] {
  if (!raw) return [1, 2, 3, 4, 5];
  const s = raw.trim().toLowerCase();
  if (!s) return [1, 2, 3, 4, 5];
  if (s.includes("daily") || s.includes("every day") || s.includes("all days")) {
    return [0, 1, 2, 3, 4, 5, 6];
  }
  if (s.includes("weekday")) return [1, 2, 3, 4, 5];
  if (s.includes("weekend")) return [0, 6];

  // Range form: "monday - friday", "mon-fri", "tue – thu"
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
    return out;
  }

  // List form: "mon, wed, fri"
  const out = new Set<number>();
  for (const tok of s.split(/[,\s/]+/)) {
    const cleaned = tok.replace(/[^a-z]/g, "");
    if (DAY_NAMES[cleaned] != null) out.add(DAY_NAMES[cleaned]);
  }
  return out.size ? [...out].sort() : [1, 2, 3, 4, 5];
}

/** Take the longest ArcGIS path (polyline) and return a GeoJSON LineString. */
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

export const ArlingtonPermitOverlay: OverlayProvider = {
  kind: "overlay",
  id: "arlington-permit",
  name: "Arlington Residential Permit Parking",
  cities: ["arlington"],

  async applyOverlay(_citySlug: string, bbox: SyncBbox, ctx: OverlayContext): Promise<OverlayResult> {
    let json: { features?: Array<{ attributes: Attrs; geometry?: unknown }> } = {};
    try {
      json = await fetchArcgis(ENDPOINT, {
        geometry: `${bbox.minLng},${bbox.minLat},${bbox.maxLng},${bbox.maxLat}`,
        geometryType: "esriGeometryEnvelope",
        inSR: "4326",
        spatialRel: "esriSpatialRelIntersects",
        resultRecordCount: "2000",
      }) as typeof json;
    } catch (e) {
      throw new Error(`Arlington RPP fetch failed: ${(e as Error).message}`);
    }

    const lines: Array<{
      zone: string;
      stname: string | null;
      time_start: string | null;
      time_end: string | null;
      days_of_week: number[];
      geometry: string;
    }> = [];

    for (const f of json.features ?? []) {
      const a = f.attributes;
      const geo = arcgisLineToGeoJSON(f.geometry);
      if (!geo) continue;
      const zoneRaw = a.RPP_ZONE ?? a.OBJECTID;
      lines.push({
        zone: zoneRaw != null ? String(zoneRaw) : `RPP${a.OBJECTID ?? "?"}`,
        stname: a.STNAME ? String(a.STNAME).trim() : null,
        time_start: parseTime(a.StartHour),
        time_end: parseTime(a.EndHour),
        days_of_week: parseArlingtonDays(a.DaysOfTheWeek),
        geometry: JSON.stringify(geo),
      });
    }

    if (lines.length === 0) {
      return { segments_touched: 0, rules_inserted: 0, polygons_fetched: 0 };
    }

    const t0 = Date.now();
    const { data, error } = await ctx.admin.rpc("apply_permit_polyline_overlay", {
      p_city_id: ctx.cityId,
      p_provider: "arlington-permit",
      p_lines: lines,
      p_priority: 50,
      p_max_meters: SNAP_METERS,
      p_notes_prefix: "Arlington residential permit parking",
    });
    const wallMs = Date.now() - t0;

    if (error) {
      // Don't throw — surface the failure stage with diagnostics so the
      // admin UI can see WHERE the timeout/RPC error occurred.
      const msg = (error as { message?: string }).message ?? "polyline overlay RPC failed";
      return {
        segments_touched: 0,
        rules_inserted: 0,
        polygons_fetched: lines.length,
        error: msg,
        diagnostics: {
          lines_input: lines.length,
          lines_parsed: 0,
          candidate_pairs: 0,
          matched_segments: 0,
          unmatched_lines: lines.length,
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
      polygons_fetched: lines.length, // reuse field for "lines fetched"
      diagnostics: {
        lines_input: num("lines_input"),
        lines_parsed: num("lines_parsed"),
        candidate_pairs: num("candidate_pairs"),
        matched_segments: num("matched_segments"),
        unmatched_lines: num("unmatched_lines"),
        rows_updated: num("rows_updated"),
        ms_parse: num("ms_parse"),
        ms_match: num("ms_match"),
        ms_update: num("ms_update"),
        ms_total: num("ms_total") || wallMs,
        timeout_stage: String(row?.timeout_stage ?? "done"),
      },
    };
  },
};
