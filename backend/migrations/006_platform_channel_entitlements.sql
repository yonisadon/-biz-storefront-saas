BEGIN;

CREATE TABLE IF NOT EXISTS public.platform_channel_entitlements (
  tenant_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('push', 'whatsapp', 'sms')),
  enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  PRIMARY KEY (tenant_id, channel)
);

-- Existing businesses receive Push by default. Future channels remain disabled
-- until they are implemented and explicitly granted by the Super Admin.
INSERT INTO public.platform_channel_entitlements (tenant_id, channel, enabled)
SELECT b.id, channels.channel, channels.enabled
  FROM public.businesses b
 CROSS JOIN (VALUES ('push'::text, true), ('whatsapp'::text, false), ('sms'::text, false))
   AS channels(channel, enabled)
ON CONFLICT (tenant_id, channel) DO NOTHING;

CREATE OR REPLACE FUNCTION app.create_default_channel_entitlements()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  INSERT INTO public.platform_channel_entitlements (tenant_id, channel, enabled)
  VALUES
    (NEW.id, 'push', true),
    (NEW.id, 'whatsapp', false),
    (NEW.id, 'sms', false)
  ON CONFLICT (tenant_id, channel) DO NOTHING;
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS trg_business_default_channel_entitlements ON public.businesses;
CREATE TRIGGER trg_business_default_channel_entitlements
AFTER INSERT ON public.businesses
FOR EACH ROW EXECUTE FUNCTION app.create_default_channel_entitlements();

REVOKE ALL ON FUNCTION app.create_default_channel_entitlements() FROM PUBLIC;
GRANT SELECT ON public.platform_channel_entitlements TO app_runtime, app_superadmin;
GRANT INSERT, UPDATE ON public.platform_channel_entitlements TO app_superadmin;

COMMIT;
