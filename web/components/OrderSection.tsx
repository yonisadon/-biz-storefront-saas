'use client';

import Image from 'next/image';
import { useMemo, useRef, useState } from 'react';
import { ils, normalizeILPhone } from '@/lib/format';
import type { OrderFlow, Product } from '@/lib/types';

type Props = { apiBase: string; items: Product[]; quoteLabel: string; flow: OrderFlow };
type Route = 'whatsapp' | 'site';
type Done = { route: 'site'; message: string } | { route: 'whatsapp'; url: string };

function errorText(status: number, d: any): string {
  if (status === 429) return 'בוצעו יותר מדי ניסיונות. נסו שוב בעוד דקה.';
  if (status === 403) return 'מסלול ההזמנה הזה אינו זמין כרגע.';
  const msgs: string[] = (d?.issues ?? []).map((i: any) => i.message);
  if (msgs.includes('invalid_il_phone')) return 'מספר הטלפון אינו תקין.';
  if (msgs.includes('items_or_message_required')) return 'בחרו פריט או כתבו הודעה.';
  if (d?.error === 'unknown_product') return 'אחד הפריטים כבר אינו זמין. רעננו את הדף ונסו שוב.';
  return 'לא הצלחנו לשלוח. נסו שוב.';
}

function Stepper({ q, onChange, label }: { q: number; onChange: (n: number) => void; label: string }) {
  const btn = 'h-9 w-9 rounded-full border border-ink/25 text-lg leading-none';
  return (
    <div className="flex items-center gap-1" role="group" aria-label={label}>
      <button type="button" className={btn} aria-label="הפחתת כמות" onClick={() => onChange(q - 1)}>−</button>
      <span className="w-8 text-center font-semibold" aria-live="polite">{q}</span>
      <button type="button" className={btn} aria-label="הוספת כמות" onClick={() => onChange(q + 1)}>+</button>
    </div>
  );
}

