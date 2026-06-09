// LA Express Park live availability:
//  1) Syncs the LADOT meter inventory (≈34k posts) into la_meter_spaces and
//     links each post to the nearest street_segment for Los Angeles.
//  2) Syncs the LADOT live occupancy feed (OCCUPIED/VACANT per spaceid).
//  3) Returns per-segment vacancy stats for a viewport bbox.
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
