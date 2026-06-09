// AI Driver Summary — natural-language parking explanation generated from
// the structured ParkingDecision (NOT from raw OCR or provider text). The
// engine still decides; the AI only narrates that decision.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const AI_GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const AI_MODEL = "google/gemini-3-flash-preview";

const SummaryInput = z.object({
  verdict: z.enum(["YES", "NO", "LIMITED", "UNKNOWN"]),
  street_name: z.string().min(1).max(200),
  status_label: z.string().min(1).max(120),
  reason: z.string().max(400).nullable().optional(),
  allowed_until_human: z.string().max(80).nullable().optional(),
  time_remaining_human: z.string().max(80).nullable().optional(),
  max_stay_minutes: z.number().int().nullable().optional(),
  permit_zone: z.string().max(80).nullable().optional(),
  next_restriction_label: z.string().max(120).nullable().optional(),
  next_restriction_starts_human: z.string().max(80).nullable().optional(),
  data_source: z.string().max(120).nullable().optional(),
  /** Optional context for recommended-spot summaries. */
  distance_m: z.number().nullable().optional(),
  walking_minutes: z.number().nullable().optional(),
  mode: z.enum(["decision", "recommendation"]).default("decision"),
});

export type DriverSummaryInput = z.infer<typeof SummaryInput>;

export interface DriverSummaryResult {
  summary: string;
  model: string;
}

const SYSTEM_PROMPT = `You are a calm, concise parking assistant for a driver.
You will receive STRUCTURED PARKING DECISION DATA produced by a deterministic
rules engine. Your job is to explain that decision in plain English — never
re-interpret rules, never guess legality, never contradict the verdict.

Style:
- 2 to 4 short sentences, no lists, no markdown.
- Speak directly to the driver ("You can park here…", "You cannot park here…").
- Always include: current status, whether parking is allowed, why, allowed
  until (if known), time remaining (if known), max stay (if any), permit
  requirement (if any), and the next restriction (if any) with its start.
- For UNKNOWN: tell the driver the status cannot be verified and they should
  check the posted sign.
- For recommendation mode: lead with distance + walking time, then legality.`;

export const getDriverSummary = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => SummaryInput.parse(input))
  .handler(async ({ data }): Promise<DriverSummaryResult> => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) {
      return { summary: fallbackSummary(data), model: "fallback" };
    }

    const userPayload = JSON.stringify(data, null, 2);
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
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: `Generate the driver summary from this decision data:\n\n${userPayload}`,
          },
        ],
        temperature: 0.3,
      }),
    });

    if (!res.ok) {
      // Surface a usable fallback rather than failing the screen.
      if (res.status === 429 || res.status === 402) {
        return { summary: fallbackSummary(data), model: "fallback" };
      }
      return { summary: fallbackSummary(data), model: "fallback" };
    }

    const json = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
    const text = json.choices?.[0]?.message?.content?.trim();
    if (!text) return { summary: fallbackSummary(data), model: "fallback" };
    return { summary: text, model: AI_MODEL };
  });

function fallbackSummary(d: DriverSummaryInput): string {
  if (d.mode === "recommendation") {
    const dist = d.distance_m != null ? `${Math.round(d.distance_m)} meters away` : "nearby";
    const walk = d.walking_minutes != null ? `, about a ${Math.max(1, Math.round(d.walking_minutes))} minute walk` : "";
    const until = d.allowed_until_human ? ` Parking is allowed until ${d.allowed_until_human}.` : "";
    const permit = d.permit_zone ? ` Permit zone ${d.permit_zone} required.` : " No permit required.";
    return `This is the best nearby option, ${dist}${walk}.${until}${permit}`;
  }
  if (d.verdict === "UNKNOWN") {
    return `Parking status on ${d.street_name} cannot be verified from current data. Please check the posted sign before parking.`;
  }
  const head = d.verdict === "YES"
    ? `You can legally park here right now on ${d.street_name}.`
    : d.verdict === "LIMITED"
      ? `Parking on ${d.street_name} is limited: ${d.status_label.toLowerCase()}.`
      : `You cannot park on ${d.street_name} right now: ${d.status_label.toLowerCase()}.`;
  const until = d.allowed_until_human ? ` Allowed until ${d.allowed_until_human}.` : "";
  const remaining = d.time_remaining_human ? ` You have about ${d.time_remaining_human} remaining.` : "";
  const max = d.max_stay_minutes ? ` Maximum stay is ${d.max_stay_minutes} minutes.` : "";
  const permit = d.permit_zone ? ` Permit zone ${d.permit_zone} required.` : "";
  const next = d.next_restriction_label && d.next_restriction_starts_human
    ? ` Next: ${d.next_restriction_label} at ${d.next_restriction_starts_human} — move your vehicle before then.`
    : "";
  return `${head}${until}${remaining}${max}${permit}${next}`.trim();
}
