// Confidence scoring for parking decisions. Pure — no DB / no UI imports.
// Inputs: engine output + provider source + (optionally) AI scan signals.
// Output: a tiered confidence level the UI can display alongside any verdict.

export type ConfidenceLevel = "high" | "medium" | "low";

export interface ConfidenceFactor {
  key:
    | "sdot_match"
    | "ai_ocr_quality"
    | "rule_conflicts"
    | "missing_data"
    | "data_freshness"
    | "engine_match";
  label: string;
  detail: string;
  delta: number; // positive = boosts confidence, negative = lowers
  status: "good" | "warn" | "bad" | "info";
}

export interface ConfidenceScore {
  level: ConfidenceLevel;
  score: number;             // 0..100
  factors: ConfidenceFactor[];
  summary: string;
}

export interface ConfidenceInput {
  /** Did the engine match a rule or fall back to "allowed"? */
  matchedRule: boolean;
  /** Active rule conflicts/duplicates detected on this segment. */
  conflictCount: number;
  /** Provider id (sdot, osm, seed, scan, …) — drives base trust. */
  dataSource: string;
  /** Number of normalized rules on the segment — 0 = potentially incomplete. */
  ruleCount: number;
  /** When the underlying segment data was last refreshed (ISO). */
  lastSyncedAt?: string | null;
  /** Optional AI-scan signal: 0..1 confidence reported by Gemini. */
  aiOcrConfidence?: number | null;
  /** Optional AI-scan signal: did the AI-extracted rule match SDOT? */
  aiSdotMatch?: "match" | "conflict" | "unmatched" | "no_sdot" | null;
}

function classify(score: number): ConfidenceLevel {
  if (score >= 75) return "high";
  if (score >= 50) return "medium";
  return "low";
}

const SOURCE_BASE: Record<string, { delta: number; label: string }> = {
  sdot: { delta: 18, label: "Seattle SDOT (official)" },
  curbiq: { delta: 12, label: "CurbIQ (commercial)" },
  osm: { delta: 4, label: "OpenStreetMap (community)" },
  seed: { delta: -10, label: "Demo data" },
  scan: { delta: 0, label: "AI sign scan" },
};

export function scoreConfidence(input: ConfidenceInput): ConfidenceScore {
  const factors: ConfidenceFactor[] = [];
  let score = 55; // neutral starting point

  // Data source trust.
  const src = SOURCE_BASE[input.dataSource] ?? { delta: 0, label: input.dataSource };
  score += src.delta;
  factors.push({
    key: "sdot_match",
    label: "Data source",
    detail: src.label,
    delta: src.delta,
    status: src.delta >= 10 ? "good" : src.delta <= -5 ? "warn" : "info",
  });

  // Engine matched a rule (or fell through to "allowed").
  if (input.matchedRule) {
    score += 10;
    factors.push({
      key: "engine_match",
      label: "Rule match",
      detail: "Engine matched a posted rule.",
      delta: 10, status: "good",
    });
  } else {
    score -= 5;
    factors.push({
      key: "engine_match",
      label: "No rule matched",
      detail: "Defaulted to allowed because no rule applied.",
      delta: -5, status: "info",
    });
  }

  // Missing rules at all = lower trust.
  if (input.ruleCount === 0) {
    score -= 15;
    factors.push({
      key: "missing_data",
      label: "Missing rules",
      detail: "Segment has no posted rules on file.",
      delta: -15, status: "bad",
    });
  }

  // Conflicts in normalization layer.
  if (input.conflictCount > 0) {
    const d = Math.min(20, input.conflictCount * 5);
    score -= d;
    factors.push({
      key: "rule_conflicts",
      label: "Rule conflicts",
      detail: `${input.conflictCount} overlapping rule${input.conflictCount === 1 ? "" : "s"} detected.`,
      delta: -d, status: "warn",
    });
  }

  // Data freshness (only if source provides it).
  if (input.lastSyncedAt) {
    const ageDays = (Date.now() - new Date(input.lastSyncedAt).getTime()) / (1000 * 60 * 60 * 24);
    if (ageDays > 60) {
      score -= 10;
      factors.push({
        key: "data_freshness", label: "Stale provider data",
        detail: `Last synced ${Math.round(ageDays)} days ago.`,
        delta: -10, status: "warn",
      });
    } else {
      score += 4;
      factors.push({
        key: "data_freshness", label: "Fresh provider data",
        detail: `Synced ${Math.round(ageDays)} days ago.`,
        delta: 4, status: "good",
      });
    }
  }

  // AI signals (sign scanner only).
  if (input.aiOcrConfidence != null) {
    const pct = Math.round(input.aiOcrConfidence * 100);
    if (pct >= 85) {
      score += 15;
      factors.push({ key: "ai_ocr_quality", label: "AI OCR quality", detail: `${pct}% confidence.`, delta: 15, status: "good" });
    } else if (pct >= 60) {
      score += 5;
      factors.push({ key: "ai_ocr_quality", label: "AI OCR quality", detail: `${pct}% confidence — review.`, delta: 5, status: "warn" });
    } else {
      score -= 15;
      factors.push({ key: "ai_ocr_quality", label: "AI OCR quality", detail: `${pct}% confidence — verify the sign in person.`, delta: -15, status: "bad" });
    }
  }
  if (input.aiSdotMatch) {
    if (input.aiSdotMatch === "match") {
      score += 10;
      factors.push({ key: "sdot_match", label: "Sign matches SDOT", detail: "Posted sign matches official data.", delta: 10, status: "good" });
    } else if (input.aiSdotMatch === "conflict") {
      score -= 12;
      factors.push({ key: "sdot_match", label: "Sign disagrees with SDOT", detail: "Trust the posted sign; data may be stale.", delta: -12, status: "warn" });
    } else if (input.aiSdotMatch === "unmatched") {
      score -= 4;
      factors.push({ key: "sdot_match", label: "New posted sign", detail: "No corresponding SDOT record.", delta: -4, status: "info" });
    } else {
      score -= 6;
      factors.push({ key: "sdot_match", label: "No SDOT coverage", detail: "Comparison unavailable at this location.", delta: -6, status: "info" });
    }
  }

  score = Math.max(0, Math.min(100, score));
  const level = classify(score);
  const summary =
    level === "high" ? "High confidence — multiple signals agree."
      : level === "medium" ? "Medium confidence — verify posted signs."
      : "Low confidence — read posted signs before parking.";
  return { level, score, factors, summary };
}

export function confidenceColorClass(level: ConfidenceLevel): string {
  if (level === "high") return "border-park-green/40 bg-park-green-soft text-park-green";
  if (level === "medium") return "border-park-yellow/40 bg-park-yellow-soft text-park-yellow";
  return "border-park-red/40 bg-park-red-soft text-park-red";
}
