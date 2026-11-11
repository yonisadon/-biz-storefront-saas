'use client';

import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import type { GalleryImage } from '@/lib/types';

export default function StorefrontGallery({ images, heroId, layout = 'slider' }: { images: GalleryImage[]; heroId?: string; layout?: 'slider' | 'thumbnails' }) {
  const slides = images.slice(0, 7);
  const heroIndex = Math.max(0, slides.findIndex((image) => image.id === heroId));
  const [active, setActive] = useState(heroIndex);
  const [autoPlay, setAutoPlay] = useState(false);
  const touchStart = useRef<number | null>(null);

  useEffect(() => {
    setActive(Math.max(0, slides.findIndex((image) => image.id === heroId)));
  }, [heroId, images]);

  useEffect(() => {
    if (layout === 'thumbnails' || slides.length < 2) { setAutoPlay(false); return; }
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const stopForReducedMotion = () => {
      if (media.matches || document.documentElement.classList.contains('a11y-reduce-motion')) {
        setAutoPlay(false);
      }
    };
    if (!media.matches && !document.documentElement.classList.contains('a11y-reduce-motion')) {
      setAutoPlay(true);
    }
    const observer = new MutationObserver(stopForReducedMotion);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    media.addEventListener('change', stopForReducedMotion);
    return () => {
      observer.disconnect();
      media.removeEventListener('change', stopForReducedMotion);
    };
  }, [slides.length, layout]);

  useEffect(() => {
    if (layout === 'thumbnails' || !autoPlay || slides.length < 2) return;
    const timer = window.setInterval(() => setActive((current) => (current + 1) % slides.length), 5000);
    return () => window.clearInterval(timer);
  }, [autoPlay, slides.length, layout]);

  if (!slides[active]) return null;

  if (layout === 'thumbnails') {
    return (
      <section aria-label="תמונות העסק" className="mx-auto max-w-5xl space-y-3">
        <div
          className="relative aspect-[16/10] w-full overflow-hidden rounded-[1.5rem] bg-ink/5 sm:aspect-[16/7] sm:rounded-[2rem]"
          onTouchStart={(event) => { touchStart.current = event.touches[0]?.clientX ?? null; }}
          onTouchEnd={(event) => {
            if (touchStart.current === null) return;
            const delta = (event.changedTouches[0]?.clientX ?? touchStart.current) - touchStart.current;
            if (Math.abs(delta) > 45) setActive((current) => (current + (delta < 0 ? 1 : -1) + slides.length) % slides.length);
            touchStart.current = null;
          }}
        >
          <Image src={slides[active].url} alt={slides[active].alt || slides[active].caption || 'תמונה של העסק'} fill priority sizes="(max-width: 640px) 100vw, 1024px" className="object-cover" />
          {slides[active].caption && <p className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-4 pb-4 pt-8 text-sm font-medium text-white">{slides[active].caption}</p>}
        </div>
        {slides.length > 1 && <div className="flex gap-2 overflow-x-auto pb-2" role="group" aria-label="בחירת תמונה">
          {slides.map((image, index) => <button key={image.id} type="button" aria-label={'תמונה ' + (index + 1) + ' מתוך ' + slides.length} aria-current={index === active ? 'true' : undefined} onClick={() => setActive(index)} className={'relative h-12 w-16 shrink-0 overflow-hidden rounded-lg border-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary sm:h-14 sm:w-20 ' + (index === active ? 'border-primary' : 'border-transparent opacity-75 hover:opacity-100')}>
            <Image src={image.url} alt="" fill sizes="112px" className="object-cover" />
          </button>)}
        </div>}
      </section>
    );
  }

  return (
    <section aria-label="תמונות העסק" className="mx-auto max-w-5xl">
      <div
        className="relative aspect-[16/10] w-full overflow-hidden rounded-[1.5rem] bg-ink/5 shadow-md sm:aspect-[16/7] sm:rounded-[2rem]"
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
          <div className="absolute inset-x-0 bottom-0 z-20 flex flex-wrap items-center justify-center gap-2 bg-gradient-to-t from-black/60 to-transparent px-4 pb-3 pt-8" aria-label="בקרת גלריית התמונות">
            <button
              type="button"
              onClick={() => setAutoPlay((value) => !value)}
              className="min-h-11 rounded-full border border-white/80 bg-black/70 px-3 text-sm font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            >
              {autoPlay ? 'עצירת החלפה אוטומטית' : 'הפעלת החלפה אוטומטית'}
            </button>
            <div className="flex items-center justify-center gap-1.5" role="group" aria-label="בחירת תמונה">
              {slides.map((image, index) => <button key={image.id} type="button" aria-label={'תמונה ' + (index + 1) + ' מתוך ' + slides.length} aria-current={index === active ? 'true' : undefined} onClick={() => setActive(index)} className={'h-3 min-w-3 rounded-full transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white ' + (index === active ? 'w-6 bg-white' : 'w-3 bg-white/75 hover:bg-white')} />)}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
