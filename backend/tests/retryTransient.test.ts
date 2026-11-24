import assert from 'node:assert/strict';
import { test } from 'node:test';
import { retryTransientOperation } from '../src/retryTransient';

test('retryTransientOperation returns immediately when the database is ready', async () => {
  let calls = 0;
  const result = await retryTransientOperation(async () => {
    calls += 1;
    return 'ready';
  }, 'test', 2);
  assert.equal(result, 'ready');
  assert.equal(calls, 1);
});

test('retryTransientOperation retries a transient database startup error', async () => {
  let calls = 0;
  const result = await retryTransientOperation(async () => {
    calls += 1;
    if (calls === 1) throw Object.assign(new Error('database starting'), { code: '57P03' });
    return 'ready';
  }, 'test', 2);
  assert.equal(result, 'ready');
  assert.equal(calls, 2);
});

test('retryTransientOperation does not retry non-transient errors', async () => {
  let calls = 0;
  await assert.rejects(() => retryTransientOperation(async () => {
    calls += 1;
    throw Object.assign(new Error('bad query'), { code: '42601' });
  }, 'test', 3));
  assert.equal(calls, 1);
});
