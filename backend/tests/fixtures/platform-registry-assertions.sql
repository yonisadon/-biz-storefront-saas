DO $$
DECLARE
  v_legacy uuid := gen_random_uuid();
  v_expired uuid := gen_random_uuid();
  v_admin_request uuid;
BEGIN
  IF has_table_privilege('app_runtime', 'public.platform_users', 'SELECT') THEN
    RAISE EXCEPTION 'app_runtime must not read platform_users';
  END IF;
  IF NOT has_table_privilege('app_superadmin', 'public.platform_users', 'SELECT') THEN
    RAISE EXCEPTION 'app_superadmin must be able to read platform_users';
  END IF;
  IF NOT has_function_privilege('app_runtime', 'app.resolve_tenant_by_slug(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'app_runtime must execute tenant resolver';
  END IF;

  IF (SELECT count(*) FROM public.platform_retention_policies) <> 16 THEN
    RAISE EXCEPTION 'expected 16 default retention policy rows';
  END IF;
  IF NOT has_table_privilege('app_runtime', 'public.platform_retention_policies', 'SELECT') THEN
    RAISE EXCEPTION 'app_runtime must read retention policies';
  END IF;
  IF has_table_privilege('app_runtime', 'public.platform_retention_policies', 'UPDATE') THEN
    RAISE EXCEPTION 'app_runtime must not change retention policies';
  END IF;
  IF NOT has_function_privilege('app_runtime', 'app.get_tenant_plan_code(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'app_runtime must read a tenant plan code through the restricted function';
  END IF;
  IF app.get_tenant_plan_code(v_legacy) <> 'standard' THEN
    RAISE EXCEPTION 'legacy businesses without a subscription must use standard retention policy';
  END IF;
  IF (SELECT count(*) FROM public.platform_retention_policies
       WHERE plan_code = 'plus' AND delete_enabled) <> 0 THEN
    RAISE EXCEPTION 'Plus defaults must not automatically delete records';
  END IF;

  INSERT INTO public.businesses (id, slug, name, status)
  VALUES (v_legacy, 'legacy-test', 'Legacy test', 'active');
  IF app.is_tenant_subscription_accessible(v_legacy) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'legacy businesses without a subscription must remain accessible when active';
  END IF;

  INSERT INTO public.businesses (id, slug, name, status)
  VALUES (v_expired, 'expired-test', 'Expired test', 'active');
  INSERT INTO public.platform_subscriptions (tenant_id, status, trial_started_at, trial_ends_at)
  VALUES (v_expired, 'trialing', now() - interval '31 days', now() - interval '1 day');
  IF app.is_tenant_subscription_accessible(v_expired) IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'expired trial must be inaccessible';
  END IF;

  INSERT INTO public.business_deletion_requests
    (tenant_id, business_name, business_slug, requested_by_admin, reason)
  VALUES
    (v_legacy, 'Legacy test', 'legacy-test', true, 'admin initiated')
  RETURNING id INTO v_admin_request;

  IF NOT EXISTS (
    SELECT 1 FROM public.business_deletion_requests
     WHERE id = v_admin_request
       AND requested_by_user_id IS NULL
       AND requested_by_admin = true
       AND database_name IS NULL
       AND storage_keys = '[]'::jsonb
  ) THEN
    RAISE EXCEPTION 'admin-originated deletion request was not persisted correctly';
  END IF;
END $$;



-- A completed deletion cannot be recorded without a verified backup reference.
DO $$
BEGIN
  BEGIN
    UPDATE public.business_deletion_requests
       SET status = 'completed'
     WHERE business_name = 'Legacy test' AND business_slug = 'legacy-test';
    RAISE EXCEPTION 'deletion without verified backup unexpectedly completed';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
END
$$;

-- Consent history is present and isolated from public runtime access.
DO $consent_permissions$
BEGIN
  IF to_regclass('public.platform_user_consents') IS NULL THEN
    RAISE EXCEPTION 'platform_user_consents table is missing';
  END IF;
  IF has_table_privilege('app_runtime', 'public.platform_user_consents', 'SELECT') THEN
    RAISE EXCEPTION 'app_runtime must not read platform consent history';
  END IF;
  IF NOT has_table_privilege('app_superadmin', 'public.platform_user_consents', 'INSERT') THEN
    RAISE EXCEPTION 'app_superadmin must be able to write platform consent history';
  END IF;
  IF has_table_privilege('app_superadmin', 'public.platform_user_consents', 'UPDATE')
     OR has_table_privilege('app_superadmin', 'public.platform_user_consents', 'DELETE') THEN
    RAISE EXCEPTION 'consent history must be append-only for app_superadmin';
  END IF;
  IF has_table_privilege('app_runtime', 'public.platform_user_consents', 'INSERT')
     OR has_table_privilege('app_runtime', 'public.platform_user_consents', 'UPDATE')
     OR has_table_privilege('app_runtime', 'public.platform_user_consents', 'DELETE') THEN
    RAISE EXCEPTION 'app_runtime must not modify platform consent history';
  END IF;
END
$consent_permissions$;

-- The registry stores separate, append-only decisions for each marketing channel.
DO $consent_fixture$
DECLARE
  v_user uuid;
  v_email_latest boolean;
  v_sms_latest boolean;
  v_email_events integer;
BEGIN
  INSERT INTO public.platform_users (email, phone, password_hash)
  VALUES ('consent-fixture@example.test', '+972501234567', repeat('x', 64))
  RETURNING id INTO v_user;

  INSERT INTO public.platform_user_consents
    (user_id, consent_type, granted, consent_version, source, recorded_at)
  VALUES
    (v_user, 'terms_of_use', true, 'test-v1', 'registration', now() - interval '1 minute'),
    (v_user, 'privacy_policy', true, 'test-v1', 'registration', now() - interval '1 minute'),
    (v_user, 'marketing_email', false, 'test-v1', 'registration', now() - interval '1 minute'),
    (v_user, 'marketing_sms', false, 'test-v1', 'registration', now() - interval '1 minute'),
    (v_user, 'marketing_email', true, 'test-v1', 'account_settings', now());

  SELECT granted INTO v_email_latest FROM public.platform_user_consents
   WHERE user_id = v_user AND consent_type = 'marketing_email'
   ORDER BY recorded_at DESC, id DESC LIMIT 1;
  SELECT granted INTO v_sms_latest FROM public.platform_user_consents
   WHERE user_id = v_user AND consent_type = 'marketing_sms'
   ORDER BY recorded_at DESC, id DESC LIMIT 1;
  SELECT count(*) INTO v_email_events FROM public.platform_user_consents
   WHERE user_id = v_user AND consent_type = 'marketing_email';

  IF v_email_latest IS DISTINCT FROM true OR v_sms_latest IS DISTINCT FROM false OR v_email_events <> 2 THEN
    RAISE EXCEPTION 'independent consent changes must preserve append-only history';
  END IF;
END
$consent_fixture$;


-- Destructive deletion must retain an auditable backup verification reference.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'business_deletion_requests'
       AND column_name = 'backup_verified_at'
  ) THEN RAISE EXCEPTION 'backup_verified_at column is missing'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'business_deletion_requests'
       AND column_name = 'backup_reference'
  ) THEN RAISE EXCEPTION 'backup_reference column is missing'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'business_deletion_requests'
       AND column_name = 'backup_verified_by'
  ) THEN RAISE EXCEPTION 'backup_verified_by column is missing'; END IF;
END
$$;


DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'business_deletion_completed_requires_backup') THEN
    RAISE EXCEPTION 'completed deletion must require backup verification';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'business_deletion_backup_reference_length') THEN
    RAISE EXCEPTION 'backup reference length constraint is missing';
  END IF;
END
$$;
