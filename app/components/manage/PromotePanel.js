'use client';
import { useState } from 'react';
import { api, useUI, Spinner, Stat } from '@/app/components/ui';
import Icon from '@/app/components/Icon';

export default function PromotePanel() {
  const { toast } = useUI();
  const [pre, setPre] = useState(null); const [busy, setBusy] = useState(false); const [typed, setTyped] = useState(''); const [done, setDone] = useState(null);
  async function preview() { setBusy(true); const r = await api('/api/cadets/promote', { method: 'POST', body: { dryRun: true } }); setBusy(false); if (!r.ok) return toast(r.error, 'err'); setPre(r.data); setTyped(''); }
  async function run() {
    setBusy(true); const r = await api('/api/cadets/promote', { method: 'POST', body: { expectedCycle: pre.currentCycle } }); setBusy(false);
    if (!r.ok) return toast(r.error, 'err'); setDone(r.data); setPre(null); toast('Promotion complete.', 'ok');
  }
  if (done) return (
    <div className="card center" style={{ padding: 30 }}><div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 64, height: 64, borderRadius: '50%', background: 'rgba(10,102,214,.1)', color: 'var(--accent)', margin: '0 auto' }}><Icon name="graduation-cap" size={32} /></div><h2 className="h2 mt-s">Promotion complete</h2>
      <p className="muted mt-s">New cycle <b>{done.newLabel}</b> has started. Everyone's attendance is back to 0, the old Google Sheet tabs were archived and fresh ones created. Sir has been emailed.</p>
      <div className="grid g3 mt"><Stat value={done.promoted_to_year2} label="to Year 2" /><Stat value={done.promoted_to_year3} label="to Year 3" /><Stat value={done.graduated} label="Graduated" color="var(--green)" /></div></div>);
  return (
    <div className="stack">
      <div className="card"><h2 className="h2">Year promotion</h2>
        <div className="col mt" style={{ gap: 8 }}>
          <div className="item"><span className="badge b-blue">1</span><div>Year 1 to Year 2, Year 2 to Year 3</div></div>
          <div className="item"><span className="badge b-blue">2</span><div>Year 3 cadets graduate and become inactive (their history is kept)</div></div>
          <div className="item"><span className="badge b-blue">3</span><div>Everyone's attendance restarts from <b>0</b> in a new cycle</div></div>
          <div className="item"><span className="badge b-blue">4</span><div>The old Attendance Log, Daily, Absentees and Benefits tabs are <b>renamed (archived)</b> and brand-new ones are created</div></div>
          <div className="item"><span className="badge b-blue">5</span><div>Nothing is deleted — old attendance stays available in reports (“all cycles”)</div></div>
        </div>
        <div className="banner warn mt"><span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon name="alert-triangle" size={16} /> Promote only once, at the start of the new academic year. Import the latest roster from the sheet first (Google Sheet tab).</span></div>
        <button className="btn btn-primary mt" onClick={preview} disabled={busy}>{busy && !pre ? <Spinner /> : 'Preview promotion'}</button></div>
      {pre && (
        <div className="card"><h2 className="h2">Preview — cycle {pre.cycleLabel}</h2>
          <div className="grid g3 mt"><Stat value={pre.promoted_to_year2} label="Year 1 to 2" /><Stat value={pre.promoted_to_year3} label="Year 2 to 3" /><Stat value={pre.graduated} label="Graduate" color="var(--amber)" /></div>
          <div className="field mt"><label>Type PROMOTE to confirm</label><input className="input" value={typed} onChange={e => setTyped(e.target.value)} autoCapitalize="characters" placeholder="PROMOTE" /></div>
          <button className="btn btn-danger mt" disabled={typed.trim().toUpperCase() !== 'PROMOTE' || busy} onClick={run}>{busy ? <Spinner /> : 'Promote everyone now'}</button></div>)}
    </div>
  );
}
