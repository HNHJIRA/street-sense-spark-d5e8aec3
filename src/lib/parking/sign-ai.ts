// AI sign scanner: extract parking rules from an image of one or more signs.
//
// Four-stage pipeline (all stages share the same Lovable AI Gateway model):
//   1) Validation gate — is this even a parking-regulation sign?
//   2) OCR Extraction — verbatim plate text + arrow + color per plate.
//   3) OCR Interpretation — color/theme-aware stacking → normalized rules
//      (each rule carries the arrow inherited from the matching plate).
//   4) (Done downstream in scan.functions.ts) Engine evaluation + driver summary.
//
// The public surface (validateSignImage, callSignScanAi, aiRulesToNormalized)
// is preserved so the rest of the scanner pipeline is unchanged.
import { normalizeCategory } from "@/lib/parking/providers/normalize";
import type { NormalizedRule } from "@/lib/parking/providers/types";

const AI_GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const AI_MODEL = "google/gemini-3-flash-preview";

export type ArrowDirection = "left" | "right" | "both" | null;

export interface SignValidationResult {
  is_valid: boolean;
  reason: string;
}

// ============================================================
// PHASE 1 — VALIDATION
// ============================================================

const VALIDATION_PROMPT =
  "Analyze this image. Does it contain any type of parking, no-parking, loading zone, " +
  "tow-away, or street restriction signboard? " +
  "Basically, check if it's a valid street sign that regulates vehicle parking or stopping. " +
  "Respond in JSON format with 'is_valid' (boolean) and 'reason' (string).";

export async function validateSignImage(
  imageBase64: string,
  mime: string,
  apiKey: string,
): Promise<SignValidationResult> {
  const res = await fetch(AI_GATEWAY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Lovable-API-Key": apiKey,
      "X-Lovable-AIG-SDK": "raw-fetch",
    },
    body: JSON.stringify({
      model: AI_MODEL,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: VALIDATION_PROMPT },
            { type: "image_url", image_url: { url: `data:${mime};base64,${imageBase64}` } },
          ],
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "parking_sign_validation",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["is_valid", "reason"],
            properties: {
              is_valid: { type: "boolean" },
              reason: { type: "string" },
            },
          },
        },
      },
    }),
  });
  if (!res.ok) {
    // Fail open — let OCR run rather than blocking the user on a gateway hiccup.
    return { is_valid: true, reason: "Validation skipped (gateway error)." };
  }
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const raw = data.choices?.[0]?.message?.content ?? "{}";
  try {
    const parsed = JSON.parse(raw) as SignValidationResult;
    return {
      is_valid: !!parsed.is_valid,
      reason:
        parsed.reason?.trim() ||
        (parsed.is_valid
          ? "Parking restriction sign detected"
          : "Image does not contain a parking regulation sign"),
    };
  } catch {
    return { is_valid: true, reason: "Validation skipped (unparseable response)." };
  }
}

// ============================================================
// PHASE 2 — OCR EXTRACTION
// ============================================================

const EXTRACTION_PROMPT = `
You are a high-precision OCR extraction engine specializing in street signs.

Your ONLY task is to visually extract information exactly as seen.

=================================================
MULTI-PLATE DETECTION (CRITICAL — READ FIRST)
=================================================
A single pole almost always has MULTIPLE sign plates stacked vertically.
You MUST detect and return EVERY visible plate — do NOT stop after the first one.

1. SCAN THE ENTIRE IMAGE from top to bottom.
2. Every distinct rectangular plate is its own entry in the "plates" array,
   even if plates share the same color, share the same pole, or are touching.
3. A plate is "distinct" if it has its own border, its own background panel,
   or is visually separated from the plate above/below it.
4. Number plates top-to-bottom starting at plate_index = 1.
5. NEVER merge two physical plates into one entry, even if their rules look related.
6. If you can see partial text of a plate at the edge of the frame, still
   include it as its own plate and mark confidence accordingly.
7. Before returning, COUNT the plates visible in the image and confirm
   your "plates" array has the same length. If it does not, scan again.

=================================================
STRICT ARROW DETECTION RULES
=================================================
Arrows are CRITICAL. Misidentifying an arrow ruins the entire rule.
You must NOT confuse left and right.

1. ARROW PRESENCE:
   First, verify if an arrow actually exists on the plate.
   Most plates DO NOT have arrows.
   Do not assume every plate has an arrow.

2. VISUAL VERIFICATION — USE THE POINTER (HEAD), NOT THE TAIL:
   The "head" of the arrow is the triangular pointer/tip.
   The "tail" is the flat end of the shaft (the opposite end of the tip).
   Direction is determined ONLY by where the TIP/HEAD is, never the tail.

   - If the TIP/HEAD points toward the RIGHT edge of the plate → "RIGHT".
   - If the TIP/HEAD points toward the LEFT edge of the plate → "LEFT".
   - If there are tips/heads on BOTH ends → "BOTH".

   Mental check: place the arrow on a number line. The end the tip is
   closer to is the direction. If the tip is closer to the right border
   of the plate, the answer is RIGHT. If the tip is closer to the left
   border, the answer is LEFT. Do not invert this.

3. SANITY CHECK BEFORE ANSWERING:
   Re-examine the arrow one more time. Ask: "Which side of the plate is
   the TRIANGULAR TIP touching or closest to?" That side IS the answer.
   If you initially said LEFT but the tip is on the right edge, correct
   yourself to RIGHT before responding. Do the same the other way.

4. NO SPATIAL BIAS / NO MIRRORING:
   Do not assume arrows alternate (e.g., top=right, bottom=left).
   Do not mirror the image. Read the arrow exactly as it appears in the photo.
   Read each arrow independently.

5. CLEAR VS UNCLEAR VS NONE:
   - If an arrow is partially covered by a sticker or graffiti but the direction is still obvious, report the direction.
   - If it is truly ambiguous, report "UNCLEAR".
   - If NO arrow is visible on a plate, you MUST output "NONE".
     Do not guess or hallucinate an arrow.


=================================================
CORE EXTRACTION RULES
=================================================
1. Extract text EXACTLY as visible.
2. Identify the THEME/COLOR of each plate (background + text/arrow color).
3. Preserve line order top-to-bottom.
4. Treat each physical sign plate separately — never combine plates.
`.trim();

