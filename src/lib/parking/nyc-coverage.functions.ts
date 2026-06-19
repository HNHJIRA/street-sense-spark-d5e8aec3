// New York City coverage dashboard — server functions.
// Mirrors bellevue-coverage.functions.ts: reports verified-open-data
// coverage per NYC borough/neighborhood bounding box. Never invents data.
import { createServerFn } from "@tanstack/react-start";

interface AdminClient {
  from: (t: string) => any;
  rpc: (n: string, a?: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
}
async function getAdmin(): Promise<AdminClient> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as unknown as AdminClient;
}

export interface NycAreaCoverage {
  area: string;
  city_slug: string;
  bbox: { minLng: number; minLat: number; maxLng: number; maxLat: number };
  segments: number;
  sweeping: number;
  permit: number;
  metered: number;
  unknown: number;
  provider_id: string | null;
  provider_status: "active" | "no-provider";
}

// Borough-level boxes for Phase 1 reporting. Neighborhood-level boxes can be
// added as later phases produce richer rule data.
const AREAS: { area: string; bbox: NycAreaCoverage["bbox"] }[] = [
  { area: "Manhattan",       bbox: { minLng: -74.0479, minLat: 40.6829, maxLng: -73.9067, maxLat: 40.8820 } },
  { area: "Bronx",           bbox: { minLng: -73.9339, minLat: 40.7855, maxLng: -73.7654, maxLat: 40.9176 } },
  { area: "Brooklyn",        bbox: { minLng: -74.0419, minLat: 40.5707, maxLng: -73.8334, maxLat: 40.7395 } },
  { area: "Queens",          bbox: { minLng: -73.9626, minLat: 40.5417, maxLng: -73.7000, maxLat: 40.8007 } },
  { area: "Staten Island",   bbox: { minLng: -74.2591, minLat: 40.4774, maxLng: -74.0522, maxLat: 40.6517 } },
  // High-interest sub-areas:
  { area: "Midtown Manhattan",   bbox: { minLng: -74.0050, minLat: 40.7480, maxLng: -73.9700, maxLat: 40.7700 } },
  { area: "Lower Manhattan",     bbox: { minLng: -74.0220, minLat: 40.6995, maxLng: -73.9920, maxLat: 40.7250 } },
  { area: "Upper East Side",     bbox: { minLng: -73.9700, minLat: 40.7600, maxLng: -73.9400, maxLat: 40.7900 } },
  { area: "Upper West Side",     bbox: { minLng: -73.9920, minLat: 40.7700, maxLng: -73.9600, maxLat: 40.8050 } },
  { area: "Downtown Brooklyn",   bbox: { minLng: -73.9970, minLat: 40.6850, maxLng: -73.9750, maxLat: 40.7050 } },
  { area: "Long Island City",    bbox: { minLng: -73.9550, minLat: 40.7350, maxLng: -73.9200, maxLat: 40.7600 } },
  { area: "Flushing",            bbox: { minLng: -73.8400, minLat: 40.7500, maxLng: -73.8050, maxLat: 40.7800 } },
];

export const getNycCoverage = createServerFn({ method: "GET" })
  .handler(async (): Promise<{ areas: NycAreaCoverage[]; provider_health: any[] }> => {
    const admin = await getAdmin();
    const { getProviderForCity } = await import("./providers/registry.server");
    const provider = getProviderForCity("nyc");

    const out: NycAreaCoverage[] = [];
    const { data: city } = await admin
      .from("cities").select("id").eq("slug", "nyc").maybeSingle();

    for (const a of AREAS) {
      const base: NycAreaCoverage = {
        area: a.area,
        city_slug: "nyc",
        bbox: a.bbox,
        segments: 0, sweeping: 0, permit: 0, metered: 0, unknown: 0,
        provider_id: provider?.id ?? null,
        provider_status: provider ? "active" : "no-provider",
      };
      if (!city?.id) { out.push(base); continue; }

      const { data: ruleAgg } = await admin.rpc("nyc_area_counts", {
        p_city_id: city.id,
        p_min_lng: a.bbox.minLng, p_min_lat: a.bbox.minLat,
        p_max_lng: a.bbox.maxLng, p_max_lat: a.bbox.maxLat,
      });
      const r = (Array.isArray(ruleAgg) ? ruleAgg[0] : ruleAgg) as
        | { segments?: number; sweeping?: number; permit?: number; metered?: number; unknown?: number }
        | undefined;
      if (r) {
        base.segments = Number(r.segments ?? 0);
        base.sweeping = Number(r.sweeping ?? 0);
        base.permit = Number(r.permit ?? 0);
        base.metered = Number(r.metered ?? 0);
        base.unknown = Number(r.unknown ?? 0);
      }
      out.push(base);
    }

    let health: any[] = [];
    if (city?.id) {
      const { data } = await admin
        .from("provider_health")
        .select("provider, city_id, healthy, last_success_at, last_error, last_error_at, segments_total, notes")
        .eq("city_id", city.id);
      health = ((data ?? []) as any[]).map((h) => ({
        provider: h.provider,
        city_id: h.city_id,
        status: h.healthy ? "healthy" : "error",
        last_success_at: h.last_success_at,
        last_error: h.last_error,
        last_error_at: h.last_error_at,
        segments_imported: h.segments_total,
        notes: h.notes,
      }));
    }
    return { areas: out, provider_health: health };
  });
