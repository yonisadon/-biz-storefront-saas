import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveCrmSettings, resolveLeadRoute } from '../src/crmRouting';

test('legacy tenant settings keep CRM and WhatsApp tracking enabled by default', () => {
  const config = { order_flow: { whatsapp_enabled: true, site_inquiry_enabled: true } };
  assert.deepEqual(resolveCrmSettings(config), {
    crmEnabled: true,
    whatsappEnabled: true,
    siteInquiryEnabled: true,
    whatsappCrmEnabled: true,
  });
  assert.equal(resolveLeadRoute(config, 'whatsapp').createLead, true);
});

test('WhatsApp can be direct without creating a CRM lead', () => {
  const config = {
    crm_enabled: true,
    order_flow: {
      whatsapp_enabled: true,
      site_inquiry_enabled: true,
      whatsapp_crm_enabled: false,
    },
  };
  const route = resolveLeadRoute(config, 'whatsapp');
  assert.equal(route.routeEnabled, true);
  assert.equal(route.createLead, false);
  assert.equal(resolveLeadRoute(config, 'site').createLead, true);
});

test('disabling CRM blocks site inquiries but keeps direct WhatsApp available', () => {
  const config = {
    crm_enabled: false,
    order_flow: {
      whatsapp_enabled: true,
      site_inquiry_enabled: true,
      whatsapp_crm_enabled: true,
    },
  };
  const whatsapp = resolveLeadRoute(config, 'whatsapp');
  assert.equal(whatsapp.routeEnabled, true);
  assert.equal(whatsapp.createLead, false);
  const site = resolveLeadRoute(config, 'site');
  assert.equal(site.routeEnabled, false);
  assert.equal(site.createLead, false);
});

test('WhatsApp tracking does not enable a disabled WhatsApp route', () => {
  const route = resolveLeadRoute({
    order_flow: {
      whatsapp_enabled: false,
      site_inquiry_enabled: true,
      whatsapp_crm_enabled: true,
    },
  }, 'whatsapp');
  assert.equal(route.routeEnabled, false);
  assert.equal(route.createLead, true);
});
