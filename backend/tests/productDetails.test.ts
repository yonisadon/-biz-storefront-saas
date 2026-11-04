import test from 'node:test';
import assert from 'node:assert/strict';
import { ProductCreate, ProductPatch } from '../src/catalogSchemas';

test('legacy product payloads default flexible details to an empty list', () => {
  const parsed = ProductCreate.parse({ name: 'Legacy product' });
  assert.deepEqual(parsed.details, []);
});

test('product details accept generic label/value pairs', () => {
  const details = [
    { label: 'מותג', value: 'Example' },
    { label: 'חומר', value: 'פלדת אל-חלד' },
    { label: 'מידות', value: '42 מ״מ' },
  ];
  const parsed = ProductCreate.parse({ name: 'Watch', details });
  assert.deepEqual(parsed.details, details);
  assert.deepEqual(ProductPatch.parse({ details }).details, details);
});

test('product details reject empty labels, empty values and more than 20 rows', () => {
  assert.throws(() => ProductCreate.parse({ name: 'Product', details: [{ label: '', value: 'value' }] }));
  assert.throws(() => ProductCreate.parse({ name: 'Product', details: [{ label: 'label', value: '' }] }));
  const tooMany = Array.from({ length: 21 }, (_, i) => ({ label: `Field ${i}`, value: 'value' }));
  assert.throws(() => ProductCreate.parse({ name: 'Product', details: tooMany }));
});


test('product patch defaults missing details unchanged and accepts empty details array', () => {
  assert.equal(ProductPatch.parse({ name: 'Updated' }).details, undefined);
  assert.deepEqual(ProductPatch.parse({ details: [] }).details, []);
});
