
-- All underlying tables already have public SELECT policies, so the function
-- does not need SECURITY DEFINER. Switch to INVOKER to satisfy the linter.
CREATE OR REPLACE FUNCTION public.segments_in_bbox(
  p_city_id  uuid,
  p_min_lng  double precision,
  p_min_lat  double precision,
  p_max_lng  double precision,
  p_max_lat  double precision
)
RETURNS TABLE (
  id               uuid,
  name             text,
  side             text,
  geojson          text,
  restriction_code text,
  color            text,
  label            text
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH in_view AS (
    SELECT s.id, s.name, COALESCE(s.side, 'both') AS side, s.geom
    FROM public.street_segments s
    WHERE s.city_id = p_city_id
      AND s.geom && ST_MakeEnvelope(p_min_lng, p_min_lat, p_max_lng, p_max_lat, 4326)
  ),
  top_rule AS (
    SELECT DISTINCT ON (r.street_segment_id)
      r.street_segment_id, r.restriction_code
    FROM public.parking_rules r
    JOIN in_view v ON v.id = r.street_segment_id
    ORDER BY r.street_segment_id, r.priority ASC
  )
  SELECT
    v.id, v.name, v.side, ST_AsGeoJSON(v.geom) AS geojson,
    COALESCE(tr.restriction_code, 'allowed'),
    COALESCE(rt.color, 'green'),
    COALESCE(rt.label, 'Parking Allowed')
  FROM in_view v
  LEFT JOIN top_rule tr ON tr.street_segment_id = v.id
  LEFT JOIN public.restriction_types rt ON rt.code = tr.restriction_code;
$$;
