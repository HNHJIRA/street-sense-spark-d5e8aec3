export type ParkingColor = "green" | "yellow" | "red";

export interface RestrictionType {
  code: string;
  label: string;
  color: ParkingColor;
  description: string | null;
}

export interface ParkingRule {
  id: string;
  street_segment_id: string;
  priority: number;
  restriction_code: string;
  days_of_week: number[]; // 0=Sun..6=Sat
  time_start: string | null;
  time_end: string | null;
  permit_zone: string | null;
  time_limit_minutes: number | null;
  effective_from: string | null;
  effective_to: string | null;
  notes: string | null;
}

export interface ParkingEvent {
  id: string;
  street_segment_id: string;
  restriction_code: string;
  starts_at: string;
  ends_at: string;
  reason: string | null;
}

export interface StreetSegment {
  id: string;
  name: string;
  side: string;
  neighborhood: string | null;
  coordinates: [number, number][];
  rules: ParkingRule[];
  events: ParkingEvent[];
}

export interface CityBundle {
  city: {
    id: string;
    slug: string;
    name: string;
    timezone: string;
    center: [number, number];
    default_zoom: number;
  };
  restrictionTypes: RestrictionType[];
  segments: StreetSegment[];
}

export interface ParkingStatus {
  color: ParkingColor;
  code: string;
  label: string;
  notes: string | null;
  permit_zone: string | null;
  time_limit_minutes: number | null;
  rule_id: string | null;
  event_id: string | null;
  allowed_until: string | null;
  restriction_starts_at: string | null;
  restriction_ends_at: string | null;
}
