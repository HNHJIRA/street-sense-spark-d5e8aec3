// Admin trigger to populate New York City. Mirrors admin.sync-bellevue.ts:
// a naked GET stays cheap and a bounded city sync runs only with `?wait=1`.
//
// Phase 1: only the nyc-centerline segment provider runs. Overlay providers
// (regulations, signs, ASP, meters, bus, curb, open-streets) and the
// derived-allowed RPC land in later phases.

import { createFileRoute } from "@tanstack/react-router";
import { syncAllProvidersForCity } from "@/lib/parking/parking.functions";

// City limits bbox covering all five boroughs.
//   SW: Staten Island (-74.2591, 40.4774)
//   NE: Bronx / Eastern Queens (-73.7000, 40.9176)
const NYC_BBOX = {
  minLng: -74.2591, minLat: 40.4774,
  maxLng: -73.7000, maxLat: 40.9176,
};

async function run({ request }: { request: Request }) {
  const url = new URL(request.url);
  const wait = url.searchParams.get("wait") === "1";
  const onlyProvider = url.searchParams.get("provider")?.trim() || undefined;
  const boroughsParam = url.searchParams.get("boroughs")?.trim() || undefined;

  if (!wait) {
    return new Response(JSON.stringify({
      ok: true,
      started: false,
      city: "nyc",
      message: "Sync not started without wait=1; background work is disabled to prevent request CPU timeouts. Call with ?wait=1.",
    }), { status: 202, headers: { "Content-Type": "application/json" } });
  }

  try {
    const providerRun = await syncAllProvidersForCity({
      data: {
        citySlug: "nyc", ...NYC_BBOX, force: true,
        onlyProviderId: onlyProvider,
        providerParams: boroughsParam
          ? { "nyc-signs": { boroughs: boroughsParam } }
          : undefined,
      },
    });

    // ---------- Diagnostics (read-only) ----------
    const { runNycDiagnostics } = await import(
      "@/lib/parking/providers/nyc-diagnostics.server"
    );
    let diagnostics: Awaited<ReturnType<typeof runNycDiagnostics>> = [];
    let diagnosticsError: string | null = null;
    try {
      diagnostics = await runNycDiagnostics(NYC_BBOX);
    } catch (e) {
      diagnosticsError = (e as Error).message;
    }

    // Persist per-provider notes onto provider_health so the admin UI sees
    // the same per-stage counters surfaced in the response.
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: city } = await supabaseAdmin
        .from("cities").select("id").eq("slug", "nyc").maybeSingle();
      if (city?.id) {
        for (const d of diagnostics) {
          await supabaseAdmin.from("provider_health")
            .update({ notes: d.notes })
            .eq("provider", d.provider)
            .eq("city_id", city.id);
        }
      }
    } catch {
      // Notes are advisory; never fail the sync because we couldn't write them.
    }

    return new Response(JSON.stringify({
      ok: true,
      providerRun,
      diagnostics,
      diagnosticsError,
    }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, city: "nyc", error: (e as Error).message }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
}

export const Route = createFileRoute("/api/public/admin/sync-nyc")({
  server: { handlers: { POST: run, GET: run } },
});
