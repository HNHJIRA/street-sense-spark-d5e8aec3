// Bellevue, WA coverage dashboard — server functions.
// Mirrors arlington-coverage.functions.ts: reports verified-open-data
// coverage per Bellevue-area bounding box. Never invents data.
import { createServerFn } from "@tanstack/react-start";

interface AdminClient {
  from: (t: string) => any;
  rpc: (n: string, a?: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
}
async function getAdmin(): Promise<AdminClient> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as unknown as AdminClient;
}

export interface BellevueAreaCoverage {
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

// Bellevue neighborhoods (urban core + outer residential). Boxes are
// roughly aligned to City Council planning-area boundaries.
const AREAS: { area: string; bbox: BellevueAreaCoverage["bbox"] }[] = [
  { area: "Downtown",       bbox: { minLng: -122.210, minLat: 47.605, maxLng: -122.190, maxLat: 47.625 } },
  { area: "Bel-Red",        bbox: { minLng: -122.180, minLat: 47.620, maxLng: -122.140, maxLat: 47.640 } },
  { area: "Wilburton",      bbox: { minLng: -122.195, minLat: 47.610, maxLng: -122.175, maxLat: 47.625 } },
  { area: "Crossroads",     bbox: { minLng: -122.140, minLat: 47.610, maxLng: -122.115, maxLat: 47.630 } },
  { area: "Eastgate",       bbox: { minLng: -122.155, minLat: 47.565, maxLng: -122.115, maxLat: 47.590 } },
  { area: "Factoria",       bbox: { minLng: -122.180, minLat: 47.565, maxLng: -122.155, maxLat: 47.585 } },
  { area: "Newport",        bbox: { minLng: -122.190, minLat: 47.535, maxLng: -122.155, maxLat: 47.565 } },
  { area: "Lake Hills",     bbox: { minLng: -122.155, minLat: 47.585, maxLng: -122.125, maxLat: 47.610 } },
  { area: "Bridle Trails",  bbox: { minLng: -122.180, minLat: 47.640, maxLng: -122.150, maxLat: 47.670 } },
  { area: "Northwest Bellevue", bbox: { minLng: -122.225, minLat: 47.620, maxLng: -122.205, maxLat: 47.650 } },
  { area: "West Bellevue",  bbox: { minLng: -122.230, minLat: 47.600, maxLng: -122.210, maxLat: 47.625 } },
  { area: "Somerset",       bbox: { minLng: -122.165, minLat: 47.555, maxLng: -122.140, maxLat: 47.580 } },
];

export const getBellevueCoverage = createServerFn({ method: "GET" })
  .handler(async (): Promise<{ areas: BellevueAreaCoverage[]; provider_health: any[] }> => {
    const admin = await getAdmin();
    const { getProviderForCity } = await import("./providers/registry.server");
    const provider = getProviderForCity("bellevue");

    const out: BellevueAreaCoverage[] = [];
    const { data: city } = await admin
      .from("cities").select("id").eq("slug", "bellevue").maybeSingle();

    for (const a of AREAS) {
      const base: BellevueAreaCoverage = {
        area: a.area,
        city_slug: "bellevue",
        bbox: a.bbox,
        segments: 0, sweeping: 0, permit: 0, metered: 0, unknown: 0,
        provider_id: provider?.id ?? null,
        provider_status: provider ? "active" : "no-provider",
      };
      if (!city?.id) { out.push(base); continue; }

      const { data: ruleAgg } = await admin.rpc("bellevue_area_counts", {
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
