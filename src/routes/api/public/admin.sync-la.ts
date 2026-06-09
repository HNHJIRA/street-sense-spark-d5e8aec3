// Admin trigger to populate ALL LA-region cities (LADOT, Santa Monica,
// West Hollywood, Pasadena) PLUS the LA Express Park meter inventory and
// live occupancy. Public (no auth) but only performs idempotent server-side
// upserts against trusted municipal open-data feeds.
import { createFileRoute } from "@tanstack/react-router";
import { syncLaMeterInventory, syncLaMeterOccupancy } from "@/lib/parking/la-express.functions";
import { syncAllProvidersForCity } from "@/lib/parking/parking.functions";

// Generous per-city bboxes (~0.2° lat/lng) — wide enough to cover each city
// in a single pass. Sync is run with force=true to bypass the interactive
// "zoom in" guard meant for tap-driven syncs.
const CITY_BBOXES: Record<string, { minLng: number; minLat: number; maxLng: number; maxLat: number }> = {
  "los-angeles":    { minLng: -118.70, minLat: 33.70, maxLng: -118.00, maxLat: 34.35 },
  "santa-monica":   { minLng: -118.55, minLat: 33.97, maxLng: -118.42, maxLat: 34.08 },
  "west-hollywood": { minLng: -118.41, minLat: 34.07, maxLng: -118.33, maxLat: 34.11 },
  "pasadena":       { minLng: -118.22, minLat: 34.12, maxLng: -118.05, maxLat: 34.22 },
};

async function run() {
  const inv = await syncLaMeterInventory();
  const occ = await syncLaMeterOccupancy();
  const providerRuns: Record<string, unknown> = {};
  for (const [city, bbox] of Object.entries(CITY_BBOXES)) {
    try {
      providerRuns[city] = await syncAllProvidersForCity({ data: { citySlug: city, ...bbox, force: true } });
    } catch (e) {
      providerRuns[city] = { error: (e as Error).message };
    }
  }
  return new Response(JSON.stringify({ ok: true, inv, occ, providerRuns }), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
}

export const Route = createFileRoute("/api/public/admin/sync-la")({
  server: { handlers: { POST: run, GET: run } },
});
