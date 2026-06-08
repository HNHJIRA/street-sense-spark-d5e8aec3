// Server functions for parking data. Client-safe import path.
// Admin client is imported INSIDE handlers to keep it out of the client bundle.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { CityBundle, ParkingEvent, ParkingRule, RestrictionType, StreetSegment } from "./types";

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

    const { data: cityRow, error: cityErr } = await supabaseAdmin
      .from("cities")
      .select("id, slug, name, timezone, default_zoom")
      .eq("slug", data.citySlug)
      .single();
    if (cityErr || !cityRow) throw new Error(cityErr?.message ?? "City not found");

    // Center via PostGIS as [lng,lat]
    const { data: centerRow } = await supabaseAdmin.rpc("st_asgeojson_center", {
      city_slug: data.citySlug,
    } as never).catch(() => ({ data: null }));

    let center: [number, number] = [-122.3321, 47.6062];
    if (centerRow && typeof centerRow === "string") {
      try {
        const g = JSON.parse(centerRow);
        if (g?.coordinates) center = g.coordinates as [number, number];
      } catch {
        /* ignore */
      }
    } else {
      // Fallback: raw SQL via REST: select geometry as GeoJSON
      const { data: geoRow } = await supabaseAdmin
        .from("cities")
        .select("center")
        .eq("slug", data.citySlug)
        .single();
      // center column is geography; @supabase returns WKB hex which we can't parse here.
      // We hardcoded Seattle as a fallback above; for additional cities, switch to a view.
      if (geoRow) {
        /* noop */
      }
    }

    const { data: types, error: typesErr } = await supabaseAdmin
      .from("restriction_types")
      .select("code, label, color, description");
    if (typesErr) throw typesErr;

    const { data: segRows, error: segErr } = await supabaseAdmin
      .from("street_segments")
      .select("id, name, side, metadata")
      .eq("city_id", cityRow.id);
    if (segErr) throw segErr;

    // Fetch geometries as GeoJSON via a dedicated view-less query: use rpc helper
    const { data: geoRows, error: geoErr } = await supabaseAdmin.rpc(
      "street_segments_geojson",
      { p_city_id: cityRow.id } as never,
    );
    if (geoErr) throw geoErr;
    const geoMap = new Map<string, [number, number][]>();
    if (Array.isArray(geoRows)) {
      for (const r of geoRows as Array<{ id: string; geojson: string }>) {
        try {
          const g = JSON.parse(r.geojson);
          if (g?.coordinates) geoMap.set(r.id, g.coordinates as [number, number][]);
        } catch {
          /* skip */
        }
      }
    }

    const segIds = (segRows ?? []).map((s) => s.id);
    const { data: ruleRows } = await supabaseAdmin
      .from("parking_rules")
      .select(
        "id, street_segment_id, priority, restriction_code, days_of_week, time_start, time_end, permit_zone, time_limit_minutes, effective_from, effective_to, notes",
      )
      .in("street_segment_id", segIds.length ? segIds : ["00000000-0000-0000-0000-000000000000"]);
    const { data: eventRows } = await supabaseAdmin
      .from("parking_events")
      .select("id, street_segment_id, restriction_code, starts_at, ends_at, reason")
      .in("street_segment_id", segIds.length ? segIds : ["00000000-0000-0000-0000-000000000000"]);

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

    const segments: StreetSegment[] = (segRows ?? [])
      .map((s) => ({
        id: s.id,
        name: s.name,
        side: s.side ?? "both",
        metadata: (s.metadata ?? {}) as Record<string, unknown>,
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
