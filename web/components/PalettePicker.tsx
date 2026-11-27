'use client';
import { BRAND_PALETTES, type PaletteId } from '@/lib/palettes';
import { usePlatformLanguage } from '@/components/PlatformLanguageProvider';

const paletteMessageKeys: Record<PaletteId, { title: import('@/lib/platformI18n').PlatformMessageKey; description: import('@/lib/platformI18n').PlatformMessageKey }> = {
  lavender: { title: 'paletteLavenderTitle', description: 'paletteLavenderDescription' },
  rose: { title: 'paletteRoseTitle', description: 'paletteRoseDescription' },
  natural: { title: 'paletteNaturalTitle', description: 'paletteNaturalDescription' },
  luxury: { title: 'paletteLuxuryTitle', description: 'paletteLuxuryDescription' },
  blue: { title: 'paletteBlueTitle', description: 'paletteBlueDescription' },
  minimal: { title: 'paletteMinimalTitle', description: 'paletteMinimalDescription' },
};

export default function PalettePicker({ value, onChange }: { value: PaletteId; onChange: (value: PaletteId) => void }) {
  const { t } = usePlatformLanguage();
  return <fieldset>
    <legend className="mb-2 block text-sm font-semibold">{t('paletteSectionTitle')}</legend>
    <p className="mb-3 text-xs leading-5 text-slate-500">{t('paletteSectionIntro')}</p>
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" role="radiogroup" aria-label={t('paletteGroupLabel')}>
      {(Object.entries(BRAND_PALETTES) as [PaletteId, (typeof BRAND_PALETTES)[PaletteId]][]).map(([id, palette]) => {
        const messages = paletteMessageKeys[id];
        return <button key={id} type="button" role="radio" aria-checked={value === id} onClick={() => onChange(id)}
          className={`rounded-xl border p-3 text-start transition focus-visible:outline-2 focus-visible:outline-offset-2 ${value === id ? 'border-slate-900 bg-slate-50 ring-2 ring-slate-900/10' : 'border-slate-200 hover:border-slate-400'}`}>
          <span className="flex items-center justify-between gap-2"><span className="text-sm font-semibold">{t(messages.title)}</span>
            <span className="flex shrink-0 gap-1" aria-hidden="true">{Object.values(palette.colors).map(color => <span key={color} className="h-4 w-4 rounded-full border border-black/10" style={{ backgroundColor: color }} />)}</span>
          </span><span className="mt-1 block text-xs leading-5 text-slate-500">{t(messages.description)}</span>
        </button>;
      })}
    </div>
  </fieldset>;
}
