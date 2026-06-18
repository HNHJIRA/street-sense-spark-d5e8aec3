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
const RPZ_ENDPOINT =
  "https://gis-web.bellevuewa.gov/gisext/rest/services/Transportation/TIMS_Reference/MapServer/10/query";
const CURB_ENDPOINT =
  "https://services1.arcgis.com/EYzEZbDhXZjURPbP/arcgis/rest/services/Curb_Space_Typology/FeatureServer/23/query";
const CBD_ENDPOINT =
  "https://gis-web.bellevuewa.gov/gisext/rest/services/Enterprise/Enterprise_Transportation/MapServer/95/query";
const RPZ_STREETS_ENDPOINT =
  "https://gis-web.bellevuewa.gov/gisext/rest/services/Enterprise/Enterprise_Transportation/MapServer/97/query";
const PAINTED_CURBS_ENDPOINT =
  "https://gis-web.bellevuewa.gov/gisext/rest/services/Enterprise/Enterprise_Transportation/MapServer/647/query";
const BUS_LAYOVERS_ENDPOINT =
  "https://gis-web.bellevuewa.gov/gisext/rest/services/Enterprise/Enterprise_Transportation/MapServer/108/query";
const SIGNS_ENDPOINT =
  "https://gis-web.bellevuewa.gov/gisext/rest/services/Enterprise/Enterprise_Transportation/MapServer/137/query";

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
        `streets_fetched=${feats.length}` +
        ` streets_in_bbox=${afterBbox}` +
        ` segments_generated=${segmentsGenerated}` +
        ` rules_generated=${rulesGenerated}` +
        ` (paginated; full dataset ~10,629 polylines citywide)` +
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

  // ---------- bellevue-rpz (TIMS_Reference / Layer 10) ----------
  try {
    const feats = await probeArcgis(RPZ_ENDPOINT, bbox);
    const gType = geomType(feats[0]);
    const afterBbox = bboxFilterCount(feats, bbox, gType);
    out.push({
      provider: "bellevue-rpz",
      dataset_url: RPZ_ENDPOINT,
      geometry_type: gType,
      features_fetched: feats.length,
      features_after_bbox: afterBbox,
      segments_generated: 0,
      rules_generated: 0,
      sample_feature: feats[0] ?? null,
      error: null,
      notes:
        `polygons_fetched=${feats.length} polygons_in_bbox=${afterBbox}` +
        ` (TIMS_Reference/L10 — 16 official Residential Parking Zones with CODENO/RPZ_ID).` +
        ` Snapped to Bellevue street_segments via apply_permit_polygon_overlay.`,
    });
  } catch (e) {
    out.push({
      provider: "bellevue-rpz",
      dataset_url: RPZ_ENDPOINT,
      geometry_type: "unknown",
      features_fetched: 0, features_after_bbox: 0,
      segments_generated: 0, rules_generated: 0,
      sample_feature: null,
      error: (e as Error).message,
      notes: `rpz_fetch_error="${(e as Error).message}"`,
    });
  }

  // ---------- bellevue-curb (Curb_Space_Typology / Layer 23) ----------
  // The curb layer is misregistered upstream (advertises SR 3857, stores
  // EPSG:2926 feet). The provider bypasses ArcGIS bbox filtering and
  // reprojects locally — so the diagnostic must do the same: probe with
  // `where=1=1` and no geometry filter, then count by neighborhood.
  try {
    const PAGE = 2000;
    const HARD = 50_000;
    const all: Array<{ geometry?: unknown; attributes?: { neighborhood?: string } }> = [];
    let offset = 0;
    let more = true;
    while (more) {
      const json = (await fetchArcgis(CURB_ENDPOINT, {
        where: "1=1",
        outFields: "neighborhood",
        returnGeometry: "false",
        resultRecordCount: String(PAGE),
        resultOffset: String(offset),
        orderByFields: "OBJECTID",
      })) as {
        features?: Array<{ attributes?: { neighborhood?: string } }>;
        exceededTransferLimit?: boolean;
      };
      const feats = json.features ?? [];
      all.push(...feats);
      more = !!json.exceededTransferLimit && feats.length > 0;
      offset += feats.length;
      if (offset > HARD) break;
    }
    const nbCounts: Record<string, number> = {};
    for (const f of all) {
      const n = (f.attributes?.neighborhood ?? "").toString().trim() || "(none)";
      nbCounts[n] = (nbCounts[n] ?? 0) + 1;
    }
    const nbSummary = Object.entries(nbCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k}=${v}`)
      .join(" ");
    out.push({
      provider: "bellevue-curb",
      dataset_url: CURB_ENDPOINT,
      geometry_type: "polyline",
      features_fetched: all.length,
      features_after_bbox: all.length, // provider validates per-vertex post-reprojection
      segments_generated: 0,
      rules_generated: 0,
      sample_feature: all[0] ?? null,
      error: null,
      notes:
        `features_fetched=${all.length} neighborhoods: ${nbSummary || "(none)"}` +
        ` (Curb_Space_Typology/L23 — provider imports all neighborhoods;` +
        ` typ_s_auto→allowed, typ_s_transit/typ_m_transit→bus_zone,` +
        ` typ_a→loading_zone, movement-only→no_parking).` +
        ` Geometry is reprojected locally from EPSG:2926; bbox filtering` +
        ` happens after reprojection inside the provider.`,
    });
  } catch (e) {
    out.push({
      provider: "bellevue-curb",
      dataset_url: CURB_ENDPOINT,
      geometry_type: "unknown",
      features_fetched: 0, features_after_bbox: 0,
      segments_generated: 0, rules_generated: 0,
      sample_feature: null,
      error: (e as Error).message,
      notes: `curb_fetch_error="${(e as Error).message}"`,
    });
  }

  // ---------- bellevue-cbd (Enterprise_Transportation / Layer 95) ----------
  try {
    const feats = await probeArcgis(CBD_ENDPOINT, bbox);
    const gType = geomType(feats[0]);
    const afterBbox = bboxFilterCount(feats, bbox, gType);
    let proposed = 0;
    for (const f of feats) {
      const a = (f as { attributes?: { PRK_TYPE?: string } }).attributes;
      if (/^\s*proposed\b/i.test(a?.PRK_TYPE ?? "")) proposed++;
    }
    out.push({
      provider: "bellevue-cbd",
      dataset_url: CBD_ENDPOINT,
      geometry_type: gType,
      features_fetched: feats.length,
      features_after_bbox: afterBbox,
      segments_generated: 0,
      rules_generated: 0,
      sample_feature: feats[0] ?? null,
      error: null,
      notes:
        `features_fetched=${feats.length} features_in_bbox=${afterBbox} proposed_skipped=${proposed}` +
        ` (Enterprise/L95 — downtown CBD curb regulations; PRK_TYPE → time_limited / no_parking / loading_zone / bus_zone).`,
    });
  } catch (e) {
    out.push({
      provider: "bellevue-cbd",
      dataset_url: CBD_ENDPOINT,
      geometry_type: "unknown",
      features_fetched: 0, features_after_bbox: 0,
      segments_generated: 0, rules_generated: 0,
      sample_feature: null,
      error: (e as Error).message,
      notes: `cbd_fetch_error="${(e as Error).message}"`,
    });
  }

  // ---------- bellevue-rpz-streets (Enterprise_Transportation / Layer 97) ----------
  try {
    const feats = await probeArcgis(RPZ_STREETS_ENDPOINT, bbox);
    const gType = geomType(feats[0]);
    const afterBbox = bboxFilterCount(feats, bbox, gType);
    out.push({
      provider: "bellevue-rpz-streets",
      dataset_url: RPZ_STREETS_ENDPOINT,
      geometry_type: gType,
      features_fetched: feats.length,
      features_after_bbox: afterBbox,
      segments_generated: 0,
      rules_generated: 0,
      sample_feature: feats[0] ?? null,
      error: null,
      notes:
        `features_fetched=${feats.length} features_in_bbox=${afterBbox}` +
        ` (Enterprise/L97 — RPZ block-face polylines with parsed Restriction text → permit rule with hours).`,
    });
  } catch (e) {
    out.push({
      provider: "bellevue-rpz-streets",
      dataset_url: RPZ_STREETS_ENDPOINT,
      geometry_type: "unknown",
      features_fetched: 0, features_after_bbox: 0,
      segments_generated: 0, rules_generated: 0,
      sample_feature: null,
      error: (e as Error).message,
      notes: `rpz_streets_fetch_error="${(e as Error).message}"`,
    });
  }
  // ---------- bellevue-painted-curbs (Enterprise_Transportation / Layer 647) ----------
  try {
    const feats = await probeArcgis(PAINTED_CURBS_ENDPOINT, bbox);
    const gType = geomType(feats[0]);
    const afterBbox = bboxFilterCount(feats, bbox, gType);
    let yellow = 0, white = 0, red = 0, island = 0;
    for (const f of feats) {
      const a = (f as { attributes?: { Color?: string; CurbType?: string } }).attributes;
      const c = (a?.Color ?? "").trim().toUpperCase();
      const ct = (a?.CurbType ?? "").trim().toUpperCase();
      if (c === "YELLOW") yellow++;
      else if (c === "WHITE") white++;
      else if (c === "RED") red++;
      if (ct === "ISLAND") island++;
    }
    out.push({
      provider: "bellevue-painted-curbs",
      dataset_url: PAINTED_CURBS_ENDPOINT,
      geometry_type: gType,
      features_fetched: feats.length,
      features_after_bbox: afterBbox,
      segments_generated: 0,
      rules_generated: 0,
      sample_feature: feats[0] ?? null,
      error: null,
      notes:
        `features_fetched=${feats.length} features_in_bbox=${afterBbox}` +
        ` yellow=${yellow} white=${white} red=${red} island_skipped=${island}` +
        ` (Enterprise/L647 — Painted Traffic Curbs; YELLOW→loading_zone, WHITE→passenger_loading,` +
        ` RED→no_parking. ISLAND curbtype skipped — these are traffic islands, not blockface curbs).`,
    });
  } catch (e) {
    out.push({
      provider: "bellevue-painted-curbs",
      dataset_url: PAINTED_CURBS_ENDPOINT,
      geometry_type: "unknown",
      features_fetched: 0, features_after_bbox: 0,
      segments_generated: 0, rules_generated: 0,
      sample_feature: null,
      error: (e as Error).message,
      notes: `painted_curbs_fetch_error="${(e as Error).message}"`,
    });
  }

  // ---------- bellevue-bus-layovers (Enterprise_Transportation / Layer 108) ----------
  try {
    const feats = await probeArcgis(BUS_LAYOVERS_ENDPOINT, bbox);
    const gType = geomType(feats[0]);
    const afterBbox = bboxFilterCount(feats, bbox, gType);
    out.push({
      provider: "bellevue-bus-layovers",
      dataset_url: BUS_LAYOVERS_ENDPOINT,
      geometry_type: gType,
      features_fetched: feats.length,
      features_after_bbox: afterBbox,
      segments_generated: 0,
      rules_generated: 0,
      sample_feature: feats[0] ?? null,
      error: null,
      notes:
        `polygons_fetched=${feats.length} polygons_in_bbox=${afterBbox}` +
        ` (Enterprise/L108 — Bus Layover Zones; polygon → bus_zone via apply_zone_polygon_overlay).`,
    });
  } catch (e) {
    out.push({
      provider: "bellevue-bus-layovers",
      dataset_url: BUS_LAYOVERS_ENDPOINT,
      geometry_type: "unknown",
      features_fetched: 0, features_after_bbox: 0,
      segments_generated: 0, rules_generated: 0,
      sample_feature: null,
      error: (e as Error).message,
      notes: `bus_layovers_fetch_error="${(e as Error).message}"`,
    });
  }

  // ---------- bellevue-signs (Enterprise_Transportation / Layer 137) ----------
  try {
    // Server-side prefilter: only R7-/R8- parking sign series.
    const PAGE = 2000;
    const HARD = 50_000;
    const all: Array<{ geometry?: unknown; attributes?: { SignTypeDescription?: string } }> = [];
    let offset = 0;
    let more = true;
    while (more) {
      const json = (await fetchArcgis(SIGNS_ENDPOINT, {
        where: "SignTypeDescription LIKE 'R7%' OR SignTypeDescription LIKE 'R8%'",
        outFields: "OBJECTID,SignTypeDescription",
        returnGeometry: "true",
        outSR: "4326",
        resultRecordCount: String(PAGE),
        resultOffset: String(offset),
        orderByFields: "OBJECTID",
      })) as {
        features?: Array<{ geometry?: unknown; attributes?: { SignTypeDescription?: string } }>;
        exceededTransferLimit?: boolean;
      };
      const feats = json.features ?? [];
      all.push(...feats);
      more = !!json.exceededTransferLimit && feats.length > 0;
      offset += feats.length;
      if (offset > HARD) break;
    }
    const gType = geomType(all[0]);
    const afterBbox = bboxFilterCount(all, bbox, gType);
    const counts: Record<string, number> = {};
    for (const f of all) {
      const d = (f.attributes?.SignTypeDescription ?? "").trim();
      const m = d.match(/^(R[78])-?(\d{1,4})/i);
      if (!m) continue;
      const k = `${m[1].toUpperCase()}-${m[2]}`;
      counts[k] = (counts[k] ?? 0) + 1;
    }
    const top = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([k, v]) => `${k}=${v}`)
      .join(" ");
    out.push({
      provider: "bellevue-signs",
      dataset_url: SIGNS_ENDPOINT,
      geometry_type: gType,
      features_fetched: all.length,
      features_after_bbox: afterBbox,
      segments_generated: 0,
      rules_generated: 0,
      sample_feature: all[0] ?? null,
      error: null,
      notes:
        `signs_fetched=${all.length} signs_in_bbox=${afterBbox}` +
        ` (Enterprise/L137 — Sign Status; R7-/R8- MUTCD parking series only.` +
        ` Mapping: R7-1/2/101/201/202/401 + R8-1/3/301/4/8 → no_parking,` +
        ` R7-108 → time_limited, R7-6/10801 → loading_zone, R7-107/701 → bus_zone,` +
        ` R7-10802 PARALLEL PARKING ONLY skipped as advisory).` +
        (top ? ` top: ${top}` : ""),
    });
  } catch (e) {
    out.push({
      provider: "bellevue-signs",
      dataset_url: SIGNS_ENDPOINT,
      geometry_type: "unknown",
      features_fetched: 0, features_after_bbox: 0,
      segments_generated: 0, rules_generated: 0,
      sample_feature: null,
      error: (e as Error).message,
      notes: `signs_fetch_error="${(e as Error).message}"`,
    });
  }

  return out;
}
