import { connectRegistryWithRetry, queryRegistryWithRetry } from './db';
import { processPushOutboxForTenant } from './pushService';

const LOCK_NAMESPACE = 74122;
const LOCK_KEY = 93003;
const EVENTS_PER_TENANT_PER_RUN = 20;
const RUN_INTERVAL_MS = 24 * 60 * 60 * 1000;

export type PushRecoveryResult = {
  processed: number;
  failures: number;
  skipped: boolean;
};

export async function runPushRecovery(): Promise<PushRecoveryResult> {
  let lockClient: Awaited<ReturnType<typeof connectRegistryWithRetry>> | null = null;
  let lockAcquired = false;
  let failures = 0;
  let processed = 0;
  try {
    lockClient = await connectRegistryWithRetry();
    const lock = await lockClient.query(
      'SELECT pg_try_advisory_lock($1, $2) AS locked',
      [LOCK_NAMESPACE, LOCK_KEY],
    );
    if (!lock.rows[0]?.locked) {
      console.info('Push outbox recovery skipped: another run already holds the lock.');
      return { processed: 0, failures: 0, skipped: true };
    }
    lockAcquired = true;

    const tenants = await queryRegistryWithRetry(
      "SELECT td.tenant_id FROM app.tenant_databases td " +
      "JOIN public.businesses b ON b.id = td.tenant_id " +
      "WHERE b.status = 'active' ORDER BY td.tenant_id",
    );
    console.info('Push outbox recovery started for ' + tenants.rows.length + ' active tenant(s).');

    for (const row of tenants.rows) {
      const tenantId = String(row.tenant_id);
      try {
        processed += await processPushOutboxForTenant(tenantId, EVENTS_PER_TENANT_PER_RUN);
      } catch (error) {
        failures++;
        console.error('Push outbox recovery failed for tenant ' + tenantId + ':',
          error instanceof Error ? error.message : 'unknown error');
      }
    }
    console.info('Push outbox recovery finished. Events checked: ' + processed + '; tenant failures: ' + failures + '.');
    return { processed, failures, skipped: false };
  } finally {
    if (lockClient) {
      if (lockAcquired) {
        await lockClient.query(
          'SELECT pg_advisory_unlock($1, $2)',
          [LOCK_NAMESPACE, LOCK_KEY],
        ).catch(() => {});
      }
      lockClient.release();
    }
  }
}

export function startPushRecoveryScheduler(): NodeJS.Timeout {
  console.info('Push recovery scheduler enabled in API process; interval: 24 hours.');
  const timer = setInterval(() => {
    void runPushRecovery().catch((error) => {
      console.error('Push recovery scheduler run failed:', error instanceof Error ? error.message : 'unknown error');
    });
  }, RUN_INTERVAL_MS);
  timer.unref();
  return timer;
}
