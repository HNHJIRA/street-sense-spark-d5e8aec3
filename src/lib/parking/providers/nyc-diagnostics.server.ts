// Read-only diagnostics for NYC providers (Phase 1 = centerline only).
// Mirrors bellevue-diagnostics: hits the same upstream the provider uses and
// surfaces per-stage counts so the admin UI can verify why segment/rule
// counts look the way they do.

import { fetchCsclGeoJson, NycCenterlineProvider } from "./nyc.server";
import type { SyncBbox } from "./types";

const CENTERLINE_DATASET_URL =
  "https://data.cityofnewyork.us/resource/inkn-q76z.geojson";

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

export async function runNycDiagnostics(bbox: SyncBbox): Promise<ProviderDiagnostic[]> {
  const out: ProviderDiagnostic[] = [];

  // ---------- nyc-centerline (CSCL via NYC Open Data) ----------
  try {
    const feats = await fetchCsclGeoJson(bbox);

    // Borough breakdown (boroughcode: 1=MN 2=BX 3=BK 4=QN 5=SI).
    const boroLabels: Record<string, string> = {
      "1": "Manhattan", "2": "Bronx", "3": "Brooklyn", "4": "Queens", "5": "Staten Island",
    };
    const boroCounts: Record<string, number> = {};
    for (const f of feats) {
      const b = String((f.properties ?? {}).boroughcode ?? "").trim();
      const label = boroLabels[b] ?? `boro_${b || "?"}`;
      boroCounts[label] = (boroCounts[label] ?? 0) + 1;
    }
    const boroSummary = Object.entries(boroCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k}=${v}`)
      .join(" ");

    let segmentsGenerated = 0;
    let rulesGenerated = 0;
    let segErr: string | null = null;
    try {
      const segs = await NycCenterlineProvider.fetchSegments("nyc", bbox);
      segmentsGenerated = segs.length;
      rulesGenerated = segs.reduce((s, x) => s + x.rules.length, 0);
    } catch (e) {
      segErr = (e as Error).message;
    }

    out.push({
      provider: "nyc-centerline",
      dataset_url: CENTERLINE_DATASET_URL,
      geometry_type: "polyline",
      features_fetched: feats.length,
      features_after_bbox: feats.length, // server-side $where already bbox-scoped
      segments_generated: segmentsGenerated,
      rules_generated: rulesGenerated,
      sample_feature: feats[0] ?? null,
      error: segErr,
      notes:
        `cscl_fetched=${feats.length}` +
        ` segments_generated=${segmentsGenerated}` +
        ` rules_generated=${rulesGenerated}` +
        ` boroughs: ${boroSummary || "(none)"}` +
        ` (NYC Open Data inkn-q76z — DOITT GIS canonical CSCL; ~115k polylines citywide.` +
        ` Phase 1 keeps RW_TYPE=1 active streets only; highways, ramps, alleys, walkways excluded server-side.)` +
        (segErr ? ` segment_error="${segErr}"` : ""),
    });
  } catch (e) {
    out.push({
      provider: "nyc-centerline",
      dataset_url: CENTERLINE_DATASET_URL,
      geometry_type: "unknown",
      features_fetched: 0,
      features_after_bbox: 0,
      segments_generated: 0,
      rules_generated: 0,
      sample_feature: null,
      error: (e as Error).message,
      notes: `cscl_fetch_error="${(e as Error).message}"`,
    });
  }

  return out;
}
