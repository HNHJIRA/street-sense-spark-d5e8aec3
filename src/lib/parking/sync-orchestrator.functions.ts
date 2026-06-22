// Production sync orchestrator.
//
// Wraps `syncAllProvidersForCity` (and per-provider `syncProvider`) with:
//   - Postgres advisory locking → duplicate runs return `already_running`.
//   - Provider-health bookkeeping (started/completed/duration/imported/skipped/status/error).
//   - A single entry point used by both cron routes and admin UI buttons.
//
// Map / session / scan code paths must NEVER call this — they read
// already-synced data from PostGIS (see `getSegmentsInBbox`).

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

interface AdminClient {
  from: (t: string) => any;
  rpc: (n: string, a?: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
}
async function getAdmin(): Promise<AdminClient> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as unknown as AdminClient;
}

// City bboxes (kept here so the orchestrator is self-contained).
const CITY_BBOX: Record<string, { minLng: number; minLat: number; maxLng: number; maxLat: number }> = {
  seattle:          { minLng: -122.460, minLat: 47.480, maxLng: -122.220, maxLat: 47.740 },
  "los-angeles":    { minLng: -118.700, minLat: 33.700, maxLng: -118.000, maxLat: 34.350 },
  "santa-monica":   { minLng: -118.550, minLat: 33.970, maxLng: -118.420, maxLat: 34.080 },
  "west-hollywood": { minLng: -118.410, minLat: 34.070, maxLng: -118.330, maxLat: 34.110 },
  pasadena:         { minLng: -118.220, minLat: 34.120, maxLng: -118.050, maxLat: 34.220 },
  arlington:        { minLng:  -77.175, minLat: 38.820, maxLng:  -77.030, maxLat: 38.940 },
  bellevue:         { minLng: -122.235, minLat: 47.520, maxLng: -122.080, maxLat: 47.680 },
  nyc:              { minLng:  -74.2591, minLat: 40.4774, maxLng: -73.7000, maxLat: 40.9176 },
};

export type SyncMode = "full" | "incremental";
export type SyncTrigger = "cron" | "manual" | "webhook";

export interface OrchestratorProviderResult {
  provider: string;
  providerName?: string;
  imported: number;
  skipped: number;
  error?: string;
}

export interface OrchestratorResult {
  ok: boolean;
  status: "completed" | "already_running" | "error";
  city: string;
  mode: SyncMode;
  trigger: SyncTrigger;
  message?: string;
  imported?: number;
  skipped?: number;
  duration_ms?: number;
  results?: OrchestratorProviderResult[];
}

function lockKey(citySlug: string, providerId: string | undefined, mode: SyncMode): string {
  return `sync:${citySlug}:${providerId ?? "all"}:${mode}`;
}

async function acquireLock(admin: AdminClient, key: string): Promise<boolean> {
  const { data, error } = await admin.rpc("try_acquire_sync_lock", { p_key: key });
  if (error) return false;
  return data === true;
}

async function releaseLock(admin: AdminClient, key: string): Promise<void> {
  await admin.rpc("release_sync_lock", { p_key: key });
}

async function markRunning(
  admin: AdminClient,
  cityId: string,
  providerIds: string[],
  startedAt: string,
) {
  if (providerIds.length === 0) return;
  await admin.from("provider_health").update({
    last_sync_started_at: startedAt,
    provider_status: "running",
    provider_error: null,
  }).eq("city_id", cityId).in("provider", providerIds);
}

async function markFinished(
  admin: AdminClient,
  cityId: string,
  providerResults: Array<{ provider: string; imported: number; skipped: number; error?: string }>,
  startedAt: number,
  mode: SyncMode,
) {
  const completedAt = new Date().toISOString();
  const duration = Date.now() - startedAt;
  for (const r of providerResults) {
    const status = r.error ? (r.imported > 0 ? "warning" : "failed") : "healthy";
    const patch: Record<string, unknown> = {
      last_sync_completed_at: completedAt,
      records_imported: r.imported,
      records_skipped: r.skipped,
      duration_ms: duration,
      provider_status: status,
      provider_error: r.error ?? null,
    };
    if (!r.error && mode === "incremental") {
      patch.last_incremental_at = completedAt;
    }
    await admin.from("provider_health")
      .update(patch)
      .eq("provider", r.provider)
      .eq("city_id", cityId);
  }
}

/**
 * Run a sync for a city. Acquires an advisory lock so duplicate runs are
 * rejected with `already_running` instead of piling up.
 */
