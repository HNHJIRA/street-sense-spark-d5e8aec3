// Parking Accuracy Dashboard — P0 stabilization output.
// Aggregates scan match rate, verdict distribution, provider/occupancy freshness,
// rule coverage, and unknown coverage from the production database.
import { createServerFn } from "@tanstack/react-start";

interface AdminClient {
  from: (t: string) => any;
  rpc: (n: string, a?: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
}
async function getAdmin(): Promise<AdminClient> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as unknown as AdminClient;
}

export interface AccuracyReport {
  generatedAt: string;
  scans: {
    total: number;
    matchRate: number;          // share of scans with match_status='matched'
    byMatchStatus: Record<string, number>;
    byVerdict: Record<string, number>;
    byOutcome: Record<string, number>;
    withVerdictPersisted: number;
  };
  providers: { id: string; status: string; last_synced_at: string | null; ageMinutes: number | null }[];
  occupancy: { rows: number; freshestEventTime: string | null; freshestAgeMinutes: number | null; spaces: number };
  rules: {
    byCity: { city: string; segments: number; rules: number; rulesPerSegment: number; oneRuleSegments: number; zeroRuleSegments: number; twoPlusSegments: number; multiRulePct: number; depth: Record<string, number> }[];
    byRestriction: { restriction_code: string; count: number }[];
    bySource: { data_source: string; rules: number }[];
  };
  seattleAudit: {
    segments: number;
    oneRuleSegments: number;
    twoPlusRuleSegments: number;
    permitSegments: number;
    timeLimitedSegments: number;
    cleaningSegments: number;
  };
  scannerSelfTest: { count: number; pass: number; byCity: Record<string, { pass: number; fail: number }> };
}

