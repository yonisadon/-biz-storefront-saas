import type { FastifyBaseLogger } from 'fastify';
import type pg from 'pg';
import { env } from './config';
import { pool, withTenant } from './db';
import {
  createPushCapability, decryptPushSecret, encryptPushSecret, hashPushCapability,
  isSupportedPushEndpoint, PushDeliveryError, sendWebPush, type BrowserPushSubscription,
} from './pushCrypto';

export type PushTargetType = 'appointment' | 'waitlist';
export type PushAudience = 'seller' | 'customer';
export type PushEventType =
  | 'seller.appointment_created'
  | 'seller.waitlist_created'
  | 'customer.waitlist_scheduled'
  | 'customer.appointment_updated'
  | 'customer.appointment_cancelled';

const CAPABILITY_TTL_DAYS = 7;
const MAX_DELIVERIES = 10;
const MAX_ATTEMPTS = 8;

function runtimeConfigured(): boolean {
  return Boolean(env.WEB_PUSH_VAPID_PUBLIC_KEY && env.WEB_PUSH_VAPID_PRIVATE_KEY &&
    env.WEB_PUSH_VAPID_SUBJECT && env.PUSH_SUBSCRIPTION_ENCRYPTION_KEY);
}

export async function issuePushCapability(
  db: pg.PoolClient, tenantId: string, targetType: PushTargetType, targetId: string,
): Promise<string | null> {
  const existing = (await db.query(
    "SELECT opted_in_at, revoked_at FROM public.push_booking_capabilities WHERE tenant_id = $1 AND target_type = $2 AND target_id = $3 FOR UPDATE",
    [tenantId, targetType, targetId],
  )).rows[0];
  if (existing?.opted_in_at || existing?.revoked_at) return null;
  const capability = createPushCapability();
  const saved = await db.query(
    "INSERT INTO public.push_booking_capabilities (tenant_id, target_type, target_id, token_hash, expires_at) " +
    "VALUES ($1, $2, $3, $4, now() + ($5::int * interval '1 day')) " +
    "ON CONFLICT (tenant_id, target_type, target_id) DO UPDATE SET token_hash = EXCLUDED.token_hash, " +
    "expires_at = EXCLUDED.expires_at, created_at = now() " +
    "WHERE push_booking_capabilities.opted_in_at IS NULL AND push_booking_capabilities.revoked_at IS NULL RETURNING id",
    [tenantId, targetType, targetId, capability.tokenHash, CAPABILITY_TTL_DAYS],
  );
  return saved.rows[0] ? capability.token : null;
}

export async function enqueuePushEvent(
  db: pg.PoolClient, tenantId: string,
  event: {
    audience: PushAudience; eventType: PushEventType; targetType: PushTargetType; targetId: string;
    payload: { title: string; body: string; url: string };
  },
): Promise<string> {
  const result = await db.query(
    "INSERT INTO public.push_outbox (tenant_id, audience, event_type, target_type, target_id, payload) " +
    "VALUES ($1, $2, $3, $4, $5, $6::jsonb) RETURNING id",
    [tenantId, event.audience, event.eventType, event.targetType, event.targetId, JSON.stringify(event.payload)],
  );
  return result.rows[0].id as string;
}

type Delivery = {
  id: string; subscription_id: string; endpoint_ciphertext: string;
  p256dh_ciphertext: string; auth_ciphertext: string; attempts: number;
};

function backoff(attempt: number): Date {
  return new Date(Date.now() + Math.min(60_000 * (2 ** Math.max(0, attempt - 1)), 6 * 60 * 60 * 1000));
}

async function updateDelivery(
  tenantId: string, delivery: Delivery,
  result: { status: 'sent' | 'invalid' | 'pending' | 'failed'; code?: number; error?: string; retryAt?: Date },
): Promise<void> {
  await withTenant(tenantId, async (db) => {
    await db.query(
      "UPDATE public.push_deliveries SET status = $1, provider_status_code = $2, last_error = $3, " +
      "next_attempt_at = COALESCE($4::timestamptz, next_attempt_at), locked_until = NULL, " +
      "sent_at = CASE WHEN $1 = 'sent' THEN now() ELSE sent_at END WHERE id = $5",
      [result.status, result.code ?? null, result.error ?? null, result.retryAt ?? null, delivery.id],
    );
    if (result.status === 'invalid') {
      await db.query(
        "UPDATE public.push_subscriptions SET disabled_at = COALESCE(disabled_at, now()), updated_at = now() WHERE id = $1",
        [delivery.subscription_id],
      );
    }
  });
}

