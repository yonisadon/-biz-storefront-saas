CREATE ROLE app_runtime NOLOGIN;
CREATE SCHEMA app;

CREATE OR REPLACE FUNCTION app.current_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $function$
  SELECT nullif(current_setting('app.current_tenant', true), '')::uuid
$function$;

GRANT USAGE ON SCHEMA app TO app_runtime;
GRANT EXECUTE ON FUNCTION app.current_tenant_id() TO app_runtime;

CREATE TABLE public.businesses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL
);

INSERT INTO public.businesses (id, name) VALUES
  ('00000000-0000-0000-0000-000000000101', 'Tenant One'),
  ('00000000-0000-0000-0000-000000000102', 'Tenant Two');

CREATE TABLE public.media_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  storage_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
