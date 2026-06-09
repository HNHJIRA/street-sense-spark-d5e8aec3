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
  const skipMeters = url.searchParams.get("skipMeters") === "1";

  const payload: Record<string, unknown> = {};

  if (city) {
    payload.providerRuns = { [city]: await syncCity(city) };
  } else {
    // Run all four cities in parallel; each city runs its providers in series internally.
    const entries = Object.keys(CITY_BBOXES);
    const settled = await Promise.allSettled(entries.map(syncCity));
    payload.providerRuns = Object.fromEntries(
      entries.map((c, i) => [
        c,
        settled[i].status === "fulfilled"
          ? (settled[i] as PromiseFulfilledResult<unknown>).value
          : { error: (settled[i] as PromiseRejectedResult).reason?.message ?? "failed" },
      ]),
    );
  }

  if (!skipMeters && (!city || city === "los-angeles")) {
    try { payload.inv = await syncLaMeterInventory(); } catch (e) { payload.inv = { error: (e as Error).message }; }
    try { payload.occ = await syncLaMeterOccupancy(); } catch (e) { payload.occ = { error: (e as Error).message }; }
  }

  return new Response(JSON.stringify({ ok: true, ...payload }), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
}

export const Route = createFileRoute("/api/public/admin/sync-la")({
  server: { handlers: { POST: run, GET: run } },
});
