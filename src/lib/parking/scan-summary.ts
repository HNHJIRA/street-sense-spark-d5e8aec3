// AI Parking Summary layer — converts the engine's ParkingStatus + normalized
// rule list into a 5-second, driver-friendly explanation.
//
// Source of truth: the same evaluateRulesAt() output used everywhere else.
// We never read raw OCR here; only normalized rules + the engine decision.
import type { ParkingRule, ParkingStatus } from "./types";
import type { NormalizedRule } from "./providers/types";

export type ScanStatus = "YES" | "NO" | "LIMITED" | "UNKNOWN";
export type ScanConfidence = "High" | "Medium" | "Low";

export interface ScanTimelineEntry {
  when: string;            // ISO timestamp, or "now"
  when_label: string;      // human label, e.g. "Now", "10:00 AM"
  status: ScanStatus;
  icon: "allowed" | "restricted" | "limited" | "unknown";
  label: string;           // short reason, e.g. "Parking allowed", "Street cleaning"
}

export interface ScanSummary {
  status: ScanStatus;
  /** Short reason category, e.g. "Street Cleaning". */
  reason: string;
  /** One-sentence plain English summary. */
  plain: string;
  /** Optional next-step time guidance, e.g. "You may park after 10:00 AM." */
  time_guidance: string | null;
  confidence: ScanConfidence;
  /** 1–3 step timeline (Now → next change → following change). */
  timeline: ScanTimelineEntry[];
}

// Friendly labels for normalized restriction codes used by the engine.
const REASON_LABEL: Record<string, string> = {
  no_parking: "No Parking",
  no_stopping: "No Stopping",
  tow_away: "Tow Away",
  street_cleaning: "Street Cleaning",
  street_sweeping: "Street Cleaning",
  loading_zone: "Loading Zone",
  loading: "Loading Zone",
  loading_only: "Loading Zone",
  passenger_loading: "Passenger Loading Only",
  commercial_loading: "Commercial Loading Only",
  taxi_zone: "Taxi Zone",
  bus_zone: "Bus Zone",
  permit: "Permit Parking",
  permit_parking: "Permit Parking",
  rpz: "Permit Parking",
  time_limit: "Time-Limited Parking",
  meter: "Meter Parking",
  paid: "Meter Parking",
  metered: "Meter Parking",
  bus_lane: "Bus Lane",
  transit_zone: "Bus Lane",
  red_curb: "Red Curb (No Stopping)",
  free: "Currently Allowed",
  unrestricted: "Currently Allowed",
  allowed: "Currently Allowed",
  unknown: "Unknown / Verify Sign",
};

function reasonFor(code: string | null | undefined): string {
  if (!code) return "Posted Restriction";
  return REASON_LABEL[code] ?? code.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function fmtTime(iso: string | null, tz: string): string | null {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
      timeZone: tz,
    });
  } catch {
    return null;
  }
}

function fmtWeekdayTime(iso: string | null, tz: string): string | null {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleString([], {
      weekday: "short",
      hour: "numeric",
      minute: "2-digit",
      timeZone: tz,
    });
  } catch {
    return null;
  }
}

function statusFromDecision(decision: ParkingStatus): ScanStatus {
  if (decision.code === "unknown") return "UNKNOWN";
  if (decision.color === "green") return "YES";
  if (decision.color === "red") return "NO";
  return "LIMITED";
}

function iconFor(status: ScanStatus): ScanTimelineEntry["icon"] {
  if (status === "YES") return "allowed";
  if (status === "NO") return "restricted";
  if (status === "LIMITED") return "limited";
  return "unknown";
}

function buildPlain(
  status: ScanStatus,
  reason: string,
  decision: ParkingStatus,
  tz: string,
): string {
  const startT = fmtTime(decision.restriction_starts_at, tz);
  const endT = fmtTime(decision.restriction_ends_at, tz);
  const allowedT = fmtTime(decision.allowed_until, tz);

  if (status === "UNKNOWN") {
    return "We can't confirm the rule for this spot. Read the sign carefully before parking.";
  }
  if (status === "YES") {
    if (allowedT) return `You can park here now. Move by ${allowedT} to avoid the next restriction.`;
    if (decision.time_limit_minutes != null)
      return `You can park here now, up to ${decision.time_limit_minutes} minutes.`;
    return "You can park here right now.";
  }
  if (status === "NO") {
    const why = reason.toLowerCase();
    if (endT) return `You cannot park here right now because ${why} is active. It ends at ${endT}.`;
    return `You cannot park here right now because ${why} is active.`;
  }
  // LIMITED
  const loadingHint = LOADING_HINTS[decision.code];
  if (loadingHint) {
    const limit = decision.time_limit_minutes != null ? ` ${decision.time_limit_minutes}-minute limit.` : "";
    const ends = endT ? ` This restriction is in effect until ${endT}.` : "";
    return `${reason} is active — general parking is not permitted right now. ${loadingHint}${limit}${ends}`;
  }
  if (decision.permit_zone)
    return `Parking is limited — a ${decision.permit_zone} permit is required.`;
  if (decision.time_limit_minutes != null)
    return `Parking is limited to ${decision.time_limit_minutes} minutes.`;
  if (startT) return `Parking is limited. The next restriction starts at ${startT}.`;
  return `Parking is limited here — ${reason.toLowerCase()} applies.`;
}

