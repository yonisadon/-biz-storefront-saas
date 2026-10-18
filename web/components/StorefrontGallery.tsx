'use client';

import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import type { GalleryImage } from '@/lib/types';

export default function StorefrontGallery({ images, heroId }: { images: GalleryImage[]; heroId?: string }) {
  const slides = images.slice(0, 7);
  const heroIndex = Math.max(0, slides.findIndex((image) => image.id === heroId));
  const [active, setActive] = useState(heroIndex);
  const touchStart = useRef<number | null>(null);

  useEffect(() => {
    setActive(Math.max(0, slides.findIndex((image) => image.id === heroId)));
  }, [heroId, images]);

  useEffect(() => {
    if (slides.length < 2 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const timer = window.setInterval(() => setActive((current) => (current + 1) % slides.length), 5000);
    return () => window.clearInterval(timer);
  }, [slides.length]);

  if (!slides[active]) return null;

  return (
    <section aria-label="תמונות העסק" className="mx-auto max-w-5xl">
      <div
        className="relative aspect-[5/4] w-full overflow-hidden rounded-[1.5rem] bg-ink/5 shadow-md sm:aspect-[16/7] sm:rounded-[2rem]"
        onTouchStart={(event) => { touchStart.current = event.touches[0]?.clientX ?? null; }}
        onTouchEnd={(event) => {
          if (touchStart.current === null) return;
          const delta = (event.changedTouches[0]?.clientX ?? touchStart.current) - touchStart.current;
          // RTL: swipe left advances to the next image.
          if (Math.abs(delta) > 45) setActive((current) => (current + (delta < 0 ? 1 : -1) + slides.length) % slides.length);
          touchStart.current = null;
        }}
      >
        {slides.map((image, index) => (
          <div key={image.id} className={'absolute inset-0 transition-opacity duration-700 ' + (index === active ? 'z-10 opacity-100' : 'z-0 opacity-0')} aria-hidden={index !== active}>
            <Image src={image.url} alt={image.alt || image.caption || 'תמונה של העסק'} fill priority={index === heroIndex} sizes="(max-width: 640px) 100vw, 1024px" className="object-cover" />
          </div>
        ))}
        {slides.length > 1 && (
          <div className="absolute inset-x-0 bottom-0 z-20 flex items-center justify-center gap-1.5 bg-gradient-to-t from-black/45 to-transparent px-4 pb-3 pt-8" aria-label="בחירת תמונה">
            {slides.map((image, index) => <button key={image.id} type="button" aria-label={'תמונה ' + (index + 1) + ' מתוך ' + slides.length} aria-current={index === active ? 'true' : undefined} onClick={() => setActive(index)} className={'h-2 rounded-full transition-all ' + (index === active ? 'w-6 bg-white' : 'w-2 bg-white/65 hover:bg-white')} />)}
          </div>
        )}
      </div>
    </section>
  );
}
