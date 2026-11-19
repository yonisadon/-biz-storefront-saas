const RETRYABLE_STATUSES = new Set([500, 502, 503, 504]);
const RETRY_DELAYS_MS = [350, 900];

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

/**
 * Retry only safe reads. Mutating requests must never be replayed automatically:
 * a timeout can happen after the server has already committed the operation.
 */
export async function fetchWithTransientRetry(input, init = {}, fetcher = fetch, sleep = wait) {
  const method = String(init.method ?? 'GET').toUpperCase();
  const canRetry = method === 'GET' || method === 'HEAD';
  const maxAttempts = canRetry ? RETRY_DELAYS_MS.length + 1 : 1;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const response = await fetcher(input, init);
      if (!canRetry || !RETRYABLE_STATUSES.has(response.status) || attempt === maxAttempts - 1) {
        return response;
      }
      await response.body?.cancel().catch(() => {});
    } catch (error) {
      if (!canRetry || init.signal?.aborted || error?.name === 'AbortError' || attempt === maxAttempts - 1) {
        throw error;
      }
    }

    await sleep(RETRY_DELAYS_MS[attempt]);
  }

  throw new Error('Transient request retry exhausted');
}
