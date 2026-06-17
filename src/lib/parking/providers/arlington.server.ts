// Arlington County, Virginia — open-data provider.
//
// VERIFIED OPEN DATA: Arlington County GIS Hub (ArcGIS Online) publishes
// street centerlines and parking meter inventory through the County's
// ArcGIS REST services. This provider creates segments from street
// centerlines and attaches a `metered` rule to any segment whose
// representative geometry sits within ~12 m of an Arlington parking meter
// point. Anything not posted in open data carries the explicit
// `unknown` rule so the engine never invents legality.
//
// Endpoints (Arlington County ArcGIS):
//  - Street centerlines:
//      services1.arcgis.com/.../arcgis/rest/services/Street_Centerlines/FeatureServer/0
//  - Parking meter inventory:
//      services1.arcgis.com/.../arcgis/rest/services/Parking_Meters/FeatureServer/0
//
// If either endpoint changes URL, only the constants below need to move —
// the layer schemas are fetched generically with `outFields=*`.

import { normalizeSide, resolveRuleConflicts } from "./normalize";
import { arcgisPolyline, fetchArcgis, unknownRule } from "./_la-shared.server";
import type { NormalizedRule, NormalizedSegment, ParkingProvider } from "./types";

const CENTERLINE_ENDPOINT =
  "https://arlgis.arlingtonva.us/arcgis/rest/services/Open_Data/od_Street_Network/FeatureServer/0/query";
const METER_ENDPOINT =
  "https://arlgis.arlingtonva.us/arcgis/rest/services/Open_Data/od_Parking_Meter_Points/FeatureServer/0/query";

interface CenterlineAttrs {
  OBJECTID?: number;
  STREETNAME?: string;
  FULLNAME?: string;
  FULL_NAME?: string;
  STREET_NAME?: string;
  STNAME?: string;   // Arlington open-data: full street name (e.g. "N HARRISON ST")
  STRTNAME?: string; // Arlington open-data: base name (e.g. "HARRISON")
  FROMLEFT?: number;
  TOLEFT?: number;
  FROMRIGHT?: number;
  TORIGHT?: number;
}

interface MeterAttrs {
  OBJECTID?: number;
  METER_ID?: string | number;
  MeterID?: string;        // Arlington field name
  ZONE?: string;
  PricingZone?: string;    // Arlington field name
  RATE?: number | string;
  Rate?: number | string;  // Arlington field name
  TIME_LIMIT?: number | string;
  Hours?: string | number; // Arlington time-limit in hours
  TIMEWINDOW?: string;
  HOURS?: string;
}

interface PointGeom { x: number; y: number }

/** Approximate squared distance in degrees between two [lng,lat] points. */
function sqDistDeg(a: [number, number], b: [number, number]): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return dx * dx + dy * dy;
}

/** Roughly 12 m at Arlington's latitude (~38.9°N) expressed in squared degrees.
 *  1° lat ≈ 111 km, 1° lng ≈ 86 km here, so 12 m ≈ 1.1e-4° → squared ≈ 1.2e-8. */
const METER_SNAP_THRESHOLD_SQDEG = 1.5e-8;

function pickName(a: CenterlineAttrs): string {
  return (
    a.FULLNAME ||
    a.FULL_NAME ||
    a.STNAME ||
    a.STREETNAME ||
    a.STREET_NAME ||
    a.STRTNAME ||
    (a.OBJECTID != null ? `Arlington centerline ${a.OBJECTID}` : "Arlington street")
  );
}

