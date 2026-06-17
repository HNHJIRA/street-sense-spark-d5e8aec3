
CREATE OR REPLACE FUNCTION public.apply_permit_polyline_overlay(
  p_city_id uuid,
  p_provider text,
  p_lines jsonb,
  p_priority int DEFAULT 50,
  p_max_meters double precision DEFAULT 15,
  p_notes_prefix text DEFAULT 'Permit zone overlay'
) RETURNS TABLE(segments_touched int, rules_inserted int, lines_input int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted int := 0;
  v_touched int := 0;
  v_lines int := 0;
BEGIN
  SELECT count(*)::int INTO v_lines FROM jsonb_array_elements(p_lines);

  -- Wipe previous overlay rules for this provider on this city's segments
  DELETE FROM public.parking_rules pr
   USING public.street_segments ss
   WHERE pr.street_segment_id = ss.id
     AND ss.city_id = p_city_id
     AND pr.data_source = p_provider;

  WITH lines AS (
    SELECT
      COALESCE(elem->>'zone','')                                AS zone,
      NULLIF(upper(elem->>'stname'),'')                          AS stname,
      NULLIF(elem->>'time_start','')                             AS time_start,
      NULLIF(elem->>'time_end','')                               AS time_end,
      COALESCE(
        (SELECT array_agg(x::int) FROM jsonb_array_elements_text(elem->'days_of_week') x),
        ARRAY[1,2,3,4,5]::int[]
      )                                                          AS days_of_week,
      ST_SetSRID(ST_GeomFromGeoJSON(elem->>'geometry'), 4326)    AS geom
    FROM jsonb_array_elements(p_lines) elem
  ), matches AS (
    -- For each segment, pick the closest line within the threshold (and name match if provided).
    SELECT DISTINCT ON (ss.id)
      ss.id AS segment_id,
      l.zone, l.time_start, l.time_end, l.days_of_week, l.stname,
      ST_Distance(ss.geom::geography, l.geom::geography) AS dist_m
    FROM public.street_segments ss
    JOIN lines l
      ON ST_DWithin(ss.geom::geography, l.geom::geography, p_max_meters)
     AND (l.stname IS NULL OR upper(ss.name) LIKE '%' || l.stname || '%' OR upper(l.stname) LIKE '%' || upper(ss.name) || '%')
    WHERE ss.city_id = p_city_id
    ORDER BY ss.id, ST_Distance(ss.geom::geography, l.geom::geography) ASC
  ), ins AS (
    INSERT INTO public.parking_rules (
      street_segment_id, priority, restriction_code, days_of_week,
      time_start, time_end, permit_zone, time_limit_minutes,
      effective_from, effective_to, notes, data_source
    )
    SELECT
      m.segment_id, p_priority, 'permit',
      m.days_of_week,
      m.time_start::time, m.time_end::time,
      m.zone, NULL,
      NULL, NULL,
      p_notes_prefix || ' (zone ' || m.zone || ', ' || COALESCE(m.time_start,'all day') || '–' || COALESCE(m.time_end,'') || ')',
      p_provider
    FROM matches m
    RETURNING street_segment_id
  )
  SELECT count(*)::int, count(DISTINCT street_segment_id)::int
    INTO v_inserted, v_touched
  FROM ins;

  RETURN QUERY SELECT v_touched, v_inserted, v_lines;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.apply_permit_polyline_overlay(uuid, text, jsonb, int, double precision, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_permit_polyline_overlay(uuid, text, jsonb, int, double precision, text) TO service_role;
