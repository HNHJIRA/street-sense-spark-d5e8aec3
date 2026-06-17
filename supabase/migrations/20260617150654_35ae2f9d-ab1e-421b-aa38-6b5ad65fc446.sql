ALTER TABLE public.restriction_types DROP CONSTRAINT IF EXISTS restriction_types_color_check;
ALTER TABLE public.restriction_types ADD CONSTRAINT restriction_types_color_check CHECK (color IN ('green','yellow','red','gray'));
UPDATE public.restriction_types SET color = 'gray' WHERE code = 'unknown';