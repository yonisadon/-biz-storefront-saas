'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ils } from '@/lib/format';
import { mcallWithTimeout, mupload, uploadErrorText } from '@/lib/manageApi';
import { ACCEPT, prepareImage } from '@/lib/prepareImage';
import type { MProduct, MProductsResponse } from '@/lib/types';
import { usePlatformLanguage } from '@/components/PlatformLanguageProvider';
const PAGE = 25;
const btn = 'min-h-10 rounded-xl bg-white px-3 py-2 text-sm ring-1 ring-gray-300 transition-colors hover:bg-gray-50 disabled:opacity-40 sm:min-h-9 sm:rounded-full sm:py-1.5';
export default function ProductsPanel({ token }: { token: string }) {
 const { t } = usePlatformLanguage();
 const [data,setData]=useState<MProductsResponse|null>(null); const [error,setError]=useState<string|null>(null); const [editing,setEditing]=useState<MProduct|'new'|null>(null);
 const [searchInput,setSearchInput]=useState(''); const [search,setSearch]=useState(''); const [status,setStatus]=useState<'all'|'active'|'inactive'>('all'); const [loading,setLoading]=useState(false);
 const load=useCallback(async(offset=0,term=search,state=status)=>{setLoading(true);try{const qs=new URLSearchParams({limit:String(PAGE),offset:String(offset),search:term,status:state});setData(await mcallWithTimeout<MProductsResponse>(token,`products?${qs}`));setError(null);}catch{setError(t('productLoadFailed'));}finally{setLoading(false);}},[token,search,status,t]);
 useEffect(()=>{void load(0);},[load]);
 async function move(p:MProduct,direction:'up'|'down'){if(!data)return;try{await mcallWithTimeout(token,`products/${p.id}/move`,{method:'POST',body:JSON.stringify({direction})});await load(data.offset);}catch{setError(t('orderUpdateFailed'));}}
 async function toggleActive(p:MProduct){try{await mcallWithTimeout(token,`products/${p.id}`,{method:'PATCH',body:JSON.stringify({is_active:!p.is_active})});await load(data?.offset??0);}catch{setError(t('updateFailed'));}}
 async function remove(p:MProduct){if(!confirm(`${t('productDeleteNamedConfirm')} "${p.name}"?`))return;try{await mcallWithTimeout(token,`products/${p.id}`,{method:'DELETE'});await load(Math.max(0,(data?.offset??0)-(data?.items.length===1?PAGE:0)));}catch{setError(t('deleteFailed'));}}
 return <section aria-label={t('tabProductsTitle')}>
  <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-bold">{t('tabProductsTitle')} {data&&<span className="text-sm font-normal text-gray-500">({data.total})</span>}</h2><button type="button" onClick={()=>setEditing('new')} className="rounded-full bg-gray-900 px-4 py-2 text-sm font-semibold text-white">+ {t('add')}</button></div>
  <div className="mt-3 flex flex-wrap items-end gap-2 rounded-xl bg-white p-3 ring-1 ring-gray-200">
   <label className="min-w-[12rem] flex-1 text-sm">{t('productSearch')}<input value={searchInput} onChange={e=>setSearchInput(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')setSearch(searchInput.trim());}} className="mt-1 min-h-10 w-full rounded-lg border border-gray-300 px-3 py-2" placeholder={t('productSearchPlaceholder')}/></label>
   <label className="text-sm">{t('displayFilter')}<select value={status} onChange={e=>setStatus(e.target.value as 'all'|'active'|'inactive')} className="mt-1 min-h-10 rounded-lg border border-gray-300 bg-white px-3 py-2"><option value="all">{t('all')}</option><option value="active">{t('visibleOnSite')}</option><option value="inactive">{t('hidden')}</option></select></label>
   <button type="button" onClick={()=>setSearch(searchInput.trim())} className="min-h-10 rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white">{t('search')}</button>
  </div>
  {error&&<p role="alert" className="mt-3 rounded-lg bg-red-50 p-2 text-sm text-red-800">{error}</p>}
  {loading&&!data&&<p className="mt-4 text-sm text-gray-500">{t('loading')}</p>}
  {data?.items.length===0&&<p className="mt-4 rounded-xl border border-dashed border-gray-300 bg-white p-6 text-center text-sm text-gray-500">{search||status!=='all'?t('noResults'):t('noProducts')}</p>}
  <ul className="mt-3 space-y-2">{data?.items.map((p,i)=><li key={p.id} className={`flex flex-col items-stretch gap-3 rounded-2xl border border-gray-200 bg-white p-3 shadow-sm sm:flex-row sm:items-center ${p.is_active?'':'opacity-60'}`}>
   {/* eslint-disable-next-line @next/next/no-img-element */}{p.image_url?<img src={p.image_url} alt="" loading="lazy" decoding="async" className="h-16 w-16 shrink-0 rounded-lg object-cover"/>:<div className="grid h-16 w-16 shrink-0 place-items-center rounded-lg bg-gray-100 text-xs text-gray-400">{t('noImage')}</div>}
   <div className="min-w-0 flex-1"><div className="break-words font-semibold text-gray-900 sm:truncate">{p.name}</div><div className="text-sm text-gray-600">{p.price_agorot===null?t('quote'):ils(p.price_agorot)} · {p.kind==='service'?t('service'):t('product')}{p.kind==='service'?` · ${p.appointment_duration_minutes} ${t('minutesAbbr')}`:''}{!p.is_active&&' · '+t('hiddenOnSite')}</div></div>
   <div className="grid grid-cols-2 gap-2 sm:flex sm:shrink-0 sm:flex-wrap sm:justify-end"><button type="button" className={btn} onClick={()=>move(p,'up')} disabled={loading||data.offset+i===0||Boolean(search)||status!=='all'} aria-label={`${t('moveUp')} ${p.name}`}>↑</button><button type="button" className={btn} onClick={()=>move(p,'down')} disabled={loading||data.offset+i>=data.total-1||Boolean(search)||status!=='all'} aria-label={`${t('moveDown')} ${p.name}`}>↓</button><button type="button" className={btn} onClick={()=>setEditing(p)}>{t('edit')}</button><button type="button" className={btn} onClick={()=>toggleActive(p)} disabled={loading}>{p.is_active?t('hide'):t('show')}</button><button type="button" className={`${btn} text-red-700`} onClick={()=>remove(p)} disabled={loading}>{t('delete')}</button></div>
  </li>)}</ul>
  {data&&data.total>0&&<div className="mt-4 flex items-center justify-center gap-4"><button type="button" disabled={loading||data.offset===0} onClick={()=>void load(Math.max(0,data.offset-PAGE))} className="rounded-full bg-white px-4 py-2 text-sm ring-1 ring-gray-300 disabled:opacity-40">{t('previousPage')}</button><span className="text-sm text-gray-500">{data.offset+1}–{Math.min(data.offset+data.items.length,data.total)} {t('of')} {data.total}</span><button type="button" disabled={loading||data.offset+data.items.length>=data.total} onClick={()=>void load(data.offset+PAGE)} className="rounded-full bg-white px-4 py-2 text-sm ring-1 ring-gray-300 disabled:opacity-40">{t('nextPage')}</button></div>}
  {editing&&<ProductDialog key={editing==='new'?'new':editing.id} token={token} product={editing==='new'?null:editing} onClosed={()=>setEditing(null)} onChanged={()=>{void load(data?.offset??0);}}/>}
 </section>;
}

function ProductDialog({ token, product, onClosed, onChanged }: {
  token: string; product: MProduct | null; onClosed: () => void; onChanged: () => void;
}) {
  const { t } = usePlatformLanguage();
  const ref = useRef<HTMLDialogElement>(null);
  const [current, setCurrent] = useState<MProduct | null>(product); // set once created
  const [kind, setKind] = useState<'product' | 'service'>(product?.kind ?? 'product');
  const [name, setName] = useState(product?.name ?? '');
  const [description, setDescription] = useState(product?.description ?? '');
  const [details, setDetails] = useState<{ label: string; value: string }[]>(product?.details ?? []);
  const [extraFiles, setExtraFiles] = useState<Blob[]>([]);
  const [removePrimaryPending, setRemovePrimaryPending] = useState(false);
  const [removeAdditionalPending, setRemoveAdditionalPending] = useState<string[]>([]);
  const [extraPreviews, setExtraPreviews] = useState<string[]>([]);
  const extraPreviewUrls = useRef<string[]>([]);
  const [quote, setQuote] = useState(product ? product.price_agorot === null : false);
  const [priceStr, setPriceStr] = useState(product?.price_agorot != null ? String(product.price_agorot / 100) : '');
  const [active, setActive] = useState(product?.is_active ?? true);
  const [appointmentDurationMinutes, setAppointmentDurationMinutes] = useState(product?.appointment_duration_minutes ?? 30);
  const [file, setFile] = useState<Blob | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => { ref.current?.showModal(); }, []);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  useEffect(() => () => { extraPreviewUrls.current.forEach((url) => URL.revokeObjectURL(url)); }, []);

  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try {
      const blob = await prepareImage(f);
      setFile(blob); setPreview(URL.createObjectURL(blob)); setMsg(null);
    } catch (err) { setMsg(uploadErrorText(err)); }
  }

  async function pickAdditional(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    const available = 2 - (current?.additional_images.length ?? 0) - extraFiles.length;
    if (files.length > available) return setMsg(t('extraImageLimit'));
    try {
      const prepared = await Promise.all(files.map((file) => prepareImage(file)));
      const urls = prepared.map((blob) => URL.createObjectURL(blob));
      extraPreviewUrls.current = [...extraPreviewUrls.current, ...urls];
      setExtraFiles((items) => [...items, ...prepared]);
      setExtraPreviews((items) => [...items, ...urls]);
      setMsg(null);
    } catch (err) { setMsg(uploadErrorText(err)); }
  }

  async function replaceAdditionalImage(imageId: string, file: File) {
    if (!current) return;
    try {
      const prepared = await prepareImage(file);
      const updated = await mupload<{ id: string; position: number; url: string; width: number | null; height: number | null }>(
        token, `products/${current.id}/additional-images/${imageId}`, prepared, 'photo.jpg', 'PUT',
      );
      setCurrent((item) => item ? {
        ...item,
        additional_images: item.additional_images.map((image) => image.id === imageId ? updated : image),
      } : item);
      setMsg(null);
      onChanged();
    } catch (err) {
      setMsg(`החלפת התמונה הנוספת נכשלה: ${uploadErrorText(err)}`);
    }
  }

  function removeAdditionalImage(imageId: string) {
    setRemoveAdditionalPending((items) => items.includes(imageId) ? items : [...items, imageId]);
    setMsg(null);
  }

  function removeImage() {
    setRemovePrimaryPending(true);
    setMsg(null);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const n = name.trim();
    if (!n) return setMsg(t('productNameRequired'));
    let price: number | null = null;
    if (!quote) {
      const v = Number(priceStr.replace(',', '.'));
      if (priceStr.trim() === '' || !Number.isFinite(v) || v < 0 || v > 100000) {
        return setMsg(t('invalidPrice'));
      }
      price = Math.round(v * 100);
    }
    const payload = { kind, name: n, description: description.trim() || null, details: details.filter((item) => item.label.trim() && item.value.trim()), price_agorot: price, is_active: active, appointment_duration_minutes: kind === 'service' ? appointmentDurationMinutes : 30 };

    setBusy(true); setMsg(null);
    let id = current?.id;
    try {
      if (id) {
        await mcallWithTimeout(token, `products/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });
      } else {
        const created = await mcallWithTimeout<MProduct>(token, 'products', { method: 'POST', body: JSON.stringify(payload) });
        id = created.id; setCurrent(created);
      }
    } catch (error) {
      setBusy(false);
      if (error instanceof Error && error.name === 'AbortError') {
        onChanged();
        return setMsg(t('genericApiError'));
      }
      return setMsg(t('productSaveFailed'));
    }

    // Defer removals until the product fields have saved successfully, so a failed PATCH
    // never leaves an image deleted while the form reports that saving failed.
    if (current && removePrimaryPending) {
      try { await mcallWithTimeout(token, `products/${id}/image`, { method: 'DELETE' }); setCurrent((item) => item ? { ...item, image_url: null } : item); }
      catch { setBusy(false); onChanged(); return setMsg(t('productSavedImageRemoveFailed')); }
    }
    for (const imageId of removeAdditionalPending) {
      try { await mcallWithTimeout(token, `products/${id}/additional-images/${imageId}`, { method: 'DELETE' }); }
      catch { setBusy(false); onChanged(); return setMsg('${t('productSavedImageRemoveFailed')}'); }
    }
    if (file) {
      try { await mupload(token, `products/${id}/image`, file); }
      catch (err) {
        setBusy(false); onChanged();
        return setMsg(`${t('imageUploadFailed')} ${uploadErrorText(err)}`);
      }
    }
    for (const extra of [...extraFiles]) {
      try {
        const uploaded = await mupload<{ id: string; position: number; url: string; width: number | null; height: number | null }>(token, `products/${id}/additional-images`, extra);
        setCurrent((item) => item ? { ...item, additional_images: [...item.additional_images, uploaded] } : item);
        setExtraFiles((items) => items.slice(1));
        setExtraPreviews((items) => {
          const [first, ...rest] = items;
          if (first) { URL.revokeObjectURL(first); extraPreviewUrls.current = extraPreviewUrls.current.filter((url) => url !== first); }
          return rest;
        });
      } catch (err) {
        setBusy(false); onChanged();
        return setMsg(`${t('imageUploadFailed')} ${uploadErrorText(err)}`);
      }
    }
    setBusy(false); onChanged();
    ref.current?.close();
  }

  const input = 'mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2';
  const shownImage = preview ?? (removePrimaryPending ? null : current?.image_url) ?? null;

  return (
    <dialog ref={ref} onClose={onClosed}
      className="m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl bg-white p-0 text-gray-900 backdrop:bg-black/50">
      <form onSubmit={save} className="space-y-3 p-5">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold">{current ? t('editItem') : t('newItem')}</h3>
          <button type="button" aria-label={t('close')} className="text-2xl leading-none" onClick={() => ref.current?.close()}>×</button>
        </div>

        <label className="block text-sm font-medium">{t('type')}
          <select className={input} value={kind} onChange={(e) => setKind(e.target.value as 'product' | 'service')}>
            <option value="product">{t('product')}</option>
            <option value="service">{t('service')}</option>
          </select>
        </label>
        <label className="block text-sm font-medium">{t('name')} *
          <input className={input} value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="block text-sm font-medium">{t('description')}
          <textarea className={input} rows={3} maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>

        <fieldset className="space-y-2 rounded-xl border border-gray-200 p-3">
          <legend className="px-1 text-sm font-medium">{t('extraDetails')}</legend>
          {details.map((item, index) => (
            <div key={index} className="grid grid-cols-[1fr_1fr_auto] gap-2">
              <input className={input + ' min-w-0'} aria-label={`שם מאפיין ${index + 1}`} maxLength={50} placeholder={t('attribute')} value={item.label}
                onChange={(e) => setDetails((items) => items.map((row, i) => i === index ? { ...row, label: e.target.value } : row))} />
              <input className={input + ' min-w-0'} aria-label={`ערך מאפיין ${index + 1}`} maxLength={250} placeholder={t('attributeValue')} value={item.value}
                onChange={(e) => setDetails((items) => items.map((row, i) => i === index ? { ...row, value: e.target.value } : row))} />
              <button type="button" onClick={() => setDetails((items) => items.filter((_, i) => i !== index))} className="px-2 text-sm text-red-700" aria-label={t('removeRange')}>✕</button>
            </div>
          ))}
          {details.length < 20 && <button type="button" onClick={() => setDetails((items) => [...items, { label: '', value: '' }])} className="rounded-lg border border-gray-300 px-3 py-2 text-sm">+ {t('addAttribute')}</button>}
          <p className="text-xs text-gray-500">{t('attributeHint')}</p>
        </fieldset>

        <fieldset>
          <legend className="text-sm font-medium">{t('price')}</legend>
          <label className="mt-1 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={quote} onChange={(e) => setQuote(e.target.checked)} /> {t('quoteNoFixedPrice')}
          </label>
          {!quote && (
            <div className="mt-2 flex items-center gap-2">
              <input className={input + ' mt-0'} dir="ltr" inputMode="decimal" placeholder="0.00" aria-label={t('priceShekels')}
                value={priceStr} onChange={(e) => setPriceStr(e.target.value)} />
              <span>₪</span>
            </div>
          )}
        </fieldset>

        <div>
          <div className="text-sm font-medium">{t('productImages')}</div>
          <div className="mt-1 flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {shownImage ? <img src={shownImage} alt="" className="h-20 w-20 rounded-lg object-cover" />
              : <div className="grid h-20 w-20 place-items-center rounded-lg bg-gray-100 text-xs text-gray-400">{t('noImage')}</div>}
            <div className="flex flex-col gap-1.5">
              <label className="cursor-pointer rounded-full bg-white px-3 py-1.5 text-center text-sm ring-1 ring-gray-300">
                {shownImage ? t('replaceImage') : t('chooseImage')}
                <input type="file" accept={ACCEPT} className="sr-only" onChange={pick} />
              </label>
              {current?.image_url && !removePrimaryPending && !file && (
                <button type="button" onClick={removeImage} className="rounded-full px-3 py-1.5 text-sm text-red-700 ring-1 ring-gray-300">{t('removeImage')}</button>
              )}
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {(current?.additional_images ?? []).filter((image) => !removeAdditionalPending.includes(image.id)).map((image) => (
              <div key={image.id} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={image.url} alt="" className="h-16 w-16 rounded-lg object-cover" />
                <label className="absolute inset-x-0 bottom-0 cursor-pointer rounded-b-lg bg-black/70 py-1 text-center text-[10px] font-medium text-white">
                  החלפה
                  <input type="file" accept={ACCEPT} className="sr-only" aria-label={t('replaceImage')} onChange={(e) => {
                    const selected = e.target.files?.[0];
                    e.target.value = '';
                    if (selected) void replaceAdditionalImage(image.id, selected);
                  }} />
                </label>
                <button type="button" onClick={() => removeAdditionalImage(image.id)} aria-label={t('removeExtraImage')} className="absolute -end-2 -top-2 grid h-6 w-6 place-items-center rounded-full bg-white text-red-700 shadow">×</button>
              </div>
            ))}
            {extraPreviews.map((url, index) => (
              <div key={url} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt="" className="h-16 w-16 rounded-lg object-cover" />
                <button type="button" onClick={() => { URL.revokeObjectURL(url); extraPreviewUrls.current = extraPreviewUrls.current.filter((item) => item !== url); setExtraFiles((items) => items.filter((_, i) => i !== index)); setExtraPreviews((items) => items.filter((_, i) => i !== index)); }} aria-label={t('cancel')} className="absolute -end-2 -top-2 grid h-6 w-6 place-items-center rounded-full bg-white text-red-700 shadow">×</button>
              </div>
            ))}
          </div>
          {(current?.additional_images.length ?? 0) + extraFiles.length < 2 && (
            <label className="mt-2 inline-flex cursor-pointer rounded-full bg-white px-3 py-1.5 text-sm ring-1 ring-gray-300">
              + הוספת תמונה נוספת
              <input type="file" accept={ACCEPT} multiple className="sr-only" onChange={pickAdditional} />
            </label>
          )}
          {(removePrimaryPending || removeAdditionalPending.length > 0) && <p className="mt-1 text-xs text-amber-700">{t('pendingImageRemoval')}</p>}
          <p className="mt-1 text-xs text-gray-500">{t('imageFormatHint')}</p>
        </div>

        {kind === 'service' && (
          <label className="block text-sm font-medium">{t('serviceDuration')}
            <select className={input} value={appointmentDurationMinutes} onChange={(e) => setAppointmentDurationMinutes(Number(e.target.value))}>
              <option value={15}>{t('minutes15')}</option>
              <option value={30}>{t('minutes30')}</option>
              <option value={45}>{t('minutes45')}</option>
              <option value={60}>{t('minutes60')}</option>
              <option value={90}>{t('minutes90')}</option>
              <option value={120}>{t('minutes120')}</option>
              <option value={180}>{t('minutes180')}</option>
              <option value={240}>{t('minutes240')}</option>
            </select>
            <span className="mt-1 block text-xs font-normal text-gray-500">{t('serviceDurationHint')}</span>
          </label>
        )}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> {t('shownOnSite')}
        </label>

        {msg && <p role="alert" className="whitespace-pre-line rounded-lg bg-red-50 p-2 text-sm text-red-800">{msg}</p>}
        <button type="submit" disabled={busy}
          className="w-full rounded-full bg-gray-900 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60">
          {busy ? t('saving') : t('save')}
        </button>
      </form>
    </dialog>
  );
}