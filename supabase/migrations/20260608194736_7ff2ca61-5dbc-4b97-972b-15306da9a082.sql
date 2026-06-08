
-- Helper used by the OSM importer to bulk-upsert segments whose geometry comes
-- in as GeoJSON. Returning the new id + external_id lets the caller attach
-- per-segment parking rules in a follow-up step.
CREATE OR REPLACE FUNCTION public.upsert_osm_segments(p_rows jsonb)
RETURNS TABLE (id uuid, external_id text)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
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
    ON CONFLICT (city_id, external_id) WHERE external_id IS NOT NULL
    DO UPDATE SET
      name        = EXCLUDED.name,
      side        = EXCLUDED.side,
      data_source = EXCLUDED.data_source,
      geom        = EXCLUDED.geom,
      metadata    = EXCLUDED.metadata,
      updated_at  = now()
    RETURNING street_segments.id, street_segments.external_id
  )
  SELECT ins.id, ins.external_id FROM ins;
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_osm_segments(jsonb) TO service_role;
