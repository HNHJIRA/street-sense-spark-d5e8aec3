// Server functions for the parking map.
// All supabaseAdmin + external API access stays inside .handler() to keep
// the service-role import out of the client bundle.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { LineString } from "geojson";
import type {
  RestrictionType,
  ParkingColor,
  ParkingRule,
  ParkingEvent,
  StreetSegment,
} from "./types";
import type { NormalizedSegment } from "./providers/types";
import { evaluateRulesAt } from "./engine";

// ---------- Shared admin helper ----------

interface AdminClient {
  from: (t: string) => any;
  rpc: (n: string, a?: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
}
async function getAdmin(): Promise<AdminClient> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as unknown as AdminClient;
}

async function loadRestrictionTypes(admin: AdminClient): Promise<RestrictionType[]> {
  const { data } = await admin.from("restriction_types").select("code, label, color, description");
  return (data ?? []) as RestrictionType[];
}

// ---------- Mapbox token ----------

export const getMapboxToken = createServerFn({ method: "GET" }).handler(async () => {
  const token = process.env.MAPBOX_PUBLIC_TOKEN;
  if (!token) throw new Error("MAPBOX_PUBLIC_TOKEN is not configured");
  return { token };
});

// ---------- City info ----------

export interface CityInfo {
  id: string;
  slug: string;
  name: string;
  timezone: string;
  center: [number, number];
  default_zoom: number;
  restrictionTypes: RestrictionType[];
  segmentCount: number;
}

export const getCityInfo = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) =>
    z.object({ citySlug: z.string().min(1).max(64) }).parse(input),
  )
  .handler(async ({ data }): Promise<CityInfo> => {
    const admin = await getAdmin();
    const { data: cityRow, error: cityErr } = await admin
      .from("cities")
      .select("id, slug, name, timezone, default_zoom")
      .eq("slug", data.citySlug)
      .maybeSingle();
    if (cityErr || !cityRow) throw new Error("City not found");

    let center: [number, number] = [-122.3321, 47.6062];
    const { data: centerJson } = await admin.rpc("city_center_geojson", { p_slug: data.citySlug });
    if (typeof centerJson === "string") {
      try {
        const g = JSON.parse(centerJson);
        if (Array.isArray(g?.coordinates)) center = g.coordinates as [number, number];
      } catch { /* ignore */ }
    }

    const types = await loadRestrictionTypes(admin);
    const { count } = (await admin
      .from("street_segments")
      .select("id", { count: "exact", head: true })
      .eq("city_id", cityRow.id)) as unknown as { count: number };

    return {
      id: cityRow.id,
      slug: cityRow.slug,
      name: cityRow.name,
      timezone: cityRow.timezone,
      center,
      default_zoom: Number(cityRow.default_zoom ?? 14),
      restrictionTypes: types,
      segmentCount: count ?? 0,
    };
  });

// ---------- Viewport segments (time-aware) ----------

export interface SegmentLite {
  id: string;
  name: string;
  side: string;
  coordinates: [number, number][];
  restriction_code: string;
  color: ParkingColor;
  label: string;
  data_source: string;
  /** ISO timestamp at which the current restriction ends, if any. */
  allowed_until: string | null;
}

interface BboxRow {
  id: string; name: string; side: string; geojson: string;
  data_source: string; metadata: Record<string, unknown>;
  rules: ParkingRule[] | null;
}

export const getSegmentsInBbox = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) =>
    z.object({
      cityId: z.string().uuid(),
      minLng: z.number(), minLat: z.number(),
      maxLng: z.number(), maxLat: z.number(),
      /** Optional ISO timestamp for forecast mode. Defaults to "now". */
      at: z.string().datetime().optional().nullable(),
      timezone: z.string().min(1).max(64).default("America/Los_Angeles"),
    }).parse(input),
  )
  .handler(async ({ data }): Promise<SegmentLite[]> => {
    const admin = await getAdmin();
    const { data: rows, error } = await admin.rpc("segments_in_bbox_with_rules", {
      p_city_id: data.cityId,
      p_min_lng: data.minLng, p_min_lat: data.minLat,
      p_max_lng: data.maxLng, p_max_lat: data.maxLat,
    });
    if (error) throw new Error((error as { message?: string }).message ?? "Failed to load segments");

    const restrictionTypes = await loadRestrictionTypes(admin);
    const when = data.at ? new Date(data.at) : new Date();
    const list = (rows ?? []) as BboxRow[];
    const out: SegmentLite[] = [];

    for (const r of list) {
      let coords: [number, number][] = [];
      try {
        const g = JSON.parse(r.geojson) as LineString;
        if (!Array.isArray(g.coordinates) || g.coordinates.length < 2) continue;
        coords = g.coordinates as [number, number][];
      } catch { continue; }

      const seg: StreetSegment = {
        id: r.id, name: r.name, side: r.side, neighborhood: null,
        coordinates: coords,
        rules: (r.rules ?? []) as ParkingRule[],
        events: [],
      };
      const status = evaluateRulesAt(seg, restrictionTypes, when, data.timezone);
      out.push({
        id: r.id,
        name: r.name,
        side: r.side,
        coordinates: coords,
        restriction_code: status.code,
        color: status.color,
        label: status.label,
        data_source: r.data_source,
        allowed_until: status.allowed_until,
      });
    }
    return out;
  });

