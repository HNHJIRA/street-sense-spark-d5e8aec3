
-- 1. Clear seed data so only real OSM streets remain.
TRUNCATE public.parking_events, public.parking_rules, public.street_segments RESTART IDENTITY CASCADE;

-- 2. Avoid duplicates when re-importing the same OSM way for a city.
CREATE UNIQUE INDEX IF NOT EXISTS street_segments_city_external_idx
  ON public.street_segments(city_id, external_id)
  WHERE external_id IS NOT NULL;

-- 3. Spatial index for fast bbox queries.
CREATE INDEX IF NOT EXISTS street_segments_geom_gist
  ON public.street_segments USING GIST (geom);

-- 4. Function: return segments in a bbox plus the currently-effective restriction code/color.
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
SECURITY DEFINER
SET search_path = public
AS $$
  WITH in_view AS (
    SELECT s.id, s.name, COALESCE(s.side, 'both') AS side, s.geom
    FROM public.street_segments s
    WHERE s.city_id = p_city_id
      AND s.geom && ST_MakeEnvelope(p_min_lng, p_min_lat, p_max_lng, p_max_lat, 4326)
  ),
  -- pick the highest-priority rule for each segment (lowest priority number wins)
  top_rule AS (
    SELECT DISTINCT ON (r.street_segment_id)
      r.street_segment_id, r.restriction_code
    FROM public.parking_rules r
    JOIN in_view v ON v.id = r.street_segment_id
    ORDER BY r.street_segment_id, r.priority ASC
  )
  SELECT
    v.id,
    v.name,
    v.side,
    ST_AsGeoJSON(v.geom) AS geojson,
    COALESCE(tr.restriction_code, 'allowed') AS restriction_code,
    COALESCE(rt.color, 'green') AS color,
    COALESCE(rt.label, 'Parking Allowed') AS label
  FROM in_view v
  LEFT JOIN top_rule tr ON tr.street_segment_id = v.id
  LEFT JOIN public.restriction_types rt ON rt.code = tr.restriction_code;
$$;

GRANT EXECUTE ON FUNCTION public.segments_in_bbox(uuid, double precision, double precision, double precision, double precision)
  TO anon, authenticated, service_role;
