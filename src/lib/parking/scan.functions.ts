// Server functions for the AI parking sign scanner. Orchestrates:
//   image upload → Lovable AI vision → normalize → engine evaluation
//   → persist (scans/images/ocr/parsed_rules/validation).
// The engine is the same evaluateRulesAt() used by Forecast / Can I Park Here
// / Sessions / Alerts. The scanner only contributes additional NormalizedRule
// rows for the synthesized "scan segment".
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { LineString } from "geojson";
import { evaluateRulesAt } from "./engine";
import { aiRulesToNormalized, callSignScanAi, type AiScanResult } from "./sign-ai";
import { resolveRuleConflicts } from "./providers/normalize";
import { buildScanSummary, type ScanSummary } from "./scan-summary";
import type {
  ParkingRule,
  ParkingStatus,
  RestrictionType,
  StreetSegment,
} from "./types";
import type { NormalizedRule } from "./providers/types";

interface AdminClient {
  from: (t: string) => any;
  rpc: (n: string, a?: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
  storage: { from: (b: string) => any };
}
async function getAdmin(): Promise<AdminClient> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as unknown as AdminClient;
}

async function loadRestrictionTypes(admin: AdminClient): Promise<RestrictionType[]> {
  const { data } = await admin.from("restriction_types").select("code, label, color, description");
  return (data ?? []) as RestrictionType[];
}

export interface SignScanInput {
  cityId: string;
  citySlug: string;
  timezone: string;
  imageBase64: string;  // raw base64, no data: prefix
  mimeType: string;
  lng: number | null;
  lat: number | null;
}

export interface SignScanValidation {
  outcome: "match" | "conflict" | "unmatched" | "no_sdot";
  matched_rule_id: string | null;
  confidence: number;
  detail: string;
}

export interface SignScanResponse {
  scan_id: string;
  image_url: string | null;
  raw_text: string;
  model: string;
  overall_confidence: number;
  /** Engine decision combining posted signs + SDOT rules at the user's location. */
  decision: ParkingStatus;
  /** Verdict tier — derived from decision.color. */
  verdict: "YES" | "NO" | "LIMITED";
  /** Driver-friendly AI summary built from the engine output (not raw OCR). */
  summary: ScanSummary;
  /** Rules the AI extracted from the photo (normalized). */
  parsed_rules: NormalizedRule[];
  /** SDOT rules already on file for the nearest segment, for comparison. */
  sdot_rules: ParkingRule[];
  /** Nearest segment matched (if any) — used for validation + display. */
  segment: { id: string; name: string; distance_m: number } | null;
  validations: SignScanValidation[];
  source_label: string;
}

function verdictFromColor(c: ParkingStatus["color"]): "YES" | "NO" | "LIMITED" {
  if (c === "green") return "YES";
  if (c === "red") return "NO";
  return "LIMITED";
}

/**
 * Compare the AI rules against the existing SDOT rules for the nearest
 * segment. We pair them up by canonical restriction_code so the user sees
 * "your sign matches SDOT", "your sign adds a new restriction", or
 * "your sign disagrees with SDOT".
 */
function validateAgainstSdot(
  aiRules: NormalizedRule[],
  sdotRules: ParkingRule[],
  overallConfidence: number,
): SignScanValidation[] {
  if (sdotRules.length === 0) {
    return aiRules.map((r) => ({
      outcome: "no_sdot",
      matched_rule_id: null,
      confidence: overallConfidence,
      detail: `Sign rule "${r.restriction_code}" — no SDOT data on file to compare.`,
    }));
  }
  const out: SignScanValidation[] = [];
  for (const ai of aiRules) {
    const same = sdotRules.find((s) => s.restriction_code === ai.restriction_code);
    if (same) {
      const sameWindow =
        same.time_start === ai.time_start &&
        same.time_end === ai.time_end &&
        [...same.days_of_week].sort().join(",") === [...ai.days_of_week].sort().join(",");
      out.push({
        outcome: sameWindow ? "match" : "conflict",
        matched_rule_id: same.id,
        confidence: overallConfidence,
        detail: sameWindow
          ? `Posted ${ai.restriction_code} matches SDOT (${ai.time_start ?? "—"}–${ai.time_end ?? "—"}).`
          : `Posted ${ai.restriction_code} window differs from SDOT (sign: ${ai.time_start ?? "—"}–${ai.time_end ?? "—"} vs SDOT: ${same.time_start ?? "—"}–${same.time_end ?? "—"}).`,
      });
    } else {
      out.push({
        outcome: "unmatched",
        matched_rule_id: null,
        confidence: overallConfidence,
        detail: `Posted ${ai.restriction_code} is not in SDOT data — treating as authoritative.`,
      });
    }
  }
  return out;
}

