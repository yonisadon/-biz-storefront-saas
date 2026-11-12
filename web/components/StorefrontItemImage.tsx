'use client';

import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import type { Product } from '@/lib/types';

export default function StorefrontItemImage({ product }: { product: Product }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const touchStart = useRef<number | null>(null);
  const images = [
    ...(product.image ? [{ id: 'primary', url: product.image.url, width: product.image.width, height: product.image.height }] : []),
    ...(product.additional_images ?? []),
  ];
  const [active, setActive] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  useEffect(() => {
    if (!lightboxOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previousOverflow; };
  }, [lightboxOpen]);
  if (!images.length) return null;
  const show = (index: number) => { setActive(index); dialog.current?.showModal(); setLightboxOpen(true); };
  const move = (delta: number) => setActive((index) => (index + delta + images.length) % images.length);
  return (
    <div>
      <button type="button" onClick={() => show(active)} aria-label={`הגדלת תמונת ${product.name}; פתיחת גלריית תמונות`} aria-haspopup="dialog" className="group relative block aspect-[4/3] w-full cursor-zoom-in overflow-hidden bg-gray-50 focus-visible:outline-2 focus-visible:outline-offset-[-4px] focus-visible:outline-primary">
        <Image src={images[active].url} alt={product.name} fill sizes="(min-width:1024px) 33vw, (min-width:640px) 50vw, 100vw" className="object-cover transition-transform duration-300 ease-out group-hover:scale-[1.03] group-focus-visible:scale-[1.03]" />
        <span aria-hidden="true" className="absolute end-3 top-3 grid h-10 w-10 place-items-center rounded-full bg-black/65 text-white shadow-md transition-colors group-hover:bg-black/80">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5"><circle cx="10.8" cy="10.8" r="6.8" /><path d="m16 16 4.5 4.5M10.8 7.5v6.6M7.5 10.8h6.6" /></svg>
        </span>
        <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/65 to-transparent px-3 pb-3 pt-8 text-start text-xs font-medium text-white opacity-100 sm:opacity-0 sm:transition-opacity sm:duration-200 sm:group-hover:opacity-100 sm:group-focus-visible:opacity-100">לחצו להגדלה</span>
      </button>
      {images.length > 1 && (
        <div className="flex gap-2 overflow-x-auto p-2" role="group" aria-label="תמונות נוספות">
          {images.map((image, index) => (
            <button key={image.id} type="button" onClick={() => setActive(index)} aria-label={`הצגת תמונה ${index + 1} מתוך ${images.length}`} aria-pressed={active === index}
              className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg border-2 border-transparent aria-pressed:border-primary focus-visible:outline-2 focus-visible:outline-offset-2">
              <Image src={image.url} alt="" fill sizes="56px" className="object-cover" />
            </button>
          ))}
        </div>
      )}
      <dialog ref={dialog} aria-label={`גלריית תמונות: ${product.name}`} onClose={() => setLightboxOpen(false)} onClick={(event) => {
        if (event.target === dialog.current) dialog.current?.close();
      }} onKeyDown={(event) => {
        if (event.key === 'ArrowRight') { event.preventDefault(); move(1); }
        if (event.key === 'ArrowLeft') { event.preventDefault(); move(-1); }
      }} className="m-auto max-h-[96dvh] w-[calc(100%-1rem)] max-w-5xl rounded-2xl border border-white/10 bg-neutral-950 p-3 text-white shadow-2xl backdrop:bg-black/85 sm:p-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="min-w-0 whitespace-normal break-words text-sm font-semibold [overflow-wrap:anywhere] sm:text-base">{product.name}</p>
            <p className="text-xs text-white/65">תצוגת תמונה מוגדלת · {active + 1} מתוך {images.length}</p>
          </div>
          <button type="button" onClick={() => dialog.current?.close()} autoFocus className="grid min-h-11 min-w-11 place-items-center rounded-full border border-white/30 bg-white/10 text-xl transition hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white" aria-label="סגירת גלריית התמונות">✕</button>
        </div>
        <div
          className="relative mx-auto flex h-[min(68dvh,720px)] w-full touch-pan-y items-center justify-center overflow-hidden rounded-xl bg-black"
          onTouchStart={(event) => { touchStart.current = event.touches[0]?.clientX ?? null; }}
          onTouchEnd={(event) => {
            if (touchStart.current === null || images.length < 2) return;
            const delta = (event.changedTouches[0]?.clientX ?? touchStart.current) - touchStart.current;
            if (Math.abs(delta) > 45) move(delta < 0 ? 1 : -1);
            touchStart.current = null;
          }}
        >
          <Image src={images[active].url} alt={`${product.name}, תמונה ${active + 1}`} fill sizes="90vw" className="object-contain" />
        </div>
        {images.length > 1 && (
          <div className="mt-3 flex justify-center gap-2 overflow-x-auto pb-1" role="group" aria-label="בחירת תמונה בגלריה">
            {images.map((image, index) => (
              <button key={image.id} type="button" onClick={() => setActive(index)} aria-label={`מעבר לתמונה ${index + 1}`} aria-pressed={active === index}
                className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg border-2 border-white/20 opacity-65 transition aria-pressed:border-white aria-pressed:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
                <Image src={image.url} alt="" fill sizes="48px" className="object-cover" />
              </button>
            ))}
          </div>
        )}
        <p className="mt-2 text-center text-[11px] text-white/55">אפשר לסגור עם Esc או בלחיצה מחוץ לתמונה</p>
      </dialog>
    </div>
  );
}
