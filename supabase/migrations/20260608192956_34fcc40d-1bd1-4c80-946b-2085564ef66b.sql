
CREATE OR REPLACE FUNCTION public.street_segments_geojson(p_city_id uuid)
RETURNS TABLE(id uuid, geojson text)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT s.id, ST_AsGeoJSON(s.geom)::text
  FROM public.street_segments s
  WHERE s.city_id = p_city_id;
$$;

CREATE OR REPLACE FUNCTION public.city_center_geojson(p_slug text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT ST_AsGeoJSON(center::geometry)::text
  FROM public.cities
  WHERE slug = p_slug
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.street_segments_geojson(uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.city_center_geojson(text) TO anon, authenticated, service_role;
