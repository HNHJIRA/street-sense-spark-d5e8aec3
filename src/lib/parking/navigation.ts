// Pure navigation helpers — bearing, compass direction, and platform
// directions URLs. Used by "Navigate to parking" and "Find my car".
// No DB / no UI imports.

export interface LngLat { lng: number; lat: number }

function toRad(d: number): number { return (d * Math.PI) / 180 }
function toDeg(r: number): number { return (r * 180) / Math.PI }

/** Initial bearing (degrees, 0-360) from a→b. */
export function bearingDeg(a: LngLat, b: LngLat): number {
  const φ1 = toRad(a.lat);
  const φ2 = toRad(b.lat);
  const Δλ = toRad(b.lng - a.lng);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  const θ = Math.atan2(y, x);
  return (toDeg(θ) + 360) % 360;
}

const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;
export function compassDirection(deg: number): typeof COMPASS[number] {
  return COMPASS[Math.round(deg / 45) % 8];
}

/** Universal Google Maps walking directions URL — opens in app or web. */
export function walkingDirectionsUrl(to: LngLat, from?: LngLat | null): string {
  const dest = `${to.lat},${to.lng}`;
  const origin = from ? `&origin=${from.lat},${from.lng}` : "";
  return `https://www.google.com/maps/dir/?api=1&travelmode=walking&destination=${dest}${origin}`;
}

/** Driving directions (used for "Navigate to parking" before arrival). */
export function drivingDirectionsUrl(to: LngLat, from?: LngLat | null): string {
  const dest = `${to.lat},${to.lng}`;
  const origin = from ? `&origin=${from.lat},${from.lng}` : "";
  return `https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=${dest}${origin}`;
}
