import test from 'node:test';
import assert from 'node:assert/strict';
import { ProductCreate, ProductPatch } from '../src/catalogSchemas';
import { LeadInput } from '../src/schemas';

test('legacy appointment flag maps to free datetime when booking mode is omitted', () => {
  const parsed = ProductCreate.parse({ kind: 'service', name: 'Test service', requires_appointment: true });
  assert.equal(parsed.requires_appointment, true);
  assert.equal(parsed.booking_mode, undefined);
});

test('catalog schemas accept the three explicit booking modes', () => {
  for (const booking_mode of ['none', 'free_datetime', 'availability'] as const) {
    const created = ProductCreate.parse({ kind: 'service', name: 'Test service', booking_mode });
    assert.equal(created.booking_mode, booking_mode);
    const patched = ProductPatch.parse({ booking_mode });
    assert.equal(patched.booking_mode, booking_mode);
  }
});

test('products may not be given an unknown booking mode', () => {
  assert.throws(() => ProductCreate.parse({ kind: 'service', name: 'Test service', booking_mode: 'automatic' }));
});

test('site inquiries require a phone but not a customer name', () => {
  const parsed = LeadInput.parse({
    route: 'site',
    customer_phone: '0501234567',
    items: [{ product_id: '00000000-0000-4000-8000-000000000001', quantity: 1 }],
  });
  assert.equal(parsed.customer_name, undefined);
  assert.ok(parsed.customer_phone);
});

test('a site inquiry without a phone is rejected', () => {
  assert.throws(() => LeadInput.parse({
    route: 'site',
    items: [{ product_id: '00000000-0000-4000-8000-000000000001', quantity: 1 }],
  }));
});
