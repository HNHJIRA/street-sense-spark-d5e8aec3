// Provider architecture for parking data sources.
// A ParkingProvider knows how to fetch raw on-street parking data for one or
// more cities and normalize it into the canonical (segment, rule[]) shape
// stored in PostGIS. Providers are interchangeable.

export interface NormalizedRule {
  /** Lower number = higher priority. The conflict resolver picks the lowest. */
  priority: number;
  /** Canonical restriction code (must exist in restriction_types table). */
  restriction_code: string;
  days_of_week: number[];
  time_start: string | null; // "HH:MM"
  time_end: string | null;   // "HH:MM"
  permit_zone: string | null;
  time_limit_minutes: number | null;
  effective_from: string | null; // "YYYY-MM-DD"
  effective_to: string | null;
  notes: string | null;
}

export interface NormalizedSegment {
  /** Stable cross-source identifier, e.g. "sdot:blockface/12345". */
  external_id: string;
  name: string;
  /** "left" | "right" | "both" — curb side relative to street direction. */
  side: "left" | "right" | "both";
  /** GeoJSON LineString coordinates in [lng, lat]. */
  coordinates: [number, number][];
  /** Free-form provider metadata persisted with the segment. */
  metadata: Record<string, unknown>;
  /** All rules that govern this segment (engine resolves which one applies). */
  rules: NormalizedRule[];
}

export interface SyncBbox {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
}

export interface SyncResult {
  imported: number;
  skipped: number;
  error?: string;
  segments_total?: number;
}

export interface ParkingProvider {
  /** Unique provider id, used in data_source + sync_logs.provider. */
  readonly id: string;
  /** Human display name. */
  readonly name: string;
  /** City slugs this provider can serve. */
  readonly cities: string[];
  /**
   * Fetch + normalize segments from the upstream API for a given bbox.
   * Returns canonical NormalizedSegment[] (no DB writes).
   */
  fetchSegments(citySlug: string, bbox: SyncBbox): Promise<NormalizedSegment[]>;
}

/** Minimal supabase-admin surface passed to overlay providers. */
export interface OverlayContext {
  cityId: string;
  admin: { rpc: (n: string, a?: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }> };
}

export interface OverlayResult {
  segments_touched: number;
  rules_inserted: number;
  polygons_fetched: number;
  error?: string;
}

/**
 * Overlay providers attach rules onto existing segments via PostGIS spatial
 * joins instead of creating new segments. They are dispatched separately by
 * `syncProvider`.
 */
export interface OverlayProvider {
  readonly kind: "overlay";
  readonly id: string;
  readonly name: string;
  readonly cities: string[];
  applyOverlay(citySlug: string, bbox: SyncBbox, ctx: OverlayContext): Promise<OverlayResult>;
}

export type AnyProvider = ParkingProvider | OverlayProvider;

export function isOverlayProvider(p: AnyProvider): p is OverlayProvider {
  return (p as OverlayProvider).kind === "overlay";
}
