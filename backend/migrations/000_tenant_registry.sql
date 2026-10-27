-- Run against the central/registry database before deploying the custom-domain resolver.
-- Safe to re-run: creates missing registry objects without deleting or rewriting business data.
BEGIN;
CREATE SCHEMA IF NOT EXISTS app;

CREATE TABLE IF NOT EXISTS app.tenant_databases (
  tenant_id uuid PRIMARY KEY REFERENCES public.businesses(id) ON DELETE CASCADE,
  database_name text NOT NULL UNIQUE
    CHECK (database_name ~ '^biz_[a-f0-9]{24}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- The central registry needs its own domain table. Tenant databases also have
-- this table, but the public host resolver always reads from the central DB.
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
CREATE INDEX IF NOT EXISTS idx_domains_tenant
  ON public.business_domains (tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_domains_one_primary
  ON public.business_domains (tenant_id) WHERE is_primary;

CREATE OR REPLACE FUNCTION app.resolve_tenant_by_domain(p_host text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT d.tenant_id
  FROM public.business_domains d
  JOIN public.businesses b ON b.id = d.tenant_id
  WHERE d.domain = lower(p_host)
    AND d.is_verified
    AND b.status = 'active'
$function$;

GRANT USAGE ON SCHEMA app TO app_runtime, app_superadmin;
GRANT SELECT ON app.tenant_databases TO app_runtime, app_superadmin;
GRANT INSERT, UPDATE, DELETE ON app.tenant_databases TO app_superadmin;
REVOKE ALL ON FUNCTION app.resolve_tenant_by_domain(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.resolve_tenant_by_domain(text) TO app_runtime, app_superadmin;

COMMIT;
