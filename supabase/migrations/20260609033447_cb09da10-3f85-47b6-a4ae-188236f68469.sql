CREATE OR REPLACE FUNCTION public.la_link_meter_batch(p_city_id uuid, p_limit int DEFAULT 200, p_max_meters double precision DEFAULT 40)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '0'
AS $$
DECLARE v_updated int;
BEGIN
  WITH batch AS (
    SELECT space_id, geom::geometry AS pt
    FROM public.la_meter_spaces
    WHERE segment_id IS NULL
    LIMIT p_limit
  ),
  nearest AS (
    SELECT b.space_id,
      (SELECT seg.id FROM public.street_segments seg
        WHERE seg.city_id = p_city_id
          AND seg.geom && ST_Expand(b.pt, 0.0006)
        ORDER BY seg.geom <-> b.pt LIMIT 1) AS seg_id
    FROM batch b
  )
  UPDATE public.la_meter_spaces s
     SET segment_id = n.seg_id, updated_at = now()
    FROM nearest n
   WHERE s.space_id = n.space_id AND n.seg_id IS NOT NULL;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$$;
GRANT EXECUTE ON FUNCTION public.la_link_meter_batch(uuid, int, double precision) TO authenticated, service_role;