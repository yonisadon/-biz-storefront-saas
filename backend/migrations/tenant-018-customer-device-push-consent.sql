-- Customer Push consent is scoped to one device subscription and one business.
-- Existing push_consents remain target-scoped so legacy opt-ins are not broadened.
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