async function finishEvent(tenantId: string, eventId: string): Promise<void> {
  await withTenant(tenantId, async (db) => {
    await db.query(
      "UPDATE public.push_outbox e SET " +
      "status = CASE WHEN EXISTS (SELECT 1 FROM public.push_deliveries d WHERE d.tenant_id = e.tenant_id " +
      "AND d.outbox_id = e.id AND d.status IN ('pending', 'processing')) THEN 'pending' ELSE 'done' END, " +
      "next_attempt_at = COALESCE((SELECT min(d.next_attempt_at) FROM public.push_deliveries d " +
      "WHERE d.tenant_id = e.tenant_id AND d.outbox_id = e.id AND d.status IN ('pending', 'processing')), now()), " +
      "locked_until = NULL, processed_at = CASE WHEN EXISTS (SELECT 1 FROM public.push_deliveries d " +
      "WHERE d.tenant_id = e.tenant_id AND d.outbox_id = e.id AND d.status IN ('pending', 'processing')) " +
      "THEN NULL ELSE now() END WHERE e.id = $1",
      [eventId],
    );
  });
}

export async function processPushOutboxEvent(tenantId: string, eventId: string): Promise<void> {
  const entitlement = await pool.query(
    "SELECT enabled FROM public.platform_channel_entitlements WHERE tenant_id = $1 AND channel = 'push'",
    [tenantId],
  );
  const entitled = entitlement.rows[0]?.enabled === true;

  const claimed = await withTenant(tenantId, async (db) => {
    const event = (await db.query(
      "SELECT id, audience, target_type, target_id, payload FROM public.push_outbox " +
      "WHERE id = $1 AND status <> 'done' AND (locked_until IS NULL OR locked_until < now()) " +
      "FOR UPDATE SKIP LOCKED",
      [eventId],
    )).rows[0];
    if (!event) return null;

    if (!entitled) {
      await db.query("UPDATE public.push_outbox SET status = 'done', locked_until = NULL, processed_at = now(), last_error = 'channel_not_entitled' WHERE id = $1", [eventId]);
      return null;
    }
    const settings = (await db.query(
      "SELECT seller_enabled, customer_enabled FROM public.push_settings WHERE tenant_id = app.current_tenant_id()",
    )).rows[0];
    const audienceEnabled = event.audience === 'seller' ? settings?.seller_enabled === true : settings?.customer_enabled === true;
    if (!audienceEnabled) {
      await db.query("UPDATE public.push_outbox SET status = 'done', locked_until = NULL, processed_at = now(), last_error = 'audience_disabled' WHERE id = $1", [eventId]);
      return null;
    }
    if (!runtimeConfigured()) {
      await db.query("UPDATE public.push_outbox SET status = 'pending', next_attempt_at = now() + interval '30 minutes', locked_until = NULL, last_error = 'push_runtime_not_configured' WHERE id = $1", [eventId]);
      return null;
    }

    await db.query("UPDATE public.push_outbox SET status = 'processing', attempts = attempts + 1, locked_until = now() + interval '1 minute' WHERE id = $1", [eventId]);
    const subscriptions = event.audience === 'seller'
      ? (await db.query(
          "SELECT id FROM public.push_subscriptions WHERE tenant_id = app.current_tenant_id() AND audience = 'seller' AND disabled_at IS NULL",
        )).rows
      : (await db.query(
          "SELECT s.id FROM public.push_subscriptions s JOIN public.push_consents c " +
          "ON c.tenant_id = s.tenant_id AND c.subscription_id = s.id " +
          "WHERE s.tenant_id = app.current_tenant_id() AND s.audience = 'customer' AND s.disabled_at IS NULL " +
          "AND c.target_type = $1 AND c.target_id = $2 AND c.revoked_at IS NULL",
          [event.target_type, event.target_id],
        )).rows;

    if (!subscriptions.length) {
      await db.query("UPDATE public.push_outbox SET status = 'done', locked_until = NULL, processed_at = now() WHERE id = $1", [eventId]);
      return null;
    }
    for (const sub of subscriptions) {
      await db.query(
        "INSERT INTO public.push_deliveries (tenant_id, outbox_id, subscription_id) " +
        "VALUES (app.current_tenant_id(), $1, $2) ON CONFLICT (tenant_id, outbox_id, subscription_id) DO NOTHING",
        [eventId, sub.id],
      );
    }
    const deliveries = (await db.query(
      "SELECT d.id, d.subscription_id, d.attempts, s.endpoint_ciphertext, s.p256dh_ciphertext, s.auth_ciphertext " +
      "FROM public.push_deliveries d JOIN public.push_subscriptions s " +
      "ON s.tenant_id = d.tenant_id AND s.id = d.subscription_id " +
      "WHERE d.tenant_id = app.current_tenant_id() AND d.outbox_id = $1 AND s.disabled_at IS NULL " +
      "AND ((d.status = 'pending' AND d.next_attempt_at <= now()) OR (d.status = 'processing' AND d.locked_until < now())) " +
      "ORDER BY d.created_at LIMIT $2 FOR UPDATE OF d SKIP LOCKED",
      [eventId, MAX_DELIVERIES],
    )).rows as Delivery[];
    if (!deliveries.length) {
      await db.query(
        "UPDATE public.push_outbox SET status = CASE WHEN EXISTS (SELECT 1 FROM public.push_deliveries " +
        "WHERE tenant_id = app.current_tenant_id() AND outbox_id = $1 AND status IN ('pending', 'processing')) " +
        "THEN 'pending' ELSE 'done' END, locked_until = NULL WHERE id = $1",
        [eventId],
      );
      return null;
    }
    await db.query(
      "UPDATE public.push_deliveries SET status = 'processing', attempts = attempts + 1, " +
      "locked_until = now() + interval '30 seconds' WHERE id = ANY($1::uuid[])",
      [deliveries.map((d) => d.id)],
    );
    return {
      payload: event.payload as Record<string, unknown>,
      deliveries: deliveries.map((d) => ({ ...d, attempts: d.attempts + 1 })),
    };
  });

  if (!claimed) return;
  const key = env.PUSH_SUBSCRIPTION_ENCRYPTION_KEY!;
  const results = await Promise.allSettled(claimed.deliveries.map(async (delivery) => {
    try {
      const subscription: BrowserPushSubscription = {
        endpoint: decryptPushSecret(delivery.endpoint_ciphertext, key),
        keys: {
          p256dh: decryptPushSecret(delivery.p256dh_ciphertext, key),
          auth: decryptPushSecret(delivery.auth_ciphertext, key),
        },
      };
      const status = await sendWebPush(subscription, claimed.payload, {
        vapidPublicKey: env.WEB_PUSH_VAPID_PUBLIC_KEY!,
        vapidPrivateKey: env.WEB_PUSH_VAPID_PRIVATE_KEY!,
        vapidSubject: env.WEB_PUSH_VAPID_SUBJECT!,
        timeoutMs: 8000,
      });
      await updateDelivery(tenantId, delivery, { status: 'sent', code: status });
    } catch (error) {
      const pushError = error instanceof PushDeliveryError ? error : null;
      const code = pushError?.statusCode ?? null;
      if (code === 404 || code === 410) {
        await updateDelivery(tenantId, delivery, { status: 'invalid', code, error: 'subscription_gone' });
        return;
      }
      const transient = Boolean(pushError) && (code === null || code === 408 || code === 429 || (code !== null && code >= 500));
      const retry = transient && delivery.attempts < MAX_ATTEMPTS;
      await updateDelivery(tenantId, delivery, {
        status: retry ? 'pending' : 'failed',
        code: code ?? undefined,
        error: pushError?.message ?? 'push_delivery_failed',
        retryAt: retry ? backoff(delivery.attempts) : undefined,
      });
    }
  }));
  const failedWrite = results.find((r) => r.status === 'rejected');
  if (failedWrite?.status === 'rejected') throw failedWrite.reason;
  await finishEvent(tenantId, eventId);
}

