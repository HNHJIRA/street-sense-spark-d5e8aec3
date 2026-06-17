// Admin trigger to populate Arlington, VA. Mirrors admin.sync-la.ts: a naked
// GET stays cheap and a bounded city sync runs only with `?wait=1`.
import { createFileRoute } from "@tanstack/react-router";
import { syncAllProvidersForCity } from "@/lib/parking/parking.functions";

const ARLINGTON_BBOX = {
  minLng: -77.175, minLat: 38.820,
  maxLng: -77.030, maxLat: 38.940,
};

async function run({ request }: { request: Request }) {
  const url = new URL(request.url);
  const wait = url.searchParams.get("wait") === "1";

  if (!wait) {
    return new Response(JSON.stringify({
      ok: true,
      started: false,
      city: "arlington",
      message: "Sync not started without wait=1; background work is disabled to prevent request CPU timeouts. Call with ?wait=1.",
    }), { status: 202, headers: { "Content-Type": "application/json" } });
  }

  try {
    const providerRun = await syncAllProvidersForCity({
      data: { citySlug: "arlington", ...ARLINGTON_BBOX, force: true },
    });
    return new Response(JSON.stringify({ ok: true, providerRun }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, city: "arlington", error: (e as Error).message }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
}

export const Route = createFileRoute("/api/public/admin/sync-arlington")({
  server: { handlers: { POST: run, GET: run } },
});
