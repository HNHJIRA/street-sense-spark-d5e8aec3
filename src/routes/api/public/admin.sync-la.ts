// Admin trigger to populate LA-region cities. Because each city sync makes
// many external HTTP calls to municipal open-data feeds, doing all four
// cities + LA Express inventory + occupancy in one request reliably exceeds
// the 60s edge-worker timeout (500 RUNTIME_ERROR / "upstream request
// timeout"). The endpoint now accepts a `?city=<slug>` query param so each
// city can be triggered independently, and runs the city's providers in
// parallel via Promise.allSettled.
import { createFileRoute } from "@tanstack/react-router";
import { syncLaMeterInventory, syncLaMeterOccupancy } from "@/lib/parking/la-express.functions";
import { syncAllProvidersForCity } from "@/lib/parking/parking.functions";

const CITY_BBOXES: Record<string, { minLng: number; minLat: number; maxLng: number; maxLat: number }> = {
  "los-angeles":    { minLng: -118.70, minLat: 33.70, maxLng: -118.00, maxLat: 34.35 },
  "santa-monica":   { minLng: -118.55, minLat: 33.97, maxLng: -118.42, maxLat: 34.08 },
  "west-hollywood": { minLng: -118.41, minLat: 34.07, maxLng: -118.33, maxLat: 34.11 },
  "pasadena":       { minLng: -118.22, minLat: 34.12, maxLng: -118.05, maxLat: 34.22 },
};

async function syncCity(slug: string) {
  const bbox = CITY_BBOXES[slug];
  if (!bbox) return { city: slug, error: "unknown city" };
  try {
    return await syncAllProvidersForCity({ data: { citySlug: slug, ...bbox, force: true } });
  } catch (e) {
    return { city: slug, error: (e as Error).message };
  }
}

async function run({ request }: { request: Request }) {
  const url = new URL(request.url);
  const city = url.searchParams.get("city");
  const wait = url.searchParams.get("wait") === "1";
  const skipMeters = url.searchParams.get("skipMeters") === "1";
  const cities = city ? [city] : Object.keys(CITY_BBOXES);

  // The full sync chain makes many external HTTP calls and reliably exceeds
  // the preview proxy's ~30s timeout (502 Bad Gateway) and even the worker's
  // 60s cap. By default we kick the work off and return 202 immediately;
  // pass `?wait=1` (and ideally a single `?city=`) to await the result.
  const work = (async () => {
    const out: Record<string, unknown> = {};
    out.providerRuns = Object.fromEntries(
      await Promise.all(cities.map(async (c) => [c, await syncCity(c)] as const)),
    );
    if (!skipMeters && (!city || city === "los-angeles")) {
      try { out.inv = await syncLaMeterInventory(); } catch (e) { out.inv = { error: (e as Error).message }; }
      try { out.occ = await syncLaMeterOccupancy(); } catch (e) { out.occ = { error: (e as Error).message }; }
    }
    return out;
  })();

  if (wait) {
    const result = await work;
    return new Response(JSON.stringify({ ok: true, ...result }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  }

  // Fire-and-forget: log eventual outcome so it shows up in server logs.
  work.then(
    (r) => console.log("[sync-la] completed", JSON.stringify(r).slice(0, 2000)),
    (e) => console.error("[sync-la] failed", e),
  );
  return new Response(
    JSON.stringify({ ok: true, accepted: true, cities, hint: "Add ?wait=1 to block on results (may time out)." }),
    { status: 202, headers: { "Content-Type": "application/json" } },
  );
}

export const Route = createFileRoute("/api/public/admin/sync-la")({
  server: { handlers: { POST: run, GET: run } },
});