export const getAccuracyReport = createServerFn({ method: "GET" }).handler(async (): Promise<AccuracyReport> => {
  const admin = await getAdmin();
  const now = Date.now();

  // -- Scans
  const { data: scans } = await admin.from("parking_sign_scans")
    .select("verdict, match_status").limit(10000);
  const scanRows = (scans ?? []) as { verdict: string | null; match_status: string | null }[];
  const byMatchStatus: Record<string, number> = {};
  const byVerdict: Record<string, number> = {};
  let withVerdict = 0;
  for (const s of scanRows) {
    const ms = s.match_status ?? "unknown";
    byMatchStatus[ms] = (byMatchStatus[ms] ?? 0) + 1;
    const v = s.verdict ?? "null";
    byVerdict[v] = (byVerdict[v] ?? 0) + 1;
    if (s.verdict) withVerdict += 1;
  }
  const matchRate = scanRows.length ? (byMatchStatus["matched"] ?? 0) / scanRows.length : 0;

  const { data: vRows } = await admin.from("scan_validation_results")
    .select("outcome").limit(10000);
  const byOutcome: Record<string, number> = {};
  for (const r of ((vRows ?? []) as { outcome: string }[])) {
    byOutcome[r.outcome] = (byOutcome[r.outcome] ?? 0) + 1;
  }

  // -- Providers
  const { data: provRows } = await admin.from("provider_health")
    .select("provider_id, status, last_synced_at").limit(50);
  const providers = ((provRows ?? []) as { provider_id: string; status: string; last_synced_at: string | null }[])
    .map((p) => ({
      id: p.provider_id,
      status: p.status,
      last_synced_at: p.last_synced_at,
      ageMinutes: p.last_synced_at ? Math.round((now - new Date(p.last_synced_at).getTime()) / 60000) : null,
    }));

  // -- Occupancy
  const occRpc = await admin.rpc("la_area_counts").then(
    (r) => r,
    () => ({ data: null }),
  );
  void occRpc;
  const { data: occHead } = await admin.from("la_meter_occupancy")
    .select("event_time").order("event_time", { ascending: false }).limit(1);
  const occCountRes = await admin.from("la_meter_occupancy").select("space_id", { count: "exact", head: true });
  const spaceCountRes = await admin.from("la_meter_spaces").select("space_id", { count: "exact", head: true });
  const occCount = (occCountRes as { count: number | null }).count ?? 0;
  const spaceCount = (spaceCountRes as { count: number | null }).count ?? 0;
  const freshest = (occHead as { event_time: string }[] | null)?.[0]?.event_time ?? null;


  // -- Rule coverage by city
  const { data: cities } = await admin.from("cities").select("id, slug, name");
  const cityRows = (cities ?? []) as { id: string; slug: string; name: string }[];
  const byCity: AccuracyReport["rules"]["byCity"] = [];
  for (const c of cityRows) {
    const { count: segCount } = await admin.from("street_segments")
      .select("id", { count: "exact", head: true }).eq("city_id", c.id);
    const { data: ruleCounts } = await admin.from("street_segments")
      .select("id, parking_rules(id)").eq("city_id", c.id).limit(20000);
    let totalRules = 0, one = 0, zero = 0, twoPlus = 0;
    const depth: Record<string, number> = { "0": 0, "1": 0, "2": 0, "3": 0, "4": 0, "5+": 0 };
    for (const s of ((ruleCounts ?? []) as { parking_rules: { id: string }[] }[])) {
      const n = s.parking_rules?.length ?? 0;
      totalRules += n;
      if (n === 0) { zero += 1; depth["0"] += 1; }
      else if (n === 1) { one += 1; depth["1"] += 1; }
      else {
        twoPlus += 1;
        depth[n >= 5 ? "5+" : String(n)] += 1;
      }
    }
    const segs = segCount ?? 0;
    byCity.push({
      city: c.name,
      segments: segs,
      rules: totalRules,
      rulesPerSegment: segs ? Math.round((totalRules / segs) * 100) / 100 : 0,
      oneRuleSegments: one,
      zeroRuleSegments: zero,
      twoPlusSegments: twoPlus,
      multiRulePct: segs ? Math.round((twoPlus / segs) * 1000) / 10 : 0,
      depth,
    });
  }

  // -- Rules by data_source
  const { data: srcRows } = await admin.from("parking_rules").select("data_source").limit(50000);
  const srcMap = new Map<string, number>();
  for (const r of ((srcRows ?? []) as { data_source: string | null }[])) {
    const k = r.data_source ?? "unknown";
    srcMap.set(k, (srcMap.get(k) ?? 0) + 1);
  }
  const bySource = Array.from(srcMap.entries())
    .map(([data_source, rules]) => ({ data_source, rules }))
    .sort((a, b) => b.rules - a.rules);


  // -- Global restriction distribution
  const { data: restr } = await admin.rpc("restriction_distribution").catch(() => ({ data: null }));
  let byRestriction: { restriction_code: string; count: number }[] = [];
  if (Array.isArray(restr)) {
    byRestriction = (restr as { restriction_code: string; count: number | string }[]).map((r) => ({
      restriction_code: r.restriction_code,
      count: Number(r.count),
    }));
  } else {
    const { data: rules } = await admin.from("parking_rules").select("restriction_code").limit(50000);
    const m = new Map<string, number>();
    for (const r of ((rules ?? []) as { restriction_code: string }[])) {
      m.set(r.restriction_code, (m.get(r.restriction_code) ?? 0) + 1);
    }
    byRestriction = Array.from(m.entries()).map(([restriction_code, count]) => ({ restriction_code, count }))
      .sort((a, b) => b.count - a.count);
  }

  // -- Seattle audit
  const seattle = cityRows.find((c) => c.slug === "seattle");
  let seattleAudit: AccuracyReport["seattleAudit"] = {
    segments: 0, oneRuleSegments: 0, twoPlusRuleSegments: 0,
    permitSegments: 0, timeLimitedSegments: 0, cleaningSegments: 0,
  };
  if (seattle) {
    const { data: segs } = await admin.from("street_segments")
      .select("id, parking_rules(restriction_code)").eq("city_id", seattle.id).limit(20000);
    const rows = (segs ?? []) as { id: string; parking_rules: { restriction_code: string }[] }[];
    let one = 0, twoPlus = 0, permit = 0, tl = 0, clean = 0;
    for (const s of rows) {
      const codes = s.parking_rules?.map((r) => r.restriction_code) ?? [];
      if (codes.length === 1) one += 1;
      else if (codes.length >= 2) twoPlus += 1;
      if (codes.includes("permit")) permit += 1;
      if (codes.includes("time_limited")) tl += 1;
      if (codes.includes("street_cleaning")) clean += 1;
    }
    seattleAudit = {
      segments: rows.length, oneRuleSegments: one, twoPlusRuleSegments: twoPlus,
      permitSegments: permit, timeLimitedSegments: tl, cleaningSegments: clean,
    };
  }

  // -- Scanner self-test summary
  const { getLatestScannerSelfTest } = await import("./scanner-self-test.functions");
  let scannerSelfTest = { count: 0, pass: 0, byCity: {} as Record<string, { pass: number; fail: number }> };
  try { scannerSelfTest = await getLatestScannerSelfTest(); } catch { /* ignore */ }

  return {
    generatedAt: new Date().toISOString(),
    scans: {
      total: scanRows.length,
      matchRate,
      byMatchStatus,
      byVerdict,
      byOutcome,
      withVerdictPersisted: withVerdict,
    },
    providers,
    occupancy: {
      rows: occCount,
      freshestEventTime: freshest,
      freshestAgeMinutes: freshest ? Math.round((now - new Date(freshest).getTime()) / 60000) : null,
      spaces: spaceCount,
    },
    rules: { byCity, byRestriction, bySource },
    seattleAudit,
    scannerSelfTest,
  };
});

