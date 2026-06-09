// Server functions for the rich Can-I-Park decision view.
// Reuses evaluateRulesAt() through buildParkingDecision() — no second engine.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { LineString } from "geojson";
import type {
  ParkingEvent,
  ParkingRule,
  RestrictionType,
  StreetSegment,
} from "./types";
import { buildParkingDecision, type ParkingDecision } from "./decision";
import { scoreConfidence, type ConfidenceScore } from "./confidence";

interface AdminClient {
  from: (t: string) => any;
  rpc: (n: string, a?: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
}
async function getAdmin(): Promise<AdminClient> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as unknown as AdminClient;
}

const SOURCE_LABELS: Record<string, string> = {
  sdot: "Seattle SDOT Blockface",
  osm: "OpenStreetMap",
  seed: "Demo data",
  curbiq: "CurbIQ",
  ladot: "LA DOT",
  santa_monica: "Santa Monica Open Data",
  pasadena: "City of Pasadena",
  west_hollywood: "West Hollywood Open Data",
};

export interface SegmentDecisionResult {
  found: boolean;
  message: string;
  segmentId: string | null;
  name: string | null;
  side: string | null;
  neighborhood: string | null;
  coordinates: [number, number][] | null;
  data_source: string | null;
  source_label: string | null;
  /** Distance to the from-point in meters, if from-point was supplied. */
  distance_m: number | null;
  decision: ParkingDecision | null;
  confidence: ConfidenceScore | null;
  /** Last sync of the parent provider, if known. */
  last_synced_at: string | null;
}

async function loadRestrictionTypes(admin: AdminClient): Promise<RestrictionType[]> {
  const { data } = await admin.from("restriction_types").select("code, label, color, description");
  return (data ?? []) as RestrictionType[];
}

async function fetchSegmentBundle(admin: AdminClient, segmentId: string) {
  const { data: seg } = await admin
    .from("street_segments")
    .select("id, name, side, metadata, data_source, city_id")
    .eq("id", segmentId)
    .maybeSingle();
  if (!seg) return null;

  const [{ data: rules }, { data: events }, { data: geomJson }] = await Promise.all([
    admin.from("parking_rules")
      .select("id, street_segment_id, priority, restriction_code, days_of_week, time_start, time_end, permit_zone, time_limit_minutes, effective_from, effective_to, notes")
      .eq("street_segment_id", segmentId)
      .order("priority", { ascending: true }),
    admin.from("parking_events")
      .select("id, street_segment_id, restriction_code, starts_at, ends_at, reason")
      .eq("street_segment_id", segmentId),
    admin.rpc("segment_geojson", { p_id: segmentId }).then((r) => r).catch(() => ({ data: null })),
  ]) as [any, any, any];

  let coords: [number, number][] = [];
  if (typeof geomJson === "string") {
    try {
      const g = JSON.parse(geomJson) as LineString;
      if (Array.isArray(g.coordinates)) coords = g.coordinates as [number, number][];
    } catch { /* ignore */ }
  }

  return {
    seg,
    rules: (rules ?? []) as ParkingRule[],
    events: (events ?? []) as ParkingEvent[],
    coords,
  };
}

async function fetchProviderHealth(
  admin: AdminClient,
  provider: string,
  cityId: string,
): Promise<string | null> {
  const { data } = await admin
    .from("provider_health")
    .select("last_success_at")
    .eq("provider", provider)
    .eq("city_id", cityId)
    .maybeSingle();
  return (data as { last_success_at?: string | null } | null)?.last_success_at ?? null;
}

