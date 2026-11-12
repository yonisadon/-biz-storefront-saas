'use client';

import { useState } from 'react';
import PalettePicker from '@/components/PalettePicker';
import StorefrontDesignPicker from '@/components/StorefrontDesignPicker';
import { BRAND_PALETTES, paletteIdForColors, type PaletteId } from '@/lib/palettes';
import { ApiError, mcall } from '@/lib/manageApi';
import type { ManageBusiness } from '@/lib/types';

type StorefrontTheme = 'soft' | 'flat' | 'editorial' | 'creative';
type GalleryLayout = 'slider' | 'thumbnails';
type FontStyle = 'modern' | 'rounded' | 'elegant' | 'warm';

function saveError(err: unknown): string {
  if (err instanceof ApiError && err.body?.error === 'invalid_config') return 'הגדרות העיצוב לא עברו אימות.';
  return 'שמירת העיצוב נכשלה. נסו שוב.';
}

export default function DesignPanel({ token, biz, onSaved }: {
  token: string; biz: ManageBusiness; onSaved: (b: ManageBusiness) => void;
}) {
  const validThemes: StorefrontTheme[] = ['soft', 'flat', 'editorial', 'creative'];
  const validFonts: FontStyle[] = ['modern', 'rounded', 'elegant', 'warm'];
  const savedTheme = biz.config.branding?.storefront_theme as StorefrontTheme | undefined;
  const savedGalleryLayout = biz.config.branding?.hero_gallery_layout as GalleryLayout | undefined;
  const savedFont = biz.config.branding?.font_style as FontStyle | undefined;
  const [palette, setPalette] = useState<PaletteId>(paletteIdForColors(biz.config.branding?.colors));
  const [storefrontTheme, setStorefrontTheme] = useState<StorefrontTheme>(savedTheme && validThemes.includes(savedTheme) ? savedTheme : 'soft');
  const [galleryLayout, setGalleryLayout] = useState<GalleryLayout>(savedGalleryLayout === 'thumbnails' ? 'thumbnails' : 'slider');
  const [fontStyle, setFontStyle] = useState<FontStyle>(savedFont && validFonts.includes(savedFont) ? savedFont : 'modern');
  const [businessTitleColor, setBusinessTitleColor] = useState<'brand' | 'black'>(biz.config.branding?.business_title_color === 'black' ? 'black' : 'brand');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    setMsg(null);
    setSaving(true);
    try {
      const latest = await mcall<ManageBusiness>(token, 'business');
      const saved = await mcall<Partial<ManageBusiness>>(token, 'business', {
        method: 'PATCH',
        body: JSON.stringify({
          config: {
            ...latest.config,
            branding: {
              ...(latest.config.branding ?? {}),
              colors: BRAND_PALETTES[palette].colors,
              font_style: fontStyle,
              business_title_color: businessTitleColor,
              storefront_theme: storefrontTheme,
              hero_gallery_layout: galleryLayout,
            },
          },
        }),
      });
      onSaved({ ...biz, ...saved });
      setMsg({ ok: true, text: 'הגדרות העיצוב נשמרו.' });
    } catch (err) {
      setMsg({ ok: false, text: saveError(err) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-3xl space-y-5">
      <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="mb-4">
          <h2 className="text-lg font-bold">עיצוב האתר</h2>
          <p className="mt-1 text-sm leading-6 text-gray-600">כאן משנים את המראה של האתר שהלקוחות רואים. השינויים אינם משנים את פרטי העסק או את המוצרים והשירותים.</p>
        </div>
        <div className="space-y-5">
          <PalettePicker value={palette} onChange={setPalette} />
          <StorefrontDesignPicker theme={storefrontTheme} onThemeChange={setStorefrontTheme} galleryLayout={galleryLayout} onGalleryLayoutChange={setGalleryLayout} />
          <fieldset className="space-y-2 rounded-xl border border-gray-200 p-3">
            <legend className="px-1 text-sm font-semibold">סגנון כתב באתר</legend>
            <p className="text-xs leading-5 text-gray-500">בחרו סגנון אחיד לשם העסק, לכותרות ולטקסטים.</p>
            <div className="grid grid-cols-2 gap-2">
              {([
                { id: 'modern', title: 'מודרני', sample: 'נקי וברור', family: '"Heebo", Arial, sans-serif', note: 'חד ומאוזן' },
                { id: 'rounded', title: 'מעוגל', sample: 'נעים וחברותי', family: '"Rubik", Arial, sans-serif', note: 'רך ונגיש' },
                { id: 'elegant', title: 'אלגנטי', sample: 'יופי בפרטים', family: '"Frank Ruhl Libre", serif', note: 'כותרות עם אופי' },
                { id: 'warm', title: 'חמים', sample: 'עסק עם לב', family: '"Assistant", Arial, sans-serif', note: 'אישי ומזמין' },
              ] as const).map((option) => (
                <label key={option.id} className={`relative flex min-h-24 cursor-pointer flex-col justify-center rounded-xl border p-3 transition ${fontStyle === option.id ? 'border-gray-900 bg-gray-50 ring-2 ring-gray-900/10' : 'border-gray-200 hover:border-gray-400'}`}>
                  <input className="absolute end-2 top-2" type="radio" name="fontStyle" value={option.id} checked={fontStyle === option.id} onChange={() => setFontStyle(option.id)} />
                  <span className="text-sm font-bold" style={{ fontFamily: option.family }}>{option.title}</span>
                  <span className="mt-1 text-lg leading-6" style={{ fontFamily: option.family }}>{option.sample}</span>
                  <span className="mt-1 text-xs text-gray-500">{option.note}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset className="space-y-2 rounded-xl border border-gray-200 p-3">
            <legend className="px-1 text-sm font-semibold">צבע שם העסק</legend>
            <p className="text-xs leading-5 text-gray-500">הבחירה משפיעה רק על שם העסק בראש האתר.</p>
            <div className="grid grid-cols-2 gap-2">
              <label className={`flex cursor-pointer items-center gap-2 rounded-lg border p-3 text-sm ${businessTitleColor === 'brand' ? 'border-gray-900 bg-gray-50 ring-2 ring-gray-900/10' : 'border-gray-200'}`}>
                <input type="radio" name="businessTitleColor" checked={businessTitleColor === 'brand'} onChange={() => setBusinessTitleColor('brand')} />
                <span>צבע המותג</span>
                <span aria-hidden="true" className="h-4 w-4 rounded-full border border-gray-300" style={{ background: BRAND_PALETTES[palette].colors.primary }} />
              </label>
              <label className={`flex cursor-pointer items-center gap-2 rounded-lg border p-3 text-sm ${businessTitleColor === 'black' ? 'border-gray-900 bg-gray-50 ring-2 ring-gray-900/10' : 'border-gray-200'}`}>
                <input type="radio" name="businessTitleColor" checked={businessTitleColor === 'black'} onChange={() => setBusinessTitleColor('black')} />
                <span>שחור</span>
                <span aria-hidden="true" className="h-4 w-4 rounded-full border border-gray-300 bg-black" />
              </label>
            </div>
          </fieldset>
        </div>
        {msg && <p role={msg.ok ? 'status' : 'alert'} className={`mt-4 rounded-lg p-2 text-sm ${msg.ok ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}>{msg.text}</p>}
        <button type="button" onClick={save} disabled={saving} className="mt-5 rounded-full bg-gray-900 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60">
          {saving ? 'שומר…' : 'שמירת העיצוב'}
        </button>
      </section>
    </div>
  );
}
