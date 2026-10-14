-- Optional preferred appointment time per service. Existing products remain non-appointment items.
BEGIN;
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS requires_appointment boolean NOT NULL DEFAULT false;
COMMIT;