interface ExtractedPlate {
  plate_index: number;
  text: string;
  arrow: "LEFT" | "RIGHT" | "BOTH" | "UNCLEAR" | "NONE";
  background_color: string;
  text_color: string;
  symbols: string[];
  confidence: number;
}

interface ExtractionResult {
  plates: ExtractedPlate[];
  image_quality: "good" | "blurry" | "low_light" | string;
  overall_confidence: number;
}

const EXTRACTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["plates", "image_quality", "overall_confidence"],
  properties: {
    plates: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "plate_index",
          "text",
          "arrow",
          "background_color",
          "text_color",
          "symbols",
          "confidence",
        ],
        properties: {
          plate_index: { type: "integer" },
          text: { type: "string" },
          arrow: { type: "string", enum: ["LEFT", "RIGHT", "BOTH", "UNCLEAR", "NONE"] },
          background_color: { type: "string" },
          text_color: { type: "string" },
          symbols: { type: "array", items: { type: "string" } },
          confidence: { type: "number", minimum: 0, maximum: 1 },
        },
      },
    },
    image_quality: { type: "string" },
    overall_confidence: { type: "number", minimum: 0, maximum: 1 },
  },
} as const;

async function runExtraction(
  imageBase64: string,
  mime: string,
  apiKey: string,
): Promise<ExtractionResult> {
  const res = await fetch(AI_GATEWAY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Lovable-API-Key": apiKey,
      "X-Lovable-AIG-SDK": "raw-fetch",
    },
    body: JSON.stringify({
      model: AI_MODEL,
      messages: [
        { role: "system", content: EXTRACTION_PROMPT },
        {
          role: "user",
          content: [
            { type: "text", text: "Extract every plate exactly as instructed. Return ONLY the JSON object." },
            { type: "image_url", image_url: { url: `data:${mime};base64,${imageBase64}` } },
          ],
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: "sign_extraction", strict: true, schema: EXTRACTION_SCHEMA },
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    if (res.status === 429) throw new Error("Sign scanner is rate-limited. Try again in a moment.");
    if (res.status === 402) throw new Error("AI credits exhausted. Add credits in workspace settings.");
    throw new Error(`Sign extraction failed (${res.status}): ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content ?? "{}";
  try {
    return JSON.parse(content) as ExtractionResult;
  } catch {
    throw new Error("Sign extractor returned non-JSON output.");
  }
}

// ============================================================
// PHASE 3 — OCR INTERPRETATION (color/theme-aware stacking)
// ============================================================

const INTERPRETATION_SYSTEM = `
You are a parking regulation interpreter.

Your goal is to convert fragmented OCR data into logical, actionable parking rules.

=================================================
ONE LOGICAL RULE PER DISTINCT SIGN (CRITICAL)
=================================================
Every text plate in the OCR input represents a real, separately-posted sign.
You MUST output at least one rule for EVERY text plate provided.

- Do NOT drop a plate just because its rule looks similar to another plate.
- Do NOT collapse two plates into one rule unless one plate is purely an
  arrow modifier for the other (see ARROW INHERITANCE below).
- If unsure how to interpret a plate, still output a rule for it with your
  best guess and lower confidence — never silently discard a plate.
- Before returning, confirm that every plate_index from the OCR input is
  referenced in at least one rule's "original_plate_indices".

=================================================
SIGN STACKING & COLOR MATCHING
=================================================
Parking signs on a pole use color coding to group rules.

1. COLOR MATCHING RULE:
   An arrow-ONLY plate (no text other than the arrow) applies to text plates
   with the SAME background color. Text plates of different colors are
   ALWAYS separate rules.

2. THEME CONSISTENCY:
   If a plate is entirely Black with White text and a White arrow, that arrow
   is specific to that Black plate's rule.

3. ARROW INHERITANCE:
   - If a separate arrow-only plate is found, search UPWARDS for the nearest
     text plate with a matching background color and attach the arrow to it.
   - If multiple text plates share the same color as the arrow plate below
     them, the arrow applies to ALL of them — but each of those text plates
     is still its own logical rule.

4. MERGING:
   Only merge an arrow-ONLY plate into its parent text plate. Never merge
   two text plates together.
`.trim();


interface InterpretedRule {
  logical_rule_index: number;
  original_plate_indices: number[];
  restriction_type: string; // e.g. time_limited, no_parking, loading_only, permit, street_cleaning, metered, tow_away
  days: string[];           // ["Monday", ...]
  start_time: string | null;
  end_time: string | null;
  parking_allowed: boolean;
  time_limit_minutes: number | null;
  arrow: "LEFT" | "RIGHT" | "BOTH" | "NONE";
  notes: string | null;
}

interface InterpretationResult {
  rules: InterpretedRule[];
  confidence: number;
}

const INTERPRETATION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["rules", "confidence"],
  properties: {
    rules: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "logical_rule_index",
          "original_plate_indices",
          "restriction_type",
          "days",
          "start_time",
          "end_time",
          "parking_allowed",
          "time_limit_minutes",
          "arrow",
          "notes",
        ],
        properties: {
          logical_rule_index: { type: "integer" },
          original_plate_indices: { type: "array", items: { type: "integer" } },
          restriction_type: { type: "string" },
          days: { type: "array", items: { type: "string" } },
          start_time: { type: ["string", "null"] },
          end_time: { type: ["string", "null"] },
          parking_allowed: { type: "boolean" },
          time_limit_minutes: { type: ["integer", "null"] },
          arrow: { type: "string", enum: ["LEFT", "RIGHT", "BOTH", "NONE"] },
          notes: { type: ["string", "null"] },
        },
      },
    },
    confidence: { type: "number", minimum: 0, maximum: 1 },
  },
} as const;

async function runInterpretation(
  extraction: ExtractionResult,
  apiKey: string,
): Promise<InterpretationResult> {
  const ocrJson = JSON.stringify(extraction, null, 2);
  const userPrompt =
    `Convert the following OCR data into a normalized list of parking rules.\n\n` +
    `Ensure each rule has the correct arrow direction assigned to it based on the stacking logic.\n\n` +
    `OCR JSON:\n${ocrJson}\n\n` +
    `Return ONLY valid JSON matching the requested schema.`;

  const res = await fetch(AI_GATEWAY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Lovable-API-Key": apiKey,
      "X-Lovable-AIG-SDK": "raw-fetch",
    },
    body: JSON.stringify({
      model: AI_MODEL,
      messages: [
        { role: "system", content: INTERPRETATION_SYSTEM },
        { role: "user", content: userPrompt },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: "sign_interpretation", strict: true, schema: INTERPRETATION_SCHEMA },
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    if (res.status === 429) throw new Error("Sign interpreter is rate-limited. Try again in a moment.");
    if (res.status === 402) throw new Error("AI credits exhausted. Add credits in workspace settings.");
    throw new Error(`Sign interpretation failed (${res.status}): ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content ?? "{}";
  try {
    return JSON.parse(content) as InterpretationResult;
  } catch {
    throw new Error("Sign interpreter returned non-JSON output.");
  }
}

// ============================================================
// PUBLIC API: callSignScanAi — orchestrates extraction + interpretation
// and returns the legacy AiScanResult shape consumed by scan.functions.ts.
// ============================================================

export interface RawAiRule {
  type: string;                // free-form, e.g. "NO PARKING", "STREET CLEANING"
  days: string[];              // ["MON","TUE",...]
  start: string | null;        // "HH:MM"
  end: string | null;          // "HH:MM"
  permit_zone: string | null;
  time_limit_minutes: number | null;
  notes: string | null;
  arrow: ArrowDirection;
  confidence: number;
}

export interface AiScanResult {
  raw_text: string;
  sign_count: number;
  overall_confidence: number;
  rules: RawAiRule[];
  model: string;
}

const DAY_TOKENS: Record<string, number> = {
  SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6,
  SUNDAY: 0, MONDAY: 1, TUESDAY: 2, WEDNESDAY: 3, THURSDAY: 4, FRIDAY: 5, SATURDAY: 6,
};
const DAY_3 = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"] as const;

function dayWordsTo3Letter(days: string[]): string[] {
  const out = new Set<string>();
  for (const d of days) {
    const key = d.trim().toUpperCase();
    const idx = DAY_TOKENS[key];
    if (idx != null) out.add(DAY_3[idx]);
  }
  return [...out];
}

function parseDays(tokens: string[]): number[] {
  const out = new Set<number>();
  for (const t of tokens) {
    const k = t.trim().toUpperCase();
    if (k in DAY_TOKENS) out.add(DAY_TOKENS[k]);
  }
  return [...out].sort();
}

function isHHMM(s: string | null | undefined): s is string {
  return !!s && /^\d{2}:\d{2}$/.test(s);
}

function arrowFromUpper(a: string | null | undefined): ArrowDirection {
  switch ((a ?? "").toUpperCase()) {
    case "LEFT": return "left";
    case "RIGHT": return "right";
    case "BOTH": return "both";
    default: return null; // NONE / UNCLEAR
  }
}

function restrictionTextFromType(t: string): string {
  // Convert snake_case / kebab-case interpreter codes into something
  // normalizeCategory can classify (it matches on substrings).
  return (t ?? "").replace(/[_-]+/g, " ").trim();
}

export interface NormalizedScanRule extends NormalizedRule {
  arrow: ArrowDirection;
}

export function aiRulesToNormalized(rules: RawAiRule[]): NormalizedScanRule[] {
  return rules.map((r, idx) => {
    const classified = normalizeCategory(r.type);
    const days = parseDays(r.days);
    return {
      // Posted signs override SDOT data — give them a stronger priority bump.
      priority: Math.max(1, classified.priority - 20) + idx,
      restriction_code: classified.code,
      days_of_week: days.length ? days : [0, 1, 2, 3, 4, 5, 6],
      time_start: isHHMM(r.start) ? r.start : null,
      time_end: isHHMM(r.end) ? r.end : null,
      permit_zone: r.permit_zone?.trim() || null,
      time_limit_minutes: r.time_limit_minutes ?? null,
      effective_from: null,
      effective_to: null,
      notes: r.notes?.trim() || classified.notes,
      arrow: r.arrow ?? null,
    };
  });
}

/**
 * Orchestrate the OCR Extraction → Interpretation pipeline and map the
 * result into the legacy AiScanResult shape so the downstream evaluation
 * pipeline is unchanged.
 */
export async function callSignScanAi(
  imageBase64: string,
  mime: string,
  apiKey: string,
): Promise<AiScanResult> {
  // Stage A — verbatim plate extraction with strict arrow detection.
  const extraction = await runExtraction(imageBase64, mime, apiKey);

  // Stage B — color/theme-aware interpretation into logical rules.
  let interpretation: InterpretationResult;
  try {
    interpretation = await runInterpretation(extraction, apiKey);
  } catch {
    interpretation = { rules: [], confidence: 0 };
  }

  // Build raw_text from the verbatim plates (preserves what the OCR actually saw).
  const raw_text = extraction.plates
    .map((p) => {
      const arrowTag = p.arrow && p.arrow !== "NONE" ? ` [arrow:${p.arrow}]` : "";
      return `Plate ${p.plate_index} (${p.background_color} / ${p.text_color})${arrowTag}:\n${p.text}`;
    })
    .join("\n\n");

  // Map interpreter rules → RawAiRule.
  const rules: RawAiRule[] = interpretation.rules.map((r) => {
    const perRuleConfidence = (() => {
      const ids = new Set(r.original_plate_indices);
      const matchedPlates = extraction.plates.filter((p) => ids.has(p.plate_index));
      if (matchedPlates.length === 0) return extraction.overall_confidence;
      const sum = matchedPlates.reduce((a, p) => a + (p.confidence ?? 0), 0);
      return sum / matchedPlates.length;
    })();
    return {
      type: restrictionTextFromType(r.restriction_type),
      days: dayWordsTo3Letter(r.days),
      start: r.start_time,
      end: r.end_time,
      permit_zone: null,
      time_limit_minutes: r.time_limit_minutes,
      notes: r.notes,
      arrow: arrowFromUpper(r.arrow),
      confidence: perRuleConfidence,
    };
  });

  const overall_confidence = Math.min(
    extraction.overall_confidence || 0,
    interpretation.confidence || extraction.overall_confidence || 0,
  );

  return {
    raw_text,
    sign_count: extraction.plates.length,
    overall_confidence,
    rules,
    model: AI_MODEL,
  };
}
