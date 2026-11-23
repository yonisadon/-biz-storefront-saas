CREATE ROLE app_runtime NOLOGIN;
CREATE SCHEMA app;

CREATE OR REPLACE FUNCTION app.current_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $function$
  SELECT nullif(current_setting('app.current_tenant', true), '')::uuid
$function$;

CREATE TABLE public.businesses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL
);

INSERT INTO public.businesses (id, name) VALUES
  ('00000000-0000-0000-0000-000000000101', 'Tenant One'),
  ('00000000-0000-0000-0000-000000000102', 'Tenant Two');
