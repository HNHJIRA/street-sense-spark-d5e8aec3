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
  seg_rules AS (
    SELECT segs.id AS seg_id, r.restriction_code
    FROM segs
    LEFT JOIN public.parking_rules r ON r.street_segment_id = segs.id
  ),
  classified AS (
    SELECT
      seg_id,
      bool_or(restriction_code = 'street_cleaning') AS has_sweeping,
      bool_or(restriction_code = 'permit')          AS has_permit,
      bool_or(restriction_code = 'metered')         AS has_metered,
      bool_or(restriction_code IS NOT NULL
              AND restriction_code <> 'unknown')    AS has_known
    FROM seg_rules
    GROUP BY seg_id
  )
  SELECT
    (SELECT count(*) FROM segs)::bigint                              AS segments,
    (SELECT count(*) FROM classified WHERE has_sweeping)::bigint     AS sweeping,
    (SELECT count(*) FROM classified WHERE has_permit)::bigint       AS permit,
    (SELECT count(*) FROM classified WHERE has_metered)::bigint      AS metered,
    (SELECT count(*) FROM classified WHERE NOT has_known)::bigint    AS unknown
$$;