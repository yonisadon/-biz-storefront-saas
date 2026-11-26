'use client';

import { useState } from 'react';
import { fmtDate, ils, toLocalPhone, waLink } from '@/lib/format';
import { LEAD_STATUSES, STATUS_LABEL } from '@/lib/labels';
import { mcallWithTimeout } from '@/lib/manageApi';
import type { Lead, LeadStatus, LeadsResponse } from '@/lib/types';
import { usePlatformLanguage } from '@/components/PlatformLanguageProvider';
import LeadNotes from './LeadNotes';

const PAGE = 25;

export default function LeadsPanel({ token, initial }: { token: string; initial: LeadsResponse }) {
  const { t, language } = usePlatformLanguage();
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
      setData(await mcallWithTimeout<LeadsResponse>(token, `leads?${qs}`));
    } catch {
      setError(t('leadLoadFailed'));
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
        const page = await mcallWithTimeout<LeadsResponse>(token, `leads?${qs}`);
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
      const headers = [t('leadDate'), t('customerName'), t('phoneLabel'), t('emailAddress'), t('channel'), t('status'), t('customerMessage'), t('items'), t('estimatedAmount'), t('appointmentTime'), t('appointmentDuration'), t('sellerNotes')];
      const rows = exportRows.map((l) => [
        fmtDate(l.created_at), l.customer_name, l.customer_phone, l.customer_email,
        l.submission_channel === 'whatsapp' ? 'WhatsApp' : 'אתר', ({ pending_approval: t('statusPendingApproval'), whatsapp_initiated: t('statusWhatsappOpened'), approved: t('statusApproved'), completed: t('statusCompleted'), rejected: t('statusRejected'), cancelled: t('statusCanceled') } as Record<LeadStatus, string>)[l.status], l.message,
        l.items.map((i) => `${i.name} × ${i.quantity}`).join('; '),
        l.estimated_total_agorot === null ? (l.metadata?.has_quote_items ? t('quote') : '') : (l.estimated_total_agorot / 100).toFixed(2),
        l.metadata?.action === 'waitlist' && l.metadata.preferred_date ? `${l.metadata.preferred_date}${l.metadata.preferred_time ? ` ${l.metadata.preferred_time}` : ''}` : l.metadata?.appointment_at ? l.metadata.appointment_at.replace('T', ' ') : '',
        l.metadata?.appointment_duration_minutes ?? '',
        (l.notes ?? []).map((note) => `[${fmtDate(note.created_at)}] ${note.body}`).join(' | '),
      ]);
      const csv = '\uFEFF' + [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
      const a = document.createElement('a');
      a.href = url; a.download = language === 'he' ? 'פניות-לקוחות.csv' : language === 'ru' ? 'obrashcheniya-klientov.csv' : 'customer-inquiries.csv'; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setError(t('exportFailed'));
    } finally {
      setExporting(false);
    }
  }

  async function changeStatus(id: string, status: LeadStatus) {
    const prev = data;
    setData({ ...data, leads: data.leads.map((l) => (l.id === id ? { ...l, status } : l)) }); // optimistic
    try {
      await mcallWithTimeout(token, `leads/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
    } catch {
      setData(prev);
      setError(t('leadStatusUpdateFailed'));
    }
  }

  async function deleteLead(id: string) {
    if (!window.confirm(t('deleteLeadConfirm'))) return;
    setError(null);
    try {
      await mcallWithTimeout(token, `leads/${id}`, { method: 'DELETE' });
      setSelectedIds((prev) => { const next = new Set(prev); next.delete(id); return next; });
      const remaining = data.leads.filter((lead) => lead.id !== id);
      if (remaining.length === 0 && data.offset > 0) {
        await load(filter, Math.max(0, data.offset - PAGE), search);
      } else {
        setData((prev) => ({ ...prev, total: Math.max(0, prev.total - 1), leads: prev.leads.filter((lead) => lead.id !== id) }));
      }
    } catch {
      setError(t('leadDeleteFailed'));
    }
  }

  const th = 'px-3 py-2 text-start font-medium';

  return (
    <section aria-label={t('tabLeads')}>
      <div className="flex flex-wrap items-end gap-3">
        <label className="min-w-[220px] flex-1 text-sm">{t('searchNamePhone')}
          <input value={searchInput} maxLength={100} onChange={(e) => setSearchInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); const next = searchInput.trim(); setSearch(next); setSelectedIds(new Set()); load(filter, 0, next); } }} placeholder={t('customerOrPhone')} className="mt-1 min-h-10 w-full rounded-lg border border-gray-300 bg-white px-3 py-2" />
        </label>
        <button type="button" disabled={loading} onClick={() => { const next = searchInput.trim(); setSearch(next); setSelectedIds(new Set()); load(filter, 0, next); }} className="min-h-10 rounded-full bg-gray-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{t('search')}</button>
        {(search || searchInput) && <button type="button" disabled={loading} onClick={() => { setSearchInput(''); setSearch(''); setSelectedIds(new Set()); load(filter, 0, ''); }} className="min-h-10 rounded-full border border-gray-300 px-3 py-2 text-sm">{t('clear')}</button>}
        <label className="text-sm">{t('filterByStatus')}: {' '}
          <select value={filter} disabled={loading}
            onChange={(e) => { const v = e.target.value as LeadStatus | ''; setFilter(v); setSelectedIds(new Set()); load(v, 0, search); }}
            className="rounded-lg border border-gray-300 bg-white px-2 py-1.5">
            <option value="">{t('all')}</option>
            {LEAD_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
        </label>
        <span className="text-sm text-gray-500">{data.total} {t('inquiriesCount')}</span>
        <button type="button" onClick={exportExcel} disabled={exporting || loading} className="min-h-9 rounded-full border border-gray-300 bg-white px-3 py-1.5 text-sm font-semibold text-gray-800 disabled:opacity-50">{exporting ? t('exporting') : selectedIds.size ? `${t('exportSelected')} (${selectedIds.size})` : t('exportFiltered')}</button>
        {data.leads.length > 0 && <label className="flex items-center gap-2 text-sm text-gray-600"><input type="checkbox" checked={data.leads.every((l) => selectedIds.has(l.id))} onChange={(e) => setSelectedIds((prev) => { const next = new Set(prev); data.leads.forEach((l) => { if (e.target.checked) next.add(l.id); else next.delete(l.id); }); return next; })} />{t('selectAllOnPage')}</label>}
        {loading && <span className="text-sm text-gray-500">{t('loading')}</span>}
      </div>

      {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-2 text-sm text-red-800">{error}</p>}

      <ul className="mt-3 grid gap-3 md:hidden" aria-label={t('leadsList')}>
        {data.leads.length === 0 && <li className="rounded-2xl border border-dashed border-gray-300 bg-white px-4 py-10 text-center text-sm text-gray-500">{t('noLeads')}</li>}
        {data.leads.map((l) => (
          <li key={l.id} className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
            <label className="mb-2 inline-flex items-center gap-2 text-xs text-gray-500"><input type="checkbox" checked={selectedIds.has(l.id)} onChange={(e) => setSelectedIds((prev) => { const next = new Set(prev); if (e.target.checked) next.add(l.id); else next.delete(l.id); return next; })} />{t('selectLeadExport')}</label>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="break-words font-bold text-gray-900">{l.customer_name || (l.submission_channel === 'whatsapp' ? t('continueOnWhatsapp') : t('newInquiry'))}</p>
                <p className="mt-1 text-xs text-gray-500" suppressHydrationWarning>{fmtDate(l.created_at)}</p>
              </div>
              <span className="shrink-0 rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700">{l.submission_channel === 'whatsapp' ? 'WhatsApp' : t('viaWebsite')}</span>
            </div>
            {l.customer_phone && <div className="mt-3 flex flex-wrap gap-2">
              <a dir="ltr" className="inline-flex min-h-10 items-center rounded-lg border border-gray-200 px-3 text-sm font-medium text-gray-800" href={`tel:${toLocalPhone(l.customer_phone)}`}>{toLocalPhone(l.customer_phone)}</a>
              <a className="inline-flex min-h-10 items-center rounded-lg bg-green-50 px-3 text-sm font-semibold text-green-800" href={waLink(l.customer_phone)} target="_blank" rel="noopener noreferrer">{t('openWhatsapp')}</a>
            </div>}
            {l.customer_email && <p dir="ltr" className="mt-2 break-all text-start text-sm text-gray-600">{l.customer_email}</p>}
            {(l.metadata?.appointment_at || (l.metadata?.action === 'waitlist' && l.metadata.preferred_date)) && <div className="mt-3 rounded-lg bg-blue-50 p-2 text-sm font-medium text-blue-900">
              {l.metadata.action === 'waitlist' && l.metadata.preferred_date
                ? <p>{t('preferredWaitlistDate')}: <span dir="ltr">{l.metadata.preferred_date}{l.metadata.preferred_time ? ` ${l.metadata.preferred_time}` : ''}</span></p>
                : <p>{t('appointmentBooked')}: <span dir="ltr">{l.metadata.appointment_at?.replace('T', ' ')}</span></p>}
              {l.metadata.appointment_duration_minutes && <p className="mt-1">{t('appointmentDurationLabel')}: {l.metadata.appointment_duration_minutes} {t('minutes')}</p>}
            </div>}
            {l.message && <p className="mt-3 whitespace-pre-line rounded-xl bg-gray-50 p-3 text-sm leading-6 text-gray-700">{l.message}</p>}
            <div className="mt-3 border-t border-gray-100 pt-3">
              <p className="text-xs font-semibold text-gray-500">{t('inquiryItems')}</p>
              {l.items.length ? <ul className="mt-1 space-y-1 text-sm text-gray-800">{l.items.map((i, k) => <li key={k}>{i.name} <span className="text-gray-500">× {i.quantity}</span></li>)}</ul> : <p className="mt-1 text-sm text-gray-500">{t('noItemsSelected')}</p>}
              <div className="mt-3 flex items-center justify-between gap-3"><span className="text-sm text-gray-500">{t('estimatedTotal')}</span><span className="font-bold text-gray-900">{l.estimated_total_agorot === null ? (l.metadata?.has_quote_items ? t('quote') : '—') : ils(l.estimated_total_agorot) + (l.metadata?.has_quote_items ? ' + '+t('quote') : '')}</span></div>
            </div>
            <LeadNotes token={token} leadId={l.id} />
            <button type="button" onClick={() => deleteLead(l.id)} className="mt-3 min-h-10 rounded-lg border border-red-300 px-3 py-2 text-sm font-semibold text-red-700">{t('deleteLead')}</button>
            <label className="mt-4 block text-sm font-semibold text-gray-700">{t('treatmentStatus')}
              <select value={l.status} aria-label={`${t('leadStatusFor')} ${l.customer_name || t('continueOnWhatsapp')}`} onChange={(e) => changeStatus(l.id, e.target.value as LeadStatus)} className="mt-1 min-h-11 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-base">
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
              <th className={th}>{t('choose')}</th><th className={th}>{t('leadDate')}</th><th className={th}>{t('customerName')}</th><th className={th}>{t('items')}</th>
              <th className={th}>{t('estimatedTotal')}</th><th className={th}>{t('channel')}</th><th className={th}>{t('status')}</th><th className={th}>{t('actions')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {data.leads.length === 0 && (
              <tr><td colSpan={8} className="px-3 py-8 text-center text-gray-500">{t('noLeads')}</td></tr>
            )}
            {data.leads.map((l) => (
              <tr key={l.id} className="align-top">
                <td className="px-3 py-2"><input type="checkbox" aria-label={t('selectLeadExport')} checked={selectedIds.has(l.id)} onChange={(e) => setSelectedIds((prev) => { const next = new Set(prev); if (e.target.checked) next.add(l.id); else next.delete(l.id); return next; })} /></td>
                <td className="whitespace-nowrap px-3 py-2" suppressHydrationWarning>{fmtDate(l.created_at)}</td>
                <td className="px-3 py-2">
                  <div className="font-medium">{l.customer_name || (l.submission_channel === 'whatsapp' ? t('continueOnWhatsapp') : t('newInquiry'))}</div>
                  {l.customer_phone && <div className="flex flex-wrap gap-x-3">
                    <a dir="ltr" className="text-blue-700 underline" href={`tel:${toLocalPhone(l.customer_phone)}`}>{toLocalPhone(l.customer_phone)}</a>
                    <a className="text-blue-700 underline" href={waLink(l.customer_phone)} target="_blank" rel="noopener noreferrer">{t('whatsapp')}</a>
                  </div>}
                  {l.customer_email && <div dir="ltr" className="text-start text-gray-600">{l.customer_email}</div>}
                  {l.metadata?.appointment_at && <p className="mt-1 text-sm font-medium text-blue-800">{t('appointmentBooked')}: <span dir="ltr">{l.metadata.appointment_at.replace('T', ' ')}</span></p>}
                  {l.metadata?.action === 'waitlist' && l.metadata.preferred_date && <p className="mt-1 text-sm font-medium text-blue-800" >{t('preferredWaitlistDate')}: <span dir="ltr">{l.metadata.preferred_date}{l.metadata.preferred_time ? ` ${l.metadata.preferred_time}` : ''}</span></p>}
                  {l.message && <p className="mt-1 whitespace-pre-line text-gray-600">{l.message}</p>}
                  <LeadNotes token={token} leadId={l.id} />
                </td>
                <td className="px-3 py-2">
                  {l.items.length ? l.items.map((i, k) => <div key={k}>{i.name} × {i.quantity}</div>) : '—'}
                </td>
                <td className="whitespace-nowrap px-3 py-2">
                  {l.estimated_total_agorot === null
                    ? (l.metadata?.has_quote_items ? t('quote') : '—')
                    : ils(l.estimated_total_agorot) + (l.metadata?.has_quote_items ? ' + הצעת מחיר' : '')}
                </td>
                <td className="px-3 py-2">{l.submission_channel === 'whatsapp' ? t('whatsapp') : t('website')}</td>
                <td className="px-3 py-2">
                  <select value={l.status} aria-label={`${t('leadStatusFor')} ${l.customer_name || t('continueOnWhatsapp')}`}
                    onChange={(e) => changeStatus(l.id, e.target.value as LeadStatus)}
                    className="rounded-lg border border-gray-300 bg-white px-2 py-1.5">
                    {LEAD_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                  </select>
                </td>
                <td className="px-3 py-2"><button type="button" onClick={() => deleteLead(l.id)} className="rounded-lg border border-red-300 px-3 py-1.5 text-sm font-semibold text-red-700">{t('delete')}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex items-center justify-between">
        <button type="button" disabled={loading || data.offset === 0}
          onClick={() => load(filter, Math.max(0, data.offset - PAGE), search)}
          className="rounded-full bg-white px-4 py-2 text-sm ring-1 ring-gray-300 disabled:opacity-40">{t('previousPage')}</button>
        <span className="text-sm text-gray-500">
          {data.total === 0 ? 0 : data.offset + 1}–{Math.min(data.offset + PAGE, data.total)} {t('of')} {data.total}
        </span>
        <button type="button" disabled={loading || data.offset + PAGE >= data.total}
          onClick={() => load(filter, data.offset + PAGE, search)}
          className="rounded-full bg-white px-4 py-2 text-sm ring-1 ring-gray-300 disabled:opacity-40">{t('nextPage')}</button>
      </div>
    </section>
  );
}