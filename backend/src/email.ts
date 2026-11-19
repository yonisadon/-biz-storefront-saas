import { env } from './config';
import { HttpError } from './errors';

type SendBrevoEmailInput = {
  to: string;
  subject: string;
  html: string;
  textContent: string;
};

export async function sendBrevoEmail(input: SendBrevoEmailInput): Promise<{ messageId: string | null }> {
  if (!env.BREVO_API_KEY || !env.EMAIL_FROM) {
    throw new HttpError(503, 'email_service_not_configured');
  }
  const match = env.EMAIL_FROM.match(/^(?:(.*?)\s*)?<([^<>]+)>$/);
  const senderEmail = match?.[2] ?? env.EMAIL_FROM;
  const senderName = match?.[1]?.trim() || 'BTime';
  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': env.BREVO_API_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({
      sender: { name: senderName, email: senderEmail },
      to: [{ email: input.to }],
      subject: input.subject,
      htmlContent: input.html,
      textContent: input.textContent,
    }),
  });
  if (!response.ok) {
    console.error('Brevo email request was not accepted', { status: response.status });
    throw new HttpError(503, 'email_delivery_failed');
  }
  const result = await response.json().catch(() => null) as { messageId?: string } | null;
  return { messageId: result?.messageId ?? null };
}
