-- Replace hard-coded per-tenant retention deadlines with central platform policies.
-- Keep the closure timestamp as an event marker; the cleanup worker calculates
-- expiry from the current plan policy instead of storing a stale deadline.
DROP TRIGGER IF EXISTS trg_leads_retention_deadline ON public.leads;
DROP FUNCTION IF EXISTS app.set_lead_retention_deadline();
DROP INDEX IF EXISTS public.idx_leads_retention_expires;

UPDATE public.leads
   SET retention_closed_at = COALESCE(retention_closed_at, created_at)
 WHERE status IN ('rejected', 'cancelled', 'completed')
   AND retention_closed_at IS NULL;

ALTER TABLE public.leads DROP COLUMN IF EXISTS retention_expires_at;
DROP TABLE IF EXISTS public.crm_retention_policy;

CREATE OR REPLACE FUNCTION app.set_lead_retention_closed_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status IN ('rejected', 'cancelled', 'completed') THEN
    IF TG_OP = 'INSERT' THEN
      NEW.retention_closed_at := COALESCE(NEW.retention_closed_at, now());
    ELSIF OLD.status NOT IN ('rejected', 'cancelled', 'completed') THEN
      NEW.retention_closed_at := now();
    END IF;
  ELSE
    NEW.retention_closed_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_leads_retention_closed_at ON public.leads;
CREATE TRIGGER trg_leads_retention_closed_at
BEFORE INSERT OR UPDATE OF status ON public.leads
FOR EACH ROW EXECUTE FUNCTION app.set_lead_retention_closed_at();
