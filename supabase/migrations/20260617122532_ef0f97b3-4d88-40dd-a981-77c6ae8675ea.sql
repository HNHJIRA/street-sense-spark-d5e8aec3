
-- Add Arlington, VA as a supported city
INSERT INTO public.cities (slug, name, timezone, default_zoom, center)
VALUES (
  'arlington', 'Arlington', 'America/New_York', 14,
  ST_SetSRID(ST_MakePoint(-77.0852, 38.8903), 4326)
)
ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, timezone = EXCLUDED.timezone;

-- Arlington area-coverage counter (same shape as la_area_counts)
CREATE OR REPLACE FUNCTION public.arlington_area_counts(
  p_city_id uuid,
  p_min_lng double precision,
  p_min_lat double precision,
  p_max_lng double precision,
  p_max_lat double precision
)
RETURNS TABLE (
  segments bigint,
  sweeping bigint,
  permit   bigint,
  metered  bigint,
  unknown  bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
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
    (SELECT count(*) FROM segs)::bigint                                                                AS segments,
    (SELECT count(DISTINCT street_segment_id) FROM rules WHERE restriction_code = 'street_cleaning')::bigint AS sweeping,
    (SELECT count(DISTINCT street_segment_id) FROM rules WHERE restriction_code = 'permit')::bigint    AS permit,
    (SELECT count(DISTINCT street_segment_id) FROM rules WHERE restriction_code = 'metered')::bigint   AS metered,
    (SELECT count(DISTINCT street_segment_id) FROM rules WHERE restriction_code = 'unknown')::bigint   AS unknown
$$;

REVOKE EXECUTE ON FUNCTION public.arlington_area_counts(uuid, double precision, double precision, double precision, double precision) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.arlington_area_counts(uuid, double precision, double precision, double precision, double precision) TO service_role;
