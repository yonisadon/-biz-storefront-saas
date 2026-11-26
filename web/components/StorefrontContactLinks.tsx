'use client';

import { useStorefrontTranslation } from '@/components/StorefrontLanguageProvider';
import { toLocalPhone } from '@/lib/format';

type Props = { whatsappNumber?: string; instagramHref?: string; facebookHref?: string; phone?: string; email?: string };

export default function StorefrontContactLinks({ whatsappNumber, instagramHref, facebookHref, phone, email }: Props) {
  const t = useStorefrontTranslation();
  const phoneHref = phone ? `tel:${toLocalPhone(phone)}` : undefined;
  const whatsappHref = whatsappNumber
    ? `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(t('whatsappGreeting'))}`
    : undefined;
  return (
    <div className="flex flex-wrap items-center gap-3">
      {whatsappHref && <a href={whatsappHref} target="_blank" rel="noopener noreferrer" aria-label={t('openWhatsApp')} title="WhatsApp" className="flex h-12 w-12 items-center justify-center rounded-full bg-[#25D366] text-white shadow-sm transition hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"><svg viewBox="0 0 24 24" className="h-6 w-6" fill="currentColor" aria-hidden="true"><path d="M20.52 3.48A11.8 11.8 0 0 0 12.12 0C5.58 0 .25 5.33.25 11.87c0 2.1.55 4.15 1.6 5.96L.15 24l6.32-1.66a11.9 11.9 0 0 0 5.65 1.44h.01c6.54 0 11.87-5.33 11.87-11.87 0-3.17-1.23-6.15-3.48-8.43ZM12.13 21.76a9.9 9.9 0 0 1-5.05-1.38l-.36-.21-3.75.98 1-3.65-.24-.38a9.84 9.84 0 0 1-1.51-5.25c0-5.46 4.45-9.91 9.92-9.91 2.65 0 5.14 1.03 7.01 2.9a9.86 9.86 0 0 1 2.9 7.01c0 5.47-4.45 9.89-9.92 9.89Zm5.44-7.42c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.95 1.17-.17.2-.35.22-.65.07-.3-.15-1.26-.46-2.4-1.47-.89-.79-1.49-1.77-1.67-2.07-.17-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.18.2-.3.3-.5.1-.2.05-.37-.03-.52-.08-.15-.67-1.62-.92-2.22-.24-.58-.48-.5-.67-.51h-.57c-.2 0-.52.07-.79.37-.27.3-1.04 1.02-1.04 2.49s1.07 2.89 1.22 3.09c.15.2 2.1 3.2 5.08 4.49.71.31 1.27.5 1.7.64.71.23 1.36.2 1.87.12.57-.09 1.76-.72 2.01-1.42.25-.7.25-1.3.17-1.42-.07-.13-.27-.2-.57-.35Z"/></svg></a>}
      {instagramHref && <a href={instagramHref} target="_blank" rel="noopener noreferrer" aria-label={t('openInstagram')} title="Instagram" className="flex h-12 w-12 items-center justify-center rounded-full border border-ink/15 bg-white text-ink shadow-sm transition hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"><svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none"/></svg></a>}
      {facebookHref && <a href={facebookHref} target="_blank" rel="noopener noreferrer" aria-label={t('openFacebook')} title="Facebook" className="flex h-12 w-12 items-center justify-center rounded-full border border-ink/15 bg-white text-[#1877F2] shadow-sm transition hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"><svg viewBox="0 0 24 24" className="h-6 w-6" fill="currentColor" aria-hidden="true"><path d="M13.4 21v-8h2.7l.4-3.1h-3.1V8c0-.9.3-1.5 1.6-1.5h1.7V3.7c-.3 0-1.4-.1-2.6-.1-2.6 0-4.3 1.6-4.3 4.5v1.8H7V13h2.8v8h3.6Z"/></svg></a>}
      {phone && phoneHref && <a href={phoneHref} aria-label={`${t('callBusiness')} ${toLocalPhone(phone)}`} title={t('phone')} className="flex h-12 w-12 items-center justify-center rounded-full border border-ink/15 bg-white text-ink shadow-sm transition hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"><span aria-hidden="true" className="text-xl">☎</span></a>}
      {email && <a href={`mailto:${email}`} aria-label={`${t('sendEmail')} ${email}`} title={t('email')} className="flex h-12 w-12 items-center justify-center rounded-full border border-ink/15 bg-white text-ink shadow-sm transition hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"><span aria-hidden="true" className="text-xl">✉</span></a>}
    </div>
  );
}