// ---------- Segment details (time-aware) ----------

export interface SegmentDetails {
  id: string;
  name: string;
  side: string;
  neighborhood: string | null;
  data_source: string;
  source_label: string;
  /** Provider-supplied category label, if any (e.g. SDOT PARKING_CATEGORY). */
  source_category: string | null;
  rules: ParkingRule[];
  events: ParkingEvent[];
}

const SOURCE_LABELS: Record<string, string> = {
  sdot: "Seattle SDOT Blockface",
  osm: "OpenStreetMap",
  seed: "Demo data",
  curbiq: "CurbIQ",
};

export const getSegmentDetails = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) =>
    z.object({ id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data }): Promise<SegmentDetails> => {
    const admin = await getAdmin();
    const { data: seg } = await admin
      .from("street_segments")
      .select("id, name, side, metadata, data_source")
      .eq("id", data.id)
      .maybeSingle();
    if (!seg) throw new Error("Segment not found");
    const { data: rules } = await admin
      .from("parking_rules")
      .select("id, street_segment_id, priority, restriction_code, days_of_week, time_start, time_end, permit_zone, time_limit_minutes, effective_from, effective_to, notes")
      .eq("street_segment_id", data.id)
      .order("priority", { ascending: true });
    const { data: events } = await admin
      .from("parking_events")
      .select("id, street_segment_id, restriction_code, starts_at, ends_at, reason")
      .eq("street_segment_id", data.id);
    const src = seg.data_source as string;
    return {
      id: seg.id as string,
      name: seg.name as string,
      side: (seg.side ?? "both") as string,
      neighborhood: (seg.metadata?.neighborhood ?? null) as string | null,
      data_source: src,
      source_label: SOURCE_LABELS[src] ?? src,
      source_category: ((seg.metadata?.parking_category as string | undefined) ?? null) || null,
      rules: (rules ?? []) as ParkingRule[],
      events: (events ?? []) as ParkingEvent[],
    };
  });

// ---------- "Can I park here?" — nearest segment, time-aware ----------

export interface ParkHereResult {
  found: boolean;
  segmentId?: string;
  name?: string;
  color?: ParkingColor;
  label?: string;
  restriction_code?: string;
  distance_m?: number;
  coordinates?: [number, number][];
  allowed_until?: string | null;
  permit_zone?: string | null;
  time_limit_minutes?: number | null;
  data_source?: string;
  message: string;
  source: "gps" | "tap";
}

export const checkParkingHere = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) =>
    z.object({
      cityId: z.string().uuid(),
      lng: z.number().min(-180).max(180),
      lat: z.number().min(-90).max(90),
      at: z.string().datetime().optional().nullable(),
      timezone: z.string().min(1).max(64).default("America/Los_Angeles"),
      source: z.enum(["gps", "tap"]).default("gps"),
    }).parse(input),
  )
  .handler(async ({ data }): Promise<ParkHereResult> => {
    const admin = await getAdmin();
    const { data: rows, error } = await admin.rpc("nearest_segment_full", {
      p_city_id: data.cityId,
      p_lng: data.lng, p_lat: data.lat,
      p_max_meters: 80,
    });
    if (error) throw new Error((error as { message?: string }).message ?? "Lookup failed");
    const row = (rows as Array<{
      id: string; name: string; side: string; geojson: string;
      data_source: string; metadata: Record<string, unknown>;
      rules: ParkingRule[] | null; distance_m: number;
    }> | null)?.[0];
    if (!row) {
      return {
        found: false,
        source: data.source,
        message: "No mapped street nearby. Try moving closer to a street.",
      };
    }
    let coords: [number, number][] = [];
    try {
      const g = JSON.parse(row.geojson) as LineString;
      if (Array.isArray(g.coordinates)) coords = g.coordinates as [number, number][];
    } catch { /* ignore */ }

    const restrictionTypes = await loadRestrictionTypes(admin);
    const seg: StreetSegment = {
      id: row.id, name: row.name, side: row.side, neighborhood: null,
      coordinates: coords,
      rules: (row.rules ?? []) as ParkingRule[],
      events: [],
    };
    const when = data.at ? new Date(data.at) : new Date();
    const status = evaluateRulesAt(seg, restrictionTypes, when, data.timezone);

    const msg = status.color === "green"
      ? `Yes — you can park here on ${row.name}.`
      : status.color === "yellow"
        ? `Caution on ${row.name}: ${status.label.toLowerCase()}.`
        : `No — ${status.label.toLowerCase()} on ${row.name}.`;

    return {
      found: true,
      source: data.source,
      segmentId: row.id,
      name: row.name,
      color: status.color,
      label: status.label,
      restriction_code: status.code,
      distance_m: row.distance_m,
      coordinates: coords,
      allowed_until: status.allowed_until,
      permit_zone: status.permit_zone,
      time_limit_minutes: status.time_limit_minutes,
      data_source: row.data_source,
      message: msg,
    };
  });

