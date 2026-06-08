
-- ============================================================
-- Provider sync infrastructure + time-aware spatial RPCs
-- ============================================================

-- 1) sync_logs: one row per provider sync attempt
CREATE TABLE public.sync_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  provider text NOT NULL,
  city_id uuid REFERENCES public.cities(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('started','success','error','partial')),
  imported integer NOT NULL DEFAULT 0,
  skipped integer NOT NULL DEFAULT 0,
  bbox jsonb,
  error text,
  duration_ms integer,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
GRANT SELECT ON public.sync_logs TO authenticated, anon;
GRANT ALL ON public.sync_logs TO service_role;
ALTER TABLE public.sync_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sync_logs public read" ON public.sync_logs FOR SELECT USING (true);
CREATE INDEX sync_logs_provider_started_idx ON public.sync_logs (provider, started_at DESC);

-- 2) provider_health: rolling status per (provider, city)
CREATE TABLE public.provider_health (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  provider text NOT NULL,
  city_id uuid REFERENCES public.cities(id) ON DELETE CASCADE,
  healthy boolean NOT NULL DEFAULT true,
  last_success_at timestamptz,
  last_error_at timestamptz,
  last_error text,
  segments_total integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, city_id)
);
GRANT SELECT ON public.provider_health TO authenticated, anon;
GRANT ALL ON public.provider_health TO service_role;
ALTER TABLE public.provider_health ENABLE ROW LEVEL SECURITY;
CREATE POLICY "provider_health public read" ON public.provider_health FOR SELECT USING (true);

-- 3) segments_in_bbox_with_rules: returns geom + rule rows for engine evaluation
CREATE OR REPLACE FUNCTION public.segments_in_bbox_with_rules(
  p_city_id uuid,
  p_min_lng double precision, p_min_lat double precision,
  p_max_lng double precision, p_max_lat double precision
) RETURNS TABLE(
  id uuid, name text, side text, geojson text,
  data_source text, metadata jsonb, rules jsonb
)
LANGUAGE sql STABLE SET search_path TO 'public'
AS $$
  SELECT
    s.id, s.name, COALESCE(s.side, 'both') AS side,
    ST_AsGeoJSON(s.geom)::text AS geojson,
    s.data_source, s.metadata,
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', pr.id,
        'street_segment_id', pr.street_segment_id,
        'priority', pr.priority,
        'restriction_code', pr.restriction_code,
        'days_of_week', pr.days_of_week,
        'time_start', pr.time_start::text,
        'time_end', pr.time_end::text,
        'permit_zone', pr.permit_zone,
        'time_limit_minutes', pr.time_limit_minutes,
        'effective_from', pr.effective_from,
        'effective_to', pr.effective_to,
        'notes', pr.notes
      ) ORDER BY pr.priority ASC)
      FROM public.parking_rules pr WHERE pr.street_segment_id = s.id
    ), '[]'::jsonb) AS rules
  FROM public.street_segments s
  WHERE s.city_id = p_city_id
    AND s.geom && ST_MakeEnvelope(p_min_lng, p_min_lat, p_max_lng, p_max_lat, 4326);
$$;

-- 4) nearest_segment_full: nearest segment + full rules for engine evaluation
CREATE OR REPLACE FUNCTION public.nearest_segment_full(
  p_city_id uuid, p_lng double precision, p_lat double precision,
  p_max_meters double precision DEFAULT 80
) RETURNS TABLE(
  id uuid, name text, side text, geojson text,
  data_source text, metadata jsonb, rules jsonb,
  distance_m double precision
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  WITH pt AS (
    SELECT ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography AS g
  ),
  candidate AS (
    SELECT s.id, s.name, COALESCE(s.side,'both') AS side, s.geom,
           s.data_source, s.metadata,
           ST_Distance(s.geom::geography, (SELECT g FROM pt)) AS distance_m
    FROM public.street_segments s
    WHERE s.city_id = p_city_id
    ORDER BY s.geom::geography <-> (SELECT g FROM pt)
    LIMIT 1
  )
  SELECT
    c.id, c.name, c.side, ST_AsGeoJSON(c.geom)::text,
    c.data_source, c.metadata,
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', pr.id,
        'street_segment_id', pr.street_segment_id,
        'priority', pr.priority,
        'restriction_code', pr.restriction_code,
        'days_of_week', pr.days_of_week,
        'time_start', pr.time_start::text,
        'time_end', pr.time_end::text,
        'permit_zone', pr.permit_zone,
        'time_limit_minutes', pr.time_limit_minutes,
        'effective_from', pr.effective_from,
        'effective_to', pr.effective_to,
        'notes', pr.notes
      ) ORDER BY pr.priority ASC)
      FROM public.parking_rules pr WHERE pr.street_segment_id = c.id
    ), '[]'::jsonb) AS rules,
    c.distance_m
  FROM candidate c
  WHERE c.distance_m <= p_max_meters;
$$;

-- updated_at trigger for provider_health
CREATE TRIGGER provider_health_touch_updated_at
BEFORE UPDATE ON public.provider_health
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
