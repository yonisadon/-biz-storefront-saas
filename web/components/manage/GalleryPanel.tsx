'use client';

import { useCallback, useEffect, useState } from 'react';
import { mcall, mupload, uploadErrorText } from '@/lib/manageApi';
import { ACCEPT, prepareImage } from '@/lib/prepareImage';
import type { MGalleryImage, ManageBusiness } from '@/lib/types';

const MAX = 7;
const btn = 'rounded-full bg-white px-3 py-1.5 text-sm ring-1 ring-gray-300 disabled:opacity-40';

export default function GalleryPanel({ token }: { token: string }) {
  const [items, setItems] = useState<MGalleryImage[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [heroId, setHeroId] = useState<string | null>(null);
  const [iconId, setIconId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [images, biz] = await Promise.all([
        mcall<MGalleryImage[]>(token, 'gallery'),
        mcall<ManageBusiness>(token, 'business'),
      ]);
      setItems(images);
      setHeroId(biz.config?.branding?.hero_gallery_image_id ?? null);
      setIconId(biz.config?.branding?.icon_gallery_image_id ?? null);
    } catch { setMsg('לא הצלחנו לטעון את הגלריה.'); }
  }, [token]);
  useEffect(() => { load(); }, [load]);

  const remaining = MAX - (items?.length ?? 0);

  async function onFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (!files.length) return;
    const batch = files.slice(0, Math.max(0, remaining));
    const notes: string[] = [];
    if (files.length > batch.length) notes.push(`${files.length - batch.length} קבצים לא הועלו: הגלריה מוגבלת ל-${MAX} תמונות.`);

    for (let i = 0; i < batch.length; i++) {
      setProgress(`מעלה ${i + 1} מתוך ${batch.length}…`);
      try {
        const blob = await prepareImage(batch[i]);
        const item = await mupload<MGalleryImage>(token, 'gallery', blob, batch[i].name);
        setItems((cur) => [...(cur ?? []), item]);
      } catch (err) {
        notes.push(`${batch[i].name}: ${uploadErrorText(err)}`);
      }
    }
    setProgress(null);
    setMsg(notes.length ? notes.join('\n') : null);
  }

  async function move(i: number, dir: -1 | 1) {
    if (!items) return;
    const j = i + dir;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j], next[i]];
    setItems(next);
    try {
      await mcall(token, 'gallery/order', { method: 'PUT', body: JSON.stringify({ ids: next.map((x) => x.id) }) });
    } catch { setMsg('שינוי הסדר נכשל.'); load(); }
  }

  async function remove(img: MGalleryImage) {
    if (!confirm('למחוק את התמונה?')) return;
    try {
      await mcall(token, `gallery/${img.id}`, { method: 'DELETE' });
      setItems((cur) => cur?.filter((x) => x.id !== img.id) ?? null);
    } catch { setMsg('המחיקה נכשלה.'); }
  }

  async function setHero(img: MGalleryImage) {
    try {
      const biz = await mcall<ManageBusiness>(token, 'business');
      await mcall<ManageBusiness>(token, 'business', { method: 'PATCH', body: JSON.stringify({ config: { branding: { ...(biz.config?.branding ?? {}), hero_gallery_image_id: img.id } } }) });
      setHeroId(img.id);
      setMsg('התמונה הראשית נשמרה.');
    } catch { setMsg('שמירת התמונה הראשית נכשלה.'); }
  }

  async function setIcon(img: MGalleryImage) {
    try {
      const biz = await mcall<ManageBusiness>(token, 'business');
      await mcall<ManageBusiness>(token, 'business', { method: 'PATCH', body: JSON.stringify({ config: { branding: { ...(biz.config?.branding ?? {}), icon_gallery_image_id: img.id } } }) });
      setIconId(img.id);
      setMsg('אייקון ה-PWA נשמר. האייקון יתעדכן לאחר רענון/התקנה מחדש לפי הדפדפן.');
    } catch { setMsg('שמירת אייקון ה-PWA נכשלה.'); }
  }

  async function saveAlt(img: MGalleryImage, value: string) {
    const v = value.trim();
    if (v === (img.alt_text ?? '')) return;
    try {
      await mcall(token, `gallery/${img.id}`, { method: 'PATCH', body: JSON.stringify({ alt_text: v || null }) });
      setItems((cur) => cur?.map((x) => (x.id === img.id ? { ...x, alt_text: v || null } : x)) ?? null);
    } catch { setMsg('שמירת הטקסט החלופי נכשלה.'); }
  }

  return (
    <section aria-label="גלריה">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-bold">גלריית עבודות <span className="text-sm font-normal text-gray-500">({items?.length ?? 0}/{MAX})</span></h2>
        <label className={`rounded-full px-4 py-2 text-sm font-semibold text-white ${remaining > 0 && !progress ? 'cursor-pointer bg-gray-900' : 'bg-gray-400'}`}>
          + העלאת תמונות
          <input type="file" accept={ACCEPT} multiple className="sr-only" disabled={remaining <= 0 || !!progress} onChange={onFiles} />
        </label>
      </div>
      <p className="mt-1 text-xs text-gray-500">עד {MAX} תמונות בסך הכול, כל אחת עד 10MB. בחרו תמונה ראשית לראש דף העסק.</p>

      {progress && <p role="status" className="mt-3 text-sm text-gray-600">{progress}</p>}
      {msg && <p role="alert" className="mt-3 whitespace-pre-line rounded-lg bg-red-50 p-2 text-sm text-red-800">{msg}</p>}
      {items === null && !msg && <p className="mt-4 text-sm text-gray-500">טוען…</p>}
      {items?.length === 0 && (
        <p className="mt-4 rounded-xl border border-dashed border-gray-300 bg-white p-6 text-center text-sm text-gray-500">עדיין אין תמונות בגלריה.</p>
      )}

      <ul className="mt-3 grid gap-3 sm:grid-cols-2">
        {items?.map((img, i) => (
          <li key={img.id} className="overflow-hidden rounded-xl border border-gray-200 bg-white">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={img.url} alt={img.alt_text ?? ''} loading="lazy" decoding="async" className="aspect-[4/3] w-full object-cover" />
            <div className="space-y-2 p-3">
              <label className="block text-xs font-medium text-gray-600">טקסט חלופי (לנגישות)
                <input defaultValue={img.alt_text ?? ''} maxLength={200}
                  onBlur={(e) => saveAlt(img, e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm" />
              </label>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-sm text-gray-500">#{i + 1}{heroId === img.id ? " · תמונה ראשית" : ""}{iconId === img.id ? " · אייקון PWA" : ""}</span>
                <button type="button" className={btn} onClick={() => setHero(img)} disabled={heroId === img.id}>הגדרה כתמונה ראשית</button>
                <button type="button" className={btn} onClick={() => setIcon(img)} disabled={iconId === img.id}>הגדרה כאייקון האתר</button>
                <button type="button" className={btn} onClick={() => move(i, -1)} disabled={i === 0}>הקדם</button>
                <button type="button" className={btn} onClick={() => move(i, 1)} disabled={i === items.length - 1}>אחר</button>
                <button type="button" className={`${btn} text-red-700`} onClick={() => remove(img)}>מחיקה</button>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}