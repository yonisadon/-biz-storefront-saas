const TOKEN_RE = /^[A-Za-z0-9_-]{43,128}$/;

/**
 * Convert an API-provided management URL into a same-origin path.
 * The backend may return the production hostname while the frontend is
 * running on a Vercel Preview hostname. Only the validated /manage/{token}
 * path is used for browser navigation; an API response can never redirect
 * the browser to another origin.
 */
export function sameOriginManagementPath(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const raw = value.trim();
  if (raw.startsWith('//') || raw.includes('\\') || /[\r\n]/.test(raw)) return null;

  let parsed: URL;
  try {
    parsed = new URL(raw, 'https://btime.invalid');
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  if (parsed.username || parsed.password || parsed.search || parsed.hash) return null;

  const match = parsed.pathname.match(/^\/manage\/([A-Za-z0-9_-]{43,128})\/?$/);
  return match && TOKEN_RE.test(match[1]) ? '/manage/' + match[1] : null;
}
