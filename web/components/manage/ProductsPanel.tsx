'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ils } from '@/lib/format';
import { mcall, mupload, uploadErrorText } from '@/lib/manageApi';
import { ACCEPT, prepareImage } from '@/lib/prepareImage';
import type { MProduct } from '@/lib/types';

const btn = 'rounded-full bg-white px-3 py-1.5 text-sm ring-1 ring-gray-300 disabled:opacity-40';

export default function ProductsPanel({ token }: { token: string }) {
  const [items, setItems] = useState<MProduct[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<MProduct | 'new' | null>(null);

  const load = useCallback(async () => {
    try { setItems(await mcall<MProduct[]>(token, 'products')); setError(null); }
    catch { setError('לא הצלחנו לטעון את המוצרים.'); }
  }, [token]);
  useEffect(() => { load(); }, [load]);

  async function move(i: number, dir: -1 | 1) {
    if (!items) return;
    const j = i + dir;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j], next[i]];
    setItems(next);
    try {
      await mcall(token, 'products/order', { method: 'PUT', body: JSON.stringify({ ids: next.map((p) => p.id) }) });
    } catch { setError('שינוי הסדר נכשל.'); load(); }
  }

  async function toggleActive(p: MProduct) {
    setItems((cur) => cur?.map((x) => (x.id === p.id ? { ...x, is_active: !x.is_active } : x)) ?? null);
    try {
      await mcall(token, `products/${p.id}`, { method: 'PATCH', body: JSON.stringify({ is_active: !p.is_active }) });
    } catch { setError('העדכון נכשל.'); load(); }
  }

  async function remove(p: MProduct) {
    if (!confirm(`למחוק את "${p.name}"? הפעולה אינה הפיכה.`)) return;
    try {
      await mcall(token, `products/${p.id}`, { method: 'DELETE' });
      setItems((cur) => cur?.filter((x) => x.id !== p.id) ?? null);
    } catch { setError('המחיקה נכשלה.'); }
  }

  return (
    <section aria-label="מוצרים ושירותים">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-bold">מוצרים ושירותים {items && <span className="text-sm font-normal text-gray-500">({items.length})</span>}</h2>
        <button type="button" onClick={() => setEditing('new')}
          className="rounded-full bg-gray-900 px-4 py-2 text-sm font-semibold text-white">+ הוספה</button>
      </div>

      {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-2 text-sm text-red-800">{error}</p>}
      {items === null && !error && <p className="mt-4 text-sm text-gray-500">טוען…</p>}
      {items?.length === 0 && (
        <p className="mt-4 rounded-xl border border-dashed border-gray-300 bg-white p-6 text-center text-sm text-gray-500">
          עדיין אין מוצרים. הוסיפו את הראשון כדי שהאתר יציג קטלוג.
        </p>
      )}

      <ul className="mt-3 space-y-2">
        {items?.map((p, i) => (
          <li key={p.id} className={`flex items-center gap-3 rounded-xl border border-gray-200 bg-white p-3 ${p.is_active ? '' : 'opacity-60'}`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {p.image_url ? <img src={p.image_url} alt="" loading="lazy" decoding="async" className="h-16 w-16 shrink-0 rounded-lg object-cover" />
              : <div className="grid h-16 w-16 shrink-0 place-items-center rounded-lg bg-gray-100 text-xs text-gray-400">אין תמונה</div>}
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{p.name}</div>
              <div className="text-sm text-gray-600">
                {p.price_agorot === null ? 'הצעת מחיר' : ils(p.price_agorot)} · {p.kind === 'service' ? 'שירות' : 'מוצר'}
                {!p.is_active && ' · מוסתר באתר'}
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
              <button type="button" className={btn} onClick={() => move(i, -1)} disabled={i === 0} aria-label={`הזז את ${p.name} למעלה`}>↑</button>
              <button type="button" className={btn} onClick={() => move(i, 1)} disabled={i === items.length - 1} aria-label={`הזז את ${p.name} למטה`}>↓</button>
              <button type="button" className={btn} onClick={() => setEditing(p)}>עריכה</button>
              <button type="button" className={btn} onClick={() => toggleActive(p)}>{p.is_active ? 'הסתרה' : 'הצגה'}</button>
              <button type="button" className={`${btn} text-red-700`} onClick={() => remove(p)}>מחיקה</button>
            </div>
          </li>
        ))}
      </ul>

      {editing && (
        <ProductDialog
          key={editing === 'new' ? 'new' : editing.id}
          token={token}
          product={editing === 'new' ? null : editing}
          onClosed={() => setEditing(null)}
          onChanged={load}
        />
      )}
    </section>
  );
}

function ProductDialog({ token, product, onClosed, onChanged }: {
  token: string; product: MProduct | null; onClosed: () => void; onChanged: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [current, setCurrent] = useState<MProduct | null>(product); // set once created
  const [kind, setKind] = useState<'product' | 'service'>(product?.kind ?? 'product');
  const [name, setName] = useState(product?.name ?? '');
  const [description, setDescription] = useState(product?.description ?? '');
  const [quote, setQuote] = useState(product ? product.price_agorot === null : false);
  const [priceStr, setPriceStr] = useState(product?.price_agorot != null ? String(product.price_agorot / 100) : '');
  const [active, setActive] = useState(product?.is_active ?? true);
  const [file, setFile] = useState<Blob | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => { ref.current?.showModal(); }, []);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try {
      const blob = await prepareImage(f);
      setFile(blob); setPreview(URL.createObjectURL(blob)); setMsg(null);
    } catch (err) { setMsg(uploadErrorText(err)); }
  }

  async function removeImage() {
    if (!current) return;
    try {
      await mcall(token, `products/${current.id}/image`, { method: 'DELETE' });
      setCurrent({ ...current, image_url: null });
      onChanged();
    } catch { setMsg('הסרת התמונה נכשלה.'); }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const n = name.trim();
    if (!n) return setMsg('נא להזין שם.');
    let price: number | null = null;
    if (!quote) {
      const v = Number(priceStr.replace(',', '.'));
      if (priceStr.trim() === '' || !Number.isFinite(v) || v < 0 || v > 100000) {
        return setMsg('נא להזין מחיר תקין, או לסמן "הצעת מחיר".');
      }
      price = Math.round(v * 100);
    }
    const payload = { kind, name: n, description: description.trim() || null, price_agorot: price, is_active: active };

    setBusy(true); setMsg(null);
    let id = current?.id;
    try {
      if (id) {
        await mcall(token, `products/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });
      } else {
        const created = await mcall<MProduct>(token, 'products', { method: 'POST', body: JSON.stringify(payload) });
        id = created.id; setCurrent(created);
      }
    } catch { setBusy(false); return setMsg('שמירת המוצר נכשלה.'); }

    if (file) {
      try { await mupload(token, `products/${id}/image`, file); }
      catch (err) {
        setBusy(false); onChanged();
        return setMsg(`המוצר נשמר, אבל העלאת התמונה נכשלה: ${uploadErrorText(err)}`);
      }
    }
    setBusy(false); onChanged();
    ref.current?.close();
  }

  const input = 'mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2';
  const shownImage = preview ?? current?.image_url ?? null;

  return (
    <dialog ref={ref} onClose={onClosed}
      className="m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl bg-white p-0 text-gray-900 backdrop:bg-black/50">
      <form onSubmit={save} className="space-y-3 p-5">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold">{current ? 'עריכת פריט' : 'פריט חדש'}</h3>
          <button type="button" aria-label="סגירה" className="text-2xl leading-none" onClick={() => ref.current?.close()}>×</button>
        </div>

        <label className="block text-sm font-medium">סוג
          <select className={input} value={kind} onChange={(e) => setKind(e.target.value as 'product' | 'service')}>
            <option value="product">מוצר</option>
            <option value="service">שירות</option>
          </select>
        </label>
        <label className="block text-sm font-medium">שם *
          <input className={input} value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="block text-sm font-medium">תיאור
          <textarea className={input} rows={3} maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>

        <fieldset>
          <legend className="text-sm font-medium">מחיר</legend>
          <label className="mt-1 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={quote} onChange={(e) => setQuote(e.target.checked)} /> הצעת מחיר (ללא מחיר קבוע)
          </label>
          {!quote && (
            <div className="mt-2 flex items-center gap-2">
              <input className={input + ' mt-0'} dir="ltr" inputMode="decimal" placeholder="0.00" aria-label="מחיר בשקלים"
                value={priceStr} onChange={(e) => setPriceStr(e.target.value)} />
              <span>₪</span>
            </div>
          )}
        </fieldset>

        <div>
          <div className="text-sm font-medium">תמונה (אחת)</div>
          <div className="mt-1 flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {shownImage ? <img src={shownImage} alt="" className="h-20 w-20 rounded-lg object-cover" />
              : <div className="grid h-20 w-20 place-items-center rounded-lg bg-gray-100 text-xs text-gray-400">אין תמונה</div>}
            <div className="flex flex-col gap-1.5">
              <label className="cursor-pointer rounded-full bg-white px-3 py-1.5 text-center text-sm ring-1 ring-gray-300">
                {shownImage ? 'החלפת תמונה' : 'בחירת תמונה'}
                <input type="file" accept={ACCEPT} className="sr-only" onChange={pick} />
              </label>
              {current?.image_url && !file && (
                <button type="button" onClick={removeImage} className="rounded-full px-3 py-1.5 text-sm text-red-700 ring-1 ring-gray-300">הסרת תמונה</button>
              )}
            </div>
          </div>
          <p className="mt-1 text-xs text-gray-500">JPG, PNG או WebP, עד 10MB. התמונה נדחסת אוטומטית.</p>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> מוצג באתר
        </label>

        {msg && <p role="alert" className="whitespace-pre-line rounded-lg bg-red-50 p-2 text-sm text-red-800">{msg}</p>}
        <button type="submit" disabled={busy}
          className="w-full rounded-full bg-gray-900 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60">
          {busy ? 'שומר…' : 'שמירה'}
        </button>
      </form>
    </dialog>
  );
}