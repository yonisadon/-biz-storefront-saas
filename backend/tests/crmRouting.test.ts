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

test('calendar reservations remain available with CRM and both contact routes disabled', () => {
  const config = {
    crm_enabled: false,
    order_flow: {
      whatsapp_enabled: false,
      site_inquiry_enabled: false,
      whatsapp_crm_enabled: false,
    },
  };
  const booking = resolveLeadRoute(config, 'site', { bookingMode: 'availability' });
  assert.equal(booking.routeEnabled, true);
  assert.equal(booking.createLead, false);

  const ordinarySiteInquiry = resolveLeadRoute(config, 'site', { bookingMode: 'none' });
  assert.equal(ordinarySiteInquiry.routeEnabled, false);
  assert.equal(ordinarySiteInquiry.createLead, false);

  const freeDatetimeRequest = resolveLeadRoute(config, 'site', { bookingMode: 'free_datetime' });
  assert.equal(freeDatetimeRequest.routeEnabled, false);
  assert.equal(freeDatetimeRequest.createLead, false);
});

test('calendar-only exception does not bypass a disabled WhatsApp route', () => {
  const config = {
    crm_enabled: false,
    order_flow: { whatsapp_enabled: false, site_inquiry_enabled: false },
  };
  const whatsapp = resolveLeadRoute(config, 'whatsapp', { bookingMode: 'availability' });
  assert.equal(whatsapp.routeEnabled, false);
  assert.equal(whatsapp.createLead, false);
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
  assert.equal(route.createLead, false);
});