// ---------- Provider sync (Seattle SDOT Blockface and future providers) ----------

export interface SyncRunDiagnostics {
  lines_input?: number;
  lines_parsed?: number;
  candidate_pairs?: number;
  matched_segments?: number;
  unmatched_lines?: number;
  rows_updated?: number;
  ms_parse?: number;
  ms_match?: number;
  ms_update?: number;
  ms_total?: number;
  timeout_stage?: string;
  rpc_error?: string;
  fetched_segments?: number;
  deduped_segments?: number;
  duplicate_external_ids?: number;
  duplicate_rows?: number;
  duplicate_strategy?: string;
}
export interface SyncRunResult {
  imported: number;
  skipped: number;
  provider: string;
  error?: string;
  diagnostics?: SyncRunDiagnostics;
}

function makeExternalIdsUnique(segments: NormalizedSegment[]): {
  segments: NormalizedSegment[];
  diagnostics: SyncRunDiagnostics;
} {
  const totals = new Map<string, number>();
  for (const s of segments) totals.set(s.external_id, (totals.get(s.external_id) ?? 0) + 1);

  let duplicateExternalIds = 0;
  let duplicateRows = 0;
  for (const count of totals.values()) {
    if (count > 1) {
      duplicateExternalIds += 1;
      duplicateRows += count - 1;
    }
  }

  if (duplicateRows === 0) {
    return {
      segments,
      diagnostics: {
        fetched_segments: segments.length,
        deduped_segments: segments.length,
        duplicate_external_ids: 0,
        duplicate_rows: 0,
        duplicate_strategy: "none",
      },
    };
  }

  const seen = new Map<string, number>();
  const unique = segments.map((segment) => {
    const total = totals.get(segment.external_id) ?? 1;
    if (total === 1) return segment;

    const index = (seen.get(segment.external_id) ?? 0) + 1;
    seen.set(segment.external_id, index);
    const baseMetadata = {
      ...segment.metadata,
      dedupe_original_external_id: segment.external_id,
      dedupe_sequence: index,
      dedupe_group_size: total,
    };

    if (index === 1) {
      return { ...segment, metadata: baseMetadata };
    }

    return {
      ...segment,
      external_id: `${segment.external_id}#duplicate-${index}`,
      metadata: baseMetadata,
    };
  });

  return {
    segments: unique,
    diagnostics: {
      fetched_segments: segments.length,
      deduped_segments: unique.length,
      duplicate_external_ids: duplicateExternalIds,
      duplicate_rows: duplicateRows,
      duplicate_strategy: "preserve-first-id-and-suffix-additional-geometries",
    },
  };
}

async function recordSyncStart(
  admin: AdminClient,
  provider: string,
  cityId: string,
  bbox: { minLng: number; minLat: number; maxLng: number; maxLat: number },
): Promise<string | null> {
  const { data, error } = await admin.from("sync_logs").insert({
    provider, city_id: cityId, status: "started",
    bbox, imported: 0, skipped: 0,
  }).select("id").maybeSingle();
  if (error) return null;
  return (data as { id: string } | null)?.id ?? null;
}

async function recordSyncFinish(
  admin: AdminClient, logId: string | null,
  provider: string, cityId: string,
  result: { imported: number; skipped: number; error?: string },
  startedAt: number,
) {
  const status = result.error
    ? (result.imported > 0 ? "partial" : "error")
    : "success";
  if (logId) {
    await admin.from("sync_logs").update({
      status,
      imported: result.imported,
      skipped: result.skipped,
      error: result.error ?? null,
      duration_ms: Date.now() - startedAt,
      finished_at: new Date().toISOString(),
    }).eq("id", logId);
  }
  const { count } = (await admin
    .from("street_segments")
    .select("id", { count: "exact", head: true })
    .eq("city_id", cityId)
    .eq("data_source", provider)) as unknown as { count: number };

  const healthy = !result.error;
  await admin.from("provider_health").upsert({
    provider, city_id: cityId, healthy,
    last_success_at: healthy ? new Date().toISOString() : undefined,
    last_error_at: healthy ? undefined : new Date().toISOString(),
    last_error: result.error ?? null,
    segments_total: count ?? 0,
  }, { onConflict: "provider,city_id" });
}

