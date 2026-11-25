export type LeadRoute = 'whatsapp' | 'site' | 'reserve';
export type ContactDomain = 'products' | 'services';

export type ContactOptions = {
  products: { whatsapp_enabled: boolean; crm_enabled: boolean };
  services: { calendar_enabled: boolean; whatsapp_enabled: boolean; crm_enabled: boolean };
};

type ConfigShape = {
  crm_enabled?: unknown;
  site_mode?: unknown;
  order_flow?: {
    whatsapp_enabled?: unknown;
    site_inquiry_enabled?: unknown;
  };
  contact_options?: Partial<ContactOptions>;
};

function asConfig(value: unknown): ConfigShape {
  return value && typeof value === 'object' ? value as ConfigShape : {};
}

/**
 * Resolve the new business-level contact model. When contact_options is absent,
 * derive a safe legacy mapping until the tenant migration/settings save runs.
 * Legacy free_datetime is treated as a calendar-enabled service so its former
 * date-request path is replaced by the new waitlist + reservation choices.
 */
export function resolveContactOptions(value: unknown, legacyCalendarServices = false): ContactOptions {
  const config = asConfig(value);
  const stored = config.contact_options;
  if (stored && typeof stored === 'object' && stored.products && stored.services) {
    return {
      products: {
        whatsapp_enabled: stored.products.whatsapp_enabled === true,
        crm_enabled: stored.products.crm_enabled === true,
      },
      services: {
        calendar_enabled: stored.services.calendar_enabled === true,
        whatsapp_enabled: stored.services.whatsapp_enabled === true,
        crm_enabled: stored.services.crm_enabled === true,
      },
    };
  }

  const flow = config.order_flow ?? {};
  const legacyCrm = config.crm_enabled !== false;
  const legacyWhatsapp = flow.whatsapp_enabled === true;
  const legacyCalendarAllowed = config.site_mode !== 'services_whatsapp';
  return {
    products: { whatsapp_enabled: legacyWhatsapp, crm_enabled: legacyCrm },
    services: {
      calendar_enabled: legacyCalendarAllowed && legacyCalendarServices,
      whatsapp_enabled: legacyWhatsapp,
      crm_enabled: legacyCrm,
    },
  };
}

export function validateContactOptions(value: unknown): string[] {
  const config = asConfig(value);
  const options = config.contact_options as ContactOptions | undefined;
  if (!options?.products || !options?.services) return ['contact_options is required'];
  const booleans = [
    options.products.whatsapp_enabled, options.products.crm_enabled,
    options.services.calendar_enabled, options.services.whatsapp_enabled, options.services.crm_enabled,
  ];
  if (booleans.some((entry) => typeof entry !== 'boolean')) return ['contact_options values must be booleans'];
  const errors: string[] = [];
  if (!options.products.whatsapp_enabled && !options.products.crm_enabled) {
    errors.push('products require WhatsApp or CRM website inquiry');
  }
  if (!options.services.calendar_enabled && !options.services.whatsapp_enabled) {
    errors.push('services require calendar reservation or WhatsApp');
  }
  return errors;
}

export function resolveLeadRoute(
  value: unknown,
  route: LeadRoute,
  domain: ContactDomain,
  legacyCalendarServices = false,
) {
  const options = resolveContactOptions(value, legacyCalendarServices);
  const settings = options[domain];
  const routeEnabled = domain === 'products'
    ? (route === 'whatsapp' ? settings.whatsapp_enabled : route === 'site' && settings.crm_enabled)
    : (route === 'whatsapp' ? settings.whatsapp_enabled : route === 'reserve' && settings.calendar_enabled);
  return {
    options,
    routeEnabled,
    createLead: settings.crm_enabled,
  };
}
