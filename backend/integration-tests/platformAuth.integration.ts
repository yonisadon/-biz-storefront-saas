import assert from 'node:assert/strict';
import { createECDH, createHash, randomBytes, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { derivePushCapabilityToken, generateVapidKeys, hashPushCapability } from '../src/pushCrypto';

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
  process.env.MANAGEMENT_TOKEN_ENCRYPTION_KEY = 'a'.repeat(64);
  const vapidKeys = generateVapidKeys();
  process.env.WEB_PUSH_VAPID_PUBLIC_KEY = vapidKeys.publicKey;
  process.env.WEB_PUSH_VAPID_PRIVATE_KEY = vapidKeys.privateKey;
  process.env.WEB_PUSH_VAPID_SUBJECT = 'mailto:push-tests@example.test';
  process.env.PUSH_SUBSCRIPTION_ENCRYPTION_KEY = 'c'.repeat(64);
  process.env.PUSH_CAPABILITY_HMAC_KEY = 'd'.repeat(64);

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
  let ownerSessionCookie = '';
  let claimSessionCookie = '';
  const pushClientEcdh = createECDH('prime256v1');
  pushClientEcdh.generateKeys();
  const customerSubscription = {
    endpoint: `https://fcm.googleapis.com/fcm/send/integration-${randomUUID()}`,
    keys: {
      p256dh: pushClientEcdh.getPublicKey(undefined, 'uncompressed').toString('base64url'),
      auth: randomBytes(16).toString('base64url'),
    },
  };

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

    const expiredSessionToken = `expired-${randomUUID()}`;
    const expiredSessionHash = createHash('sha256').update(expiredSessionToken).digest();
    const activeSessionToken = `active-${randomUUID()}`;
    const activeSessionHash = createHash('sha256').update(activeSessionToken).digest();
    await pool.query(
      `INSERT INTO public.platform_sessions (user_id, token_hash, expires_at)
       VALUES ($1, $2, now() - interval '1 day'), ($1, $3, now() + interval '2 days')`,
      [userId, expiredSessionHash, activeSessionHash],
    );

    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email, password: 'new-correct-horse-battery' },
    });
    assert.equal(login.statusCode, 200);
    const setCookie = String(login.headers['set-cookie']);
    assert.match(setCookie, /Max-Age=259200/);
    const newCookie = setCookie.split(';')[0];
    const newSessionToken = decodeURIComponent(newCookie.slice('btime_session='.length));
    const newSessionHash = createHash('sha256').update(newSessionToken).digest();
    const sessionRows = await pool.query(
      `SELECT token_hash, expires_at FROM public.platform_sessions WHERE user_id = $1`,
      [userId],
    );
    assert.equal(sessionRows.rowCount, 2, 'login must remove expired sessions but preserve active sessions');
    assert.ok(sessionRows.rows.some((row) => Buffer.from(row.token_hash).equals(activeSessionHash)));
    assert.ok(!sessionRows.rows.some((row) => Buffer.from(row.token_hash).equals(expiredSessionHash)));
    const createdSession = sessionRows.rows.find((row) => Buffer.from(row.token_hash).equals(newSessionHash));
    assert.ok(createdSession, 'login must create a fresh session');
    const remainingMs = new Date(createdSession.expires_at).getTime() - Date.now();
    assert.ok(remainingMs > 2.99 * 24 * 60 * 60 * 1000 && remainingMs <= 3 * 24 * 60 * 60 * 1000 + 5000,
      'database session expiry must be three days from creation');

    const logout = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie: newCookie } });
    assert.equal(logout.statusCode, 204);
    const afterLogout = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: newCookie } });
    assert.equal(afterLogout.statusCode, 401);
    const loggedOutRow = await pool.query('SELECT 1 FROM public.platform_sessions WHERE token_hash = $1', [newSessionHash]);
    assert.equal(loggedOutRow.rowCount, 0, 'logout must delete the session row immediately');
    const preservedSession = await pool.query('SELECT 1 FROM public.platform_sessions WHERE token_hash = $1', [activeSessionHash]);
    assert.equal(preservedSession.rowCount, 1, 'logout must not delete another active session');
    await pool.query('DELETE FROM public.platform_sessions WHERE token_hash = $1', [activeSessionHash]);

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
      assert.match(provisioned.management_url, /^http:\/\/localhost:3000\/manage\/[A-Za-z0-9_-]{43}$/);
      const permanentToken = new URL(provisioned.management_url).pathname.split('/').pop()!;
      const permanentTokenRow = await pool.query(
        'SELECT token_hash, encrypted_token, expires_at, label FROM public.access_tokens WHERE tenant_id = $1',
        [provisioned.id],
      );
      assert.equal(permanentTokenRow.rowCount, 1);
      assert.ok(permanentTokenRow.rows[0].encrypted_token);
      assert.equal(permanentTokenRow.rows[0].expires_at, null);
      assert.equal(permanentTokenRow.rows[0].label, 'permanent seller link');
      assert.ok(!String(permanentTokenRow.rows[0].encrypted_token).includes(permanentToken));

      const anonymousManagement = await app.inject({
        method: 'GET', url: `/api/manage/${permanentToken}/business`,
      });
      assert.equal(anonymousManagement.statusCode, 401, 'claimed businesses must require an owner session');

      const tenantDatabaseUrl = new URL(databaseUrl);
      tenantDatabaseUrl.pathname = `/${provisioned.database}`;
      const tenantDb = new pgModule.default.Client({ connectionString: tenantDatabaseUrl.toString() });
      await tenantDb.connect();
      try {
        const pushSettings = await tenantDb.query(
          'SELECT seller_enabled, customer_enabled FROM public.push_settings WHERE tenant_id = $1',
          [provisioned.id],
        );
        assert.equal(pushSettings.rowCount, 1, 'self-service provisioning must create Push settings after the tenant business row');
        assert.equal(pushSettings.rows[0].seller_enabled, true);
        assert.equal(pushSettings.rows[0].customer_enabled, true);
        const tenantBusinessConfig = await tenantDb.query(
          'SELECT config FROM public.businesses WHERE id = $1',
          [provisioned.id],
        );
        assert.equal(tenantBusinessConfig.rows[0].config.contact_options.products.crm_enabled, true);
        assert.equal(tenantBusinessConfig.rows[0].config.contact_options.services.calendar_enabled, true);
        const retentionClosedAt = await tenantDb.query(
          "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'leads' AND column_name = 'retention_closed_at'",
        );
        assert.equal(retentionClosedAt.rowCount, 1, 'newly provisioned businesses must track lead closure timestamps');
        const retentionOpenedAt = await tenantDb.query(
          "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'leads' AND column_name = 'retention_opened_at'",
        );
        assert.equal(retentionOpenedAt.rowCount, 1, 'newly provisioned businesses must track the current open retention period');
        const oldDeadlineColumn = await tenantDb.query(
          "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'leads' AND column_name = 'retention_expires_at'",
        );
        assert.equal(oldDeadlineColumn.rowCount, 0, 'legacy hard-coded retention deadline must be removed');

        const pushConfig = await app.inject({ method: 'GET', url: `/api/biz/${provisioned.slug}/push/config` });
        assert.equal(pushConfig.statusCode, 200);
        assert.equal(pushConfig.json().enabled, true, 'fresh tenant Push must be available immediately after provisioning');

        const manageHeaders = { cookie: sessionCookie };
        const initialPushSettings = await app.inject({ method: 'GET', url: `/api/manage/${permanentToken}/push/settings`, headers: manageHeaders });
        assert.equal(initialPushSettings.statusCode, 200);
        assert.equal(initialPushSettings.json().seller_effective, true);
        assert.equal(initialPushSettings.json().customer_effective, true);
        const sellerOff = await app.inject({
          method: 'PATCH', url: `/api/manage/${permanentToken}/push/settings`,
          headers: { ...manageHeaders, 'content-type': 'application/json' }, payload: { seller_enabled: false },
        });
        assert.equal(sellerOff.statusCode, 200);
        const sellerDisabledAttempt = await app.inject({
          method: 'POST', url: `/api/manage/${permanentToken}/push/subscriptions`,
          headers: { ...manageHeaders, 'content-type': 'application/json' }, payload: { subscription: customerSubscription },
        });
        assert.equal(sellerDisabledAttempt.statusCode, 403);
        const sellerOn = await app.inject({
          method: 'PATCH', url: `/api/manage/${permanentToken}/push/settings`,
          headers: { ...manageHeaders, 'content-type': 'application/json' }, payload: { seller_enabled: true },
        });
        assert.equal(sellerOn.statusCode, 200);
        const sellerRegistered = await app.inject({
          method: 'POST', url: `/api/manage/${permanentToken}/push/subscriptions`,
          headers: { ...manageHeaders, 'content-type': 'application/json' }, payload: { subscription: customerSubscription },
        });
        assert.equal(sellerRegistered.statusCode, 200, sellerRegistered.body);

        let pushTargetCounter = 0;
        const createPushTarget = async () => {
          pushTargetCounter += 1;
          const startAt = new Date(Date.now() + (60 + pushTargetCounter * 60) * 60 * 1000);
          const endAt = new Date(startAt.getTime() + 30 * 60 * 1000);
          const appointment = await tenantDb.query(
            `INSERT INTO public.appointments
               (tenant_id, service_name, customer_phone, start_at, end_at, source, status)
             VALUES ($1, 'Push integration service', '+972501234567', $2, $3, 'website', 'reserved')
             RETURNING id`,
            [provisioned!.id, startAt, endAt],
          );
          const targetId = appointment.rows[0].id as string;
          const capabilityId = randomUUID();
          const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
          const token = derivePushCapabilityToken(
            provisioned!.id, 'appointment', targetId, capabilityId, expiresAt, process.env.PUSH_CAPABILITY_HMAC_KEY!,
          );
          await tenantDb.query(
            `INSERT INTO public.push_target_link_capabilities
               (id, tenant_id, target_type, target_id, token_hash, expires_at)
             VALUES ($1, $2, 'appointment', $3, $4, $5)`,
            [capabilityId, provisioned!.id, targetId, hashPushCapability(token), expiresAt],
          );
          return token;
        };

        const firstCapability = await createPushTarget();
        const firstConsent = await app.inject({
          method: 'POST',
          url: `/api/biz/${provisioned.slug}/push/consent`,
          payload: { token: firstCapability, explicit_consent: true, subscription: customerSubscription },
        });
        assert.equal(firstConsent.statusCode, 200, firstConsent.body);
        assert.equal(firstConsent.json().already_enabled, false);

        const activeStatus = await app.inject({
          method: 'POST',
          url: `/api/biz/${provisioned.slug}/push/subscriptions/customer/status`,
          payload: { endpoint: customerSubscription.endpoint },
        });
        assert.equal(activeStatus.json().active, true);

        const secondCapability = await createPushTarget();
        const silentLink = await app.inject({
          method: 'POST',
          url: `/api/biz/${provisioned.slug}/push/consent`,
          payload: { token: secondCapability, explicit_consent: false, subscription: customerSubscription },
        });
        assert.equal(silentLink.statusCode, 200, silentLink.body);
        assert.equal(silentLink.json().already_enabled, true, 'same browser and tenant must reuse its active consent');
        const consentCounts = await tenantDb.query(
          'SELECT (SELECT count(*)::int FROM public.push_device_consents WHERE tenant_id = $1 AND revoked_at IS NULL) AS devices, ' +
          '(SELECT count(*)::int FROM public.push_subscription_targets WHERE tenant_id = $1 AND revoked_at IS NULL) AS targets',
          [provisioned.id],
        );
        assert.equal(consentCounts.rows[0].devices, 1, 'one persistent device consent must cover multiple targets');
        assert.equal(consentCounts.rows[0].targets, 2, 'each booking still needs its own target link');

        const revoked = await app.inject({
          method: 'DELETE',
          url: `/api/biz/${provisioned.slug}/push/subscriptions/customer`,
          payload: { endpoint: customerSubscription.endpoint },
        });
        assert.equal(revoked.statusCode, 200);
        const revokedStatus = await app.inject({
          method: 'POST',
          url: `/api/biz/${provisioned.slug}/push/subscriptions/customer/status`,
          payload: { endpoint: customerSubscription.endpoint },
        });
        assert.equal(revokedStatus.json().active, false);

        const reenabled = await app.inject({
          method: 'POST',
          url: `/api/biz/${provisioned.slug}/push/consent`,
          payload: { token: firstCapability, explicit_consent: true, subscription: customerSubscription },
        });
        assert.equal(reenabled.statusCode, 200, reenabled.body);
        assert.equal(reenabled.json().already_enabled, false, 'explicit consent must reactivate a revoked device');
        const activeAgain = await app.inject({
          method: 'POST',
          url: `/api/biz/${provisioned.slug}/push/subscriptions/customer/status`,
          payload: { endpoint: customerSubscription.endpoint },
        });
        assert.equal(activeAgain.json().active, true);
        const sellerRemoved = await app.inject({
          method: 'DELETE', url: `/api/manage/${permanentToken}/push/subscriptions`,
          headers: { ...manageHeaders, 'content-type': 'application/json' }, payload: { endpoint: customerSubscription.endpoint },
        });
        assert.equal(sellerRemoved.statusCode, 200);
        const customerStillActive = await app.inject({
          method: 'POST',
          url: `/api/biz/${provisioned.slug}/push/subscriptions/customer/status`,
          payload: { endpoint: customerSubscription.endpoint },
        });
        assert.equal(customerStillActive.json().active, true,
          'removing seller Push on this browser must not revoke independent customer consent');

        // Retention must wait for pending Push events, then remove only target
        // links/capabilities while preserving the tenant+device consent record.
        await pool.query(
          `UPDATE public.platform_retention_policies
              SET delete_enabled = true, retention_days = 1
            WHERE plan_code = 'standard' AND
              ((record_type = 'appointment' AND record_status = 'cancelled') OR
               (record_type = 'waitlist' AND record_status = 'closed'))`,
        );
        const subscriptionRow = await tenantDb.query(
          'SELECT id FROM public.push_subscriptions WHERE tenant_id = $1 AND audience = $2 AND endpoint_hash = $3',
          [provisioned.id, 'customer', hashPushCapability(customerSubscription.endpoint)],
        );
        const subscriptionId = subscriptionRow.rows[0].id as string;
        const oldStart = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000);
        const oldEnd = new Date(oldStart.getTime() + 30 * 60 * 1000);
        const expiredAppointment = await tenantDb.query(
          `INSERT INTO public.appointments
             (tenant_id, service_name, customer_phone, start_at, end_at, source, status, status_changed_at)
           VALUES ($1, 'Expired Push appointment', '+972501234567', $2, $3, 'manual', 'cancelled', now() - interval '3 days')
           RETURNING id`,
          [provisioned.id, oldStart, oldEnd],
        );
        const expiredAppointmentId = expiredAppointment.rows[0].id as string;
        const expiredWaitlist = await tenantDb.query(
          `INSERT INTO public.waitlist_entries
             (tenant_id, customer_phone, service_ids, service_names, preferred_date, status, updated_at)
           VALUES ($1, '+972501234567', ARRAY[$2::uuid], ARRAY['Expired service'], (now() - interval '3 days')::date, 'closed', now() - interval '3 days')
           RETURNING id`,
          [provisioned.id, randomUUID()],
        );
        const expiredWaitlistId = expiredWaitlist.rows[0].id as string;
        for (const [targetType, targetId] of [
          ['appointment', expiredAppointmentId],
          ['waitlist', expiredWaitlistId],
        ] as const) {
          await tenantDb.query(
            'INSERT INTO public.push_subscription_targets (tenant_id, target_type, target_id, subscription_id) VALUES ($1, $2, $3, $4)',
            [provisioned.id, targetType, targetId, subscriptionId],
          );
          await tenantDb.query(
            `INSERT INTO public.push_target_link_capabilities
               (tenant_id, target_type, target_id, token_hash, expires_at)
             VALUES ($1, $2, $3, $4, now() + interval '7 days')`,
            [provisioned.id, targetType, targetId, hashPushCapability(randomUUID())],
          );
          await tenantDb.query(
            `INSERT INTO public.push_outbox
               (tenant_id, audience, event_type, target_type, target_id, payload, status)
             VALUES ($1, $2, $3, $4, $5, $6::jsonb, 'pending')`,
            [provisioned.id, targetType === 'appointment' ? 'customer' : 'seller',
             targetType === 'appointment' ? 'customer.appointment_cancelled' : 'seller.waitlist_created',
             targetType, targetId, JSON.stringify({ title: 'BTime', body: 'Cleanup integration test', url: '/' })],
          );
        }

        const runRetentionCleanup = () => execFileSync(
          'npx',
          ['tsx', 'scripts/cleanup-expired-crm.ts', '--apply'],
          {
            cwd: process.cwd(),
            encoding: 'utf8',
            env: { ...process.env, APP_DATABASE_URL: databaseUrl, DATABASE_SSL: 'false' },
          },
        );
        const deferredCleanup = runRetentionCleanup();
        assert.match(deferredCleanup, /preflight passed/i);
        const retainedTargets = await tenantDb.query(
          'SELECT (SELECT count(*)::int FROM public.appointments WHERE id = $1) AS appointment_count, ' +
          '(SELECT count(*)::int FROM public.waitlist_entries WHERE id = $2) AS waitlist_count',
          [expiredAppointmentId, expiredWaitlistId],
        );
        assert.equal(retainedTargets.rows[0].appointment_count, 1, 'pending appointment Push must defer appointment retention');
        assert.equal(retainedTargets.rows[0].waitlist_count, 1, 'pending waitlist Push must defer waitlist retention');

        await tenantDb.query(
          `UPDATE public.push_outbox SET status = 'done', processed_at = now()
            WHERE tenant_id = $1 AND target_id = ANY($2::uuid[])`,
          [provisioned.id, [expiredAppointmentId, expiredWaitlistId]],
        );
        runRetentionCleanup();
        const cleanedTargets = await tenantDb.query(
          'SELECT (SELECT count(*)::int FROM public.appointments WHERE id = $1) AS appointment_count, ' +
          '(SELECT count(*)::int FROM public.waitlist_entries WHERE id = $2) AS waitlist_count, ' +
          '(SELECT count(*)::int FROM public.push_subscription_targets WHERE tenant_id = $3 AND target_id = ANY($4::uuid[])) AS links, ' +
          '(SELECT count(*)::int FROM public.push_target_link_capabilities WHERE tenant_id = $3 AND target_id = ANY($4::uuid[])) AS capabilities, ' +
          '(SELECT count(*)::int FROM public.push_device_consents WHERE tenant_id = $3 AND subscription_id = $5 AND revoked_at IS NULL) AS device_consents',
          [expiredAppointmentId, expiredWaitlistId, provisioned.id, [expiredAppointmentId, expiredWaitlistId], subscriptionId],
        );
        assert.equal(cleanedTargets.rows[0].appointment_count, 0);
        assert.equal(cleanedTargets.rows[0].waitlist_count, 0);
        assert.equal(cleanedTargets.rows[0].links, 0, 'completed targets must not leave Push subscription links behind');
        assert.equal(cleanedTargets.rows[0].capabilities, 0, 'completed targets must not leave link capabilities behind');
        assert.equal(cleanedTargets.rows[0].device_consents, 1, 'target cleanup must preserve device-level consent');
      } finally {
        await tenantDb.end();
      }
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
      ownerSessionCookie = ownerCookie;
      const permanentManagementLink = await app.inject({
        method: 'POST', url: '/api/auth/management-link', headers: { cookie: ownerCookie },
      });
      assert.equal(permanentManagementLink.statusCode, 200);
      assert.equal(permanentManagementLink.json().management_url, provisioned.management_url,
        'account access must return the same permanent management URL');
      const ownerManagement = await app.inject({
        method: 'GET', url: `/api/manage/${permanentToken}/business`, headers: { cookie: ownerCookie },
      });
      assert.equal(ownerManagement.statusCode, 200, 'the matching owner session must open management APIs');
      assert.equal(ownerManagement.json().onboarding_completed_at, null,
        'newly provisioned businesses must start with guided onboarding incomplete');
      const completeOnboarding = await app.inject({
        method: 'POST',
        url: `/api/manage/${permanentToken}/onboarding/complete`,
        headers: { cookie: ownerCookie },
      });
      assert.equal(completeOnboarding.statusCode, 200);
      assert.ok(completeOnboarding.json().completed_at);
      const onboardingState = await pool.query(
        'SELECT app.get_tenant_onboarding_completed_at($1) AS completed_at',
        [provisioned.id],
      );
      assert.ok(onboardingState.rows[0].completed_at,
        'onboarding completion must persist in the central Registry');
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

    // Admin routes reject anonymous and ordinary-owner sessions.
    const anonymousAdmin = await app.inject({ method: 'GET', url: '/api/admin/businesses' });
    assert.equal(anonymousAdmin.statusCode, 401);
    const ownerSessionAdmin = await app.inject({
      method: 'GET',
      url: '/api/admin/businesses',
      headers: { cookie: ownerSessionCookie },
    });
    assert.equal(ownerSessionAdmin.statusCode, 401);

    // A verified account promoted to super_admin must be able to use its session cookie
    // without sending the emergency API token from the browser.
    const superAdminEmail = `platform-admin-${randomUUID()}@example.test`;
    const superAdminRegistration = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        email: superAdminEmail,
        phone: '+972501234569',
        password: 'correct-horse-admin-password',
        termsAccepted: true,
        privacyAccepted: true,
        marketingEmail: false,
        marketingSms: false,
      },
    });
    assert.equal(superAdminRegistration.statusCode, 202);
    const superAdminVerifyToken = extractToken(sentEmails[2].htmlContent, 'verify-email');
    const superAdminVerification = await app.inject({
      method: 'POST',
      url: '/api/auth/verify-email',
      payload: { token: superAdminVerifyToken },
    });
    assert.equal(superAdminVerification.statusCode, 200);
    const superAdminCookie = String(superAdminVerification.headers['set-cookie']).split(';')[0];
    await pool.query(
      "UPDATE public.platform_users SET role = 'super_admin' WHERE email = $1",
      [superAdminEmail],
    );
    const superAdminAccess = await app.inject({
      method: 'GET',
      url: '/api/admin/overview',
      headers: { cookie: superAdminCookie },
    });
    assert.equal(superAdminAccess.statusCode, 200);

    // Exercise ownerless/manual business visibility and the two-step deletion flow.
    const adminToken = 't'.repeat(48);
    process.env.SUPERADMIN_API_TOKEN = adminToken;
    const adminHeaders = { authorization: `Bearer ${adminToken}` };
    const manualSlug = `manual-${randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const manualName = 'Manual Integration Business';
    const claimEmail = `claim-${randomUUID()}@example.test`;
    const claimRegistration = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        email: claimEmail,
        phone: '+972501234568',
        password: 'new-correct-horse-battery',
        termsAccepted: true,
        privacyAccepted: true,
        marketingEmail: false,
        marketingSms: false,
      },
    });
    assert.equal(claimRegistration.statusCode, 202);
    const claimVerificationEmail = sentEmails.filter(message => message.to[0]?.email === claimEmail).at(-1);
    assert.ok(claimVerificationEmail);
    const claimVerificationToken = extractToken(claimVerificationEmail.htmlContent, 'verify-email');
    const claimVerification = await app.inject({
      method: 'POST', url: '/api/auth/verify-email', payload: { token: claimVerificationToken },
    });
    assert.equal(claimVerification.statusCode, 200);
    claimSessionCookie = String(claimVerification.headers['set-cookie']).split(';')[0];
    let manualBusinessId = '';
    let manualDatabase = '';
    try {
      const manualCreated = await pool.query(
        'SELECT app.create_business($1, $2, NULL, $3::jsonb) AS id',
        [manualSlug, manualName, JSON.stringify({})],
      );
      manualBusinessId = manualCreated.rows[0].id as string;
      await pool.query('UPDATE public.businesses SET email = $2 WHERE id = $1', [manualBusinessId, claimEmail]);
      const legacyManagementToken = randomBytes(32).toString('base64url');
      const legacyManagementHash = createHash('sha256').update(legacyManagementToken, 'utf8').digest();
      await pool.query(
        "INSERT INTO public.access_tokens (tenant_id, token_hash, label) VALUES ($1, $2, 'initial seller link')",
        [manualBusinessId, legacyManagementHash],
      );
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

      // Exercise the Super Admin provisioning path as well: it must produce the
      // same contact defaults and initialize Push settings in the fresh tenant.
      const adminProvisionSlug = `admin-integration-${randomUUID().replace(/-/g, '').slice(0, 16)}`;
      let adminProvisioned: { id: string; database: string; slug: string } | undefined;
      try {
        const adminCreate = await app.inject({
          method: 'POST',
          url: '/api/admin/businesses',
          headers: { ...adminHeaders, 'content-type': 'application/json' },
          payload: { name: 'Admin Provisioning Integration Business', slug: adminProvisionSlug },
        });
        assert.equal(adminCreate.statusCode, 201, adminCreate.body);
        adminProvisioned = adminCreate.json() as { id: string; database: string; slug: string };
        const adminTenantUrl = new URL(databaseUrl);
        adminTenantUrl.pathname = `/${adminProvisioned.database}`;
        const adminTenant = new pgModule.default.Client({ connectionString: adminTenantUrl.toString() });
        await adminTenant.connect();
        try {
          const settings = await adminTenant.query(
            'SELECT seller_enabled, customer_enabled FROM public.push_settings WHERE tenant_id = $1',
            [adminProvisioned.id],
          );
          assert.equal(settings.rowCount, 1, 'Super Admin provisioning must initialize Push settings');
          assert.equal(settings.rows[0].seller_enabled, true);
          assert.equal(settings.rows[0].customer_enabled, true);
          const tenantBusiness = await adminTenant.query(
            'SELECT config FROM public.businesses WHERE id = $1',
            [adminProvisioned.id],
          );
          assert.equal(tenantBusiness.rows[0].config.contact_options.products.crm_enabled, true);
          assert.equal(tenantBusiness.rows[0].config.contact_options.services.calendar_enabled, true);

          const startAt = new Date(Date.now() + 2 * 60 * 60 * 1000);
          const endAt = new Date(startAt.getTime() + 30 * 60 * 1000);
          const appointment = await adminTenant.query(
            `INSERT INTO public.appointments
               (tenant_id, service_name, customer_phone, start_at, end_at, source, status)
             VALUES ($1, 'Cross-tenant Push service', '+972501234567', $2, $3, 'website', 'reserved')
             RETURNING id`,
            [adminProvisioned.id, startAt, endAt],
          );
          const targetId = appointment.rows[0].id as string;
          const capabilityId = randomUUID();
          const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
          const token = derivePushCapabilityToken(
            adminProvisioned.id, 'appointment', targetId, capabilityId, expiresAt, process.env.PUSH_CAPABILITY_HMAC_KEY!,
          );
          await adminTenant.query(
            `INSERT INTO public.push_target_link_capabilities
               (id, tenant_id, target_type, target_id, token_hash, expires_at)
             VALUES ($1, $2, 'appointment', $3, $4, $5)`,
            [capabilityId, adminProvisioned.id, targetId, hashPushCapability(token), expiresAt],
          );
          const crossTenantConsent = await app.inject({
            method: 'POST',
            url: `/api/biz/${adminProvisioned.slug}/push/consent`,
            payload: { token, explicit_consent: false, subscription: customerSubscription },
          });
          assert.equal(crossTenantConsent.statusCode, 403,
            'a browser consent granted in another tenant must not be reused automatically');
          const isolatedConsent = await adminTenant.query(
            'SELECT count(*)::int AS n FROM public.push_device_consents WHERE tenant_id = $1',
            [adminProvisioned.id],
          );
          assert.equal(isolatedConsent.rows[0].n, 0, 'device consent must remain tenant-scoped');
        } finally {
          await adminTenant.end();
        }
      } finally {
        if (adminProvisioned) {
          await pool.query(`DROP DATABASE IF EXISTS "${adminProvisioned.database}" WITH (FORCE)`).catch(() => {});
          await pool.query('DELETE FROM public.businesses WHERE id = $1', [adminProvisioned.id]).catch(() => {});
        }
      }

      const legacyLinkBeforeAssociation = await app.inject({
        method: 'GET', url: `/api/admin/businesses/${manualBusinessId}/management-link`, headers: adminHeaders,
      });
      assert.equal(legacyLinkBeforeAssociation.statusCode, 200);
      assert.equal(legacyLinkBeforeAssociation.json().available, false);
      assert.equal(legacyLinkBeforeAssociation.json().requires_association, true);
      const legacyManagementUrl = `http://localhost:3000/manage/${legacyManagementToken}`;
      const associateLegacyLink = await app.inject({
        method: 'POST',
        url: `/api/admin/businesses/${manualBusinessId}/management-link/associate`,
        headers: { ...adminHeaders, 'content-type': 'application/json' },
        payload: { management_url: legacyManagementUrl },
      });
      assert.equal(associateLegacyLink.statusCode, 200);
      const legacyLinkAfterAssociation = await app.inject({
        method: 'GET', url: `/api/admin/businesses/${manualBusinessId}/management-link`, headers: adminHeaders,
      });
      assert.equal(legacyLinkAfterAssociation.statusCode, 200);
      assert.equal(legacyLinkAfterAssociation.json().available, true);
      assert.equal(legacyLinkAfterAssociation.json().management_url, legacyManagementUrl,
        'associating a legacy link must preserve its exact URL');

      const ownerlessAuthorization = await pool.query(
        'SELECT app.authorize_tenant_management($1, NULL) AS tenant_id',
        [legacyManagementHash],
      );
      assert.equal(ownerlessAuthorization.rows[0].tenant_id, manualBusinessId,
        'ownerless businesses must continue to accept their fixed bearer link');
      const visibleBusinesses = await app.inject({ method: 'GET', url: '/api/admin/businesses', headers: adminHeaders });
      assert.equal(visibleBusinesses.statusCode, 200);
      const visibleManual = visibleBusinesses.json().businesses.find((business: { id: string }) => business.id === manualBusinessId);
      assert.ok(visibleManual, 'ownerless manually created businesses must appear in Super Admin');
      assert.equal(visibleManual.owner_email, claimEmail);
      const unclaimedOwnerMapping = await pool.query(
        'SELECT 1 FROM public.platform_business_owners WHERE tenant_id = $1',
        [manualBusinessId],
      );
      assert.equal(unclaimedOwnerMapping.rowCount, 0, 'business contact email must not imply an account owner');
      const claimResponse = await app.inject({
        method: 'POST',
        url: '/api/auth/claim-business',
        headers: { cookie: claimSessionCookie },
        payload: { token: legacyManagementToken },
      });
      assert.equal(claimResponse.statusCode, 200);
      assert.equal(claimResponse.json().claimed, true);
      const claimedOwner = await pool.query(
        'SELECT user_id FROM public.platform_business_owners WHERE tenant_id = $1',
        [manualBusinessId],
      );
      assert.equal(claimedOwner.rowCount, 1);
      const claimSessionToken = decodeURIComponent(claimSessionCookie.split('=')[1]);
      const claimSessionHash = createHash('sha256').update(claimSessionToken, 'utf8').digest();
      const authorizedAfterClaim = await pool.query(
        'SELECT app.authorize_tenant_management($1, $2) AS tenant_id',
        [legacyManagementHash, claimSessionHash],
      );
      assert.equal(authorizedAfterClaim.rows[0].tenant_id, manualBusinessId);
      const bearerOnlyAfterClaim = await pool.query(
        'SELECT app.authorize_tenant_management($1, NULL) AS tenant_id',
        [legacyManagementHash],
      );
      assert.equal(bearerOnlyAfterClaim.rows[0].tenant_id, null,
        'claiming a business must stop bearer-only access without changing the link');

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

      const deletionLockClient = new pgModule.default.Client({ connectionString: databaseUrl });
      await deletionLockClient.connect();
      try {
        await deletionLockClient.query(
          'SELECT pg_advisory_lock(hashtextextended($1::text, 93003))',
          [deletionRequestId],
        );
        const concurrentDeletion = await app.inject({
          method: 'POST',
          url: `/api/admin/deletion-requests/${deletionRequestId}/execute`,
          headers: { ...adminHeaders, 'content-type': 'application/json' },
          payload: { backupVerified: true, backupReference: 'railway-backup-integration-lock' },
        });
        assert.equal(concurrentDeletion.statusCode, 409, 'only one execution may own a deletion request at a time');
      } finally {
        await deletionLockClient.query(
          'SELECT pg_advisory_unlock(hashtextextended($1::text, 93003))',
          [deletionRequestId],
        );
        await deletionLockClient.end();
      }

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
        await pool.query('DELETE FROM public.platform_users WHERE email = $1', [claimEmail]).catch(() => {});
      }
    }

    // A provisioning rollback can leave a Registry mapping after the tenant
    // database has already been dropped. The deletion workflow must also handle
    // an existing but only partially initialized tenant database.
    const partialSlug = `partial-${randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const partialCreated = await pool.query(
      'SELECT app.create_business($1, $2, NULL, $3::jsonb) AS id',
      [partialSlug, 'Partial Tenant Integration Business', JSON.stringify({})],
    );
    const partialBusinessId = partialCreated.rows[0].id as string;
    const partialDatabase = `biz_${partialBusinessId.replace(/-/g, '').slice(0, 24)}`;
    try {
      await pool.query("UPDATE public.businesses SET status = 'suspended' WHERE id = $1", [partialBusinessId]);
      await pool.query(`CREATE DATABASE "${partialDatabase}"`);
      await pool.query(
        'INSERT INTO app.tenant_databases (tenant_id, database_name) VALUES ($1, $2)',
        [partialBusinessId, partialDatabase],
      );
      const partialRequest = await app.inject({
        method: 'POST',
        url: `/api/admin/businesses/${partialBusinessId}/deletion-request`,
        headers: adminHeaders,
      });
      assert.equal(partialRequest.statusCode, 201);
      const partialRequestId = partialRequest.json().request.id as string;
      const partialApproval = await app.inject({
        method: 'PATCH',
        url: `/api/admin/deletion-requests/${partialRequestId}/review`,
        headers: { ...adminHeaders, 'content-type': 'application/json' },
        payload: { decision: 'approve', note: 'partial tenant integration test' },
      });
      assert.equal(partialApproval.statusCode, 200);
      const partialDeletion = await app.inject({
        method: 'POST',
        url: `/api/admin/deletion-requests/${partialRequestId}/execute`,
        headers: { ...adminHeaders, 'content-type': 'application/json' },
        payload: { backupVerified: true, backupReference: 'railway-backup-partial-tenant-001' },
      });
      assert.equal(partialDeletion.statusCode, 200, partialDeletion.body);
      const partialDbAfter = await pool.query('SELECT 1 FROM pg_database WHERE datname = $1', [partialDatabase]);
      assert.equal(partialDbAfter.rowCount, 0, 'partially initialized tenant database must be dropped');
      const partialBusinessAfter = await pool.query('SELECT 1 FROM public.businesses WHERE id = $1', [partialBusinessId]);
      assert.equal(partialBusinessAfter.rowCount, 0, 'partially initialized business registry row must be removed');
    } finally {
      await pool.query(`DROP DATABASE IF EXISTS "${partialDatabase}" WITH (FORCE)`).catch(() => {});
      await pool.query('DELETE FROM public.business_deletion_requests WHERE business_slug = $1', [partialSlug]).catch(() => {});
      await pool.query('DELETE FROM public.businesses WHERE id = $1', [partialBusinessId]).catch(() => {});
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
