
-- Option B conflict resolver for Arlington curb overlay.
-- Deletes arlington-curb no_parking / no_standing rules from any segment
-- that also has a more-permissive arlington-curb rule (allowed, permit,
-- metered, loading_zone, commercial_loading, passenger_loading,
-- time_limited, bus_zone, taxi_zone). Idempotent; safe to re-run.
CREATE OR REPLACE FUNCTION public.cleanup_arlington_curb_conflicts()
RETURNS TABLE(
  suppressed_segments bigint,
  suppressed_rules bigint,
  retained_np_segments bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  permissive_codes text[] := ARRAY[
    'allowed','permit','metered','loading_zone','commercial_loading',
    'passenger_loading','time_limited','bus_zone','taxi_zone'
  ];
  conflict_segments uuid[];
  v_suppressed_rules bigint := 0;
BEGIN
  -- Segments that have BOTH a curb no_parking/no_standing rule AND
  -- a more-permissive curb rule (different sub-stretch of the same
  -- block face collapsed by the 15 m snap).
  SELECT COALESCE(array_agg(DISTINCT street_segment_id), '{}'::uuid[])
    INTO conflict_segments
  FROM parking_rules
  WHERE data_source = 'arlington-curb'
    AND restriction_code = ANY(permissive_codes)
    AND street_segment_id IN (
      SELECT street_segment_id FROM parking_rules
      WHERE data_source = 'arlington-curb'
        AND restriction_code IN ('no_parking','no_standing')
    );

  DELETE FROM parking_rules
  WHERE data_source = 'arlington-curb'
    AND restriction_code IN ('no_parking','no_standing')
    AND street_segment_id = ANY(conflict_segments);
  GET DIAGNOSTICS v_suppressed_rules = ROW_COUNT;

  RETURN QUERY
  SELECT
    COALESCE(array_length(conflict_segments, 1), 0)::bigint,
    v_suppressed_rules,
    (SELECT COUNT(DISTINCT street_segment_id) FROM parking_rules
       WHERE data_source = 'arlington-curb'
         AND restriction_code IN ('no_parking','no_standing'))::bigint;
END;
$$;

GRANT EXECUTE ON FUNCTION public.cleanup_arlington_curb_conflicts() TO service_role;
