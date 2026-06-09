// LA Express Park live availability:
//  1) Syncs the LADOT meter inventory (≈34k posts) into la_meter_spaces and
//     links each post to the nearest street_segment for Los Angeles.
//  2) Syncs the LADOT live occupancy feed (OCCUPIED/VACANT per spaceid).
//  3) Returns per-segment vacancy stats for a viewport bbox.
//  4) Fallback: returns live availability by LA Express Park block face so the
//     map can show DTLA colors before meter-to-segment linking finishes.
//
// All external calls and admin DB writes happen inside .handler().
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

interface AdminClient {
  from: (t: string) => any;
  rpc: (n: string, a?: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
}
async function getAdmin(): Promise<AdminClient> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as unknown as AdminClient;
}

const INVENTORY_URL =
  "https://services5.arcgis.com/7nsPwEMP38bSkCjy/ArcGIS/rest/services/LADOT_Metered_Parking_Inventory_Policies_(Socrata)/FeatureServer/0/query";
const OCCUPANCY_URL = "https://data.lacity.org/resource/e7h6-4a3e.json";

// ---------- 1. Inventory sync ----------

interface MeterAttrs {
  SpaceID?: string;
  BlockFace?: string;
  Lat?: number;
  Long?: number;
}

export const syncLaMeterInventory = createServerFn({ method: "POST" }).handler(
  async (): Promise<{ ok: boolean; inserted: number; linked: number; total: number }> => {
    const admin = await getAdmin();
    const { data: cityRow } = await admin.from("cities").select("id").eq("slug", "los-angeles").maybeSingle();
    if (!cityRow) throw new Error("Los Angeles city row missing");
    const cityId = cityRow.id as string;

    const pageSize = 2000;
    let offset = 0;
    let total = 0;
    let inserted = 0;
    const HARD_CAP = 60_000;

    while (offset < HARD_CAP) {
      const url = new URL(INVENTORY_URL);
      url.searchParams.set("where", "1=1");
      url.searchParams.set("outFields", "SpaceID,BlockFace,Lat,Long");
      url.searchParams.set("returnGeometry", "false");
      url.searchParams.set("resultRecordCount", String(pageSize));
      url.searchParams.set("resultOffset", String(offset));
      url.searchParams.set("f", "json");
      const res = await fetch(url.toString());
      if (!res.ok) throw new Error(`LADOT inventory fetch failed: ${res.status}`);
      const json = await res.json();
      const feats: { attributes: MeterAttrs }[] = json.features ?? [];
      if (feats.length === 0) break;

      const rows = feats
        .map((f) => f.attributes)
        .filter((a) => a.SpaceID && Number.isFinite(a.Lat) && Number.isFinite(a.Long))
        .map((a) => ({
          space_id: a.SpaceID!,
          block_face: a.BlockFace ?? null,
          lat: a.Lat!,
          lng: a.Long!,
          geom: `SRID=4326;POINT(${a.Long} ${a.Lat})`,
          updated_at: new Date().toISOString(),
        }));

      if (rows.length) {
        const { error } = await admin.from("la_meter_spaces").upsert(rows, { onConflict: "space_id" });
        if (error) throw new Error(`Inventory upsert failed: ${(error as { message?: string }).message}`);
        inserted += rows.length;
      }
      total += feats.length;
      offset += pageSize;
      if (!json.exceededTransferLimit) break;
    }

    // Link spaces to nearest street_segment for LA (within 40m).
    const { data: linked, error: linkErr } = await admin.rpc("la_link_meter_spaces_to_segments", {
      p_city_id: cityId,
      p_max_meters: 40,
    });
    if (linkErr) throw new Error(`Linking failed: ${(linkErr as { message?: string }).message}`);

    return { ok: true, inserted, linked: Number(linked) || 0, total };
  },
);

// ---------- 2. Live occupancy sync ----------

export const syncLaMeterOccupancy = createServerFn({ method: "POST" }).handler(
  async (): Promise<{ ok: boolean; count: number }> => {
    const admin = await getAdmin();
    const pageSize = 5000;
    let offset = 0;
    let total = 0;
    const HARD_CAP = 50_000;
    const now = new Date().toISOString();

    while (offset < HARD_CAP) {
      const url = `${OCCUPANCY_URL}?$limit=${pageSize}&$offset=${offset}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Occupancy fetch failed: ${res.status}`);
      const list: { spaceid: string; eventtime: string; occupancystate: string }[] = await res.json();
      if (list.length === 0) break;

      // Skip rows whose space_id isn't in our inventory (FK would fail).
      const rows = list
        .filter((r) => r.spaceid && r.occupancystate && r.eventtime)
        .map((r) => ({
          space_id: r.spaceid,
          state: r.occupancystate,
          event_time: r.eventtime,
          fetched_at: now,
        }));

      if (rows.length) {
        // Use the RPC that filters to known space_ids to avoid FK errors.
        const { error } = await admin.rpc("la_upsert_meter_occupancy", { p_rows: rows });
        if (error) throw new Error(`Occupancy upsert failed: ${(error as { message?: string }).message}`);
      }
      total += list.length;
      offset += pageSize;
      if (list.length < pageSize) break;
    }
    return { ok: true, count: total };
  },
);

// ---------- 3. Per-segment availability for a bbox ----------

export interface SegmentAvailability {
  segmentId: string;
  vacant: number;
  occupied: number;
}

