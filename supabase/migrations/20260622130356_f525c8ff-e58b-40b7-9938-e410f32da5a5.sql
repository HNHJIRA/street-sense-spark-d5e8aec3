
ALTER TABLE public.provider_health
  ADD COLUMN IF NOT EXISTS last_sync_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_sync_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS records_imported integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS records_skipped integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS duration_ms integer,
  ADD COLUMN IF NOT EXISTS provider_status text NOT NULL DEFAULT 'healthy',
  ADD COLUMN IF NOT EXISTS provider_error text,
  ADD COLUMN IF NOT EXISTS supports_incremental boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_incremental_at timestamptz,
  ADD COLUMN IF NOT EXISTS next_scheduled_at timestamptz;

-- Try-acquire advisory lock; key derived from a stable text identifier.
CREATE OR REPLACE FUNCTION public.try_acquire_sync_lock(p_key text)
RETURNS boolean
LANGUAGE sql
VOLATILE
SET search_path = public
AS $$
  SELECT pg_try_advisory_lock(hashtextextended(p_key, 0));
$$;

CREATE OR REPLACE FUNCTION public.release_sync_lock(p_key text)
RETURNS boolean
LANGUAGE sql
VOLATILE
SET search_path = public
AS $$
  SELECT pg_advisory_unlock(hashtextextended(p_key, 0));
$$;
