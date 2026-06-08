// Pure parking rules engine. No DB / no UI imports.
// Input: a street segment (with its rules + events) and a "when" timestamp.
// Output: ParkingStatus computed in the city's timezone.

import type {
  ParkingEvent,
  ParkingRule,
  ParkingStatus,
  RestrictionType,
  StreetSegment,
} from "./types";

interface CityClock {
  dow: number; // 0=Sun..6=Sat
  hhmm: number; // minutes since midnight in city tz
  ymd: string; // YYYY-MM-DD in city tz
}

const DOW_MAP: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

function cityClock(when: Date, timezone: string): CityClock {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(when);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const dow = DOW_MAP[get("weekday")] ?? 0;
  const hour = parseInt(get("hour") === "24" ? "00" : get("hour"), 10);
  const minute = parseInt(get("minute"), 10);
  const ymd = `${get("year")}-${get("month")}-${get("day")}`;
  return { dow, hhmm: hour * 60 + minute, ymd };
}

function parseHHMM(s: string | null): number | null {
  if (!s) return null;
  const [h, m] = s.split(":");
  return parseInt(h, 10) * 60 + parseInt(m, 10);
}

function ruleAppliesNow(rule: ParkingRule, clock: CityClock): boolean {
  if (rule.effective_from && clock.ymd < rule.effective_from) return false;
  if (rule.effective_to && clock.ymd > rule.effective_to) return false;
  if (!rule.days_of_week.includes(clock.dow)) return false;
  const start = parseHHMM(rule.time_start);
  const end = parseHHMM(rule.time_end);
  if (start == null || end == null) return true;
  if (start <= end) return clock.hhmm >= start && clock.hhmm < end;
  return clock.hhmm >= start || clock.hhmm < end;
}

function activeEvent(events: ParkingEvent[], when: Date): ParkingEvent | null {
  const ms = when.getTime();
  for (const ev of events) {
    const s = Date.parse(ev.starts_at);
    const e = Date.parse(ev.ends_at);
    if (ms >= s && ms < e) return ev;
  }
  return null;
}

function nextBoundary(rule: ParkingRule | null, timezone: string, when: Date): string | null {
  if (!rule) return null;
  const end = parseHHMM(rule.time_end);
  if (end == null) return null;
  const clock = cityClock(when, timezone);
  const minutesUntil = end > clock.hhmm ? end - clock.hhmm : 24 * 60 - clock.hhmm + end;
  const boundary = new Date(when.getTime() + minutesUntil * 60 * 1000);
  return boundary.toISOString();
}

/** Evaluate a segment's rules at a given datetime in the city's timezone. */
export function evaluateRulesAt(
  segment: StreetSegment,
  restrictionTypes: RestrictionType[],
  when: Date,
  timezone: string,
): ParkingStatus {
  const typeByCode = new Map(restrictionTypes.map((t) => [t.code, t]));
  const clock = cityClock(when, timezone);

  // 1) Temporary event wins (street closure, construction, etc.)
  const ev = activeEvent(segment.events, when);
  if (ev) {
    const t = typeByCode.get(ev.restriction_code);
    return {
      color: t?.color ?? "red",
      code: ev.restriction_code,
      label: t?.label ?? ev.restriction_code,
      notes: ev.reason,
      permit_zone: null,
      time_limit_minutes: null,
      rule_id: null,
      event_id: ev.id,
      allowed_until: null,
      restriction_starts_at: ev.starts_at,
      restriction_ends_at: ev.ends_at,
    };
  }

  // 2) Lowest-priority-number rule that matches the clock wins.
  const sorted = [...segment.rules].sort((a, b) => a.priority - b.priority);
  const match = sorted.find((r) => ruleAppliesNow(r, clock)) ?? null;

  if (!match) {
    const allowed = typeByCode.get("allowed");
    return {
      color: allowed?.color ?? "green",
      code: "allowed",
      label: allowed?.label ?? "Parking Allowed",
      notes: null,
      permit_zone: null,
      time_limit_minutes: null,
      rule_id: null,
      event_id: null,
      allowed_until: null,
      restriction_starts_at: null,
      restriction_ends_at: null,
    };
  }

  const t = typeByCode.get(match.restriction_code);
  return {
    color: t?.color ?? "yellow",
    code: match.restriction_code,
    label: t?.label ?? match.restriction_code,
    notes: match.notes,
    permit_zone: match.permit_zone,
    time_limit_minutes: match.time_limit_minutes,
    rule_id: match.id,
    event_id: null,
    allowed_until: t?.color === "green" ? null : nextBoundary(match, timezone, when),
    restriction_starts_at: null,
    restriction_ends_at: null,
  };
}

/** Back-compat alias — older callers use computeStatus. */
export const computeStatus = evaluateRulesAt;
