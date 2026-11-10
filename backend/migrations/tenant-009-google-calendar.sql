-- Optional one-way BTime -> Google Calendar integration.
CREATE TABLE IF NOT EXISTS public.google_calendar_connections (
  tenant_id uuid PRIMARY KEY REFERENCES public.businesses(id) ON DELETE CASCADE,
  google_email text NOT NULL,
  access_token_encrypted text NOT NULL,
  refresh_token_encrypted text NOT NULL,
  access_token_expires_at timestamptz,
  calendar_id text NOT NULL DEFAULT 'primary',
  connected_at timestamptz NOT NULL DEFAULT now(),
  last_sync_at timestamptz,
  last_error text
);

CREATE TABLE IF NOT EXISTS public.google_calendar_oauth_states (
  state_hash text PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  code_verifier_encrypted text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.google_calendar_sync_jobs (
  tenant_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  appointment_id uuid NOT NULL,
  operation text NOT NULL CHECK (operation IN ('upsert', 'delete')),
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'failed', 'synced')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  last_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, appointment_id)
);

CREATE INDEX IF NOT EXISTS idx_google_calendar_jobs_pending
  ON public.google_calendar_sync_jobs (tenant_id, next_attempt_at, created_at)
  WHERE status IN ('pending', 'failed', 'processing');

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'google_calendar_connections',
    'google_calendar_oauth_states',
    'google_calendar_sync_jobs'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON public.%I', table_name);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON public.%I USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id())',
      table_name
    );
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.google_calendar_connections TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.google_calendar_oauth_states TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.google_calendar_sync_jobs TO app_runtime;

CREATE OR REPLACE FUNCTION app.enqueue_google_calendar_sync_job()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  appointment_row public.appointments%ROWTYPE;
  operation_name text;
  payload_value jsonb;
BEGIN
  IF TG_OP = 'DELETE' THEN
    appointment_row := OLD;
    operation_name := 'delete';
  ELSE
    appointment_row := NEW;
    operation_name := CASE WHEN NEW.status = 'reserved' THEN 'upsert' ELSE 'delete' END;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.google_calendar_connections
     WHERE tenant_id = appointment_row.tenant_id
  ) THEN
    payload_value := jsonb_build_object(
      'service_name', appointment_row.service_name,
      'customer_phone', appointment_row.customer_phone,
      'start_at', appointment_row.start_at,
      'end_at', appointment_row.end_at,
      'source', appointment_row.source,
      'status', appointment_row.status
    );

    INSERT INTO public.google_calendar_sync_jobs
      (tenant_id, appointment_id, operation, payload, status, attempts, next_attempt_at, last_error, updated_at)
    VALUES
      (appointment_row.tenant_id, appointment_row.id, operation_name, payload_value, 'pending', 0, now(), NULL, now())
    ON CONFLICT (tenant_id, appointment_id) DO UPDATE
      SET operation = EXCLUDED.operation,
          payload = EXCLUDED.payload,
          status = 'pending',
          attempts = 0,
          next_attempt_at = now(),
          last_error = NULL,
          updated_at = now();
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_google_calendar_appointment_sync ON public.appointments;
CREATE TRIGGER trg_google_calendar_appointment_sync
AFTER INSERT OR UPDATE OR DELETE ON public.appointments
FOR EACH ROW EXECUTE FUNCTION app.enqueue_google_calendar_sync_job();
