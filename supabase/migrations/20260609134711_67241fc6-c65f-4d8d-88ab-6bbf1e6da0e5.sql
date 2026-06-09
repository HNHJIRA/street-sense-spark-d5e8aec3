CREATE OR REPLACE FUNCTION public.nearest_segments_full(
  p_city_id uuid,
  p_lng double precision,
  p_lat double precision,
  p_max_meters double precision DEFAULT 100,
  p_limit integer DEFAULT 12
)
RETURNS TABLE(
  id uuid, name text, side text, geojson text,
  data_source text, metadata jsonb, rules jsonb,
  distance_m double precision
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH pt AS (
    SELECT ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography AS g
  ),
  candidates AS (
    SELECT s.id, s.name, COALESCE(s.side,'both') AS side, s.geom,
           s.data_source, s.metadata,
           ST_Distance(s.geom::geography, (SELECT g FROM pt)) AS distance_m
    FROM public.street_segments s
    WHERE s.city_id = p_city_id
    ORDER BY s.geom::geography <-> (SELECT g FROM pt)
    LIMIT GREATEST(p_limit, 1) * 4
  )
  SELECT
    c.id, c.name, c.side, ST_AsGeoJSON(c.geom)::text,
    c.data_source, c.metadata,
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', pr.id,
        'street_segment_id', pr.street_segment_id,
        'priority', pr.priority,
        'restriction_code', pr.restriction_code,
        'days_of_week', pr.days_of_week,
        'time_start', pr.time_start::text,
        'time_end', pr.time_end::text,
        'permit_zone', pr.permit_zone,
        'time_limit_minutes', pr.time_limit_minutes,
        'effective_from', pr.effective_from,
        'effective_to', pr.effective_to,
        'notes', pr.notes
      ) ORDER BY pr.priority ASC)
      FROM public.parking_rules pr WHERE pr.street_segment_id = c.id
    ), '[]'::jsonb) AS rules,
    c.distance_m
  FROM candidates c
  WHERE c.distance_m <= p_max_meters
  ORDER BY c.distance_m ASC
  LIMIT GREATEST(p_limit, 1);
$function$;

GRANT EXECUTE ON FUNCTION public.nearest_segments_full(uuid, double precision, double precision, double precision, integer) TO anon, authenticated, service_role;