export const getAvailabilityInBbox = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) =>
    z.object({
      cityId: z.string().uuid(),
      minLng: z.number(), minLat: z.number(),
      maxLng: z.number(), maxLat: z.number(),
    }).parse(input),
  )
  .handler(async ({ data }): Promise<SegmentAvailability[]> => {
    const admin = await getAdmin();
    const { data: rows, error } = await admin.rpc("la_availability_in_bbox", {
      p_city_id: data.cityId,
      p_min_lng: data.minLng, p_min_lat: data.minLat,
      p_max_lng: data.maxLng, p_max_lat: data.maxLat,
    });
    if (error) throw new Error((error as { message?: string }).message ?? "availability rpc failed");
    return ((rows ?? []) as { segment_id: string; vacant: number; occupied: number }[]).map((r) => ({
      segmentId: r.segment_id,
      vacant: Number(r.vacant ?? 0),
      occupied: Number(r.occupied ?? 0),
    }));
  });

// ---------- 4. Fallback block-face availability for immediate DTLA display ----------

export interface AvailabilityBlock {
  id: string;
  name: string;
  coordinates: [number, number][];
  vacant: number;
  occupied: number;
  ratio: number;
  color: "green" | "yellow" | "red";
  updatedAt: string | null;
}

interface LiveOccupancyRow {
  spaceid: string;
  eventtime: string;
  occupancystate: string;
}

interface MeterSpaceRow {
  space_id: string;
  block_face: string | null;
  lat: number;
  lng: number;
}

function hashKey(input: string) {
  let h = 5381;
  for (let i = 0; i < input.length; i += 1) h = ((h << 5) + h) ^ input.charCodeAt(i);
  return (h >>> 0).toString(36);
}

function availabilityColor(vacant: number, occupied: number): "green" | "yellow" | "red" {
  const total = vacant + occupied;
  if (total <= 0) return "red";
  const ratio = vacant / total;
  if (ratio >= 0.3) return "green";
  if (ratio >= 0.1) return "yellow";
  return "red";
}

function sortAlongBlock(coords: [number, number][]) {
  const unique = Array.from(new Map(coords.map((c) => [`${c[0].toFixed(6)},${c[1].toFixed(6)}`, c])).values());
  const lngs = unique.map((c) => c[0]);
  const lats = unique.map((c) => c[1]);
  const lngSpan = Math.max(...lngs) - Math.min(...lngs);
  const latSpan = Math.max(...lats) - Math.min(...lats);
  return unique.sort((a, b) => (lngSpan >= latSpan ? a[0] - b[0] : a[1] - b[1]));
}

export const getAvailabilityBlocksInBbox = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) =>
    z.object({
      minLng: z.number().min(-180).max(180), minLat: z.number().min(-90).max(90),
      maxLng: z.number().min(-180).max(180), maxLat: z.number().min(-90).max(90),
    }).parse(input),
  )
  .handler(async ({ data }): Promise<AvailabilityBlock[]> => {
    const admin = await getAdmin();
    const west = Math.min(data.minLng, data.maxLng);
    const east = Math.max(data.minLng, data.maxLng);
    const south = Math.min(data.minLat, data.maxLat);
    const north = Math.max(data.minLat, data.maxLat);

    const { data: spaces, error: spacesError } = await admin
      .from("la_meter_spaces")
      .select("space_id, block_face, lat, lng")
      .gte("lng", west)
      .lte("lng", east)
      .gte("lat", south)
      .lte("lat", north)
      .range(0, 9999);
    if (spacesError) throw new Error(`Meter lookup failed: ${(spacesError as { message?: string }).message}`);

    const spaceRows = (spaces ?? []) as MeterSpaceRow[];
    if (spaceRows.length === 0) return [];

    const res = await fetch(`${OCCUPANCY_URL}?$select=spaceid,eventtime,occupancystate&$limit=50000`);
    if (!res.ok) throw new Error(`Live LA meter feed failed: ${res.status}`);
    const liveRows = (await res.json()) as LiveOccupancyRow[];
    const liveBySpace = new Map<string, LiveOccupancyRow>();
    for (const row of liveRows) {
      if (row.spaceid && row.occupancystate) liveBySpace.set(row.spaceid, row);
    }

    const groups = new Map<string, {
      name: string;
      coords: [number, number][];
      vacant: number;
      occupied: number;
      updatedAt: string | null;
    }>();

    for (const space of spaceRows) {
      const live = liveBySpace.get(space.space_id);
      if (!live) continue;
      const state = live.occupancystate.toUpperCase();
      if (state !== "VACANT" && state !== "OCCUPIED") continue;
      const block = (space.block_face ?? "").trim();
      const fallbackCell = `${Math.round(space.lat * 1000)}:${Math.round(space.lng * 1000)}`;
      const key = block || fallbackCell;
      const group = groups.get(key) ?? {
        name: block || "Meter group",
        coords: [],
        vacant: 0,
        occupied: 0,
        updatedAt: null,
      };
      group.coords.push([Number(space.lng), Number(space.lat)]);
      if (state === "VACANT") group.vacant += 1;
      else group.occupied += 1;
      if (!group.updatedAt || new Date(live.eventtime).getTime() > new Date(group.updatedAt).getTime()) {
        group.updatedAt = live.eventtime;
      }
      groups.set(key, group);
    }

    return Array.from(groups.entries())
      .map(([key, group]) => {
        const total = group.vacant + group.occupied;
        const ratio = total > 0 ? group.vacant / total : 0;
        return {
          id: `la-live-${hashKey(key)}`,
          name: group.name,
          coordinates: sortAlongBlock(group.coords),
          vacant: group.vacant,
          occupied: group.occupied,
          ratio,
          color: availabilityColor(group.vacant, group.occupied),
          updatedAt: group.updatedAt,
        };
      })
      .filter((block) => block.coordinates.length > 0);
  });
