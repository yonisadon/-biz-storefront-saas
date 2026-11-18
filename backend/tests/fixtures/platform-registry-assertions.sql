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
