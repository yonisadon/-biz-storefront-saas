import { translatePlatform, type PlatformLanguage, type PlatformMessageKey } from '@/lib/platformI18n';

function currentLanguage(): PlatformLanguage {
  if (typeof window === 'undefined') return 'he';
  try { const value = window.localStorage.getItem('btime-platform-language'); return value === 'en' || value === 'ru' ? value : 'he'; } catch { return 'he'; }
}

const API_ERROR_KEYS: Record<string, PlatformMessageKey> = {
  not_found: 'notFound', item_not_found: 'notFound', unauthorized: 'accessDenied', forbidden: 'accessDenied',
  invalid_config: 'invalidConfig', invalid_contact_options: 'invalidConfig', validation_error: 'invalidConfig',
  constraint_violation: 'constraintViolation', conflict: 'conflictError', version_conflict: 'conflictError',
  rate_limit_exceeded: 'rateLimited', too_many_requests: 'rateLimited', internal_error: 'serverUnavailable',
  service_unavailable: 'serverUnavailable', gallery_full: 'galleryFull', product_images_full: 'productImagesFull',
};

export function translateManageApiError(status: number, body: ApiErrorBody | null): string {
  const language = currentLanguage();
  const key = body?.error ? API_ERROR_KEYS[body.error] : undefined;
  if (key) return translatePlatform(language, key);
  if (status === 401 || status === 403) return translatePlatform(language, 'accessDenied');
  if (status === 404) return translatePlatform(language, 'notFound');
  if (status === 409) return translatePlatform(language, 'conflictError');
  if (status === 413) return translatePlatform(language, 'uploadTooLarge');
  if (status === 415) return translatePlatform(language, 'uploadUnsupported');
  if (status === 422) return translatePlatform(language, 'uploadReadFailed');
  if (status === 429) return translatePlatform(language, 'rateLimited');
  return translatePlatform(language, 'genericApiError');
}

export type ApiErrorBody = { error?: string; issues?: { message: string }[]; [key: string]: unknown };

export class ApiError extends Error {
  constructor(public status: number, public body: ApiErrorBody | null) {
    super(translateManageApiError(status, body));
  }
}

export async function mcall<T>(
  token: string, path: string, init?: Omit<RequestInit, 'body'> & { body?: string },
): Promise<T> {
  const headers: Record<string, string> = {};
  if (init?.body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(`/api/manage/${token}/${path}`, { ...init, cache: 'no-store', headers });
  const body = await res.json().catch(() => null); // 204 has no body
  if (!res.ok) throw new ApiError(res.status, body);
  return body as T;
}

/**
 * Management actions can otherwise leave a panel in a permanent loading state
 * when the API or a sleeping backend never completes the request.
 */
export async function mcallWithTimeout<T>(
  token: string, path: string, init?: Omit<RequestInit, 'body'> & { body?: string }, timeoutMs = 45_000,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await mcall<T>(token, path, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function mupload<T>(token: string, path: string, file: Blob, filename = 'photo.jpg', method: 'POST' | 'PUT' = 'POST'): Promise<T> {
  const fd = new FormData();
  fd.append('file', file, filename); // no content-type header: the browser adds the boundary
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90_000);
  try {
    const res = await fetch(`/api/manage/${token}/${path}`, { method, body: fd, cache: 'no-store', signal: controller.signal });
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new ApiError(res.status, body);
    return body as T;
  } finally {
    clearTimeout(timer);
  }
}

export function uploadErrorText(err: unknown): string {
  const language = currentLanguage();
  const t = (key: PlatformMessageKey) => translatePlatform(language, key);
  if (err instanceof ApiError) {
    switch (err.status) {
      case 413: return t('uploadTooLarge');
      case 415: return err.body?.error === 'animated_not_supported' ? t('uploadUnsupported') : t('uploadUnsupported');
      case 422: return t('uploadReadFailed');
      case 409: return err.body?.error === 'gallery_full' ? t('galleryFull')
        : err.body?.error === 'product_images_full' ? t('productImagesFull') : t('conflictError');
      case 404: return t('notFound');
      case 429: return t('rateLimited');
    }
    return err.message;
  }
  if (err instanceof Error && err.name === 'AbortError') return t('genericApiError');
  if (err instanceof Error && err.message === 'type') return t('uploadUnsupported');
  if (err instanceof Error && err.message === 'size') return t('uploadTooLarge');
  return t('uploadFailed');
}
