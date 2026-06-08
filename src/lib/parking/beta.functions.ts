// Server fns for Phase 5 beta readiness: user reports, usage analytics,
// and the beta-readiness audit. All admin DB access stays inside .handler()
// so the service-role import never leaks to the client bundle.
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

// ---------- Reports ----------

export const submitReport = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({
      deviceId: z.string().min(1).max(128),
      reportType: z.enum(["incorrect_result", "wrong_sign", "wrong_street_data", "other"]),
      surface: z.enum(["park_here", "forecast", "session", "street", "scan", "other"]),
      message: z.string().min(1).max(2000),
      segmentId: z.string().uuid().nullable().optional(),
      scanId: z.string().uuid().nullable().optional(),
      context: z.record(z.string(), z.unknown()).optional(),
    }).parse(input),
  )
  .handler(async ({ data }): Promise<{ id: string }> => {
    const admin = await getAdmin();
    const { data: row, error } = await admin.from("user_reports").insert({
      device_id: data.deviceId,
      report_type: data.reportType,
      surface: data.surface,
      segment_id: data.segmentId ?? null,
      scan_id: data.scanId ?? null,
      message: data.message,
      context: data.context ?? {},
    }).select("id").maybeSingle();
    if (error) throw new Error((error as { message?: string }).message ?? "Failed to submit report");
    return { id: (row as { id: string }).id };
  });

export interface UserReportRow {
  id: string;
  created_at: string;
  device_id: string;
  report_type: string;
  surface: string;
  segment_id: string | null;
  scan_id: string | null;
  message: string;
  status: string;
  segment_name: string | null;
}

export const listReports = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) =>
    z.object({ limit: z.number().int().min(1).max(200).default(100) }).parse(input ?? {}),
  )
  .handler(async ({ data }): Promise<UserReportRow[]> => {
    const admin = await getAdmin();
    const { data: rows } = await admin
      .from("user_reports")
      .select("id, created_at, device_id, report_type, surface, segment_id, scan_id, message, status, street_segments(name)")
      .order("created_at", { ascending: false })
      .limit(data.limit);
    return ((rows ?? []) as any[]).map((r) => ({
      id: r.id, created_at: r.created_at, device_id: r.device_id,
      report_type: r.report_type, surface: r.surface,
      segment_id: r.segment_id, scan_id: r.scan_id,
      message: r.message, status: r.status,
      segment_name: r.street_segments?.name ?? null,
    }));
  });

// ---------- Analytics ----------

export const trackEvent = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({
      deviceId: z.string().min(1).max(128),
      eventName: z.string().min(1).max(64).regex(/^[a-z0-9_]+$/),
      surface: z.string().min(1).max(64).nullable().optional(),
      properties: z.record(z.string(), z.unknown()).optional(),
    }).parse(input),
  )
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const admin = await getAdmin();
    await admin.from("usage_events").insert({
      device_id: data.deviceId,
      event_name: data.eventName,
      surface: data.surface ?? null,
      properties: data.properties ?? {},
    });
    return { ok: true };
  });

export interface UsageStat {
  event_name: string;
  count_7d: number;
  count_24h: number;
  unique_devices_7d: number;
}

export interface UsageOverview {
  totals: UsageStat[];
  daily: Array<{ day: string; total: number }>;
  totalEvents7d: number;
  totalDevices7d: number;
}

