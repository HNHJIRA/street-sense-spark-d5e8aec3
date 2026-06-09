// Pure decision composer. NO new parking engine — this is a thin wrapper
// around evaluateRulesAt() plus a forward scan of the same rule set, used
// to surface verdict / next-restriction / timeline / time-remaining to UI.
//
// Used by: ParkDecisionScreen, ParkHereButton, scanner result, recommended
// parking cards, and the driver-summary AI prompt. The engine is still the
// single source of truth.
import { evaluateRulesAt } from "./engine";
import { buildDecisionTimeline, type TimelineEntry } from "./timeline";
import type {
  ParkingColor,
  ParkingStatus,
  RestrictionType,
  StreetSegment,
} from "./types";

export type ParkingVerdict = "YES" | "NO" | "LIMITED" | "UNKNOWN";

export interface NextRestriction {
  label: string;          // e.g. "Street Cleaning"
  code: string;
  color: ParkingColor;
  starts_at: string;      // ISO
  time_until_ms: number;
}

export interface ParkingDecision {
  verdict: ParkingVerdict;
  status: ParkingStatus;
  /** ms remaining until the next state boundary (or until allowed_until). null if open-ended. */
  time_remaining_ms: number | null;
  next_restriction: NextRestriction | null;
  timeline: TimelineEntry[];
  evaluated_at: string; // ISO of `when` used
}

function verdictFor(color: ParkingColor, hasRules: boolean): ParkingVerdict {
  if (!hasRules) return "UNKNOWN";
  if (color === "green") return "YES";
  if (color === "yellow") return "LIMITED";
  return "NO";
}

/**
 * Compose a full ParkingDecision from a segment + restriction types.
 * Pure — safe to call on server or client.
 */
export function buildParkingDecision(
  segment: StreetSegment,
  restrictionTypes: RestrictionType[],
  when: Date,
  timezone: string,
): ParkingDecision {
  const hasRules = (segment.rules?.length ?? 0) > 0 || (segment.events?.length ?? 0) > 0;
  const status = evaluateRulesAt(segment, restrictionTypes, when, timezone);
  const timeline = buildDecisionTimeline(segment, restrictionTypes, timezone, when, {
    hoursAhead: 24,
    stepMinutes: 15,
    maxEntries: 6,
  });

  // Next restriction: first timeline entry after NOW whose color differs from current.
  let next_restriction: NextRestriction | null = null;
  const nowMs = when.getTime();
  for (const entry of timeline) {
    if (entry.isNow) continue;
    if (entry.color === status.color) continue;
    // Treat a transition from green→{yellow|red} as a restriction starting;
    // transition from {yellow|red}→green is logged as "allowed again" — only
    // surface when current is green (we're warning the driver about future).
    if (status.color === "green" && entry.color !== "green") {
      next_restriction = {
        label: entry.label,
        code: entry.code,
        color: entry.color,
        starts_at: entry.iso,
        time_until_ms: new Date(entry.iso).getTime() - nowMs,
      };
      break;
    }
    if (status.color !== "green") {
      // Currently restricted — report when it lifts or changes.
      next_restriction = {
        label: entry.label,
        code: entry.code,
        color: entry.color,
        starts_at: entry.iso,
        time_until_ms: new Date(entry.iso).getTime() - nowMs,
      };
      break;
    }
  }

  // Time remaining = until next boundary if any, otherwise allowed_until,
  // otherwise null (open-ended).
  let time_remaining_ms: number | null = null;
  if (next_restriction) {
    time_remaining_ms = next_restriction.time_until_ms;
  } else if (status.allowed_until) {
    time_remaining_ms = new Date(status.allowed_until).getTime() - nowMs;
  }

  return {
    verdict: verdictFor(status.color, hasRules),
    status,
    time_remaining_ms,
    next_restriction,
    timeline,
    evaluated_at: when.toISOString(),
  };
}
