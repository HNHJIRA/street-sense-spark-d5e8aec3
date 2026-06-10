// Deterministic Driver Summary Generator. Consumes the engine decision
// (ParkingStatus) + posted-rule context and produces a plain-English,
// driver-friendly narrative plus the structured countdown / next-restriction
// fields the final scan response contract requires. We never re-interpret
// rules here — the engine remains the source of truth.
import type { ParkingStatus, ParkingRule } from "./types";
import type { NormalizedRule } from "./providers/types";

export type DriverStatus = "YES" | "NO" | "LIMITED" | "UNKNOWN";

export interface DriverNarrative {
  status: DriverStatus;
  summary: string;
  allowed_until: string | null;
  time_remaining_seconds: number | null;
  time_remaining_minutes: number | null;
  time_remaining_human: string | null;
  next_restriction_reason: string | null;
  next_restriction_start: string | null;
  next_restriction_end: string | null;
  permit_required: boolean;
  time_limit_minutes: number | null;
}

const REASON_LABEL: Record<string, string> = {
  no_parking: "No Parking",
  no_stopping: "No Stopping",
  tow_away: "Tow Away",
  street_cleaning: "Street Cleaning",
  street_sweeping: "Street Cleaning",
  loading_zone: "Loading Zone",
  loading: "Loading Zone",
  commercial_loading: "Loading Zone",
  passenger_loading: "Loading Zone",
  permit: "Permit Parking",
  permit_parking: "Permit Parking",
  permit_only: "Permit Parking",
  rpz: "Permit Parking",
  time_limit: "Time-Limited Parking",
  time_limited: "Time-Limited Parking",
  meter: "Meter Parking",
  paid: "Meter Parking",
  metered: "Meter Parking",
  bus_zone: "Bus Lane",
  transit_zone: "Bus Lane",
  red_curb: "Red Curb (No Stopping)",
  free: "Free Parking",
  unrestricted: "Free Parking",
  unknown: "Unknown — verify posted sign",
};

function reasonLabel(code: string | null | undefined): string {
  if (!code) return "Posted Restriction";
  return REASON_LABEL[code] ?? code.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function fmtClock(iso: string | null, tz: string): string | null {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: tz,
    });
  } catch {
    return null;
  }
}

function fmtDayClock(iso: string, tz: string, now: Date): string {
  const d = new Date(iso);
  const sameDay =
    d.toLocaleDateString("en-US", { timeZone: tz }) ===
    now.toLocaleDateString("en-US", { timeZone: tz });
  return d.toLocaleString("en-US", {
    weekday: sameDay ? undefined : "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone: tz,
  });
}

function humanDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h === 0 && m === 0) return "less than a minute";
  if (h === 0) return `${m} minute${m === 1 ? "" : "s"}`;
  if (m === 0) return `${h} hour${h === 1 ? "" : "s"}`;
  return `${h} hour${h === 1 ? "" : "s"} ${m} minute${m === 1 ? "" : "s"}`;
}

function statusFrom(decision: ParkingStatus): DriverStatus {
  if (decision.code === "unknown") return "UNKNOWN";
  if (decision.color === "green") return "YES";
  if (decision.color === "red") return "NO";
  return "LIMITED";
}

export interface BuildNarrativeArgs {
  decision: ParkingStatus;
  parsedRules: NormalizedRule[];
  now: Date;
  timezone: string;
}

