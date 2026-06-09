// Scanner Self-Test — runs the spatial-match half of the scan pipeline
// (skipping AI) against synthetic GPS points to verify each verdict branch
// works end-to-end against current Seattle + LA data. Admin-only.
import { createServerFn } from "@tanstack/react-start";

interface AdminClient {
  from: (t: string) => any;
  rpc: (n: string, a?: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
}
async function getAdmin(): Promise<AdminClient> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as unknown as AdminClient;
}

type Expected = "matched" | "out_of_range" | "no_gps" | "unmatched" | "conflict";

interface Case {
  city: string;
  expected: Expected;
  lat: number | null;
  lng: number | null;
  description: string;
}

interface CaseResult extends Case {
  cityId: string | null;
  actualMatchStatus: string;
  nearestDistanceM: number | null;
  segmentId: string | null;
  pass: boolean;
  scanId: string;
}

const CASES_PER_CITY: Record<string, Array<Omit<Case, "city">>> = {
  seattle: [
    { expected: "matched",      lat: 47.6062, lng: -122.3321, description: "Downtown Seattle on-street" },
    { expected: "out_of_range", lat: 10.0,    lng: 10.0,      description: "Middle of Africa" },
    { expected: "no_gps",       lat: null,    lng: null,      description: "No GPS provided" },
    { expected: "unmatched",    lat: 47.6597, lng: -122.3076, description: "U-District blockface (may lack overlapping rules)" },
    { expected: "conflict",     lat: 47.6205, lng: -122.3493, description: "Lower Queen Anne (rule mismatch expected)" },
  ],
  "los-angeles": [
    { expected: "matched",      lat: 34.0522, lng: -118.2437, description: "DTLA on-street" },
    { expected: "out_of_range", lat: -10.0,   lng: 10.0,      description: "Middle of Atlantic" },
    { expected: "no_gps",       lat: null,    lng: null,      description: "No GPS provided" },
    { expected: "unmatched",    lat: 34.1016, lng: -118.3267, description: "East Hollywood (sparse rule coverage)" },
    { expected: "conflict",     lat: 34.0407, lng: -118.2468, description: "South Park / arts district" },
  ],
};

export const runScannerSelfTest = createServerFn({ method: "POST" }).handler(async () => {
  const admin = await getAdmin();
  const { data: cityRows } = await admin.from("cities").select("id, slug");
  const cities = ((cityRows ?? []) as { id: string; slug: string }[])
    .reduce<Record<string, string>>((acc, c) => ({ ...acc, [c.slug]: c.id }), {});

  const results: CaseResult[] = [];
  for (const [city, cases] of Object.entries(CASES_PER_CITY)) {
    const cityId = cities[city] ?? null;
    if (!cityId) {
      for (const c of cases) {
        results.push({
          ...c, city, cityId: null,
          actualMatchStatus: "city_missing",
          nearestDistanceM: null, segmentId: null, pass: false, scanId: "",
        });
      }
      continue;
    }
    for (const c of cases) {
      let actualMatchStatus = "no_gps";
      let nearestDistanceM: number | null = null;
      let segmentId: string | null = null;
      if (c.lat != null && c.lng != null) {
        const { data: nearRows } = await admin.rpc("nearest_segment_full", {
          p_city_id: cityId, p_lng: c.lng, p_lat: c.lat, p_max_meters: 80,
        });
        const row = ((nearRows ?? []) as Array<{ id: string; distance_m: number }>)[0];
        if (!row) {
          actualMatchStatus = "out_of_range";
        } else {
          segmentId = row.id;
          nearestDistanceM = row.distance_m;
          // Inspect rules — if any active, mark matched; otherwise unmatched.
          const { data: rules } = await admin.from("parking_rules")
            .select("id, restriction_code").eq("street_segment_id", row.id).limit(5);
          const arr = (rules ?? []) as { id: string; restriction_code: string }[];
          if (arr.length === 0) actualMatchStatus = "unmatched";
          else if (arr.length > 1 && arr.some((r) => r.restriction_code !== arr[0].restriction_code)) {
            actualMatchStatus = "conflict";
          } else actualMatchStatus = "matched";
        }
      }

      // Persist a synthetic scan for the dashboard.
      const { data: scanRow } = await admin.from("parking_sign_scans").insert({
        city_id: cityId,
        lat: c.lat, lng: c.lng,
        match_status: actualMatchStatus,
        nearest_distance_m: nearestDistanceM,
        segment_id: segmentId,
        verdict: actualMatchStatus === "matched" ? "ok" : actualMatchStatus,
        overall_confidence: 1.0,
        decision: { source: "self_test", description: c.description },
        summary: { source: "self_test", expected: c.expected, actual: actualMatchStatus },
      }).select("id").maybeSingle();
      const scanId = (scanRow as { id: string } | null)?.id ?? "";
      if (scanId) {
        await admin.from("scan_validation_results").insert({
          scan_id: scanId,
          outcome: actualMatchStatus,
          confidence: 1.0,
          detail: `[self_test] expected=${c.expected} actual=${actualMatchStatus}`,
        });
      }

      results.push({
        ...c, city, cityId,
        actualMatchStatus, nearestDistanceM, segmentId,
        pass: actualMatchStatus === c.expected,
        scanId,
      });
    }
  }

  const total = results.length;
  const passed = results.filter((r) => r.pass).length;
  return {
    total, passed, failed: total - passed, results,
    generatedAt: new Date().toISOString(),
  };
});

export const getLatestScannerSelfTest = createServerFn({ method: "GET" }).handler(async () => {
  const admin = await getAdmin();
  const { data: scans } = await admin.from("parking_sign_scans")
    .select("id, city_id, match_status, verdict, lat, lng, summary, created_at, cities(slug)")
    .order("created_at", { ascending: false })
    .limit(50);
  const rows = ((scans ?? []) as Array<{
    id: string; match_status: string | null; verdict: string | null;
    summary: { source?: string; expected?: string; actual?: string } | null;
    cities: { slug: string } | null; created_at: string;
  }>).filter((r) => r.summary?.source === "self_test");
  return {
    count: rows.length,
    pass: rows.filter((r) => r.summary?.expected === r.summary?.actual).length,
    byCity: rows.reduce<Record<string, { pass: number; fail: number }>>((acc, r) => {
      const c = r.cities?.slug ?? "unknown";
      acc[c] = acc[c] ?? { pass: 0, fail: 0 };
      if (r.summary?.expected === r.summary?.actual) acc[c].pass += 1;
      else acc[c].fail += 1;
      return acc;
    }, {}),
  };
});
