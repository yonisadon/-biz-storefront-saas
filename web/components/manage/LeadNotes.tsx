'use client';

import { useState } from 'react';
import { usePlatformLanguage } from '@/components/PlatformLanguageProvider';
import { fmtDate } from '@/lib/format';
import { mcall } from '@/lib/manageApi';

type Note = { id: string; body: string; created_at: string; updated_at: string };

export default function LeadNotes({ token, leadId }: { token: string; leadId: string }) {
  const { t } = usePlatformLanguage();
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [notes, setNotes] = useState<Note[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && !loaded) {
      setBusy(true); setError(null);
      try {
        setNotes(await mcall<Note[]>(token, `leads/${leadId}/notes`));
        setLoaded(true);
      } catch { setError(t('notesLoadFailed')); }
      finally { setBusy(false); }
    }
  }

  async function addNote() {
    if (!draft.trim()) return;
    setBusy(true); setError(null);
    try {
      const note = await mcall<Note>(token, `leads/${leadId}/notes`, {
        method: 'POST', body: JSON.stringify({ body: draft.trim() }),
      });
      setNotes((prev) => [note, ...prev]);
      setDraft('');
      setLoaded(true);
    } catch { setError(t('noteSaveFailed')); }
    finally { setBusy(false); }
  }

  return (
    <div className="mt-3 border-t border-gray-100 pt-3">
      <button type="button" onClick={toggle} aria-expanded={open} className="text-sm font-semibold text-primary underline-offset-4 hover:underline">
        {open ? t('hideInternalNotes') : t('internalNotes')}
      </button>
      {open && <div className="mt-2 space-y-2 rounded-xl bg-gray-50 p-3">
        {busy && <p className="text-xs text-gray-500">{t('loading')}</p>}
        {notes.map((note) => <div key={note.id} className="rounded-lg border border-gray-200 bg-white p-2">
          <p className="whitespace-pre-line break-words text-sm text-gray-800">{note.body}</p>
          <p className="mt-1 text-xs text-gray-500" suppressHydrationWarning>{fmtDate(note.created_at)}</p>
        </div>)}
        {loaded && notes.length === 0 && <p className="text-xs text-gray-500">{t('noInternalNotes')}</p>}
        <label className="block text-xs font-semibold text-gray-600" >{t('addInternalNote')}
          <textarea value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={2000} rows={2} placeholder={t('notePlaceholder')} className="mt-1 w-full rounded-lg border border-gray-300 bg-white p-2 text-sm font-normal" />
        </label>
        <button type="button" onClick={addNote} disabled={busy || !draft.trim()} className="min-h-9 rounded-full bg-gray-900 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50">{t('saveNote')}</button>
        {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
      </div>}
    </div>
  );
}
