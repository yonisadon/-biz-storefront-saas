BEGIN;

ALTER TABLE public.platform_retention_policies
  DROP CONSTRAINT IF EXISTS platform_retention_policies_record_type_check;
ALTER TABLE public.platform_retention_policies
  ADD CONSTRAINT platform_retention_policies_record_type_check
  CHECK (record_type IN ('lead', 'appointment', 'waitlist', 'push'));

ALTER TABLE public.platform_retention_policies
  DROP CONSTRAINT IF EXISTS platform_retention_policy_status_valid;
ALTER TABLE public.platform_retention_policies
  ADD CONSTRAINT platform_retention_policy_status_valid CHECK (
    (record_type = 'lead' AND record_status IN ('open', 'closed'))
    OR (record_type = 'appointment' AND record_status IN ('reserved', 'cancelled'))
    OR (record_type = 'waitlist' AND record_status IN ('waiting', 'rejected', 'closed', 'scheduled_without_booking'))
    OR (record_type = 'push' AND record_status = 'completed')
  );

INSERT INTO public.platform_retention_policies
  (plan_code, record_type, record_status, delete_enabled, retention_days)
VALUES
  ('standard', 'push', 'completed', true, 30),
  ('plus', 'push', 'completed', true, 30)
ON CONFLICT (plan_code, record_type, record_status) DO NOTHING;

COMMIT;