function meterTimeLimitMinutes(a: MeterAttrs): number | null {
  // Arlington publishes time limit as hours in the `Hours` field
  // (e.g. "1" = 1 hour). Legacy `TIME_LIMIT` (minutes) is kept as fallback.
  const hours = Number(a.Hours);
  if (Number.isFinite(hours) && hours > 0) return Math.round(hours * 60);
  const n = Number(a.TIME_LIMIT);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

async function fetchAllPaginated<T>(
  endpoint: string,
  params: Record<string, string>,
): Promise<Array<{ attributes: T; geometry?: unknown }>> {
  const PAGE = 2000;
  let offset = 0;
  let more = true;
  const out: Array<{ attributes: T; geometry?: unknown }> = [];
  while (more) {
    const json = await fetchArcgis(endpoint, {
      ...params,
      resultRecordCount: String(PAGE),
      resultOffset: String(offset),
    }) as { features?: Array<{ attributes: T; geometry?: unknown }>; exceededTransferLimit?: boolean };
    const feats = json.features ?? [];
    out.push(...feats);
    more = !!json.exceededTransferLimit && feats.length > 0;
    offset += feats.length;
    if (offset > 50_000) break; // hard safety cap
  }
  return out;
}

export const ArlingtonProvider: ParkingProvider = {
  id: "arlington-opendata",
  name: "Arlington County Open Data",
  cities: ["arlington"],

  async fetchSegments(_citySlug, bbox) {
    const errors: string[] = [];

    // 1. Centerlines (segments)
    let centerlineFeats: Array<{ attributes: CenterlineAttrs; geometry?: unknown }> = [];
    try {
      centerlineFeats = await fetchAllPaginated<CenterlineAttrs>(CENTERLINE_ENDPOINT, {
        geometry: `${bbox.minLng},${bbox.minLat},${bbox.maxLng},${bbox.maxLat}`,
        geometryType: "esriGeometryEnvelope",
        inSR: "4326",
        spatialRel: "esriSpatialRelIntersects",
      });
    } catch (e) {
      errors.push(`centerlines: ${(e as Error).message}`);
    }

    // 2. Meters (point inventory) — optional. If this fails we still emit segments.
    let meterPts: Array<{ pt: [number, number]; a: MeterAttrs }> = [];
    try {
      const meterFeats = await fetchAllPaginated<MeterAttrs>(METER_ENDPOINT, {
        geometry: `${bbox.minLng},${bbox.minLat},${bbox.maxLng},${bbox.maxLat}`,
        geometryType: "esriGeometryEnvelope",
        inSR: "4326",
        spatialRel: "esriSpatialRelIntersects",
      });
      for (const f of meterFeats) {
        const g = f.geometry as PointGeom | undefined;
        if (!g || typeof g.x !== "number" || typeof g.y !== "number") continue;
        meterPts.push({ pt: [g.x, g.y], a: f.attributes });
      }
    } catch (e) {
      errors.push(`meters: ${(e as Error).message}`);
    }

    const out: NormalizedSegment[] = [];
    for (const f of centerlineFeats) {
      const a = f.attributes;
      if (a.OBJECTID == null) continue;
      const coords = arcgisPolyline(f.geometry);
      if (coords.length < 2) continue;

      // Find any meter point within snap threshold of any vertex.
      let matchedMeter: MeterAttrs | null = null;
      if (meterPts.length) {
        outer: for (const v of coords) {
          for (const m of meterPts) {
            if (sqDistDeg(v, m.pt) <= METER_SNAP_THRESHOLD_SQDEG) {
              matchedMeter = m.a;
              break outer;
            }
          }
        }
      }

      const rules: NormalizedRule[] = [];
      if (matchedMeter) {
        rules.push({
          priority: 40,
          restriction_code: "metered",
          days_of_week: [1, 2, 3, 4, 5, 6], // Mon–Sat: standard Arlington meter coverage
          time_start: "08:00",
          time_end: "18:00",
          permit_zone: null,
          time_limit_minutes: meterTimeLimitMinutes(matchedMeter),
          effective_from: null,
          effective_to: null,
          notes: `Arlington parking meter${matchedMeter.ZONE ? ` (zone ${matchedMeter.ZONE})` : ""}. Verify posted hours and rate; meter hours and free days vary by block.`,
        });
      }
      rules.push(
        unknownRule(
          "Arlington open data does not publish posted curb regulations (no-parking, time-limit, permit, tow-away) at the block level. Verify the on-street sign or use the AI Sign Scanner.",
        ),
      );

      out.push({
        external_id: `arlington:centerline/${a.OBJECTID}`,
        name: pickName(a),
        side: normalizeSide(null),
        coordinates: coords,
        metadata: {
          source_provider: "Arlington County Open Data",
          dataset: "Street_Centerlines",
          posted_restrictions: "unknown",
          has_meter: !!matchedMeter,
        },
        rules: resolveRuleConflicts(rules),
      });
    }

    if (out.length === 0 && errors.length) {
      throw new Error(`Arlington open data fetch failed: ${errors.join(" | ")}`);
    }
    return out;
  },
};
