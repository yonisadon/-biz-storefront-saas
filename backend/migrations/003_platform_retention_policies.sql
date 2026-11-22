BEGIN;

CREATE TABLE IF NOT EXISTS public.platform_retention_policies (
  plan_code text NOT NULL CHECK (plan_code IN ('standard', 'plus')),
  record_type text NOT NULL CHECK (record_type IN ('lead', 'appointment', 'waitlist')),
  record_status text NOT NULL,
  delete_enabled boolean NOT NULL,
  retention_days integer,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by_user_id uuid REFERENCES public.platform_users(id) ON DELETE SET NULL,
  PRIMARY KEY (plan_code, record_type, record_status),
  CONSTRAINT platform_retention_policy_status_valid CHECK (
    (record_type = 'lead' AND record_status IN ('open', 'closed'))
    OR (record_type = 'appointment' AND record_status IN ('reserved', 'cancelled'))
    OR (record_type = 'waitlist' AND record_status IN ('waiting', 'rejected', 'closed', 'scheduled_without_booking'))
  ),
  CONSTRAINT platform_retention_policy_days_valid CHECK (
    (delete_enabled AND retention_days IS NOT NULL AND retention_days BETWEEN 1 AND 3650)
    OR (NOT delete_enabled AND retention_days IS NULL)
  )
);

INSERT INTO public.platform_retention_policies
  (plan_code, record_type, record_status, delete_enabled, retention_days)
VALUES
  ('standard', 'lead', 'open', true, 60),
  ('standard', 'lead', 'closed', true, 30),
  ('standard', 'appointment', 'reserved', true, 1),
  ('standard', 'appointment', 'cancelled', true, 1),
  ('standard', 'waitlist', 'waiting', true, 1),
  ('standard', 'waitlist', 'rejected', true, 1),
  ('standard', 'waitlist', 'closed', true, 1),
  ('standard', 'waitlist', 'scheduled_without_booking', true, 1),
  ('plus', 'lead', 'open', false, NULL),
  ('plus', 'lead', 'closed', false, NULL),
  ('plus', 'appointment', 'reserved', false, NULL),
  ('plus', 'appointment', 'cancelled', false, NULL),
  ('plus', 'waitlist', 'waiting', false, NULL),
  ('plus', 'waitlist', 'rejected', false, NULL),
  ('plus', 'waitlist', 'closed', false, NULL),
  ('plus', 'waitlist', 'scheduled_without_booking', false, NULL)
ON CONFLICT (plan_code, record_type, record_status) DO NOTHING;

CREATE OR REPLACE FUNCTION app.get_tenant_plan_code(p_tenant_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT CASE
    WHEN COALESCE((SELECT s.plan_code FROM public.platform_subscriptions s WHERE s.tenant_id = p_tenant_id), 'standard') = 'standard' THEN 'standard'
    WHEN COALESCE((SELECT s.plan_code FROM public.platform_subscriptions s WHERE s.tenant_id = p_tenant_id), 'standard') = 'plus' THEN 'plus'
    ELSE 'plus'
  END
$function$;

REVOKE ALL ON public.platform_retention_policies FROM PUBLIC, app_runtime;
GRANT SELECT ON public.platform_retention_policies TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.platform_retention_policies TO app_superadmin;
REVOKE ALL ON FUNCTION app.get_tenant_plan_code(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.get_tenant_plan_code(uuid) TO app_runtime, app_superadmin;

COMMIT;
