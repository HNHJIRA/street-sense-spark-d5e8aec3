// Read-only diagnostics for Bellevue providers. Hits the same Bellevue
// FeatureServer endpoints the providers use and surfaces per-stage counts
// so the admin UI can see why segment/rule counts look the way they do.

import { BellevueProvider } from "./bellevue.server";
import { fetchArcgis } from "./_la-shared.server";
import type { SyncBbox } from "./types";

const STREETS_ENDPOINT =
  "https://services1.arcgis.com/EYzEZbDhXZjURPbP/arcgis/rest/services/Streets/FeatureServer/10/query";
// Probed but NOT consumed: schema has no day-of-week / time-of-day fields.
const SWEEPING_ENDPOINT =
  "https://services1.arcgis.com/EYzEZbDhXZjURPbP/arcgis/rest/services/Arterial_Sweeping_Routes/FeatureServer/0/query";

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

// Paginate the same way BellevueProvider.fetchSegments does so diagnostics
// reflect the full dataset, not just the first 2,000-row page.
async function probeArcgis(url: string, bbox: SyncBbox) {
  const PAGE = 2000;
  const HARD_CAP = 50_000;
  const baseParams = {
    geometry: `${bbox.minLng},${bbox.minLat},${bbox.maxLng},${bbox.maxLat}`,
    geometryType: "esriGeometryEnvelope",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
  } as const;
  const out: Array<{ geometry?: unknown; attributes?: unknown }> = [];
  let offset = 0;
  let more = true;
  while (more) {
    const json = (await fetchArcgis(url, {
      ...baseParams,
      resultRecordCount: String(PAGE),
      resultOffset: String(offset),
    })) as {
      features?: Array<{ geometry?: unknown; attributes?: unknown }>;
      exceededTransferLimit?: boolean;
    };
    const feats = json.features ?? [];
    out.push(...feats);
    more = !!json.exceededTransferLimit && feats.length > 0;
    offset += feats.length;
    if (offset > HARD_CAP) break;
  }
  return out;
}

function geomType(f: { geometry?: unknown } | undefined): string {
  const g = f?.geometry as { paths?: unknown; rings?: unknown; x?: number; y?: number } | undefined;
  if (!g) return "none";
  if (Array.isArray(g.paths)) return "polyline";
  if (Array.isArray(g.rings)) return "polygon";
  if (typeof g.x === "number" && typeof g.y === "number") return "point";
  return "unknown";
}

function bboxFilterCount(
  feats: Array<{ geometry?: unknown }>,
  bbox: SyncBbox,
  kind: string,
): number {
  let n = 0;
  for (const f of feats) {
    const g = f.geometry as { x?: number; y?: number; paths?: number[][][]; rings?: number[][][] } | undefined;
    if (!g) continue;
    if (kind === "point") {
      if (typeof g.x === "number" && typeof g.y === "number" && inBbox(g.x, g.y, bbox)) n++;
      continue;
    }
    const rings = g.paths ?? g.rings ?? [];
    let hit = false;
    outer: for (const r of rings) {
      for (const c of r) {
        if (inBbox(Number(c[0]), Number(c[1]), bbox)) { hit = true; break outer; }
      }
    }
    if (hit) n++;
  }
  return n;
}

export async function runBellevueDiagnostics(bbox: SyncBbox): Promise<ProviderDiagnostic[]> {
  const out: ProviderDiagnostic[] = [];

  // ---------- bellevue-opendata (Streets centerlines) ----------
  try {
    const feats = await probeArcgis(STREETS_ENDPOINT, bbox);
    const gType = geomType(feats[0]);
    const afterBbox = bboxFilterCount(feats, bbox, gType);

    let segmentsGenerated = 0;
    let rulesGenerated = 0;
    let segErr: string | null = null;
    try {
      const segs = await BellevueProvider.fetchSegments("bellevue", bbox);
      segmentsGenerated = segs.length;
      rulesGenerated = segs.reduce((s, x) => s + x.rules.length, 0);
    } catch (e) {
      segErr = (e as Error).message;
    }

    out.push({
      provider: "bellevue-opendata",
      dataset_url: STREETS_ENDPOINT,
      geometry_type: gType,
      features_fetched: feats.length,
      features_after_bbox: afterBbox,
      segments_generated: segmentsGenerated,
      rules_generated: rulesGenerated,
      sample_feature: feats[0] ?? null,
      error: segErr,
      notes:
        `streets_fetched_first_page=${feats.length}` +
        ` streets_in_bbox=${afterBbox}` +
        ` segments_generated=${segmentsGenerated}` +
        ` rules_generated=${rulesGenerated}` +
        ` (full dataset ~10,629 polylines; paginated during sync)` +
        (segErr ? ` segment_error="${segErr}"` : ""),
    });
  } catch (e) {
    out.push({
      provider: "bellevue-opendata",
      dataset_url: STREETS_ENDPOINT,
      geometry_type: "unknown",
      features_fetched: 0,
      features_after_bbox: 0,
      segments_generated: 0,
      rules_generated: 0,
      sample_feature: null,
      error: (e as Error).message,
      notes: `streets_fetch_error="${(e as Error).message}"`,
    });
  }

  // ---------- arterial-sweeping (probe only — NOT a provider) ----------
  // Phase 2 result: schema carries `ArterialSweepingFrequencyCode` only
  // (values like "BikeHigh", "ArterialsMedium"). No day-of-week, no
  // time-of-day. Cannot be turned into a `street_cleaning` window without
  // inferring legality, which is out of scope.
  try {
    const feats = await probeArcgis(SWEEPING_ENDPOINT, bbox);
    const gType = geomType(feats[0]);
    const afterBbox = bboxFilterCount(feats, bbox, gType);
    out.push({
      provider: "bellevue-sweeping (probe)",
      dataset_url: SWEEPING_ENDPOINT,
      geometry_type: gType,
      features_fetched: feats.length,
      features_after_bbox: afterBbox,
      segments_generated: 0,
      rules_generated: 0,
      sample_feature: feats[0] ?? null,
      error: null,
      notes:
        "PROBE ONLY — not imported. Schema fields: " +
        "ArterialSweepingFrequencyCode (BikeHigh|ArterialsMedium|…), " +
        "FunctionClassDescription. No day-of-week, no time-of-day. " +
        "Refusing to infer a sweeping schedule from a frequency bucket alone.",
    });
  } catch (e) {
    out.push({
      provider: "bellevue-sweeping (probe)",
      dataset_url: SWEEPING_ENDPOINT,
      geometry_type: "unknown",
      features_fetched: 0,
      features_after_bbox: 0,
      segments_generated: 0,
      rules_generated: 0,
      sample_feature: null,
      error: (e as Error).message,
      notes: `sweeping_fetch_error="${(e as Error).message}"`,
    });
  }

  return out;
}
