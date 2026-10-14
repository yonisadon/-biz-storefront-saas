-- Seller-configurable duration for appointment-based services.
-- Safe to run even if the appointment flag migration has already been applied.
BEGIN;
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS requires_appointment boolean NOT NULL DEFAULT false;
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS appointment_duration_minutes smallint NOT NULL DEFAULT 30;
ALTER TABLE public.products
  DROP CONSTRAINT IF EXISTS products_appointment_duration_minutes_check;
ALTER TABLE public.products
  ADD CONSTRAINT products_appointment_duration_minutes_check
  CHECK (appointment_duration_minutes IN (15, 30, 45, 60, 90, 120, 180, 240));
COMMIT;
