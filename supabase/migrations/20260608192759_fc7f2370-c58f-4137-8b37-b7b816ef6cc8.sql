
-- Extensions
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- updated_at helper
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- =========================
-- cities
-- =========================
CREATE TABLE public.cities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  timezone text NOT NULL,
  center geography(Point, 4326) NOT NULL,
  default_zoom numeric NOT NULL DEFAULT 13,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.cities TO anon, authenticated;
GRANT ALL ON public.cities TO service_role;
ALTER TABLE public.cities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cities readable by all" ON public.cities FOR SELECT USING (true);
CREATE TRIGGER trg_cities_updated BEFORE UPDATE ON public.cities
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================
-- restriction_types (lookup)
-- =========================
CREATE TABLE public.restriction_types (
  code text PRIMARY KEY,
  label text NOT NULL,
  color text NOT NULL CHECK (color IN ('green','yellow','red')),
  description text
);
GRANT SELECT ON public.restriction_types TO anon, authenticated;
GRANT ALL ON public.restriction_types TO service_role;
ALTER TABLE public.restriction_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY "restriction_types readable by all" ON public.restriction_types FOR SELECT USING (true);

-- =========================
-- street_segments
-- =========================
CREATE TABLE public.street_segments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  city_id uuid NOT NULL REFERENCES public.cities(id) ON DELETE CASCADE,
  external_id text,
  name text NOT NULL,
  side text CHECK (side IN ('N','S','E','W','both')) DEFAULT 'both',
  geom geometry(LineString, 4326) NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  data_source text NOT NULL DEFAULT 'seed',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX street_segments_geom_idx ON public.street_segments USING GIST (geom);
CREATE INDEX street_segments_city_idx ON public.street_segments (city_id);
GRANT SELECT ON public.street_segments TO anon, authenticated;
GRANT ALL ON public.street_segments TO service_role;
ALTER TABLE public.street_segments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "street_segments readable by all" ON public.street_segments FOR SELECT USING (true);
CREATE TRIGGER trg_street_segments_updated BEFORE UPDATE ON public.street_segments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================
-- parking_rules
-- =========================
CREATE TABLE public.parking_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  street_segment_id uuid NOT NULL REFERENCES public.street_segments(id) ON DELETE CASCADE,
  priority int NOT NULL DEFAULT 100,
  restriction_code text NOT NULL REFERENCES public.restriction_types(code),
  days_of_week int[] NOT NULL DEFAULT '{0,1,2,3,4,5,6}', -- 0=Sun..6=Sat
  time_start time,
  time_end time,
  permit_zone text,
  time_limit_minutes int,
  effective_from date,
  effective_to date,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX parking_rules_segment_idx ON public.parking_rules (street_segment_id);
GRANT SELECT ON public.parking_rules TO anon, authenticated;
GRANT ALL ON public.parking_rules TO service_role;
ALTER TABLE public.parking_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "parking_rules readable by all" ON public.parking_rules FOR SELECT USING (true);
CREATE TRIGGER trg_parking_rules_updated BEFORE UPDATE ON public.parking_rules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================
-- parking_events (temporary overrides)
-- =========================
CREATE TABLE public.parking_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  street_segment_id uuid NOT NULL REFERENCES public.street_segments(id) ON DELETE CASCADE,
  restriction_code text NOT NULL REFERENCES public.restriction_types(code),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX parking_events_segment_idx ON public.parking_events (street_segment_id);
CREATE INDEX parking_events_time_idx ON public.parking_events (starts_at, ends_at);
GRANT SELECT ON public.parking_events TO anon, authenticated;
GRANT ALL ON public.parking_events TO service_role;
ALTER TABLE public.parking_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "parking_events readable by all" ON public.parking_events FOR SELECT USING (true);

-- =========================
-- Seed restriction types
-- =========================
INSERT INTO public.restriction_types (code, label, color, description) VALUES
  ('allowed',         'Parking Allowed',     'green',  'Free, unrestricted parking.'),
  ('metered',         'Metered Parking',     'yellow', 'Paid parking during posted hours.'),
  ('permit',          'Permit Only',         'yellow', 'Residential or restricted permit zone.'),
  ('time_limited',    'Time Limited',        'yellow', 'Limited duration parking.'),
  ('street_cleaning', 'Street Cleaning',     'red',    'No parking during cleaning window.'),
  ('no_parking',      'No Parking',          'red',    'Parking prohibited.'),
  ('tow_away',        'Tow Away Zone',       'red',    'Vehicles will be towed.'),
  ('bus_lane',        'Bus / Transit Lane',  'red',    'No parking — transit only.'),
  ('loading_zone',    'Loading Zone',        'red',    'Commercial loading only during hours.'),
  ('no_standing',     'No Standing',         'red',    'No standing or stopping.')
