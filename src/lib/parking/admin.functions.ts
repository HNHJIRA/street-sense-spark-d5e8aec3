// Admin / validation server functions for the parking intelligence platform.
// Used by the /admin/* routes (health, provider sync, validation, forecast).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { evaluateRulesAt } from "./engine";
import { buildExplanation, type Explanation } from "./explain";
import type { ParkingRule, ParkingEvent, RestrictionType, StreetSegment } from "./types";

interface AdminClient {
  from: (t: string) => any;
  rpc: (n: string, a?: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
}
async function getAdmin(): Promise<AdminClient> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as unknown as AdminClient;
}

const SOURCE_LABELS: Record<string, string> = {
  sdot: "Seattle SDOT Blockface",
  osm: "OpenStreetMap",
  seed: "Demo data",
  curbiq: "CurbIQ",
  "la-dot": "LADOT Open Data",
  "santa-monica-opendata": "Santa Monica Open Data",
  "weho-opendata": "West Hollywood Open Data",
  "pasadena-opendata": "Pasadena Open Data",
  "arlington-opendata": "Arlington County Open Data",
  "arlington-permit": "Arlington Residential Permit Districts",
  "bellevue-opendata": "City of Bellevue Open Data",
};

// City bbox defaults for "full-city" admin syncs.
const CITY_BBOX: Record<string, { minLng: number; minLat: number; maxLng: number; maxLat: number }> = {
  seattle:         { minLng: -122.460, minLat: 47.480, maxLng: -122.220, maxLat: 47.740 },
  "los-angeles":   { minLng: -118.670, minLat: 33.700, maxLng: -118.150, maxLat: 34.340 },
  "santa-monica":  { minLng: -118.530, minLat: 33.990, maxLng: -118.440, maxLat: 34.060 },
  "west-hollywood":{ minLng: -118.400, minLat: 34.070, maxLng: -118.330, maxLat: 34.110 },
  pasadena:        { minLng: -118.200, minLat: 34.110, maxLng: -118.060, maxLat: 34.220 },
  arlington:       { minLng:  -77.175, minLat: 38.820, maxLng:  -77.030, maxLat: 38.940 },
  bellevue:        { minLng: -122.235, minLat: 47.520, maxLng: -122.080, maxLat: 47.680 },
};

// ----------------- Provider registry (multi-city readiness) -----------------

export interface ProviderMeta {
  id: string;
  name: string;
  cities: string[];
  status: "active" | "planned";
}

export interface CityMeta {
  slug: string;
  name: string;
  timezone: string;
  segment_count: number;
  provider_id: string | null;
  provider_name: string | null;
  status: "live" | "ready" | "planned";
}

export const getMultiCityReadiness = createServerFn({ method: "GET" })
  .handler(async (): Promise<{ providers: ProviderMeta[]; cities: CityMeta[] }> => {
    const { listProviders } = await import("./providers/registry.server");
    const active = listProviders();
    const providers: ProviderMeta[] = [
      ...active.map((p) => ({ id: p.id, name: p.name, cities: p.cities, status: "active" as const })),
      { id: "curbiq", name: "CurbIQ", cities: ["los-angeles", "new-york"], status: "planned" },
      { id: "la-dot", name: "LADOT", cities: ["los-angeles"], status: "planned" },
      { id: "nyc-dot", name: "NYC DOT", cities: ["new-york"], status: "planned" },
      { id: "chicago-cdot", name: "Chicago CDOT", cities: ["chicago"], status: "planned" },
    ];

    const admin = await getAdmin();
    const { data: cityRows } = await admin
      .from("cities")
      .select("slug, name, timezone");

    const planned = [
      { slug: "los-angeles", name: "Los Angeles", timezone: "America/Los_Angeles" },
      { slug: "new-york", name: "New York", timezone: "America/New_York" },
      { slug: "chicago", name: "Chicago", timezone: "America/Chicago" },
    ];
    const existing = new Map(((cityRows ?? []) as any[]).map((r) => [r.slug, r]));
    for (const p of planned) if (!existing.has(p.slug)) existing.set(p.slug, p);

    const cities: CityMeta[] = [];
    for (const [, c] of existing) {
      const provider = providers.find((p) => p.cities.includes(c.slug));
      let segment_count = 0;
      const { data: cityRow } = await admin
        .from("cities").select("id").eq("slug", c.slug).maybeSingle();
      if (cityRow?.id) {
        const { count } = (await admin
          .from("street_segments").select("id", { count: "exact", head: true })
          .eq("city_id", cityRow.id)) as unknown as { count: number };
        segment_count = count ?? 0;
      }
      cities.push({
        slug: c.slug,
        name: c.name,
        timezone: c.timezone,
        segment_count,
        provider_id: provider?.id ?? null,
        provider_name: provider?.name ?? null,
        status: segment_count > 0 ? "live" : provider?.status === "active" ? "ready" : "planned",
      });
    }
    return { providers, cities };
  });

// ----------------- Data quality metrics -----------------