function buildTimeGuidance(
  status: ScanStatus,
  decision: ParkingStatus,
  tz: string,
): string | null {
  const startT = fmtTime(decision.restriction_starts_at, tz);
  const endT = fmtTime(decision.restriction_ends_at, tz);
  const allowedT = fmtTime(decision.allowed_until, tz);
  if (status === "NO" && endT) return `You may park after ${endT}.`;
  if (status === "YES" && allowedT) return `You may remain parked until ${allowedT}.`;
  if (status === "LIMITED" && startT) return `Restriction starts at ${startT}.`;
  if (status === "LIMITED" && endT) return `Restriction ends at ${endT}.`;
  return null;
}

function confidenceFor(
  decision: ParkingStatus,
  aiConfidence: number,
  signCount: number,
): ScanConfidence {
  if (decision.code === "unknown") return "Low";
  const score = aiConfidence + (signCount > 1 ? -0.05 : 0);
  if (score >= 0.8) return "High";
  if (score >= 0.55) return "Medium";
  return "Low";
}

function buildTimeline(
  status: ScanStatus,
  reason: string,
  decision: ParkingStatus,
  tz: string,
): ScanTimelineEntry[] {
  const entries: ScanTimelineEntry[] = [
    {
      when: "now",
      when_label: "Now",
      status,
      icon: iconFor(status),
      label:
        status === "YES" ? "Parking allowed"
        : status === "NO" ? reason
        : status === "UNKNOWN" ? "Verify sign"
        : reason,
    },
  ];

  // Next change: whichever of starts_at / ends_at / allowed_until comes first.
  const candidates: Array<{ iso: string; kind: "restriction_start" | "restriction_end" | "allowed_until" }> = [];
  if (decision.restriction_starts_at)
    candidates.push({ iso: decision.restriction_starts_at, kind: "restriction_start" });
  if (decision.restriction_ends_at)
    candidates.push({ iso: decision.restriction_ends_at, kind: "restriction_end" });
  if (decision.allowed_until)
    candidates.push({ iso: decision.allowed_until, kind: "allowed_until" });

  candidates.sort((a, b) => new Date(a.iso).getTime() - new Date(b.iso).getTime());

  for (const c of candidates.slice(0, 2)) {
    const label = fmtWeekdayTime(c.iso, tz) ?? "Later";
    if (c.kind === "restriction_start" || c.kind === "allowed_until") {
      entries.push({
        when: c.iso,
        when_label: label,
        status: "NO",
        icon: "restricted",
        label: reason !== "Free Parking" ? reason : "Restriction begins",
      });
    } else {
      entries.push({
        when: c.iso,
        when_label: label,
        status: "YES",
        icon: "allowed",
        label: "Parking allowed",
      });
    }
  }
  return entries;
}

/**
 * Build the user-facing summary from the engine decision + normalized rules.
 * The combined rule list (posted + SDOT) is accepted so callers can pass
 * either the full list or just the AI rules; we only use it to disambiguate
 * the reason when the engine's active code is `unknown` / `free`.
 */
export function buildScanSummary(args: {
  decision: ParkingStatus;
  parsedRules: NormalizedRule[];
  sdotRules: ParkingRule[];
  timezone: string;
  aiConfidence: number;
  signCount: number;
}): ScanSummary {
  const { decision, parsedRules, timezone, aiConfidence, signCount } = args;
  const status = statusFromDecision(decision);

  // Prefer the engine's active rule code. When the engine reports YES (no
  // active restriction) we must NOT fall back to the first posted rule's
  // code — that surfaces "No Parking" while the status is "YES", which is
  // contradictory. Only borrow a posted rule code when the engine truly
  // matched a restriction (NO/LIMITED) but didn't name it.
  let reasonCode: string = decision.code;
  if (status !== "YES" && (reasonCode === "unknown" || reasonCode === "free") && parsedRules.length > 0) {
    reasonCode = parsedRules[0].restriction_code;
  } else if (status === "YES" && (reasonCode === "unknown" || reasonCode === "free")) {
    reasonCode = "free";
  }
  const reason = reasonFor(reasonCode);
  const plain = buildPlain(status, reason, decision, timezone);
  const time_guidance = buildTimeGuidance(status, decision, timezone);
  const confidence = confidenceFor(decision, aiConfidence, signCount);
  const timeline = buildTimeline(status, reason, decision, timezone);

  return { status, reason, plain, time_guidance, confidence, timeline };
}
