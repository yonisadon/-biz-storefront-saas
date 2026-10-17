'use client';

import { useState } from 'react';
import { fmtDate, ils, toLocalPhone, waLink } from '@/lib/format';
import { LEAD_STATUSES, STATUS_LABEL } from '@/lib/labels';
import { mcall } from '@/lib/manageApi';
import type { Lead, LeadStatus, LeadsResponse } from '@/lib/types';
import LeadNotes from './LeadNotes';

const PAGE = 25;

export default function LeadsPanel({ token, initial }: { token: string; initial: LeadsResponse }) {
  const [data, setData] = useState(initial);
  const [filter, setFilter] = useState<LeadStatus | ''>('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  async function load(status: LeadStatus | '', offset: number, searchTerm = search) {
    setLoading(true); setError(null);
    try {
      const qs = new URLSearchParams({ limit: String(PAGE), offset: String(offset) });
      if (status) qs.set('status', status);
      if (searchTerm) qs.set('search', searchTerm);
      setData(await mcall<LeadsResponse>(token, `leads?${qs}`));
    } catch {
      setError('לא הצלחנו לטעון את הפניות.');
    } finally {
      setLoading(false);
    }
  }


  async function exportExcel() {
    setExporting(true); setError(null);
    try {
      const all: Lead[] = [];
      let offset = 0;
      let total = 0;
      do {
        const qs = new URLSearchParams({ limit: '100', offset: String(offset) });
        if (filter) qs.set('status', filter);
        if (search) qs.set('search', search);
        const page = await mcall<LeadsResponse>(token, `leads?${qs}`);
        all.push(...page.leads);
        total = page.total;
        offset += page.leads.length;
        if (!page.leads.length) break;
      } while (offset < total);
      const exportRows = selectedIds.size ? all.filter((lead) => selectedIds.has(lead.id)) : all;
      const csvCell = (value: unknown) => {
        let text = String(value ?? '');
        if (['=', '+', '-', '@', '\\t', '\\r'].includes(text[0] ?? '')) text = "'" + text;
        return '"' + text.replace(/"/g, '""') + '"';
      };
      const headers = ['תאריך', 'שם לקוח', 'טלפון', 'דוא״ל', 'ערוץ', 'סטטוס', 'הודעת לקוח', 'פריטים', 'סכום משוער (₪)'];
      const rows = exportRows.map((l) => [
        fmtDate(l.created_at), l.customer_name, l.customer_phone, l.customer_email,
        l.submission_channel === 'whatsapp' ? 'WhatsApp' : 'אתר', STATUS_LABEL[l.status], l.message,
        l.items.map((i) => `${i.name} × ${i.quantity}`).join('; '),
        l.estimated_total_agorot === null ? (l.metadata?.has_quote_items ? 'הצעת מחיר' : '') : (l.estimated_total_agorot / 100).toFixed(2),
      ]);
      const csv = '\uFEFF' + [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
      const a = document.createElement('a');
      a.href = url; a.download = 'פניות-לקוחות.csv'; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setError('ייצוא הפניות נכשל. נסו שוב.');
    } finally {
      setExporting(false);
    }
  }

  async function changeStatus(id: string, status: LeadStatus) {
    const prev = data;
    setData({ ...data, leads: data.leads.map((l) => (l.id === id ? { ...l, status } : l)) }); // optimistic
    try {
      await mcall(token, `leads/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
    } catch {
      setData(prev);
      setError('עדכון הסטטוס נכשל.');
    }
  }

  const th = 'px-3 py-2 text-start font-medium';

  return (
    <section aria-label="פניות">
      <div className="flex flex-wrap items-end gap-3">
        <label className="min-w-[220px] flex-1 text-sm">חיפוש לפי שם או טלפון
          <input value={searchInput} maxLength={100} onChange={(e) => setSearchInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); const next = searchInput.trim(); setSearch(next); setSelectedIds(new Set()); load(filter, 0, next); } }} placeholder="שם לקוח או מספר טלפון" className="mt-1 min-h-10 w-full rounded-lg border border-gray-300 bg-white px-3 py-2" />
        </label>
        <button type="button" disabled={loading} onClick={() => { const next = searchInput.trim(); setSearch(next); setSelectedIds(new Set()); load(filter, 0, next); }} className="min-h-10 rounded-full bg-gray-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">חיפוש</button>
        {(search || searchInput) && <button type="button" disabled={loading} onClick={() => { setSearchInput(''); setSearch(''); setSelectedIds(new Set()); load(filter, 0, ''); }} className="min-h-10 rounded-full border border-gray-300 px-3 py-2 text-sm">ניקוי</button>}
        <label className="text-sm">סינון לפי סטטוס:{' '}
          <select value={filter} disabled={loading}
            onChange={(e) => { const v = e.target.value as LeadStatus | ''; setFilter(v); setSelectedIds(new Set()); load(v, 0, search); }}
            className="rounded-lg border border-gray-300 bg-white px-2 py-1.5">
            <option value="">הכל</option>
            {LEAD_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
        </label>
        <span className="text-sm text-gray-500">{data.total} פניות</span>
        <button type="button" onClick={exportExcel} disabled={exporting || loading} className="min-h-9 rounded-full border border-gray-300 bg-white px-3 py-1.5 text-sm font-semibold text-gray-800 disabled:opacity-50">{exporting ? "מייצא…" : selectedIds.size ? `ייצוא ${selectedIds.size} נבחרות` : "ייצוא כל הפניות המסוננות"}</button>
        {data.leads.length > 0 && <label className="flex items-center gap-2 text-sm text-gray-600"><input type="checkbox" checked={data.leads.every((l) => selectedIds.has(l.id))} onChange={(e) => setSelectedIds((prev) => { const next = new Set(prev); data.leads.forEach((l) => { if (e.target.checked) next.add(l.id); else next.delete(l.id); }); return next; })} />בחירת כל הפניות בעמוד</label>}
        {loading && <span className="text-sm text-gray-500">טוען…</span>}
      </div>

      {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-2 text-sm text-red-800">{error}</p>}

      <ul className="mt-3 grid gap-3 md:hidden" aria-label="רשימת פניות">
        {data.leads.length === 0 && <li className="rounded-2xl border border-dashed border-gray-300 bg-white px-4 py-10 text-center text-sm text-gray-500">אין פניות להצגה כרגע.</li>}
        {data.leads.map((l) => (
          <li key={l.id} className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
            <label className="mb-2 inline-flex items-center gap-2 text-xs text-gray-500"><input type="checkbox" checked={selectedIds.has(l.id)} onChange={(e) => setSelectedIds((prev) => { const next = new Set(prev); if (e.target.checked) next.add(l.id); else next.delete(l.id); return next; })} />בחירת פנייה לייצוא</label>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="break-words font-bold text-gray-900">{l.customer_name || (l.submission_channel === 'whatsapp' ? 'המשך ב־WhatsApp' : 'פנייה חדשה')}</p>
                <p className="mt-1 text-xs text-gray-500" suppressHydrationWarning>{fmtDate(l.created_at)}</p>
              </div>
              <span className="shrink-0 rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700">{l.submission_channel === 'whatsapp' ? 'WhatsApp' : 'דרך האתר'}</span>
            </div>
            {l.customer_phone && <div className="mt-3 flex flex-wrap gap-2">
              <a dir="ltr" className="inline-flex min-h-10 items-center rounded-lg border border-gray-200 px-3 text-sm font-medium text-gray-800" href={`tel:${toLocalPhone(l.customer_phone)}`}>{toLocalPhone(l.customer_phone)}</a>
              <a className="inline-flex min-h-10 items-center rounded-lg bg-green-50 px-3 text-sm font-semibold text-green-800" href={waLink(l.customer_phone)} target="_blank" rel="noopener noreferrer">פתיחה בוואטסאפ</a>
            </div>}
            {l.customer_email && <p dir="ltr" className="mt-2 break-all text-start text-sm text-gray-600">{l.customer_email}</p>}
            {l.metadata?.appointment_at && <div className="mt-3 rounded-lg bg-blue-50 p-2 text-sm font-medium text-blue-900"><p>שעת תור מבוקשת: <span dir="ltr">{l.metadata.appointment_at.replace('T', ' ')}</span></p>{l.metadata.appointment_duration_minutes && <p className="mt-1">משך תור משוער: {l.metadata.appointment_duration_minutes} דקות</p>}</div>}
            {l.message && <p className="mt-3 whitespace-pre-line rounded-xl bg-gray-50 p-3 text-sm leading-6 text-gray-700">{l.message}</p>}
            <div className="mt-3 border-t border-gray-100 pt-3">
              <p className="text-xs font-semibold text-gray-500">פריטים בפנייה</p>
              {l.items.length ? <ul className="mt-1 space-y-1 text-sm text-gray-800">{l.items.map((i, k) => <li key={k}>{i.name} <span className="text-gray-500">× {i.quantity}</span></li>)}</ul> : <p className="mt-1 text-sm text-gray-500">לא נבחרו פריטים</p>}
              <div className="mt-3 flex items-center justify-between gap-3"><span className="text-sm text-gray-500">סכום משוער</span><span className="font-bold text-gray-900">{l.estimated_total_agorot === null ? (l.metadata?.has_quote_items ? 'הצעת מחיר' : '—') : ils(l.estimated_total_agorot) + (l.metadata?.has_quote_items ? ' + הצעת מחיר' : '')}</span></div>
            </div>
            <LeadNotes token={token} leadId={l.id} />
            <label className="mt-4 block text-sm font-semibold text-gray-700">סטטוס טיפול
              <select value={l.status} aria-label={`סטטוס עבור ${l.customer_name || 'פנייה ב־WhatsApp'}`} onChange={(e) => changeStatus(l.id, e.target.value as LeadStatus)} className="mt-1 min-h-11 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-base">
                {LEAD_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
              </select>
            </label>
          </li>
        ))}
      </ul>

      <div className="mt-3 hidden overflow-x-auto rounded-xl border border-gray-200 bg-white md:block">
        <table className="w-full min-w-[820px] text-sm">
          <thead className="bg-gray-100 text-gray-600">
            <tr>
              <th className={th}>בחר</th><th className={th}>תאריך</th><th className={th}>לקוח</th><th className={th}>פריטים</th>
              <th className={th}>סכום משוער</th><th className={th}>ערוץ</th><th className={th}>סטטוס</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {data.leads.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-8 text-center text-gray-500">אין פניות להצגה.</td></tr>
            )}
            {data.leads.map((l) => (
              <tr key={l.id} className="align-top">
                <td className="px-3 py-2"><input type="checkbox" aria-label="בחירת פנייה לייצוא" checked={selectedIds.has(l.id)} onChange={(e) => setSelectedIds((prev) => { const next = new Set(prev); if (e.target.checked) next.add(l.id); else next.delete(l.id); return next; })} /></td>
                <td className="whitespace-nowrap px-3 py-2" suppressHydrationWarning>{fmtDate(l.created_at)}</td>
                <td className="px-3 py-2">
                  <div className="font-medium">{l.customer_name || (l.submission_channel === 'whatsapp' ? 'המשך ב־WhatsApp' : 'פנייה חדשה')}</div>
                  {l.customer_phone && <div className="flex flex-wrap gap-x-3">
                    <a dir="ltr" className="text-blue-700 underline" href={`tel:${toLocalPhone(l.customer_phone)}`}>{toLocalPhone(l.customer_phone)}</a>
                    <a className="text-blue-700 underline" href={waLink(l.customer_phone)} target="_blank" rel="noopener noreferrer">וואטסאפ</a>
                  </div>}
                  {l.customer_email && <div dir="ltr" className="text-start text-gray-600">{l.customer_email}</div>}
                  {l.metadata?.appointment_at && <p className="mt-1 text-sm font-medium text-blue-800">תור מבוקש: <span dir="ltr">{l.metadata.appointment_at.replace('T', ' ')}</span></p>}
                  {l.message && <p className="mt-1 whitespace-pre-line text-gray-600">{l.message}</p>}
                  <LeadNotes token={token} leadId={l.id} />
                </td>
                <td className="px-3 py-2">
                  {l.items.length ? l.items.map((i, k) => <div key={k}>{i.name} × {i.quantity}</div>) : '—'}
                </td>
                <td className="whitespace-nowrap px-3 py-2">
                  {l.estimated_total_agorot === null
                    ? (l.metadata?.has_quote_items ? 'הצעת מחיר' : '—')
                    : ils(l.estimated_total_agorot) + (l.metadata?.has_quote_items ? ' + הצעת מחיר' : '')}
                </td>
                <td className="px-3 py-2">{l.submission_channel === 'whatsapp' ? 'וואטסאפ' : 'אתר'}</td>
                <td className="px-3 py-2">
                  <select value={l.status} aria-label={`סטטוס עבור ${l.customer_name || 'פנייה ב־WhatsApp'}`}
                    onChange={(e) => changeStatus(l.id, e.target.value as LeadStatus)}
                    className="rounded-lg border border-gray-300 bg-white px-2 py-1.5">
                    {LEAD_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex items-center justify-between">
        <button type="button" disabled={loading || data.offset === 0}
          onClick={() => load(filter, Math.max(0, data.offset - PAGE), search)}
          className="rounded-full bg-white px-4 py-2 text-sm ring-1 ring-gray-300 disabled:opacity-40">הקודם</button>
        <span className="text-sm text-gray-500">
          {data.total === 0 ? 0 : data.offset + 1}–{Math.min(data.offset + PAGE, data.total)} מתוך {data.total}
        </span>
        <button type="button" disabled={loading || data.offset + PAGE >= data.total}
          onClick={() => load(filter, data.offset + PAGE, search)}
          className="rounded-full bg-white px-4 py-2 text-sm ring-1 ring-gray-300 disabled:opacity-40">הבא</button>
      </div>
    </section>
  );
}