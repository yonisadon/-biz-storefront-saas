import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeInternationalPhone } from '../src/util';

test('normalizes Israeli local account phone numbers to E.164', () => {
  assert.equal(normalizeInternationalPhone('050-123-4567'), '+972501234567');
  assert.equal(normalizeInternationalPhone('+972 50 123 4567'), '+972501234567');
});

test('accepts international phone numbers without forcing Israel country code', () => {
  assert.equal(normalizeInternationalPhone('+1 (415) 555-2671'), '+14155552671');
  assert.equal(normalizeInternationalPhone('00442079460018'), '+442079460018');
});

test('rejects invalid international phone numbers', () => {
  assert.equal(normalizeInternationalPhone('+0123456789'), null);
  assert.equal(normalizeInternationalPhone('4155552671'), null);
  assert.equal(normalizeInternationalPhone('abc'), null);
});
