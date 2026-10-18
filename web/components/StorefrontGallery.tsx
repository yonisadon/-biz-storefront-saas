'use client';

import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import type { GalleryImage } from '@/lib/types';

export default function StorefrontGallery({ images, heroId }: { images: GalleryImage[]; heroId?: string }) {
  const slides = images.slice(0, 7);
  const heroIndex = Math.max(0, slides.findIndex((image) => image.id === heroId));
  const [active, setActive] = useState(heroIndex);
  const [open, setOpen] = useState(false);
  const touchStart = useRef<number | null>(null);
  const activeImage = slides[active];

  useEffect(() => {
    setActive(Math.max(0, slides.findIndex((image) => image.id === heroId)));
  }, [heroId, images]);

  useEffect(() => {
    if (open || slides.length < 2 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const timer = window.setInterval(() => setActive((current) => (current + 1) % slides.length), 5500);
    return () => window.clearInterval(timer);
  }, [open, slides.length]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
      if (event.key === 'ArrowLeft') setActive((current) => (current + 1) % slides.length);
      if (event.key === 'ArrowRight') setActive((current) => (current - 1 + slides.length) % slides.length);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, slides.length]);

  if (!activeImage) return null;
  const move = (delta: number) => setActive((current) => (current + delta + slides.length) % slides.length);

  return (
    <section aria-label="תמונות העסק" className="mx-auto max-w-5xl">
      <div
        className="group relative aspect-[5/4] w-full overflow-hidden rounded-[1.5rem] bg-ink/5 shadow-md sm:aspect-[16/7] sm:rounded-[2rem]"
        onTouchStart={(event) => { touchStart.current = event.touches[0]?.clientX ?? null; }}
        onTouchEnd={(event) => {
          if (touchStart.current === null) return;
          const delta = (event.changedTouches[0]?.clientX ?? touchStart.current) - touchStart.current;
          if (Math.abs(delta) > 45) move(delta > 0 ? -1 : 1);
          touchStart.current = null;
        }}
      >
        {slides.map((image, index) => (
          <div key={image.id} className={'absolute inset-0 transition-opacity duration-700 ' + (index === active ? 'z-10 opacity-100' : 'z-0 opacity-0')} aria-hidden={index !== active}>
            <Image src={image.url} alt={image.alt || image.caption || 'תמונה של העסק'} fill priority={index === heroIndex} sizes="(max-width: 640px) 100vw, 1024px" className="object-cover" />
          </div>
        ))}
        {slides.length > 1 && <>
          <button type="button" onClick={() => move(-1)} aria-label="לתמונה הקודמת" className="absolute start-3 top-1/2 z-20 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/35 text-2xl text-white backdrop-blur-sm transition hover:bg-black/55 sm:opacity-0 sm:group-hover:opacity-100">›</button>
          <button type="button" onClick={() => move(1)} aria-label="לתמונה הבאה" className="absolute end-3 top-1/2 z-20 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/35 text-2xl text-white backdrop-blur-sm transition hover:bg-black/55 sm:opacity-0 sm:group-hover:opacity-100">›</button>
          <div className="absolute inset-x-0 bottom-0 z-20 flex items-center justify-center gap-1.5 bg-gradient-to-t from-black/45 to-transparent px-4 pb-3 pt-8" aria-label="בחירת תמונה">
            {slides.map((image, index) => <button key={image.id} type="button" aria-label={'תמונה ' + (index + 1) + ' מתוך ' + slides.length} aria-current={index === active ? 'true' : undefined} onClick={() => setActive(index)} className={'h-2 rounded-full transition-all ' + (index === active ? 'w-6 bg-white' : 'w-2 bg-white/65 hover:bg-white')} />)}
          </div>
        </>}
        <button type="button" onClick={() => setOpen(true)} aria-label="הצגת התמונה בגודל מלא" className="absolute end-3 top-3 z-20 flex h-10 w-10 items-center justify-center rounded-full bg-black/35 text-white backdrop-blur-sm transition hover:bg-black/55">
          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5"/></svg>
        </button>
      </div>
      {open && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 p-3 sm:p-8" role="dialog" aria-modal="true" aria-label="תמונות העסק">
          <button type="button" onClick={() => setOpen(false)} aria-label="סגירת הגלריה" className="absolute end-4 top-4 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-white/15 text-3xl text-white hover:bg-white/25">×</button>
          <div className="relative flex h-full max-h-[85vh] w-full max-w-6xl items-center justify-center">
            <Image src={activeImage.url} alt={activeImage.alt || activeImage.caption || 'תמונת העסק'} fill sizes="95vw" className="object-contain" />
            {slides.length > 1 && <>
              <button type="button" onClick={() => move(-1)} aria-label="התמונה הקודמת" className="absolute start-2 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-2xl text-white ring-1 ring-white/40">›</button>
              <button type="button" onClick={() => move(1)} aria-label="התמונה הבאה" className="absolute end-2 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-2xl text-white ring-1 ring-white/40">‹</button>
            </>}
            <div className="absolute bottom-2 rounded-full bg-black/60 px-3 py-1.5 text-sm text-white" aria-live="polite">{active + 1} / {slides.length}</div>
          </div>
        </div>
      )}
    </section>
  );
}
