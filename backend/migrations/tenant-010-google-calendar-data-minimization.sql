-- Minimize Google Calendar payloads: service and appointment time only.
-- Remove customer phone and other unnecessary fields from queued historical jobs.
UPDATE public.google_calendar_sync_jobs
   SET payload = payload - ARRAY['customer_phone', 'source', 'status']
 WHERE payload ?| ARRAY['customer_phone', 'source', 'status'];

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
      'start_at', appointment_row.start_at,
      'end_at', appointment_row.end_at
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
