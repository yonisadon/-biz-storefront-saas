import test from 'node:test';
import assert from 'node:assert/strict';
import { hasUniqueServiceIds, isValidCalendarDate, isValidWaitlistTimeRange } from '../src/waitlistRules';

test('waitlist date validation accepts valid dates and rejects impossible calendar dates', () => {
  assert.equal(isValidCalendarDate('2026-11-10'), true);
  assert.equal(isValidCalendarDate('2024-02-29'), true);
  assert.equal(isValidCalendarDate('2026-02-29'), false);
  assert.equal(isValidCalendarDate('2026-13-01'), false);
  assert.equal(isValidCalendarDate('10-11-2026'), false);
});

test('waitlist time range accepts no preference or a valid increasing range', () => {
  assert.equal(isValidWaitlistTimeRange(), true);
  assert.equal(isValidWaitlistTimeRange('09:00', '11:30'), true);
  assert.equal(isValidWaitlistTimeRange('09:00', undefined), false);
  assert.equal(isValidWaitlistTimeRange(undefined, '11:30'), false);
  assert.equal(isValidWaitlistTimeRange('11:30', '09:00'), false);
  assert.equal(isValidWaitlistTimeRange('25:00', '26:00'), false);
});

test('waitlist service selection rejects duplicate service identifiers', () => {
  assert.equal(hasUniqueServiceIds(['a', 'b']), true);
  assert.equal(hasUniqueServiceIds(['a', 'a']), false);
  assert.equal(hasUniqueServiceIds([]), true);
});