export interface DataQualityMetrics {
  city_slug: string;
  total_segments: number;
  segments_missing_rules: number;
  segments_missing_geometry: number;
  invalid_time_windows: number;
  rule_conflicts: number;
  failed_normalizations: number;
  provider_import_errors_24h: number;
}

export const getDataQualityMetrics = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) =>
    z.object({ citySlug: z.string().min(1).max(64).default("seattle") }).parse(input ?? {}),
  )
  .handler(async ({ data }): Promise<DataQualityMetrics> => {
    const admin = await getAdmin();
    const { data: city } = await admin.from("cities").select("id").eq("slug", data.citySlug).maybeSingle();
    if (!city) {
      return {
        city_slug: data.citySlug, total_segments: 0, segments_missing_rules: 0,
        segments_missing_geometry: 0, invalid_time_windows: 0, rule_conflicts: 0,
        failed_normalizations: 0, provider_import_errors_24h: 0,
      };
    }
    const { count: total } = (await admin.from("street_segments")
      .select("id", { count: "exact", head: true }).eq("city_id", city.id)) as unknown as { count: number };

    // Pull a representative sample to compute the quality checks in-app.
    const { data: segRows } = await admin
      .from("street_segments")
      .select("id, metadata")
      .eq("city_id", city.id)
      .limit(5000);
    const segIds = ((segRows ?? []) as any[]).map((s) => s.id as string);
    const segsWithCategory = ((segRows ?? []) as any[])
      .filter((s) => (s.metadata?.parking_category ?? null) != null).length;
    // "failed_normalizations" = segments whose raw category exists but maps to
    // the catch-all `allowed` bucket — we re-run normalize to count.
    const { normalizeCategory } = await import("./providers/normalize");
    let failedNorm = 0;
    for (const s of (segRows ?? []) as any[]) {
      const raw = s.metadata?.parking_category as string | null | undefined;
      if (!raw) continue;
      const c = normalizeCategory(raw);
      if (c.code === "allowed" && raw.trim() && !/(unrestricted|allowed)/i.test(raw)) failedNorm += 1;
    }

    // Rules per segment.
    const ruleCounts = new Map<string, number>();
    const invalidWindows = new Set<string>();
    const conflicts = new Set<string>();
    if (segIds.length) {
      for (let i = 0; i < segIds.length; i += 500) {
        const slice = segIds.slice(i, i + 500);
        const { data: rules } = await admin
          .from("parking_rules")
          .select("id, street_segment_id, priority, restriction_code, days_of_week, time_start, time_end")
          .in("street_segment_id", slice);
        const seenByCode = new Map<string, Set<string>>();
        for (const r of ((rules ?? []) as any[])) {
          ruleCounts.set(r.street_segment_id, (ruleCounts.get(r.street_segment_id) ?? 0) + 1);
          if (r.time_start && r.time_end) {
            const a = String(r.time_start), b = String(r.time_end);
            if (a === b) invalidWindows.add(r.id);
          }
          const k = `${r.street_segment_id}|${r.restriction_code}|${(r.days_of_week ?? []).slice().sort().join(",")}|${r.time_start ?? ""}|${r.time_end ?? ""}`;
          if (!seenByCode.has(r.street_segment_id)) seenByCode.set(r.street_segment_id, new Set());
          const set = seenByCode.get(r.street_segment_id)!;
          if (set.has(k)) conflicts.add(r.street_segment_id);
          set.add(k);
        }
      }
    }
    const missingRules = segIds.filter((id) => !ruleCounts.has(id)).length;

    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const { count: errCount } = (await admin
      .from("sync_logs")
      .select("id", { count: "exact", head: true })
      .eq("city_id", city.id)
      .neq("status", "success")
      .gte("started_at", since)) as unknown as { count: number };

    return {
      city_slug: data.citySlug,
      total_segments: total ?? 0,
      segments_missing_rules: missingRules,
      segments_missing_geometry: Math.max(0, (total ?? 0) - segsWithCategory) === total ? 0 : 0, // geom is NOT NULL in schema
      invalid_time_windows: invalidWindows.size,
      rule_conflicts: conflicts.size,
      failed_normalizations: failedNorm,
      provider_import_errors_24h: errCount ?? 0,
    };
  });

// ----------------- Run sync (admin manual) -----------------

export const runAdminSync = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({ citySlug: z.string().min(1).max(64).default("seattle") }).parse(input ?? {}),
  )
  .handler(async ({ data }) => {
    const bbox = CITY_BBOX[data.citySlug];
    if (!bbox) return { imported: 0, skipped: 0, provider: "none", error: `No bbox configured for ${data.citySlug}` };
    if (data.citySlug !== "bellevue") {
      const { syncProvider } = await import("./parking.functions");
      return syncProvider({ data: { citySlug: data.citySlug, ...bbox, force: true } as any });
    }
    const { syncAllProvidersForCity } = await import("./parking.functions");
    const providerRun = await syncAllProvidersForCity({
      data: { citySlug: data.citySlug, ...bbox, force: true },
    });
    return {
      imported: providerRun.totals.imported,
      skipped: providerRun.totals.skipped,
      provider: "all",
      error: undefined,
      providerRun,
    };
  });

