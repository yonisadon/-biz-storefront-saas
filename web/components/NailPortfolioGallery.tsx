'use client';

import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import type { GalleryImage } from '@/lib/types';

type Props = { images: GalleryImage[]; heroId?: string; layout?: 'slider' | 'thumbnails' };

export default function NailPortfolioGallery({ images, heroId, layout = 'slider' }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const photos = images.slice(0, 7);
  const initialIndex = Math.max(0, photos.findIndex((photo) => photo.id === heroId));
  const [active, setActive] = useState(initialIndex);
  const [autoPlay, setAutoPlay] = useState(layout === 'slider' && photos.length > 1);

  useEffect(() => {
    setActive(Math.max(0, photos.findIndex((photo) => photo.id === heroId)));
  }, [heroId, images]);

  useEffect(() => {
    if (layout !== 'slider' || !autoPlay || photos.length < 2) return;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (media.matches || document.documentElement.classList.contains('a11y-reduce-motion')) {
      setAutoPlay(false);
      return;
    }
    const timer = window.setInterval(() => setActive((current) => (current + 1) % photos.length), 5000);
    return () => window.clearInterval(timer);
  }, [autoPlay, layout, photos.length]);

  if (!photos.length) return null;
  const move = (delta: number) => setActive((current) => (current + delta + photos.length) % photos.length);
  const current = photos[active] ?? photos[0];

  return (
    <>
      <div className={layout === 'thumbnails' ? 'nail-portfolio-view nail-portfolio-view--thumbnails' : 'nail-portfolio-view nail-portfolio-view--slider'}>
        <button type="button" className="nail-portfolio-main" onClick={() => dialog.current?.showModal()} aria-label={`הגדלת תמונה ${active + 1} מתוך ${photos.length}`}>
          <Image src={current.url} alt={current.alt || current.caption || 'עבודת ציפורניים'} fill priority sizes="(max-width: 640px) 100vw, 1056px" className="object-contain" />
          {current.caption && <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-4 pb-4 pt-10 text-start text-sm font-medium text-white">{current.caption}</span>}
        </button>
        {photos.length > 1 && (layout === 'thumbnails'
          ? <div className="nail-portfolio-thumbnails" role="group" aria-label="בחירת תמונה">
              {photos.map((photo, index) => <button key={photo.id} type="button" onClick={() => setActive(index)} aria-label={`תמונה ${index + 1} מתוך ${photos.length}`} aria-pressed={active === index} className="nail-portfolio-thumb">
                <Image src={photo.url} alt="" fill sizes="100px" className="object-cover" />
              </button>)}
            </div>
          : <div className="nail-portfolio-controls">
              <button type="button" onClick={() => setAutoPlay((value) => !value)} className="nail-portfolio-autoplay">{autoPlay ? 'עצירת החלפה אוטומטית' : 'הפעלת החלפה אוטומטית'}</button>
              <div className="flex items-center gap-2" role="group" aria-label="בחירת תמונה">
                {photos.map((photo, index) => <button key={photo.id} type="button" onClick={() => setActive(index)} aria-label={`תמונה ${index + 1} מתוך ${photos.length}`} aria-current={active === index ? 'true' : undefined} className={active === index ? 'h-2.5 w-6 rounded-full bg-white' : 'h-2.5 w-2.5 rounded-full bg-white/65'} />)}
              </div>
            </div>
        )}
      </div>
      <dialog ref={dialog} aria-label="תיק עבודות – תמונה מוגדלת" onClick={(event) => { if (event.target === dialog.current) dialog.current?.close(); }} onKeyDown={(event) => { if (event.key === 'ArrowRight') { event.preventDefault(); move(1); } if (event.key === 'ArrowLeft') { event.preventDefault(); move(-1); } }} className="nail-portfolio-dialog m-auto max-h-[94dvh] w-[calc(100%-1rem)] max-w-5xl rounded-2xl bg-neutral-950 p-3 text-white shadow-2xl backdrop:bg-black/85 sm:p-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <p className="text-sm text-white/75">{active + 1} מתוך {photos.length}</p>
          <button type="button" autoFocus onClick={() => dialog.current?.close()} className="grid min-h-11 min-w-11 place-items-center rounded-full border border-white/30 text-xl" aria-label="סגירה">×</button>
        </div>
        <div className="relative mx-auto h-[min(72dvh,760px)] w-full overflow-hidden rounded-xl bg-black">
          <Image src={current.url} alt={current.alt || current.caption || 'עבודת ציפורניים'} fill sizes="92vw" className="object-contain" />
        </div>
        {photos.length > 1 && <div className="mt-3 flex justify-center gap-2 overflow-x-auto pb-1" role="group" aria-label="בחירת תמונה">
          {photos.map((photo, index) => <button key={photo.id} type="button" onClick={() => setActive(index)} aria-label={`תמונה ${index + 1}`} aria-pressed={active === index} className="relative h-12 w-12 shrink-0 overflow-hidden rounded-md border-2 border-white/20 aria-pressed:border-white">
            <Image src={photo.url} alt="" fill sizes="48px" className="object-cover" />
          </button>)}
        </div>}
      </dialog>
    </>
  );
}
