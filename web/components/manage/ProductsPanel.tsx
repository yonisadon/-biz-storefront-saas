'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ils } from '@/lib/format';
import { mcall, mupload, uploadErrorText } from '@/lib/manageApi';
import { ACCEPT, prepareImage } from '@/lib/prepareImage';
import type { MProduct, MProductsResponse } from '@/lib/types';
const PAGE = 25;
const btn = 'min-h-10 rounded-xl bg-white px-3 py-2 text-sm ring-1 ring-gray-300 transition-colors hover:bg-gray-50 disabled:opacity-40 sm:min-h-9 sm:rounded-full sm:py-1.5';
export default function ProductsPanel({ token }: { token: string }) {
 const [data,setData]=useState<MProductsResponse|null>(null); const [error,setError]=useState<string|null>(null); const [editing,setEditing]=useState<MProduct|'new'|null>(null);
 const [searchInput,setSearchInput]=useState(''); const [search,setSearch]=useState(''); const [status,setStatus]=useState<'all'|'active'|'inactive'>('all'); const [loading,setLoading]=useState(false);
 const load=useCallback(async(offset=0,term=search,state=status)=>{setLoading(true);try{const qs=new URLSearchParams({limit:String(PAGE),offset:String(offset),search:term,status:state});setData(await mcall<MProductsResponse>(token,`products?${qs}`));setError(null);}catch{setError('לא הצלחנו לטעון את המוצרים.');}finally{setLoading(false);}},[token,search,status]);
 useEffect(()=>{void load(0);},[load]);
 async function move(p:MProduct,direction:'up'|'down'){if(!data)return;try{await mcall(token,`products/${p.id}/move`,{method:'POST',body:JSON.stringify({direction})});await load(data.offset);}catch{setError('שינוי הסדר נכשל.');}}
 async function toggleActive(p:MProduct){try{await mcall(token,`products/${p.id}`,{method:'PATCH',body:JSON.stringify({is_active:!p.is_active})});await load(data?.offset??0);}catch{setError('העדכון נכשל.');}}
 async function remove(p:MProduct){if(!confirm(`למחוק את "${p.name}"? הפעולה אינה הפיכה.`))return;try{await mcall(token,`products/${p.id}`,{method:'DELETE'});await load(Math.max(0,(data?.offset??0)-(data?.items.length===1?PAGE:0)));}catch{setError('המחיקה נכשלה.');}}
 return <section aria-label="מוצרים ושירותים">
  <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-bold">מוצרים ושירותים {data&&<span className="text-sm font-normal text-gray-500">({data.total})</span>}</h2><button type="button" onClick={()=>setEditing('new')} className="rounded-full bg-gray-900 px-4 py-2 text-sm font-semibold text-white">+ הוספה</button></div>
  <div className="mt-3 flex flex-wrap items-end gap-2 rounded-xl bg-white p-3 ring-1 ring-gray-200">
   <label className="min-w-[12rem] flex-1 text-sm">חיפוש לפי שם<input value={searchInput} onChange={e=>setSearchInput(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')setSearch(searchInput.trim());}} className="mt-1 min-h-10 w-full rounded-lg border border-gray-300 px-3 py-2" placeholder="שם מוצר או שירות"/></label>
   <label className="text-sm">תצוגה<select value={status} onChange={e=>setStatus(e.target.value as 'all'|'active'|'inactive')} className="mt-1 min-h-10 rounded-lg border border-gray-300 bg-white px-3 py-2"><option value="all">הכול</option><option value="active">מוצגים באתר</option><option value="inactive">מוסתרים</option></select></label>
   <button type="button" onClick={()=>setSearch(searchInput.trim())} className="min-h-10 rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white">חיפוש</button>
  </div>
  {error&&<p role="alert" className="mt-3 rounded-lg bg-red-50 p-2 text-sm text-red-800">{error}</p>}
  {loading&&!data&&<p className="mt-4 text-sm text-gray-500">טוען…</p>}
  {data?.items.length===0&&<p className="mt-4 rounded-xl border border-dashed border-gray-300 bg-white p-6 text-center text-sm text-gray-500">{search||status!=='all'?'לא נמצאו פריטים שמתאימים לחיפוש או לסינון.':'עדיין אין מוצרים. הוסיפו את הראשון כדי שהאתר יציג קטלוג.'}</p>}
  <ul className="mt-3 space-y-2">{data?.items.map((p,i)=><li key={p.id} className={`flex flex-col items-stretch gap-3 rounded-2xl border border-gray-200 bg-white p-3 shadow-sm sm:flex-row sm:items-center ${p.is_active?'':'opacity-60'}`}>
   {/* eslint-disable-next-line @next/next/no-img-element */}{p.image_url?<img src={p.image_url} alt="" loading="lazy" decoding="async" className="h-16 w-16 shrink-0 rounded-lg object-cover"/>:<div className="grid h-16 w-16 shrink-0 place-items-center rounded-lg bg-gray-100 text-xs text-gray-400">אין תמונה</div>}
   <div className="min-w-0 flex-1"><div className="break-words font-semibold text-gray-900 sm:truncate">{p.name}</div><div className="text-sm text-gray-600">{p.price_agorot===null?'הצעת מחיר':ils(p.price_agorot)} · {p.kind==='service'?'שירות':'מוצר'}{p.booking_mode==='availability'?' · שריון ביומן':p.booking_mode==='free_datetime'?' · מועד מבוקש ללא שריון':''}{p.booking_mode!=='none'?` · ${p.appointment_duration_minutes} דק׳`:''}{!p.is_active&&' · מוסתר באתר'}</div></div>
   <div className="grid grid-cols-2 gap-2 sm:flex sm:shrink-0 sm:flex-wrap sm:justify-end"><button type="button" className={btn} onClick={()=>move(p,'up')} disabled={loading||data.offset+i===0||Boolean(search)||status!=='all'} aria-label={`הזז את ${p.name} למעלה`}>↑</button><button type="button" className={btn} onClick={()=>move(p,'down')} disabled={loading||data.offset+i>=data.total-1||Boolean(search)||status!=='all'} aria-label={`הזז את ${p.name} למטה`}>↓</button><button type="button" className={btn} onClick={()=>setEditing(p)}>עריכה</button><button type="button" className={btn} onClick={()=>toggleActive(p)} disabled={loading}>{p.is_active?'הסתרה':'הצגה'}</button><button type="button" className={`${btn} text-red-700`} onClick={()=>remove(p)} disabled={loading}>מחיקה</button></div>
  </li>)}</ul>
  {data&&data.total>0&&<div className="mt-4 flex items-center justify-center gap-4"><button type="button" disabled={loading||data.offset===0} onClick={()=>void load(Math.max(0,data.offset-PAGE))} className="rounded-full bg-white px-4 py-2 text-sm ring-1 ring-gray-300 disabled:opacity-40">הקודם</button><span className="text-sm text-gray-500">{data.offset+1}–{Math.min(data.offset+data.items.length,data.total)} מתוך {data.total}</span><button type="button" disabled={loading||data.offset+data.items.length>=data.total} onClick={()=>void load(data.offset+PAGE)} className="rounded-full bg-white px-4 py-2 text-sm ring-1 ring-gray-300 disabled:opacity-40">הבא</button></div>}
  {editing&&<ProductDialog key={editing==='new'?'new':editing.id} token={token} product={editing==='new'?null:editing} onClosed={()=>setEditing(null)} onChanged={()=>{void load(data?.offset??0);}}/>}
 </section>;
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
  const [bookingMode, setBookingMode] = useState<'none' | 'free_datetime' | 'availability'>(product?.booking_mode ?? (product?.requires_appointment ? 'free_datetime' : 'none'));
  const [appointmentDurationMinutes, setAppointmentDurationMinutes] = useState(product?.appointment_duration_minutes ?? 30);
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
    const mode = kind === 'service' ? bookingMode : 'none';
    const payload = { kind, name: n, description: description.trim() || null, price_agorot: price, is_active: active, booking_mode: mode, requires_appointment: mode !== 'none', appointment_duration_minutes: mode !== 'none' ? appointmentDurationMinutes : 30 };

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
          <select className={input} value={kind} onChange={(e) => { const next = e.target.value as 'product' | 'service'; setKind(next); if (next === 'product') setBookingMode('none'); }}>
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

        {kind === 'service' && <label className="block text-sm font-medium">אופן תיאום השירות
          <select className={input} value={bookingMode} onChange={(e) => setBookingMode(e.target.value as 'none' | 'free_datetime' | 'availability')}>
            <option value="none">ללא בחירת תאריך ושעה</option>
            <option value="free_datetime">בחירת מועד מבוקש — ללא שריון ביומן</option>
            <option value="availability">בחירה מתוך שעות פנויות — שריון ביומן</option>
          </select>
          {bookingMode === 'free_datetime' && <span className="mt-1 block text-xs font-normal text-gray-500">הלקוח בוחר מועד מבוקש. המועד לא תופס את היומן ולקוחות אחרים יכולים לבחור אותו.</span>}
          {bookingMode === 'availability' && <span className="mt-1 block text-xs font-normal text-gray-500">הלקוח בוחר שעה פנויה, והשעה נשמרת ביומן עם שמירת הפנייה. נדרשות שעות פעילות מוגדרות.</span>}
        </label>}
        {kind === 'service' && bookingMode !== 'none' && (
          <label className="block text-sm font-medium">משך התור
            <select className={input} value={appointmentDurationMinutes} onChange={(e) => setAppointmentDurationMinutes(Number(e.target.value))}>
              <option value={15}>15 דקות — עד 4 תורים בשעה</option>
              <option value={30}>30 דקות — עד 2 תורים בשעה</option>
              <option value={45}>45 דקות</option>
              <option value={60}>שעה — תור אחד בשעה</option>
              <option value={90}>שעה וחצי</option>
              <option value={120}>שעתיים</option>
              <option value={180}>3 שעות — תור אחד בכל 3 שעות</option>
              <option value={240}>4 שעות</option>
            </select>
            <span className="mt-1 block text-xs font-normal text-gray-500">משך התור קובע את מרווחי השעות לבחירה. זו עדיין בקשת תיאום, לא יומן שמונע התנגשויות.</span>
          </label>
        )}
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