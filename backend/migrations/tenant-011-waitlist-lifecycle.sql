-- BTime waitlist and retention lifecycle.
ALTER TABLE public.waitlist_entries
  ALTER COLUMN customer_name DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS appointment_id uuid;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='waitlist_entries' AND column_name='preferred_time_from')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='waitlist_entries' AND column_name='preferred_time') THEN
    ALTER TABLE public.waitlist_entries RENAME COLUMN preferred_time_from TO preferred_time;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='waitlist_entries' AND column_name='preferred_time_to') THEN
    ALTER TABLE public.waitlist_entries DROP COLUMN preferred_time_to;
  END IF;
END $$;
ALTER TABLE public.waitlist_entries DROP CONSTRAINT IF EXISTS waitlist_time_range_pair, DROP CONSTRAINT IF EXISTS waitlist_entries_status_check;
UPDATE public.waitlist_entries SET status = CASE status WHEN 'contacted' THEN 'waiting' WHEN 'scheduled' THEN 'closed' WHEN 'cancelled' THEN 'rejected' ELSE status END;
ALTER TABLE public.waitlist_entries ADD CONSTRAINT waitlist_entries_status_check CHECK (status IN ('waiting', 'rejected', 'closed', 'scheduled_without_booking'));
DROP INDEX IF EXISTS public.uq_waitlist_active_request;
CREATE UNIQUE INDEX IF NOT EXISTS uq_waitlist_active_request ON public.waitlist_entries (tenant_id, customer_phone, service_ids, preferred_date, COALESCE(preferred_time, TIME '00:00')) WHERE status = 'waiting';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.waitlist_entries'::regclass AND conname = 'waitlist_entries_tenant_appointment_fkey') THEN
    ALTER TABLE public.waitlist_entries ADD CONSTRAINT waitlist_entries_tenant_appointment_fkey FOREIGN KEY (tenant_id, appointment_id) REFERENCES public.appointments (tenant_id, id) ON DELETE SET NULL (appointment_id);
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS uq_waitlist_tenant_appointment ON public.waitlist_entries (tenant_id, appointment_id) WHERE appointment_id IS NOT NULL;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS status_changed_at timestamptz NOT NULL DEFAULT now();
UPDATE public.leads SET retention_closed_at = COALESCE(retention_closed_at, now()), retention_expires_at = COALESCE(retention_closed_at, now()) + interval '24 hours' WHERE status IN ('rejected', 'cancelled', 'completed');
CREATE OR REPLACE FUNCTION app.set_lead_retention_deadline() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status IN ('rejected', 'cancelled', 'completed') THEN
      NEW.retention_closed_at := COALESCE(NEW.retention_closed_at, now());
      NEW.retention_expires_at := COALESCE(NEW.retention_expires_at, NEW.retention_closed_at + interval '24 hours');
    ELSE
      NEW.retention_expires_at := COALESCE(NEW.retention_expires_at, NEW.created_at + interval '60 days');
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.retention_closed_at IS NULL AND NEW.status IN ('rejected', 'cancelled', 'completed') THEN
    NEW.retention_closed_at := now();
    NEW.retention_expires_at := NEW.retention_closed_at + interval '24 hours';
  ELSIF NEW.retention_expires_at IS NULL THEN
    NEW.retention_expires_at := NEW.created_at + interval '60 days';
  END IF;
  RETURN NEW;
END;
$$;