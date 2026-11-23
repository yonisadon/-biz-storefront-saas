BEGIN;

CREATE TABLE IF NOT EXISTS public.push_settings (
  tenant_id uuid PRIMARY KEY REFERENCES public.businesses(id) ON DELETE CASCADE,
  seller_enabled boolean NOT NULL DEFAULT true,
  customer_enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.push_settings (tenant_id)
SELECT id FROM public.businesses
ON CONFLICT (tenant_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  audience text NOT NULL CHECK (audience IN ('seller', 'customer')),
  endpoint_hash bytea NOT NULL CHECK (octet_length(endpoint_hash) = 32),
  endpoint_ciphertext text NOT NULL,
  p256dh_ciphertext text NOT NULL,
  auth_ciphertext text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  disabled_at timestamptz,
  UNIQUE (tenant_id, audience, endpoint_hash),
  UNIQUE (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS public.push_booking_capabilities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  target_type text NOT NULL CHECK (target_type IN ('appointment', 'waitlist')),
  target_id uuid NOT NULL,
  token_hash bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
  subscription_id uuid,
  expires_at timestamptz NOT NULL,
  opted_in_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, target_type, target_id),
  FOREIGN KEY (tenant_id, subscription_id)
    REFERENCES public.push_subscriptions (tenant_id, id) ON DELETE SET NULL (subscription_id)
);

CREATE TABLE IF NOT EXISTS public.push_consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  target_type text NOT NULL CHECK (target_type IN ('appointment', 'waitlist')),
  target_id uuid NOT NULL,
  subscription_id uuid NOT NULL,
  consented_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  FOREIGN KEY (tenant_id, subscription_id)
    REFERENCES public.push_subscriptions (tenant_id, id) ON DELETE CASCADE,
  UNIQUE (tenant_id, target_type, target_id, subscription_id)
);

CREATE TABLE IF NOT EXISTS public.push_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  audience text NOT NULL CHECK (audience IN ('seller', 'customer')),
  event_type text NOT NULL CHECK (event_type IN (
    'seller.appointment_created',
    'seller.waitlist_created',
    'customer.waitlist_scheduled',
    'customer.appointment_updated',
    'customer.appointment_cancelled'
  )),
  target_type text NOT NULL CHECK (target_type IN ('appointment', 'waitlist')),
  target_id uuid NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload) = 'object'),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'done')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  locked_until timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  UNIQUE (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS public.push_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  outbox_id uuid NOT NULL,
  subscription_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'sent', 'failed', 'invalid')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  locked_until timestamptz,
  provider_status_code integer,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  FOREIGN KEY (tenant_id, outbox_id)
    REFERENCES public.push_outbox (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, subscription_id)
    REFERENCES public.push_subscriptions (tenant_id, id) ON DELETE CASCADE,
  UNIQUE (tenant_id, outbox_id, subscription_id)
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_active
  ON public.push_subscriptions (tenant_id, audience, created_at)
  WHERE disabled_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_push_consents_target
  ON public.push_consents (tenant_id, target_type, target_id)
  WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_push_outbox_pending
  ON public.push_outbox (next_attempt_at, created_at)
  WHERE status IN ('pending', 'processing');
CREATE INDEX IF NOT EXISTS idx_push_deliveries_pending
  ON public.push_deliveries (next_attempt_at, created_at)
  WHERE status IN ('pending', 'processing');

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'push_settings', 'push_subscriptions', 'push_booking_capabilities',
    'push_consents', 'push_outbox', 'push_deliveries'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON public.%I FOR ALL TO app_runtime
         USING (tenant_id = app.current_tenant_id())
         WITH CHECK (tenant_id = app.current_tenant_id())', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.push_settings,
  public.push_subscriptions,
  public.push_booking_capabilities,
  public.push_consents,
  public.push_outbox,
  public.push_deliveries
TO app_runtime;

COMMIT;
