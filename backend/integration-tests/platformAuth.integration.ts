import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';

test('platform account lifecycle and independent marketing consents', async () => {
  const databaseUrl = 'postgres://postgres:postgres@localhost:5432/btime_registry_test';
  process.env.APP_DATABASE_URL = databaseUrl;
  process.env.SUPERADMIN_DATABASE_URL = databaseUrl;
  process.env.DATABASE_ADMIN_URL = databaseUrl;
  process.env.MEDIA_BASE_URL = 'http://localhost:3000';
  process.env.PUBLIC_BASE_URL = 'http://localhost:3000';
  process.env.BREVO_API_KEY = 'integration-test-key';
  process.env.EMAIL_FROM = 'BTime Tests <noreply@example.test>';
  process.env.DATABASE_SSL = 'false';
  process.env.NODE_ENV = 'test';

  const sentEmails: Array<{ to: Array<{ email: string }>; subject: string; htmlContent: string }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    assert.equal(String(input), 'https://api.brevo.com/v3/smtp/email');
    sentEmails.push(JSON.parse(String(init?.body)));
    return new Response(null, { status: 201 });
  }) as typeof fetch;

  const [{ buildServer }, pgModule] = await Promise.all([
    import('../src/server'),
    import('pg'),
  ]);
  const Pool = pgModule.default.Pool;
  const pool = new Pool({ connectionString: databaseUrl });
  const email = `platform-test-${randomUUID()}@example.test`;
  let app: Awaited<ReturnType<typeof buildServer>> | undefined;
  let sessionCookie = '';

  const extractToken = (html: string, route: 'verify-email' | 'reset-password') => {
    const match = html.match(new RegExp(`/${route}\\?token=([^"&]+)`));
    assert.ok(match, `expected ${route} token in mocked email`);
    return decodeURIComponent(match[1]);
  };

  try {
    app = await buildServer();
    await app.ready();

    const registration = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        email,
        phone: '0501234567',
        password: 'correct-horse-battery',
        termsAccepted: true,
        privacyAccepted: true,
        marketingEmail: false,
        marketingSms: false,
      },
    });
    assert.equal(registration.statusCode, 202);
    assert.equal(sentEmails.length, 1);
    assert.match(sentEmails[0].subject, /אימות/);

    const registrationRow = await pool.query(
      'SELECT id, email_verified_at FROM public.platform_users WHERE email = $1',
      [email],
    );
    assert.equal(registrationRow.rowCount, 1);
    assert.equal(registrationRow.rows[0].email_verified_at, null);
    const userId = registrationRow.rows[0].id as string;

    const initialConsents = await pool.query(
      'SELECT consent_type, granted FROM public.platform_user_consents WHERE user_id = $1',
      [userId],
    );
    assert.equal(initialConsents.rowCount, 4);
    assert.equal(initialConsents.rows.find((row) => row.consent_type === 'terms_of_use')?.granted, true);
    assert.equal(initialConsents.rows.find((row) => row.consent_type === 'privacy_policy')?.granted, true);
    assert.equal(initialConsents.rows.find((row) => row.consent_type === 'marketing_email')?.granted, false);
    assert.equal(initialConsents.rows.find((row) => row.consent_type === 'marketing_sms')?.granted, false);

    const verifyToken = extractToken(sentEmails[0].htmlContent, 'verify-email');
    const verification = await app.inject({
      method: 'POST',
      url: '/api/auth/verify-email',
      payload: { token: verifyToken },
    });
    assert.equal(verification.statusCode, 200);
    sessionCookie = String(verification.headers['set-cookie']).split(';')[0];
    assert.match(sessionCookie, /^btime_session=/);

    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: sessionCookie } });
    assert.equal(me.statusCode, 200);
    assert.equal(me.json().user.email, email);

    const preferences = await app.inject({ method: 'GET', url: '/api/auth/consents', headers: { cookie: sessionCookie } });
    assert.equal(preferences.statusCode, 200);
    assert.deepEqual(preferences.json(), { marketingEmail: false, marketingSms: false });

    const updatePreferences = await app.inject({
      method: 'PUT',
      url: '/api/auth/consents',
      headers: { cookie: sessionCookie },
      payload: { marketingEmail: true, marketingSms: false },
    });
    assert.equal(updatePreferences.statusCode, 200);
    assert.deepEqual(updatePreferences.json(), { marketingEmail: true, marketingSms: false });

    const consentHistory = await pool.query(
      `SELECT consent_type, granted FROM public.platform_user_consents
        WHERE user_id = $1 AND consent_type IN ('marketing_email', 'marketing_sms')
        ORDER BY recorded_at ASC, id ASC`,
      [userId],
    );
    assert.equal(consentHistory.rowCount, 3);
    assert.equal(consentHistory.rows.filter((row) => row.consent_type === 'marketing_email').length, 2);
    assert.equal(consentHistory.rows.filter((row) => row.consent_type === 'marketing_sms').length, 1);

    const forgot = await app.inject({
      method: 'POST',
      url: '/api/auth/forgot-password',
      payload: { email },
    });
    assert.equal(forgot.statusCode, 202);
    assert.equal(sentEmails.length, 2, 'operational password-reset email must not require marketing consent');
    const resetToken = extractToken(sentEmails[1].htmlContent, 'reset-password');

    const reset = await app.inject({
      method: 'POST',
      url: '/api/auth/reset-password',
      payload: { token: resetToken, password: 'new-correct-horse-battery' },
    });
    assert.equal(reset.statusCode, 200);

    const oldSession = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: sessionCookie } });
    assert.equal(oldSession.statusCode, 401, 'password reset must revoke previous sessions');

    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email, password: 'new-correct-horse-battery' },
    });
    assert.equal(login.statusCode, 200);
    const newCookie = String(login.headers['set-cookie']).split(';')[0];
    const logout = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie: newCookie } });
    assert.equal(logout.statusCode, 204);
    const afterLogout = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: newCookie } });
    assert.equal(afterLogout.statusCode, 401);

    const rejectedEmail = `no-consent-${randomUUID()}@example.test`;
    const rejectedRegistration = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        email: rejectedEmail,
        phone: '+14155552671',
        password: 'correct-horse-battery',
        termsAccepted: false,
        privacyAccepted: true,
      },
    });
    assert.equal(rejectedRegistration.statusCode, 400);
    const rejectedUser = await pool.query('SELECT 1 FROM public.platform_users WHERE email = $1', [rejectedEmail]);
    assert.equal(rejectedUser.rowCount, 0);
  } finally {
    if (app) await app.close();
    await pool.query('DELETE FROM public.platform_users WHERE email = $1', [email]).catch(() => {});
    await pool.end();
    globalThis.fetch = originalFetch;
  }
});
