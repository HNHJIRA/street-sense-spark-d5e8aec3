
CREATE OR REPLACE FUNCTION public.la_link_meter_spaces_to_segments(
  p_city_id uuid,
  p_max_meters double precision DEFAULT 40
) RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated int;
BEGIN
  WITH nearest AS (
    SELECT s.space_id,
           (
             SELECT seg.id
             FROM public.street_segments seg
             WHERE seg.city_id = p_city_id
               AND ST_DWithin(seg.geom, s.geom, p_max_meters)
             ORDER BY seg.geom <-> s.geom
             LIMIT 1
           ) AS seg_id
    FROM public.la_meter_spaces s
  )
  UPDATE public.la_meter_spaces s
     SET segment_id = n.seg_id,
         updated_at = now()
    FROM nearest n
   WHERE s.space_id = n.space_id
     AND COALESCE(s.segment_id, '00000000-0000-0000-0000-000000000000'::uuid) IS DISTINCT FROM COALESCE(n.seg_id, '00000000-0000-0000-0000-000000000000'::uuid);
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$$;
REVOKE ALL ON FUNCTION public.la_link_meter_spaces_to_segments(uuid, double precision) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.la_link_meter_spaces_to_segments(uuid, double precision) TO service_role;

CREATE OR REPLACE FUNCTION public.la_upsert_meter_occupancy(p_rows jsonb)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int;
BEGIN
  WITH src AS (
    SELECT (r->>'space_id')::text     AS space_id,
           (r->>'state')::text        AS state,
           (r->>'event_time')::timestamptz AS event_time,
           (r->>'fetched_at')::timestamptz AS fetched_at
    FROM jsonb_array_elements(p_rows) AS r
  ),
  filtered AS (
    SELECT s.space_id, s.state, s.event_time, s.fetched_at
    FROM src s
    JOIN public.la_meter_spaces m ON m.space_id = s.space_id
  )
  INSERT INTO public.la_meter_occupancy(space_id, state, event_time, fetched_at)
  SELECT space_id, state, event_time, fetched_at FROM filtered
  ON CONFLICT (space_id) DO UPDATE
    SET state = EXCLUDED.state,
        event_time = EXCLUDED.event_time,
        fetched_at = EXCLUDED.fetched_at;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.la_upsert_meter_occupancy(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.la_upsert_meter_occupancy(jsonb) TO service_role;