/** Build the full driver-facing narrative for a single decision. */
export function buildDriverNarrative(args: BuildNarrativeArgs): DriverNarrative {
  const { decision, parsedRules, now, timezone } = args;
  const status = statusFrom(decision);

  // Restriction code preference: engine's active code, then first posted rule.
  let reasonCode: string = decision.code;
  if ((reasonCode === "unknown" || reasonCode === "free") && parsedRules.length > 0) {
    reasonCode = parsedRules[0].restriction_code;
  }
  const reason = reasonLabel(reasonCode);

  // Countdown sources: when allowed (YES/LIMITED) use allowed_until → that's
  // when the user must move. When restricted (NO) use restriction_ends_at →
  // that's when parking becomes available again.
  let countdownTarget: string | null = null;
  if (status === "YES" || status === "LIMITED") {
    countdownTarget = decision.allowed_until;
  } else if (status === "NO") {
    countdownTarget = decision.restriction_ends_at;
  }
  let time_remaining_seconds: number | null = null;
  let time_remaining_minutes: number | null = null;
  let time_remaining_human: string | null = null;
  if (countdownTarget) {
    const diff = Math.floor((new Date(countdownTarget).getTime() - now.getTime()) / 1000);
    time_remaining_seconds = diff;
    time_remaining_minutes = Math.max(0, Math.floor(diff / 60));
    time_remaining_human = diff > 0 ? humanDuration(diff) : "Expired";
  }

  // Next restriction: prefer explicit restriction_starts_at; otherwise the end
  // of the current restriction implies the next "rule change".
  const next_restriction_start = decision.restriction_starts_at;
  const next_restriction_end = decision.restriction_ends_at;
  const next_restriction_reason =
    next_restriction_start || next_restriction_end ? reason : null;

  const weekday = now.toLocaleDateString("en-US", { weekday: "long", timeZone: timezone });
  const clockNow = now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: timezone });
  const allowedClock = fmtClock(decision.allowed_until, timezone);
  const startClock = fmtClock(decision.restriction_starts_at, timezone);
  const endClock = fmtClock(decision.restriction_ends_at, timezone);

  const permit_required = !!decision.permit_zone;
  const time_limit_minutes = decision.time_limit_minutes ?? null;

  // Compose driver-friendly multi-sentence summary.
  let summary: string;
  if (status === "UNKNOWN") {
    summary = [
      "Parking legality cannot be verified.",
      "The sign could not be interpreted with sufficient confidence.",
      "Please verify the posted signage before parking.",
    ].join(" ");
  } else if (status === "YES") {
    const parts = [
      "You can park here right now.",
      `Today is ${weekday} and it is currently ${clockNow}.`,
      "Parking is allowed on this side of the street.",
    ];
    if (startClock) parts.push(`The next restriction begins at ${startClock}.`);
    if (time_remaining_human && time_remaining_seconds && time_remaining_seconds > 0) {
      parts.push(`You have approximately ${time_remaining_human} remaining before parking restrictions start.`);
    }
    parts.push(permit_required
      ? `Permit ${decision.permit_zone} is required.`
      : "No permit is required.");
    summary = parts.join(" ");
  } else if (status === "LIMITED") {
    const parts = [
      time_limit_minutes
        ? `You can park here right now, but only for ${time_limit_minutes} minutes.`
        : "You can park here right now, with restrictions.",
      `Today is ${weekday} and it is currently ${clockNow}.`,
    ];
    if (time_limit_minutes) {
      parts.push(`The posted time limit is ${formatLimit(time_limit_minutes)}.`);
      if (allowedClock) {
        parts.push(`If you park now, you must move your vehicle by ${allowedClock}.`);
        parts.push(`After ${allowedClock} you may be subject to citation.`);
      }
    }
    if (permit_required) parts.push(`Permit ${decision.permit_zone} is required.`);
    summary = parts.join(" ");
  } else {
    // NO
    const parts = [
      "You cannot park here right now.",
      `${reason} restrictions are active.`,
    ];
    if (startClock && endClock) parts.push(`Restrictions apply from ${startClock} to ${endClock}.`);
    else if (endClock) parts.push(`Restrictions are in effect until ${endClock}.`);
    if (endClock) {
      parts.push(`Parking becomes available again at ${endClock}.`);
    }
    summary = parts.join(" ");
  }

  return {
    status,
    summary,
    allowed_until: decision.allowed_until,
    time_remaining_seconds,
    time_remaining_minutes,
    time_remaining_human,
    next_restriction_reason,
    next_restriction_start,
    next_restriction_end,
    permit_required,
    time_limit_minutes,
  };
}

function formatLimit(min: number): string {
  if (min % 60 === 0) {
    const h = min / 60;
    return `${h} hour${h === 1 ? "" : "s"}`;
  }
  return `${min} minutes`;
}

/** Short per-side caption, e.g. for left_summary / right_summary. */
export function buildSideCaption(args: {
  side: "left" | "right";
  decision: ParkingStatus;
  parsedRules: NormalizedRule[];
  timezone: string;
}): string {
  const { side, decision, parsedRules, timezone } = args;
  const status = statusFrom(decision);
  let code: string = decision.code;
  if ((code === "unknown" || code === "free") && parsedRules.length > 0) {
    code = parsedRules[0].restriction_code;
  }
  const reason = reasonLabel(code).toLowerCase();
  const sideLabel = side === "left" ? "LEFT" : "RIGHT";
  const allowedClock = fmtClock(decision.allowed_until, timezone);
  const startClock = fmtClock(decision.restriction_starts_at, timezone);
  const endClock = fmtClock(decision.restriction_ends_at, timezone);

  if (status === "YES") {
    if (allowedClock) return `The ${sideLabel} side of this sign allows parking until ${allowedClock}.`;
    return `The ${sideLabel} side of this sign allows parking right now.`;
  }
  if (status === "LIMITED") {
    if (decision.time_limit_minutes)
      return `The ${sideLabel} side has a ${formatLimit(decision.time_limit_minutes)} time limit.`;
    if (decision.permit_zone)
      return `The ${sideLabel} side requires permit ${decision.permit_zone}.`;
    if (startClock) return `The ${sideLabel} side has a ${reason} restriction beginning at ${startClock}.`;
    return `The ${sideLabel} side has limited parking (${reason}).`;
  }
  if (status === "NO") {
    if (endClock) return `The ${sideLabel} side has a ${reason} restriction until ${endClock}.`;
    return `The ${sideLabel} side does not allow parking (${reason}).`;
  }
  return `The ${sideLabel} side could not be interpreted — verify the posted sign.`;
}
