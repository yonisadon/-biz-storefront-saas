-- CRM retention deadlines and safe deletion of expired CRM records.
-- Existing records receive a one-time 30-day rollout grace (or longer if their
-- original 60-day open-record deadline is still in the future).
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS retention_closed_at timestamptz,
  ADD COLUMN IF NOT EXISTS retention_expires_at timestamptz;

UPDATE public.leads
   SET retention_closed_at = CASE
         WHEN status IN ('rejected', 'cancelled', 'completed')
           THEN COALESCE(retention_closed_at, now())
         ELSE retention_closed_at
       END,
       retention_expires_at = CASE
         WHEN status IN ('rejected', 'cancelled', 'completed')
           THEN GREATEST(COALESCE(retention_closed_at, now()) + interval '30 days', now() + interval '30 days')
         ELSE GREATEST(created_at + interval '60 days', now() + interval '30 days')
       END
 WHERE retention_expires_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_leads_retention_expires
  ON public.leads (retention_expires_at)
  WHERE retention_expires_at IS NOT NULL;

CREATE OR REPLACE FUNCTION app.set_lead_retention_deadline()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status IN ('rejected', 'cancelled', 'completed') THEN
      NEW.retention_closed_at := COALESCE(NEW.retention_closed_at, now());
      NEW.retention_expires_at := COALESCE(NEW.retention_expires_at, NEW.retention_closed_at + interval '30 days');
    ELSE
      NEW.retention_expires_at := COALESCE(NEW.retention_expires_at, NEW.created_at + interval '60 days');
    END IF;
    RETURN NEW;
  END IF;

  -- The first closure starts the 30-day period. Reopening or later status
  -- changes never reset this timestamp or extend the deadline.
  IF NEW.retention_closed_at IS NULL
     AND NEW.status IN ('rejected', 'cancelled', 'completed') THEN
    NEW.retention_closed_at := now();
    NEW.retention_expires_at := NEW.retention_closed_at + interval '30 days';
  ELSIF NEW.retention_expires_at IS NULL THEN
    NEW.retention_expires_at := NEW.created_at + interval '60 days';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_leads_retention_deadline ON public.leads;
CREATE TRIGGER trg_leads_retention_deadline
BEFORE INSERT OR UPDATE OF status ON public.leads
FOR EACH ROW EXECUTE FUNCTION app.set_lead_retention_deadline();

-- CRM lead cleanup must not erase independent calendar reservations.
ALTER TABLE public.appointments
  DROP CONSTRAINT IF EXISTS appointments_tenant_id_lead_id_fkey;
ALTER TABLE public.appointments
  ADD CONSTRAINT appointments_tenant_id_lead_id_fkey
  FOREIGN KEY (tenant_id, lead_id)
  REFERENCES public.leads (tenant_id, id)
  ON DELETE SET NULL (lead_id);
