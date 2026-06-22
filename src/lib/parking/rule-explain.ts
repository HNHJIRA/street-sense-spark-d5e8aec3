// Pure helpers for rule explainability UI. No DB / network.
import type { ParkingRule } from "./types";

const PROVIDER_LABELS: Record<string, string> = {
  sdot: "Seattle SDOT Blockface",
  "la-dot": "LADOT Parking Inventory",
  "santa-monica-opendata": "Santa Monica Street Sweeping",
  "santa-monica-meters": "Santa Monica Meters",
  "santa-monica-permit": "Santa Monica Permits",
  "weho-opendata": "West Hollywood Street Sweeping",
  "weho-permit": "West Hollywood Permit Districts",
  "pasadena-opendata": "Pasadena Street Sweeping",
  "arlington-opendata": "Arlington Street Network",
  "arlington-curb": "Arlington Curb Regulations",
  "arlington-permit": "Arlington Permit Districts",
  "bellevue-opendata": "Bellevue Street Network",
  "bellevue-curb": "Bellevue Curb Regulations",
  "bellevue-signs": "Bellevue Sign Inventory",
  "bellevue-painted-curbs": "Bellevue Painted Curbs",
  "bellevue-rpz": "Bellevue Restricted Parking Zones",
  "bellevue-rpz-streets": "Bellevue RPZ Streets",
  "bellevue-cbd": "Bellevue CBD Regulations",
  "bellevue-bus-layovers": "Bellevue Bus Layovers",
  "bellevue-derived-allowed": "Bellevue Derived (Inverse Hours)",
  "nyc-centerline": "NYC Street Centerline (CSCL)",
  "nyc-signs": "NYC Parking Regulation Signs",
  osm: "OpenStreetMap",
  seed: "Demo data",
};

export function providerLabel(id: string | null | undefined): string {
  if (!id) return "Unknown source";
  return PROVIDER_LABELS[id] ?? id;
}

function parseHHMM(s: string | null): number | null {
  if (!s) return null;
  const [h, m] = s.split(":");
  return parseInt(h, 10) * 60 + parseInt(m, 10);
}

/** Returns true if rule's day/time window covers `when` in `timezone`. */
export function isRuleActiveAt(rule: ParkingRule, when: Date, timezone: string): boolean {
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
  const dowMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const dow = dowMap[get("weekday")] ?? 0;
  const hh = parseInt(get("hour") === "24" ? "00" : get("hour"), 10);
  const mm = parseInt(get("minute"), 10);
  const hhmm = hh * 60 + mm;
  const ymd = `${get("year")}-${get("month")}-${get("day")}`;

  if (rule.effective_from && ymd < rule.effective_from) return false;
  if (rule.effective_to && ymd > rule.effective_to) return false;
  if (!rule.days_of_week.includes(dow)) return false;
  const start = parseHHMM(rule.time_start);
  const end = parseHHMM(rule.time_end);
  if (start == null || end == null) return true; // all-day
  if (start <= end) return hhmm >= start && hhmm < end;
  return hhmm >= start || hhmm < end; // wraps midnight
}

const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function formatDays(days: number[]): string {
  if (days.length === 7) return "Every day";
  if (days.length === 5 && [1, 2, 3, 4, 5].every((d) => days.includes(d))) return "Mon–Fri";
  if (days.length === 2 && days.includes(0) && days.includes(6)) return "Sat–Sun";
  return days.map((d) => DOW_LABELS[d]).join(", ");
}

export function formatHours(start: string | null, end: string | null): string {
  if (!start || !end) return "All day";
  const fmt = (s: string) => {
    const [h, m] = s.split(":").map((x) => parseInt(x, 10));
    const period = h >= 12 ? "PM" : "AM";
    const hh = h % 12 === 0 ? 12 : h % 12;
    return m === 0 ? `${hh} ${period}` : `${hh}:${String(m).padStart(2, "0")} ${period}`;
  };
  return `${fmt(start)} – ${fmt(end)}`;
}

/** Human "why this rule won" reason. */
export function explainWinner(winner: ParkingRule | null, all: ParkingRule[]): string {
  if (!winner) {
    return "No rule's day/time window matched the current moment, so the segment defaults to Parking Allowed.";
  }
  const competitors = all.filter((r) => r.id !== winner.id);
  if (competitors.length === 0) {
    return `Only one rule applies to this segment, so it wins by default.`;
  }
  const lower = competitors.filter((r) => r.priority < winner.priority);
  if (lower.length === 0) {
    return `Lowest priority number wins. This rule's priority (${winner.priority}) is the lowest among all rules currently active on this segment.`;
  }
  return `Lowest priority number wins among currently-active rules. ${competitors.length} other rule(s) exist on this segment; this one matches the current day/time AND has the lowest priority (${winner.priority}).`;
}
