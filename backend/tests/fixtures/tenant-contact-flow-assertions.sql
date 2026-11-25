DO $$
DECLARE
  opts jsonb;
BEGIN
  IF to_regprocedure('app.sync_product_booking_mode()') IS NOT NULL THEN
    RAISE EXCEPTION 'legacy booking trigger function was not retired';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.products'::regclass AND tgname='trg_products_booking_mode' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'legacy booking trigger was not retired';
  END IF;

  SELECT config->'contact_options' INTO opts FROM public.businesses
   WHERE id='00000000-0000-0000-0000-000000000101';
  IF opts #>> '{products,whatsapp_enabled}' <> 'true'
     OR opts #>> '{products,crm_enabled}' <> 'false'
     OR opts #>> '{services,calendar_enabled}' <> 'true' THEN
    RAISE EXCEPTION 'legacy booking/WhatsApp mapping failed for tenant 101: %', opts;
  END IF;

  SELECT config->'contact_options' INTO opts FROM public.businesses
   WHERE id='00000000-0000-0000-0000-000000000102';
  IF opts #>> '{products,crm_enabled}' <> 'true'
     OR opts #>> '{services,calendar_enabled}' <> 'true' THEN
    RAISE EXCEPTION 'fallback customer routes were not enabled for tenant 102: %', opts;
  END IF;

  SELECT config->'contact_options' INTO opts FROM public.businesses
   WHERE id='00000000-0000-0000-0000-000000000103';
  IF opts #>> '{services,calendar_enabled}' <> 'true' THEN
    RAISE EXCEPTION 'legacy site-only service inquiry did not map to calendar: %', opts;
  END IF;
END $$;

INSERT INTO public.leads (id, tenant_id) VALUES
  ('20000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000101'),
  ('20000000-0000-0000-0000-000000000102','00000000-0000-0000-0000-000000000101');

INSERT INTO public.appointments (id, tenant_id, lead_id) VALUES
  ('30000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000101','20000000-0000-0000-0000-000000000101'),
  ('30000000-0000-0000-0000-000000000102','00000000-0000-0000-0000-000000000101','20000000-0000-0000-0000-000000000102');

INSERT INTO public.waitlist_entries (id, tenant_id, lead_id, appointment_id) VALUES
  ('40000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000101','20000000-0000-0000-0000-000000000101','30000000-0000-0000-0000-000000000101'),
  ('40000000-0000-0000-0000-000000000102','00000000-0000-0000-0000-000000000101','20000000-0000-0000-0000-000000000102','30000000-0000-0000-0000-000000000102');

DELETE FROM public.leads WHERE id='20000000-0000-0000-0000-000000000101';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.appointments WHERE id='30000000-0000-0000-0000-000000000101' AND lead_id IS NULL) THEN
    RAISE EXCEPTION 'deleting CRM lead deleted or retained stale appointment link';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.waitlist_entries WHERE id='40000000-0000-0000-0000-000000000101' AND lead_id IS NULL AND appointment_id='30000000-0000-0000-0000-000000000101') THEN
    RAISE EXCEPTION 'deleting CRM lead did not preserve waitlist and appointment';
  END IF;
END $$;

DELETE FROM public.appointments WHERE id='30000000-0000-0000-0000-000000000101';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.waitlist_entries WHERE id='40000000-0000-0000-0000-000000000101' AND appointment_id IS NULL) THEN
    RAISE EXCEPTION 'deleting appointment did not preserve and detach waitlist';
  END IF;
END $$;

DELETE FROM public.waitlist_entries WHERE id='40000000-0000-0000-0000-000000000102';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.leads WHERE id='20000000-0000-0000-0000-000000000102') OR
     NOT EXISTS (SELECT 1 FROM public.appointments WHERE id='30000000-0000-0000-0000-000000000102') THEN
    RAISE EXCEPTION 'deleting waitlist deleted CRM or appointment';
  END IF;
END $$;
