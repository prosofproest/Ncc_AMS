'use client';
import { useState } from 'react';
import { useRealtimeData } from '@/lib/useRealtimeData';
import { api, useUI, Spinner } from '@/app/components/ui';
import Icon from '@/app/components/Icon';
import { useUser, hasPerm } from '@/app/components/user';

export default function SheetsPanel() {
  const me = useUser(); const { toast, confirm } = useUI();
  const { data: s, refresh } = useRealtimeData('/api/settings', 0);
  const [busy, setBusy] = useState(''); const [out, setOut] = useState({});
  const canUsers = hasPerm(me, 'canManageUsers');

  async function run(action, label) {
    setBusy(action);
    const r = await api('/api/sync', { method: 'POST', body: { action } });
    setBusy('');
    const d = r.data || {};
    if (!r.ok || d.success === false) { setOut(o => ({ ...o, [action]: { ok: false, text: r.error || d.error } })); return toast(`${label} failed: ${r.error || d.error}`, 'err', 8000); }
    const text = action === 'import' ? `Added ${d.created}, updated ${d.updated}, unchanged ${d.unchanged}, deactivated ${d.deactivated}.${d.warnings?.length ? '\nWarning: ' + d.warnings.join('\nWarning: ') : ''}` : d.message || 'Done.';
    setOut(o => ({ ...o, [action]: { ok: true, text } })); toast(`${label}: done`, 'ok'); refresh();
  }
  async function push() { if (await confirm({ title: 'Rewrite the roster tabs?', message: 'Year 1/2/3 tabs are rewritten from the app (sorted, with the latest %). Anything typed in the sheet that is not yet imported will be lost — press "Import from sheet" first.', confirmText: 'Rewrite roster', danger: true })) run('push-roster', 'Roster rewrite'); }

  const Card = ({ icon, title, desc, action, label, onClick, hide, tone }) => hide ? null : (
    <div className="card col" style={{ gap: 10 }}><div className="row" style={{ gap: 12 }}><div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 40, height: 40, borderRadius: '50%', background: 'rgba(16,24,40,.06)', color: 'var(--text-dim)', flexShrink: 0 }}><Icon name={icon} size={20} /></div><div className="grow"><h3 className="h2">{title}</h3><p className="muted small">{desc}</p></div></div>
      <button className={`btn ${tone || 'btn-primary'}`} disabled={!!busy} onClick={onClick || (() => run(action, label))}>{busy === action ? <><Spinner /> Working…</> : label}</button>
      {out[action] && <div className={`banner ${out[action].ok ? 'good' : 'bad'}`} style={{ whiteSpace: 'pre-line', alignItems: 'flex-start' }}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon name={out[action].ok ? 'check-circle' : 'alert-triangle'} size={16} /> {out[action].text}</span></div>}</div>);

  return (
    <div className="stack">
      <div className="card"><h2 className="h2">How the Google Sheet works</h2>
        <div className="col mt" style={{ gap: 8 }}>
          <div className="item"><span className="badge b-blue">You type</span><div className="small">In <b>Year 1 · Year 2 · Year 3</b> tabs: <b>Name, Reg No., Type (SD/SW), Email, Phone</b>. The app creates the headers.</div></div>
          <div className="item"><span className="badge b-green">App writes</span><div className="small"><b>Attendance %</b> and <b>Status</b> columns, plus the tabs <b>Attendance Log · Daily Report · Absentees · Monthly Report · Cadet Summary · Benefits · Change Log</b> — updated within seconds of every submit.</div></div>
          <div className="item"><span className="badge b-amber">Automatic</span><div className="small">Roster changes in the sheet are picked up automatically (every few minutes, and every night at 11 PM). Cadets removed from the sheet are deactivated — never deleted.</div></div>
        </div>
        {s?.settings?.lastSheetImportAt && <p className="hint mt">Last roster import: {new Date(s.settings.lastSheetImportAt).toLocaleString('en-IN')}</p>}
      </div>
      <div className="grid g2">
        <Card icon="table" title="Setup sheet" desc="Creates every missing tab and header row. Safe to run any time — it never touches your typed data." action="setup" label="Set up / repair tabs" />
        <Card icon="download" title="Import from sheet" desc="Reads the roster now (instead of waiting for the automatic import)." action="import" label="Import cadets now" hide={!canUsers} />
        <Card icon="refresh" title="Rebuild reports" desc="Rewrites Attendance Log, Daily, Absentees, Monthly, Summary and Benefits from the database. Use it if the sheet was edited by mistake." action="rebuild" label="Rebuild all reports" tone="" />
        <Card icon="upload" title="Rewrite roster tabs" desc="Writes the roster back to Year 1–3, sorted, in the standard layout. Also converts an older layout." action="push-roster" label="Rewrite roster tabs" onClick={push} hide={!canUsers} tone="btn-danger" />
      </div>
    </div>
  );
}
