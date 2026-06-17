// Engine explanation layer. Turns a ParkingStatus + matched rule/event
// into a human-readable "Why is this street red/yellow/green?" structure.
// Pure — no DB/UI imports.
import type { ParkingRule, ParkingEvent, ParkingStatus, StreetSegment } from "./types";

export interface Explanation {
  headline: string;          // "NO PARKING" / "LIMITED PARKING" / "PARKING ALLOWED"
  color: "green" | "yellow" | "red" | "gray";
  reason: string;            // "Street Cleaning"
  active_window: string | null; // "Mon · 8:00 AM – 10:00 AM"
  permit_zone: string | null;
  time_limit: string | null;
  allowed_until: string | null;
  source: string;
  notes: string | null;
}

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function headlineForColor(color: "green" | "yellow" | "red" | "gray"): string {
  if (color === "red") return "NO PARKING";
  if (color === "yellow") return "LIMITED PARKING";
  if (color === "gray") return "UNKNOWN";
  return "PARKING ALLOWED";
}

function fmtTime(hhmm: string | null): string | null {
  if (!hhmm) return null;
  const [h, m] = hhmm.split(":").map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function fmtDays(dows: number[]): string {
  if (dows.length === 7) return "Every day";
  if (dows.length === 5 && [1, 2, 3, 4, 5].every((d) => dows.includes(d))) return "Mon–Fri";
  if (dows.length === 2 && dows.includes(0) && dows.includes(6)) return "Weekends";
  return dows.map((d) => DOW[d]).join(", ");
}

function fmtWindow(rule: ParkingRule): string | null {
  const days = fmtDays(rule.days_of_week);
  const s = fmtTime(rule.time_start);
  const e = fmtTime(rule.time_end);
  if (s && e) return `${days} · ${s} – ${e}`;
  return `${days} · All day`;
}

export function buildExplanation(
  status: ParkingStatus,
  segment: StreetSegment,
  sourceLabel: string,
): Explanation {
  const rule: ParkingRule | undefined =
    status.rule_id ? segment.rules.find((r) => r.id === status.rule_id) : undefined;
  const event: ParkingEvent | undefined =
    status.event_id ? segment.events.find((e) => e.id === status.event_id) : undefined;

  return {
    headline: headlineForColor(status.color),
    color: status.color,
    reason: event?.reason ?? status.label,
    active_window: rule ? fmtWindow(rule) : null,
    permit_zone: status.permit_zone,
    time_limit: status.time_limit_minutes != null ? `${status.time_limit_minutes} min` : null,
    allowed_until: status.allowed_until,
    source: sourceLabel,
    notes: status.notes,
  };
}
