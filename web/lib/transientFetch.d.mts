export declare function fetchWithTransientRetry(input: RequestInfo | URL, init?: RequestInit, fetcher?: typeof fetch, sleep?: (milliseconds: number) => Promise<void>): Promise<Response>;
