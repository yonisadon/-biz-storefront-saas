export type LeadRoute = 'whatsapp' | 'site';

type ConfigShape = {
  crm_enabled?: unknown;
  order_flow?: {
    whatsapp_enabled?: unknown;
    site_inquiry_enabled?: unknown;
    whatsapp_crm_enabled?: unknown;
  };
};

function asConfig(value: unknown): ConfigShape {
  return value && typeof value === 'object' ? value as ConfigShape : {};
}

/** Missing flags deliberately preserve legacy behavior for existing tenants. */
export function resolveCrmSettings(value: unknown) {
  const config = asConfig(value);
  const flow = config.order_flow ?? {};
  const crmEnabled = config.crm_enabled !== false;
  return {
    crmEnabled,
    whatsappEnabled: flow.whatsapp_enabled === true,
    siteInquiryEnabled: crmEnabled && flow.site_inquiry_enabled === true,
    whatsappCrmEnabled: crmEnabled && flow.whatsapp_crm_enabled !== false,
  };
}

export function resolveLeadRoute(value: unknown, route: LeadRoute) {
  const settings = resolveCrmSettings(value);
  const routeEnabled = route === 'whatsapp' ? settings.whatsappEnabled : settings.siteInquiryEnabled;
  return {
    ...settings,
    routeEnabled,
    createLead: routeEnabled && (route === 'site' ? settings.crmEnabled : settings.whatsappCrmEnabled),
  };
}