export const syncProvider = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({
      citySlug: z.string().min(1).max(64),
      minLng: z.number(), minLat: z.number(),
      maxLng: z.number(), maxLat: z.number(),
      force: z.boolean().optional(),
      /** Optional explicit provider id; defaults to the city's first segment provider. */
      providerId: z.string().min(1).max(64).optional(),
      /** Optional provider-specific params (e.g. NYC borough filter). */
      providerParams: z.record(z.string(), z.unknown()).optional(),
    }).parse(input),
  )
  .handler(async ({ data }): Promise<SyncRunResult> => {
    const w = Math.abs(data.maxLng - data.minLng);
    const h = Math.abs(data.maxLat - data.minLat);
    if (!data.force && w * h > 0.05) return { imported: 0, skipped: 0, provider: "unknown", error: "Zoom in to load detailed street data." };

    const { getProviderForCity, getProviderById } = await import("./providers/registry.server");
    const { isOverlayProvider } = await import("./providers/types");
    const provider = data.providerId ? getProviderById(data.providerId) : getProviderForCity(data.citySlug);
    if (!provider) {
      return { imported: 0, skipped: 0, provider: data.providerId ?? "none", error: `No provider for "${data.providerId ?? data.citySlug}"` };
    }

    const admin = await getAdmin();
    const { data: city } = await admin.from("cities").select("id").eq("slug", data.citySlug).maybeSingle();
    if (!city) throw new Error("City not found");

    const bbox = { minLng: data.minLng, minLat: data.minLat, maxLng: data.maxLng, maxLat: data.maxLat };
    const startedAt = Date.now();
    const logId = await recordSyncStart(admin, provider.id, city.id, bbox);

    // ---- Overlay provider path ----
    if (isOverlayProvider(provider)) {
      try {
        const r = await provider.applyOverlay(data.citySlug, bbox, {
          cityId: city.id as string,
          admin,
          params: data.providerParams,
        });
        const res: { imported: number; skipped: number; error?: string } = {
          imported: r.rules_inserted,
          skipped: 0,
        };
        if (r.error) res.error = r.error;
        await recordSyncFinish(admin, logId, provider.id, city.id, res, startedAt);
        const d = r.diagnostics ?? {};
        const noteParts = [
          `Overlay: ${r.polygons_fetched} polygons → ${r.segments_touched} segments tagged with permit rules.`,
          `lines_input=${d.lines_input ?? r.polygons_fetched}`,
          `lines_parsed=${d.lines_parsed ?? "?"}`,
          `candidate_pairs=${d.candidate_pairs ?? "?"}`,
          `matched_segments=${d.matched_segments ?? "?"}`,
          `unmatched_lines=${d.unmatched_lines ?? "?"}`,
          `rows_updated=${d.rows_updated ?? r.rules_inserted}`,
          `ms_parse=${d.ms_parse ?? "?"}`,
          `ms_match=${d.ms_match ?? "?"}`,
          `ms_update=${d.ms_update ?? "?"}`,
          `ms_total=${d.ms_total ?? "?"}`,
          `timeout_stage=${d.timeout_stage ?? "done"}`,
        ];
        if (d.rpc_error) noteParts.push(`rpc_error="${d.rpc_error}"`);
        await admin.from("provider_health").update({
          notes: noteParts.join(" "),
        }).eq("provider", provider.id).eq("city_id", city.id);
        return { ...res, provider: provider.id, diagnostics: r.diagnostics };
      } catch (e) {
        const res = { imported: 0, skipped: 0, error: (e as Error).message };
        await recordSyncFinish(admin, logId, provider.id, city.id, res, startedAt);
        return { ...res, provider: provider.id };
      }
    }

    // ---- Segment provider path ----
    try {
      const fetched = await provider.fetchSegments(data.citySlug, bbox);
      const { segments: normalized, diagnostics: dedupeDiagnostics } = makeExternalIdsUnique(fetched);
      if (normalized.length === 0) {
        const res = { imported: 0, skipped: 0 };
        await recordSyncFinish(admin, logId, provider.id, city.id, res, startedAt);
        await maybeWriteProviderNotes(admin, provider.id, city.id as string);
        return { ...res, provider: provider.id, diagnostics: dedupeDiagnostics };
      }

      type SegInsert = {
        city_id: string; external_id: string; name: string; side: string;
        data_source: string; geom: string; metadata: Record<string, unknown>;
      };
      const inserts: SegInsert[] = normalized.map((s) => ({
        city_id: city.id as string,
        external_id: s.external_id,
        name: s.name,
        side: s.side,
        data_source: provider.id,
        geom: JSON.stringify({ type: "LineString", coordinates: s.coordinates }),
        metadata: s.metadata,
      }));

      const chunkSize = 200;
      let imported = 0;
      const insertedIds: { id: string; external_id: string }[] = [];

      for (let i = 0; i < inserts.length; i += chunkSize) {
        const chunk = inserts.slice(i, i + chunkSize);
        const { data: ins, error } = await admin.rpc("upsert_osm_segments", { p_rows: chunk });
        if (error) {
          const res = { imported, skipped: inserts.length - imported, error: `Segment upsert failed: ${(error as { message?: string }).message}` };
          await recordSyncFinish(admin, logId, provider.id, city.id, res, startedAt);
          return { ...res, provider: provider.id };
        }
        const rows = (ins ?? []) as Array<{ segment_id: string; segment_external_id: string }>;
        for (const r of rows) insertedIds.push({ id: r.segment_id, external_id: r.segment_external_id });
        imported += rows.length;
      }

      // Replace ONLY rules contributed by *this* provider, so other layered
      // datasets (Signposts, RPZ, street sweeping) remain attached to the
      // same segment. Rules are tagged with data_source = provider.id.
      const rulesByExt = new Map(normalized.map((s) => [s.external_id, s.rules]));
      const ids = insertedIds.map((r) => r.id);
      for (let i = 0; i < ids.length; i += 500) {
        const slice = ids.slice(i, i + 500);
        const { error: deleteError } = await admin.from("parking_rules")
          .delete()
          .in("street_segment_id", slice)
          .eq("data_source", provider.id);
        if (deleteError) {
          const res = { imported, skipped: normalized.length - imported, error: `Rule cleanup failed: ${(deleteError as { message?: string }).message}` };
          await recordSyncFinish(admin, logId, provider.id, city.id, res, startedAt);
          return { ...res, provider: provider.id, diagnostics: dedupeDiagnostics };
        }
        const ruleRows = insertedIds
          .filter((r) => slice.includes(r.id))
          .flatMap((r) => (rulesByExt.get(r.external_id) ?? []).map((rule) => ({
            street_segment_id: r.id,
            priority: rule.priority,
            restriction_code: rule.restriction_code,
            days_of_week: rule.days_of_week,
            time_start: rule.time_start,
            time_end: rule.time_end,
            permit_zone: rule.permit_zone,
            time_limit_minutes: rule.time_limit_minutes,
            effective_from: rule.effective_from,
            effective_to: rule.effective_to,
            notes: rule.notes,
            data_source: provider.id,
          })));
        if (ruleRows.length) {
          const { error: insertError } = await admin.from("parking_rules").insert(ruleRows);
          if (insertError) {
            const res = { imported, skipped: normalized.length - imported, error: `Rule insert failed: ${(insertError as { message?: string }).message}` };
            await recordSyncFinish(admin, logId, provider.id, city.id, res, startedAt);
            return { ...res, provider: provider.id, diagnostics: dedupeDiagnostics };
          }
        }
      }

      const res = { imported, skipped: inserts.length - imported };
      await recordSyncFinish(admin, logId, provider.id, city.id, res, startedAt);
      await maybeWriteProviderNotes(admin, provider.id, city.id as string);
      return { ...res, provider: provider.id, diagnostics: dedupeDiagnostics };
    } catch (e) {
      const res = { imported: 0, skipped: 0, error: (e as Error).message };
      await recordSyncFinish(admin, logId, provider.id, city.id, res, startedAt);
      return { ...res, provider: provider.id };
    }
  });

