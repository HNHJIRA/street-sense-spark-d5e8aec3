// Los Angeles coverage dashboard — server functions.
// Reports verified-open-data coverage per LA-region area. Never invents data.
import { createServerFn } from "@tanstack/react-start";

interface AdminClient {
  from: (t: string) => any;
  rpc: (n: string, a?: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
}
async function getAdmin(): Promise<AdminClient> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as unknown as AdminClient;
}

export interface LAAreaCoverage {
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

// The 12 target areas from the LA coverage assessment.
const AREAS: { area: string; city_slug: string; bbox: LAAreaCoverage["bbox"] }[] = [
  { area: "DTLA",             city_slug: "los-angeles",    bbox: { minLng: -118.275, minLat: 34.030, maxLng: -118.225, maxLat: 34.065 } },
  { area: "Hollywood",        city_slug: "los-angeles",    bbox: { minLng: -118.360, minLat: 34.085, maxLng: -118.310, maxLat: 34.115 } },
  { area: "Koreatown",        city_slug: "los-angeles",    bbox: { minLng: -118.320, minLat: 34.050, maxLng: -118.285, maxLat: 34.075 } },
  { area: "Los Feliz",        city_slug: "los-angeles",    bbox: { minLng: -118.305, minLat: 34.095, maxLng: -118.270, maxLat: 34.130 } },
  { area: "Melrose",          city_slug: "los-angeles",    bbox: { minLng: -118.365, minLat: 34.075, maxLng: -118.320, maxLat: 34.090 } },
  { area: "Hancock Park",     city_slug: "los-angeles",    bbox: { minLng: -118.345, minLat: 34.065, maxLng: -118.315, maxLat: 34.085 } },
  { area: "Mid-Wilshire",     city_slug: "los-angeles",    bbox: { minLng: -118.370, minLat: 34.055, maxLng: -118.320, maxLat: 34.075 } },
  { area: "Venice",           city_slug: "los-angeles",    bbox: { minLng: -118.495, minLat: 33.975, maxLng: -118.450, maxLat: 34.010 } },
  { area: "Wilshire Corridor",city_slug: "los-angeles",    bbox: { minLng: -118.470, minLat: 34.050, maxLng: -118.275, maxLat: 34.070 } },
  { area: "Santa Monica",     city_slug: "santa-monica",   bbox: { minLng: -118.530, minLat: 33.990, maxLng: -118.440, maxLat: 34.060 } },
  { area: "West Hollywood",   city_slug: "west-hollywood", bbox: { minLng: -118.400, minLat: 34.070, maxLng: -118.330, maxLat: 34.110 } },
  { area: "Pasadena",         city_slug: "pasadena",       bbox: { minLng: -118.200, minLat: 34.110, maxLng: -118.060, maxLat: 34.220 } },
];

export const getLACoverage = createServerFn({ method: "GET" })
  .handler(async (): Promise<{ areas: LAAreaCoverage[]; provider_health: any[] }> => {
    const admin = await getAdmin();
    const { getProviderForCity } = await import("./providers/registry.server");

    const out: LAAreaCoverage[] = [];
    for (const a of AREAS) {
      const { data: city } = await admin
        .from("cities").select("id").eq("slug", a.city_slug).maybeSingle();
      const provider = getProviderForCity(a.city_slug);
      const base: LAAreaCoverage = {
        area: a.area,
        city_slug: a.city_slug,
        bbox: a.bbox,
        segments: 0, sweeping: 0, permit: 0, metered: 0, unknown: 0,
        provider_id: provider?.id ?? null,
        provider_status: provider ? "active" : "no-provider",
      };
      if (!city?.id) { out.push(base); continue; }

      // Count segments inside this area's bbox via PostGIS.
      const { data: segs } = await admin
        .from("street_segments")
        .select("id")
        .eq("city_id", city.id)
        .filter("geom", "not.is", null);
      // Use the segments-list endpoint with bbox filter via RPC if available;
      // otherwise approximate by pulling rule codes for the city and summing.
      const { data: ruleAgg } = await admin.rpc("la_area_counts", {
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
      } else {
        base.segments = (segs ?? []).length;
      }
      out.push(base);
    }

    // Provider health rows for LA cities only.
    const laSlugs = ["los-angeles", "santa-monica", "west-hollywood", "pasadena"];
    const { data: cityRows } = await admin
      .from("cities").select("id, slug").in("slug", laSlugs);
    const cityIds = ((cityRows ?? []) as any[]).map((c) => c.id);
    let health: any[] = [];
    if (cityIds.length) {
      const { data } = await admin
        .from("provider_health")
        .select("provider, city_id, healthy, last_success_at, last_error, last_error_at, segments_total, notes")
        .in("city_id", cityIds);
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
