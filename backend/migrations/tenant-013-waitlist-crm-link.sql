-- Link waitlist requests to CRM records without coupling their lifecycles.
ALTER TABLE public.waitlist_entries
  ADD COLUMN IF NOT EXISTS lead_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.waitlist_entries'::regclass
       AND conname = 'waitlist_entries_tenant_lead_fkey'
  ) THEN
    ALTER TABLE public.waitlist_entries
      ADD CONSTRAINT waitlist_entries_tenant_lead_fkey
      FOREIGN KEY (tenant_id, lead_id)
      REFERENCES public.leads (tenant_id, id)
      ON DELETE SET NULL (lead_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_waitlist_tenant_lead
  ON public.waitlist_entries (tenant_id, lead_id)
  WHERE lead_id IS NOT NULL;
