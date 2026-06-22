// Every 30m: incremental LA-region sync. Providers that don't support
// incremental will run a full sync (provider opt-in via supportsIncremental).
import { createFileRoute } from "@tanstack/react-router";
import { runSync } from "@/lib/parking/sync-orchestrator.functions";

const CITIES = ["los-angeles", "santa-monica", "west-hollywood", "pasadena"];

async function run() {
  const started = Date.now();
  const results: import("@/lib/parking/sync-orchestrator.functions").OrchestratorResult[] = [];
  for (const slug of CITIES) {
    try {
      results.push(await runSync({ data: { citySlug: slug, mode: "incremental", trigger: "cron" } }));
    } catch (e) {
      results.push({ ok: false, status: "error", city: slug, mode: "full", trigger: "cron", message: (e as Error).message });
    }
  }
  return new Response(
    JSON.stringify({ ok: true, duration_ms: Date.now() - started, results }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

export const Route = createFileRoute("/api/public/cron/sync-la-incremental")({
  server: { handlers: { POST: run, GET: run } },
});
