-- Keep CRM leads and appointments independent.
-- Deleting a lead must only detach the appointment's optional technical link.
DO $$
DECLARE
  current_definition text;
BEGIN
  SELECT pg_get_constraintdef(oid)
    INTO current_definition
    FROM pg_constraint
   WHERE conrelid = 'public.appointments'::regclass
     AND conname = 'appointments_tenant_id_lead_id_fkey'
     AND contype = 'f';

  IF current_definition IS NOT NULL
     AND current_definition NOT LIKE '%ON DELETE SET NULL (lead_id)%' THEN
    ALTER TABLE public.appointments
      DROP CONSTRAINT appointments_tenant_id_lead_id_fkey;
    current_definition := NULL;
  END IF;

  IF current_definition IS NULL THEN
    ALTER TABLE public.appointments
      ADD CONSTRAINT appointments_tenant_id_lead_id_fkey
      FOREIGN KEY (tenant_id, lead_id)
      REFERENCES public.leads (tenant_id, id)
      ON DELETE SET NULL (lead_id);
  END IF;
END $$;
