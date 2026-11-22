-- Replace hard-coded per-tenant retention deadlines with central platform policies.
-- Keep event timestamps for the current open/closed cycle; the cleanup worker calculates
-- expiry from the current plan policy instead of storing a stale deadline.
DROP TRIGGER IF EXISTS trg_leads_retention_deadline ON public.leads;
DROP FUNCTION IF EXISTS app.set_lead_retention_deadline();
DROP INDEX IF EXISTS public.idx_leads_retention_expires;

ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS retention_opened_at timestamptz;

-- Preserve the previous effective open deadline (including any legacy grace
-- period or a prior reopen) before dropping the old deadline column.
UPDATE public.leads
   SET retention_closed_at = COALESCE(retention_closed_at, now()),
       retention_opened_at = NULL
 WHERE status IN ('rejected', 'cancelled', 'completed');

UPDATE public.leads
   SET retention_opened_at = COALESCE(
     retention_opened_at,
     retention_expires_at - interval '60 days',
     created_at
   )
 WHERE status NOT IN ('rejected', 'cancelled', 'completed');

CREATE INDEX IF NOT EXISTS idx_leads_retention_opened_at
  ON public.leads (retention_opened_at)
  WHERE retention_opened_at IS NOT NULL;

ALTER TABLE public.leads DROP COLUMN IF EXISTS retention_expires_at;
DROP TABLE IF EXISTS public.crm_retention_policy;

CREATE OR REPLACE FUNCTION app.set_lead_retention_closed_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status IN ('rejected', 'cancelled', 'completed') THEN
      NEW.retention_closed_at := COALESCE(NEW.retention_closed_at, now());
      NEW.retention_opened_at := NULL;
    ELSE
      NEW.retention_opened_at := COALESCE(NEW.retention_opened_at, NEW.created_at, now());
      NEW.retention_closed_at := NULL;
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status IN ('rejected', 'cancelled', 'completed') THEN
    IF OLD.status NOT IN ('rejected', 'cancelled', 'completed') THEN
      NEW.retention_closed_at := now();
    END IF;
    NEW.retention_opened_at := NULL;
  ELSE
    IF OLD.status IN ('rejected', 'cancelled', 'completed') THEN
      NEW.retention_opened_at := now();
    ELSE
      NEW.retention_opened_at := COALESCE(NEW.retention_opened_at, OLD.retention_opened_at, NEW.created_at, now());
    END IF;
    NEW.retention_closed_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_leads_retention_closed_at ON public.leads;
CREATE TRIGGER trg_leads_retention_closed_at
BEFORE INSERT OR UPDATE OF status ON public.leads
FOR EACH ROW EXECUTE FUNCTION app.set_lead_retention_closed_at();
