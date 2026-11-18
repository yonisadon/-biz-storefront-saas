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
  process.env.SUPERADMIN_API_TOKEN = 't'.repeat(48);

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

    // Exercise the real dedicated-database provisioning path against the disposable CI registry.
    const { provisionBusinessForOwner } = await import('../src/provisioning');
    const businessSlug = `integration-${randomUUID().replace(/-/g, '').slice(0, 16)}`;
    let provisioned: Awaited<ReturnType<typeof provisionBusinessForOwner>> | undefined;
    try {
      provisioned = await provisionBusinessForOwner(
        { id: userId, email, phone: '+972501234567' },
        { name: 'Integration Test Business', slug: businessSlug },
      );
      assert.match(provisioned.database, /^biz_[a-f0-9]{24}$/);
      assert.equal(provisioned.slug, businessSlug);
      const registryState = await pool.query(
        `SELECT b.status, s.status AS subscription_status, s.trial_ends_at, td.database_name
           FROM public.businesses b
           JOIN app.tenant_databases td ON td.tenant_id = b.id
           JOIN public.platform_subscriptions s ON s.tenant_id = b.id
          WHERE b.id = $1`,
        [provisioned.id],
      );
      assert.equal(registryState.rowCount, 1);
      assert.equal(registryState.rows[0].status, 'active');
      assert.equal(registryState.rows[0].subscription_status, 'trialing');
      assert.equal(registryState.rows[0].database_name, provisioned.database);
      assert.ok(new Date(registryState.rows[0].trial_ends_at).getTime() > Date.now());
      await assert.rejects(
        provisionBusinessForOwner({ id: userId, email, phone: '+972501234567' }, { name: 'Duplicate Business', slug: `duplicate-${businessSlug}` }),
        /business_already_exists/,
      );

      const ownerLogin = await app.inject({
        method: 'POST', url: '/api/auth/login', payload: { email, password: 'new-correct-horse-battery' },
      });
      assert.equal(ownerLogin.statusCode, 200);
      const ownerCookie = String(ownerLogin.headers['set-cookie']).split(';')[0];
      const cancellation = await app.inject({
        method: 'POST', url: '/api/auth/subscription/cancel', headers: { cookie: ownerCookie },
      });
      assert.equal(cancellation.statusCode, 200);
      assert.equal(cancellation.json().canceled, true);
      const canceledState = await pool.query(
        `SELECT s.status, app.is_tenant_subscription_accessible(b.id) AS accessible
           FROM public.businesses b JOIN public.platform_subscriptions s ON s.tenant_id = b.id
          WHERE b.id = $1`,
        [provisioned.id],
      );
      assert.equal(canceledState.rows[0].status, 'canceled');
      assert.equal(canceledState.rows[0].accessible, false);
      const ownerAccountAfterCancel = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: ownerCookie } });
      assert.equal(ownerAccountAfterCancel.statusCode, 200, 'owner account must remain available after subscription cancellation');
      const secondCancellation = await app.inject({
        method: 'POST', url: '/api/auth/subscription/cancel', headers: { cookie: ownerCookie },
      });
      assert.equal(secondCancellation.statusCode, 409);
    } finally {
      if (provisioned) {
        await pool.query(`DROP DATABASE IF EXISTS "${provisioned.database}" WITH (FORCE)`).catch(() => {});
        await pool.query('DELETE FROM public.businesses WHERE id = $1', [provisioned.id]).catch(() => {});
      }
    }

    // Exercise ownerless/manual business visibility and the two-step deletion flow.
    const adminToken = 't'.repeat(48);
    process.env.SUPERADMIN_API_TOKEN = adminToken;
    const manualSlug = `manual-${randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const manualName = 'Manual Integration Business';
    let manualBusinessId = '';
    let manualDatabase = '';
    try {
      const manualCreated = await pool.query(
        'SELECT app.create_business($1, $2, NULL, $3::jsonb) AS id',
        [manualSlug, manualName, JSON.stringify({})],
      );
      manualBusinessId = manualCreated.rows[0].id as string;
      manualDatabase = `biz_${manualBusinessId.replace(/-/g, '').slice(0, 24)}`;
      await pool.query(`CREATE DATABASE "${manualDatabase}"`);
      await pool.query(`GRANT CONNECT ON DATABASE "${manualDatabase}" TO app_runtime, app_superadmin`);

      const tenantAdmin = new pgModule.default.Client({ connectionString: databaseUrl.replace(/\/[^/]*$/, `/${manualDatabase}`) });
      try {
        await tenantAdmin.connect();
        const { readFileSync } = await import('node:fs');
        await tenantAdmin.query(readFileSync('migrations/tenant-schema.sql', 'utf8'));
        const { applyTenantMigrations } = await import('../src/tenantMigrations');
        await applyTenantMigrations(tenantAdmin);
      } finally {
        await tenantAdmin.end().catch(() => {});
      }
      await pool.query(
        'INSERT INTO app.tenant_databases (tenant_id, database_name) VALUES ($1, $2)',
        [manualBusinessId, manualDatabase],
      );

      const adminHeaders = { authorization: `Bearer ${adminToken}` };
      const visibleBusinesses = await app.inject({ method: 'GET', url: '/api/admin/businesses', headers: adminHeaders });
      assert.equal(visibleBusinesses.statusCode, 200);
      const visibleManual = visibleBusinesses.json().businesses.find((business: { id: string }) => business.id === manualBusinessId);
      assert.ok(visibleManual, 'ownerless manually created businesses must appear in Super Admin');
      assert.equal(visibleManual.owner_email, null);

      const requestResponse = await app.inject({
        method: 'POST',
        url: `/api/admin/businesses/${manualBusinessId}/deletion-request`,
        headers: adminHeaders,
      });
      assert.equal(requestResponse.statusCode, 201);
      const deletionRequestId = requestResponse.json().request.id as string;

      const approval = await app.inject({
        method: 'PATCH',
        url: `/api/admin/deletion-requests/${deletionRequestId}/review`,
        headers: { ...adminHeaders, 'content-type': 'application/json' },
        payload: { decision: 'approve', note: 'integration test' },
      });
      assert.equal(approval.statusCode, 200);

      const blockedDeletion = await app.inject({
        method: 'POST',
        url: `/api/admin/deletion-requests/${deletionRequestId}/execute`,
        headers: adminHeaders,
      });
      assert.equal(blockedDeletion.statusCode, 400, 'deletion must require explicit verified-backup evidence');
      const databaseBeforeBackup = await pool.query('SELECT 1 FROM pg_database WHERE datname = $1', [manualDatabase]);
      assert.equal(databaseBeforeBackup.rowCount, 1);

      const executedDeletion = await app.inject({
        method: 'POST',
        url: `/api/admin/deletion-requests/${deletionRequestId}/execute`,
        headers: { ...adminHeaders, 'content-type': 'application/json' },
        payload: { backupVerified: true, backupReference: 'railway-backup-integration-001' },
      });
      assert.equal(executedDeletion.statusCode, 200);
      const deletionAudit = await pool.query(
        `SELECT status, tenant_id, database_name, backup_reference, backup_verified_at
           FROM public.business_deletion_requests WHERE id = $1`,
        [deletionRequestId],
      );
      assert.equal(deletionAudit.rows[0].status, 'completed');
      assert.equal(deletionAudit.rows[0].tenant_id, null);
      assert.equal(deletionAudit.rows[0].database_name, manualDatabase);
      assert.equal(deletionAudit.rows[0].backup_reference, 'railway-backup-integration-001');
      assert.ok(deletionAudit.rows[0].backup_verified_at);
      const databaseAfterDeletion = await pool.query('SELECT 1 FROM pg_database WHERE datname = $1', [manualDatabase]);
      assert.equal(databaseAfterDeletion.rowCount, 0);
      const businessAfterDeletion = await pool.query('SELECT 1 FROM public.businesses WHERE id = $1', [manualBusinessId]);
      assert.equal(businessAfterDeletion.rowCount, 0);
    } finally {
      if (manualDatabase) await pool.query(`DROP DATABASE IF EXISTS "${manualDatabase}" WITH (FORCE)`).catch(() => {});
      if (manualBusinessId) {
        await pool.query('DELETE FROM public.business_deletion_requests WHERE business_slug = $1', [manualSlug]).catch(() => {});
        await pool.query('DELETE FROM public.businesses WHERE id = $1', [manualBusinessId]).catch(() => {});
      }
    }

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
