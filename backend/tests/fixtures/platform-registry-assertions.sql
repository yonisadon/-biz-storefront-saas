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


-- Consent history is present and isolated from public runtime access.
DO $$
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
END
$$;


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
