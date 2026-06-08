// Server functions for the parking map.
// All Supabase admin and Overpass access is kept inside .handler() to keep
// the service-role import out of the client bundle.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { LineString } from "geojson";
import type { RestrictionType, ParkingColor } from "./types";

// ---------- Mapbox token ----------

export const getMapboxToken = createServerFn({ method: "GET" }).handler(async () => {
  const token = process.env.MAPBOX_PUBLIC_TOKEN;
  if (!token) throw new Error("MAPBOX_PUBLIC_TOKEN is not configured");
  return { token };
});

// ---------- City info ----------

export interface CityInfo {
  id: string;
  slug: string;
  name: string;
  timezone: string;
  center: [number, number];
  default_zoom: number;
  restrictionTypes: RestrictionType[];
  segmentCount: number;
}

export const getCityInfo = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) =>
    z.object({ citySlug: z.string().min(1).max(64) }).parse(input),
  )
  .handler(async ({ data }): Promise<CityInfo> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as unknown as {
      from: (t: string) => any;
      rpc: (n: string, a?: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
    };

    const { data: cityRow, error: cityErr } = await admin
      .from("cities")
      .select("id, slug, name, timezone, default_zoom")
      .eq("slug", data.citySlug)
      .maybeSingle();
    if (cityErr || !cityRow) throw new Error("City not found");

    let center: [number, number] = [-122.3321, 47.6062];
    const { data: centerJson } = await admin.rpc("city_center_geojson", { p_slug: data.citySlug });
    if (typeof centerJson === "string") {
      try {
        const g = JSON.parse(centerJson);
        if (Array.isArray(g?.coordinates)) center = g.coordinates as [number, number];
      } catch { /* ignore */ }
    }

    const { data: types } = await admin
      .from("restriction_types")
      .select("code, label, color, description");

    const { count } = (await admin
      .from("street_segments")
      .select("id", { count: "exact", head: true })
      .eq("city_id", cityRow.id)) as unknown as { count: number };

    return {
      id: cityRow.id,
      slug: cityRow.slug,
      name: cityRow.name,
      timezone: cityRow.timezone,
      center,
      default_zoom: Number(cityRow.default_zoom ?? 14),
      restrictionTypes: (types ?? []) as RestrictionType[],
      segmentCount: count ?? 0,
    };
  });

// ---------- Viewport segments ----------

export interface SegmentLite {
  id: string;
  name: string;
  side: string;
  coordinates: [number, number][];
  restriction_code: string;
  color: ParkingColor;
  label: string;
}

export const getSegmentsInBbox = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) =>
    z.object({
      cityId: z.string().uuid(),
      minLng: z.number(),
      minLat: z.number(),
      maxLng: z.number(),
      maxLat: z.number(),
    }).parse(input),
  )
  .handler(async ({ data }): Promise<SegmentLite[]> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as unknown as {
      rpc: (n: string, a?: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
    };
    const { data: rows, error } = await admin.rpc("segments_in_bbox", {
      p_city_id: data.cityId,
      p_min_lng: data.minLng,
      p_min_lat: data.minLat,
      p_max_lng: data.maxLng,
      p_max_lat: data.maxLat,
    });
    if (error) throw new Error((error as { message?: string }).message ?? "Failed to load segments");
    const list = (rows ?? []) as Array<{
      id: string; name: string; side: string; geojson: string;
      restriction_code: string; color: ParkingColor; label: string;
    }>;
    const out: SegmentLite[] = [];
    for (const r of list) {
      try {
        const g = JSON.parse(r.geojson) as LineString;
        if (!Array.isArray(g.coordinates) || g.coordinates.length < 2) continue;
        out.push({
          id: r.id,
          name: r.name,
          side: r.side,
          coordinates: g.coordinates as [number, number][],
          restriction_code: r.restriction_code,
          color: r.color,
          label: r.label,
        });
      } catch { /* skip malformed */ }
    }
    return out;
  });

// ---------- Segment details (for the bottom sheet) ----------

export const getSegmentDetails = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) =>
    z.object({ id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as unknown as {
      from: (t: string) => any;
    };
    const { data: seg } = await admin
      .from("street_segments")
      .select("id, name, side, metadata")
      .eq("id", data.id)
      .maybeSingle();
    if (!seg) throw new Error("Segment not found");
    const { data: rules } = await admin
      .from("parking_rules")
      .select("id, street_segment_id, priority, restriction_code, days_of_week, time_start, time_end, permit_zone, time_limit_minutes, effective_from, effective_to, notes")
      .eq("street_segment_id", data.id)
      .order("priority", { ascending: true });
    const { data: events } = await admin
      .from("parking_events")
      .select("id, street_segment_id, restriction_code, starts_at, ends_at, reason")
      .eq("street_segment_id", data.id);
    return {
      id: seg.id as string,
      name: seg.name as string,
      side: (seg.side ?? "both") as string,
      neighborhood: (seg.metadata?.neighborhood ?? null) as string | null,
      rules: rules ?? [],
      events: events ?? [],
    };
  });