/** Known dataset limitations surfaced on provider_health.notes after a successful sync. */
const PROVIDER_NOTES: Record<string, string> = {
  "pasadena-opendata":
    "Dataset limitation: City of Pasadena open data publishes only 6 city-wide sweeping zone polygons (no per-block polylines, no posted time-of-day, no permit, no meter inventory). Sync is healthy; block-level coverage requires non-public data or OSM-grid explosion of zones.",
  "ladot": null as unknown as string,
};

async function maybeWriteProviderNotes(admin: AdminClient, providerId: string, cityId: string) {
  const note = PROVIDER_NOTES[providerId];
  if (!note) return;
  await admin.from("provider_health").update({ notes: note }).eq("provider", providerId).eq("city_id", cityId);
}

/** Back-compat alias for the existing MapView import. */
export const importSeattleBlockface = syncProvider;

/** Sync EVERY provider registered for a city in series. Used by the cron and
 *  the admin LA-sync endpoint to layer multiple datasets onto the same city.
 *  Segment providers run first, overlays last (overlays depend on segments
 *  having been imported). */
export const syncAllProvidersForCity = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({
      citySlug: z.string().min(1).max(64),
      minLng: z.number(), minLat: z.number(),
      maxLng: z.number(), maxLat: z.number(),
      force: z.boolean().optional(),
      /** Restrict the run to a single provider id. */
      onlyProviderId: z.string().min(1).max(64).optional(),
      /** Per-provider params, keyed by provider id. */
      providerParams: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
    }).parse(input),
  )
  .handler(async ({ data }) => {
    const { getSegmentProvidersForCity, getOverlayProvidersForCity } =
      await import("./providers/registry.server");
    const segmentProviders = getSegmentProvidersForCity(data.citySlug);
    const overlayProviders = getOverlayProvidersForCity(data.citySlug);
    let ordered = [...segmentProviders, ...overlayProviders];
    if (data.onlyProviderId) {
      ordered = ordered.filter((p) => p.id === data.onlyProviderId);
    }

    const results: Array<SyncRunResult & { providerName: string }> = [];
    for (const p of ordered) {
      try {
        const r = await syncProvider({
          data: {
            citySlug: data.citySlug,
            minLng: data.minLng, minLat: data.minLat,
            maxLng: data.maxLng, maxLat: data.maxLat,
            force: data.force,
            providerId: p.id,
            providerParams: data.providerParams?.[p.id],
          },
        });
        results.push({ ...r, providerName: p.name });
      } catch (e) {
        results.push({
          imported: 0, skipped: 0, provider: p.id,
          error: (e as Error).message, providerName: p.name,
        });
      }
    }
    return {
      city: data.citySlug,
      providers_run: results.length,
      totals: results.reduce(
        (acc, r) => ({ imported: acc.imported + r.imported, skipped: acc.skipped + r.skipped }),
        { imported: 0, skipped: 0 },
      ),
      results,
    };
  });


