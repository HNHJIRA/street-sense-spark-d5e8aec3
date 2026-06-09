// AI sign scanner: extract parking rules from an image of one or more signs.
//
// We call Lovable AI Gateway (Gemini Flash) with an OCR + structured-output
// prompt so a single round-trip returns both the raw transcribed sign text
// and a normalized rule list. The normalized rules then flow through the
// existing providers/normalize.ts conflict resolver and the engine that
// powers Forecast / Can I Park Here / Sessions / Alerts. The scanner never
// hand-rolls its own evaluator.
import { normalizeCategory } from "@/lib/parking/providers/normalize";
import type { NormalizedRule } from "@/lib/parking/providers/types";

const AI_GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const AI_MODEL = "google/gemini-3-flash-preview";

export type ArrowDirection = "left" | "right" | "both" | null;

export interface RawAiRule {
  type: string;                // free-form, e.g. "NO PARKING", "STREET CLEANING"
  days: string[];              // ["MON","TUE",...]
  start: string | null;        // "HH:MM"
  end: string | null;          // "HH:MM"
  permit_zone: string | null;  // e.g. "ZONE 5"
  time_limit_minutes: number | null;
  notes: string | null;
  /** Directional arrow on the sign: "left" (←), "right" (→), "both" (↔). null = no arrow. */
  arrow: ArrowDirection;
  confidence: number;          // 0..1
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

/**
 * Convert AI output into the same NormalizedRule[] shape the SDOT provider
 * emits, so the rest of the pipeline (conflict resolver + engine) works
 * unchanged. Returns one rule per sign — multiple signs combine into multiple
 * rules on the synthesized "scan segment".
 */
export interface NormalizedScanRule extends NormalizedRule {
  arrow: ArrowDirection;
}

export function aiRulesToNormalized(rules: RawAiRule[]): NormalizedScanRule[] {
  return rules.map((r, idx) => {
    const classified = normalizeCategory(r.type);
    const days = parseDays(r.days);
    return {
      // Posted signs override SDOT data — give them a stronger priority bump
      // (lower number = higher priority in the engine).
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

const SYSTEM_PROMPT = `You are a parking-sign vision assistant.
You will receive one photo that may contain one or more US street parking signs.
Transcribe each sign verbatim and convert each sign into a structured rule.

Sign types you must recognize:
- NO PARKING, NO STOPPING, TOW AWAY ZONE
- STREET CLEANING / STREET SWEEPING
- LOADING ZONE (commercial / passenger)
- PERMIT PARKING / RPZ / RESIDENTIAL ZONE (capture the zone label)
- TIME LIMIT (e.g. "2 HOUR PARKING") — extract the limit in minutes
- METERED / PAID PARKING
- BUS ZONE / TRANSIT ZONE

DIRECTIONAL ARROWS — critical:
Many sign blocks include a directional arrow indicating which side of the
post the rule applies to:
- "←" or arrow pointing left  → arrow = "left"  (rule applies to the left side of the post)
- "→" or arrow pointing right → arrow = "right" (rule applies to the right side of the post)
- "↔" or double-headed arrow  → arrow = "both"  (rule applies in both directions)
- No arrow visible            → arrow = null    (rule applies to this whole pole)
Set arrow per sign — different signs on the same pole can have different arrows.

Output STRICT JSON matching the schema exactly. Days use 3-letter uppercase
codes (MON, TUE, ...). Times use 24-hour HH:MM. Use null when a field is not
posted. Confidence is 0..1 per sign and overall.`;

const RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    raw_text: { type: "string", description: "All sign text transcribed verbatim, one sign per paragraph." },
    sign_count: { type: "integer", minimum: 0 },
    overall_confidence: { type: "number", minimum: 0, maximum: 1 },
    rules: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["type", "days", "start", "end", "permit_zone", "time_limit_minutes", "notes", "confidence"],
        properties: {
          type: { type: "string" },
          days: { type: "array", items: { type: "string" } },
          start: { type: ["string", "null"] },
          end: { type: ["string", "null"] },
          permit_zone: { type: ["string", "null"] },
          time_limit_minutes: { type: ["integer", "null"] },
          notes: { type: ["string", "null"] },
          confidence: { type: "number", minimum: 0, maximum: 1 },
        },
      },
    },
  },
  required: ["raw_text", "sign_count", "overall_confidence", "rules"],
} as const;

interface GatewayMessage {
  role: "system" | "user";
  content: string | Array<
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string } }
  >;
}

/** Call Lovable AI Gateway with the parking-sign prompt and structured output. */
export async function callSignScanAi(imageBase64: string, mime: string, apiKey: string): Promise<AiScanResult> {
  const messages: GatewayMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: [
        { type: "text", text: "Transcribe and parse every parking sign visible in this image." },
        { type: "image_url", image_url: { url: `data:${mime};base64,${imageBase64}` } },
      ],
    },
  ];

  const res = await fetch(AI_GATEWAY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Lovable-API-Key": apiKey,
      "X-Lovable-AIG-SDK": "raw-fetch",
    },
    body: JSON.stringify({
      model: AI_MODEL,
      messages,
      response_format: {
        type: "json_schema",
        json_schema: { name: "parking_sign_extraction", strict: true, schema: RESPONSE_SCHEMA },
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    if (res.status === 429) throw new Error("Sign scanner is rate-limited. Try again in a moment.");
    if (res.status === 402) throw new Error("AI credits exhausted. Add credits in workspace settings.");
    throw new Error(`Sign scanner failed (${res.status}): ${body.slice(0, 200)}`);
  }

  const data = await res.json() as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content ?? "{}";
  let parsed: AiScanResult;
  try {
    parsed = JSON.parse(content) as AiScanResult;
  } catch {
    throw new Error("Sign scanner returned non-JSON output.");
  }

  return {
    raw_text: parsed.raw_text ?? "",
    sign_count: parsed.sign_count ?? (parsed.rules?.length ?? 0),
    overall_confidence: typeof parsed.overall_confidence === "number" ? parsed.overall_confidence : 0,
    rules: Array.isArray(parsed.rules) ? parsed.rules : [],
    model: AI_MODEL,
  };
}
