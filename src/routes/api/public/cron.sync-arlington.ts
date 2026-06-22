// Every 12h: full Arlington sync.
import { createFileRoute } from "@tanstack/react-router";
import { runSync } from "@/lib/parking/sync-orchestrator.functions";

async function run() {
  const started = Date.now();
  try {
    const result: import("@/lib/parking/sync-orchestrator.functions").OrchestratorResult = await runSync({ data: { citySlug: "arlington", mode: "full", trigger: "cron" } });
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

export const Route = createFileRoute("/api/public/cron/sync-arlington")({
  server: { handlers: { POST: run, GET: run } },
});
