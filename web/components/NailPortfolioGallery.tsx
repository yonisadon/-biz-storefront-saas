'use client';

import Image from 'next/image';
import { useRef, useState } from 'react';
import type { GalleryImage } from '@/lib/types';

export default function NailPortfolioGallery({ images }: { images: GalleryImage[] }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [active, setActive] = useState(0);
  const photos = images.slice(0, 7);
  if (!photos.length) return null;

  return (
    <>
      <div className="nail-portfolio-grid" aria-label="תיק עבודות">
        {photos.map((photo, index) => (
          <button
            key={photo.id}
            type="button"
            className="nail-portfolio-photo"
            onClick={() => { setActive(index); dialog.current?.showModal(); }}
            aria-label={`הגדלת תמונה ${index + 1} מתוך ${photos.length}`}
          >
            <Image
              src={photo.url}
              alt={photo.alt || photo.caption || 'עבודת ציפורניים'}
              fill
              priority={index < 2}
              sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 360px"
              className="object-cover"
            />
          </button>
        ))}
      </div>
      <dialog
        ref={dialog}
        aria-label="תיק עבודות – תמונה מוגדלת"
        onClick={(event) => { if (event.target === dialog.current) dialog.current?.close(); }}
        className="nail-portfolio-dialog m-auto max-h-[94dvh] w-[calc(100%-1rem)] max-w-5xl rounded-2xl bg-neutral-950 p-3 text-white shadow-2xl backdrop:bg-black/85 sm:p-5"
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <p className="text-sm text-white/75">{active + 1} מתוך {photos.length}</p>
          <button type="button" autoFocus onClick={() => dialog.current?.close()} className="grid min-h-11 min-w-11 place-items-center rounded-full border border-white/30 text-xl" aria-label="סגירה">×</button>
        </div>
        <div className="relative mx-auto h-[min(72dvh,760px)] w-full overflow-hidden rounded-xl bg-black">
          <Image src={photos[active].url} alt={photos[active].alt || photos[active].caption || 'עבודת ציפורניים'} fill sizes="92vw" className="object-contain" />
        </div>
        {photos.length > 1 && <div className="mt-3 flex justify-center gap-2 overflow-x-auto pb-1" role="group" aria-label="בחירת תמונה">
          {photos.map((photo, index) => (
            <button key={photo.id} type="button" onClick={() => setActive(index)} aria-label={`תמונה ${index + 1}`} aria-pressed={active === index} className="relative h-12 w-12 shrink-0 overflow-hidden rounded-md border-2 border-white/20 aria-pressed:border-white">
              <Image src={photo.url} alt="" fill sizes="48px" className="object-cover" />
            </button>
          ))}
        </div>}
      </dialog>
    </>
  );
}
