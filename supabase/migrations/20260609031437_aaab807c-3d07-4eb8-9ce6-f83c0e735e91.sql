
CREATE TABLE IF NOT EXISTS public.la_meter_spaces (
  space_id text PRIMARY KEY,
  block_face text,
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  geom geography(Point, 4326) NOT NULL,
  segment_id uuid NULL REFERENCES public.street_segments(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.la_meter_spaces TO authenticated;
GRANT ALL ON public.la_meter_spaces TO service_role;
ALTER TABLE public.la_meter_spaces ENABLE ROW LEVEL SECURITY;
CREATE POLICY "no public read meter spaces" ON public.la_meter_spaces FOR SELECT USING (false);

CREATE INDEX IF NOT EXISTS idx_la_meter_spaces_segment ON public.la_meter_spaces(segment_id);
CREATE INDEX IF NOT EXISTS idx_la_meter_spaces_geom ON public.la_meter_spaces USING gist(geom);

CREATE TABLE IF NOT EXISTS public.la_meter_occupancy (
  space_id text PRIMARY KEY REFERENCES public.la_meter_spaces(space_id) ON DELETE CASCADE,
  state text NOT NULL,
  event_time timestamptz NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.la_meter_occupancy TO authenticated;
GRANT ALL ON public.la_meter_occupancy TO service_role;
ALTER TABLE public.la_meter_occupancy ENABLE ROW LEVEL SECURITY;
CREATE POLICY "no public read meter occupancy" ON public.la_meter_occupancy FOR SELECT USING (false);

-- RPC: per-segment vacancy stats in a bbox
CREATE OR REPLACE FUNCTION public.la_availability_in_bbox(
  p_city_id uuid,
  p_min_lng double precision, p_min_lat double precision,
  p_max_lng double precision, p_max_lat double precision
)
RETURNS TABLE(segment_id uuid, vacant int, occupied int)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    s.segment_id,
    COUNT(*) FILTER (WHERE o.state = 'VACANT')::int AS vacant,
    COUNT(*) FILTER (WHERE o.state = 'OCCUPIED')::int AS occupied
  FROM public.la_meter_spaces s
  JOIN public.la_meter_occupancy o ON o.space_id = s.space_id
  JOIN public.street_segments seg ON seg.id = s.segment_id
  WHERE seg.city_id = p_city_id
    AND s.segment_id IS NOT NULL
    AND ST_Intersects(
      s.geom,
      ST_MakeEnvelope(p_min_lng, p_min_lat, p_max_lng, p_max_lat, 4326)::geography
    )
  GROUP BY s.segment_id;
$$;
REVOKE ALL ON FUNCTION public.la_availability_in_bbox(uuid, double precision, double precision, double precision, double precision) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.la_availability_in_bbox(uuid, double precision, double precision, double precision, double precision) TO authenticated, service_role;