export const runSync = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({
      citySlug: z.string().min(1).max(64),
      mode: z.enum(["full", "incremental"]).default("full"),
      trigger: z.enum(["cron", "manual", "webhook"]).default("manual"),
      providerId: z.string().min(1).max(64).optional(),
      providerParams: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
      bbox: z.object({
        minLng: z.number(), minLat: z.number(),
        maxLng: z.number(), maxLat: z.number(),
      }).optional(),
    }).parse(input),
  )
  .handler(async ({ data }): Promise<OrchestratorResult> => {
    const bbox = data.bbox ?? CITY_BBOX[data.citySlug];
    if (!bbox) {
      return {
        ok: false, status: "error",
        city: data.citySlug, mode: data.mode, trigger: data.trigger,
        message: `No bbox configured for "${data.citySlug}"`,
      };
    }

    const admin = await getAdmin();
    const key = lockKey(data.citySlug, data.providerId, data.mode);

    const acquired = await acquireLock(admin, key);
    if (!acquired) {
      return {
        ok: false, status: "already_running",
        city: data.citySlug, mode: data.mode, trigger: data.trigger,
        message: "Sync already in progress",
      };
    }

    const startedAtMs = Date.now();
    const startedAtIso = new Date().toISOString();

    try {
      const { data: city } = await admin
        .from("cities").select("id").eq("slug", data.citySlug).maybeSingle();
      if (!city) {
        return {
          ok: false, status: "error",
          city: data.citySlug, mode: data.mode, trigger: data.trigger,
          message: "City not found",
        };
      }

      // Resolve providers we'll touch so we can mark them "running".
      const { getProvidersForCity, getProviderById } = await import("./providers/registry.server");
      const providers = data.providerId
        ? [getProviderById(data.providerId)].filter(Boolean) as { id: string }[]
        : getProvidersForCity(data.citySlug);
      const providerIds = providers.map((p) => p.id);
      await markRunning(admin, city.id as string, providerIds, startedAtIso);

      const { syncAllProvidersForCity } = await import("./parking.functions");
      const run = await syncAllProvidersForCity({
        data: {
          citySlug: data.citySlug,
          ...bbox,
          force: true,
          onlyProviderId: data.providerId,
          providerParams: data.providerParams,
        },
      });

      await markFinished(
        admin,
        city.id as string,
        run.results.map((r) => ({
          provider: r.provider,
          imported: r.imported,
          skipped: r.skipped,
          error: r.error,
        })),
        startedAtMs,
        data.mode,
      );

      return {
        ok: true, status: "completed",
        city: data.citySlug, mode: data.mode, trigger: data.trigger,
        imported: run.totals.imported,
        skipped: run.totals.skipped,
        duration_ms: Date.now() - startedAtMs,
        results: run.results,
      };
    } catch (e) {
      return {
        ok: false, status: "error",
        city: data.citySlug, mode: data.mode, trigger: data.trigger,
        message: (e as Error).message,
        duration_ms: Date.now() - startedAtMs,
      };
    } finally {
      await releaseLock(admin, key);
    }
  });

// ---------- Freshness dashboard read ----------

export interface FreshnessRow {
  provider: string;
  city_slug: string | null;
  city_name: string | null;
  status: "healthy" | "warning" | "failed" | "running" | "unknown";
  last_success_at: string | null;
  last_sync_started_at: string | null;
  last_sync_completed_at: string | null;
  next_scheduled_at: string | null;
  records_imported: number;
  records_skipped: number;
  duration_ms: number | null;
  supports_incremental: boolean;
  last_incremental_at: string | null;
  last_error: string | null;
  segments_total: number;
}

export const getFreshness = createServerFn({ method: "GET" })
  .handler(async (): Promise<FreshnessRow[]> => {
    const admin = await getAdmin();
    const { data: rows } = await admin
      .from("provider_health")
      .select(
        "provider, healthy, last_success_at, last_sync_started_at, last_sync_completed_at, " +
        "next_scheduled_at, records_imported, records_skipped, duration_ms, " +
        "provider_status, provider_error, supports_incremental, last_incremental_at, " +
        "last_error, segments_total, cities(slug, name)",
      )
      .order("provider");
    return ((rows ?? []) as any[]).map((r) => ({
      provider: r.provider,
      city_slug: r.cities?.slug ?? null,
      city_name: r.cities?.name ?? null,
      status: (r.provider_status ?? (r.healthy ? "healthy" : "failed")) as FreshnessRow["status"],
      last_success_at: r.last_success_at,
      last_sync_started_at: r.last_sync_started_at,
      last_sync_completed_at: r.last_sync_completed_at,
      next_scheduled_at: r.next_scheduled_at,
      records_imported: r.records_imported ?? 0,
      records_skipped: r.records_skipped ?? 0,
      duration_ms: r.duration_ms,
      supports_incremental: r.supports_incremental ?? false,
      last_incremental_at: r.last_incremental_at,
      last_error: r.provider_error ?? r.last_error,
      segments_total: r.segments_total ?? 0,
    }));
  });
