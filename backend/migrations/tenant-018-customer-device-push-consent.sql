-- Retire the old per-booking consent names. These rows now secure target linking only.
DO $$
BEGIN
  IF to_regclass('public.push_target_link_capabilities') IS NULL
     AND to_regclass('public.push_booking_capabilities') IS NOT NULL THEN
    ALTER TABLE public.push_booking_capabilities RENAME TO push_target_link_capabilities;
  END IF;
  IF to_regclass('public.push_subscription_targets') IS NULL
     AND to_regclass('public.push_consents') IS NOT NULL THEN
    ALTER TABLE public.push_consents RENAME TO push_subscription_targets;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'push_target_link_capabilities' AND column_name = 'opted_in_at'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'push_target_link_capabilities' AND column_name = 'linked_at'
  ) THEN
    ALTER TABLE public.push_target_link_capabilities RENAME COLUMN opted_in_at TO linked_at;
  END IF;
  IF to_regclass('public.idx_push_subscription_targets_target') IS NULL
     AND to_regclass('public.idx_push_consents_target') IS NOT NULL THEN
    ALTER INDEX public.idx_push_consents_target RENAME TO idx_push_subscription_targets_target;
  END IF;
END $$;

-- Persistent, business-scoped consent for one browser PushSubscription.
-- Existing target links are deliberately not promoted into persistent consent.
CREATE TABLE IF NOT EXISTS public.push_device_consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  subscription_id uuid NOT NULL,
  purpose text NOT NULL DEFAULT 'operational' CHECK (purpose = 'operational'),
  consented_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, subscription_id)
    REFERENCES public.push_subscriptions (tenant_id, id) ON DELETE CASCADE,
  UNIQUE (tenant_id, subscription_id)
);

CREATE INDEX IF NOT EXISTS idx_push_device_consents_active
  ON public.push_device_consents (tenant_id, subscription_id)
  WHERE revoked_at IS NULL;

ALTER TABLE public.push_device_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_device_consents FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.push_device_consents;
CREATE POLICY tenant_isolation ON public.push_device_consents
  FOR ALL TO app_runtime
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON public.push_device_consents TO app_runtime;
