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

/** Format an HH:MM (24h) string as 12h clock; pure, no timezone needed. */
function fmtHHMM12(hhmm: string | null | undefined): string | null {
  if (!hhmm) return null;
  const [hStr, mStr] = hhmm.split(":");
  const h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  const period = h >= 12 ? "PM" : "AM";
  const h12 = ((h + 11) % 12) + 1;
  return m === 0 ? `${h12} ${period}` : `${h12}:${m.toString().padStart(2, "0")} ${period}`;
}

/** Describe a posted rule as "NO PARKING 1:30 AM – 6 AM" / "1-hour parking 8 AM – 6 PM". */
function describePostedRule(r: NormalizedRule): string {
  const code = r.restriction_code ?? "";
  const lim = r.time_limit_minutes ?? null;
  const head = lim
    ? (lim % 60 === 0 ? `${lim / 60}-hour parking` : `${lim}-minute parking`)
    : reasonLabel(code);
  const a = fmtHHMM12(r.time_start);
  const b = fmtHHMM12(r.time_end);
  const window = a && b ? ` ${a} – ${b}` : "";
  return `${head}${window}`;
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
  if (status !== "YES" && (code === "unknown" || code === "free") && parsedRules.length > 0) {
    code = parsedRules[0].restriction_code;
  }
  const reason = reasonLabel(code).toLowerCase();
  const sideLabel = side === "left" ? "LEFT" : "RIGHT";
  const allowedClock = fmtClock(decision.allowed_until, timezone);
  const startClock = fmtClock(decision.restriction_starts_at, timezone);
  const endClock = fmtClock(decision.restriction_ends_at, timezone);

  // Suffix listing posted-but-inactive rules so the caller can see the
  // nightly NO PARKING / upcoming 1HR plate even when YES.
  const postedSuffix = parsedRules.length > 0
    ? ` Posted: ${parsedRules.map(describePostedRule).join("; ")}.`
    : "";

  if (status === "YES") {
    if (allowedClock) return `The ${sideLabel} side of this sign allows parking until ${allowedClock}.${postedSuffix}`;
    return `The ${sideLabel} side of this sign allows parking right now.${postedSuffix}`;
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

// ============================================================
// Rule timeline + risk projection (Edge-case sprint)
// ============================================================

export interface RuleSummary {
  restriction_type: string;
  label: string;
  starts_at: string;
  ends_at: string;
  starts_at_human: string;
  ends_at_human: string;
  time_until_seconds: number;
  time_until_human: string;
  permit_zone: string | null;
  time_limit_minutes: number | null;
  notes: string | null;
}

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH";

const HIGH_RISK_CODES = new Set([
  "no_parking", "no_stopping", "no_standing", "tow_away", "red_curb", "bus_zone", "transit_zone",
]);
const MED_RISK_CODES = new Set(["street_cleaning", "street_sweeping"]);

export function deriveRiskLevel(rules: NormalizedRule[], rawText: string): RiskLevel {
  const text = (rawText || "").toUpperCase();
  if (text.includes("TOW AWAY") || text.includes("NO STANDING") || text.includes("ANY TIME") || text.includes("ANYTIME")) return "HIGH";
  for (const r of rules) if (HIGH_RISK_CODES.has(r.restriction_code)) return "HIGH";
  for (const r of rules) if (MED_RISK_CODES.has(r.restriction_code)) return "MEDIUM";
  return "LOW";
}

interface ZonedNow { weekday: number; minutes: number }
function zonedNow(d: Date, tz: string): ZonedNow {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(d);
  const wd = parts.find((p) => p.type === "weekday")?.value ?? "Sun";
  const h = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
  const m = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0", 10);
  const wdMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { weekday: wdMap[wd] ?? 0, minutes: (h % 24) * 60 + m };
}
function parseHHMM(s: string | null): number | null {
  if (!s) return null;
  const [h, m] = s.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

interface Occurrence { startIso: string; endIso: string; rule: NormalizedRule; active: boolean }
function nextOccurrence(rule: NormalizedRule, now: Date, tz: string): Occurrence | null {
  const z = zonedNow(now, tz);
  const startM = parseHHMM(rule.time_start) ?? 0;
  const endM = parseHHMM(rule.time_end) ?? 1440;
  if (endM <= startM) return null;
  for (let day = 0; day < 8; day++) {
    const candWd = (z.weekday + day) % 7;
    if (!rule.days_of_week.includes(candWd)) continue;
    if (day === 0 && z.minutes >= startM && z.minutes < endM) {
      const startIso = new Date(now.getTime() - (z.minutes - startM) * 60000).toISOString();
      const endIso = new Date(now.getTime() + (endM - z.minutes) * 60000).toISOString();
      return { startIso, endIso, rule, active: true };
    }
    if (day === 0 && z.minutes >= endM) continue;
    const offsetMin = day * 1440 + startM - z.minutes;
    const startIso = new Date(now.getTime() + offsetMin * 60000).toISOString();
    const endIso = new Date(new Date(startIso).getTime() + (endM - startM) * 60000).toISOString();
    return { startIso, endIso, rule, active: false };
  }
  return null;
}

function toRuleSummary(o: Occurrence, now: Date, tz: string): RuleSummary {
  const untilSec = Math.max(0, Math.floor((new Date(o.startIso).getTime() - now.getTime()) / 1000));
  return {
    restriction_type: o.rule.restriction_code,
    label: reasonLabel(o.rule.restriction_code),
    starts_at: o.startIso,
    ends_at: o.endIso,
    starts_at_human: fmtDayClock(o.startIso, tz, now),
    ends_at_human: fmtDayClock(o.endIso, tz, now),
    time_until_seconds: untilSec,
    time_until_human: o.active ? "Active now" : humanDuration(untilSec),
    permit_zone: o.rule.permit_zone,
    time_limit_minutes: o.rule.time_limit_minutes,
    notes: o.rule.notes,
  };
}

export interface RuleTimeline {
  current_rule: RuleSummary | null;
  next_rule: RuleSummary | null;
  following_rule: RuleSummary | null;
  countdown_to_next_rule: string | null;
  countdown_to_following_rule: string | null;
}

export function buildRuleTimeline(rules: NormalizedRule[], now: Date, tz: string): RuleTimeline {
  const occurrences: Occurrence[] = [];
  for (const r of rules) {
    const occ = nextOccurrence(r, now, tz);
    if (occ) occurrences.push(occ);
  }
  occurrences.sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1;
    return new Date(a.startIso).getTime() - new Date(b.startIso).getTime();
  });
  const active = occurrences.find((o) => o.active) ?? null;
  const future = occurrences.filter((o) => !o.active);
  const next = future[0] ?? null;
  const following = future[1] ?? null;
  return {
    current_rule: active ? toRuleSummary(active, now, tz) : null,
    next_rule: next ? toRuleSummary(next, now, tz) : null,
    following_rule: following ? toRuleSummary(following, now, tz) : null,
    countdown_to_next_rule: next ? humanDuration(Math.max(0, Math.floor((new Date(next.startIso).getTime() - now.getTime()) / 1000))) : null,
    countdown_to_following_rule: following ? humanDuration(Math.max(0, Math.floor((new Date(following.startIso).getTime() - now.getTime()) / 1000))) : null,
  };
}


