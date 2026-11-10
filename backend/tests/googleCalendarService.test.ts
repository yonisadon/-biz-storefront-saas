import test from 'node:test';
import assert from 'node:assert/strict';

test('Google Calendar token encryption and OAuth state validation', async () => {
  process.env.APP_DATABASE_URL = process.env.APP_DATABASE_URL || 'postgres://test:test@127.0.0.1:5432/test';
  process.env.MEDIA_BASE_URL = process.env.MEDIA_BASE_URL || 'https://media.example.test';
  process.env.GOOGLE_OAUTH_CLIENT_ID = 'test-client-id';
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'test-client-secret';
  process.env.GOOGLE_OAUTH_REDIRECT_URI = 'https://api.example.test/api/google-calendar/callback';
  process.env.GOOGLE_OAUTH_STATE_SECRET = 'test-state-secret-that-is-long-enough-for-hmac';
  process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = 'ab'.repeat(32);

  const {
    createGoogleOAuthState,
    decryptGoogleToken,
    encryptGoogleToken,
    hashGoogleOAuthNonce,
    isGoogleCalendarConfigured,
    verifyGoogleOAuthState,
  } = await import('../src/googleCalendarService');

  const token = 'google-refresh-token-example';
  const encrypted = encryptGoogleToken(token);
  assert.notEqual(encrypted, token);
  assert.equal(decryptGoogleToken(encrypted), token);
  const [iv, tag, cipher] = encrypted.split('.');
  const tampered = [iv, tag, `A${cipher.slice(1)}`].join('.');
  assert.throws(() => decryptGoogleToken(tampered));

  const tenantId = '9dfeef0b-5d7e-4173-b651-0b76d1f0e001';
  const nonce = 'one-time-random-nonce';
  const state = createGoogleOAuthState(tenantId, nonce);
  assert.deepEqual(verifyGoogleOAuthState(state), { tenantId, nonce });
  assert.equal(hashGoogleOAuthNonce(nonce), hashGoogleOAuthNonce(nonce));
  assert.throws(() => verifyGoogleOAuthState(`${state.slice(0, -1)}x`));
  assert.equal(isGoogleCalendarConfigured(), true);
});
