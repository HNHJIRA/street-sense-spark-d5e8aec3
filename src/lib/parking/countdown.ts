// Shared countdown helpers for parking expiration tracking.
export interface Countdown {
  text: string;          // "2h 15m" or "8m" or "Expired"
  totalSeconds: number;  // negative if already expired
  urgency: "ok" | "warn" | "danger" | "expired";
}

export function countdownTo(targetIso: string | null, nowMs: number): Countdown {
  if (!targetIso) return { text: "—", totalSeconds: 0, urgency: "ok" };
  const total = Math.floor((new Date(targetIso).getTime() - nowMs) / 1000);
  if (total <= 0) return { text: "Expired", totalSeconds: total, urgency: "expired" };
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  let text: string;
  if (h > 0) text = `${h}h ${m}m`;
  else if (m >= 10) text = `${m}m`;
  else if (m > 0) text = `${m}m ${s.toString().padStart(2, "0")}s`;
  else text = `${s}s`;
  let urgency: Countdown["urgency"] = "ok";
  if (total <= 15 * 60) urgency = "danger";
  else if (total <= 45 * 60) urgency = "warn";
  return { text, totalSeconds: total, urgency };
}

export function elapsedSince(startedIso: string, nowMs: number): string {
  const total = Math.max(0, Math.floor((nowMs - new Date(startedIso).getTime()) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