// ---------- OSM (Overpass) importer ----------

type OsmTags = Record<string, string>;
interface OsmWay {
  type: "way";
  id: number;
  tags?: OsmTags;
  geometry?: Array<{ lat: number; lon: number }>;
}

function decodeXml(value: string) {
  return value
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

function xmlAttrs(source: string) {
  const attrs: Record<string, string> = {};
  for (const match of source.matchAll(/([\w:-]+)="([^"]*)"/g)) attrs[match[1]] = decodeXml(match[2]);
  return attrs;
}

function parseOsmXml(xml: string): OsmWay[] {
  const nodes = new Map<string, { lat: number; lon: number }>();
  for (const match of xml.matchAll(/<node\b([^>]*)\/>/g)) {
    const a = xmlAttrs(match[1]);
    if (a.id && a.lat && a.lon) nodes.set(a.id, { lat: Number(a.lat), lon: Number(a.lon) });
  }
  const ways: OsmWay[] = [];
  for (const match of xml.matchAll(/<way\b[^>]*id="(\d+)"[^>]*>([\s\S]*?)<\/way>/g)) {
    const tags: OsmTags = {};
    for (const tag of match[2].matchAll(/<tag\b([^>]*)\/>/g)) {
      const a = xmlAttrs(tag[1]);
      if (a.k && a.v) tags[a.k] = a.v;
    }
    if (!tags.highway || !HIGHWAY_KINDS.includes(tags.highway)) continue;
    const geometry = Array.from(match[2].matchAll(/<nd\b[^>]*ref="(\d+)"[^>]*\/>/g))
      .map((nd) => nodes.get(nd[1]))
      .filter((p): p is { lat: number; lon: number } => Boolean(p));
    if (geometry.length >= 2) ways.push({ type: "way", id: Number(match[1]), tags, geometry });
  }
  return ways;
}

const HIGHWAY_KINDS = [
  "motorway", "trunk", "primary", "secondary", "tertiary",
  "residential", "unclassified", "living_street", "service",
  "primary_link", "secondary_link", "tertiary_link",
];

const NO_PARK_HIGHWAYS = new Set(["motorway", "trunk", "motorway_link", "trunk_link"]);

function classifyRestriction(t: OsmTags): { code: string; priority: number; notes: string } {
  const hwy = t.highway ?? "";
  if (NO_PARK_HIGHWAYS.has(hwy)) {
    return { code: "no_parking", priority: 10, notes: "Highway/freeway — no street parking." };
  }

  const sides = ["both", "left", "right"] as const;
  const sideVals = sides.map((s) => t[`parking:${s}`]).filter(Boolean) as string[];
  const noVals = sideVals.filter((v) => /^(no|no_parking|no_stopping|separate)$/.test(v));
  const yesVals = sideVals.filter((v) => /^(lane|street_side|on_kerb|half_on_kerb|on_street|perpendicular|diagonal|parallel)$/.test(v));

  // Conditions
  const cond = [
    t["parking:condition:both"],
    t["parking:condition:left"],
    t["parking:condition:right"],
    t["parking:both:fee"],
    t["parking:left:fee"],
    t["parking:right:fee"],
  ].filter(Boolean) as string[];

  const hasFee = cond.some((v) => v === "yes" || v === "ticket" || v === "disc");
  const hasResidents = cond.some((v) => v === "residents" || v === "customers");
  const hasTimeLimit = Boolean(
    t["parking:condition:both:time_interval"] ||
    t["parking:condition:left:time_interval"] ||
    t["parking:condition:right:time_interval"] ||
    t["parking:condition:both:maxstay"] ||
    t["maxstay"],
  );

  if (sideVals.length && noVals.length === sideVals.length) {
    return { code: "no_parking", priority: 20, notes: "Posted: no parking." };
  }
  if (hasFee) return { code: "metered", priority: 50, notes: "Paid / metered parking." };
  if (hasResidents) return { code: "permit", priority: 50, notes: "Permit / residents only." };
  if (hasTimeLimit) return { code: "time_limited", priority: 60, notes: "Time-limited parking." };
  if (yesVals.length || hwy === "residential" || hwy === "living_street" || hwy === "unclassified") {
    return { code: "allowed", priority: 1000, notes: "On-street parking allowed." };
  }
  // Default fallback for arterials with no explicit tag: assume metered downtown
  if (hwy === "primary" || hwy === "secondary" || hwy === "tertiary") {
    return { code: "metered", priority: 70, notes: "Likely metered — verify posted signs." };
  }
  return { code: "allowed", priority: 1000, notes: "No restriction known." };
}

export const importOsmStreets = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({
      citySlug: z.string().min(1).max(64),
      minLng: z.number(), minLat: z.number(),
      maxLng: z.number(), maxLat: z.number(),
    }).parse(input),
  )
  .handler(async ({ data }) => {
    // Guard: cap bbox area so a runaway query can't pull all of Seattle.
    const w = Math.abs(data.maxLng - data.minLng);
    const h = Math.abs(data.maxLat - data.minLat);
    if (w * h > 0.05) throw new Error("Area too large — zoom in and try again.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as unknown as {
      from: (t: string) => any;
      rpc: (n: string, a?: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
    };

    const { data: city } = await admin
      .from("cities")
      .select("id")
      .eq("slug", data.citySlug)
      .maybeSingle();
    if (!city) throw new Error("City not found");

    // Overpass query — bbox order is (south, west, north, east).
    const bbox = `${data.minLat},${data.minLng},${data.maxLat},${data.maxLng}`;
    const filters = HIGHWAY_KINDS.map((h) => `way["highway"="${h}"](${bbox});`).join("");
    const overpass = `[out:json][timeout:60];(${filters});out geom tags;`;

    const endpoints = [
      "https://overpass-api.de/api/interpreter",
      "https://overpass.kumi.systems/api/interpreter",
    ];
    let json: { elements?: OsmWay[] } | null = null;
    let lastErr = "";
    for (const ep of endpoints) {
      try {
        const res = await fetch(ep, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: `data=${encodeURIComponent(overpass)}`,
        });
        if (!res.ok) { lastErr = `Overpass ${res.status}`; continue; }
        json = await res.json();
        break;
      } catch (e) {
        lastErr = (e as Error).message;
      }
    }
    if (!json) throw new Error(`Overpass unavailable: ${lastErr}`);

    const ways = (json.elements ?? []).filter(
      (e) => e.type === "way" && Array.isArray(e.geometry) && e.geometry.length >= 2,
    );
    if (ways.length === 0) return { imported: 0, skipped: 0 };

    // Build segment rows. Use ST_GeomFromGeoJSON for the LineString.
    type SegInsert = {
      city_id: string;
      external_id: string;
      name: string;
      side: string;
      data_source: string;
      geom: string;
      metadata: Record<string, unknown>;
    };
    const segments: SegInsert[] = ways.map((w) => {
      const coords = w.geometry!.map((p) => [p.lon, p.lat] as [number, number]);
      return {
        city_id: city.id as string,
        external_id: `osm:way/${w.id}`,
        name: w.tags?.name ?? w.tags?.ref ?? "Unnamed street",
        side: "both",
        data_source: "osm",
        geom: JSON.stringify({ type: "LineString", coordinates: coords }),
        metadata: {
          highway: w.tags?.highway ?? null,
          oneway: w.tags?.oneway ?? null,
          osm_id: w.id,
        },
      };
    });

    // Upsert in chunks. Supabase has a payload size limit so we batch.
    const chunkSize = 200;
    let imported = 0;
    const insertedIds: { id: string; external_id: string; classification: ReturnType<typeof classifyRestriction> }[] = [];
    const classMap = new Map<string, ReturnType<typeof classifyRestriction>>();
    for (const w of ways) classMap.set(`osm:way/${w.id}`, classifyRestriction(w.tags ?? {}));

    for (let i = 0; i < segments.length; i += chunkSize) {
      const chunk = segments.slice(i, i + chunkSize);
      // We need ST_GeomFromGeoJSON applied; easiest path: call a small SQL via rpc.
      // Fallback: insert via PostgREST using a JSON column wrapper isn't possible for geometry,
      // so we use a custom SQL RPC.
      const { data: ins, error } = await admin.rpc("upsert_osm_segments", { p_rows: chunk });
      if (error) throw new Error(`Insert failed: ${(error as { message?: string }).message}`);
      const rows = (ins ?? []) as Array<{ id: string; external_id: string }>;
      for (const r of rows) {
        const c = classMap.get(r.external_id);
        if (c) insertedIds.push({ id: r.id, external_id: r.external_id, classification: c });
      }
      imported += rows.length;
    }

    // Replace rules for these segments (delete then insert default rule).
    if (insertedIds.length) {
      const ids = insertedIds.map((r) => r.id);
      for (let i = 0; i < ids.length; i += 500) {
        const slice = ids.slice(i, i + 500);
        await admin.from("parking_rules").delete().in("street_segment_id", slice);
        const rules = insertedIds
          .filter((r) => slice.includes(r.id))
          .map((r) => ({
            street_segment_id: r.id,
            priority: r.classification.priority,
            restriction_code: r.classification.code,
            days_of_week: [0, 1, 2, 3, 4, 5, 6],
            notes: r.classification.notes,
          }));
        if (rules.length) await admin.from("parking_rules").insert(rules);
      }
    }

    return { imported, skipped: ways.length - imported };
  });