// ---------- Provider health + recent sync log readers ----------

export interface ProviderHealthRow {
  provider: string;
  city_slug: string | null;
  city_name: string | null;
  healthy: boolean;
  last_success_at: string | null;
  last_error_at: string | null;
  last_error: string | null;
  segments_total: number;
  updated_at: string;
}

export const getProviderHealth = createServerFn({ method: "GET" })
  .handler(async (): Promise<ProviderHealthRow[]> => {
    const admin = await getAdmin();
    const { data: rows } = await admin
      .from("provider_health")
      .select("provider, healthy, last_success_at, last_error_at, last_error, segments_total, updated_at, city_id, cities(slug, name)")
      .order("provider");
    return ((rows ?? []) as any[]).map((r) => ({
      provider: r.provider,
      city_slug: r.cities?.slug ?? null,
      city_name: r.cities?.name ?? null,
      healthy: r.healthy,
      last_success_at: r.last_success_at,
      last_error_at: r.last_error_at,
      last_error: r.last_error,
      segments_total: r.segments_total,
      updated_at: r.updated_at,
    }));
  });

export const getRecentSyncLogs = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) =>
    z.object({ limit: z.number().int().min(1).max(100).default(20) }).parse(input ?? {}),
  )
  .handler(async ({ data }) => {
    const admin = await getAdmin();
    const { data: rows } = await admin
      .from("sync_logs")
      .select("id, provider, status, imported, skipped, error, duration_ms, started_at, finished_at")
      .order("started_at", { ascending: false })
      .limit(data.limit);
    return (rows ?? []) as Array<{
      id: string; provider: string; status: string;
      imported: number; skipped: number; error: string | null;
      duration_ms: number | null; started_at: string; finished_at: string | null;
    }>;
  });

// ---------- Manual segment check (Mode 3) ----------

