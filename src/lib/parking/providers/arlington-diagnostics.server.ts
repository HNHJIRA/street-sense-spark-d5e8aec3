// Read-only diagnostics for Arlington providers. Does not mutate the
// database and does not change provider business logic — it just re-hits
// the published Arlington open-data endpoints, exercises the same fetch +
// normalization paths the providers use, and reports per-stage counts so
// we can pinpoint where zero results come from.

import { ArlingtonProvider } from "./arlington.server";
import { ArlingtonPermitOverlay } from "./arlington-permit.server";
import { fetchArcgis } from "./_la-shared.server";
import type { SyncBbox } from "./types";

const CENTERLINE_ENDPOINT =
  "https://services1.arcgis.com/mVFRs7NF4iFitgbY/arcgis/rest/services/Street_Centerlines/FeatureServer/0/query";
const METER_ENDPOINT =
  "https://services1.arcgis.com/mVFRs7NF4iFitgbY/arcgis/rest/services/Parking_Meters/FeatureServer/0/query";
const RPP_ENDPOINT =
  "https://services1.arcgis.com/mVFRs7NF4iFitgbY/arcgis/rest/services/RPP_Districts/FeatureServer/0/query";

export interface ProviderDiagnostic {
  provider: string;
  dataset_url: string;
  geometry_type: string;
  features_fetched: number;
  features_after_bbox: number;
  segments_generated: number;
  rules_generated: number;
  sample_feature: unknown;
  error: string | null;
  notes: string;
}

function inBbox(x: number, y: number, b: SyncBbox) {
  return x >= b.minLng && x <= b.maxLng && y >= b.minLat && y <= b.maxLat;
}

async function probeArcgis(url: string, bbox: SyncBbox) {
  const json = await fetchArcgis(url, {
    geometry: `${bbox.minLng},${bbox.minLat},${bbox.maxLng},${bbox.maxLat}`,
    geometryType: "esriGeometryEnvelope",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    resultRecordCount: "2000",
  });
  return json.features ?? [];
}

function geomType(f: { geometry?: any } | undefined): string {
  const g = f?.geometry as any;
  if (!g) return "none";
  if (Array.isArray(g.paths)) return "polyline";
  if (Array.isArray(g.rings)) return "polygon";
  if (typeof g.x === "number" && typeof g.y === "number") return "point";
  return "unknown";
}

function bboxFilterCount(
  feats: Array<{ geometry?: any }>,
  bbox: SyncBbox,
  kind: string,
): number {
  let n = 0;
  for (const f of feats) {
    const g = f.geometry as any;
    if (!g) continue;
    if (kind === "point") {
      if (typeof g.x === "number" && typeof g.y === "number" && inBbox(g.x, g.y, bbox)) n++;
      continue;
    }
    const rings: number[][][] = g.paths ?? g.rings ?? [];
    let hit = false;
    outer: for (const r of rings) for (const c of r) {
      if (inBbox(Number(c[0]), Number(c[1]), bbox)) { hit = true; break outer; }
    }
    if (hit) n++;
  }
  return n;
}

export async function runArlingtonDiagnostics(bbox: SyncBbox): Promise<ProviderDiagnostic[]> {
  const out: ProviderDiagnostic[] = [];

  // ---------- arlington-opendata (centerlines + meters) ----------
  try {
    const centerFeats = await probeArcgis(CENTERLINE_ENDPOINT, bbox);
    let meterFeats: any[] = [];
    let meterErr: string | null = null;
    try { meterFeats = await probeArcgis(METER_ENDPOINT, bbox); }
    catch (e) { meterErr = (e as Error).message; }

    const cType = geomType(centerFeats[0]);
    const afterBbox = bboxFilterCount(centerFeats, bbox, cType);

    let segmentsGenerated = 0;
    let rulesGenerated = 0;
    let segErr: string | null = null;
    try {
      const segs = await ArlingtonProvider.fetchSegments("arlington", bbox);
      segmentsGenerated = segs.length;
      rulesGenerated = segs.reduce((s, x) => s + x.rules.length, 0);
    } catch (e) {
      segErr = (e as Error).message;
    }

    out.push({
      provider: "arlington-opendata",
      dataset_url: `${CENTERLINE_ENDPOINT} + ${METER_ENDPOINT}`,
      geometry_type: cType,
      features_fetched: centerFeats.length,
      features_after_bbox: afterBbox,
      segments_generated: segmentsGenerated,
      rules_generated: rulesGenerated,
      sample_feature: centerFeats[0] ?? null,
      error: segErr ?? meterErr,
      notes:
        `centerlines_fetched=${centerFeats.length}` +
        ` centerlines_in_bbox=${afterBbox}` +
        ` meters_fetched=${meterFeats.length}` +
        ` segments_generated=${segmentsGenerated}` +
        ` rules_generated=${rulesGenerated}` +
        (meterErr ? ` meter_error="${meterErr}"` : "") +
        (segErr ? ` segment_error="${segErr}"` : ""),
    });
  } catch (e) {
    out.push({
      provider: "arlington-opendata",
      dataset_url: CENTERLINE_ENDPOINT,
      geometry_type: "unknown",
      features_fetched: 0,
      features_after_bbox: 0,
      segments_generated: 0,
      rules_generated: 0,
      sample_feature: null,
      error: (e as Error).message,
      notes: `centerline_fetch_error="${(e as Error).message}"`,
    });
  }

  // ---------- arlington-permit (RPP polygons) ----------
  try {
    const rppFeats = await probeArcgis(RPP_ENDPOINT, bbox);
    const gType = geomType(rppFeats[0]);
    const afterBbox = bboxFilterCount(rppFeats, bbox, gType);
    void ArlingtonPermitOverlay; // reference to keep import meaningful
    out.push({
      provider: "arlington-permit",
      dataset_url: RPP_ENDPOINT,
      geometry_type: gType,
      features_fetched: rppFeats.length,
      features_after_bbox: afterBbox,
      // Overlay does not generate segments; rules are inserted by RPC on hit.
      segments_generated: 0,
      rules_generated: rppFeats.length, // upper bound (1 rule per polygon, applied by RPC)
      sample_feature: rppFeats[0] ?? null,
      error: null,
      notes:
        `rpp_polygons_fetched=${rppFeats.length}` +
        ` rpp_polygons_in_bbox=${afterBbox}` +
        ` geometry_type=${gType}`,
    });
  } catch (e) {
    out.push({
      provider: "arlington-permit",
      dataset_url: RPP_ENDPOINT,
      geometry_type: "unknown",
      features_fetched: 0,
      features_after_bbox: 0,
      segments_generated: 0,
      rules_generated: 0,
      sample_feature: null,
      error: (e as Error).message,
      notes: `rpp_fetch_error="${(e as Error).message}"`,
    });
  }

  return out;
}