function compose(
  bundle: { seg: any; rules: ParkingRule[]; events: ParkingEvent[]; coords: [number, number][] },
  restrictionTypes: RestrictionType[],
  when: Date,
  timezone: string,
  distance_m: number | null,
  lastSyncedAt: string | null,
): SegmentDecisionResult {
  const { seg, rules, events, coords } = bundle;
  const segment: StreetSegment = {
    id: seg.id as string,
    name: seg.name as string,
    side: (seg.side ?? "both") as string,
    neighborhood: (seg.metadata?.neighborhood ?? null) as string | null,
    coordinates: coords,
    rules,
    events,
  };
  const decision = buildParkingDecision(segment, restrictionTypes, when, timezone);
  const src = seg.data_source as string;
  const confidence = scoreConfidence({
    matchedRule: decision.status.rule_id != null || decision.status.event_id != null,
    conflictCount: 0,
    dataSource: src,
    ruleCount: rules.length,
    lastSyncedAt,
  });
  return {
    found: true,
    message: decision.verdict === "YES"
      ? `You can park here on ${segment.name}.`
      : decision.verdict === "LIMITED"
        ? `Limited parking on ${segment.name}: ${decision.status.label.toLowerCase()}.`
        : decision.verdict === "NO"
          ? `No parking on ${segment.name}: ${decision.status.label.toLowerCase()}.`
          : `Parking status cannot be verified on ${segment.name}.`,
    segmentId: segment.id,
    name: segment.name,
    side: segment.side,
    neighborhood: segment.neighborhood,
    coordinates: coords,
    data_source: src,
    source_label: SOURCE_LABELS[src] ?? src,
    distance_m,
    decision,
    confidence,
    last_synced_at: lastSyncedAt,
  };
}

const DecisionInput = z.object({
  at: z.string().datetime().optional().nullable(),
  timezone: z.string().min(1).max(64).default("America/Los_Angeles"),
});

export const getDecisionForSegment = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) =>
    DecisionInput.extend({ segmentId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data }): Promise<SegmentDecisionResult> => {
    const admin = await getAdmin();
    const bundle = await fetchSegmentBundle(admin, data.segmentId);
    if (!bundle) {
      return emptyResult("Segment not found.");
    }
    const types = await loadRestrictionTypes(admin);
    const when = data.at ? new Date(data.at) : new Date();
    const lastSync = await fetchProviderHealth(
      admin,
      bundle.seg.data_source as string,
      bundle.seg.city_id as string,
    );
    return compose(bundle, types, when, data.timezone, null, lastSync);
  });

export const getDecisionAt = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) =>
    DecisionInput.extend({
      cityId: z.string().uuid(),
      lng: z.number().min(-180).max(180),
      lat: z.number().min(-90).max(90),
      maxMeters: z.number().min(10).max(500).default(80),
    }).parse(input),
  )
  .handler(async ({ data }): Promise<SegmentDecisionResult> => {
    const admin = await getAdmin();
    const { data: rows, error } = await admin.rpc("nearest_segment_full", {
      p_city_id: data.cityId,
      p_lng: data.lng, p_lat: data.lat,
      p_max_meters: data.maxMeters,
    });
    if (error) throw new Error((error as { message?: string }).message ?? "Lookup failed");
    const row = (rows as Array<any> | null)?.[0];
    if (!row) {
      return emptyResult("No mapped street within range. Pan the map to a street or scan a sign.");
    }

    let coords: [number, number][] = [];
    try {
      const g = JSON.parse(row.geojson) as LineString;
      if (Array.isArray(g.coordinates)) coords = g.coordinates as [number, number][];
    } catch { /* ignore */ }

    const types = await loadRestrictionTypes(admin);
    const when = data.at ? new Date(data.at) : new Date();
    const lastSync = await fetchProviderHealth(admin, row.data_source as string, data.cityId);

    return compose(
      {
        seg: {
          id: row.id, name: row.name, side: row.side,
          metadata: row.metadata ?? {}, data_source: row.data_source,
          city_id: data.cityId,
        },
        rules: (row.rules ?? []) as ParkingRule[],
        events: [],
        coords,
      },
      types,
      when,
      data.timezone,
      typeof row.distance_m === "number" ? row.distance_m : null,
      lastSync,
    );
  });

function emptyResult(message: string): SegmentDecisionResult {
  return {
    found: false,
    message,
    segmentId: null, name: null, side: null, neighborhood: null,
    coordinates: null, data_source: null, source_label: null,
    distance_m: null, decision: null, confidence: null, last_synced_at: null,
  };
}
