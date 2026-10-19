-- Add appointment fields to existing tenant databases without modifying existing product data.
-- Safe to run repeatedly; migration history is recorded by tenantMigrations.ts.
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
