import { closeTenantPools, pool } from '../src/db';
import { isGoogleCalendarConfigured, processGoogleCalendarJobs } from '../src/googleCalendarService';

async function main() {
  if (!isGoogleCalendarConfigured()) {
    console.log('Google Calendar OAuth is not configured; no jobs were processed.');
    return;
  }

  const tenants = await pool.query(
    'SELECT tenant_id FROM app.tenant_databases ORDER BY tenant_id',
  );
  let processed = 0;
  let failed = 0;
  let pending = 0;
  let connected = 0;

  for (const row of tenants.rows as { tenant_id: string }[]) {
    try {
      const result = await processGoogleCalendarJobs(row.tenant_id, 20);
      if (result.connected) connected++;
      processed += result.processed;
      failed += result.failed;
      pending += result.pending;
    } catch (error) {
      console.error(`Google Calendar sync failed for tenant ${row.tenant_id}:`,
        error instanceof Error ? error.message : String(error));
      failed++;
    }
  }

  console.log(JSON.stringify({ tenants: tenants.rowCount, connected, processed, failed, pending }));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => { await closeTenantPools(); await pool.end(); });
