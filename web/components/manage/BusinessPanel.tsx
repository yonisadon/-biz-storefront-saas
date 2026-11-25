'use client';

import { useState } from 'react';
import { toLocalPhone } from '@/lib/format';
import { ApiError, mcallWithTimeout } from '@/lib/manageApi';
import type { ManageBusiness } from '@/lib/types';

function initialWhatsAppIntro(flow: Record<string, unknown>): string {
  if (typeof flow.whatsapp_intro === 'string') return flow.whatsapp_intro;
  // Migrate old configurations by preserving only the opening before the item placeholder.
  const legacy = typeof flow.whatsapp_message_template === 'string' ? flow.whatsapp_message_template : '';
  const intro = legacy.split('{items}')[0]
    .replace(/\\n/g, '\n')
    .replace(/\{(?:customer_name|customer_phone|estimated_total|message)\}/g, '')
    .trim();
  return intro || 'שלום, אשמח לקבל פרטים נוספים לגבי המוצרים או השירותים הבאים:';
}

function saveError(err: unknown): string {
  if (err instanceof ApiError) {
    const msgs: string[] = (err.body?.issues ?? []).map((i) => i.message);
    if (msgs.includes('invalid_il_phone')) return 'מספר טלפון אינו תקין.';
    if (err.body?.error === 'constraint_violation')
      return 'ההגדרות אינן תואמות למגבלות העסק. בדקו את מספר ה־WhatsApp ואת הגדרות ההזמנה.';
    if (err.body?.error === 'invalid_config' || err.body?.error === 'invalid_contact_options') return 'ההגדרות לא עברו אימות. ודאו שלכל סוג פריט יש לפחות דרך פנייה אחת.';
  }
  return 'השמירה נכשלה. נסו שוב.';
}

