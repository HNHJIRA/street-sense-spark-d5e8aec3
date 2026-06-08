// Server functions for parking data.
// Admin client is imported inside handlers to keep it out of the client bundle.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type {
  CityBundle,
  ParkingEvent,
  ParkingRule,
  RestrictionType,
  StreetSegment,
} from "./types";

export const getMapboxToken = createServerFn({ method: "GET" }).handler(async () => {
  const token = process.env.MAPBOX_PUBLIC_TOKEN;
  if (!token) throw new Error("MAPBOX_PUBLIC_TOKEN is not configured");
  return { token };
});

export const getCityBundle = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) =>
    z.object({ citySlug: z.string().min(1).max(64) }).parse(input),
  )
  .handler(async ({ data }): Promise<CityBundle> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Cast to any so we can call the custom PostGIS-backed RPCs we created.
    const admin = supabaseAdmin as unknown as {
      from: (t: string) => any;
      rpc: (name: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
    };

    const { data: cityRow, error: cityErr } = await admin
      .from("cities")
      .select("id, slug, name, timezone, default_zoom")
      .eq("slug", data.citySlug)
      .single();
    if (cityErr || !cityRow) throw new Error("City not found");

    let center: [number, number] = [-122.3321, 47.6062];
    const { data: centerJson } = await admin.rpc("city_center_geojson", { p_slug: data.citySlug });
    if (typeof centerJson === "string") {
      try {
        const g = JSON.parse(centerJson);
        if (Array.isArray(g?.coordinates)) center = g.coordinates as [number, number];
      } catch {
        /* keep fallback */
      }
    }

    const { data: types } = await admin
      .from("restriction_types")
      .select("code, label, color, description");

    const { data: segRows } = await admin
      .from("street_segments")
      .select("id, name, side, metadata")
      .eq("city_id", cityRow.id);

    const { data: geoRows } = await admin.rpc("street_segments_geojson", { p_city_id: cityRow.id });
    const geoMap = new Map<string, [number, number][]>();
    if (Array.isArray(geoRows)) {
      for (const r of geoRows as Array<{ id: string; geojson: string }>) {
        try {
          const g = JSON.parse(r.geojson);
          if (Array.isArray(g?.coordinates)) geoMap.set(r.id, g.coordinates as [number, number][]);
        } catch {
          /* skip */
        }
      }
    }

    const segs = (segRows ?? []) as Array<{
      id: string;
      name: string;
      side: string | null;
      metadata: { neighborhood?: string } | null;
    }>;
    const segIds = segs.map((s) => s.id);
    const safeIds = segIds.length ? segIds : ["00000000-0000-0000-0000-000000000000"];

    const { data: ruleRows } = await admin
      .from("parking_rules")
      .select(
        "id, street_segment_id, priority, restriction_code, days_of_week, time_start, time_end, permit_zone, time_limit_minutes, effective_from, effective_to, notes",
      )
      .in("street_segment_id", safeIds);
    const { data: eventRows } = await admin
      .from("parking_events")
      .select("id, street_segment_id, restriction_code, starts_at, ends_at, reason")
      .in("street_segment_id", safeIds);

    const rulesBySeg = new Map<string, ParkingRule[]>();
    for (const r of (ruleRows ?? []) as ParkingRule[]) {
      const list = rulesBySeg.get(r.street_segment_id) ?? [];
      list.push(r);
      rulesBySeg.set(r.street_segment_id, list);
    }
    const eventsBySeg = new Map<string, ParkingEvent[]>();
    for (const e of (eventRows ?? []) as ParkingEvent[]) {
      const list = eventsBySeg.get(e.street_segment_id) ?? [];
      list.push(e);
      eventsBySeg.set(e.street_segment_id, list);
    }

    const segments: StreetSegment[] = segs
      .map((s) => ({
        id: s.id,
        name: s.name,
        side: s.side ?? "both",
        neighborhood: s.metadata?.neighborhood ?? null,
        coordinates: geoMap.get(s.id) ?? [],
        rules: rulesBySeg.get(s.id) ?? [],
        events: eventsBySeg.get(s.id) ?? [],
      }))
      .filter((s) => s.coordinates.length >= 2);

    return {
      city: {
        id: cityRow.id,
        slug: cityRow.slug,
        name: cityRow.name,
        timezone: cityRow.timezone,
        center,
        default_zoom: Number(cityRow.default_zoom ?? 14),
      },
      restrictionTypes: (types ?? []) as RestrictionType[],
      segments,
    };
  });
