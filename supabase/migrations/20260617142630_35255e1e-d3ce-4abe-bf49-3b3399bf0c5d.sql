
DROP FUNCTION IF EXISTS public.apply_permit_polyline_overlay(uuid, text, jsonb, int, double precision, text);

CREATE OR REPLACE FUNCTION public.apply_permit_polyline_overlay(
  p_city_id uuid,
  p_provider text,
  p_lines jsonb,
  p_priority int DEFAULT 50,
  p_max_meters double precision DEFAULT 15,
  p_notes_prefix text DEFAULT 'Permit zone overlay'
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
SET statement_timeout = '120s'
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
  v_deg double precision := p_max_meters / 111000.0;  -- ~meters→degrees prefilter
  v_stage text := 'init';
BEGIN
  v_lines_input := jsonb_array_length(p_lines);

  ---------------------------------------------------------------------------
  -- 1) PARSE: materialize lines into a temp table with a spatial index
  ---------------------------------------------------------------------------
  v_stage := 'parse';
  CREATE TEMP TABLE IF NOT EXISTS _permit_lines (
    line_id    int,
    zone       text,
    stname     text,
    time_start text,
    time_end   text,
    days_of_week int[],
    geom       geometry(Geometry, 4326)
  ) ON COMMIT DROP;
  TRUNCATE _permit_lines;

  INSERT INTO _permit_lines (line_id, zone, stname, time_start, time_end, days_of_week, geom)
  SELECT
    ord::int,
    COALESCE(elem->>'zone',''),
    NULLIF(upper(elem->>'stname'),''),
    NULLIF(elem->>'time_start',''),
    NULLIF(elem->>'time_end',''),
    COALESCE(
      (SELECT array_agg(x::int) FROM jsonb_array_elements_text(elem->'days_of_week') x),
      ARRAY[1,2,3,4,5]::int[]
    ),
    ST_SetSRID(ST_GeomFromGeoJSON(elem->>'geometry'), 4326)
  FROM jsonb_array_elements(p_lines) WITH ORDINALITY AS t(elem, ord)
  WHERE elem ? 'geometry';

  SELECT count(*)::int INTO v_lines_parsed FROM _permit_lines;

  CREATE INDEX IF NOT EXISTS _permit_lines_gix ON _permit_lines USING GIST (geom);
  ANALYZE _permit_lines;

  v_t1 := clock_timestamp();

  ---------------------------------------------------------------------------
  -- 2) MATCH: bbox prefilter via GIST, then precise geography distance
  ---------------------------------------------------------------------------
  v_stage := 'match';

  -- Wipe previous overlay rules for this provider on this city's segments
  DELETE FROM public.parking_rules pr
   USING public.street_segments ss
   WHERE pr.street_segment_id = ss.id
     AND ss.city_id = p_city_id
     AND pr.data_source = p_provider;

  CREATE TEMP TABLE IF NOT EXISTS _permit_matches (
    segment_id uuid,
    line_id int,
    zone text,
    stname text,
    time_start text,
    time_end text,
    days_of_week int[],
    dist_m double precision
  ) ON COMMIT DROP;
  TRUNCATE _permit_matches;

  -- Candidate pairs (bbox prefilter only) — used for diagnostics
  SELECT count(*)::int INTO v_candidate_pairs
  FROM public.street_segments ss
  JOIN _permit_lines l
    ON ss.geom && ST_Expand(l.geom, v_deg)
  WHERE ss.city_id = p_city_id;

  -- True matches: for each segment, the closest line within p_max_meters
  -- (optionally constrained by street-name substring).
  INSERT INTO _permit_matches
  SELECT DISTINCT ON (ss.id)
    ss.id,
    l.line_id,
    l.zone,
    l.stname,
    l.time_start,
    l.time_end,
    l.days_of_week,
    ST_Distance(ss.geom::geography, l.geom::geography) AS dist_m
  FROM public.street_segments ss
  JOIN _permit_lines l
    ON ss.geom && ST_Expand(l.geom, v_deg)
   AND ST_DWithin(ss.geom::geography, l.geom::geography, p_max_meters)
   AND (
        l.stname IS NULL
     OR upper(ss.name) LIKE '%' || l.stname || '%'
     OR l.stname     LIKE '%' || upper(ss.name) || '%'
   )
  WHERE ss.city_id = p_city_id
  ORDER BY ss.id, ST_Distance(ss.geom::geography, l.geom::geography) ASC;

  GET DIAGNOSTICS v_matched = ROW_COUNT;

  SELECT v_lines_parsed - count(DISTINCT line_id)::int INTO v_unmatched FROM _permit_matches;

  v_t2 := clock_timestamp();

  ---------------------------------------------------------------------------
  -- 3) UPDATE: single batched INSERT
  ---------------------------------------------------------------------------
  v_stage := 'update';

  WITH ins AS (
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
      p_notes_prefix || ' (zone ' || m.zone || ', ' ||
        COALESCE(m.time_start,'all day') || '–' || COALESCE(m.time_end,'') || ')',
      p_provider
    FROM _permit_matches m
    RETURNING street_segment_id
  )
  SELECT count(*)::int, count(DISTINCT street_segment_id)::int
    INTO v_inserted, v_touched
  FROM ins;

  v_t3 := clock_timestamp();
  v_stage := 'done';

  RETURN QUERY SELECT
    v_touched,
    v_inserted,
    v_lines_input,
    v_lines_parsed,
    v_candidate_pairs,
    v_matched,
    GREATEST(v_unmatched, 0),
    v_inserted,
    (extract(epoch FROM (v_t1 - v_t0)) * 1000)::int,
    (extract(epoch FROM (v_t2 - v_t1)) * 1000)::int,
    (extract(epoch FROM (v_t3 - v_t2)) * 1000)::int,
    (extract(epoch FROM (v_t3 - v_t0)) * 1000)::int,
    v_stage;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.apply_permit_polyline_overlay(uuid, text, jsonb, int, double precision, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_permit_polyline_overlay(uuid, text, jsonb, int, double precision, text) TO service_role;
