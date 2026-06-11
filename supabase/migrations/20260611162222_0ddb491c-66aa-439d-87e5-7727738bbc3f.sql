-- 1) Remove overly-permissive SELECT on user_reports (was USING true).
DROP POLICY IF EXISTS "device can read its own reports" ON public.user_reports;

-- 2) Lock down sign-scans storage bucket for anon/authenticated.
DROP POLICY IF EXISTS "sign-scans deny anon/auth select" ON storage.objects;
DROP POLICY IF EXISTS "sign-scans deny anon/auth insert" ON storage.objects;
DROP POLICY IF EXISTS "sign-scans deny anon/auth update" ON storage.objects;
DROP POLICY IF EXISTS "sign-scans deny anon/auth delete" ON storage.objects;

CREATE POLICY "sign-scans deny anon/auth select"
  ON storage.objects FOR SELECT
  TO anon, authenticated
  USING (bucket_id <> 'sign-scans');

CREATE POLICY "sign-scans deny anon/auth insert"
  ON storage.objects FOR INSERT
  TO anon, authenticated
  WITH CHECK (bucket_id <> 'sign-scans');

CREATE POLICY "sign-scans deny anon/auth update"
  ON storage.objects FOR UPDATE
  TO anon, authenticated
  USING (bucket_id <> 'sign-scans')
  WITH CHECK (bucket_id <> 'sign-scans');

CREATE POLICY "sign-scans deny anon/auth delete"
  ON storage.objects FOR DELETE
  TO anon, authenticated
  USING (bucket_id <> 'sign-scans');

-- 3) Revoke EXECUTE on SECURITY DEFINER helper functions from anon and authenticated.
REVOKE EXECUTE ON FUNCTION public.nearest_segment_full(uuid, double precision, double precision, double precision) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.nearest_segments_full(uuid, double precision, double precision, double precision, integer) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.nearest_segment(uuid, double precision, double precision, double precision) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.la_upsert_meter_occupancy(jsonb) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.la_link_meter_batch(uuid, integer, double precision) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.la_link_meter_spaces_to_segments(uuid, double precision) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.la_availability_in_bbox(uuid, double precision, double precision, double precision, double precision) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.la_area_counts(uuid, double precision, double precision, double precision, double precision) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.apply_permit_polygon_overlay(uuid, text, jsonb, integer, text) FROM anon, authenticated;