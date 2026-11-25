import { closeTenantPools, connectRegistryWithRetry, pool, queryRegistryWithRetry } from '../src/db';
import { processPushOutboxForTenant } from '../src/pushService';

const LOCK_NAMESPACE = 74122;
const LOCK_KEY = 93003;

async function main(): Promise<void> {
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
      return;
    }
    lockAcquired = true;

    const tenants = await queryRegistryWithRetry(
      'SELECT td.tenant_id FROM app.tenant_databases td JOIN public.businesses b ON b.id = td.tenant_id WHERE b.status = \'active\' ORDER BY td.tenant_id',
    );
    console.info('Push outbox recovery started for ' + tenants.rows.length + ' tenants.');

    for (const row of tenants.rows) {
      const tenantId = String(row.tenant_id);
      try {
        const count = await processPushOutboxForTenant(tenantId, 20);
        processed += count;
      } catch (error) {
        failures++;
        console.error('Push outbox recovery failed for tenant ' + tenantId + ':',
          error instanceof Error ? error.message : 'unknown error');
      }
    }
    console.info('Push outbox recovery finished. Events checked: ' + processed + '; tenant failures: ' + failures + '.');
    if (failures > 0) process.exitCode = 1;
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
    await closeTenantPools();
    await pool.end();
  }
}

main().catch((error) => {
  console.error('Push outbox recovery terminated:', error instanceof Error ? error.message : 'unknown error');
  process.exitCode = 1;
});
