
-- P1/P2: persist verdict, summary, distance on scans
ALTER TABLE public.parking_sign_scans
  ADD COLUMN IF NOT EXISTS verdict TEXT,
  ADD COLUMN IF NOT EXISTS summary JSONB,
  ADD COLUMN IF NOT EXISTS nearest_distance_m NUMERIC,
  ADD COLUMN IF NOT EXISTS match_status TEXT;

CREATE INDEX IF NOT EXISTS idx_parking_sign_scans_verdict ON public.parking_sign_scans(verdict);
CREATE INDEX IF NOT EXISTS idx_parking_sign_scans_match_status ON public.parking_sign_scans(match_status);

-- P3: enable scheduling extensions
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;
