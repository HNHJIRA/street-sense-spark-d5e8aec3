// Normalization + conflict-resolution layer.
// Pure functions; no DB / network.
// Every provider funnels its raw restriction categories through normalizeCode()
// so the rules engine only deals with a single canonical vocabulary.

import type { NormalizedRule } from "./types";

export type CanonicalCode =
  | "allowed"
  | "metered"
  | "permit"
  | "time_limited"
  | "no_parking"
  | "no_stopping"
  | "loading_zone"
  | "passenger_loading"
  | "commercial_loading"
  | "taxi_zone"
  | "bus_zone"
  | "bus_lane"
  | "street_cleaning"
  | "red_curb"
  | "tow_away"
  | "unknown";

interface ClassifiedRule {
  code: CanonicalCode;
  priority: number;
  notes: string;
}

/** Map free-form provider category strings to a canonical restriction. */
export function normalizeCategory(raw: string | null | undefined): ClassifiedRule {
  const c = (raw ?? "").trim().toLowerCase();
  if (!c) return { code: "allowed", priority: 1000, notes: "Unrestricted on-street parking." };

  // ----- LA-specific phrases (additive — does not affect Seattle vocabulary) -----
  if (c.includes("red curb") || c === "red zone")
    return { code: "red_curb", priority: 10, notes: "Red curb: no stopping at any time." };
  if (c.includes("tow away") || c.includes("tow-away"))
    return { code: "tow_away", priority: 12, notes: "Tow-away zone (posted)." };
  if (c.includes("preferential parking") || c === "ppd")
    return { code: "permit", priority: 50, notes: "Preferential Parking District (permit required)." };
  if (c === "posted" || c.includes("posted restriction"))
    return { code: "unknown", priority: 900, notes: "Posted restriction — verify local signage." };
  if (c === "unknown")
    return { code: "unknown", priority: 900, notes: "Open data does not contain posted restriction details." };

  // Order matters: more specific phrases first.
  if (c.includes("no parking") || c === "no parking allowed")
    return { code: "no_parking", priority: 20, notes: "Posted: no parking." };
  if (c.includes("no stopping"))
    return { code: "no_stopping", priority: 15, notes: "No stopping zone." };
  if (c.includes("bus") || c.includes("transit"))
    return { code: "bus_lane", priority: 15, notes: "Bus / transit zone." };
  if (c.includes("load"))
    return { code: "loading_zone", priority: 30, notes: "Loading zone." };
  if (c.includes("street cleaning") || c.includes("sweep"))
    return { code: "street_cleaning", priority: 25, notes: "Street cleaning posted." };
  if (c.includes("paid parking") || c.includes("metered") || c.includes("meter"))
    return { code: "metered", priority: 50, notes: "Paid / metered parking." };
  if (c.includes("restricted parking zone") || c === "rpz" || c.includes("residential permit"))
    return { code: "permit", priority: 50, notes: "Restricted Parking Zone (permit)." };
  if (c.includes("carpool"))
    return { code: "permit", priority: 50, notes: "Carpool parking." };
  if (c.includes("time limited") || c.includes("time limit"))
    return { code: "time_limited", priority: 60, notes: "Time-limited parking." };
  if (c.includes("unrestricted") || c === "allowed")
    return { code: "allowed", priority: 1000, notes: "Unrestricted on-street parking." };

  // Unknown — assume allowed but tag the source category in notes.
  return { code: "allowed", priority: 1000, notes: raw ?? "On-street parking." };
}

/** Convert provider cardinal direction to canonical curb side. */
export function normalizeSide(raw: string | null | undefined): "left" | "right" | "both" {
  const s = (raw ?? "").toUpperCase().trim();
  if (!s) return "both";
  if (s === "W" || s === "S" || s === "L" || s === "LEFT") return "left";
  if (s === "E" || s === "N" || s === "R" || s === "RIGHT") return "right";
  if (s === "B" || s === "BOTH") return "both";
  return "both";
}

/**
 * Conflict resolver. Given multiple rules for one segment, return them sorted
 * with redundant duplicates collapsed. The engine then picks the FIRST
 * matching rule at evaluation time (lowest priority wins).
 *
 * Dedupe key: (code, days, time_start, time_end). If a higher-priority
 * (lower number) rule already covers the same window, drop the lower one.
 */
export function resolveRuleConflicts(rules: NormalizedRule[]): NormalizedRule[] {
  const sorted = [...rules].sort((a, b) => a.priority - b.priority);
  const seen = new Set<string>();
  const out: NormalizedRule[] = [];
  for (const r of sorted) {
    const key = `${r.restriction_code}|${[...r.days_of_week].sort().join(",")}|${r.time_start ?? ""}|${r.time_end ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}
