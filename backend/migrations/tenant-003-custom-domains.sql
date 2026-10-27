-- Additive, idempotent custom-domain schema for existing and newly provisioned tenant DBs.
-- No existing rows are updated or removed.
CREATE TABLE IF NOT EXISTS public.business_domains (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  domain text NOT NULL UNIQUE
    CHECK (domain = lower(domain)
      AND domain ~ '^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$'),
  is_verified boolean NOT NULL DEFAULT false,
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_business_domains_tenant
  ON public.business_domains (tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_business_domains_one_primary
  ON public.business_domains (tenant_id) WHERE is_primary;
GRANT SELECT ON public.business_domains TO app_runtime;
