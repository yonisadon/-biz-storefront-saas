export class ApiError extends Error {
  constructor(public status: number, public body: any) {
    super(body?.error ?? 'error');
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

export async function mupload<T>(token: string, path: string, file: Blob, filename = 'photo.jpg'): Promise<T> {
  const fd = new FormData();
  fd.append('file', file, filename); // no content-type header: the browser adds the boundary
  const res = await fetch(`/api/manage/${token}/${path}`, { method: 'POST', body: fd, cache: 'no-store' });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, body);
  return body as T;
}

export function uploadErrorText(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.status) {
      case 413: return 'הקובץ גדול מדי (מעל 10MB).';
      case 415: return err.body?.error === 'animated_not_supported'
        ? 'קבצים מונפשים אינם נתמכים.' : 'סוג הקובץ אינו נתמך. אפשר להעלות JPG, PNG או WebP.';
      case 422: return 'לא הצלחנו לקרוא את התמונה. נסו קובץ אחר.';
      case 409: return err.body?.error === 'gallery_full'
        ? 'הגלריה מלאה (עד 7 תמונות).' : 'הפעולה התנגשה בשינוי אחר, נסו שוב.';
      case 404: return 'הפריט לא נמצא.';
      case 429: return 'יותר מדי העלאות. נסו שוב בעוד דקה.';
    }
  }
  if (err instanceof Error && err.message === 'type') return 'סוג הקובץ אינו נתמך. אפשר להעלות JPG, PNG או WebP.';
  if (err instanceof Error && err.message === 'size') return 'הקובץ גדול מדי (מעל 10MB).';
  return 'ההעלאה נכשלה. נסו שוב.';
}