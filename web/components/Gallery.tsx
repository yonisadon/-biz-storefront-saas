'use client';

import Image from 'next/image';
import { useRef, useState } from 'react';
import type { GalleryImage } from '@/lib/types';

export default function Gallery({ images }: { images: GalleryImage[] }) {
  const track = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const list = images.slice(0, 10);
  if (list.length === 0) return null;

  // RTL scrollers report negative scrollLeft, so use the absolute value
  const onScroll = () => {
    const el = track.current;
    if (!el || !el.clientWidth) return;
    const i = Math.round(Math.abs(el.scrollLeft) / el.clientWidth);
    setActive(Math.min(list.length - 1, Math.max(0, i)));
  };

  const go = (i: number) =>
    track.current?.children[i]?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });

  return (
    <section aria-roledescription="carousel" aria-label="גלריית עבודות" className="relative bg-black/5">
      <div
        ref={track}
        onScroll={onScroll}
        tabIndex={0}
        className="flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {list.map((img, i) => (
          <div
            key={img.url}
            role="group"
            aria-roledescription="שקופית"
            aria-label={`${i + 1} מתוך ${list.length}`}
            className="relative aspect-[4/3] w-full shrink-0 snap-center sm:aspect-[16/7]"
          >
            <Image
              src={img.url}
              alt={img.alt || img.caption || `תמונה ${i + 1}`}
              fill
              sizes="100vw"
              priority={i === 0}
              className="object-cover"
            />
          </div>
        ))}
      </div>

      {list.length > 1 && (
        <div className="absolute inset-x-0 bottom-2 flex justify-center">
          {list.map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => go(i)}
              aria-label={`מעבר לתמונה ${i + 1}`}
              aria-current={i === active}
              className="p-1.5"
            >
              <span className={`block h-2.5 rounded-full transition-all ${i === active ? 'w-6 bg-white' : 'w-2.5 bg-white/60'}`} />
            </button>
          ))}
        </div>
      )}
    </section>
  );
}