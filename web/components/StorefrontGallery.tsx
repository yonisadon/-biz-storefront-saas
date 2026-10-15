'use client';

import Image from 'next/image';
import { useEffect, useState } from 'react';
import type { GalleryImage } from '@/lib/types';

export default function StorefrontGallery({ images, heroId }: { images: GalleryImage[]; heroId?: string }) {
  const hero = images.find((image) => image.id === heroId) ?? images[0];
  const extras = images.filter((image) => image.id !== hero?.id).slice(0, 6);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
      if (event.key === 'ArrowRight') setActive((current) => (current + 1) % extras.length);
      if (event.key === 'ArrowLeft') setActive((current) => (current - 1 + extras.length) % extras.length);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, extras.length]);

  if (!hero) return null;

  return (
    <section aria-label="תמונות העסק" className="space-y-4">
      <div className="relative mx-auto aspect-[4/3] w-full max-w-5xl overflow-hidden rounded-[1.75rem] bg-slate-100 shadow-lg sm:aspect-[16/8]">
        <Image src={hero.url} alt={hero.alt || hero.caption || 'תמונה ראשית של העסק'} fill priority sizes="(max-width: 640px) 100vw, 1024px" className="object-cover" />
      </div>
      {extras.length > 0 && (
        <div className="flex justify-center">
          <button type="button" onClick={() => { setActive(0); setOpen(true); }}
            className="inline-flex min-h-11 items-center gap-2 rounded-full border border-ink/15 bg-white px-5 py-2.5 text-sm font-bold text-ink shadow-sm transition hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9" r="1.5"/><path d="m21 15-5-5L5 20"/></svg>
            לגלריית התמונות
            <span className="text-xs font-medium text-ink/60">({extras.length})</span>
          </button>
        </div>
      )}
      {open && extras.length > 0 && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 p-3 sm:p-8" role="dialog" aria-modal="true" aria-label="גלריית תמונות">
          <button type="button" onClick={() => setOpen(false)} aria-label="סגירת הגלריה" className="absolute end-4 top-4 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-white/15 text-3xl text-white hover:bg-white/25 focus-visible:outline-2 focus-visible:outline-white">×</button>
          <div className="relative flex h-full max-h-[85vh] w-full max-w-6xl items-center justify-center">
            <Image src={extras[active].url} alt={extras[active].alt || extras[active].caption || `תמונה ${active + 1}`} fill sizes="95vw" className="object-contain" />
            {extras.length > 1 && <>
              <button type="button" onClick={() => setActive((active - 1 + extras.length) % extras.length)} aria-label="התמונה הקודמת" className="absolute start-2 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-2xl text-white ring-1 ring-white/40">›</button>
              <button type="button" onClick={() => setActive((active + 1) % extras.length)} aria-label="התמונה הבאה" className="absolute end-2 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-2xl text-white ring-1 ring-white/40">‹</button>
            </>}
            <div className="absolute bottom-2 rounded-full bg-black/60 px-3 py-1.5 text-sm text-white" aria-live="polite">{active + 1} / {extras.length}</div>
          </div>
        </div>
      )}
    </section>
  );
}
