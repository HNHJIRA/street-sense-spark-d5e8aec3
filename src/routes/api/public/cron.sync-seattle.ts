// Weekly: full Seattle sync (Sun 04:00 UTC). Closes the gap where Seattle had
// no admin or cron route.
import { createFileRoute } from "@tanstack/react-router";
import { runSync } from "@/lib/parking/sync-orchestrator.functions";

async function run() {
  const started = Date.now();
  try {
    const result = await runSync({ data: { citySlug: "seattle", mode: "full", trigger: "cron" } });
    return new Response(
      JSON.stringify({ ok: result.ok, duration_ms: Date.now() - started, result }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: (e as Error).message }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}

export const Route = createFileRoute("/api/public/cron/sync-seattle")({
  server: { handlers: { POST: run, GET: run } },
});
