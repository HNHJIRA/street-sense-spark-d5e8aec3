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
MANDATORY RULE-SIGN DETECTION
=================================================
These are parking regulations and MUST be extracted as text plates whenever
visible. Never treat them as decorative or generic text:

- PASSENGER LOADING ONLY, COMMERCIAL LOADING ONLY, LOADING ZONE,
  BUS LOADING, TAXI ZONE
- NO PARKING, NO STOPPING, TOW AWAY, NO STANDING, FIRE LANE
- time-limited parking such as 15 MINUTE PARKING or 2 HOUR PARKING

If one of these phrases appears on its own physical sign board, it MUST be
its own plate entry. Do not merge it with the sign above or below it.

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
   - If only a RIGHT arrow exists anywhere in the visible sign stack, do not
     output LEFT or BOTH for any plate unless that plate physically shows it.
   - If only a LEFT arrow exists anywhere in the visible sign stack, do not
     output RIGHT or BOTH for any plate unless that plate physically shows it.


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

=================================================
DIRECTIONAL INDEPENDENCE (CRITICAL — DO NOT VIOLATE)
=================================================
- A plate with a LEFT arrow and a plate with a RIGHT arrow are ALWAYS two
  separate rules. NEVER combine them into a single rule.
- NEVER replace a LEFT rule + a RIGHT rule with a single BOTH rule.
  "BOTH" is only valid when ONE plate physically shows a double-headed
  arrow (tips on both ends) OR explicitly has no arrow modifier and the
  extraction marked it BOTH.
- NEVER collapse different parking durations (e.g. "15 MINUTE" and
  "2 HOUR") into one rule, even if their time windows or days match.
- Preserve directional differences. Preserve duration differences.
- If the OCR shows plates with arrows LEFT and RIGHT, the output MUST
  contain at least one rule with arrow="LEFT" and at least one with
  arrow="RIGHT".

=================================================
MANDATORY RESTRICTION TYPES
=================================================
Always convert these text plates into independent rules:

- PASSENGER LOADING ONLY, COMMERCIAL LOADING ONLY, LOADING ZONE,
  BUS LOADING, TAXI ZONE → loading_zone
- NO PARKING → no_parking
- NO STOPPING or NO STANDING → no_stopping
- TOW AWAY → tow_away unless paired with a more explicit no-parking/no-stopping text
- FIRE LANE → no_stopping
- 15 MINUTE PARKING, 2 HOUR PARKING, or similar duration parking → time_limited

Never merge loading/no-parking/no-stopping/tow-away/fire-lane rules into a
time-limited parking rule. They remain separate even when they share days,
times, colors, or an arrow plate.

=================================================
FINAL VALIDATION BEFORE JSON
=================================================
Before returning JSON, check:
1. Every physical text plate has at least one rule.
2. Every loading-zone plate has its own rule.
3. Every no-parking/no-stopping/tow-away/no-standing/fire-lane plate has its own rule.
4. LEFT and RIGHT rules remain separate.
5. arrow="BOTH" is used only when a physical double-headed arrow was extracted.
If any check fails, fix the JSON instead of returning a confident merged rule.
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

function isPhysicalArrow(a: string | null | undefined): a is "LEFT" | "RIGHT" | "BOTH" {
  return a === "LEFT" || a === "RIGHT" || a === "BOTH";
}

function physicalArrowValue(a: string | null | undefined): ArrowDirection {
  return isPhysicalArrow(a) ? arrowFromUpper(a) : null;
}

function isArrowOnlyPlate(p: ExtractedPlate): boolean {
  if (!isPhysicalArrow(p.arrow)) return false;
  const text = p.text.trim().toUpperCase();
  if (!text) return true;
  const stripped = text
    .replace(/[←→↔⇐⇒⇔]/g, " ")
    .replace(/\b(LEFT|RIGHT|BOTH|DOUBLE|TWO|WAY|DIRECTION|DIRECTIONAL|ARROW|ARROWS|ONLY|POINTING|TO)\b/g, " ")
    .replace(/[^A-Z0-9]+/g, "");
  return stripped.length === 0;
}

function hasRuleText(p: ExtractedPlate): boolean {
  return p.text.trim().length > 0 && !isArrowOnlyPlate(p);
}

function normalizePlateColor(c: string): string {
  const s = c.toLowerCase();
  if (s.includes("white")) return "white";
  if (s.includes("black")) return "black";
  if (s.includes("red")) return "red";
  if (s.includes("green")) return "green";
  if (s.includes("blue")) return "blue";
  if (s.includes("yellow")) return "yellow";
  if (s.includes("orange")) return "orange";
  return s.replace(/[^a-z]+/g, " ").trim() || "unknown";
}

