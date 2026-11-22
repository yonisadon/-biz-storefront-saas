import '../auth.css';
import AccountAuthForm from '@/components/AccountAuthForm';

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const { next } = await searchParams;
  return <AccountAuthForm mode="login" returnTo={typeof next === 'string' ? next : undefined} />;
}
