-- Manual waitlist entries are separate from CRM leads and calendar reservations.
CREATE TABLE IF NOT EXISTS public.waitlist_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  customer_name text NOT NULL CHECK (char_length(customer_name) BETWEEN 1 AND 100),
  customer_phone text NOT NULL CHECK (char_length(customer_phone) BETWEEN 8 AND 20),
  service_ids uuid[] NOT NULL CHECK (cardinality(service_ids) BETWEEN 1 AND 20),
  service_names text[] NOT NULL CHECK (cardinality(service_names) BETWEEN 1 AND 20),\n  CONSTRAINT waitlist_service_arrays_match CHECK (cardinality(service_ids) = cardinality(service_names)),
  preferred_date date NOT NULL,
  preferred_time_from time,
  preferred_time_to time,
  note text CHECK (note IS NULL OR char_length(note) <= 500),
  status text NOT NULL DEFAULT 'waiting'
    CHECK (status IN ('waiting', 'contacted', 'scheduled', 'closed', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT waitlist_time_range_pair CHECK (
    (preferred_time_from IS NULL AND preferred_time_to IS NULL)
    OR (preferred_time_from IS NOT NULL AND preferred_time_to IS NOT NULL
        AND preferred_time_to > preferred_time_from)
  )
);

-- Prevent duplicate active requests for the same phone/date/time range.
CREATE UNIQUE INDEX IF NOT EXISTS uq_waitlist_active_request
  ON public.waitlist_entries (
    tenant_id, customer_phone, service_ids, preferred_date,
    COALESCE(preferred_time_from, TIME '00:00'),
    COALESCE(preferred_time_to, TIME '00:00')
  )
  WHERE status IN ('waiting', 'contacted');

CREATE INDEX IF NOT EXISTS idx_waitlist_tenant_created
  ON public.waitlist_entries (tenant_id, created_at DESC);

ALTER TABLE public.waitlist_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.waitlist_entries FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.waitlist_entries;
CREATE POLICY tenant_isolation ON public.waitlist_entries
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.waitlist_entries TO app_runtime;
