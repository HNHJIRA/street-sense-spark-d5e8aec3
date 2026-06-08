CREATE OR REPLACE FUNCTION public.upsert_osm_segments(p_rows jsonb)
RETURNS TABLE (id uuid, external_id text)
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  WITH src AS (
    SELECT
      (r->>'city_id')::uuid                                     AS city_id,
      (r->>'external_id')::text                                 AS external_id,
      (r->>'name')::text                                        AS name,
      COALESCE((r->>'side')::text, 'both')                      AS side,
      COALESCE((r->>'data_source')::text, 'osm')                AS data_source,
      ST_SetSRID(ST_GeomFromGeoJSON(r->>'geom'), 4326)          AS geom,
      COALESCE((r->'metadata')::jsonb, '{}'::jsonb)             AS metadata
    FROM jsonb_array_elements(p_rows) AS r
  ),
  ins AS (
    INSERT INTO public.street_segments (city_id, external_id, name, side, data_source, geom, metadata)
    SELECT s.city_id, s.external_id, s.name, s.side, s.data_source, s.geom, s.metadata
    FROM src s
    ON CONFLICT (city_id, external_id) WHERE (public.street_segments.external_id IS NOT NULL)
    DO UPDATE SET
      name        = EXCLUDED.name,
      side        = EXCLUDED.side,
      data_source = EXCLUDED.data_source,
      geom        = EXCLUDED.geom,
      metadata    = EXCLUDED.metadata,
      updated_at  = now()
    RETURNING public.street_segments.id AS id, public.street_segments.external_id AS external_id
  )
  SELECT ins.id, ins.external_id FROM ins;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_osm_segments(jsonb) TO service_role;