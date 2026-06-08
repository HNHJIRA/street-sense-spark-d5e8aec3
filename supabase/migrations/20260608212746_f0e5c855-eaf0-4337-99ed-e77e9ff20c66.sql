DROP FUNCTION IF EXISTS public.upsert_osm_segments(jsonb);

CREATE FUNCTION public.upsert_osm_segments(p_rows jsonb)
RETURNS TABLE (segment_id uuid, segment_external_id text)
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  WITH src AS (
    SELECT
      (r->>'city_id')::uuid                                     AS src_city_id,
      (r->>'external_id')::text                                 AS src_external_id,
      (r->>'name')::text                                        AS src_name,
      COALESCE((r->>'side')::text, 'both')                      AS src_side,
      COALESCE((r->>'data_source')::text, 'osm')                AS src_data_source,
      ST_SetSRID(ST_GeomFromGeoJSON(r->>'geom'), 4326)          AS src_geom,
      COALESCE((r->'metadata')::jsonb, '{}'::jsonb)             AS src_metadata
    FROM jsonb_array_elements(p_rows) AS r
  ),
  ins AS (
    INSERT INTO public.street_segments (city_id, external_id, name, side, data_source, geom, metadata)
    SELECT s.src_city_id, s.src_external_id, s.src_name, s.src_side, s.src_data_source, s.src_geom, s.src_metadata
    FROM src s
    ON CONFLICT (city_id, external_id) WHERE (external_id IS NOT NULL)
    DO UPDATE SET
      name        = EXCLUDED.name,
      side        = EXCLUDED.side,
      data_source = EXCLUDED.data_source,
      geom        = EXCLUDED.geom,
      metadata    = EXCLUDED.metadata,
      updated_at  = now()
    RETURNING street_segments.id, street_segments.external_id
  )
  SELECT ins.id AS segment_id, ins.external_id AS segment_external_id FROM ins;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_osm_segments(jsonb) TO service_role;