'use client';

import { useState } from 'react';
import { toLocalPhone } from '@/lib/format';
import PalettePicker from '@/components/PalettePicker';
import { BRAND_PALETTES, paletteIdForColors, type PaletteId } from '@/lib/palettes';
import { ApiError, mcall } from '@/lib/manageApi';
import type { ManageBusiness } from '@/lib/types';

function initialWhatsAppIntro(flow: Record<string, any>): string {
  if (typeof flow.whatsapp_intro === 'string') return flow.whatsapp_intro;
  // Migrate old configurations by preserving only the opening before the item placeholder.
  const legacy = typeof flow.whatsapp_message_template === 'string' ? flow.whatsapp_message_template : '';
  const intro = legacy.split('{items}')[0]
    .replace(/\\n/g, '\n')
    .replace(/\{(?:customer_name|customer_phone|estimated_total|message)\}/g, '')
    .trim();
  return intro || 'שלום, אני מעוניין/ת להזמין את הפריטים הבאים:';
}

function saveError(err: unknown): string {
  if (err instanceof ApiError) {
    const msgs: string[] = (err.body?.issues ?? []).map((i: any) => i.message);
    if (msgs.includes('invalid_il_phone')) return 'מספר טלפון אינו תקין.';
    if (err.body?.error === 'constraint_violation')
      return 'לא ניתן להפעיל וואטסאפ בלי מספר וואטסאפ, ולפחות מסלול הזמנה אחד חייב להישאר פעיל.';
    if (err.body?.error === 'invalid_config') return 'ההגדרות לא עברו אימות.';
  }
  return 'השמירה נכשלה. נסו שוב.';
}

