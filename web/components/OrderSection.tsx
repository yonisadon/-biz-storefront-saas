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
  const btn = 'h-9 w-9 rounded-full border border-ink/25 text-lg leading-none flex items-center justify-center';
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
          company_website: form.hp,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) return setError(errorText(res.status, data));

      setCart({});
      if (data.route === 'whatsapp' && data.whatsapp_url) {
        setDone({ route: 'whatsapp', url: data.whatsapp_url });
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
            className="rounded-full border border-ink/25 px-4 py-2 text-sm font-medium hover:bg-gray-50">
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
                    {canOrder && (q > 0 ? (
                      <Stepper q={q} label={`כמות: ${p.name}`} onChange={(n) => setQty(p.id, n)} />
                    ) : (
                      <button type="button" onClick={() => setQty(p.id, 1)}
                        className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-fg hover:opacity-90">
                        {p.price_agorot === null ? 'בקשת הצעת מחיר' : 'הוסף להזמנה'}
                      </button>
                    ))}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* Sticky bar on bottom when cart has items */}
      {count > 0 && (
        <div className="fixed bottom-0 inset-x-0 bg-surface border-t border-ink/15 p-4 shadow-lg flex items-center justify-between gap-4 z-40">
          <div>
            <div className="text-xs text-ink/70">{count} פריטים נבחרו</div>
            <div className="font-bold text-lg">{totalText}</div>
          </div>
          <button type="button" onClick={() => dlg.current?.showModal()}
            className="rounded-full bg-primary px-6 py-2.5 text-sm font-semibold text-primary-fg hover:opacity-90">
            המשך להזמנה
          </button>
        </div>
      )}

      {/* Order Modal */}
      <dialog ref={dlg} className="m-auto rounded-2xl p-6 backdrop:bg-black/50 max-w-md w-full text-start">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xl font-bold">פרטי פנייה</h3>
          <button type="button" onClick={() => dlg.current?.close()} className="text-xl p-1">✕</button>
        </div>

        {done ? (
          <div className="py-4 text-center">
            <p className="text-lg font-medium text-green-600 mb-4">
              {done.route === 'whatsapp' ? 'מעביר לוואטסאפ...' : done.message}
            </p>
            <button type="button" onClick={() => { setDone(null); dlg.current?.close(); }}
              className="rounded-full border border-ink/25 px-6 py-2">
              סגור
            </button>
          </div>
        ) : (
          <form onSubmit={(e) => e.preventDefault()} className="space-y-3">
            {error && <div className="p-3 bg-red-50 text-red-600 rounded-lg text-sm">{error}</div>}

            <input type="text" tabIndex={-1} className="hidden" value={form.hp} onChange={setField('hp')} autoComplete="off" />

            <div>
              <label className="block text-sm font-medium">שם מלא *</label>
              <input type="text" required className={input} value={form.name} onChange={setField('name')} />
            </div>

            <div>
              <label className="block text-sm font-medium">מספר טלפון *</label>
              <input type="tel" required className={input} value={form.phone} onChange={setField('phone')} placeholder="0500000000" />
            </div>

            <div>
              <label className="block text-sm font-medium">אימייל (רשות)</label>
              <input type="email" className={input} value={form.email} onChange={setField('email')} />
            </div>

            <div>
              <label className="block text-sm font-medium">הודעה / הערות</label>
              <textarea className={`${input} min-h-[80px]`} value={form.message} onChange={setField('message')} />
            </div>

            <div className="pt-2 space-y-2">
              {flow.whatsapp_enabled && (
                <button type="button" disabled={busy !== null} onClick={() => submit('whatsapp')}
                  className="w-full rounded-xl bg-green-600 text-white py-3 font-medium hover:bg-green-700 disabled:opacity-50">
                  {busy === 'whatsapp' ? 'שולח...' : 'שליחה בוואטסאפ'}
                </button>
              )}
              {flow.site_inquiry_enabled && (
                <button type="button" disabled={busy !== null} onClick={() => submit('site')}
                  className="w-full rounded-xl bg-primary text-primary-fg py-3 font-medium hover:opacity-90 disabled:opacity-50">
                  {busy === 'site' ? 'שולח...' : 'שליחה דרך האתר'}
                </button>
              )}
            </div>
          </form>
        )}
      </dialog>
    </section>
  );
}