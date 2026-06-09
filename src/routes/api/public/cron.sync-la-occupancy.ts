// Cron endpoint: re-syncs LA Express Park live meter occupancy.
// Called by pg_cron every 5 minutes. No auth (public prefix) — endpoint is
// idempotent and only writes a deterministic upsert against trusted LADOT data.
import { createFileRoute } from "@tanstack/react-router";
import { syncLaMeterOccupancy } from "@/lib/parking/la-express.functions";

async function run() {
  const started = Date.now();
  try {
    const res = await syncLaMeterOccupancy();
    return new Response(
      JSON.stringify({ ok: true, ...res, duration_ms: Date.now() - started }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ ok: false, error: (err as Error).message, duration_ms: Date.now() - started }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}

export const Route = createFileRoute("/api/public/cron/sync-la-occupancy")({
  server: { handlers: { POST: run, GET: run } },
});
