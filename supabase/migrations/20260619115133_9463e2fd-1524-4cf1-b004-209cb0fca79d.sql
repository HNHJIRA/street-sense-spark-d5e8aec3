
-- Add New York City to the cities table and create nyc_area_counts.
-- NOTE: cities is an existing table; this migration only inserts a row + creates a function.

INSERT INTO public.cities (slug, name, timezone, center, default_zoom)
VALUES (
  'nyc',
  'New York City',
  'America/New_York',
  ST_SetSRID(ST_MakePoint(-73.9857, 40.7484), 4326)::geography,
  11
)
ON CONFLICT (slug) DO NOTHING;

CREATE OR REPLACE FUNCTION public.nyc_area_counts(
  p_city_id uuid,
  p_min_lng double precision,
  p_min_lat double precision,
  p_max_lng double precision,
  p_max_lat double precision
)
RETURNS TABLE(segments bigint, sweeping bigint, permit bigint, metered bigint, unknown bigint)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH segs AS (
    SELECT s.id
    FROM public.street_segments s
    WHERE s.city_id = p_city_id
      AND s.geom && ST_MakeEnvelope(p_min_lng, p_min_lat, p_max_lng, p_max_lat, 4326)
  ),
  rules AS (
    SELECT DISTINCT r.street_segment_id, r.restriction_code
    FROM public.parking_rules r
    JOIN segs ON segs.id = r.street_segment_id
  )
  SELECT
    (SELECT count(*) FROM segs)::bigint AS segments,
    (SELECT count(DISTINCT street_segment_id) FROM rules WHERE restriction_code = 'street_cleaning')::bigint AS sweeping,
    (SELECT count(DISTINCT street_segment_id) FROM rules WHERE restriction_code = 'permit')::bigint AS permit,
    (SELECT count(DISTINCT street_segment_id) FROM rules WHERE restriction_code = 'metered')::bigint AS metered,
    (SELECT count(DISTINCT street_segment_id) FROM rules WHERE restriction_code = 'unknown')::bigint AS unknown
$function$;
