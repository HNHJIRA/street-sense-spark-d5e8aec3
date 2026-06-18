CREATE OR REPLACE FUNCTION public.apply_zone_polygon_overlay(
  p_city_id uuid,
  p_provider text,
  p_polygons jsonb,
  p_restriction_code text,
  p_priority int DEFAULT 40,
  p_notes_prefix text DEFAULT 'Zone overlay'
) RETURNS TABLE(segments_touched int, rules_inserted int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted int := 0;
  v_touched int := 0;
BEGIN
  DELETE FROM public.parking_rules pr
   USING public.street_segments ss
   WHERE pr.street_segment_id = ss.id
     AND ss.city_id = p_city_id
     AND pr.data_source = p_provider;

  WITH polys AS (
    SELECT
      (elem->>'zone')::text AS zone,
      ST_SetSRID(ST_GeomFromGeoJSON(elem->>'geometry'), 4326) AS geom
    FROM jsonb_array_elements(p_polygons) elem
  ), hits AS (
    INSERT INTO public.parking_rules (
      street_segment_id, priority, restriction_code, days_of_week,
      time_start, time_end, permit_zone, time_limit_minutes,
      effective_from, effective_to, notes, data_source
    )
    SELECT ss.id, p_priority, p_restriction_code,
           ARRAY[0,1,2,3,4,5,6]::int[],
           NULL, NULL, NULL, NULL,
           NULL, NULL,
           p_notes_prefix || COALESCE(' (' || NULLIF(p.zone, '') || ')', ''),
           p_provider
    FROM public.street_segments ss
    JOIN polys p ON ST_Intersects(ss.geom, p.geom)
    WHERE ss.city_id = p_city_id
    RETURNING street_segment_id
  )
  SELECT count(*)::int, count(DISTINCT street_segment_id)::int
    INTO v_inserted, v_touched
    FROM hits;

  RETURN QUERY SELECT v_touched, v_inserted;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.apply_zone_polygon_overlay(uuid, text, jsonb, text, int, text)
  FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.apply_zone_polygon_overlay(uuid, text, jsonb, text, int, text)
  FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_zone_polygon_overlay(uuid, text, jsonb, text, int, text)
  TO service_role;