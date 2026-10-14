-- Allow direct WhatsApp order handoff without asking the customer to fill a form.
-- Apply once to the existing PostgreSQL database before deploying the updated API.
BEGIN;
ALTER TABLE public.leads
  ALTER COLUMN customer_name DROP NOT NULL,
  ALTER COLUMN customer_phone DROP NOT NULL;
COMMIT;