export const checkParkingForSegment = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) =>
    z.object({
      segmentId: z.string().uuid(),
      at: z.string().datetime().optional().nullable(),
      timezone: z.string().min(1).max(64).default("America/Los_Angeles"),
    }).parse(input),
  )
  .handler(async ({ data }): Promise<ParkHereResult> => {
    const admin = await getAdmin();
    const { data: seg } = await admin
      .from("street_segments")
      .select("id, name, side, data_source, metadata")
      .eq("id", data.segmentId)
      .maybeSingle();
    if (!seg) {
      return { found: false, source: "tap", message: "Segment not found." };
    }
    const { data: rules } = await admin.from("parking_rules")
      .select("id, street_segment_id, priority, restriction_code, days_of_week, time_start, time_end, permit_zone, time_limit_minutes, effective_from, effective_to, notes")
      .eq("street_segment_id", data.segmentId)
      .order("priority", { ascending: true });
    const restrictionTypes = await loadRestrictionTypes(admin);
    const segObj: StreetSegment = {
      id: seg.id as string, name: seg.name as string,
      side: (seg.side ?? "both") as string, neighborhood: null,
      coordinates: [],
      rules: (rules ?? []) as ParkingRule[],
      events: [],
    };
    const when = data.at ? new Date(data.at) : new Date();
    const status = evaluateRulesAt(segObj, restrictionTypes, when, data.timezone);
    const msg = status.color === "green"
      ? `Yes — you can park here on ${seg.name}.`
      : status.color === "yellow"
        ? `Caution on ${seg.name}: ${status.label.toLowerCase()}.`
        : `No — ${status.label.toLowerCase()} on ${seg.name}.`;
    return {
      found: true,
      source: "tap",
      segmentId: seg.id as string,
      name: seg.name as string,
      color: status.color,
      label: status.label,
      restriction_code: status.code,
      distance_m: 0,
      coordinates: [],
      allowed_until: status.allowed_until,
      permit_zone: status.permit_zone,
      time_limit_minutes: status.time_limit_minutes,
      data_source: seg.data_source as string,
      message: msg,
    };
  });

// ---------- Nearby alternatives (Mode 2) ----------

export interface NearbyOption {
  segmentId: string;
  name: string;
  side: string;
  color: ParkingColor;
  label: string;
  restriction_code: string;
  distance_m: number;
  walking_seconds: number;
  coordinates: [number, number][];
  allowed_until: string | null;
  permit_zone: string | null;
  time_limit_minutes: number | null;
  data_source: string;
}

export const findNearbyAvailable = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) =>
    z.object({
      cityId: z.string().uuid(),
      lng: z.number().min(-180).max(180),
      lat: z.number().min(-90).max(90),
      radiusM: z.number().min(10).max(500).default(100),
      limit: z.number().int().min(1).max(20).default(8),
      at: z.string().datetime().optional().nullable(),
      timezone: z.string().min(1).max(64).default("America/Los_Angeles"),
      excludeSegmentId: z.string().uuid().optional().nullable(),
    }).parse(input),
  )
  .handler(async ({ data }): Promise<NearbyOption[]> => {
    const admin = await getAdmin();
    const { data: rows, error } = await admin.rpc("nearest_segments_full", {
      p_city_id: data.cityId,
      p_lng: data.lng, p_lat: data.lat,
      p_max_meters: data.radiusM,
      p_limit: data.limit + 2,
    });
    if (error) throw new Error((error as { message?: string }).message ?? "Lookup failed");
    const restrictionTypes = await loadRestrictionTypes(admin);
    const when = data.at ? new Date(data.at) : new Date();
    const list = (rows ?? []) as Array<{
      id: string; name: string; side: string; geojson: string;
      data_source: string; metadata: Record<string, unknown>;
      rules: ParkingRule[] | null; distance_m: number;
    }>;
    const out: NearbyOption[] = [];
    for (const r of list) {
      if (data.excludeSegmentId && r.id === data.excludeSegmentId) continue;
      let coords: [number, number][] = [];
      try {
        const g = JSON.parse(r.geojson) as LineString;
        if (Array.isArray(g.coordinates)) coords = g.coordinates as [number, number][];
      } catch { /* ignore */ }
      const seg: StreetSegment = {
        id: r.id, name: r.name, side: r.side, neighborhood: null,
        coordinates: coords, rules: (r.rules ?? []) as ParkingRule[], events: [],
      };
      const status = evaluateRulesAt(seg, restrictionTypes, when, data.timezone);
      if (status.color === "red") continue; // only return parkable candidates
      out.push({
        segmentId: r.id,
        name: r.name,
        side: r.side,
        color: status.color,
        label: status.label,
        restriction_code: status.code,
        distance_m: r.distance_m,
        walking_seconds: Math.round(r.distance_m / 1.33), // ~4.8 km/h
        coordinates: coords,
        allowed_until: status.allowed_until,
        permit_zone: status.permit_zone,
        time_limit_minutes: status.time_limit_minutes,
        data_source: r.data_source,
      });
    }
    // Sort: green before yellow, then by distance
    out.sort((a, b) => {
      const colorRank = (c: ParkingColor) => (c === "green" ? 0 : c === "yellow" ? 1 : 2);
      const cr = colorRank(a.color) - colorRank(b.color);
      if (cr !== 0) return cr;
      return a.distance_m - b.distance_m;
    });
    return out.slice(0, data.limit);
  });

// ---------- Ranked parking recommendations (Phase 2) ----------
//
// Expands search radius (100 → 250 → 500m) until at least N candidates are
// found, evaluates each via evaluateRulesAt(), and ranks them with a 0-100
// parking score so the UI can answer "Where should I park?" — not just
// "Can I park here?". Still uses the single rules engine.