ON CONFLICT (code) DO NOTHING;

-- =========================
-- Seed Seattle + sample street segments (downtown area)
-- =========================
INSERT INTO public.cities (slug, name, timezone, center, default_zoom)
VALUES ('seattle','Seattle','America/Los_Angeles', ST_SetSRID(ST_MakePoint(-122.3321, 47.6062),4326)::geography, 14)
ON CONFLICT (slug) DO NOTHING;

WITH c AS (SELECT id FROM public.cities WHERE slug='seattle')
INSERT INTO public.street_segments (city_id, name, geom, metadata)
SELECT c.id, s.name, ST_GeomFromText(s.wkt, 4326), s.meta::jsonb
FROM c,
(VALUES
  ('Pike St (1st–2nd)',        'LINESTRING(-122.3401 47.6093, -122.3389 47.6090)', '{"neighborhood":"Downtown"}'),
  ('Pike St (2nd–3rd)',        'LINESTRING(-122.3389 47.6090, -122.3377 47.6087)', '{"neighborhood":"Downtown"}'),
  ('Pine St (1st–2nd)',        'LINESTRING(-122.3404 47.6100, -122.3392 47.6097)', '{"neighborhood":"Downtown"}'),
  ('Pine St (2nd–3rd)',        'LINESTRING(-122.3392 47.6097, -122.3380 47.6094)', '{"neighborhood":"Downtown"}'),
  ('1st Ave (Pike–Pine)',      'LINESTRING(-122.3401 47.6093, -122.3404 47.6100)', '{"neighborhood":"Downtown"}'),
  ('2nd Ave (Pike–Pine)',      'LINESTRING(-122.3389 47.6090, -122.3392 47.6097)', '{"neighborhood":"Downtown"}'),
  ('3rd Ave (Pike–Pine)',      'LINESTRING(-122.3377 47.6087, -122.3380 47.6094)', '{"neighborhood":"Downtown"}'),
  ('Stewart St (Westlake)',    'LINESTRING(-122.3370 47.6130, -122.3350 47.6118)', '{"neighborhood":"Downtown"}'),
  ('Westlake Ave (Pine–Stewart)','LINESTRING(-122.3380 47.6110, -122.3370 47.6130)','{"neighborhood":"Downtown"}'),
  ('Olive Way (Boren–Terry)',  'LINESTRING(-122.3340 47.6140, -122.3320 47.6135)', '{"neighborhood":"Downtown"}'),
  ('Pike Pl (Market)',         'LINESTRING(-122.3420 47.6095, -122.3415 47.6085)', '{"neighborhood":"Pike Place"}'),
  ('Post Alley',               'LINESTRING(-122.3408 47.6092, -122.3405 47.6082)', '{"neighborhood":"Pike Place"}'),
  ('Union St (1st–2nd)',       'LINESTRING(-122.3395 47.6082, -122.3383 47.6079)', '{"neighborhood":"Downtown"}'),
  ('University St (1st–2nd)',  'LINESTRING(-122.3388 47.6073, -122.3376 47.6070)', '{"neighborhood":"Downtown"}'),
  ('Seneca St (1st–2nd)',      'LINESTRING(-122.3381 47.6064, -122.3369 47.6061)', '{"neighborhood":"Downtown"}'),
  ('Spring St (1st–2nd)',      'LINESTRING(-122.3374 47.6055, -122.3362 47.6052)', '{"neighborhood":"Downtown"}'),
  ('Madison St (1st–2nd)',     'LINESTRING(-122.3366 47.6046, -122.3354 47.6043)', '{"neighborhood":"Downtown"}'),
  ('Marion St (1st–2nd)',      'LINESTRING(-122.3359 47.6037, -122.3347 47.6034)', '{"neighborhood":"Downtown"}'),
  ('Columbia St (1st–2nd)',    'LINESTRING(-122.3352 47.6028, -122.3340 47.6025)', '{"neighborhood":"Downtown"}'),
  ('Cherry St (1st–2nd)',      'LINESTRING(-122.3344 47.6019, -122.3332 47.6016)', '{"neighborhood":"Pioneer Square"}'),
  ('James St (1st–2nd)',       'LINESTRING(-122.3337 47.6010, -122.3325 47.6007)', '{"neighborhood":"Pioneer Square"}'),
  ('Yesler Way (1st–2nd)',     'LINESTRING(-122.3330 47.6001, -122.3318 47.5998)', '{"neighborhood":"Pioneer Square"}'),
  ('Denny Way (Westlake)',     'LINESTRING(-122.3400 47.6175, -122.3360 47.6165)', '{"neighborhood":"South Lake Union"}'),
  ('Mercer St (Westlake)',     'LINESTRING(-122.3400 47.6230, -122.3360 47.6220)', '{"neighborhood":"South Lake Union"}'),
  ('Broad St (Seattle Center)','LINESTRING(-122.3490 47.6200, -122.3470 47.6210)', '{"neighborhood":"Seattle Center"}')
) AS s(name, wkt, meta);

