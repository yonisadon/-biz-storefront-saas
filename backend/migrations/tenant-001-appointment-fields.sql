-- Align existing tenant databases with the current lead and appointment API.
-- These changes are additive/relaxing and preserve all existing rows.
-- Safe to run repeatedly; migration history is recorded by tenantMigrations.ts.
ALTER TABLE public.leads
  ALTER COLUMN customer_name DROP NOT NULL,
  ALTER COLUMN customer_phone DROP NOT NULL;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS requires_appointment boolean NOT NULL DEFAULT false;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS appointment_duration_minutes smallint NOT NULL DEFAULT 30;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'products_appointment_duration_minutes_check'
       AND conrelid = 'public.products'::regclass
  ) THEN
    ALTER TABLE public.products
      ADD CONSTRAINT products_appointment_duration_minutes_check
      CHECK (appointment_duration_minutes IN (15, 30, 45, 60, 90, 120, 180, 240));
  END IF;
END $$;
