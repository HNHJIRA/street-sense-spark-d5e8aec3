// Admin trigger to populate LA-region cities. A naked GET must stay cheap:
// starting the full provider + meter sync in the background still consumes
// server request CPU and can be killed before a response is flushed. Run one
// bounded city sync explicitly with `?city=<slug>&wait=1`; LA Express meter
// inventory/occupancy is opt-in via `includeMeters=1`.
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
  const includeMeters = url.searchParams.get("includeMeters") === "1" && url.searchParams.get("skipMeters") !== "1";

  if (!city) {
    return new Response(JSON.stringify({
      ok: true,
      started: false,
      message: "No sync started. Pass ?city=los-angeles&wait=1, ?city=santa-monica&wait=1, ?city=west-hollywood&wait=1, or ?city=pasadena&wait=1.",
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }

  if (!CITY_BBOXES[city]) {
    return new Response(JSON.stringify({ ok: false, error: `Unknown city: ${city}` }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }

  if (!wait) {
    return new Response(JSON.stringify({
      ok: true,
      started: false,
      city,
      message: "Sync not started without wait=1; background work is disabled to prevent request CPU timeouts.",
    }), { status: 202, headers: { "Content-Type": "application/json" } });
  }

  try {
    const out: Record<string, unknown> = {};
    out.providerRun = await syncCity(city);
    if (includeMeters && city === "los-angeles") {
      try { out.inv = await syncLaMeterInventory(); } catch (e) { out.inv = { error: (e as Error).message }; }
      try { out.occ = await syncLaMeterOccupancy(); } catch (e) { out.occ = { error: (e as Error).message }; }
    }
    return new Response(JSON.stringify({ ok: true, ...out }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, city, error: (e as Error).message }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
}

export const Route = createFileRoute("/api/public/admin/sync-la")({
  server: { handlers: { POST: run, GET: run } },
});
