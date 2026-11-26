import { closeTenantPools, pool } from '../src/db';
import { runPushRecovery } from '../src/pushRecovery';

async function main(): Promise<void> {
  try {
    const result = await runPushRecovery();
    if (result.failures > 0) process.exitCode = 1;
  } finally {
    await closeTenantPools();
    await pool.end();
  }
}

main().catch((error) => {
  console.error('Push outbox recovery terminated:', error instanceof Error ? error.message : 'unknown error');
  process.exitCode = 1;
});
