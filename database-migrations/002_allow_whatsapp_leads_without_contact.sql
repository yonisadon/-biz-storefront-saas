-- Apply once to the existing PostgreSQL database before deploying the updated API.
-- Direct WhatsApp handoff does not ask the customer to fill a contact form.
BEGIN;
ALTER TABLE public.leads
  ALTER COLUMN customer_name DROP NOT NULL,
  ALTER COLUMN customer_phone DROP NOT NULL;
COMMIT;