import { computeParkingScore, type ParkingScore } from "./score";
import { scoreConfidence } from "./confidence";
import { buildParkingDecision } from "./decision";

export interface RankedParkingOption {
  segmentId: string;
  name: string;
  side: string;
  color: ParkingColor;
  label: string;
  restriction_code: string;
  distance_m: number;
  walking_seconds: number;
  coordinates: [number, number][];
  allowed_until: string | null;
  permit_zone: string | null;
  time_limit_minutes: number | null;
  time_remaining_ms: number | null;
  data_source: string;
  confidence_score: number;
  confidence_level: "high" | "medium" | "low";
  parking_score: number;
  score_parts: ParkingScore["parts"];
  /** "100m" | "250m" | "500m" — which expansion tier this came from. */
  search_tier_m: number;
}

export const findRankedParking = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) =>
    z.object({
      cityId: z.string().uuid(),
      lng: z.number().min(-180).max(180),
      lat: z.number().min(-90).max(90),
      at: z.string().datetime().optional().nullable(),
      timezone: z.string().min(1).max(64).default("America/Los_Angeles"),
      limit: z.number().int().min(1).max(10).default(5),
      excludeSegmentId: z.string().uuid().optional().nullable(),
      /** Include yellow (LIMITED) spots in results (default true). */
      includeLimited: z.boolean().default(true),
    }).parse(input),
  )
  .handler(async ({ data }): Promise<RankedParkingOption[]> => {
    const admin = await getAdmin();
    const restrictionTypes = await loadRestrictionTypes(admin);
    const when = data.at ? new Date(data.at) : new Date();
    const tiers = [100, 250, 500];

    let rawRows: Array<{
      id: string; name: string; side: string; geojson: string;
      data_source: string; metadata: Record<string, unknown>;
      rules: ParkingRule[] | null; distance_m: number;
    }> = [];
    let tierUsed = tiers[0];

    for (const radius of tiers) {
      const { data: rows, error } = await admin.rpc("nearest_segments_full", {
        p_city_id: data.cityId,
        p_lng: data.lng, p_lat: data.lat,
        p_max_meters: radius,
        p_limit: Math.max(20, data.limit * 4),
      });
      if (error) throw new Error((error as { message?: string }).message ?? "Lookup failed");
      rawRows = (rows ?? []) as typeof rawRows;
      tierUsed = radius;
      // Quick acceptance heuristic: have at least `limit` candidates with rules.
      const usable = rawRows.filter((r) => (r.rules?.length ?? 0) > 0).length;
      if (usable >= data.limit) break;
    }

    const out: RankedParkingOption[] = [];
    for (const r of rawRows) {
      if (data.excludeSegmentId && r.id === data.excludeSegmentId) continue;
      let coords: [number, number][] = [];
      try {
        const g = JSON.parse(r.geojson) as LineString;
        if (Array.isArray(g.coordinates)) coords = g.coordinates as [number, number][];
      } catch { /* ignore */ }
      const seg: StreetSegment = {
        id: r.id, name: r.name, side: r.side, neighborhood: null,
        coordinates: coords, rules: (r.rules ?? []) as ParkingRule[], events: [],
      };
      const decision = buildParkingDecision(seg, restrictionTypes, when, data.timezone);
      if (decision.status.color === "red") continue;
      if (!data.includeLimited && decision.status.color === "yellow") continue;

      const confidence = scoreConfidence({
        matchedRule: decision.status.rule_id != null || decision.status.event_id != null,
        conflictCount: 0,
        dataSource: r.data_source,
        ruleCount: seg.rules.length,
        lastSyncedAt: null,
      });
      const score = computeParkingScore({
        distance_m: r.distance_m,
        time_remaining_ms: decision.time_remaining_ms,
        confidence_score: confidence.score,
        color: decision.status.color,
      });

      out.push({
        segmentId: r.id,
        name: r.name,
        side: r.side,
        color: decision.status.color,
        label: decision.status.label,
        restriction_code: decision.status.code,
        distance_m: r.distance_m,
        walking_seconds: Math.round(r.distance_m / 1.33),
        coordinates: coords,
        allowed_until: decision.status.allowed_until,
        permit_zone: decision.status.permit_zone,
        time_limit_minutes: decision.status.time_limit_minutes,
        time_remaining_ms: decision.time_remaining_ms,
        data_source: r.data_source,
        confidence_score: confidence.score,
        confidence_level: confidence.level,
        parking_score: score.score,
        score_parts: score.parts,
        search_tier_m: tierUsed,
      });
    }
    out.sort((a, b) => b.parking_score - a.parking_score);
    return out.slice(0, data.limit);
  });
