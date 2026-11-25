import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveContactOptions, resolveLeadRoute, validateContactOptions } from '../src/crmRouting';

test('legacy global settings map to the new product and service settings', () => {
  const config = { order_flow: { whatsapp_enabled: true, site_inquiry_enabled: true } };
  assert.deepEqual(resolveContactOptions(config, true), {
    products: { whatsapp_enabled: true, crm_enabled: true },
    services: { calendar_enabled: true, whatsapp_enabled: true, crm_enabled: true },
  });
});

test('legacy free-datetime services map to calendar-enabled services for waitlist migration', () => {
  const config = { order_flow: { whatsapp_enabled: false }, crm_enabled: true };
  assert.equal(resolveContactOptions(config, true).services.calendar_enabled, true);
  assert.equal(resolveContactOptions(config, false).services.calendar_enabled, false);
});

test('product CRM enables website inquiry and records WhatsApp when enabled', () => {
  const config = { contact_options: {
    products: { whatsapp_enabled: true, crm_enabled: true },
    services: { calendar_enabled: false, whatsapp_enabled: true, crm_enabled: false },
  } };
  assert.deepEqual(resolveLeadRoute(config, 'site', 'products'), {
    options: config.contact_options, routeEnabled: true, createLead: true,
  });
  assert.equal(resolveLeadRoute(config, 'whatsapp', 'products').createLead, true);
});

test('product WhatsApp can operate without CRM', () => {
  const config = { contact_options: {
    products: { whatsapp_enabled: true, crm_enabled: false },
    services: { calendar_enabled: false, whatsapp_enabled: true, crm_enabled: false },
  } };
  const whatsapp = resolveLeadRoute(config, 'whatsapp', 'products');
  assert.equal(whatsapp.routeEnabled, true);
  assert.equal(whatsapp.createLead, false);
  const site = resolveLeadRoute(config, 'site', 'products');
  assert.equal(site.routeEnabled, false);
  assert.equal(site.createLead, false);
});

test('service reservation and WhatsApp use service CRM independently of product CRM', () => {
  const config = { contact_options: {
    products: { whatsapp_enabled: false, crm_enabled: true },
    services: { calendar_enabled: true, whatsapp_enabled: true, crm_enabled: false },
  } };
  const reserve = resolveLeadRoute(config, 'reserve', 'services');
  assert.equal(reserve.routeEnabled, true);
  assert.equal(reserve.createLead, false);
  const whatsapp = resolveLeadRoute(config, 'whatsapp', 'services');
  assert.equal(whatsapp.routeEnabled, true);
  assert.equal(whatsapp.createLead, false);
});

test('service CRM records all enabled service actions', () => {
  const config = { contact_options: {
    products: { whatsapp_enabled: false, crm_enabled: true },
    services: { calendar_enabled: true, whatsapp_enabled: true, crm_enabled: true },
  } };
  assert.equal(resolveLeadRoute(config, 'reserve', 'services').createLead, true);
  assert.equal(resolveLeadRoute(config, 'whatsapp', 'services').createLead, true);
});

test('invalid contact settings cannot leave a domain without a customer route', () => {
  assert.deepEqual(validateContactOptions({ contact_options: {
    products: { whatsapp_enabled: false, crm_enabled: false },
    services: { calendar_enabled: false, whatsapp_enabled: false, crm_enabled: true },
  } }), [
    'products require WhatsApp or CRM website inquiry',
    'services require calendar reservation or WhatsApp',
  ]);
  assert.deepEqual(validateContactOptions({ contact_options: {
    products: { whatsapp_enabled: true, crm_enabled: false },
    services: { calendar_enabled: true, whatsapp_enabled: false, crm_enabled: false },
  } }), []);
});
