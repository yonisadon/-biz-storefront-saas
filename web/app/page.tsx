import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { resolveRequestHost } from '@/lib/host-routing';

export default async function Home() {
  const requestHeaders = await headers();
  const { host, isPlatform } = resolveRequestHost(requestHeaders);
  if (!host) notFound();

  // Platform home is the management console. Any non-platform host must go
  // through the verified tenant resolver, even if middleware did not rewrite.
  redirect(isPlatform ? '/platform-admin' : '/biz/_site');
}
