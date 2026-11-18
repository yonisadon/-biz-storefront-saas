import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import pg from 'pg';
import { z } from 'zod';
import { env } from '../config';
import { HttpError } from '../errors';
import { normalizeILPhone } from '../util';
import { createManagementToken, provisionBusinessForOwner } from '../provisioning';

const SESSION_COOKIE = 'btime_session';
const SESSION_DAYS = 14;
const VERIFY_HOURS = 24;
const RESET_MINUTES = 30;

const RegisterInput = z.object({
  email: z.string().trim().email().max(254),
  phone: z.string().trim().min(8).max(40),
  password: z.string().min(10).max(128),
}).strict();

const LoginInput = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(128),
}).strict();

const TokenInput = z.object({ token: z.string().min(32).max(128) }).strict();
const ResetInput = TokenInput.extend({ password: z.string().min(10).max(128) }).strict();
const OwnerBusinessInput = z.object({
  name: z.string().trim().min(2).max(120),
  slug: z.string().trim().toLowerCase().min(2).max(63).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  whatsapp_number: z.string().trim().max(40).optional(),
}).strict();
const DeletionRequestInput = z.object({ reason: z.string().trim().max(1000).optional() }).strict();

let registryPool: pg.Pool | undefined;
function registry(): pg.Pool {
  if (!env.SUPERADMIN_DATABASE_URL) throw new HttpError(503, 'account_service_not_configured');
  if (!registryPool) {
    registryPool = new pg.Pool({
      connectionString: env.SUPERADMIN_DATABASE_URL,
      max: 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      ssl: env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
    });
    registryPool.on('error', (error) => console.error('platform account registry pool error', error.message));
  }
  return registryPool;
}

const digest = (value: string) => createHash('sha256').update(value, 'utf8').digest();
const randomToken = () => randomBytes(32).toString('base64url');

function passwordHash(password: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return `scrypt$32768$8$1$${salt.toString('base64url')}$${derived.toString('base64url')}`;
}

function passwordMatches(password: string, encoded: string): boolean {
  const parts = encoded.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt' || parts[1] !== '32768' || parts[2] !== '8' || parts[3] !== '1') return false;
  try {
    const salt = Buffer.from(parts[4], 'base64url');
    const expected = Buffer.from(parts[5], 'base64url');
    if (salt.length !== 16 || expected.length !== 64) return false;
    const actual = scryptSync(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

function cookieValue(req: FastifyRequest): string | null {
  const raw = String(req.headers.cookie ?? '');
  for (const item of raw.split(';')) {
    const [name, ...parts] = item.trim().split('=');
    if (name === SESSION_COOKIE) return decodeURIComponent(parts.join('='));
  }
  return null;
}

function setSessionCookie(reply: FastifyReply, token: string): void {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  reply.header('Set-Cookie', `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 24 * 60 * 60}${secure}`);
}

function clearSessionCookie(reply: FastifyReply): void {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  reply.header('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`);
}

async function createSession(userId: string, reply: FastifyReply): Promise<void> {
  const token = randomToken();
  await registry().query(
    'INSERT INTO public.platform_sessions (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval \'14 days\')',
    [userId, digest(token)],
  );
  setSessionCookie(reply, token);
}

async function currentUser(req: FastifyRequest): Promise<any | null> {
  const token = cookieValue(req);
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const result = await registry().query(
    `SELECT u.id, u.email, u.phone, u.role, u.email_verified_at, u.created_at,
            b.id AS business_id, b.name AS business_name, b.slug AS business_slug, b.status AS business_status,
            s.status AS subscription_status, s.trial_ends_at, s.current_period_ends_at,
            (SELECT dr.status FROM public.business_deletion_requests dr WHERE dr.tenant_id = b.id ORDER BY dr.requested_at DESC LIMIT 1) AS deletion_request_status
       FROM public.platform_sessions ps
       JOIN public.platform_users u ON u.id = ps.user_id
       LEFT JOIN public.platform_business_owners bo ON bo.user_id = u.id
       LEFT JOIN public.businesses b ON b.id = bo.tenant_id
       LEFT JOIN public.platform_subscriptions s ON s.tenant_id = b.id
      WHERE ps.token_hash = $1 AND ps.revoked_at IS NULL AND ps.expires_at > now()
        AND u.disabled_at IS NULL AND u.email_verified_at IS NOT NULL
      LIMIT 1`,
    [digest(token)],
  );
  if (!result.rows[0]) return null;
  await registry().query(
    'UPDATE public.platform_sessions SET last_used_at = now() WHERE token_hash = $1 AND (last_used_at IS NULL OR last_used_at < now() - interval \'10 minutes\')',
    [digest(token)],
  );
  return result.rows[0];
}

async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM || !env.PUBLIC_BASE_URL) {
    throw new HttpError(503, 'email_service_not_configured');
  }
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: env.EMAIL_FROM, to: [to], subject, html }),
  });
  if (!response.ok) {
    console.error('Transactional email delivery failed', { status: response.status });
    throw new HttpError(503, 'email_delivery_failed');
  }
}

