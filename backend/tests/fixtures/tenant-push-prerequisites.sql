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

CREATE TABLE public.appointment_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  CHECK (end_at > start_at)
);

-- Model the legacy broad-role policies so tenant-022 proves it narrows them.
CREATE TABLE public.waitlist_entries (id uuid PRIMARY KEY, tenant_id uuid NOT NULL);
CREATE TABLE public.google_calendar_connections (tenant_id uuid PRIMARY KEY);
CREATE TABLE public.google_calendar_oauth_states (state_hash text PRIMARY KEY, tenant_id uuid NOT NULL);
CREATE TABLE public.google_calendar_sync_jobs (tenant_id uuid NOT NULL, appointment_id uuid NOT NULL, PRIMARY KEY (tenant_id, appointment_id));
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['waitlist_entries','google_calendar_connections','google_calendar_oauth_states','google_calendar_sync_jobs'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON public.%I USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id())', t);
  END LOOP;
END $$;
