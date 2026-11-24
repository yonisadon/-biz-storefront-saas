const TRANSIENT_DATABASE_CODES = new Set([
  'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH',
  'EAI_AGAIN', '57P03', '08000', '08001', '08003', '08006',
]);

const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

/**
 * Retry only transient connection/startup failures. Callers must pass an
 * operation that is safe to retry (for example a read query or connection
 * validation), never a transaction whose commit outcome may be uncertain.
 */
export async function retryTransientOperation<T>(
  operation: () => Promise<T>,
  label: string,
  maxAttempts = 6,
): Promise<T> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await operation();
      if (attempt > 1) console.info('Database connection recovered for ' + label + ' after ' + attempt + ' attempts.');
      return result;
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (!code || !TRANSIENT_DATABASE_CODES.has(code) || attempt === maxAttempts) {
        console.error('Database operation failed for ' + label + ' (attempt ' + attempt + '/' + maxAttempts + '; code ' + (code ?? 'unknown') + ').');
        throw error;
      }
      const delayMs = Math.min(250 * (2 ** (attempt - 1)), 3000);
      console.warn('Database is not ready for ' + label + ' (attempt ' + attempt + '/' + maxAttempts + '; code ' + code + '); retrying in ' + delayMs + 'ms.');
      await sleep(delayMs);
    }
  }
  throw new Error('Database did not become available for ' + label + '.');
}