-- =========================
-- Seed parking rules for those segments
-- Pattern: a mix so the map shows green/yellow/red
-- =========================
-- Default "allowed" baseline for every segment (lowest priority)
INSERT INTO public.parking_rules (street_segment_id, priority, restriction_code, days_of_week, notes)
SELECT id, 1000, 'allowed', '{0,1,2,3,4,5,6}', 'Default — no posted restriction'
FROM public.street_segments;

-- Metered Mon–Sat 8am–6pm on Pike/Pine/1st/2nd/3rd Aves
INSERT INTO public.parking_rules (street_segment_id, priority, restriction_code, days_of_week, time_start, time_end, notes)
SELECT id, 100, 'metered', '{1,2,3,4,5,6}', '08:00', '18:00', 'Paid parking, 2hr max'
FROM public.street_segments
WHERE name IN (
  'Pike St (1st–2nd)','Pike St (2nd–3rd)','Pine St (1st–2nd)','Pine St (2nd–3rd)',
  '1st Ave (Pike–Pine)','2nd Ave (Pike–Pine)','3rd Ave (Pike–Pine)',
  'Union St (1st–2nd)','University St (1st–2nd)','Seneca St (1st–2nd)','Spring St (1st–2nd)'
);

-- Street cleaning Tue 9am–11am on a few blocks
INSERT INTO public.parking_rules (street_segment_id, priority, restriction_code, days_of_week, time_start, time_end, notes)
SELECT id, 50, 'street_cleaning', '{2}', '09:00', '11:00', 'No parking — street cleaning'
FROM public.street_segments
WHERE name IN ('Stewart St (Westlake)','Olive Way (Boren–Terry)','Westlake Ave (Pine–Stewart)');

-- Bus lane all day on 3rd Ave
INSERT INTO public.parking_rules (street_segment_id, priority, restriction_code, days_of_week, time_start, time_end, notes)
SELECT id, 20, 'bus_lane', '{1,2,3,4,5}', '06:00', '19:00', 'Transit only during peak hours'
FROM public.street_segments WHERE name = '3rd Ave (Pike–Pine)';

-- Loading zone weekdays 7am–10am near Pike Place
INSERT INTO public.parking_rules (street_segment_id, priority, restriction_code, days_of_week, time_start, time_end, notes)
SELECT id, 50, 'loading_zone', '{1,2,3,4,5}', '07:00', '10:00', 'Commercial loading only'
FROM public.street_segments WHERE name IN ('Pike Pl (Market)','Post Alley');

-- Permit only zones in Pioneer Square
INSERT INTO public.parking_rules (street_segment_id, priority, restriction_code, days_of_week, time_start, time_end, permit_zone, notes)
SELECT id, 100, 'permit', '{0,1,2,3,4,5,6}', '00:00', '23:59', 'Zone 9', 'Residential permit required'
FROM public.street_segments WHERE name IN ('Cherry St (1st–2nd)','James St (1st–2nd)','Yesler Way (1st–2nd)');

-- Time limited 2hr on SLU streets
INSERT INTO public.parking_rules (street_segment_id, priority, restriction_code, days_of_week, time_start, time_end, time_limit_minutes, notes)
SELECT id, 100, 'time_limited', '{1,2,3,4,5,6}', '08:00', '20:00', 120, '2 hour limit'
FROM public.street_segments WHERE name IN ('Denny Way (Westlake)','Mercer St (Westlake)','Broad St (Seattle Center)');

-- Tow away on Madison St weekdays 4-6pm (PM peak)
INSERT INTO public.parking_rules (street_segment_id, priority, restriction_code, days_of_week, time_start, time_end, notes)
SELECT id, 30, 'tow_away', '{1,2,3,4,5}', '16:00', '18:00', 'PM peak — tow away'
FROM public.street_segments WHERE name IN ('Madison St (1st–2nd)','Marion St (1st–2nd)','Columbia St (1st–2nd)');