export default function OrderSection({ apiBase, items, quoteLabel, flow }: Props) {
  const dlg = useRef<HTMLDialogElement>(null);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [form, setForm] = useState({ name: '', phone: '', email: '', message: '', hp: '' });
  const [busy, setBusy] = useState<Route | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);

  const canOrder = flow.whatsapp_enabled || flow.site_inquiry_enabled;
  const byId = useMemo(() => new Map(items.map((p) => [p.id, p])), [items]);
  const lines = Object.entries(cart)
    .map(([id, q]) => ({ p: byId.get(id)!, q }))
    .filter((l) => l.p);
  const count = lines.reduce((s, l) => s + l.q, 0);
  const priced = lines.filter((l) => l.p.price_agorot !== null);
  const total = priced.reduce((s, l) => s + l.p.price_agorot! * l.q, 0);
  const hasQuote = lines.some((l) => l.p.price_agorot === null);
  const totalText = priced.length === 0 ? (hasQuote ? quoteLabel : '')
    : hasQuote ? `${ils(total)} + ${quoteLabel}` : ils(total);

  const setQty = (id: string, q: number) =>
    setCart((c) => {
      const n = { ...c };
      if (q <= 0) delete n[id]; else n[id] = Math.min(99, q);
      return n;
    });

  const setField = (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(route: Route) {
    setError(null);
    const phone = normalizeILPhone(form.phone);
    if (!form.name.trim()) return setError('נא להזין שם מלא.');
    if (!phone) return setError('נא להזין מספר טלפון ישראלי תקין.');
    if (count === 0 && !form.message.trim()) return setError('בחרו פריט או כתבו הודעה.');

    setBusy(route);
    try {
      const res = await fetch(`${apiBase}/leads`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          route,
          customer_name: form.name.trim(),
          customer_phone: form.phone,
          customer_email: form.email.trim() || undefined,
          message: form.message.trim() || undefined,
          items: Object.entries(cart).map(([product_id, quantity]) => ({ product_id, quantity })),
          company_website: form.hp, // honeypot
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) return setError(errorText(res.status, data));

      setCart({});
      if (data.route === 'whatsapp' && data.whatsapp_url) {
        setDone({ route: 'whatsapp', url: data.whatsapp_url });
        // Same-tab navigation: unlike window.open after an await, mobile browsers don't block it
        window.location.assign(data.whatsapp_url);
      } else {
        setDone({ route: 'site', message: data.success_message ?? 'הפנייה נשלחה בהצלחה.' });
      }
    } catch {
      setError('שגיאת רשת. נסו שוב.');
    } finally {
      setBusy(null);
    }
  }

  const input = 'mt-1 w-full rounded-lg border border-ink/25 bg-surface px-3 py-2 text-start';

  return (
    <section aria-labelledby="catalog-h" className={count ? 'pb-24' : ''}>
      <div className="flex items-center justify-between gap-3">
        <h2 id="catalog-h" className="text-2xl font-bold">{items.length ? 'מוצרים ושירותים' : 'יצירת קשר'}</h2>
        {canOrder && (
          <button type="button" onClick={() => dlg.current?.showModal()}
            className="rounded-full border border-ink/25 px-4 py-2 text-sm font-medium">
            השאירו פנייה
          </button>
        )}
      </div>

      {items.length > 0 && (
        <ul className="mt-4 grid gap-4 sm:grid-cols-2">
          {items.map((p) => {
            const q = cart[p.id] ?? 0;
            return (
              <li key={p.id} className="flex flex-col overflow-hidden rounded-2xl border border-ink/15 bg-surface">
                {p.image && (
                  <div className="relative aspect-[4/3]">
                    <Image src={p.image.url} alt={p.name} fill sizes="(min-width:640px) 50vw, 100vw" className="object-cover" />
                  </div>
                )}
                <div className="flex flex-1 flex-col gap-2 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-semibold">{p.name}</h3>
                    {p.kind === 'service' && (
                      <span className="shrink-0 rounded-full bg-secondary/30 px-2 py-0.5 text-xs">שירות</span>
                    )}
                  </div>
                  {p.description && <p className="whitespace-pre-line text-sm text-ink/70">{p.description}</p>}
                  <div className="mt-auto flex items-center justify-between gap-3 pt-2">
                    <span className="font-bold">{p.price_agorot === null ? quoteLabel : ils(p.price_agorot)}</span>
                    {canOrder && (q > 0
                      ? <Stepper q={q} label={`כמות: ${p.name}`} onChange={(n) => setQty(p.id, n)} />
                      : (
                        <button type="button" onClick={() => setQty(p.id, 1)}
                          className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-fg">
                          {p.price_agorot === null ? 'בקשת הצעת מחיר' : 'הוסף להזמנה'}
                        </button>
                      )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {count > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-ink/15 bg-surface p-3 shadow-lg">
          <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
            <div className="text-sm">
              <div className="font-semibold">{count} פריטים בהזמנה</div>
              {totalText && <div className="text-ink/70">סכום משוער: {totalText}</div>}
            </div>
            <button type="button" onClick={() => dlg.current?.showModal()}
              className="rounded-full bg-primary px-5 py-2.5 font-semibold text-primary-fg">
              המשך להזמנה
            </button>
          </div>
        </div>
      )}

      <dialog
        ref={dlg}
        onClose={() => setDone(null)}
        onClick={(e) => { if (e.target === dlg.current) dlg.current?.close(); }}
        className="m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl bg-surface p-0 text-ink backdrop:bg-black/50"
      >
        <div className="p-5">
          {done ? (
            <div className="space-y-4 text-center">
              <h3 className="text-xl font-bold">{done.route === 'site' ? 'תודה!' : 'ההזמנה נשמרה'}</h3>
              {done.route === 'site' ? (
                <p>{done.message}</p>
              ) : (
                <p>
                  וואטסאפ אמור להיפתח עכשיו. אם לא,{' '}
                  <a className="font-semibold underline" href={done.url} target="_blank" rel="noopener noreferrer">לחצו כאן</a>.
                </p>
              )}
              <button type="button" onClick={() => dlg.current?.close()} className="rounded-full border border-ink/25 px-5 py-2">סגירה</button>
            </div>
          ) : (
            <form onSubmit={(e) => { e.preventDefault(); submit(flow.site_inquiry_enabled ? 'site' : 'whatsapp'); }} className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xl font-bold">פרטים להזמנה</h3>
                <button type="button" onClick={() => dlg.current?.close()} aria-label="סגירה" className="text-2xl leading-none">×</button>
              </div>

              {lines.length > 0 && (
                <ul className="rounded-lg bg-ink/5 p-3 text-sm">
                  {lines.map(({ p, q }) => (
                    <li key={p.id} className="flex justify-between gap-2">
                      <span>{p.name} × {q}</span>
                      <span>{p.price_agorot === null ? quoteLabel : ils(p.price_agorot * q)}</span>
                    </li>
                  ))}
                  {totalText && <li className="mt-1 border-t border-ink/15 pt-1 font-semibold">סכום משוער: {totalText}</li>}
                </ul>
              )}

              <label className="block text-sm font-medium">שם מלא *
                <input className={input} value={form.name} onChange={setField('name')} autoComplete="name" required />
              </label>
              <label className="block text-sm font-medium">טלפון *
                <input className={input} dir="ltr" inputMode="tel" autoComplete="tel" value={form.phone} onChange={setField('phone')} placeholder="050-0000000" required />
              </label>
              <label className="block text-sm font-medium">דוא״ל (לא חובה)
                <input className={input} dir="ltr" type="email" autoComplete="email" value={form.email} onChange={setField('email')} />
              </label>
              <label className="block text-sm font-medium">הודעה (לא חובה)
                <textarea className={input} rows={3} maxLength={2000} value={form.message} onChange={setField('message')} />
              </label>

              {/* Honeypot: invisible to people, bots fill it */}
              <input type="text" name="company_website" tabIndex={-1} autoComplete="off" aria-hidden="true"
                value={form.hp} onChange={setField('hp')} className="absolute -start-[9999px] h-0 w-0 opacity-0" />

              {error && <p role="alert" className="rounded-lg bg-red-50 p-2 text-sm text-red-800">{error}</p>}

              <div className="grid gap-2 pt-1">
                {flow.whatsapp_enabled && (
                  <button type="button" disabled={!!busy} onClick={() => submit('whatsapp')}
                    className="rounded-xl bg-[#25D366] px-4 py-3 font-semibold text-black disabled:opacity-60">
                    {busy === 'whatsapp' ? 'שולח…' : 'שלח הזמנה בוואטסאפ'}
                  </button>
                )}
                {flow.site_inquiry_enabled && (
                  <button type="button" disabled={!!busy} onClick={() => submit('site')}
                    className="rounded-xl bg-primary px-4 py-3 font-semibold text-primary-fg disabled:opacity-60">
                    {busy === 'site' ? 'שולח…' : 'השאר פנייה באתר'}
                  </button>
                )}
              </div>
            </form>
          )}
        </div>
      </dialog>
    </section>
  );
}