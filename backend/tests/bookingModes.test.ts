import test from 'node:test';
import assert from 'node:assert/strict';
import { ProductCreate, ProductPatch } from '../src/catalogSchemas';
import { LeadInput } from '../src/schemas';

const productId = '00000000-0000-4000-8000-000000000001';

test('service duration remains per service without a booking mode', () => {
  const parsed = ProductCreate.parse({ kind: 'service', name: 'Test service', appointment_duration_minutes: 45 });
  assert.equal(parsed.appointment_duration_minutes, 45);
  assert.equal('booking_mode' in parsed, false);
  assert.equal('requires_appointment' in parsed, false);
});

test('catalog schemas reject retired per-service booking fields', () => {
  assert.throws(() => ProductCreate.parse({ kind: 'service', name: 'Test service', booking_mode: 'availability' }));
  assert.throws(() => ProductCreate.parse({ kind: 'service', name: 'Test service', requires_appointment: true }));
  assert.equal(ProductPatch.parse({ appointment_duration_minutes: 60 }).appointment_duration_minutes, 60);
});

test('site product inquiries require a phone but not a customer name', () => {
  const parsed = LeadInput.parse({
    route: 'site',
    customer_phone: '0501234567',
    items: [{ product_id: productId, quantity: 1 }],
  });
  assert.equal(parsed.customer_name, undefined);
  assert.ok(parsed.customer_phone);
});

test('a site inquiry without a phone is rejected', () => {
  assert.throws(() => LeadInput.parse({
    route: 'site',
    items: [{ product_id: productId, quantity: 1 }],
  }));
});

test('service reservations require a phone, selected time and idempotency key', () => {
  const parsed = LeadInput.parse({
    route: 'reserve',
    customer_phone: '0501234567',
    appointment_at: '2026-12-01T10:30',
    idempotency_key: '00000000-0000-4000-8000-000000000002',
    items: [{ product_id: productId, quantity: 1 }],
  });
  assert.equal(parsed.route, 'reserve');
  assert.ok(parsed.customer_phone);
  assert.throws(() => LeadInput.parse({
    route: 'reserve',
    appointment_at: '2026-12-01T10:30',
    idempotency_key: '00000000-0000-4000-8000-000000000002',
    items: [{ product_id: productId, quantity: 1 }],
  }));
  assert.throws(() => LeadInput.parse({
    route: 'reserve',
    customer_phone: '0501234567',
    items: [{ product_id: productId, quantity: 1 }],
  }));
});

test('WhatsApp requests do not require a phone or appointment time', () => {
  const parsed = LeadInput.parse({
    route: 'whatsapp',
    items: [{ product_id: productId, quantity: 1 }],
  });
  assert.equal(parsed.customer_phone, undefined);
  assert.equal(parsed.appointment_at, undefined);
});
