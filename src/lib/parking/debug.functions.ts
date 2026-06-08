// Internal developer validation tool. Returns the full pipeline output for a
// single street segment: raw provider data → normalized rules → conflict
// resolution → engine decision → map color. Not for customer-facing UI.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { ParkingEvent, ParkingRule, ParkingStatus, StreetSegment } from "./types";
import { evaluateRulesAt } from "./engine";
import { normalizeCategory, normalizeSide, resolveRuleConflicts } from "./providers/normalize";
import type { NormalizedRule } from "./providers/types";

export interface SegmentDebugRow {
  id: string;
  name: string;
  side: string;
  data_source: string;
  external_id: string | null;
}

export interface SegmentDebugReport {
  segment: {
    id: string;
    name: string;
    side: string;
    data_source: string;
    external_id: string | null;
    metadata: Record<string, unknown>;
  };
  raw_source: Record<string, unknown>;
  normalized: {
    side: "left" | "right" | "both";
    rules: NormalizedRule[];
    classification: { code: string; priority: number; notes: string } | null;
  };
  conflict_resolved: NormalizedRule[];
  stored_rules: ParkingRule[];
  stored_events: ParkingEvent[];
  engine: ParkingStatus & { map_color_hex: string };
  evaluated_at: string;
  timezone: string;
}

const COLOR_HEX = { green: "#16a34a", yellow: "#eab308", red: "#dc2626" } as const;

export const listDebugSegments = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) =>
    z.object({
      citySlug: z.string().min(1).max(64).default("seattle"),
      limit: z.number().int().min(1).max(200).default(50),
      search: z.string().max(120).optional().nullable(),
    }).parse(input),
  )
  .handler(async ({ data }): Promise<SegmentDebugRow[]> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: city } = await supabaseAdmin
      .from("cities").select("id").eq("slug", data.citySlug).maybeSingle();
    if (!city) return [];
    let q = supabaseAdmin
      .from("street_segments")
      .select("id, name, side, data_source, external_id")
      .eq("city_id", city.id)
      .order("updated_at", { ascending: false })
      .limit(data.limit);
    if (data.search) q = q.ilike("name", `%${data.search}%`);
    const { data: rows } = await q;
    return (rows ?? []) as SegmentDebugRow[];
  });

export const getSegmentDebug = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) =>
    z.object({
      id: z.string().uuid(),
      at: z.string().datetime().optional().nullable(),
      timezone: z.string().min(1).max(64).default("America/Los_Angeles"),
    }).parse(input),
  )
  .handler(async ({ data }): Promise<SegmentDebugReport> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: seg } = await supabaseAdmin
      .from("street_segments")
      .select("id, name, side, data_source, external_id, metadata")
      .eq("id", data.id).maybeSingle();
    if (!seg) throw new Error("Segment not found");

    const { data: storedRules } = await supabaseAdmin
      .from("parking_rules")
      .select("id, street_segment_id, priority, restriction_code, days_of_week, time_start, time_end, permit_zone, time_limit_minutes, effective_from, effective_to, notes")
      .eq("street_segment_id", seg.id)
      .order("priority", { ascending: true });

    const { data: storedEvents } = await supabaseAdmin
      .from("parking_events")
      .select("id, street_segment_id, restriction_code, starts_at, ends_at, reason")
      .eq("street_segment_id", seg.id);

    const { data: types } = await supabaseAdmin
      .from("restriction_types").select("code, label, color, description");

    // Reconstruct provider-shaped "raw" payload from stored metadata.
    const meta = (seg.metadata ?? {}) as Record<string, unknown>;
    const rawCategory = (meta.parking_category as string | null | undefined) ?? null;
    const rawSide = (meta.sdot_side as string | null | undefined) ?? null;
    const raw_source: Record<string, unknown> = {
      provider: seg.data_source,
      external_id: seg.external_id,
      ...meta,
    };

    // Re-run normalization to show the layer's current output for this input.
    const classification = rawCategory != null ? normalizeCategory(rawCategory) : null;
    const reNormalized: NormalizedRule[] = classification
      ? [{
          priority: classification.priority,
          restriction_code: classification.code,
          days_of_week: [0, 1, 2, 3, 4, 5, 6],
          time_start: null, time_end: null,
          permit_zone: null, time_limit_minutes: null,
          effective_from: null, effective_to: null,
          notes: classification.notes,
        }]
      : [];
    const resolved = resolveRuleConflicts(reNormalized);

    const when = data.at ? new Date(data.at) : new Date();
    const fullSeg: StreetSegment = {
      id: seg.id as string,
      name: seg.name as string,
      side: (seg.side ?? "both") as string,
      neighborhood: null,
      coordinates: [],
      rules: (storedRules ?? []) as ParkingRule[],
      events: (storedEvents ?? []) as ParkingEvent[],
    };
    const status = evaluateRulesAt(fullSeg, (types ?? []) as any, when, data.timezone);

    return {
      segment: {
        id: seg.id as string,
        name: seg.name as string,
        side: (seg.side ?? "both") as string,
        data_source: seg.data_source as string,
        external_id: (seg.external_id ?? null) as string | null,
        metadata: meta,
      },
      raw_source,
      normalized: {
        side: normalizeSide(rawSide),
        rules: reNormalized,
        classification,
      },
      conflict_resolved: resolved,
      stored_rules: (storedRules ?? []) as ParkingRule[],
      stored_events: (storedEvents ?? []) as ParkingEvent[],
      engine: { ...status, map_color_hex: COLOR_HEX[status.color] },
      evaluated_at: when.toISOString(),
      timezone: data.timezone,
    };
  });