const SOURCE_LABELS: Record<string, string> = {
  sdot: "Seattle SDOT Blockface",
  osm: "OpenStreetMap",
  seed: "Demo data",
  curbiq: "CurbIQ",
};

export const scanSign = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({
      cityId: z.string().uuid(),
      citySlug: z.string().min(1).max(64),
      timezone: z.string().min(1).max(64),
      imageBase64: z.string().min(100).max(8_000_000),
      mimeType: z.string().regex(/^image\/(jpeg|jpg|png|webp|heic|heif)$/i),
      lng: z.number().min(-180).max(180).nullable(),
      lat: z.number().min(-90).max(90).nullable(),
    }).parse(input),
  )
  .handler(async ({ data }): Promise<SignScanResponse> => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("LOVABLE_API_KEY is not configured");

    const admin = await getAdmin();
    const restrictionTypes = await loadRestrictionTypes(admin);

    // 1) Run the AI vision pipeline.
    const ai: AiScanResult = await callSignScanAi(data.imageBase64, data.mimeType, apiKey);
    const aiRules = resolveRuleConflicts(aiRulesToNormalized(ai.rules));

    // 2) Find nearest SDOT segment so we can compare + still get accurate name.
    let segmentInfo: SignScanResponse["segment"] = null;
    let sdotRules: ParkingRule[] = [];
    let segmentCoords: [number, number][] = [];
    let segmentSource = "scan";
    let segmentDbId: string | null = null;
    let segmentName = "Posted sign location";

    if (data.lng != null && data.lat != null) {
      const { data: rows } = await admin.rpc("nearest_segment_full", {
        p_city_id: data.cityId,
        p_lng: data.lng, p_lat: data.lat,
        p_max_meters: 80,
      });
      const row = (rows as Array<{
        id: string; name: string; geojson: string;
        data_source: string; rules: ParkingRule[] | null; distance_m: number;
      }> | null)?.[0];
      if (row) {
        segmentDbId = row.id;
        segmentName = row.name;
        segmentSource = row.data_source;
        sdotRules = (row.rules ?? []) as ParkingRule[];
        try {
          const g = JSON.parse(row.geojson) as LineString;
          if (Array.isArray(g.coordinates)) segmentCoords = g.coordinates as [number, number][];
        } catch { /* ignore */ }
        segmentInfo = { id: row.id, name: row.name, distance_m: row.distance_m };
      }
    }

    // 3) Build a synthesized segment: posted-sign rules (high priority) +
    //    existing SDOT rules. Run the SAME engine used everywhere else.
    const combinedRules: ParkingRule[] = [
      ...aiRules.map((r, i) => ({
        id: `scan-rule-${i}`,
        street_segment_id: segmentDbId ?? "scan",
        priority: r.priority,
        restriction_code: r.restriction_code,
        days_of_week: r.days_of_week,
        time_start: r.time_start,
        time_end: r.time_end,
        permit_zone: r.permit_zone,
        time_limit_minutes: r.time_limit_minutes,
        effective_from: r.effective_from,
        effective_to: r.effective_to,
        notes: r.notes,
      })),
      ...sdotRules,
    ];
    const segment: StreetSegment = {
      id: segmentDbId ?? "scan",
      name: segmentName,
      side: "both",
      neighborhood: null,
      coordinates: segmentCoords,
      rules: combinedRules,
      events: [],
    };
    const decision = evaluateRulesAt(segment, restrictionTypes, new Date(), data.timezone);

    // 4) Persist image + scan + child rows.
    const scanId = crypto.randomUUID();
    const ext = data.mimeType.split("/")[1]?.toLowerCase().replace("jpeg", "jpg") ?? "jpg";
    const storagePath = `${new Date().toISOString().slice(0, 10)}/${scanId}.${ext}`;
    const bytes = Uint8Array.from(atob(data.imageBase64), (c) => c.charCodeAt(0));
    const upload = await admin.storage.from("sign-scans").upload(storagePath, bytes, {
      contentType: data.mimeType, upsert: false,
    });
    const uploadOk = !upload.error;
    let signedUrl: string | null = null;
    if (uploadOk) {
      const signed = await admin.storage.from("sign-scans")
        .createSignedUrl(storagePath, 60 * 60 * 24 * 7);
      signedUrl = signed.data?.signedUrl ?? null;
    }

    await admin.from("parking_sign_scans").insert({
      id: scanId,
      city_id: data.cityId,
      segment_id: segmentDbId,
      lng: data.lng, lat: data.lat,
      decision,
      overall_confidence: ai.overall_confidence,
    });

    if (uploadOk) {
      await admin.from("parking_sign_images").insert({
        scan_id: scanId,
        storage_path: storagePath,
        public_url: signedUrl,
      });
    }

    await admin.from("ocr_results").insert({
      scan_id: scanId,
      model: ai.model,
      raw_text: ai.raw_text,
      sign_count: ai.sign_count,
    });

    if (aiRules.length > 0) {
      await admin.from("parsed_sign_rules").insert(
        aiRules.map((r, i) => ({
          scan_id: scanId,
          sequence: i,
          restriction_code: r.restriction_code,
          days_of_week: r.days_of_week,
          time_start: r.time_start,
          time_end: r.time_end,
          permit_zone: r.permit_zone,
          time_limit_minutes: r.time_limit_minutes,
          priority: r.priority,
          confidence: ai.rules[i]?.confidence ?? ai.overall_confidence,
          notes: r.notes,
        })),
      );
    }

    const validations = validateAgainstSdot(aiRules, sdotRules, ai.overall_confidence);
    if (validations.length > 0) {
      await admin.from("scan_validation_results").insert(
        validations.map((v) => ({
          scan_id: scanId,
          outcome: v.outcome,
          matched_rule_id: v.matched_rule_id,
          confidence: v.confidence,
          detail: v.detail,
        })),
      );
    }

    const summary = buildScanSummary({
      decision,
      parsedRules: aiRules,
      sdotRules,
      timezone: data.timezone,
      aiConfidence: ai.overall_confidence,
      signCount: ai.sign_count,
    });

    return {
      scan_id: scanId,
      image_url: signedUrl,
      raw_text: ai.raw_text,
      model: ai.model,
      overall_confidence: ai.overall_confidence,
      decision,
      verdict: verdictFromColor(decision.color),
      summary,
      parsed_rules: aiRules,
      sdot_rules: sdotRules,
      segment: segmentInfo,
      validations,
      source_label: SOURCE_LABELS[segmentSource] ?? segmentSource,
    };
  });

export interface RecentScan {
  id: string;
  created_at: string;
  decision: ParkingStatus;
  overall_confidence: number | null;
  image_url: string | null;
  segment_name: string | null;
}

export const getRecentSignScans = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) =>
    z.object({ limit: z.number().int().min(1).max(50).default(10) }).parse(input ?? {}),
  )
  .handler(async ({ data }): Promise<RecentScan[]> => {
    const admin = await getAdmin();
    const { data: rows } = await admin
      .from("parking_sign_scans")
      .select("id, created_at, decision, overall_confidence, segment_id, parking_sign_images(public_url), street_segments(name)")
      .order("created_at", { ascending: false })
      .limit(data.limit);
    return ((rows ?? []) as any[]).map((r) => ({
      id: r.id,
      created_at: r.created_at,
      decision: r.decision as ParkingStatus,
      overall_confidence: r.overall_confidence,
      image_url: r.parking_sign_images?.[0]?.public_url ?? null,
      segment_name: r.street_segments?.name ?? null,
    }));
  });
