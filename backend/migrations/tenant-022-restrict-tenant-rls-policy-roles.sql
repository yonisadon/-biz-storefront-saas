-- Restrict existing waitlist and Google Calendar tenant policies to the runtime role.
-- Their previous default PUBLIC target still checked tenant_id, but was broader than needed.
DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'waitlist_entries',
    'google_calendar_connections',
    'google_calendar_oauth_states',
    'google_calendar_sync_jobs'
  ] LOOP
    IF to_regclass(format('public.%I', table_name)) IS NULL THEN
      RAISE EXCEPTION 'Required tenant table public.% is missing; refusing to weaken/skip RLS postflight.', table_name;
    END IF;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON public.%I', table_name);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON public.%I FOR ALL TO app_runtime USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id())',
      table_name
    );
  END LOOP;
END $$;
