/**
 * Normalize a user-supplied DNS hostname without accepting URLs, ports, paths,
 * wildcards, IP literals, or malformed labels. Returns null for invalid input.
 */
export function normalizeDomain(input: string): string | null {
  const raw = input.trim().toLowerCase().replace(/\.$/, '');
  if (!raw || raw.length > 253 || raw.includes('://') || /[/:*?#@\s]/.test(raw)) return null;

  let hostname: string;
  try {
    hostname = new URL(`https://${raw}`).hostname.toLowerCase().replace(/\.$/, '');
  } catch {
    return null;
  }

  if (!hostname || hostname.length > 253 || hostname.includes(':')) return null;
  const labels = hostname.split('.');
  if (labels.length < 2 || labels.some((label) =>
    label.length < 1 || label.length > 63 ||
    !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)
  )) return null;

  const tld = labels[labels.length - 1];
  if (tld.length < 2 || !/[a-z]/.test(tld)) return null;

  // Reject IPv4 literals (including URL-parser-normalized numeric forms).
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(hostname)) return null;
  return hostname;
}
