// Admin trigger to populate Bellevue, WA. Mirrors admin.sync-arlington.ts:
// a naked GET stays cheap and a bounded city sync runs only with `?wait=1`.
import { createFileRoute } from "@tanstack/react-router";
import { syncAllProvidersForCity } from "@/lib/parking/parking.functions";

// City limits bbox — covers Downtown, Bel-Red, Crossroads, Eastgate,
// Factoria, Newport, Lake Hills, Bridle Trails, West/NW Bellevue.
const BELLEVUE_BBOX = {
  minLng: -122.235, minLat: 47.520,
  maxLng: -122.080, maxLat: 47.680,
};

async function run({ request }: { request: Request }) {
  const url = new URL(request.url);
  const wait = url.searchParams.get("wait") === "1";

  if (!wait) {
    return new Response(JSON.stringify({
      ok: true,
      started: false,
      city: "bellevue",
      message: "Sync not started without wait=1; background work is disabled to prevent request CPU timeouts. Call with ?wait=1.",
    }), { status: 202, headers: { "Content-Type": "application/json" } });
  }

  try {
    const providerRun = await syncAllProvidersForCity({
      data: { citySlug: "bellevue", ...BELLEVUE_BBOX, force: true },
    });

    // ---------- Diagnostics (read-only) ----------
    const { runBellevueDiagnostics } = await import(
      "@/lib/parking/providers/bellevue-diagnostics.server"
    );
    let diagnostics: Awaited<ReturnType<typeof runBellevueDiagnostics>> = [];
    let diagnosticsError: string | null = null;
    try {
      diagnostics = await runBellevueDiagnostics(BELLEVUE_BBOX);
    } catch (e) {
      diagnosticsError = (e as Error).message;
    }

    // Persist per-provider notes onto provider_health so the admin UI sees
    // the same per-stage counters surfaced in the response.
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: city } = await supabaseAdmin
        .from("cities").select("id").eq("slug", "bellevue").maybeSingle();
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
    return new Response(JSON.stringify({ ok: false, city: "bellevue", error: (e as Error).message }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
}

export const Route = createFileRoute("/api/public/admin/sync-bellevue")({
  server: { handlers: { POST: run, GET: run } },
});