export async function processPushOutboxForTenant(tenantId: string, limit = 20): Promise<number> {
  const ids = await withTenant(tenantId, async (db) => {
    const result = await db.query(
      "SELECT id FROM public.push_outbox WHERE status IN ('pending', 'processing') " +
      "AND next_attempt_at <= now() AND (locked_until IS NULL OR locked_until < now()) " +
      "ORDER BY created_at LIMIT $1",
      [limit],
    );
    return result.rows.map((row) => row.id as string);
  });
  let count = 0;
  for (const id of ids) {
    await processPushOutboxEvent(tenantId, id);
    count++;
  }
  return count;
}

export async function dispatchPushEventAfterCommit(
  tenantId: string, eventId: string, logger: FastifyBaseLogger,
): Promise<void> {
  try {
    await processPushOutboxEvent(tenantId, eventId);
  } catch (error) {
    logger.warn({ err: error, eventId }, 'Web Push dispatch deferred to recovery');
  }
}

export async function savePushSubscription(
  db: pg.PoolClient, tenantId: string, audience: PushAudience, subscription: BrowserPushSubscription,
): Promise<string> {
  if (!isSupportedPushEndpoint(subscription.endpoint)) throw new Error('Unsupported Push service endpoint.');
  if (Buffer.from(subscription.keys.p256dh, 'base64url').length !== 65 ||
      Buffer.from(subscription.keys.auth, 'base64url').length !== 16) {
    throw new Error('Invalid Push subscription keys.');
  }
  const key = env.PUSH_SUBSCRIPTION_ENCRYPTION_KEY;
  if (!key) throw new Error('Push subscription encryption is not configured.');
  const endpointHash = hashPushCapability(subscription.endpoint);
  const result = await db.query(
    "INSERT INTO public.push_subscriptions (tenant_id, audience, endpoint_hash, endpoint_ciphertext, p256dh_ciphertext, auth_ciphertext) " +
    "VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (tenant_id, audience, endpoint_hash) DO UPDATE SET " +
    "endpoint_ciphertext = EXCLUDED.endpoint_ciphertext, p256dh_ciphertext = EXCLUDED.p256dh_ciphertext, " +
    "auth_ciphertext = EXCLUDED.auth_ciphertext, disabled_at = NULL, updated_at = now() RETURNING id",
    [tenantId, audience, endpointHash, encryptPushSecret(subscription.endpoint, key),
      encryptPushSecret(subscription.keys.p256dh, key), encryptPushSecret(subscription.keys.auth, key)],
  );
  return result.rows[0].id as string;
}
