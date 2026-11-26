CREATE SCHEMA app;

CREATE TABLE public.businesses (
  id uuid PRIMARY KEY,
  config jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE public.products (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  kind text NOT NULL,
  booking_mode text NOT NULL DEFAULT 'none',
  requires_appointment boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true
);

CREATE TABLE public.leads (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  UNIQUE (tenant_id, id)
);

CREATE TABLE public.appointments (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  lead_id uuid,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, lead_id),
  FOREIGN KEY (tenant_id, lead_id)
    REFERENCES public.leads (tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE public.waitlist_entries (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  lead_id uuid,
  appointment_id uuid,
  preferred_time time,
  FOREIGN KEY (tenant_id, appointment_id)
    REFERENCES public.appointments (tenant_id, id) ON DELETE SET NULL (appointment_id)
);

CREATE OR REPLACE FUNCTION app.sync_product_booking_mode()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_products_booking_mode
BEFORE UPDATE OF booking_mode ON public.products
FOR EACH ROW EXECUTE FUNCTION app.sync_product_booking_mode();

INSERT INTO public.businesses (id, config) VALUES
  ('00000000-0000-0000-0000-000000000101',
   '{"crm_enabled":false,"site_mode":"catalog_order","order_flow":{"whatsapp_enabled":true,"site_inquiry_enabled":false}}'),
  ('00000000-0000-0000-0000-000000000102',
   '{"crm_enabled":false,"site_mode":"services_whatsapp","order_flow":{"whatsapp_enabled":false,"site_inquiry_enabled":false}}'),
  ('00000000-0000-0000-0000-000000000103',
   '{"crm_enabled":true,"site_mode":"catalog_order","order_flow":{"whatsapp_enabled":false,"site_inquiry_enabled":true}}');

INSERT INTO public.products (id, tenant_id, kind, booking_mode, requires_appointment, is_active) VALUES
  ('10000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000101','service','availability',true,true),
  ('10000000-0000-0000-0000-000000000102','00000000-0000-0000-0000-000000000102','service','none',false,true),
  ('10000000-0000-0000-0000-000000000103','00000000-0000-0000-0000-000000000103','service','none',false,true);
