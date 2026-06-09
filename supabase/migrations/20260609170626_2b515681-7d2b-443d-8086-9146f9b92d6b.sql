
ALTER TABLE public.parking_rules
  ADD COLUMN IF NOT EXISTS data_source TEXT;

CREATE INDEX IF NOT EXISTS parking_rules_segment_source_idx
  ON public.parking_rules (street_segment_id, data_source);

CREATE INDEX IF NOT EXISTS parking_rules_source_idx
  ON public.parking_rules (data_source);

-- Backfill existing rules with the segment's data_source so multi-source
-- sync logic has a stable baseline to delete-and-reinsert against.
UPDATE public.parking_rules pr
SET data_source = ss.data_source
FROM public.street_segments ss
WHERE pr.street_segment_id = ss.id
  AND pr.data_source IS NULL;
