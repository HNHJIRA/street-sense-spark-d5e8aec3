// Parking alert calculation service.
//
// Pure functions that derive alert windows, risk scores, and the next upcoming
// alert from rules-engine output. The engine remains the single source of
// truth: callers pass in `allowed_until` (when current state ends), the
// restriction reason, and the active alert settings; this module never queries
// the database or guesses at restriction times.

export type AlertType =
  | "parking_expiring"        // session window ending — generic
  | "restriction_starting"    // generic upcoming restriction
  | "street_cleaning_starting"
  | "permit_restriction_starting"
  | "max_stay_reached";

export type RiskLevel = "low" | "medium" | "high";

export interface AlertSettings {
  enabled: boolean;
  warn60: boolean;
  warn30: boolean;
  warn15: boolean;
  warn5: boolean;
}

export const DEFAULT_ALERT_SETTINGS: AlertSettings = {
  enabled: true,
  warn60: false,
  warn30: true,
  warn15: true,
  warn5: true,
};

export interface PlannedAlert {
  id: string;            // stable: `${type}:${minutesBefore}:${triggerIso}`
  type: AlertType;
  minutesBefore: number; // 0 for "starting now"
  triggerAt: string;     // ISO when the alert should fire
  label: string;         // "30 minutes remaining"
  reason: string | null; // restriction reason (street cleaning, permit, …)
}

const THRESHOLDS: Array<{ minutes: number; setting: keyof AlertSettings; label: string }> = [
  { minutes: 60, setting: "warn60", label: "60 minutes remaining" },
  { minutes: 30, setting: "warn30", label: "30 minutes remaining" },
  { minutes: 15, setting: "warn15", label: "15 minutes remaining" },
  { minutes: 5,  setting: "warn5",  label: "5 minutes remaining" },
];

function reasonToType(reason: string | null | undefined, currentColor: "green" | "yellow" | "red"): AlertType {
  const r = (reason ?? "").toLowerCase();
  if (r.includes("clean")) return "street_cleaning_starting";
  if (r.includes("permit") || r.includes("rpz")) return "permit_restriction_starting";
  if (r.includes("max") || r.includes("time limit") || r.includes("limit")) return "max_stay_reached";
  // Currently allowed → next state is restriction starting.
  // Currently restricted → user is "expiring" out of their parking right.
  return currentColor === "green" ? "restriction_starting" : "parking_expiring";
}

/**
 * Generate planned alerts for the current parking state.
 * - `allowedUntil` comes from the rules engine (`ParkingStatus.allowed_until`).
 * - Past thresholds (already elapsed) and disabled thresholds are filtered out.
 * - Always emits a "starting now" (0 min) alert if the master switch is on,
 *   so we still ping the user at the moment of state transition.
 */
export function computeAlertWindows(
  allowedUntil: string | null,
  currentColor: "green" | "yellow" | "red",
  reason: string | null,
  settings: AlertSettings,
  nowMs: number,
): PlannedAlert[] {
  if (!settings.enabled || !allowedUntil) return [];
  const endMs = new Date(allowedUntil).getTime();
  if (!Number.isFinite(endMs)) return [];

  const type = reasonToType(reason, currentColor);
  const alerts: PlannedAlert[] = [];

  for (const t of THRESHOLDS) {
    if (!settings[t.setting]) continue;
    const triggerMs = endMs - t.minutes * 60_000;
    if (triggerMs <= nowMs) continue;
    const triggerIso = new Date(triggerMs).toISOString();
    alerts.push({
      id: `${type}:${t.minutes}:${triggerIso}`,
      type,
      minutesBefore: t.minutes,
      triggerAt: triggerIso,
      label: t.label,
      reason: reason ?? null,
    });
  }

  // Always include a "starting now" boundary alert when the state flips.
  if (endMs > nowMs) {
    const triggerIso = new Date(endMs).toISOString();
    alerts.push({
      id: `${type}:0:${triggerIso}`,
      type,
      minutesBefore: 0,
      triggerAt: triggerIso,
      label: currentColor === "green" ? "Restriction starting now" : "Parking expiring now",
      reason: reason ?? null,
    });
  }

  return alerts.sort((a, b) => +new Date(a.triggerAt) - +new Date(b.triggerAt));
}

export function nextPlannedAlert(alerts: PlannedAlert[], nowMs: number): PlannedAlert | null {
  for (const a of alerts) if (new Date(a.triggerAt).getTime() > nowMs) return a;
  return null;
}

/**
 * Risk score derived from time remaining + posted reason.
 * - <15 min, or restriction starting in <15 min → high
 * - <60 min → medium
 * - else → low
 * - No active restriction window → low
 * - Already past `allowed_until` → high
 */
export function computeRiskScore(
  allowedUntil: string | null,
  currentColor: "green" | "yellow" | "red",
  nowMs: number,
): { level: RiskLevel; secondsRemaining: number | null; reason: string } {
  if (currentColor === "red") {
    return { level: "high", secondsRemaining: 0, reason: "Currently no parking" };
  }
  if (!allowedUntil) {
    return { level: "low", secondsRemaining: null, reason: "No posted restriction window" };
  }
  const secs = Math.floor((new Date(allowedUntil).getTime() - nowMs) / 1000);
  if (secs <= 0) {
    return { level: "high", secondsRemaining: secs, reason: "Window expired" };
  }
  if (secs <= 15 * 60) {
    return { level: "high", secondsRemaining: secs, reason: currentColor === "green" ? "Restriction begins soon" : "Window ending soon" };
  }
  if (secs <= 60 * 60) {
    return { level: "medium", secondsRemaining: secs, reason: currentColor === "green" ? "Restriction within the hour" : "Less than an hour left" };
  }
  return { level: "low", secondsRemaining: secs, reason: "Plenty of time" };
}

export function alertTypeLabel(t: AlertType): string {
  switch (t) {
    case "parking_expiring": return "Parking expiring";
    case "restriction_starting": return "Restriction starting";
    case "street_cleaning_starting": return "Street cleaning starting";
    case "permit_restriction_starting": return "Permit restriction starting";
    case "max_stay_reached": return "Maximum stay reached";
  }
}

export function riskColorClass(level: RiskLevel): string {
  switch (level) {
    case "low":    return "border-park-green/40 bg-park-green-soft text-park-green";
    case "medium": return "border-park-yellow/40 bg-park-yellow-soft text-park-yellow";
    case "high":   return "border-park-red/40 bg-park-red-soft text-park-red";
  }
}
