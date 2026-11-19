import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchWithTransientRetry } from '../lib/transientFetch.mjs';

test('GET retries a transient response and returns the successful response', async () => {
  const statuses = [503, 200];
  const delays = [];
  const response = await fetchWithTransientRetry('https://api.example.test/me', { method: 'GET' }, async () => {
    return new Response('ok', { status: statuses.shift() });
  }, async (milliseconds) => delays.push(milliseconds));
  assert.equal(response.status, 200);
  assert.deepEqual(delays, [350]);
});

test('GET does not retry a client error', async () => {
  let calls = 0;
  const response = await fetchWithTransientRetry('https://api.example.test/me', { method: 'GET' }, async () => {
    calls += 1;
    return new Response('bad request', { status: 400 });
  }, async () => {});
  assert.equal(response.status, 400);
  assert.equal(calls, 1);
});

test('POST is never retried after a transient response', async () => {
  let calls = 0;
  const response = await fetchWithTransientRetry('https://api.example.test/business', { method: 'POST' }, async () => {
    calls += 1;
    return new Response('unavailable', { status: 503 });
  }, async () => {});
  assert.equal(response.status, 503);
  assert.equal(calls, 1);
});

test('GET retries a network error and succeeds on the next attempt', async () => {
  let calls = 0;
  const response = await fetchWithTransientRetry('https://api.example.test/me', { method: 'GET' }, async () => {
    calls += 1;
    if (calls === 1) throw new TypeError('connection reset');
    return new Response('ok', { status: 200 });
  }, async () => {});
  assert.equal(response.status, 200);
  assert.equal(calls, 2);
});

test('GET stops after three transient failures', async () => {
  let calls = 0;
  const delays = [];
  const response = await fetchWithTransientRetry('https://api.example.test/me', { method: 'GET' }, async () => {
    calls += 1;
    return new Response('unavailable', { status: 503 });
  }, async (milliseconds) => delays.push(milliseconds));
  assert.equal(response.status, 503);
  assert.equal(calls, 3);
  assert.deepEqual(delays, [350, 900]);
});
