DO $push_schema$
DECLARE
  v_tenant_one uuid := '00000000-0000-0000-0000-000000000101';
  v_tenant_two uuid := '00000000-0000-0000-0000-000000000102';
  v_table text;
BEGIN
  IF (SELECT count(*) FROM public.push_settings) <> 2 THEN
    RAISE EXCEPTION 'Push settings defaults must be created for every existing tenant';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.push_settings
     WHERE seller_enabled IS DISTINCT FROM true OR customer_enabled IS DISTINCT FROM true
  ) THEN
    RAISE EXCEPTION 'Seller and customer Push must be enabled by default';
  END IF;
  FOREACH v_table IN ARRAY ARRAY[
    'push_settings', 'push_subscriptions', 'push_booking_capabilities',
    'push_consents', 'push_device_consents', 'push_outbox', 'push_deliveries'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = v_table
        AND c.relrowsecurity AND c.relforcerowsecurity
    ) THEN
      RAISE EXCEPTION 'RLS and FORCE RLS must be enabled on %', v_table;
    END IF;
    IF NOT has_table_privilege('app_runtime', 'public.' || v_table, 'SELECT')
       OR NOT has_table_privilege('app_runtime', 'public.' || v_table, 'INSERT')
       OR NOT has_table_privilege('app_runtime', 'public.' || v_table, 'UPDATE') THEN
      RAISE EXCEPTION 'app_runtime privileges are incomplete on %', v_table;
    END IF;
  END LOOP;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.push_booking_capabilities'::regclass
       AND contype = 'f'
       AND confrelid = 'public.push_subscriptions'::regclass
  ) THEN
    RAISE EXCEPTION 'a booking capability must bind to at most one Push subscription';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.push_device_consents'::regclass
       AND contype = 'f'
       AND confrelid = 'public.push_subscriptions'::regclass
  ) THEN
    RAISE EXCEPTION 'device consent must be scoped to a subscription in the same tenant';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public' AND indexname = 'idx_push_outbox_pending'
  ) THEN
    RAISE EXCEPTION 'pending outbox index is missing';
  END IF;
END
$push_schema$;

-- Verify tenant-local visibility using the same setting contract as withTenant.
BEGIN;
SET ROLE app_runtime;
SELECT set_config('app.current_tenant', '00000000-0000-0000-0000-000000000101', true);
DO $push_rls$
BEGIN
  IF (SELECT count(*) FROM public.push_settings) <> 1 THEN
    RAISE EXCEPTION 'tenant one must see exactly one Push settings row';
  END IF;
  BEGIN
    INSERT INTO public.push_settings (tenant_id) VALUES ('00000000-0000-0000-0000-000000000102');
    RAISE EXCEPTION 'cross-tenant Push settings write unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END
$push_rls$;
ROLLBACK;
