// Decision timeline. Pure — given a segment + restriction types + timezone,
// walks forward N hours and emits the boundary moments at which the engine's
// verdict changes. UI renders these as a vertical timeline.
import { evaluateRulesAt } from "./engine";
import type { ParkingColor, RestrictionType, StreetSegment, ParkingStatus } from "./types";

export interface TimelineEntry {
  iso: string;
  isNow: boolean;
  color: ParkingColor;
  code: string;
  label: string;
  reason: string | null;
  allowedUntil: string | null;
  permitZone: string | null;
  timeLimitMinutes: number | null;
}

export interface BuildTimelineOptions {
  hoursAhead?: number;   // default 24
  stepMinutes?: number;  // default 15 — smaller catches narrow rules
  maxEntries?: number;   // default 8 — UI cap
}

function entryFromStatus(when: Date, status: ParkingStatus, isNow: boolean): TimelineEntry {
  return {
    iso: when.toISOString(),
    isNow,
    color: status.color,
    code: status.code,
    label: status.label,
    reason: status.notes,
    allowedUntil: status.allowed_until,
    permitZone: status.permit_zone,
    timeLimitMinutes: status.time_limit_minutes,
  };
}

function sameState(a: ParkingStatus, b: ParkingStatus): boolean {
  return a.code === b.code && a.color === b.color
    && a.rule_id === b.rule_id && a.event_id === b.event_id
    && a.allowed_until === b.allowed_until;
}

/**
 * Build a forward-looking timeline. Always includes a "NOW" entry, plus one
 * entry for each state transition the engine reports within the window.
 */
export function buildDecisionTimeline(
  segment: StreetSegment,
  restrictionTypes: RestrictionType[],
  timezone: string,
  from: Date,
  opts: BuildTimelineOptions = {},
): TimelineEntry[] {
  const hours = opts.hoursAhead ?? 24;
  const step = (opts.stepMinutes ?? 15) * 60_000;
  const max = opts.maxEntries ?? 8;
  const stopMs = from.getTime() + hours * 3600_000;

  const initial = evaluateRulesAt(segment, restrictionTypes, from, timezone);
  const out: TimelineEntry[] = [entryFromStatus(from, initial, true)];

  let prev = initial;
  let cursorMs = from.getTime() + step;
  // Fast-path: if we already know the boundary (allowed_until), jump there too.
  if (initial.allowed_until) {
    const a = new Date(initial.allowed_until).getTime();
    if (a > from.getTime() && a < stopMs) cursorMs = Math.min(cursorMs, a);
  }

  while (cursorMs <= stopMs && out.length < max) {
    const when = new Date(cursorMs);
    const status = evaluateRulesAt(segment, restrictionTypes, when, timezone);
    if (!sameState(prev, status)) {
      out.push(entryFromStatus(when, status, false));
      prev = status;
      if (status.allowed_until) {
        const a = new Date(status.allowed_until).getTime();
        if (a > cursorMs && a < stopMs) {
          cursorMs = Math.min(a, cursorMs + step);
          continue;
        }
      }
    }
    cursorMs += step;
  }

  return out;
}

const DOW_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export function formatTimelineTime(iso: string, timezone: string, isNow: boolean): string {
  if (isNow) return "NOW";
  const d = new Date(iso);
  const today = new Date();
  const dayLabel = d.toDateString() === today.toDateString()
    ? null
    : DOW_SHORT[new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short" }).format(d) as unknown as number] ??
      new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short" }).format(d);
  const time = new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", minute: "2-digit" }).format(d);
  return dayLabel ? `${dayLabel} · ${time}` : time;
}
