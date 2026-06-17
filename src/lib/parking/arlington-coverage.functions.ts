// Arlington, VA coverage dashboard — server functions.
// Mirrors la-coverage.functions.ts: reports verified-open-data coverage
// per Arlington-area bounding box. Never invents data — areas with no
// posted curb regulations show explicit UNKNOWN counts.
import { createServerFn } from "@tanstack/react-start";

interface AdminClient {
  from: (t: string) => any;
  rpc: (n: string, a?: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
}
async function getAdmin(): Promise<AdminClient> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as unknown as AdminClient;
}

export interface ArlingtonAreaCoverage {
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

// Arlington neighborhoods with reasonable bbox coverage.
const AREAS: { area: string; bbox: ArlingtonAreaCoverage["bbox"] }[] = [
  { area: "Rosslyn",        bbox: { minLng: -77.080, minLat: 38.890, maxLng: -77.065, maxLat: 38.905 } },
  { area: "Courthouse",     bbox: { minLng: -77.095, minLat: 38.885, maxLng: -77.080, maxLat: 38.895 } },
  { area: "Clarendon",      bbox: { minLng: -77.110, minLat: 38.882, maxLng: -77.090, maxLat: 38.895 } },
  { area: "Virginia Square",bbox: { minLng: -77.120, minLat: 38.880, maxLng: -77.105, maxLat: 38.890 } },
  { area: "Ballston",       bbox: { minLng: -77.130, minLat: 38.878, maxLng: -77.108, maxLat: 38.888 } },
  { area: "Crystal City",   bbox: { minLng: -77.060, minLat: 38.850, maxLng: -77.040, maxLat: 38.865 } },
  { area: "Pentagon City",  bbox: { minLng: -77.065, minLat: 38.860, maxLng: -77.050, maxLat: 38.870 } },
  { area: "Shirlington",    bbox: { minLng: -77.095, minLat: 38.835, maxLng: -77.075, maxLat: 38.848 } },
  { area: "Columbia Pike",  bbox: { minLng: -77.115, minLat: 38.855, maxLng: -77.075, maxLat: 38.870 } },
  { area: "Lyon Park",      bbox: { minLng: -77.100, minLat: 38.873, maxLng: -77.080, maxLat: 38.885 } },
  { area: "Cherrydale",     bbox: { minLng: -77.110, minLat: 38.895, maxLng: -77.090, maxLat: 38.905 } },
  { area: "Westover",       bbox: { minLng: -77.145, minLat: 38.880, maxLng: -77.125, maxLat: 38.895 } },
];

export const getArlingtonCoverage = createServerFn({ method: "GET" })
  .handler(async (): Promise<{ areas: ArlingtonAreaCoverage[]; provider_health: any[] }> => {
    const admin = await getAdmin();
    const { getProviderForCity } = await import("./providers/registry.server");
    const provider = getProviderForCity("arlington");

    const out: ArlingtonAreaCoverage[] = [];
    const { data: city } = await admin
      .from("cities").select("id").eq("slug", "arlington").maybeSingle();

    for (const a of AREAS) {
      const base: ArlingtonAreaCoverage = {
        area: a.area,
        city_slug: "arlington",
        bbox: a.bbox,
        segments: 0, sweeping: 0, permit: 0, metered: 0, unknown: 0,
        provider_id: provider?.id ?? null,
        provider_status: provider ? "active" : "no-provider",
      };
      if (!city?.id) { out.push(base); continue; }

      const { data: ruleAgg } = await admin.rpc("arlington_area_counts", {
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
