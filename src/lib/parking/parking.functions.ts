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

export interface SyncRunResult {
  imported: number;
  skipped: number;
  provider: string;
  error?: string;
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
    }).parse(input),
  )
  .handler(async ({ data }): Promise<SyncRunResult> => {
    const w = Math.abs(data.maxLng - data.minLng);
    const h = Math.abs(data.maxLat - data.minLat);
    if (!data.force && w * h > 0.05) return { imported: 0, skipped: 0, provider: "unknown", error: "Zoom in to load detailed street data." };

    const { getProviderForCity } = await import("./providers/registry.server");
    const provider = getProviderForCity(data.citySlug);
    if (!provider) {
      return { imported: 0, skipped: 0, provider: "none", error: `No provider for city "${data.citySlug}"` };
    }

    const admin = await getAdmin();
    const { data: city } = await admin.from("cities").select("id").eq("slug", data.citySlug).maybeSingle();
    if (!city) throw new Error("City not found");

    const bbox = { minLng: data.minLng, minLat: data.minLat, maxLng: data.maxLng, maxLat: data.maxLat };
    const startedAt = Date.now();
    const logId = await recordSyncStart(admin, provider.id, city.id, bbox);

    try {
      const normalized = await provider.fetchSegments(data.citySlug, bbox);
      if (normalized.length === 0) {
        const res = { imported: 0, skipped: 0 };
        await recordSyncFinish(admin, logId, provider.id, city.id, res, startedAt);
        return { ...res, provider: provider.id };
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

      // Replace rules per segment with the normalized rule set.
      const rulesByExt = new Map(normalized.map((s) => [s.external_id, s.rules]));
      const ids = insertedIds.map((r) => r.id);
      for (let i = 0; i < ids.length; i += 500) {
        const slice = ids.slice(i, i + 500);
        await admin.from("parking_rules").delete().in("street_segment_id", slice);
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
          })));
        if (ruleRows.length) await admin.from("parking_rules").insert(ruleRows);
      }

      const res = { imported, skipped: inserts.length - imported };
      await recordSyncFinish(admin, logId, provider.id, city.id, res, startedAt);
      return { ...res, provider: provider.id };
    } catch (e) {
      const res = { imported: 0, skipped: 0, error: (e as Error).message };
      await recordSyncFinish(admin, logId, provider.id, city.id, res, startedAt);
      return { ...res, provider: provider.id };
    }
  });

/** Back-compat alias for the existing MapView import. */
export const importSeattleBlockface = syncProvider;

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
      coordinates: coords,
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
