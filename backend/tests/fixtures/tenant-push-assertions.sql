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
    'push_settings', 'push_subscriptions', 'push_target_link_capabilities',
    'push_subscription_targets', 'push_device_consents', 'push_outbox', 'push_deliveries'
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
  IF to_regclass('public.push_booking_capabilities') IS NOT NULL
     OR to_regclass('public.push_consents') IS NOT NULL THEN
    RAISE EXCEPTION 'legacy per-booking consent table names must be retired';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'push_target_link_capabilities' AND column_name = 'linked_at'
  ) OR EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'push_target_link_capabilities' AND column_name = 'opted_in_at'
  ) THEN
    RAISE EXCEPTION 'target-link capability must use linked_at rather than per-booking consent terminology';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.push_target_link_capabilities'::regclass
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
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public' AND indexname = 'idx_push_outbox_processed_at'
  ) THEN
    RAISE EXCEPTION 'completed Push history retention index is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'media_assets' AND column_name = 'deleted_at'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_media_assets_pending_deletion'
  ) THEN
    RAISE EXCEPTION 'durable media deletion tracking column/index is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_appointment_blocks_time_range'
  ) THEN
    RAISE EXCEPTION 'appointment block range overlap index is missing';
  END IF;
END
$push_schema$;

-- A pending deletion keeps the storage key durable until the object is removed.
DO $media_deletion$
DECLARE
  v_asset uuid;
  v_tenant uuid := '00000000-0000-0000-0000-000000000101';
BEGIN
  INSERT INTO public.media_assets (tenant_id, storage_key, deleted_at)
  VALUES (v_tenant, v_tenant::text || '/asset.jpg', now())
  RETURNING id INTO v_asset;
  IF NOT EXISTS (
    SELECT 1 FROM public.media_assets
     WHERE id = v_asset AND tenant_id = v_tenant AND deleted_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'media deletion intent must remain durable in the database';
  END IF;
  DELETE FROM public.media_assets WHERE id = v_asset AND deleted_at IS NOT NULL;
  IF EXISTS (SELECT 1 FROM public.media_assets WHERE id = v_asset) THEN
    RAISE EXCEPTION 'media asset row should be finalized only after successful storage deletion';
  END IF;
END
$media_deletion$;

-- Completed events older than retention are removed with their deliveries;
-- pending events and events with a pending/processing delivery are preserved.
DO $push_retention$
DECLARE
  v_tenant uuid := '00000000-0000-0000-0000-000000000101';
  v_subscription uuid;
  v_expired_done uuid;
  v_expired_pending uuid;
  v_expired_with_pending_delivery uuid;
  v_deleted integer;
BEGIN
  INSERT INTO public.push_subscriptions
    (tenant_id, audience, endpoint_hash, endpoint_ciphertext, p256dh_ciphertext, auth_ciphertext)
  VALUES
    (v_tenant, 'customer', decode(repeat('a', 64), 'hex'), 'endpoint', 'p256dh', 'auth')
  RETURNING id INTO v_subscription;

  INSERT INTO public.push_outbox
    (tenant_id, audience, event_type, target_type, target_id, status, processed_at)
  VALUES
    (v_tenant, 'customer', 'customer.appointment_updated', 'appointment',
     '00000000-0000-0000-0000-000000000201', 'done', now() - interval '31 days')
  RETURNING id INTO v_expired_done;

  INSERT INTO public.push_outbox
    (tenant_id, audience, event_type, target_type, target_id, status, processed_at)
  VALUES
    (v_tenant, 'customer', 'customer.appointment_updated', 'appointment',
     '00000000-0000-0000-0000-000000000202', 'pending', now() - interval '31 days')
  RETURNING id INTO v_expired_pending;

  INSERT INTO public.push_outbox
    (tenant_id, audience, event_type, target_type, target_id, status, processed_at)
  VALUES
    (v_tenant, 'customer', 'customer.appointment_updated', 'appointment',
     '00000000-0000-0000-0000-000000000203', 'done', now() - interval '31 days')
  RETURNING id INTO v_expired_with_pending_delivery;

  INSERT INTO public.push_deliveries
    (tenant_id, outbox_id, subscription_id, status)
  VALUES
    (v_tenant, v_expired_with_pending_delivery, v_subscription, 'pending');

  DELETE FROM public.push_outbox o
   WHERE o.tenant_id = v_tenant
     AND o.status = 'done'
     AND o.processed_at <= now() - interval '30 days'
     AND NOT EXISTS (
       SELECT 1 FROM public.push_deliveries d
        WHERE d.tenant_id = o.tenant_id AND d.outbox_id = o.id
          AND d.status IN ('pending', 'processing')
     );
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  IF v_deleted <> 1
     OR EXISTS (SELECT 1 FROM public.push_outbox WHERE id = v_expired_done)
     OR NOT EXISTS (SELECT 1 FROM public.push_outbox WHERE id = v_expired_pending)
     OR NOT EXISTS (SELECT 1 FROM public.push_outbox WHERE id = v_expired_with_pending_delivery)
     OR EXISTS (SELECT 1 FROM public.push_deliveries WHERE outbox_id = v_expired_done) THEN
    RAISE EXCEPTION 'Push retention must delete only expired completed events and cascade their delivery history';
  END IF;
END
$push_retention$;

-- Bulk delivery creation remains idempotent even if the subscription input contains duplicates
-- or the same outbox event is retried.
DO $push_bulk_deliveries$
DECLARE
  v_tenant uuid := '00000000-0000-0000-0000-000000000101';
  v_subscription uuid;
  v_event uuid;
  v_count integer;
BEGIN
  INSERT INTO public.push_subscriptions
    (tenant_id, audience, endpoint_hash, endpoint_ciphertext, p256dh_ciphertext, auth_ciphertext)
  VALUES
    (v_tenant, 'seller', decode(repeat('b', 64), 'hex'), 'endpoint-bulk', 'p256dh', 'auth')
  RETURNING id INTO v_subscription;

  INSERT INTO public.push_outbox
    (tenant_id, audience, event_type, target_type, target_id, status)
  VALUES
    (v_tenant, 'seller', 'seller.appointment_created', 'appointment',
     '00000000-0000-0000-0000-000000000204', 'pending')
  RETURNING id INTO v_event;

  INSERT INTO public.push_deliveries (tenant_id, outbox_id, subscription_id)
  SELECT v_tenant, v_event, selected.subscription_id
    FROM (SELECT DISTINCT unnest(ARRAY[v_subscription, v_subscription]::uuid[]) AS subscription_id) selected
  ON CONFLICT (tenant_id, outbox_id, subscription_id) DO NOTHING;

  INSERT INTO public.push_deliveries (tenant_id, outbox_id, subscription_id)
  SELECT v_tenant, v_event, selected.subscription_id
    FROM (SELECT DISTINCT unnest(ARRAY[v_subscription]::uuid[]) AS subscription_id) selected
  ON CONFLICT (tenant_id, outbox_id, subscription_id) DO NOTHING;

  SELECT count(*)::int INTO v_count FROM public.push_deliveries
   WHERE tenant_id = v_tenant AND outbox_id = v_event;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'bulk Push delivery creation must remain idempotent and deduplicate subscriptions';
  END IF;
END
$push_bulk_deliveries$;

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