async function issueEmailToken(userId: string, purpose: 'verify_email' | 'reset_password'): Promise<string> {
  const token = randomToken();
  const interval = purpose === 'verify_email' ? `interval '${VERIFY_HOURS} hours'` : `interval '${RESET_MINUTES} minutes'`;
  await registry().query(
    'UPDATE public.platform_email_tokens SET consumed_at = now() WHERE user_id = $1 AND purpose = $2 AND consumed_at IS NULL',
    [userId, purpose],
  );
  await registry().query(
    `INSERT INTO public.platform_email_tokens (user_id, token_hash, purpose, expires_at) VALUES ($1, $2, $3, now() + ${interval})`,
    [userId, digest(token), purpose],
  );
  return token;
}

export const authRoutes: FastifyPluginAsync = async (app) => {
  app.post('/register', { config: { rateLimit: { max: 5, timeWindow: '15 minutes' } } }, async (req, reply) => {
    const input = RegisterInput.parse(req.body);
    if (!env.RESEND_API_KEY || !env.EMAIL_FROM || !env.PUBLIC_BASE_URL) throw new HttpError(503, 'email_service_not_configured');
    const email = input.email.toLowerCase();
    const phone = normalizeILPhone(input.phone);
    if (!phone) throw new HttpError(400, 'invalid_il_phone');
    const db = registry();

    const existingBusiness = await db.query(
      'SELECT 1 FROM public.businesses WHERE lower(COALESCE(email, \'\')) = $1 OR phone = $2 LIMIT 1',
      [email, phone],
    );
    if (existingBusiness.rowCount) {
      return reply.code(202).send({ message: 'אם ניתן להשלים את ההרשמה, יישלח אליך מייל עם המשך התהליך.' });
    }

    try {
      const role = env.SUPERADMIN_EMAIL?.toLowerCase() === email ? 'super_admin' : 'owner';
      const inserted = await db.query(
        'INSERT INTO public.platform_users (email, phone, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id',
        [email, phone, passwordHash(input.password), role],
      );
      const userId = inserted.rows[0].id as string;
      const token = await issueEmailToken(userId, 'verify_email');
      const verifyUrl = `${env.PUBLIC_BASE_URL!.replace(/\/+$/, '')}/verify-email?token=${encodeURIComponent(token)}`;
      await sendEmail(email, 'אימות כתובת המייל שלך ב-BTime',
        `<div dir="rtl" style="font-family:Arial,sans-serif;line-height:1.7"><h2>ברוכים הבאים ל-BTime</h2><p>כדי לאמת את כתובת המייל ולהמשיך להקמת העסק, לחצו על הקישור:</p><p><a href="${verifyUrl}">אימות כתובת המייל</a></p><p>הקישור תקף ל-24 שעות. אם לא ביקשת להירשם, אפשר להתעלם מההודעה.</p></div>`);
      return reply.code(202).send({ message: 'נשלח אליך מייל אם פרטי ההרשמה תקינים. יש לבדוק גם בתיקיית הספאם.' });
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        return reply.code(202).send({ message: 'אם ניתן להשלים את ההרשמה, יישלח אליך מייל עם המשך התהליך.' });
      }
      throw error;
    }
  });

  app.post('/resend-verification', { config: { rateLimit: { max: 5, timeWindow: '15 minutes' } } }, async (req, reply) => {
    const { email } = z.object({ email: z.string().trim().email().max(254) }).strict().parse(req.body);
    const result = await registry().query(
      'SELECT id, email FROM public.platform_users WHERE email = $1 AND email_verified_at IS NULL AND disabled_at IS NULL LIMIT 1',
      [email.toLowerCase()],
    );
    if (result.rows[0] && env.RESEND_API_KEY && env.EMAIL_FROM && env.PUBLIC_BASE_URL) {
      try {
        const token = await issueEmailToken(result.rows[0].id, 'verify_email');
        const verifyUrl = `${env.PUBLIC_BASE_URL.replace(/\/+$/, '')}/verify-email?token=${encodeURIComponent(token)}`;
        await sendEmail(result.rows[0].email, 'אימות כתובת המייל שלך ב-BTime',
          `<div dir="rtl" style="font-family:Arial,sans-serif;line-height:1.7"><h2>אימות כתובת המייל</h2><p>לחצו על הקישור כדי להשלים את ההרשמה:</p><p><a href="${verifyUrl}">אימות כתובת המייל</a></p><p>הקישור תקף ל-24 שעות.</p></div>`);
      } catch (error) {
        req.log.warn({ err: error }, 'verification email could not be resent');
      }
    }
    return reply.code(202).send({ message: 'אם קיים חשבון שממתין לאימות, יישלח אליו קישור חדש.' });
  });

  app.post('/verify-email', { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } }, async (req, reply) => {
    const { token } = TokenInput.parse(req.body);
    const db = registry();
    const client = await db.connect();
    let userId: string | undefined;
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `SELECT t.id AS token_id, u.id AS user_id
           FROM public.platform_email_tokens t
           JOIN public.platform_users u ON u.id = t.user_id
          WHERE t.token_hash = $1 AND t.purpose = 'verify_email'
            AND t.consumed_at IS NULL AND t.expires_at > now() AND u.disabled_at IS NULL
          FOR UPDATE OF t`,
        [digest(token)],
      );
      if (!result.rows[0]) throw new HttpError(400, 'verification_link_invalid_or_expired');
      const { token_id, user_id } = result.rows[0];
      userId = user_id as string;
      await client.query('UPDATE public.platform_email_tokens SET consumed_at = now() WHERE id = $1', [token_id]);
      await client.query('UPDATE public.platform_users SET email_verified_at = COALESCE(email_verified_at, now()), updated_at = now() WHERE id = $1', [user_id]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
    await createSession(userId!, reply);
    return { verified: true, message: 'כתובת המייל אומתה בהצלחה.' };
  });

  app.post('/login', { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } }, async (req, reply) => {
    const input = LoginInput.parse(req.body);
    const result = await registry().query(
      'SELECT id, password_hash, email_verified_at, disabled_at, role FROM public.platform_users WHERE email = $1 LIMIT 1',
      [input.email.toLowerCase()],
    );
    const user = result.rows[0];
    if (!user || user.disabled_at || !passwordMatches(input.password, user.password_hash)) {
      throw new HttpError(401, 'invalid_credentials');
    }
    if (!user.email_verified_at) throw new HttpError(403, 'email_not_verified');
    let role = user.role as string;
    if (env.SUPERADMIN_EMAIL?.toLowerCase() === input.email.toLowerCase() && role !== 'super_admin') {
      await registry().query("UPDATE public.platform_users SET role = 'super_admin', updated_at = now() WHERE id = $1", [user.id]);
      role = 'super_admin';
    }
    await createSession(user.id, reply);
    return { authenticated: true, role };
  });

  app.get('/me', async (req) => {
    const user = await currentUser(req);
    if (!user) throw new HttpError(401, 'not_authenticated');
    return { user };
  });

  app.post('/logout', async (req, reply) => {
    const token = cookieValue(req);
    if (token && /^[A-Za-z0-9_-]{43}$/.test(token)) {
      await registry().query('UPDATE public.platform_sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL', [digest(token)]);
    }
    clearSessionCookie(reply);
    return reply.code(204).send();
  });

  app.post('/forgot-password', { config: { rateLimit: { max: 5, timeWindow: '15 minutes' } } }, async (req, reply) => {
    const { email } = z.object({ email: z.string().trim().email().max(254) }).strict().parse(req.body);
    const result = await registry().query(
      'SELECT id, email FROM public.platform_users WHERE email = $1 AND email_verified_at IS NOT NULL AND disabled_at IS NULL LIMIT 1',
      [email.toLowerCase()],
    );
    if (result.rows[0]) {
      const token = await issueEmailToken(result.rows[0].id, 'reset_password');
      const resetUrl = `${env.PUBLIC_BASE_URL!.replace(/\/+$/, '')}/reset-password?token=${encodeURIComponent(token)}`;
      try {
        await sendEmail(result.rows[0].email, 'איפוס סיסמה ל-BTime',
          `<div dir="rtl" style="font-family:Arial,sans-serif;line-height:1.7"><h2>איפוס סיסמה</h2><p>כדי לבחור סיסמה חדשה, לחצו על הקישור:</p><p><a href="${resetUrl}">איפוס סיסמה</a></p><p>הקישור תקף ל-30 דקות. אם לא ביקשת לאפס סיסמה, אפשר להתעלם מההודעה.</p></div>`);
      } catch (error) {
        req.log.warn({ err: error }, 'password reset email could not be sent');
      }
    }
    return reply.code(202).send({ message: 'אם קיימת כתובת מאומתת המתאימה לפרטים, יישלח אליה קישור לאיפוס סיסמה.' });
  });

  app.post('/reset-password', { config: { rateLimit: { max: 5, timeWindow: '15 minutes' } } }, async (req) => {
    const { token, password } = ResetInput.parse(req.body);
    const db = registry();
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `SELECT t.id AS token_id, u.id AS user_id
           FROM public.platform_email_tokens t
           JOIN public.platform_users u ON u.id = t.user_id
          WHERE t.token_hash = $1 AND t.purpose = 'reset_password'
            AND t.consumed_at IS NULL AND t.expires_at > now() AND u.disabled_at IS NULL
          FOR UPDATE OF t`,
        [digest(token)],
      );
      if (!result.rows[0]) throw new HttpError(400, 'reset_link_invalid_or_expired');
      const userId = result.rows[0].user_id as string;
      await client.query('UPDATE public.platform_email_tokens SET consumed_at = now() WHERE user_id = $1 AND purpose = \'reset_password\' AND consumed_at IS NULL', [userId]);
      await client.query('UPDATE public.platform_users SET password_hash = $2, updated_at = now() WHERE id = $1', [userId, passwordHash(password)]);
      await client.query('UPDATE public.platform_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [userId]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
    return { reset: true, message: 'הסיסמה עודכנה. אפשר להתחבר מחדש.' };
  });
  app.post('/business', async (req, reply) => {
    const user = await currentUser(req);
    if (!user) throw new HttpError(401, 'not_authenticated');
    if (user.role === 'super_admin') throw new HttpError(403, 'super_admin_cannot_own_business');
    if (user.business_id) throw new HttpError(409, 'business_already_exists');
    const input = OwnerBusinessInput.parse(req.body);
    const created = await provisionBusinessForOwner(
      { id: user.id, email: user.email, phone: user.phone },
      input,
    );
    return reply.code(201).send({
      business: created,
      public_url: `${env.PUBLIC_BASE_URL!.replace(/\/+$/, '')}/biz/${created.slug}`,
      trial_days: 30,
    });
  });

  app.post('/management-link', async (req) => {
    const user = await currentUser(req);
    if (!user) throw new HttpError(401, 'not_authenticated');
    if (user.role === 'super_admin') throw new HttpError(403, 'super_admin_has_no_business_management_link');
    if (!user.business_id) throw new HttpError(404, 'business_not_found');
    const access = await registry().query(
      'SELECT app.is_tenant_subscription_accessible($1) AS allowed',
      [user.business_id],
    );
    if (access.rows[0]?.allowed !== true) throw new HttpError(403, 'subscription_inactive');
    const { token, tokenHash } = createManagementToken();
    await registry().query(
      "INSERT INTO public.access_tokens (tenant_id, token_hash, label, expires_at) VALUES ($1, $2, 'owner account session', now() + interval '8 hours')",
      [user.business_id, tokenHash],
    );
    return { management_url: `${env.PUBLIC_BASE_URL!.replace(/\/+$/, '')}/manage/${token}`, expires_in_hours: 8 };
  });

  app.post('/subscription/cancel', async (req) => {
    const user = await currentUser(req);
    if (!user) throw new HttpError(401, 'not_authenticated');
    if (!user.business_id) throw new HttpError(404, 'business_not_found');
    const db = registry();
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const updated = await client.query(
        "UPDATE public.platform_subscriptions SET status = 'canceled', canceled_at = now(), updated_at = now() WHERE tenant_id = $1 AND status IN ('trialing', 'active') RETURNING status",
        [user.business_id],
      );
      if (!updated.rowCount) throw new HttpError(409, 'subscription_not_cancellable');
      await client.query(
        "INSERT INTO public.platform_audit_log (actor_type, actor_user_id, actor_email, action, tenant_id) VALUES ('owner', $1, $2, 'subscription_cancelled', $3)",
        [user.id, user.email, user.business_id],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
    return { canceled: true, message: 'המנוי בוטל. אתר העסק וממשק הניהול נחסמו; החשבון האישי נשאר זמין.' };
  });

  app.post('/deletion-request', async (req, reply) => {
    const user = await currentUser(req);
    if (!user) throw new HttpError(401, 'not_authenticated');
    if (!user.business_id) throw new HttpError(404, 'business_not_found');
    const { reason } = DeletionRequestInput.parse(req.body ?? {});
    const db = registry();
    const inserted = await db.query(
      `INSERT INTO public.business_deletion_requests (tenant_id, business_name, business_slug, requested_by_user_id, reason)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (tenant_id) WHERE status = 'pending' DO NOTHING
       RETURNING id, status, requested_at`,
      [user.business_id, user.business_name, user.business_slug, user.id, reason || null],
    );
    const request = inserted.rows[0] ?? (await db.query(
      "SELECT id, status, requested_at FROM public.business_deletion_requests WHERE tenant_id = $1 AND status = 'pending' LIMIT 1",
      [user.business_id],
    )).rows[0];
    if (inserted.rowCount) {
      await db.query(
        "INSERT INTO public.platform_audit_log (actor_type, actor_user_id, actor_email, action, tenant_id, metadata) VALUES ('owner', $1, $2, 'business_deletion_requested', $3, $4::jsonb)",
        [user.id, user.email, user.business_id, JSON.stringify({ request_id: request.id })],
      );
    }
    return reply.code(inserted.rowCount ? 201 : 200).send({
      request,
      message: 'בקשת המחיקה נשלחה וממתינה לאישור מנהל. העסק והנתונים לא יימחקו עד לאישור מפורש.',
    });
  });

};
