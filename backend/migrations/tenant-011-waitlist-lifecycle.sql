-- Waitlist lifecycle: optional customer name and a tenant-safe link to a real calendar appointment.
-- Additive and safe to rerun. Existing waitlist rows and names are preserved.
ALTER TABLE public.waitlist_entries
  ALTER COLUMN customer_name DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS appointment_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.waitlist_entries'::regclass
       AND conname = 'waitlist_entries_tenant_appointment_fkey'
  ) THEN
    ALTER TABLE public.waitlist_entries
      ADD CONSTRAINT waitlist_entries_tenant_appointment_fkey
      FOREIGN KEY (tenant_id, appointment_id)
      REFERENCES public.appointments (tenant_id, id)
      ON DELETE SET NULL (appointment_id);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_waitlist_tenant_appointment
  ON public.waitlist_entries (tenant_id, appointment_id)
  WHERE appointment_id IS NOT NULL;
