// Cron health-check endpoint. Asserts the LA Express Park occupancy
// pipeline is fresh, writes a heartbeat to usage_events, and returns 503
// when any check fails so alerting can pick it up.
import { createFileRoute } from "@tanstack/react-router";

async function run() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const issues: string[] = [];

  // Occupancy freshness
  const { data: head } = await supabaseAdmin
    .from("la_meter_occupancy")
    .select("event_time")
    .order("event_time", { ascending: false })
    .limit(1);
  const freshest = (head as { event_time: string }[] | null)?.[0]?.event_time ?? null;
  const ageMin = freshest ? Math.round((Date.now() - new Date(freshest).getTime()) / 60000) : null;
  if (ageMin == null) issues.push("occupancy: no rows");
  else if (ageMin > 15) issues.push(`occupancy: stale ${ageMin}m`);

  // Row count sanity
  const occCountRes = await supabaseAdmin
    .from("la_meter_occupancy")
    .select("space_id", { count: "exact", head: true });
  const occRows = (occCountRes as { count: number | null }).count ?? 0;
  if (occRows === 0) issues.push("occupancy: 0 rows");

  // Provider health
  const { data: providers } = await supabaseAdmin
    .from("provider_health")
    .select("provider, healthy, last_error, updated_at");
  const unhealthy = ((providers ?? []) as { provider: string; healthy: boolean }[])
    .filter((p) => !p.healthy);
  for (const u of unhealthy) issues.push(`provider:${u.provider} unhealthy`);

  // Heartbeat
  await supabaseAdmin.from("usage_events").insert({
    event_type: "provider_health_check",
    payload: {
      ok: issues.length === 0,
      issues,
      occupancyRows: occRows,
      occupancyAgeMin: ageMin,
      unhealthyProviders: unhealthy.map((u) => u.provider),
    },
  });

  return new Response(JSON.stringify({
    ok: issues.length === 0,
    issues,
    occupancyRows: occRows,
    occupancyAgeMin: ageMin,
    unhealthyProviders: unhealthy.map((u) => u.provider),
  }), {
    status: issues.length === 0 ? 200 : 503,
    headers: { "Content-Type": "application/json" },
  });
}

export const Route = createFileRoute("/api/public/cron/health-check")({
  server: { handlers: { POST: run, GET: run } },
});
