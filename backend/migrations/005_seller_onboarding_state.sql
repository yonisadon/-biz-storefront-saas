BEGIN;

-- Existing businesses predate the guided setup flow. Backfill only when the
-- column is first introduced; rerunning this migration must not mark newly
-- created, unfinished businesses as complete.
DO $onboarding_column$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'businesses'
       AND column_name = 'onboarding_completed_at'
  ) THEN
    ALTER TABLE public.businesses
      ADD COLUMN onboarding_completed_at timestamptz;
    UPDATE public.businesses
       SET onboarding_completed_at = created_at
     WHERE onboarding_completed_at IS NULL;
  END IF;
END
$onboarding_column$;

CREATE OR REPLACE FUNCTION app.get_tenant_onboarding_completed_at(p_tenant_id uuid)
RETURNS timestamptz
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT b.onboarding_completed_at
    FROM public.businesses b
   WHERE b.id = p_tenant_id
$function$;

CREATE OR REPLACE FUNCTION app.complete_tenant_onboarding(p_tenant_id uuid)
RETURNS timestamptz
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_completed_at timestamptz;
BEGIN
  UPDATE public.businesses
     SET onboarding_completed_at = COALESCE(onboarding_completed_at, now())
   WHERE id = p_tenant_id
   RETURNING onboarding_completed_at INTO v_completed_at;

  RETURN v_completed_at;
END
$function$;

REVOKE ALL ON FUNCTION app.get_tenant_onboarding_completed_at(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.complete_tenant_onboarding(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.get_tenant_onboarding_completed_at(uuid) TO app_runtime, app_superadmin;
GRANT EXECUTE ON FUNCTION app.complete_tenant_onboarding(uuid) TO app_runtime, app_superadmin;

COMMIT;
