CREATE OR REPLACE FUNCTION public.apply_bellevue_derived_allowed(p_city_id uuid)
RETURNS TABLE(
  rules_deleted int,
  rules_inserted int,
  segments_touched int,
  source_rules_considered int
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '60s'
AS $$
DECLARE
  v_deleted int := 0;
  v_inserted int := 0;
  v_touched int := 0;
  v_considered int := 0;
  v_all_days int[] := ARRAY[0,1,2,3,4,5,6];
BEGIN
  -- 1) Wipe prior derived rows (idempotent regeneration).
  DELETE FROM public.parking_rules pr
    USING public.street_segments ss
    WHERE pr.street_segment_id = ss.id
      AND ss.city_id = p_city_id
      AND pr.data_source = 'bellevue-derived-allowed';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  -- 2) Source rows: every authoritative time-bounded restriction on a
  --    Bellevue segment from cbd / rpz-streets.
  WITH src AS (
    SELECT pr.id              AS source_rule_id,
           pr.street_segment_id,
           pr.restriction_code,
           pr.time_start,
           pr.time_end,
           pr.days_of_week,
           pr.notes,
           pr.permit_zone
    FROM public.parking_rules pr
    JOIN public.street_segments ss ON ss.id = pr.street_segment_id
    WHERE ss.city_id = p_city_id
      AND pr.data_source IN ('bellevue-cbd','bellevue-rpz-streets')
      AND pr.time_start IS NOT NULL
      AND pr.time_end   IS NOT NULL
      AND pr.days_of_week IS NOT NULL
      AND array_length(pr.days_of_week,1) > 0
  ),
  src_count AS (SELECT count(*)::int AS n FROM src),

  -- 2a) Inverse-hours on the restriction's own days.
  --     Engine treats start>end as a wraparound window, so this exactly
  --     covers the time outside the restriction window.
  inv_hours AS (
    INSERT INTO public.parking_rules (
      street_segment_id, priority, restriction_code, days_of_week,
      time_start, time_end, permit_zone, time_limit_minutes,
      effective_from, effective_to, notes, data_source
    )
    SELECT
      s.street_segment_id,
      200,
      'allowed',
      s.days_of_week,
      s.time_end,
      s.time_start,
      NULL, NULL, NULL, NULL,
      'Derived: inverse of ' || s.restriction_code
        || ' ' || to_char(s.time_start,'HH24:MI')
        || '-' || to_char(s.time_end,'HH24:MI'),
      'bellevue-derived-allowed'
    FROM src s
    WHERE s.time_start <> s.time_end
    RETURNING street_segment_id
  ),

  -- 2b) Off-days: full 24h allowed on days the restriction doesn't cover.
  --     Engine matches by days_of_week first; with no time bounds the rule
  --     is active all day.
  off_days AS (
    INSERT INTO public.parking_rules (
      street_segment_id, priority, restriction_code, days_of_week,
      time_start, time_end, permit_zone, time_limit_minutes,
      effective_from, effective_to, notes, data_source
    )
    SELECT
      s.street_segment_id,
      200,
      'allowed',
      ARRAY(SELECT unnest(v_all_days) EXCEPT SELECT unnest(s.days_of_week))
        ::int[],
      NULL, NULL, NULL, NULL, NULL, NULL,
      'Derived: off-days for ' || s.restriction_code,
      'bellevue-derived-allowed'
    FROM src s
    WHERE ARRAY(SELECT unnest(v_all_days) EXCEPT SELECT unnest(s.days_of_week))::int[]
            <> ARRAY[]::int[]
    RETURNING street_segment_id
  ),

  ins_all AS (
    SELECT street_segment_id FROM inv_hours
    UNION ALL
    SELECT street_segment_id FROM off_days
  )
  SELECT
    (SELECT n FROM src_count),
    (SELECT count(*)::int FROM ins_all),
    (SELECT count(DISTINCT street_segment_id)::int FROM ins_all)
  INTO v_considered, v_inserted, v_touched;

  RETURN QUERY SELECT v_deleted, v_inserted, v_touched, v_considered;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.apply_bellevue_derived_allowed(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_bellevue_derived_allowed(uuid)
  TO service_role;