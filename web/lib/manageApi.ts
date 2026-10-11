export class ApiError extends Error {
  constructor(public status: number, public body: any) {
    super(body?.error ?? 'error');
  }
}
export async function mcall<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/manage/${token}/${path}`, {
    ...init,
    cache: 'no-store',
    headers: { 'content-type': 'application/json', ...init?.headers },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, body);
  return body as T;
}