export default function BusinessPanel({ token, biz, onSaved }: {
  token: string; biz: ManageBusiness; onSaved: (b: ManageBusiness) => void;
}) {
  const flow = biz.config.order_flow ?? {};
  const contact = biz.config.contact_options ?? { products: { whatsapp_enabled: flow.whatsapp_enabled === true, crm_enabled: biz.config.crm_enabled !== false }, services: { calendar_enabled: false, whatsapp_enabled: flow.whatsapp_enabled === true, crm_enabled: biz.config.crm_enabled !== false } };
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
    productWa: contact.products.whatsapp_enabled === true,
    productCrm: contact.products.crm_enabled === true,
    serviceCalendar: contact.services.calendar_enabled === true,
    serviceWa: contact.services.whatsapp_enabled === true,
    serviceCrm: contact.services.crm_enabled === true,
    whatsappIntro: initialWhatsAppIntro(flow),
    announcementEnabled: biz.config.business_announcement?.enabled === true,
    announcementMessage: typeof biz.config.business_announcement?.message === 'string' ? biz.config.business_announcement.message : '',
  });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }));

  async function save(e: React.FormEvent) {
    e.preventDefault(); setMsg(null);
    if (!f.name.trim()) return setMsg({ ok: false, text: 'שם העסק הוא שדה חובה.' });
    if (!f.productWa && !f.productCrm) return setMsg({ ok: false, text: 'למוצרים יש להפעיל לפחות WhatsApp או CRM (פנייה באתר).' });
    if (!f.serviceCalendar && !f.serviceWa) return setMsg({ ok: false, text: 'לשירותים יש להפעיל לפחות שריון ביומן או WhatsApp.' });
    if ((f.productWa || f.serviceWa) && !f.whatsapp.trim()) return setMsg({ ok: false, text: 'כדי להפעיל WhatsApp יש להזין מספר WhatsApp.' });

    setSaving(true);
    try {
      // Read the latest config before saving so settings changed in another panel (e.g. hero image) are preserved.
      const latest = await mcallWithTimeout<ManageBusiness>(token, 'business');
      const latestFlow = latest.config.order_flow ?? flow;
      const saved = await mcallWithTimeout<Partial<ManageBusiness>>(token, 'business', {
        method: 'PATCH',
        body: JSON.stringify({
          name: f.name.trim(),
          phone: f.phone.trim() || null,
          whatsapp_number: f.whatsapp.trim() || null,
          email: f.email.trim() || null,
          about_text: f.about.trim() || null,
          config: {
            site_mode: 'catalog_order',
            crm_enabled: f.productCrm || f.serviceCrm,
            contact_options: {
              products: { whatsapp_enabled: f.productWa, crm_enabled: f.productCrm },
              services: { calendar_enabled: f.serviceCalendar, whatsapp_enabled: f.serviceWa, crm_enabled: f.serviceCrm },
            },
            order_flow: {
              ...latestFlow,
              whatsapp_enabled: f.productWa || f.serviceWa,
              site_inquiry_enabled: f.productCrm,
              whatsapp_crm_enabled: true,
              whatsapp_intro: f.whatsappIntro.trim(),
            },
            branding: latest.config.branding ?? {},
            social_links: { instagram: f.instagram.trim(), facebook: f.facebook.trim() },
            business_profile: {
              city: f.city.trim(),
              street_address: f.streetAddress.trim(),
              show_address: f.showAddress,
            },
            business_announcement: {
              enabled: f.announcementEnabled,
              message: f.announcementMessage.trim(),
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

        <label className="block text-sm font-medium">שם העסק
          <input className={input} value={f.name} onChange={(e) => set('name', e.target.value)} />
        </label>
        <label className="block text-sm font-medium">טלפון
          <input className={input} dir="ltr" inputMode="tel" value={f.phone} onChange={(e) => set('phone', e.target.value)} />
        </label>
        <label className="block text-sm font-medium">מספר WhatsApp
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

        <fieldset className="space-y-3 rounded-xl border border-gray-200 p-3">
          <legend className="px-1 text-sm font-semibold">הודעה בולטת ללקוחות</legend>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={f.announcementEnabled} onChange={(e) => set('announcementEnabled', e.target.checked)} />
            הצגת הודעה בולטת בראש האתר
          </label>
          <label className="block text-sm font-medium">תוכן ההודעה
            <textarea className={input} rows={3} maxLength={500} placeholder="הודעה שהלקוחות יראו בראש האתר" value={f.announcementMessage} onChange={(e) => set('announcementMessage', e.target.value)} />
            <span className="mt-1 block text-xs font-normal leading-5 text-gray-500">ההודעה תופיע כאזור מודגש בראש אתר הלקוחות, רק כשהאפשרות מופעלת ויש תוכן. אפשר להשתמש בה למבצעים, עדכונים, חופשות או הודעות חשובות. היא נפרדת לחלוטין משעות הפעילות וממצב פתוח/סגור.</span>
          </label>
        </fieldset>

        {(f.productWa || f.serviceWa) && (
          <label className="block text-sm font-medium">נוסח הודעת WhatsApp (משמש גם לפנייה כללית וגם להזמנה)
            <textarea className={input} rows={2} maxLength={1000} value={f.whatsappIntro}
              onChange={(e) => set('whatsappIntro', e.target.value)} />
            <span className="mt-1 block text-xs font-normal leading-5 text-gray-500">הנוסח הזה משמש גם לפנייה כללית וגם להזמנה. בפנייה כללית יישלח רק הנוסח (ובכרטיס שירות אפשר להוסיף את שם השירות); בהזמנה המערכת תוסיף אוטומטית פריטים, כמויות, סכום משוער ופרטי תור אם נבחרו. שם וטלפון יופיעו רק אם הוזנו.</span>
          </label>
        )}

        <fieldset className="space-y-3 rounded-xl border border-gray-200 p-3">
          <legend className="px-1 text-sm font-semibold">הגדרות מוצרים</legend>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={f.productWa} onChange={(e) => set('productWa', e.target.checked)} />
            <span><strong>פנייה ב-WhatsApp</strong><span className="block text-xs leading-5 text-gray-500">הלקוח יוכל לשלוח לעסק הודעה עם פרטי המוצרים שבחר.</span></span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={f.productCrm} onChange={(e) => set('productCrm', e.target.checked)} />
            <span><strong>CRM למוצרים ופנייה באתר</strong><span className="block text-xs leading-5 text-gray-500">הלקוח יוכל להשאיר פנייה באתר, והיא תתועד ב-CRM. כאשר CRM פעיל, גם פנייה ב-WhatsApp תתועד.</span></span>
          </label>
          <p className="text-xs text-gray-500">יש להפעיל לפחות אחת מהאפשרויות.</p>
        </fieldset>

        <fieldset className="space-y-3 rounded-xl border border-gray-200 p-3">
          <legend className="px-1 text-sm font-semibold">הגדרות שירותים</legend>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={f.serviceCalendar} onChange={(e) => set('serviceCalendar', e.target.checked)} />
            <span><strong>שריון ביומן ורשימת המתנה</strong><span className="block text-xs leading-5 text-gray-500">הלקוח יוכל לבחור תור פנוי ביומן או להגיש בקשת המתנה עם תאריך מועדף. בקשת המתנה אינה שומרת שעה ביומן.</span></span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={f.serviceWa} onChange={(e) => set('serviceWa', e.target.checked)} />
            <span><strong>פנייה ב-WhatsApp</strong><span className="block text-xs leading-5 text-gray-500">הלקוח יוכל לפנות לעסק לתיאום או לקבלת פרטים.</span></span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={f.serviceCrm} onChange={(e) => set('serviceCrm', e.target.checked)} />
            <span><strong>CRM לשירותים</strong><span className="block text-xs leading-5 text-gray-500">כל שריון, בקשת המתנה או התחלת פנייה ב-WhatsApp יתועדו ב-CRM. כיבוי CRM לא יפגע בתור או בבקשת ההמתנה.</span></span>
          </label>
          <p className="text-xs text-gray-500">יש להפעיל לפחות שריון ביומן או WhatsApp. CRM לשירותים הוא עצמאי מה-CRM למוצרים.</p>
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
          </ul>
        </section>
      </div>
    </div>
  );
}
