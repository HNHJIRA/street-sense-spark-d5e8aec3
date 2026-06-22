// Every 6h: full LA-region sync (LA + Santa Monica + West Hollywood + Pasadena).
import { createFileRoute } from "@tanstack/react-router";
import { runSync } from "@/lib/parking/sync-orchestrator.functions";

const CITIES = ["los-angeles", "santa-monica", "west-hollywood", "pasadena"];

async function run() {
  const started = Date.now();
  const results = [] as unknown[];
  for (const slug of CITIES) {
    try {
      results.push(await runSync({ data: { citySlug: slug, mode: "full", trigger: "cron" } }));
    } catch (e) {
      results.push({ ok: false, city: slug, error: (e as Error).message });
    }
  }
  return new Response(
    JSON.stringify({ ok: true, duration_ms: Date.now() - started, results }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

export const Route = createFileRoute("/api/public/cron/sync-la-full")({
  server: { handlers: { POST: run, GET: run } },
});
