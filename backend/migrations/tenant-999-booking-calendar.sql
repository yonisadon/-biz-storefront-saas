-- Booking calendar foundation. This migration is deliberately additive and safe to rerun.
-- Existing appointment requests are preserved as free_datetime requests; they do not
-- become reserved calendar entries just because the calendar feature is introduced.

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS booking_mode text;
UPDATE public.products
   SET booking_mode = CASE
     WHEN kind = 'service' AND requires_appointment THEN 'free_datetime'
     ELSE 'none'
   END
 WHERE booking_mode IS NULL
    OR (booking_mode = 'none' AND kind = 'service' AND requires_appointment);
ALTER TABLE public.products ALTER COLUMN booking_mode SET DEFAULT 'none';
ALTER TABLE public.products ALTER COLUMN booking_mode SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.products'::regclass
       AND conname = 'products_booking_mode_check'
  ) THEN
    ALTER TABLE public.products
      ADD CONSTRAINT products_booking_mode_check
      CHECK (booking_mode IN ('none', 'free_datetime', 'availability'));
  END IF;
END $$;

ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS idempotency_key uuid;
CREATE UNIQUE INDEX IF NOT EXISTS uq_leads_tenant_idempotency
  ON public.leads (tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.appointments (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  lead_id        uuid,
  service_id     uuid,
  service_name   text NOT NULL CHECK (length(btrim(service_name)) > 0),
  customer_phone app.il_phone NOT NULL,
  start_at       timestamptz NOT NULL,
  end_at         timestamptz NOT NULL,
  source          text NOT NULL CHECK (source IN ('website', 'manual')),
  status          text NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved', 'cancelled')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (end_at > start_at),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, lead_id),
  FOREIGN KEY (tenant_id, lead_id)
    REFERENCES public.leads (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, service_id)
    REFERENCES public.products (tenant_id, id) ON DELETE SET NULL (service_id),
  CONSTRAINT appointments_no_reserved_overlap
    EXCLUDE USING gist (tstzrange(start_at, end_at, '[)') WITH &&)
    WHERE (status = 'reserved')
);

CREATE TABLE IF NOT EXISTS public.appointment_blocks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  start_at    timestamptz NOT NULL,
  end_at      timestamptz NOT NULL,
  reason      text CHECK (reason IS NULL OR length(btrim(reason)) <= 300),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (end_at > start_at),
  UNIQUE (tenant_id, id)
);

CREATE INDEX IF NOT EXISTS idx_appointments_tenant_start
  ON public.appointments (tenant_id, start_at) WHERE status = 'reserved';
CREATE INDEX IF NOT EXISTS idx_appointments_tenant_lead
  ON public.appointments (tenant_id, lead_id) WHERE lead_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_appointment_blocks_tenant_start
  ON public.appointment_blocks (tenant_id, start_at);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['appointments','appointment_blocks']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON public.%I FOR ALL TO app_runtime
         USING (tenant_id = app.current_tenant_id())
         WITH CHECK (tenant_id = app.current_tenant_id())', t);
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%1$s_updated_at ON public.%1$I', t);
    EXECUTE format(
      'CREATE TRIGGER trg_%1$s_updated_at BEFORE UPDATE ON public.%1$I
         FOR EACH ROW EXECUTE FUNCTION app.set_updated_at()', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.appointments TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.appointment_blocks TO app_runtime;
