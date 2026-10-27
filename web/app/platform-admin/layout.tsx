import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { resolveRequestHost } from '@/lib/host-routing';

export default async function PlatformAdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const requestHeaders = await headers();
  const { isPlatform } = resolveRequestHost(requestHeaders);

  // Defense in depth: never render the platform admin UI on a customer domain.
  if (!isPlatform) notFound();

  return children;
}
