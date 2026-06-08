
CREATE OR REPLACE FUNCTION public.nearest_segment(
  p_city_id uuid,
  p_lng double precision,
  p_lat double precision,
  p_max_meters double precision DEFAULT 60
)
RETURNS TABLE (
  id uuid,
  name text,
  side text,
  geojson text,
  restriction_code text,
  color text,
  label text,
  distance_m double precision
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH pt AS (
    SELECT ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography AS g
  ),
  candidate AS (
    SELECT s.id, s.name, s.side, s.geom,
           ST_Distance(s.geom::geography, (SELECT g FROM pt)) AS distance_m
    FROM public.street_segments s
    WHERE s.city_id = p_city_id
    ORDER BY s.geom::geography <-> (SELECT g FROM pt)
    LIMIT 1
  ),
  rule AS (
    SELECT pr.restriction_code
    FROM public.parking_rules pr, candidate c
    WHERE pr.street_segment_id = c.id
    ORDER BY pr.priority ASC
    LIMIT 1
  )
  SELECT c.id, c.name, c.side,
         ST_AsGeoJSON(c.geom)::text AS geojson,
         COALESCE((SELECT restriction_code FROM rule), 'allowed') AS restriction_code,
         COALESCE(rt.color, 'green') AS color,
         COALESCE(rt.label, 'Parking Allowed') AS label,
         c.distance_m
  FROM candidate c
  LEFT JOIN public.restriction_types rt
    ON rt.code = COALESCE((SELECT restriction_code FROM rule), 'allowed')
  WHERE c.distance_m <= p_max_meters;
$$;

GRANT EXECUTE ON FUNCTION public.nearest_segment(uuid, double precision, double precision, double precision) TO anon, authenticated, service_role;
