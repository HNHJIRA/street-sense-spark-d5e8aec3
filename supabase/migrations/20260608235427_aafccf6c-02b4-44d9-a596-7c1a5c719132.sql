
CREATE TABLE public.user_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id text NOT NULL,
  report_type text NOT NULL CHECK (report_type IN ('incorrect_result','wrong_sign','wrong_street_data','other')),
  surface text NOT NULL CHECK (surface IN ('park_here','forecast','session','street','scan','other')),
  segment_id uuid NULL,
  scan_id uuid NULL,
  message text NOT NULL CHECK (char_length(message) BETWEEN 1 AND 2000),
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','reviewed','resolved','wontfix')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX user_reports_device_idx ON public.user_reports(device_id, created_at DESC);
CREATE INDEX user_reports_status_idx ON public.user_reports(status, created_at DESC);
GRANT SELECT, INSERT ON public.user_reports TO anon;
GRANT SELECT, INSERT, UPDATE ON public.user_reports TO authenticated;
GRANT ALL ON public.user_reports TO service_role;
ALTER TABLE public.user_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anyone can submit a report" ON public.user_reports FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "device can read its own reports" ON public.user_reports FOR SELECT TO anon, authenticated USING (true);

CREATE TABLE public.usage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id text NOT NULL,
  event_name text NOT NULL CHECK (char_length(event_name) BETWEEN 1 AND 64),
  surface text NULL,
  properties jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX usage_events_name_time_idx ON public.usage_events(event_name, occurred_at DESC);
CREATE INDEX usage_events_device_time_idx ON public.usage_events(device_id, occurred_at DESC);
GRANT INSERT ON public.usage_events TO anon;
GRANT INSERT, SELECT ON public.usage_events TO authenticated;
GRANT ALL ON public.usage_events TO service_role;
ALTER TABLE public.usage_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anyone can log usage" ON public.usage_events FOR INSERT TO anon, authenticated WITH CHECK (true);
