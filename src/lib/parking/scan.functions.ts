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
import { aiRulesToNormalized, callSignScanAi, type AiScanResult, type ArrowDirection, type NormalizedScanRule } from "./sign-ai";
import { resolveRuleConflicts } from "./providers/normalize";
import { buildScanSummary, type ScanSummary } from "./scan-summary";
import { buildDriverNarrative, buildSideCaption, buildRuleTimeline, deriveRiskLevel, type DriverNarrative, type RuleSummary, type RiskLevel } from "./driver-narrative";
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
  outcome: "match" | "conflict" | "unmatched" | "no_sdot" | "out_of_range" | "no_gps";
  matched_rule_id: string | null;
  confidence: number;
  detail: string;
}

export interface SideEvaluation {
  /** Which side of the post this evaluation represents. */
  side: "left" | "right" | "both";
  /** Engine verdict for just this side's posted rules + SDOT data. */
  decision: ParkingStatus;
  /** Driver-friendly summary for this side. */
  summary: ScanSummary;
  /** Posted rules contributing to this side (both-sided + side-specific). */
  rules: NormalizedRule[];
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
  /**
   * When the AI detects directional arrows on the sign block, per-side
   * evaluations the UI can show behind a Left/Right/Both selector. `null`
   * when no arrows were detected — the top-level `decision`/`summary` is
   * authoritative and represents the whole pole.
   */
  sides: { left: SideEvaluation; right: SideEvaluation; both: SideEvaluation } | null;
  /** Direction the posted rules apply to, derived from the physical arrows
   *  on the sign. "BOTH" means a physical double-headed arrow OR no arrows
   *  at all; "LEFT"/"RIGHT" mean every arrow on the stack points that way.
   *  This is the SOURCE OF TRUTH for the UI — never split into left/right
   *  when only one physical direction was photographed. */
  applies_to: "LEFT" | "RIGHT" | "BOTH" | "NONE";
  /** Raw OCR + interpretation snapshot for the in-app debug panel. */
  debug: {
    ocr_plates_text: string;
    interpreted_rules: Array<NormalizedScanRule & { id: string }>;
    active_rule_id: string | null;
    physical_arrow_directions: string[];
    timeline_rules: Array<RuleSummary & { slot: "CURRENT" | "NEXT" | "FOLLOWING" }>;
  };
  /** SDOT rules already on file for the nearest segment, for comparison. */
  sdot_rules: ParkingRule[];
  /** Nearest segment matched (if any) — used for validation + display. */
  segment: { id: string; name: string; distance_m: number } | null;
  validations: SignScanValidation[];
  source_label: string;
  /** ISO timestamp of when this scan was evaluated (the moment the photo was processed). */
  scanned_at: string;
  // ===== Driver-facing contract (Phase 10) =====
  status: "YES" | "NO" | "LIMITED" | "UNKNOWN";
  driver_summary: string;
  street_name: string;
  allowed_until: string | null;
  time_remaining_seconds: number | null;
  time_remaining_minutes: number | null;
  time_remaining_human: string | null;
  next_restriction_reason: string | null;
  next_restriction_start: string | null;
  next_restriction_end: string | null;
  permit_required: boolean;
  time_limit_minutes: number | null;
  left_summary: string | null;
  right_summary: string | null;
  ocr_confidence: number;
  interpretation_confidence: number;
  decision_confidence: number;
  narrative: DriverNarrative;
  // ===== Edge-case sprint =====
  risk_level: RiskLevel;
  current_rule: RuleSummary | null;
  next_rule: RuleSummary | null;
  following_rule: RuleSummary | null;
  countdown_to_next_rule: string | null;
  countdown_to_following_rule: string | null;
  conflict_detected: boolean;
  conflict_summary: string | null;
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
  matchStatus: "matched" | "out_of_range" | "no_gps" | "no_segment_data",
): SignScanValidation[] {
  if (sdotRules.length === 0) {
    const outcome: SignScanValidation["outcome"] =
      matchStatus === "out_of_range" ? "out_of_range" :
      matchStatus === "no_gps" ? "no_gps" : "no_sdot";
    const reason =
      matchStatus === "out_of_range" ? "GPS is outside the selected city's coverage (no segment within 80m)." :
      matchStatus === "no_gps" ? "No GPS captured — cannot cross-check against street data." :
      "Nearest segment has no SDOT rules on file.";
    return aiRules.map((r) => ({
      outcome,
      matched_rule_id: null,
      confidence: overallConfidence,
      detail: `Sign rule "${r.restriction_code}" — ${reason}`,
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
    const scannedAt = new Date();
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("LOVABLE_API_KEY is not configured");

    const admin = await getAdmin();

    // PERF: kick off everything that doesn't depend on AI output in parallel:
    //   - main OCR/extraction + interpretation (single AI roundtrip)
    //   - restriction types lookup (DB)
    //   - nearest segment lookup (DB, if GPS present)
    //   - no storage / history writes on the critical path
    // Previously these stacked multiple AI/DB/storage roundtrips. Running the
    // independent work concurrently keeps wall-clock time close to the AI call.
    const scanId = crypto.randomUUID();
    const ext = data.mimeType.split("/")[1]?.toLowerCase().replace("jpeg", "jpg") ?? "jpg";
    const storagePath = `${new Date().toISOString().slice(0, 10)}/${scanId}.${ext}`;

    const aiP = callSignScanAi(data.imageBase64, data.mimeType, apiKey);
    const restrictionTypesP = loadRestrictionTypes(admin);
    const nearestP = (data.lng != null && data.lat != null)
      ? admin.rpc("nearest_segment_full", {
          p_city_id: data.cityId,
          p_lng: data.lng, p_lat: data.lat,
          p_max_meters: 80,
        })
      : Promise.resolve({ data: null } as { data: unknown });
    const [ai, restrictionTypes, nearestRes] = await Promise.all([aiP, restrictionTypesP, nearestP]);
    if (ai.sign_count === 0 || ai.rules.length === 0) {
      throw new Error(
        "This image does not appear to contain a readable parking, stopping, loading, tow-away, or street restriction sign.",
      );
    }
    const aiRulesAll = aiRulesToNormalized(ai.rules) as NormalizedScanRule[];
    // Conflict-resolved flat list for SDOT comparison + persistence.
    const aiRules = resolveRuleConflicts(aiRulesAll);

    // Nearest SDOT segment results
    let segmentInfo: SignScanResponse["segment"] = null;
    let sdotRules: ParkingRule[] = [];
    let segmentCoords: [number, number][] = [];
    let segmentSource = "scan";
    let segmentDbId: string | null = null;
    let segmentName = "Posted sign location";

    const row = (nearestRes.data as Array<{
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

    // 3) Split posted rules by arrow direction so each side of the post can
    //    be evaluated independently. A rule with arrow=null or arrow="both"
    //    is shared by both sides. Then run the SAME engine used everywhere.
    const segId = segmentDbId ?? "scan";
    const toParkingRule = (r: NormalizedScanRule, i: number): ParkingRule => ({
      id: `scan-rule-${i}`,
      street_segment_id: segId,
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
    });
    const scanRules = aiRulesAll.map(toParkingRule);
    const byArrow = (want: ArrowDirection[]) =>
      scanRules.filter((_, i) => want.includes(aiRulesAll[i].arrow ?? null));
    const sharedRules = byArrow([null, "both"]);
    const leftOnly = byArrow(["left"]);
    const rightOnly = byArrow(["right"]);
    const hasArrows = leftOnly.length > 0 || rightOnly.length > 0;

    const evalNow = (rules: ParkingRule[]): ParkingStatus => {
      const segment: StreetSegment = {
        id: segId,
        name: segmentName,
        side: "both",
        neighborhood: null,
        coordinates: segmentCoords,
        rules: [...rules, ...sdotRules],
        events: [],
      };
      return evaluateRulesAt(segment, restrictionTypes, scannedAt, data.timezone);
    };

    // Top-level decision keeps today's behavior: ALL posted rules + SDOT.
    // This is the conservative composite used when no arrows are detected
    // and as the default verdict on the result page.
    const combinedRules: ParkingRule[] = [...scanRules, ...sdotRules];
    const decision = evalNow(scanRules);

    // Per-side decisions, only computed when at least one arrow is present.
    let sides: SignScanResponse["sides"] = null;
    if (hasArrows) {
      const buildSide = (
        side: "left" | "right" | "both",
        rules: ParkingRule[],
      ): SideEvaluation => {
        const d = evalNow(rules);
        const ruleSlice = aiRulesAll.filter((r) => {
          const a = r.arrow ?? null;
          if (side === "both") return true;
          return a === null || a === "both" || a === side;
        });
        return {
          side,
          decision: d,
          rules: ruleSlice,
          summary: buildScanSummary({
            decision: d,
            parsedRules: ruleSlice,
            sdotRules,
            timezone: data.timezone,
            aiConfidence: ai.overall_confidence,
            signCount: ruleSlice.length,
          }),
        };
      };
      sides = {
        left: buildSide("left", [...sharedRules, ...leftOnly]),
        right: buildSide("right", [...sharedRules, ...rightOnly]),
        both: buildSide("both", scanRules),
      };
    }

    // Single-direction enforcement: if all physical arrows on the stack point
    // the same way (e.g. only RIGHT), the sign HAS NO LEFT SIDE. Drop the
    // per-side split so the UI doesn't invent a phantom "LEFT allows parking"
    // for a side the sign doesn't address.
    const physicalDirs = new Set<string>();
    let hasPhysicalBoth = false;
    for (const r of aiRulesAll) {
      const a = r.arrow ?? null;
      if (a === "left" || a === "right") physicalDirs.add(a);
      if (a === "both") hasPhysicalBoth = true;
    }
    const applies_to: SignScanResponse["applies_to"] =
      aiRulesAll.length === 0
        ? "NONE"
        : hasPhysicalBoth || (physicalDirs.has("left") && physicalDirs.has("right"))
          ? "BOTH"
          : physicalDirs.has("left")
            ? "LEFT"
            : physicalDirs.has("right")
              ? "RIGHT"
              : "BOTH";
    if (applies_to === "LEFT" || applies_to === "RIGHT") {
      // The top-level `decision` already evaluates ALL posted rules — which
      // is correct because every rule belongs to the single physical side.
      sides = null;
    }
    void combinedRules;

    const matchStatus: "matched" | "out_of_range" | "no_gps" | "no_segment_data" =
      data.lng == null || data.lat == null
        ? "no_gps"
        : segmentDbId == null
          ? "out_of_range"
          : sdotRules.length === 0
            ? "no_segment_data"
            : "matched";

    const validations = validateAgainstSdot(aiRules, sdotRules, ai.overall_confidence, matchStatus);
    const summary = buildScanSummary({
      decision,
      parsedRules: aiRules,
      sdotRules,
      timezone: data.timezone,
      aiConfidence: ai.overall_confidence,
      signCount: ai.sign_count,
    });

    // PERF: return the driver verdict immediately after AI + engine evaluation.
    // Storage/history rows are non-critical for the on-screen result, so they
    // run in the background instead of adding seconds to the scan response.
    const signedUrl: string | null = null;
    void (async () => {
      try {
        await Promise.resolve();
        const bytes = Uint8Array.from(atob(data.imageBase64), (c) => c.charCodeAt(0));
        const upload = await admin.storage.from("sign-scans").upload(storagePath, bytes, {
          contentType: data.mimeType, upsert: false,
        });
        const uploadOk = !upload.error;
        const backgroundSignedUrl = uploadOk
          ? await admin.storage.from("sign-scans")
              .createSignedUrl(storagePath, 60 * 60 * 24 * 7)
              .then((s: { data: { signedUrl?: string } | null }) => s.data?.signedUrl ?? null)
          : null;

        await admin.from("parking_sign_scans").insert({
          id: scanId,
          city_id: data.cityId,
          segment_id: segmentDbId,
          lng: data.lng, lat: data.lat,
          decision,
          overall_confidence: ai.overall_confidence,
          verdict: verdictFromColor(decision.color),
          nearest_distance_m: segmentInfo?.distance_m ?? null,
          match_status: matchStatus,
          summary,
        });

        const writes: Promise<unknown>[] = [
          admin.from("ocr_results").insert({
            scan_id: scanId,
            model: ai.model,
            raw_text: ai.raw_text,
            sign_count: ai.sign_count,
          }),
        ];
        if (uploadOk) {
          writes.push(admin.from("parking_sign_images").insert({
            scan_id: scanId,
            storage_path: storagePath,
            public_url: backgroundSignedUrl,
          }));
        }
        if (aiRules.length > 0) {
          writes.push(admin.from("parsed_sign_rules").insert(
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
          ));
        }
        if (validations.length > 0) {
          writes.push(admin.from("scan_validation_results").insert(
            validations.map((v) => ({
              scan_id: scanId,
              outcome: v.outcome,
              matched_rule_id: v.matched_rule_id,
              confidence: v.confidence,
              detail: v.detail,
            })),
          ));
        }
        await Promise.all(writes);
      } catch (e) {
        console.warn("[scanSign] background persistence failed:", (e as Error).message);
      }
    })();



    // ===== Driver Summary Generator (Phase 5/6/7/8) =====
    const narrative = buildDriverNarrative({
      decision,
      parsedRules: aiRules,
      now: scannedAt,
      timezone: data.timezone,
    });

    const leftCaption = sides
      ? buildSideCaption({
          side: "left",
          decision: sides.left.decision,
          parsedRules: sides.left.rules,
          timezone: data.timezone,
        })
      : null;
    const rightCaption = sides
      ? buildSideCaption({
          side: "right",
          decision: sides.right.decision,
          parsedRules: sides.right.rules,
          timezone: data.timezone,
        })
      : null;

    // ===== Confidence breakdown (Phase 9) =====
    const ocr_confidence = ai.overall_confidence;
    const interpretation_confidence = ai.rules.length
      ? ai.rules.reduce((a, r) => a + (r.confidence ?? 0), 0) / ai.rules.length
      : ai.overall_confidence;
    const decision_confidence =
      decision.code === "unknown"
        ? Math.min(ocr_confidence, interpretation_confidence) * 0.5
        : Math.min(ocr_confidence, interpretation_confidence);

    // ===== Edge-case sprint: rule timeline, risk, conflict, confidence gate =====
    // Use the UN-resolved rule list so every physical sign plate produces its
    // own timeline entry. The conflict-resolved `aiRules` collapses overlapping
    // restrictions (e.g. Passenger Loading 5-min and Passenger Loading 10-min
    // become a single rule), which would discard real sign plates.
    const timeline = buildRuleTimeline(aiRulesAll, scannedAt, data.timezone);
    const risk_level: RiskLevel = deriveRiskLevel(aiRulesAll, ai.raw_text);

    const conflicting = validations.filter((v) => v.outcome === "conflict");
    const conflict_detected = conflicting.length > 0;
    const conflict_summary = conflict_detected
      ? conflicting.map((v) => v.detail).join(" ")
      : null;

    // EDGE CASE 8 — low-confidence OCR forces UNKNOWN.
    let finalStatus = narrative.status;
    let finalSummary = narrative.summary;
    if (ocr_confidence < 0.65) {
      finalStatus = "UNKNOWN";
      finalSummary =
        "Parking legality cannot be verified. Please inspect the sign manually.";
    } else if (
      narrative.permit_required &&
      finalStatus === "YES"
    ) {
      // EDGE CASE 6 — permit requirement without a matching user profile.
      finalStatus = "LIMITED";
      finalSummary +=
        ` Permit ${narrative.allowed_until ? "" : ""}` +
        `is required — only return YES once your permit zone matches.`;
    }

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
      sides,
      sdot_rules: sdotRules,
      segment: segmentInfo,
      validations,
      source_label: SOURCE_LABELS[segmentSource] ?? segmentSource,
      scanned_at: scannedAt.toISOString(),
      // Driver-facing contract
      status: finalStatus,
      driver_summary: finalSummary,
      street_name: segmentName,
      allowed_until: narrative.allowed_until,
      time_remaining_seconds: narrative.time_remaining_seconds,
      time_remaining_minutes: narrative.time_remaining_minutes,
      time_remaining_human: narrative.time_remaining_human,
      next_restriction_reason: narrative.next_restriction_reason,
      next_restriction_start: narrative.next_restriction_start,
      next_restriction_end: narrative.next_restriction_end,
      permit_required: narrative.permit_required,
      time_limit_minutes: narrative.time_limit_minutes,
      left_summary: leftCaption,
      right_summary: rightCaption,
      ocr_confidence,
      interpretation_confidence,
      decision_confidence,
      narrative,
      // Edge-case sprint fields
      risk_level,
      current_rule: timeline.current_rule,
      next_rule: timeline.next_rule,
      following_rule: timeline.following_rule,
      countdown_to_next_rule: timeline.countdown_to_next_rule,
      countdown_to_following_rule: timeline.countdown_to_following_rule,
      conflict_detected,
      conflict_summary,
      applies_to,
      debug: {
        ocr_plates_text: ai.raw_text,
        interpreted_rules: aiRulesAll.map((r, i) => ({ ...r, id: `scan-rule-${i}` })),
        active_rule_id: decision.rule_id ?? null,
        physical_arrow_directions: [
          ...(hasPhysicalBoth ? ["BOTH"] : []),
          ...[...physicalDirs].map((d) => d.toUpperCase()),
        ],
        timeline_rules: [
          timeline.current_rule ? { slot: "CURRENT" as const, ...timeline.current_rule } : null,
          timeline.next_rule ? { slot: "NEXT" as const, ...timeline.next_rule } : null,
          timeline.following_rule ? { slot: "FOLLOWING" as const, ...timeline.following_rule } : null,
        ].filter((x): x is NonNullable<typeof x> => x !== null),
      },
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
