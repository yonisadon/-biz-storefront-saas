import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from './config';
import { withTenant } from './db';

type GoogleConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  stateSecret: string;
  encryptionKey: Buffer;
};

type Connection = {
  google_email: string;
  access_token_encrypted: string;
  refresh_token_encrypted: string;
  access_token_expires_at: string | null;
  calendar_id: string;
};

type SyncJob = {
  appointment_id: string;
  operation: 'upsert' | 'delete';
  payload: {
    service_name: string;
    customer_phone: string;
    start_at: string;
    end_at: string;
    source: string;
    status: string;
  };
};

function config(): GoogleConfig | null {
  const { GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_OAUTH_REDIRECT_URI,
    GOOGLE_OAUTH_STATE_SECRET, GOOGLE_TOKEN_ENCRYPTION_KEY } = env;
  if (!GOOGLE_OAUTH_CLIENT_ID || !GOOGLE_OAUTH_CLIENT_SECRET || !GOOGLE_OAUTH_REDIRECT_URI ||
      !GOOGLE_OAUTH_STATE_SECRET || !GOOGLE_TOKEN_ENCRYPTION_KEY) return null;
  if (!/^[a-f0-9]{64}$/i.test(GOOGLE_TOKEN_ENCRYPTION_KEY)) {
    throw new Error('GOOGLE_TOKEN_ENCRYPTION_KEY must be 64 hexadecimal characters.');
  }
  return {
    clientId: GOOGLE_OAUTH_CLIENT_ID,
    clientSecret: GOOGLE_OAUTH_CLIENT_SECRET,
    redirectUri: GOOGLE_OAUTH_REDIRECT_URI,
    stateSecret: GOOGLE_OAUTH_STATE_SECRET,
    encryptionKey: Buffer.from(GOOGLE_TOKEN_ENCRYPTION_KEY, 'hex'),
  };
}

export function isGoogleCalendarConfigured(): boolean {
  try { return config() !== null; } catch { return false; }
}

export function googleCalendarConfig() {
  const value = config();
  if (!value) throw new Error('google_calendar_not_configured');
  return value;
}

export function encryptGoogleToken(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', googleCalendarConfig().encryptionKey, iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join('.');
}

