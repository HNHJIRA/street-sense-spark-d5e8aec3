
UPDATE public.restriction_types SET color = 'yellow', label = 'Loading Zone', description = 'Restricted use zone — only specific vehicle activity (e.g. active loading) is permitted; general parking is not allowed during the posted window.' WHERE code = 'loading_zone';

INSERT INTO public.restriction_types (code, label, color, description) VALUES
  ('passenger_loading', 'Passenger Loading Only', 'yellow', 'Reserved for active passenger pick-up / drop-off only. General parking is not permitted during the posted window.'),
  ('commercial_loading', 'Commercial Loading Only', 'yellow', 'Reserved for active commercial loading/unloading by qualifying vehicles only. General parking is not permitted during the posted window.'),
  ('taxi_zone', 'Taxi Zone', 'yellow', 'Reserved for taxis actively picking up or dropping off passengers. General parking is not permitted during the posted window.'),
  ('bus_zone', 'Bus Zone', 'yellow', 'Reserved for transit / bus stops. General parking is not permitted during the posted window.')
ON CONFLICT (code) DO UPDATE SET color = EXCLUDED.color, label = EXCLUDED.label, description = EXCLUDED.description;