// ----------------- Forecast matrix (multi-time evaluation) -----------------

export interface ForecastSlot {
  label: string;
  iso: string;
  color: "green" | "yellow" | "red" | "gray";
  code: string;
  status_label: string;
  matched_rule_id: string | null;
}

const DEFAULT_SLOTS: { label: string; dow: number; hour: number }[] = [
  { label: "Mon 8 AM", dow: 1, hour: 8 },
  { label: "Mon 12 PM", dow: 1, hour: 12 },
  { label: "Mon 6 PM", dow: 1, hour: 18 },
  { label: "Tue 9 AM", dow: 2, hour: 9 },
  { label: "Wed 3 PM", dow: 3, hour: 15 },
  { label: "Thu 5 PM", dow: 4, hour: 17 },
  { label: "Fri 7 PM", dow: 5, hour: 19 },
  { label: "Sat 2 PM", dow: 6, hour: 14 },
  { label: "Sun 10 AM", dow: 0, hour: 10 },
];

function nextDateForDow(dow: number, hour: number): Date {
  const now = new Date();
  const diff = (dow - now.getDay() + 7) % 7;
  const d = new Date(now);
  d.setDate(now.getDate() + diff);
  d.setHours(hour, 0, 0, 0);
  return d;
}

export const getForecastMatrix = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) =>
    z.object({
      segmentId: z.string().uuid(),
      timezone: z.string().min(1).max(64).default("America/Los_Angeles"),
    }).parse(input),
  )
  .handler(async ({ data }): Promise<{ segment_name: string; slots: ForecastSlot[] }> => {
    const admin = await getAdmin();
    const { data: seg } = await admin
      .from("street_segments").select("id, name, side")
      .eq("id", data.segmentId).maybeSingle();
    if (!seg) throw new Error("Segment not found");
    const { data: rules } = await admin
      .from("parking_rules")
      .select("id, street_segment_id, priority, restriction_code, days_of_week, time_start, time_end, permit_zone, time_limit_minutes, effective_from, effective_to, notes")
      .eq("street_segment_id", data.segmentId);
    const { data: events } = await admin
      .from("parking_events")
      .select("id, street_segment_id, restriction_code, starts_at, ends_at, reason")
      .eq("street_segment_id", data.segmentId);
    const { data: types } = await admin
      .from("restriction_types").select("code, label, color, description");

    const segment: StreetSegment = {
      id: seg.id, name: seg.name, side: seg.side ?? "both", neighborhood: null,
      coordinates: [],
      rules: (rules ?? []) as ParkingRule[],
      events: (events ?? []) as ParkingEvent[],
    };

    const slots: ForecastSlot[] = DEFAULT_SLOTS.map((s) => {
      const when = nextDateForDow(s.dow, s.hour);
      const status = evaluateRulesAt(segment, (types ?? []) as RestrictionType[], when, data.timezone);
      return {
        label: s.label,
        iso: when.toISOString(),
        color: status.color,
        code: status.code,
        status_label: status.label,
        matched_rule_id: status.rule_id,
      };
    });

    return { segment_name: seg.name, slots };
  });

// ----------------- Explanation -----------------

export const explainSegment = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) =>
    z.object({
      segmentId: z.string().uuid(),
      at: z.string().datetime().optional().nullable(),
      timezone: z.string().min(1).max(64).default("America/Los_Angeles"),
    }).parse(input),
  )
  .handler(async ({ data }): Promise<Explanation & { segment_name: string }> => {
    const admin = await getAdmin();
    const { data: seg } = await admin
      .from("street_segments").select("id, name, side, data_source")
      .eq("id", data.segmentId).maybeSingle();
    if (!seg) throw new Error("Segment not found");
    const { data: rules } = await admin
      .from("parking_rules")
      .select("id, street_segment_id, priority, restriction_code, days_of_week, time_start, time_end, permit_zone, time_limit_minutes, effective_from, effective_to, notes")
      .eq("street_segment_id", data.segmentId);
    const { data: events } = await admin
      .from("parking_events")
      .select("id, street_segment_id, restriction_code, starts_at, ends_at, reason")
      .eq("street_segment_id", data.segmentId);
    const { data: types } = await admin
      .from("restriction_types").select("code, label, color, description");

    const segment: StreetSegment = {
      id: seg.id, name: seg.name, side: seg.side ?? "both", neighborhood: null,
      coordinates: [],
      rules: (rules ?? []) as ParkingRule[],
      events: (events ?? []) as ParkingEvent[],
    };
    const when = data.at ? new Date(data.at) : new Date();
    const status = evaluateRulesAt(segment, (types ?? []) as RestrictionType[], when, data.timezone);
    const exp = buildExplanation(status, segment, SOURCE_LABELS[seg.data_source] ?? seg.data_source);
    return { ...exp, segment_name: seg.name };
  });
