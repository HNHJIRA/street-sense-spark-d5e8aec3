CREATE OR REPLACE FUNCTION public.la_link_meter_spaces_to_segments(
  p_city_id uuid,
  p_max_meters double precision DEFAULT 40
) RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '0'
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
    WHERE s.segment_id IS NULL
  )
  UPDATE public.la_meter_spaces s
     SET segment_id = n.seg_id,
         updated_at = now()
    FROM nearest n
   WHERE s.space_id = n.space_id
     AND n.seg_id IS NOT NULL;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$$;
GRANT EXECUTE ON FUNCTION public.la_link_meter_spaces_to_segments(uuid, double precision) TO service_role;