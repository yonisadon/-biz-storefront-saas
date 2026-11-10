import { randomBytes } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { withTenant } from '../db';
import { HttpError } from '../errors';
import {
  createGoogleOAuthState,
  decryptGoogleToken,
  encryptGoogleToken,
  googleCalendarConfig,
  hashGoogleOAuthNonce,
  isGoogleCalendarConfigured,
  processGoogleCalendarJobs,
  verifyGoogleOAuthState,
} from '../googleCalendarService';

const callbackQuery = z.object({
  code: z.string().optional(),
  state: z.string().min(20),
  error: z.string().optional(),
});

function callbackPage(ok: boolean, message: string) {
  const safe = message.replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]!));
  return `<!doctype html><html lang="he" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>BTime · Google Calendar</title><body style="font-family:system-ui,sans-serif;max-width:560px;margin:12vh auto;padding:24px;line-height:1.7"><h1>${ok ? 'החיבור הושלם' : 'לא הצלחנו להשלים את החיבור'}</h1><p>${safe}</p><p>אפשר לחזור למסך ניהול היומן ב-BTime ולרענן את מצב החיבור.</p></body></html>`;
}

export const googleCalendarManageRoutes: FastifyPluginAsync = async (app) => {
  app.get('/google-calendar/status', async (req) => {
    const status = await withTenant(req.tenantId, async (db) => {
      const connection = (await db.query(
        `SELECT google_email, connected_at, last_sync_at, last_error
           FROM google_calendar_connections
          WHERE tenant_id = app.current_tenant_id()`,
      )).rows[0];
      const counts = (await db.query(
        `SELECT count(*) FILTER (WHERE status IN ('pending', 'processing'))::int AS pending,
                count(*) FILTER (WHERE status = 'failed')::int AS failed
           FROM google_calendar_sync_jobs
          WHERE tenant_id = app.current_tenant_id()`,
      )).rows[0];
      return { connection: connection ?? null, pending: Number(counts.pending), failed: Number(counts.failed) };
    });
    return {
      configured: isGoogleCalendarConfigured(),
      connected: Boolean(status.connection),
      google_email: status.connection?.google_email ?? null,
      connected_at: status.connection?.connected_at ?? null,
      last_sync_at: status.connection?.last_sync_at ?? null,
      last_error: status.connection?.last_error ?? null,
      pending: status.pending,
      failed: status.failed,
    };
  });

  app.post('/google-calendar/connect', async (req) => {
    if (!isGoogleCalendarConfigured()) throw new HttpError(503, 'google_calendar_not_configured');
    const cfg = googleCalendarConfig();
    const nonce = randomBytes(32).toString('hex');
    const state = createGoogleOAuthState(req.tenantId, nonce);
    await withTenant(req.tenantId, async (db) => {
      await db.query(
        'DELETE FROM google_calendar_oauth_states WHERE expires_at <= now()',
      );
      await db.query(
        'INSERT INTO google_calendar_oauth_states (state_hash, tenant_id, expires_at) VALUES ($1, app.current_tenant_id(), now() + interval \'10 minutes\')',
        [hashGoogleOAuthNonce(nonce)],
      );
    });

    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.search = new URLSearchParams({
      client_id: cfg.clientId,
      redirect_uri: cfg.redirectUri,
      response_type: 'code',
      scope: [
        'openid',
        'email',
        'https://www.googleapis.com/auth/calendar.events.owned',
      ].join(' '),
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
      state,
    }).toString();
    return { authorization_url: url.toString() };
  });

  app.post('/google-calendar/sync', async (req) => {
    if (!isGoogleCalendarConfigured()) throw new HttpError(503, 'google_calendar_not_configured');
    return processGoogleCalendarJobs(req.tenantId, 20);
  });

  app.post('/google-calendar/disconnect', async (req) => {
    const connection = await withTenant(req.tenantId, async (db) => (await db.query(
      'SELECT google_email, refresh_token_encrypted FROM google_calendar_connections WHERE tenant_id = app.current_tenant_id()',
    )).rows[0] as { google_email: string; refresh_token_encrypted: string } | undefined);
    if (!connection) return { disconnected: true, existing_google_events_remain: true };

    if (isGoogleCalendarConfigured()) {
      const token = decryptGoogleToken(connection.refresh_token_encrypted);
      const response = await fetch('https://oauth2.googleapis.com/revoke', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token }),
        signal: AbortSignal.timeout(12_000),
      });
      if (!response.ok && response.status !== 400) throw new HttpError(502, 'google_revoke_failed');
    }

    await withTenant(req.tenantId, async (db) => {
      await db.query('DELETE FROM google_calendar_sync_jobs WHERE tenant_id = app.current_tenant_id()');
      await db.query('DELETE FROM google_calendar_oauth_states WHERE tenant_id = app.current_tenant_id()');
      await db.query('DELETE FROM google_calendar_connections WHERE tenant_id = app.current_tenant_id()');
    });
    return { disconnected: true, existing_google_events_remain: true, google_revocation_attempted: isGoogleCalendarConfigured() };
  });
};

