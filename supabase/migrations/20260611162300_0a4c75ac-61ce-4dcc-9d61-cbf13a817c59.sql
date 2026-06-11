REVOKE EXECUTE ON FUNCTION public.nearest_segment_full(uuid, double precision, double precision, double precision) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.nearest_segments_full(uuid, double precision, double precision, double precision, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.nearest_segment(uuid, double precision, double precision, double precision) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.la_upsert_meter_occupancy(jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.la_link_meter_batch(uuid, integer, double precision) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.la_link_meter_spaces_to_segments(uuid, double precision) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.la_availability_in_bbox(uuid, double precision, double precision, double precision, double precision) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.la_area_counts(uuid, double precision, double precision, double precision, double precision) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.apply_permit_polygon_overlay(uuid, text, jsonb, integer, text) FROM PUBLIC;