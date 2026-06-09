// Parking Health (Reliability) Score — pure. 0-100. Surfaces how trustworthy
// the parking decision for a given segment is, independent of legality.
// Derived from: provider quality, rule completeness, data freshness, and
// the existing confidence score. Does NOT call the engine.
import type { StreetSegment } from "./types";

export interface HealthInputs {
  segment: StreetSegment;
  /** Already-computed confidence score from scoreConfidence (0-100). */
  confidence_score: number;
  /** ISO of the provider's last_synced_at, when available. */
  last_synced_at?: string | null;
  /** Whether the segment has been validated by an in-app sign scan. */
  sign_scanned?: boolean;
}

export interface HealthScore {
  score: number;
  band: "excellent" | "good" | "fair" | "poor";
  parts: {
    provider: number;
    rules: number;
    freshness: number;
    confidence: number;
    scan: number;
  };
}

function providerScore(seg: StreetSegment): number {
  const dataset = seg.id?.split(":")[0]?.toLowerCase() ?? "";
  // Curated/published datasets get a higher baseline.
  if (dataset.includes("sdot") || dataset.includes("seattle")) return 95;
  if (dataset.includes("ladot") || dataset.includes("santa-monica") || dataset.includes("pasadena") || dataset.includes("west-hollywood")) return 80;
  return 60;
}

function rulesScore(seg: StreetSegment): number {
  const n = seg.rules?.length ?? 0;
  if (n === 0) return 30;
  if (n === 1) return 70;
  if (n <= 4) return 90;
  return 100;
}

function freshnessScore(iso: string | null | undefined): number {
  if (!iso) return 50;
  const ageDays = (Date.now() - new Date(iso).getTime()) / 86_400_000;
  if (ageDays <= 7) return 100;
  if (ageDays <= 30) return 80;
  if (ageDays <= 90) return 55;
  return 30;
}

export function computeHealthScore(input: HealthInputs): HealthScore {
  const provider = providerScore(input.segment);
  const rules = rulesScore(input.segment);
  const freshness = freshnessScore(input.last_synced_at ?? null);
  const confidence = Math.max(0, Math.min(100, input.confidence_score));
  const scan = input.sign_scanned ? 100 : 50;
  const score = Math.round(
    provider * 0.25 + rules * 0.2 + freshness * 0.2 + confidence * 0.25 + scan * 0.1,
  );
  const band: HealthScore["band"] =
    score >= 85 ? "excellent" : score >= 70 ? "good" : score >= 50 ? "fair" : "poor";
  return { score, band, parts: { provider, rules, freshness, confidence, scan } };
}