function samePlateColor(a: ExtractedPlate, b: ExtractedPlate): boolean {
  const ca = normalizePlateColor(a.background_color);
  const cb = normalizePlateColor(b.background_color);
  return ca !== "unknown" && cb !== "unknown" && ca === cb;
}

function derivedArrowForPlate(plate: ExtractedPlate, plates: ExtractedPlate[]): ArrowDirection {
  const direct = physicalArrowValue(plate.arrow);
  if (direct) return direct;

  // 1) Nearest arrow-only plate BELOW with the same background color.
  const inheritedSameColor = plates
    .filter((p) => p.plate_index > plate.plate_index && isArrowOnlyPlate(p) && samePlateColor(plate, p))
    .sort((a, b) => a.plate_index - b.plate_index)[0];
  const sameColor = physicalArrowValue(inheritedSameColor?.arrow);
  if (sameColor) return sameColor;

  // 2) Nearest arrow-only plate BELOW regardless of color (single shared arrow plate).
  const inheritedAny = plates
    .filter((p) => p.plate_index > plate.plate_index && isArrowOnlyPlate(p))
    .sort((a, b) => a.plate_index - b.plate_index)[0];
  const anyBelow = physicalArrowValue(inheritedAny?.arrow);
  if (anyBelow) return anyBelow;

  // 3) Stack-wide single-direction inheritance — multiple plates ≠ multiple
  //    directions. If every physical arrow on the sign points the same way,
  //    that direction applies to plates that did not show their own arrow.
  const stackDirs = new Set<ArrowDirection>();
  for (const p of plates) {
    const dir = physicalArrowValue(p.arrow);
    if (dir) stackDirs.add(dir);
  }
  if (stackDirs.size === 1) {
    const [only] = [...stackDirs];
    return only;
  }
  return null;
}

/** Set of physical arrow directions actually present on the OCR'd sign stack.
 *  Used to forbid the interpreter from inventing LEFT, RIGHT, or BOTH that
 *  the photo does not contain. */
function physicalStackDirections(plates: ExtractedPlate[]): Set<ArrowDirection> {
  const out = new Set<ArrowDirection>();
  for (const p of plates) {
    const dir = physicalArrowValue(p.arrow);
    if (dir) out.add(dir);
  }
  return out;
}

function averagePlateConfidence(plates: ExtractedPlate[], fallback: number): number {
  return plates.length
    ? plates.reduce((sum, p) => sum + (p.confidence ?? 0), 0) / plates.length
    : fallback;
}

