
DROP FUNCTION IF EXISTS public.apply_curb_zone_polyline_overlay(uuid, text, jsonb, double precision, text);

CREATE OR REPLACE FUNCTION public.apply_curb_zone_polyline_overlay(
  p_city_id uuid,
  p_provider text,
  p_lines jsonb,                 -- array of {restriction_code, priority, days_of_week, time_start, time_end, permit_zone, time_limit_minutes, stname, notes, geometry}
  p_max_meters double precision DEFAULT 15,
  p_wipe_existing text DEFAULT 'replace'   -- 'replace' wipes provider rules first; 'append' does not.
) RETURNS TABLE(
  segments_touched int,
  rules_inserted int,
  lines_input int,
  lines_parsed int,
  candidate_pairs int,
  matched_segments int,
  unmatched_lines int,
  rows_updated int,
  ms_parse int,
  ms_match int,
  ms_update int,
  ms_total int,
  timeout_stage text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '180s'
AS $$
DECLARE
  v_t0 timestamptz := clock_timestamp();
  v_t1 timestamptz;
  v_t2 timestamptz;
  v_t3 timestamptz;
  v_lines_input int := 0;
  v_lines_parsed int := 0;
  v_candidate_pairs int := 0;
  v_matched int := 0;
  v_unmatched int := 0;
  v_inserted int := 0;
  v_touched int := 0;
  v_deg double precision := p_max_meters / 111000.0;
  v_stage text := 'init';
BEGIN
  v_lines_input := COALESCE(jsonb_array_length(p_lines), 0);

  v_stage := 'parse';
  CREATE TEMP TABLE IF NOT EXISTS _cz_lines (
    line_id            int,
    restriction_code   text,
    priority           int,
    stname             text,
    time_start         text,
    time_end           text,
    days_of_week       int[],
    permit_zone        text,
    time_limit_minutes int,
    notes              text,
    geom               geometry(Geometry, 4326)
  ) ON COMMIT DROP;
  TRUNCATE _cz_lines;

  INSERT INTO _cz_lines
  SELECT
    ord::int,
    COALESCE(NULLIF(elem->>'restriction_code',''),'unknown'),
    COALESCE((elem->>'priority')::int, 200),
    NULLIF(upper(elem->>'stname'),''),
    NULLIF(elem->>'time_start',''),
    NULLIF(elem->>'time_end',''),
    COALESCE(
      (SELECT array_agg(x::int) FROM jsonb_array_elements_text(elem->'days_of_week') x),
      ARRAY[0,1,2,3,4,5,6]::int[]
    ),
    NULLIF(elem->>'permit_zone',''),
    NULLIF(elem->>'time_limit_minutes','')::int,
    NULLIF(elem->>'notes',''),
    ST_SetSRID(ST_GeomFromGeoJSON(elem->>'geometry'), 4326)
  FROM jsonb_array_elements(p_lines) WITH ORDINALITY AS t(elem, ord)
  WHERE elem ? 'geometry';

  SELECT count(*)::int INTO v_lines_parsed FROM _cz_lines;
  CREATE INDEX IF NOT EXISTS _cz_lines_gix ON _cz_lines USING GIST (geom);
  ANALYZE _cz_lines;

  v_t1 := clock_timestamp();

  v_stage := 'match';

  IF p_wipe_existing = 'replace' THEN
    DELETE FROM public.parking_rules pr
     USING public.street_segments ss
     WHERE pr.street_segment_id = ss.id
       AND ss.city_id = p_city_id
       AND pr.data_source = p_provider;
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS _cz_matches (
    segment_id         uuid,
    line_id            int,
    restriction_code   text,
    priority           int,
    stname             text,
    time_start         text,
    time_end           text,
    days_of_week       int[],
    permit_zone        text,
    time_limit_minutes int,
    notes              text,
    dist_m             double precision
  ) ON COMMIT DROP;
  TRUNCATE _cz_matches;

  SELECT count(*)::int INTO v_candidate_pairs
  FROM public.street_segments ss
  JOIN _cz_lines l ON ss.geom && ST_Expand(l.geom, v_deg)
  WHERE ss.city_id = p_city_id;

  -- For each (segment, restriction_code) keep the closest line within p_max_meters
  -- so a segment can receive multiple distinct rule types (e.g. allowed + no_parking
  -- at fire-hydrant zones) but never duplicate the same code.
  INSERT INTO _cz_matches
  SELECT DISTINCT ON (ss.id, l.restriction_code)
    ss.id, l.line_id, l.restriction_code, l.priority, l.stname,
    l.time_start, l.time_end, l.days_of_week, l.permit_zone,
    l.time_limit_minutes, l.notes,
    ST_Distance(ss.geom::geography, l.geom::geography)
  FROM public.street_segments ss
  JOIN _cz_lines l
    ON ss.geom && ST_Expand(l.geom, v_deg)
   AND ST_DWithin(ss.geom::geography, l.geom::geography, p_max_meters)
   AND (
        l.stname IS NULL
     OR upper(ss.name) LIKE '%' || l.stname || '%'
     OR l.stname     LIKE '%' || upper(ss.name) || '%'
   )
  WHERE ss.city_id = p_city_id
  ORDER BY ss.id, l.restriction_code, ST_Distance(ss.geom::geography, l.geom::geography) ASC;

  GET DIAGNOSTICS v_matched = ROW_COUNT;

  SELECT GREATEST(v_lines_parsed - count(DISTINCT line_id)::int, 0)
    INTO v_unmatched FROM _cz_matches;

  v_t2 := clock_timestamp();

  v_stage := 'update';

  WITH ins AS (
    INSERT INTO public.parking_rules (
      street_segment_id, priority, restriction_code, days_of_week,
      time_start, time_end, permit_zone, time_limit_minutes,
      effective_from, effective_to, notes, data_source
    )
    SELECT
      m.segment_id,
      m.priority,
      m.restriction_code,
      m.days_of_week,
      NULLIF(m.time_start,'')::time,
      NULLIF(m.time_end,'')::time,
      m.permit_zone,
      m.time_limit_minutes,
      NULL, NULL,
      m.notes,
      p_provider
    FROM _cz_matches m
    RETURNING street_segment_id
  )
  SELECT count(*)::int, count(DISTINCT street_segment_id)::int
    INTO v_inserted, v_touched
  FROM ins;

  v_t3 := clock_timestamp();
  v_stage := 'done';

  RETURN QUERY SELECT
    v_touched, v_inserted, v_lines_input, v_lines_parsed,
    v_candidate_pairs, v_matched, v_unmatched, v_inserted,
    (extract(epoch FROM (v_t1 - v_t0)) * 1000)::int,
    (extract(epoch FROM (v_t2 - v_t1)) * 1000)::int,
    (extract(epoch FROM (v_t3 - v_t2)) * 1000)::int,
    (extract(epoch FROM (v_t3 - v_t0)) * 1000)::int,
    v_stage;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.apply_curb_zone_polyline_overlay(uuid, text, jsonb, double precision, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_curb_zone_polyline_overlay(uuid, text, jsonb, double precision, text)
  TO service_role;
