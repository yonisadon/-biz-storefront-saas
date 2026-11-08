-- CRM-independent website reservations need their own retry protection.
-- Existing appointments remain valid; only newly supplied idempotency keys are unique.
ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS idempotency_key uuid;
CREATE UNIQUE INDEX IF NOT EXISTS uq_appointments_tenant_idempotency
  ON public.appointments (tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;