function inferTimeLimitMinutes(text: string): number | null {
  const m = text.toUpperCase().match(/\b(\d{1,3})\s*(MINUTE|MINUTES|MIN|MINS|HOUR|HOURS|HR|HRS)\b/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  return m[2].startsWith("H") ? n * 60 : n;
}

const DAY_WORD = "SUN(?:DAY)?|MON(?:DAY)?|TUE(?:S(?:DAY)?)?|WED(?:NESDAY)?|THU(?:R(?:S(?:DAY)?)?)?|FRI(?:DAY)?|SAT(?:URDAY)?";

function dayIndexFromToken(token: string): number | null {
  const key = token.trim().toUpperCase().slice(0, 3);
  return DAY_TOKENS[key] ?? null;
}

function parseDaysFromPlateText(text: string): string[] {
  const upper = text.toUpperCase();
  const out = new Set<string>();
  const rangeRe = new RegExp(`\\b(${DAY_WORD})\\b\\s*(?:-|TO|THRU|THROUGH)\\s*\\b(${DAY_WORD})\\b`, "g");
  for (const m of upper.matchAll(rangeRe)) {
    const start = dayIndexFromToken(m[1]);
    const end = dayIndexFromToken(m[2]);
    if (start == null || end == null) continue;
    let d = start;
    while (true) {
      out.add(DAY_3[d]);
      if (d === end) break;
      d = (d + 1) % 7;
    }
  }
  const singleRe = new RegExp(`\\b(${DAY_WORD})\\b`, "g");
  for (const m of upper.matchAll(singleRe)) {
    const idx = dayIndexFromToken(m[1]);
    if (idx != null) out.add(DAY_3[idx]);
  }
  return [...out];
}

function toHHMM(hourText: string, minuteText: string | undefined, meridiemText: string): string | null {
  let hour = Number(hourText);
  const minute = minuteText ? Number(minuteText) : 0;
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || hour < 1 || hour > 12 || minute < 0 || minute > 59) {
    return null;
  }
  const meridiem = meridiemText.toUpperCase().startsWith("P") ? "PM" : "AM";
  if (meridiem === "AM" && hour === 12) hour = 0;
  if (meridiem === "PM" && hour !== 12) hour += 12;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function parseTimeWindowFromPlateText(text: string): { start: string | null; end: string | null } {
  const matches = [...text.matchAll(/\b(\d{1,2})(?::(\d{2}))?\s*(A\.?M\.?|P\.?M\.?|A|P)\b/gi)];
  if (matches.length < 2) return { start: null, end: null };
  const start = toHHMM(matches[0][1], matches[0][2], matches[0][3]);
  const end = toHHMM(matches[1][1], matches[1][2], matches[1][3]);
  return { start, end };
}

function inferRestrictionTypeFromPlateText(text: string): string {
  const t = text.toUpperCase();
  if (/\bNO\s+STOPPING\b/.test(t)) return "no stopping";
  if (/\bNO\s+STANDING\b/.test(t)) return "no standing";
  if (/\bFIRE\s+LANE\b/.test(t)) return "fire lane";
  if (/\bNO\s+PARKING\b/.test(t)) return "no parking";
  if (/\bTOW\s*-?\s*AWAY\b/.test(t)) return "tow away";
  if (/\b(PASSENGER\s+LOADING\s+ONLY|COMMERCIAL\s+LOADING\s+ONLY|LOADING\s+ZONE|BUS\s+LOADING|TAXI\s+ZONE)\b/.test(t)) {
    return "loading zone";
  }
  if (/\b\d{1,3}\s*(MINUTE|MINUTES|MIN|MINS|HOUR|HOURS|HR|HRS)\s+PARKING\b/.test(t) || /\bTIME\s+LIMIT(?:ED)?\b/.test(t)) {
    return "time limited parking";
  }
  if (/\b(METER|METERED|PAID\s+PARKING)\b/.test(t)) return "metered parking";
  if (/\b(PERMIT|RESIDENTIAL\s+PERMIT|PREFERENTIAL\s+PARKING)\b/.test(t)) return "permit parking";
  if (/\b(STREET\s+CLEANING|SWEEPING|SWEEP)\b/.test(t)) return "street cleaning";
  return "unknown";
}

function fallbackRuleFromPlate(plate: ExtractedPlate, plates: ExtractedPlate[], reason: string): RawAiRule {
  const window = parseTimeWindowFromPlateText(plate.text);
  const type = inferRestrictionTypeFromPlateText(plate.text);
  const confidenceCap = type === "unknown" ? 0.45 : 0.62;
  return {
    type,
    days: parseDaysFromPlateText(plate.text),
    start: window.start,
    end: window.end,
    permit_zone: null,
    time_limit_minutes: inferTimeLimitMinutes(plate.text),
    notes: plate.text.trim() || reason,
    arrow: derivedArrowForPlate(plate, plates),
    confidence: Math.min(plate.confidence ?? confidenceCap, confidenceCap),
  };
}

function rawRuleKey(r: RawAiRule): string {
  return [
    r.type.toLowerCase(),
    [...r.days].sort().join(","),
    r.start ?? "",
    r.end ?? "",
    r.time_limit_minutes ?? "",
    r.arrow ?? "none",
    (r.notes ?? "").toLowerCase(),
  ].join("|");
}

function dedupeRawRules(rules: RawAiRule[]): RawAiRule[] {
  const seen = new Set<string>();
  const out: RawAiRule[] = [];
  for (const r of rules) {
    const key = rawRuleKey(r);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
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

  // Map interpreter rules → RawAiRule, then deterministically validate the
  // result against the physical OCR plates. The summary layer must never have
  // to repair missing plates or invented arrows.
  const rules: RawAiRule[] = [];
  const textPlates = extraction.plates.filter(hasRuleText);
  const coveredTextPlateIds = new Set<number>();
  let validationConfidenceCap = 1;

  for (const r of interpretation.rules) {
    const ids = new Set(r.original_plate_indices);
    const matchedPlates = extraction.plates.filter((p) => ids.has(p.plate_index));
    const ruleTextPlates = matchedPlates.filter(hasRuleText);

    if (ruleTextPlates.length === 0) {
      validationConfidenceCap = Math.min(validationConfidenceCap, 0.58);
      continue;
    }

    if (ruleTextPlates.length > 1) {
      // The interpreter merged multiple physical text plates. Split them back
      // into separate plate-derived rules so loading/no-parking/time-limit
      // signs cannot be swallowed by a neighboring plate.
      validationConfidenceCap = Math.min(validationConfidenceCap, 0.58);
      for (const plate of ruleTextPlates) {
        rules.push(fallbackRuleFromPlate(plate, extraction.plates, "Merged interpreter rule split by physical plate."));
        coveredTextPlateIds.add(plate.plate_index);
      }
      continue;
    }

    const plate = ruleTextPlates[0];
    const inferredWindow = parseTimeWindowFromPlateText(plate.text);
    const inferredType = inferRestrictionTypeFromPlateText(plate.text);
    const interpretedArrow = arrowFromUpper(r.arrow);
    const physicalArrow = derivedArrowForPlate(plate, extraction.plates);
    const hallucinatedArrow = interpretedArrow !== null && interpretedArrow !== physicalArrow;
    if (hallucinatedArrow) validationConfidenceCap = Math.min(validationConfidenceCap, 0.58);

    const interpretedDays = dayWordsTo3Letter(r.days);
    const type = restrictionTextFromType(r.restriction_type);
    const shouldPreferPlateType = type === "" || type === "unknown" || (inferredType !== "unknown" && type === "allowed");
    const perRuleConfidence = averagePlateConfidence(matchedPlates, extraction.overall_confidence);

    rules.push({
      type: shouldPreferPlateType ? inferredType : type,
      days: interpretedDays.length ? interpretedDays : parseDaysFromPlateText(plate.text),
      start: r.start_time ?? inferredWindow.start,
      end: r.end_time ?? inferredWindow.end,
      permit_zone: null,
      time_limit_minutes: r.time_limit_minutes ?? inferTimeLimitMinutes(plate.text),
      notes: r.notes ?? (plate.text.trim() || null),
      arrow: physicalArrow,
      confidence: hallucinatedArrow ? Math.min(perRuleConfidence, 0.58) : perRuleConfidence,
    });
    coveredTextPlateIds.add(plate.plate_index);
  }

  for (const plate of textPlates) {
    if (coveredTextPlateIds.has(plate.plate_index)) continue;
    validationConfidenceCap = Math.min(validationConfidenceCap, 0.58);
    rules.push(fallbackRuleFromPlate(plate, extraction.plates, "Interpreter omitted this physical plate."));
  }

  if (rules.length === 0 && textPlates.length > 0) {
    validationConfidenceCap = Math.min(validationConfidenceCap, 0.5);
  }

  if (extraction.plates.some((p) => p.arrow === "UNCLEAR")) {
    validationConfidenceCap = Math.min(validationConfidenceCap, 0.6);
  }

  // STACK-DIRECTION ENFORCEMENT: the rules engine must never claim a
  // direction that does not physically exist on the sign. Multiple plates do
  // NOT imply multiple directions — only physical arrow heads do.
  const stackDirs = physicalStackDirections(extraction.plates);
  if (stackDirs.size > 0 && !stackDirs.has("both")) {
    // No double-headed arrow was photographed → BOTH is never valid.
    for (const r of rules) {
      if (r.arrow === "both") {
        r.arrow = stackDirs.size === 1 ? [...stackDirs][0] : null;
        r.confidence = Math.min(r.confidence, 0.58);
        validationConfidenceCap = Math.min(validationConfidenceCap, 0.58);
      }
    }
  }
  if (stackDirs.size === 1) {
    const [only] = [...stackDirs];
    // Only one physical direction on the entire stack → every rule with no
    // arrow inherits it; rules pointing the opposite way were invented.
    for (const r of rules) {
      if (r.arrow == null) {
        r.arrow = only;
      } else if (r.arrow !== only) {
        r.arrow = only;
        r.confidence = Math.min(r.confidence, 0.55);
        validationConfidenceCap = Math.min(validationConfidenceCap, 0.55);
      }
    }
  }

  const finalRules = dedupeRawRules(rules);

  const overall_confidence = Math.min(
    extraction.overall_confidence || 0,
    interpretation.confidence || extraction.overall_confidence || 0,
    validationConfidenceCap,
  );

  return {
    raw_text,
    sign_count: extraction.plates.length,
    overall_confidence,
    rules: finalRules,
    model: AI_MODEL,
  };
}