export default function BusinessPanel({ token, biz, onSaved }: {
  token: string; biz: ManageBusiness; onSaved: (b: ManageBusiness) => void;
}) {
  const flow = biz.config.order_flow ?? {};
  const [f, setF] = useState({
    name: biz.name,
    phone: toLocalPhone(biz.phone),
    whatsapp: toLocalPhone(biz.whatsapp_number),
    email: biz.email ?? '',
    about: biz.about_text ?? '',
    instagram: biz.config.social_links?.instagram ?? '',
    facebook: biz.config.social_links?.facebook ?? '',
    city: biz.config.business_profile?.city ?? '',
    streetAddress: biz.config.business_profile?.street_address ?? '',
    showAddress: biz.config.business_profile?.show_address === true,
    wa: flow.whatsapp_enabled === true,
    site: flow.site_inquiry_enabled === true,
    whatsappIntro: initialWhatsAppIntro(flow),
  });
  const [palette, setPalette] = useState<PaletteId>(paletteIdForColors(biz.config.branding?.colors));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }));

  async function save(e: React.FormEvent) {
    e.preventDefault(); setMsg(null);
    if (!f.name.trim()) return setMsg({ ok: false, text: 'שם העסק הוא שדה חובה.' });
    if (f.wa && !f.whatsapp.trim()) return setMsg({ ok: false, text: 'כדי להפעיל מסלול וואטסאפ יש להזין מספר וואטסאפ.' });
    if (!f.wa && !f.site) return setMsg({ ok: false, text: 'חייב להישאר לפחות מסלול הזמנה אחד פעיל.' });

    setSaving(true);
    try {
      const saved = await mcall<Partial<ManageBusiness>>(token, 'business', {
        method: 'PATCH',
        body: JSON.stringify({
          name: f.name.trim(),
          phone: f.phone.trim() || null,
          whatsapp_number: f.whatsapp.trim() || null,
          email: f.email.trim() || null,
          about_text: f.about.trim() || null,
          config: {
            order_flow: { ...flow, whatsapp_enabled: f.wa, site_inquiry_enabled: f.site, whatsapp_intro: f.whatsappIntro.trim() },
            branding: { ...(biz.config.branding ?? {}), colors: BRAND_PALETTES[palette].colors },
            social_links: { instagram: f.instagram.trim(), facebook: f.facebook.trim() },
            business_profile: {
              city: f.city.trim(),
              street_address: f.streetAddress.trim(),
              show_address: f.showAddress,
            },
          },
        }),
      });
      onSaved({ ...biz, ...saved });
      setMsg({ ok: true, text: 'השינויים נשמרו.' });
    } catch (err) {
      setMsg({ ok: false, text: saveError(err) });
    } finally {
      setSaving(false);
    }
  }

  const input = 'mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2';

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <form onSubmit={save} className="space-y-4 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5">
        <h2 className="text-lg font-bold">פרטי העסק</h2>
        <PalettePicker value={palette} onChange={setPalette} />
        <label className="block text-sm font-medium">שם העסק
          <input className={input} value={f.name} onChange={(e) => set('name', e.target.value)} />
        </label>
        <label className="block text-sm font-medium">טלפון
          <input className={input} dir="ltr" inputMode="tel" value={f.phone} onChange={(e) => set('phone', e.target.value)} />
        </label>
        <label className="block text-sm font-medium">מספר וואטסאפ (מקבל הזמנות)
          <input className={input} dir="ltr" inputMode="tel" value={f.whatsapp} onChange={(e) => set('whatsapp', e.target.value)} />
        </label>
        <label className="block text-sm font-medium">דוא״ל
          <input className={input} dir="ltr" type="email" value={f.email} onChange={(e) => set('email', e.target.value)} />
        </label>
        <label className="block text-sm font-medium">קישור Instagram (לא חובה)
          <input className={input} dir="ltr" type="url" placeholder="https://www.instagram.com/your-business" value={f.instagram} onChange={(e) => set('instagram', e.target.value)} />
        </label>
        <label className="block text-sm font-medium">קישור Facebook (לא חובה)
          <input className={input} dir="ltr" type="url" placeholder="https://www.facebook.com/your-business" value={f.facebook} onChange={(e) => set('facebook', e.target.value)} />
        </label>
        <fieldset className="space-y-3 rounded-xl border border-gray-200 p-3">
          <legend className="px-1 text-sm font-semibold">כתובת העסק</legend>
          <label className="block text-sm font-medium">עיר
            <input className={input} maxLength={120} value={f.city} onChange={(e) => set('city', e.target.value)} />
          </label>
          <label className="block text-sm font-medium">רחוב ומספר בית
            <input className={input} maxLength={250} value={f.streetAddress} onChange={(e) => set('streetAddress', e.target.value)} />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={f.showAddress} onChange={(e) => set('showAddress', e.target.checked)} />
            הצגת הכתובת באתר הלקוחות
          </label>
          <p className="text-xs text-gray-500">הכתובת נשמרת גם כשהיא מוסתרת מהלקוחות.</p>
        </fieldset>
        <label className="block text-sm font-medium">תיאור העסק (לא חובה)
          <textarea className={input} rows={4} maxLength={5000} placeholder="כמה מילים על העסק, השירותים או מה שמייחד אתכם" value={f.about} onChange={(e) => set('about', e.target.value)} />
          <span className="mt-1 block text-xs font-normal text-gray-500">יופיע מתחת לשם העסק באתר, רק אם מילאתם אותו.</span>
        </label>

        {f.wa && (
          <label className="block text-sm font-medium">פתיח להודעת WhatsApp (לא חובה)
            <textarea className={input} rows={2} maxLength={1000} value={f.whatsappIntro}
              onChange={(e) => set('whatsappIntro', e.target.value)} />
            <span className="mt-1 block text-xs font-normal leading-5 text-gray-500">כתבו רק משפט פתיחה. המערכת תצרף אוטומטית את הפריטים, הכמויות, הסכום המשוער והתור אם נבחר. שם וטלפון יופיעו רק אם הוזנו.</span>
          </label>
        )}

        <fieldset className="space-y-2 pt-1">
          <legend className="text-sm font-medium">מסלולי הזמנה באתר</legend>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={f.wa} onChange={(e) => set('wa', e.target.checked)} /> שלח הזמנה בוואטסאפ
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={f.site} onChange={(e) => set('site', e.target.checked)} /> השאר פנייה באתר
          </label>
        </fieldset>

        {msg && (
          <p role={msg.ok ? 'status' : 'alert'}
            className={`rounded-lg p-2 text-sm ${msg.ok ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}>{msg.text}</p>
        )}
        <button type="submit" disabled={saving}
          className="rounded-full bg-gray-900 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60">
          {saving ? 'שומר…' : 'שמירה'}
        </button>
      </form>

      <div className="space-y-6">
        {/* סעיף השעות הישן הוסר לחלוטין מכיוון שמנוהל כעת בטאב ייעודי */}

        <section className="rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="text-lg font-bold">קישורים</h2>
          <ul className="mt-2 space-y-1 text-sm">
            <li>כתובת האתר: <span dir="ltr">/biz/{biz.slug}</span></li>
            {biz.domains.map((d) => (
              <li key={d.domain}>
                דומיין: <span dir="ltr">{d.domain}</span>{' '}
                <span className="text-gray-500">({d.is_verified ? 'מאומת' : 'ממתין לאימות'}{d.is_primary ? ', ראשי' : ''})</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
