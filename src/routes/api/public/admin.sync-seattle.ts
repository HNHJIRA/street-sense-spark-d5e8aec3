// Admin trigger to populate Seattle. A naked GET stays cheap; a real sync
// only runs with `?wait=1`.
import { createFileRoute } from "@tanstack/react-router";
import { runSync } from "@/lib/parking/sync-orchestrator.functions";

async function run({ request }: { request: Request }) {
  const url = new URL(request.url);
  const wait = url.searchParams.get("wait") === "1";
  const provider = url.searchParams.get("provider")?.trim() || undefined;

  if (!wait) {
    return new Response(JSON.stringify({
      ok: true, started: false, city: "seattle",
      message: "Sync not started without wait=1.",
    }), { status: 202, headers: { "Content-Type": "application/json" } });
  }

  try {
    const result: import("@/lib/parking/sync-orchestrator.functions").OrchestratorResult = await runSync({
      data: { citySlug: "seattle", mode: "full", trigger: "manual", providerId: provider },
    });
    return new Response(JSON.stringify({ ok: result.ok, result }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
}

export const Route = createFileRoute("/api/public/admin/sync-seattle")({
  server: { handlers: { POST: run, GET: run } },
});
