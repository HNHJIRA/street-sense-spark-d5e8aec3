// Pure parking-quality scoring (0-100). Used by recommendation ranking +
// "Where should I park?" UI. No DB / no UI imports.
//
// Score blends 4 signals so the best spot is rarely the closest one alone:
//   - distance        (closer = better)
//   - time remaining  (longer parkable window = better)
//   - confidence      (trusted data = better)
//   - restriction     (green > yellow > red)
//
// The engine still decides legality; this only ranks legal-or-limited spots.

import type { ParkingColor } from "./types";

export interface ParkingScoreInput {
  distance_m: number;
  /** ms remaining until next restriction; null = open-ended (treat as 8h+). */
  time_remaining_ms: number | null;
  /** Confidence score 0-100 from scoreConfidence(). */
  confidence_score: number;
  color: ParkingColor;
}

export interface ParkingScore {
  score: number; // 0-100
  parts: {
    distance: number;
    time: number;
    confidence: number;
    restriction: number;
  };
}

function distanceScore(d: number): number {
  // 0m -> 100, 500m -> 0, linear.
  return Math.max(0, Math.min(100, 100 - d / 5));
}

function timeScore(ms: number | null): number {
  if (ms == null) return 90; // open-ended (no upcoming restriction)
  if (ms <= 0) return 0;
  const minutes = ms / 60_000;
  if (minutes >= 240) return 100;       // 4h+
  if (minutes <= 15) return 10;
  return Math.round((minutes / 240) * 100);
}

function restrictionScore(c: ParkingColor): number {
  if (c === "green") return 100;
  if (c === "yellow") return 55;
  return 0;
}

export function computeParkingScore(input: ParkingScoreInput): ParkingScore {
  const distance = distanceScore(input.distance_m);
  const time = timeScore(input.time_remaining_ms);
  const confidence = Math.max(0, Math.min(100, input.confidence_score));
  const restriction = restrictionScore(input.color);
  const score = Math.round(
    distance * 0.35 + time * 0.25 + confidence * 0.2 + restriction * 0.2,
  );
  return { score, parts: { distance: Math.round(distance), time: Math.round(time), confidence: Math.round(confidence), restriction } };
}

export function scoreBadgeClass(score: number): string {
  if (score >= 75) return "bg-park-green-soft text-park-green border-park-green/40";
  if (score >= 50) return "bg-park-yellow-soft text-park-yellow border-park-yellow/40";
  return "bg-park-red-soft text-park-red border-park-red/40";
}
