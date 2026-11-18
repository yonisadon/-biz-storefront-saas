import VerifyEmailClient from '@/components/VerifyEmailClient';

export default async function VerifyEmailPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return <VerifyEmailClient token={token ?? ''} />;
}