export const googleCalendarCallbackRoutes: FastifyPluginAsync = async (app) => {
  app.get('/callback', async (req, reply) => {
    let tenantId: string;
    let nonce: string;
    let code: string | undefined;
    let oauthError: string | undefined;
    try {
      const query = callbackQuery.parse(req.query);
      ({ tenantId, nonce } = verifyGoogleOAuthState(query.state));
      code = query.code;
      oauthError = query.error;
    } catch {
      return reply.code(400).type('text/html; charset=utf-8')
        .send(callbackPage(false, 'קישור האימות אינו תקף או שפג תוקפו.'));
    }

    try {
      const consumed = await withTenant(tenantId!, async (db) => (await db.query(
        `DELETE FROM google_calendar_oauth_states
          WHERE state_hash = $1 AND tenant_id = app.current_tenant_id() AND expires_at > now()
          RETURNING state_hash`,
        [hashGoogleOAuthNonce(nonce!)],
      )).rowCount);
      if (!consumed) throw new Error('oauth_state_already_used');
      if (oauthError) {
        return reply.code(400).type('text/html; charset=utf-8')
          .send(callbackPage(false, 'ההרשאה ב-Google בוטלה או נדחתה.'));
      }
      if (!code) throw new Error('missing_oauth_code');

      const cfg = googleCalendarConfig();
      const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: cfg.clientId,
          client_secret: cfg.clientSecret,
          redirect_uri: cfg.redirectUri,
          grant_type: 'authorization_code',
        }),
        signal: AbortSignal.timeout(12_000),
      });
      const tokens = await tokenResponse.json().catch(() => null) as {
        access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; error?: string;
      } | null;
      if (!tokenResponse.ok || !tokens?.access_token) throw new Error(tokens?.error || 'google_token_exchange_failed');
      if (!tokens.scope?.split(' ').includes('https://www.googleapis.com/auth/calendar.events.owned')) {
        throw new Error('google_calendar_scope_not_granted');
      }

      const profileResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
        headers: { authorization: `Bearer ${tokens.access_token}` },
        signal: AbortSignal.timeout(12_000),
      });
      const profile = await profileResponse.json().catch(() => null) as { email?: string } | null;
      if (!profileResponse.ok || !profile?.email) throw new Error('google_profile_lookup_failed');

      await withTenant(tenantId!, async (db) => {
        const existing = (await db.query(
          'SELECT google_email, refresh_token_encrypted FROM google_calendar_connections WHERE tenant_id = app.current_tenant_id()',
        )).rows[0] as { google_email: string; refresh_token_encrypted: string } | undefined;
        const refreshEncrypted = tokens.refresh_token
          ? encryptGoogleToken(tokens.refresh_token)
          : existing?.google_email === profile.email
            ? existing.refresh_token_encrypted
            : undefined;
        if (!refreshEncrypted) throw new Error('google_refresh_token_missing');

        await db.query(
          `INSERT INTO google_calendar_connections
            (tenant_id, google_email, access_token_encrypted, refresh_token_encrypted,
             access_token_expires_at, calendar_id, connected_at, last_error)
           VALUES
            (app.current_tenant_id(), $1, $2, $3, $4, 'primary', now(), NULL)
           ON CONFLICT (tenant_id) DO UPDATE
             SET google_email = EXCLUDED.google_email,
                 access_token_encrypted = EXCLUDED.access_token_encrypted,
                 refresh_token_encrypted = EXCLUDED.refresh_token_encrypted,
                 access_token_expires_at = EXCLUDED.access_token_expires_at,
                 calendar_id = 'primary',
                 connected_at = now(),
                 last_error = NULL`,
          [
            profile.email,
            encryptGoogleToken(tokens.access_token!),
            refreshEncrypted,
            new Date(Date.now() + Math.max(60, tokens.expires_in ?? 3600) * 1000).toISOString(),
          ],
        );

        await db.query(
          `INSERT INTO google_calendar_sync_jobs
            (tenant_id, appointment_id, operation, payload, status, attempts, next_attempt_at, updated_at)
           SELECT app.current_tenant_id(), a.id, 'upsert',
                  jsonb_build_object('service_name', a.service_name, 'customer_phone', a.customer_phone,
                    'start_at', a.start_at, 'end_at', a.end_at, 'source', a.source, 'status', a.status),
                  'pending', 0, now(), now()
             FROM appointments a
            WHERE a.status = 'reserved' AND a.end_at > now()
           ON CONFLICT (tenant_id, appointment_id) DO UPDATE
             SET operation = 'upsert', payload = EXCLUDED.payload, status = 'pending',
                 attempts = 0, next_attempt_at = now(), last_error = NULL, updated_at = now()`,
        );
      });

      return reply.type('text/html; charset=utf-8')
        .send(callbackPage(true, 'חשבון Google חובר בהצלחה ל-BTime.'));
    } catch (error) {
      req.log.error({ err: error }, 'Google Calendar OAuth callback failed');
      return reply.code(400).type('text/html; charset=utf-8')
        .send(callbackPage(false, 'לא הצלחנו להשלים את החיבור. חזרו למסך הניהול ונסו שוב.'));
    }
  });
};
