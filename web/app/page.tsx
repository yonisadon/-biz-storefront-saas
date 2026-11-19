import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { resolveRequestHost } from '@/lib/host-routing';
import PlatformMarketingPage from '@/components/PlatformMarketingPage';
import './marketing.css';

export default async function Home() {
  const requestHeaders = await headers();
  const { host, isPlatform } = resolveRequestHost(requestHeaders);
  if (!host) notFound();

  // Platform domains show the public BTime marketing page. Customer domains
  // must always resolve through the verified tenant storefront route.
  if (!isPlatform) redirect('/biz/_site');
  return <PlatformMarketingPage />;
}
