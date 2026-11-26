-- Convert legacy global contact flags and per-service booking modes to business-level options.
-- Legacy free_datetime is mapped to calendar_enabled so the new waitlist path remains available.
UPDATE public.businesses b
   SET config = jsonb_set(
     COALESCE(b.config, '{}'::jsonb),
     '{contact_options}',
     jsonb_build_object(
       'products', jsonb_build_object(
         'whatsapp_enabled', COALESCE((b.config #>> '{order_flow,whatsapp_enabled}')::boolean, false),
         'crm_enabled', COALESCE((b.config ->> 'crm_enabled')::boolean, true)
          OR NOT COALESCE((b.config #>> '{order_flow,whatsapp_enabled}')::boolean, false)
       ),
       'services', jsonb_build_object(
         'calendar_enabled',
           (
             COALESCE(b.config ->> 'site_mode', 'catalog_order') <> 'services_whatsapp'
             AND (
               EXISTS (
                 SELECT 1 FROM public.products p
                  WHERE p.tenant_id = b.id AND p.kind = 'service'
                    AND COALESCE(p.booking_mode, CASE WHEN p.requires_appointment THEN 'free_datetime' ELSE 'none' END) <> 'none'
               )
               OR (
                 COALESCE((b.config #>> '{order_flow,site_inquiry_enabled}')::boolean, false)
                 AND EXISTS (SELECT 1 FROM public.products p WHERE p.tenant_id = b.id AND p.kind = 'service' AND p.is_active)
               )
             )
           )
           OR NOT COALESCE((b.config #>> '{order_flow,whatsapp_enabled}')::boolean, false),
         'whatsapp_enabled', COALESCE((b.config #>> '{order_flow,whatsapp_enabled}')::boolean, false),
         'crm_enabled', COALESCE((b.config ->> 'crm_enabled')::boolean, true)
       )
     ),
     true
   )
 WHERE NOT (COALESCE(b.config, '{}'::jsonb) ? 'contact_options');