export function decryptGoogleToken(value: string): string {
  const [ivPart, tagPart, encryptedPart] = value.split('.');
  if (!ivPart || !tagPart || !encryptedPart) throw new Error('invalid_encrypted_google_token');
  const decipher = createDecipheriv('aes-256-gcm', googleCalendarConfig().encryptionKey, Buffer.from(ivPart, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedPart, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

export function createGoogleOAuthState(tenantId: string, nonce: string): string {
  const cfg = googleCalendarConfig();
  const payload = Buffer.from(JSON.stringify({ tenantId, nonce, issuedAt: Date.now() })).toString('base64url');
  const signature = createHmac('sha256', cfg.stateSecret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

export function verifyGoogleOAuthState(state: string): { tenantId: string; nonce: string } {
  const cfg = googleCalendarConfig();
  const [payload, signature] = state.split('.');
  if (!payload || !signature) throw new Error('invalid_oauth_state');
  const expected = createHmac('sha256', cfg.stateSecret).update(payload).digest();
  const actual = Buffer.from(signature, 'base64url');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error('invalid_oauth_state');
  const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
    tenantId?: string; nonce?: string; issuedAt?: number;
  };
  if (!decoded.tenantId || !decoded.nonce || !decoded.issuedAt ||
      Date.now() - decoded.issuedAt > 10 * 60_000 || decoded.issuedAt > Date.now() + 60_000) {
    throw new Error('expired_oauth_state');
  }
  return { tenantId: decoded.tenantId, nonce: decoded.nonce };
}

export function hashGoogleOAuthNonce(nonce: string): string {
  return createHash('sha256').update(nonce).digest('hex');
}

async function accessTokenFor(tenantId: string, connection: Connection): Promise<string> {
  const expiresAt = connection.access_token_expires_at ? Date.parse(connection.access_token_expires_at) : 0;
  if (expiresAt > Date.now() + 60_000) return decryptGoogleToken(connection.access_token_encrypted);

  const refreshToken = decryptGoogleToken(connection.refresh_token_encrypted);
  const cfg = googleCalendarConfig();
  const body = new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(12_000),
  });
  const data = await response.json().catch(() => null) as { access_token?: string; expires_in?: number; error?: string } | null;
  if (!response.ok || !data?.access_token) throw new Error(data?.error || 'google_token_refresh_failed');

  const expires = new Date(Date.now() + Math.max(60, data.expires_in ?? 3600) * 1000);
  await withTenant(tenantId, async (db) => {
    await db.query(
      'UPDATE google_calendar_connections SET access_token_encrypted = $1, access_token_expires_at = $2, last_error = NULL WHERE tenant_id = app.current_tenant_id()',
      [encryptGoogleToken(data.access_token!), expires.toISOString()],
    );
  });
  return data.access_token;
}

function eventId(appointmentId: string): string {
  return `btime${appointmentId.replace(/-/g, '').toLowerCase()}`;
}

async function applyGoogleEvent(token: string, calendarId: string, job: SyncJob): Promise<void> {
  const id = eventId(job.appointment_id);
  const base = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };

  if (job.operation === 'delete') {
    const response = await fetch(`${base}/${id}`, {
      method: 'DELETE', headers, signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok && response.status !== 404 && response.status !== 410) {
      throw new Error(`google_event_delete_failed_${response.status}`);
    }
    return;
  }

  const start = new Date(job.payload.start_at);
  const end = new Date(job.payload.end_at);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) {
    throw new Error('invalid_appointment_event_time');
  }
  const event = {
    id,
    summary: `BTime · ${String(job.payload.service_name).slice(0, 150)}`,
    description: [
      `טלפון לקוח: ${job.payload.customer_phone}`,
      `מקור: ${job.payload.source === 'manual' ? 'תור ידני' : 'אתר העסק'}`,
    ].join('\n'),
    start: { dateTime: start.toISOString(), timeZone: 'UTC' },
    end: { dateTime: end.toISOString(), timeZone: 'UTC' },
  };

  const insert = await fetch(base, {
    method: 'POST', headers, body: JSON.stringify(event), signal: AbortSignal.timeout(12_000),
  });
  if (insert.ok) return;
  if (insert.status !== 409) throw new Error(`google_event_insert_failed_${insert.status}`);

  const update = await fetch(`${base}/${id}`, {
    method: 'PUT', headers, body: JSON.stringify(event), signal: AbortSignal.timeout(12_000),
  });
  if (!update.ok) throw new Error(`google_event_update_failed_${update.status}`);
}

export async function processGoogleCalendarJobs(tenantId: string, limit = 10) {
  let processed = 0;
  let failed = 0;
  let connected = false;

  for (let index = 0; index < limit; index++) {
    const task = await withTenant(tenantId, async (db) => {
      const connection = (await db.query(
        `SELECT google_email, access_token_encrypted, refresh_token_encrypted,
                access_token_expires_at, calendar_id
           FROM google_calendar_connections
          WHERE tenant_id = app.current_tenant_id()`,
      )).rows[0] as Connection | undefined;
      if (!connection) return null;
      connected = true;

      const job = (await db.query(
        `SELECT appointment_id, operation, payload
           FROM google_calendar_sync_jobs
          WHERE tenant_id = app.current_tenant_id()
            AND (status IN ('pending', 'failed') OR
                 (status = 'processing' AND updated_at < now() - interval '5 minutes'))
            AND next_attempt_at <= now()
          ORDER BY created_at
          FOR UPDATE SKIP LOCKED
          LIMIT 1`,
      )).rows[0] as SyncJob | undefined;
      if (!job) return null;

      await db.query(
        `UPDATE google_calendar_sync_jobs
            SET status = 'processing', updated_at = now()
          WHERE tenant_id = app.current_tenant_id() AND appointment_id = $1`,
        [job.appointment_id],
      );
      return { connection, job };
    });

    if (!task) break;
    try {
      const token = await accessTokenFor(tenantId, task.connection);
      await applyGoogleEvent(token, task.connection.calendar_id, task.job);
      await withTenant(tenantId, async (db) => {
        await db.query(
          `UPDATE google_calendar_sync_jobs
              SET status = 'synced', attempts = attempts + 1, last_error = NULL,
                  last_synced_at = now(), updated_at = now()
            WHERE tenant_id = app.current_tenant_id() AND appointment_id = $1`,
          [task.job.appointment_id],
        );
        await db.query(
          'UPDATE google_calendar_connections SET last_sync_at = now(), last_error = NULL WHERE tenant_id = app.current_tenant_id()',
        );
      });
      processed++;
    } catch (error) {
      const message = (error instanceof Error ? error.message : 'google_calendar_sync_failed').slice(0, 300);
      await withTenant(tenantId, async (db) => {
        await db.query(
          `UPDATE google_calendar_sync_jobs
              SET status = 'failed', attempts = attempts + 1, last_error = $2,
                  next_attempt_at = now() + make_interval(mins => LEAST(60, (power(2, attempts))::int)),
                  updated_at = now()
            WHERE tenant_id = app.current_tenant_id() AND appointment_id = $1`,
          [task.job.appointment_id, message],
        );
        await db.query(
          'UPDATE google_calendar_connections SET last_error = $1 WHERE tenant_id = app.current_tenant_id()',
          [message],
        );
      });
      failed++;
    }
  }

  const counts = await withTenant(tenantId, async (db) => (await db.query(
    `SELECT count(*) FILTER (WHERE status IN ('pending', 'processing'))::int AS pending,
            count(*) FILTER (WHERE status = 'failed')::int AS failed
       FROM google_calendar_sync_jobs
      WHERE tenant_id = app.current_tenant_id()`,
  )).rows[0]);
  return { connected, processed, failed, pending: Number(counts.pending), failed_total: Number(counts.failed) };
}