export const getUsageStats = createServerFn({ method: "GET" })
  .handler(async (): Promise<UsageOverview> => {
    const admin = await getAdmin();
    const since7 = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
    const since24 = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const { data: rows7 } = await admin.from("usage_events")
      .select("event_name, device_id, occurred_at")
      .gte("occurred_at", since7)
      .limit(20000);
    const list = (rows7 ?? []) as Array<{ event_name: string; device_id: string; occurred_at: string }>;

    const byEvent = new Map<string, { c7: number; c24: number; devs: Set<string> }>();
    const dayBuckets = new Map<string, number>();
    const allDevs = new Set<string>();
    const cut24 = new Date(since24).getTime();
    for (const r of list) {
      allDevs.add(r.device_id);
      const e = byEvent.get(r.event_name) ?? { c7: 0, c24: 0, devs: new Set<string>() };
      e.c7 += 1;
      if (new Date(r.occurred_at).getTime() >= cut24) e.c24 += 1;
      e.devs.add(r.device_id);
      byEvent.set(r.event_name, e);
      const day = r.occurred_at.slice(0, 10);
      dayBuckets.set(day, (dayBuckets.get(day) ?? 0) + 1);
    }

    const totals: UsageStat[] = [...byEvent.entries()]
      .map(([event_name, v]) => ({
        event_name, count_7d: v.c7, count_24h: v.c24, unique_devices_7d: v.devs.size,
      }))
      .sort((a, b) => b.count_7d - a.count_7d);

    const daily = [...dayBuckets.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([day, total]) => ({ day, total }));

    return {
      totals,
      daily,
      totalEvents7d: list.length,
      totalDevices7d: allDevs.size,
    };
  });

// ---------- Beta Readiness Report ----------

export interface BetaItem {
  category: "Risk" | "Limitation" | "Coverage Gap" | "Accuracy" | "Provider" | "Failure Case";
  severity: "low" | "medium" | "high";
  title: string;
  detail: string;
}

export interface BetaReadinessReport {
  generated_at: string;
  overall: "ready" | "needs_work" | "blocked";
  cities_live: number;
  segments_total: number;
  segments_with_rules: number;
  rule_conflicts: number;
  open_reports: number;
  failed_syncs_7d: number;
  scans_last_7d: number;
  low_confidence_scans_7d: number;
  items: BetaItem[];
}

