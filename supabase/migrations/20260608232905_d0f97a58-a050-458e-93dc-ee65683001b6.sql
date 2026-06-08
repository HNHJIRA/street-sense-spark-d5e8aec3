
CREATE TABLE public.parking_sign_scans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  city_id uuid REFERENCES public.cities(id) ON DELETE SET NULL,
  segment_id uuid REFERENCES public.street_segments(id) ON DELETE SET NULL,
  lng double precision,
  lat double precision,
  decision jsonb NOT NULL DEFAULT '{}'::jsonb,
  overall_confidence numeric,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.parking_sign_scans TO anon, authenticated;
GRANT ALL ON public.parking_sign_scans TO service_role;
ALTER TABLE public.parking_sign_scans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sign scans public read" ON public.parking_sign_scans FOR SELECT USING (true);

CREATE TABLE public.parking_sign_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_id uuid NOT NULL REFERENCES public.parking_sign_scans(id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  public_url text,
  width integer,
  height integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.parking_sign_images TO anon, authenticated;
GRANT ALL ON public.parking_sign_images TO service_role;
ALTER TABLE public.parking_sign_images ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sign images public read" ON public.parking_sign_images FOR SELECT USING (true);

CREATE TABLE public.ocr_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_id uuid NOT NULL REFERENCES public.parking_sign_scans(id) ON DELETE CASCADE,
  model text NOT NULL,
  raw_text text NOT NULL DEFAULT '',
  sign_count integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.ocr_results TO anon, authenticated;
GRANT ALL ON public.ocr_results TO service_role;
ALTER TABLE public.ocr_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ocr results public read" ON public.ocr_results FOR SELECT USING (true);

CREATE TABLE public.parsed_sign_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_id uuid NOT NULL REFERENCES public.parking_sign_scans(id) ON DELETE CASCADE,
  sequence integer NOT NULL DEFAULT 0,
  restriction_code text NOT NULL,
  days_of_week integer[] NOT NULL DEFAULT '{0,1,2,3,4,5,6}'::integer[],
  time_start time,
  time_end time,
  permit_zone text,
  time_limit_minutes integer,
  priority integer NOT NULL DEFAULT 50,
  confidence numeric,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.parsed_sign_rules TO anon, authenticated;
GRANT ALL ON public.parsed_sign_rules TO service_role;
ALTER TABLE public.parsed_sign_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "parsed sign rules public read" ON public.parsed_sign_rules FOR SELECT USING (true);

CREATE TABLE public.scan_validation_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_id uuid NOT NULL REFERENCES public.parking_sign_scans(id) ON DELETE CASCADE,
  outcome text NOT NULL,           -- 'match' | 'conflict' | 'unmatched' | 'no_sdot'
  matched_rule_id uuid REFERENCES public.parking_rules(id) ON DELETE SET NULL,
  confidence numeric,
  detail text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.scan_validation_results TO anon, authenticated;
GRANT ALL ON public.scan_validation_results TO service_role;
ALTER TABLE public.scan_validation_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY "scan validation public read" ON public.scan_validation_results FOR SELECT USING (true);

CREATE INDEX IF NOT EXISTS idx_parking_sign_scans_created_at ON public.parking_sign_scans (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_parsed_sign_rules_scan ON public.parsed_sign_rules (scan_id);
CREATE INDEX IF NOT EXISTS idx_scan_validation_scan ON public.scan_validation_results (scan_id);
