import { connectRegistryWithRetry, queryRegistryWithRetry, withTenant } from './db';
import { storage, variantKeys } from './storage';

const LOCK_NAMESPACE = 74122;
const LOCK_KEY = 93004;
const MEDIA_BATCH_SIZE = 50;
const MEDIA_MIN_AGE_MINUTES = 15;
const RUN_INTERVAL_MS = 2 * 60 * 60 * 1000;

async function runPendingMediaCleanup(): Promise<void> {
  let lockClient: Awaited<ReturnType<typeof connectRegistryWithRetry>> | null = null;
  let lockAcquired = false;
  try {
    lockClient = await connectRegistryWithRetry();
    const lock = await lockClient.query(
      'SELECT pg_try_advisory_lock($1, $2) AS locked',
      [LOCK_NAMESPACE, LOCK_KEY],
    );
    if (!lock.rows[0]?.locked) {
      console.info('Media cleanup skipped: another API replica holds the cleanup lock.');
      return;
    }
    lockAcquired = true;

    const tenants = await queryRegistryWithRetry(
      "SELECT td.tenant_id FROM app.tenant_databases td " +
      "JOIN public.businesses b ON b.id = td.tenant_id " +
      "WHERE b.status = 'active' ORDER BY td.tenant_id",
    );
    let deleted = 0;
    let failures = 0;

    for (const row of tenants.rows) {
      const tenantId = String(row.tenant_id);
      try {
        const count = await withTenant(tenantId, async (db) => {
          await db.query("SELECT set_config('statement_timeout', '30000', true)");
          const pending = await db.query(
            "SELECT m.id, m.storage_key FROM public.media_assets m " +
            "WHERE m.tenant_id = app.current_tenant_id() " +
            "AND m.deleted_at IS NOT NULL " +
            "AND m.deleted_at <= now() - ($1::int * interval '1 minute') " +
            "AND NOT EXISTS (SELECT 1 FROM public.products p WHERE p.image_asset_id = m.id) " +
            "AND NOT EXISTS (SELECT 1 FROM public.product_images pi WHERE pi.asset_id = m.id) " +
            "AND NOT EXISTS (SELECT 1 FROM public.portfolio_images g WHERE g.asset_id = m.id) " +
            "ORDER BY m.deleted_at, m.id LIMIT $2 FOR UPDATE SKIP LOCKED",
            [MEDIA_MIN_AGE_MINUTES, MEDIA_BATCH_SIZE],
          );
          if (!pending.rows.length) return 0;

          // Keep the tenant transaction/row locks until storage confirms deletion.
          // On any storage error the transaction rolls back and the tracking rows remain.
          await storage.remove(pending.rows.flatMap((asset: { storage_key: string }) => variantKeys(asset.storage_key)));
          const finalized = await db.query(
            "DELETE FROM public.media_assets m " +
            "WHERE m.tenant_id = app.current_tenant_id() " +
            "AND m.id = ANY($1::uuid[]) AND m.deleted_at IS NOT NULL " +
            "AND NOT EXISTS (SELECT 1 FROM public.products p WHERE p.image_asset_id = m.id) " +
            "AND NOT EXISTS (SELECT 1 FROM public.product_images pi WHERE pi.asset_id = m.id) " +
            "AND NOT EXISTS (SELECT 1 FROM public.portfolio_images g WHERE g.asset_id = m.id) " +
            "RETURNING m.id",
            [pending.rows.map((asset: { id: string }) => asset.id)],
          );
          return finalized.rowCount ?? 0;
        });
        deleted += count;
      } catch (error) {
        failures++;
        console.error('Media cleanup failed for tenant ' + tenantId + '; tracked assets retained for retry:',
          error instanceof Error ? error.message : 'unknown error');
      }
    }
    console.info('Media cleanup finished. Assets deleted: ' + deleted + '; tenant failures: ' + failures + '.');
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

export function startMediaCleanupScheduler(): NodeJS.Timeout {
  console.info('Media cleanup scheduler enabled in API process; interval: 2 hours.');
  const timer = setInterval(() => {
    void runPendingMediaCleanup().catch((error) => {
      console.error('Media cleanup scheduler run failed:', error instanceof Error ? error.message : 'unknown error');
    });
  }, RUN_INTERVAL_MS);
  timer.unref();
  return timer;
}