export const getBetaReadiness = createServerFn({ method: "GET" })
  .handler(async (): Promise<BetaReadinessReport> => {
    const admin = await getAdmin();
    const since7 = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();

    // Cities & coverage.
    const { data: cityRows } = await admin.from("cities").select("id, slug, name");
    const cities = (cityRows ?? []) as Array<{ id: string; slug: string; name: string }>;
    let segmentsTotal = 0;
    let citiesLive = 0;
    for (const c of cities) {
      const { count } = (await admin.from("street_segments")
        .select("id", { count: "exact", head: true }).eq("city_id", c.id)) as unknown as { count: number };
      segmentsTotal += count ?? 0;
      if ((count ?? 0) > 0) citiesLive += 1;
    }

    // Rules coverage.
    const { count: rulesCount } = (await admin.from("parking_rules")
      .select("id", { count: "exact", head: true })) as unknown as { count: number };
    const segmentsWithRules = rulesCount ?? 0; // rough — many segments share rule rows 1:1

    // Conflicts proxy: duplicate (segment, code, days, start, end).
    let ruleConflicts = 0;
    {
      const { data } = await admin.from("parking_rules")
        .select("street_segment_id, restriction_code, days_of_week, time_start, time_end")
        .limit(20000);
      const seen = new Set<string>();
      const dupSegs = new Set<string>();
      for (const r of ((data ?? []) as any[])) {
        const k = `${r.street_segment_id}|${r.restriction_code}|${(r.days_of_week ?? []).slice().sort().join(",")}|${r.time_start ?? ""}|${r.time_end ?? ""}`;
        if (seen.has(k)) dupSegs.add(r.street_segment_id);
        seen.add(k);
      }
      ruleConflicts = dupSegs.size;
    }

    const { count: openReports } = (await admin.from("user_reports")
      .select("id", { count: "exact", head: true }).eq("status", "open")) as unknown as { count: number };

    const { count: failedSyncs } = (await admin.from("sync_logs")
      .select("id", { count: "exact", head: true })
      .neq("status", "success").gte("started_at", since7)) as unknown as { count: number };

    const { data: scans } = await admin.from("parking_sign_scans")
      .select("id, overall_confidence, created_at")
      .gte("created_at", since7).limit(5000);
    const scanRows = (scans ?? []) as Array<{ overall_confidence: number | null }>;
    const lowConfScans = scanRows.filter((s) => (s.overall_confidence ?? 1) < 0.6).length;

    const items: BetaItem[] = [];

    if (citiesLive < 2) {
      items.push({
        category: "Coverage Gap", severity: "medium",
        title: `Only ${citiesLive} city live in beta`,
        detail: "Multi-city architecture is ready, but only Seattle has imported data. LA, NYC, Chicago providers are planned.",
      });
    }
    if (ruleConflicts > 0) {
      items.push({
        category: "Accuracy", severity: ruleConflicts > 50 ? "high" : "medium",
        title: `${ruleConflicts} segments contain duplicate rule rows`,
        detail: "The conflict resolver dedupes at runtime, but raw duplicates hint at provider import issues to investigate.",
      });
    }
    if ((failedSyncs ?? 0) > 0) {
      items.push({
        category: "Provider", severity: (failedSyncs ?? 0) > 5 ? "high" : "medium",
        title: `${failedSyncs} provider sync failures in the last 7 days`,
        detail: "Check /admin/health and /admin/provider-sync for the failing provider and re-run if appropriate.",
      });
    }
    if ((openReports ?? 0) > 0) {
      items.push({
        category: "Risk", severity: (openReports ?? 0) > 10 ? "high" : "medium",
        title: `${openReports} open user reports`,
        detail: "Triage at /admin/reports — incorrect engine decisions should be addressed before public beta.",
      });
    }
    if (lowConfScans > 0) {
      items.push({
        category: "Accuracy", severity: lowConfScans > 5 ? "medium" : "low",
        title: `${lowConfScans} low-confidence sign scans (<60%) in 7d`,
        detail: "Photos with bad lighting or angles drag accuracy down. Onboarding should coach users to frame signs head-on.",
      });
    }

    items.push({
      category: "Limitation", severity: "medium",
      title: "Anonymous device storage only",
      detail: "Saved spots, sessions, alerts, and search history live in localStorage. Clearing browser data wipes them; nothing syncs across devices.",
    });
    items.push({
      category: "Limitation", severity: "low",
      title: "Notifications limited to browser permission",
      detail: "Push notifications use the Web Notifications API. Mobile background delivery is best-effort; alerts always also show in-app.",
    });
    items.push({
      category: "Provider", severity: "medium",
      title: "Single live provider (SDOT)",
      detail: "All Seattle data depends on the SDOT Blockface feed. If SDOT changes its schema, sync may fail until the normalizer is updated.",
    });
    items.push({
      category: "Failure Case", severity: "medium",
      title: "Temporary signs override SDOT",
      detail: "Construction/event signs posted after the last SDOT sync will be missed until the user scans them. Encourage scanning for any suspicious posted sign.",
    });
    items.push({
      category: "Failure Case", severity: "low",
      title: "GPS accuracy near tall buildings",
      detail: "‘Can I park here?’ uses the nearest segment within 80 m. Indoor or dense-urban GPS can pick the wrong side of the street.",
    });
    items.push({
      category: "Risk", severity: "low",
      title: "AI sign scanner is advisory",
      detail: "Vision OCR can mis-read stacked signs. Engine output marked LIMITED/NO should always be cross-checked against the actual sign.",
    });

    const high = items.filter((i) => i.severity === "high").length;
    const overall: BetaReadinessReport["overall"] =
      high >= 2 ? "blocked" : high === 1 || items.filter((i) => i.severity === "medium").length >= 4 ? "needs_work" : "ready";

    return {
      generated_at: new Date().toISOString(),
      overall,
      cities_live: citiesLive,
      segments_total: segmentsTotal,
      segments_with_rules: segmentsWithRules,
      rule_conflicts: ruleConflicts,
      open_reports: openReports ?? 0,
      failed_syncs_7d: failedSyncs ?? 0,
      scans_last_7d: scanRows.length,
      low_confidence_scans_7d: lowConfScans,
      items,
    };
  });
