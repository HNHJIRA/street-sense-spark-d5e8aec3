// Smart Day Planner — pure. Walks a single date in 15-minute steps using the
// existing rules engine and collapses runs of identical verdicts into
// "windows" (e.g. 9 AM–1 PM Allowed, 1 PM–3 PM Street Cleaning).
// NO new engine — every status comes from evaluateRulesAt().
import { evaluateRulesAt } from "./engine";
import type { ParkingColor, RestrictionType, StreetSegment } from "./types";

export interface DayWindow {
  start_iso: string;
  end_iso: string;
  color: ParkingColor;
  code: string;
  label: string;
}

export interface DayPlan {
  date_iso: string;
  timezone: string;
  windows: DayWindow[];
  best_window: DayWindow | null;
}

/** Build a midnight Date in a given IANA timezone for the YYYY-MM-DD string. */
function tzMidnight(ymd: string, timezone: string): Date {
  // Approximate: get UTC midnight, then shift by tz offset at that instant.
  const utc = new Date(`${ymd}T00:00:00Z`);
  const tzString = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone, hour: "2-digit", hour12: false,
  }).format(utc);
  const tzHour = parseInt(tzString, 10);
  // offset minutes = utcHour - tzHour (handle wrap)
  const utcHour = utc.getUTCHours();
  let diff = utcHour - tzHour;
  if (diff > 12) diff -= 24;
  if (diff < -12) diff += 24;
  return new Date(utc.getTime() + diff * 3600_000);
}

export function buildDayPlan(
  segment: StreetSegment,
  restrictionTypes: RestrictionType[],
  date_ymd: string,
  timezone: string,
  stepMinutes = 15,
): DayPlan {
  const start = tzMidnight(date_ymd, timezone);
  const stepMs = stepMinutes * 60_000;
  const end = start.getTime() + 24 * 3600_000;

  const windows: DayWindow[] = [];
  let cursor = start.getTime();
  let current: DayWindow | null = null;

  while (cursor < end) {
    const when = new Date(cursor);
    const st = evaluateRulesAt(segment, restrictionTypes, when, timezone);
    if (!current || current.code !== st.code || current.color !== st.color) {
      if (current) {
        current.end_iso = when.toISOString();
        windows.push(current);
      }
      current = {
        start_iso: when.toISOString(),
        end_iso: new Date(end).toISOString(),
        color: st.color,
        code: st.code,
        label: st.label,
      };
    }
    cursor += stepMs;
  }
  if (current) windows.push(current);

  // Best window = longest green window (or longest yellow if no green).
  const greens = windows.filter((w) => w.color === "green");
  const yellows = windows.filter((w) => w.color === "yellow");
  const pool = greens.length ? greens : yellows;
  const best = pool.reduce<DayWindow | null>((b, w) => {
    const dur = +new Date(w.end_iso) - +new Date(w.start_iso);
    if (!b) return w;
    const bd = +new Date(b.end_iso) - +new Date(b.start_iso);
    return dur > bd ? w : b;
  }, null);

  return {
    date_iso: start.toISOString(),
    timezone,
    windows,
    best_window: best,
  };
}
