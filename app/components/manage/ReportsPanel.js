'use client';
import { useState } from 'react';
import { useRealtimeData } from '@/lib/useRealtimeData';
import { download, useUI, Spinner } from '@/app/components/ui';
import Icon from '@/app/components/Icon';
import { todayIST, fmtMonthLong } from '@/lib/time';

const FORMATS = [['pdf', 'PDF'], ['xlsx', 'Excel'], ['csv', 'CSV']];

export default function ReportsPanel() {
  const { toast } = useUI();
  const today = todayIST();
  const { data: cadets } = useRealtimeData('/api/cadets?all=1', 0);
  const [busy, setBusy] = useState('');
  const [day, setDay] = useState(today); const [month, setMonth] = useState(today.slice(0, 7));
  const [from, setFrom] = useState(today.slice(0, 8) + '01'); const [to, setTo] = useState(today);
  const [cadet, setCadet] = useState(''); const [cq, setCq] = useState(''); const [allCycles, setAllCycles] = useState(false);
  const [year, setYear] = useState(1);
  const [cYear, setCYear] = useState('all');
  const [aFrom, setAFrom] = useState(''); const [aTo, setATo] = useState('');
  const people = (cadets?.cadets || []).filter(c => c.role === 'cadet' && (!cq.trim() || `${c.name} ${c.regNo || ''}`.toLowerCase().includes(cq.trim().toLowerCase()))).slice(0, 60);

  async function get(key, query, fmt) {
    setBusy(key + fmt);
    const r = await download(`/api/reports?${query}&format=${fmt}`);
    setBusy('');
    if (!r.ok) toast(r.error, 'err'); else toast(`Downloaded ${r.name}`, 'ok', 2500);
  }
  const Buttons = ({ k, query, disabled, formats = FORMATS }) => (
    <div className="row wrap gap-s mt-s">{formats.map(([f, l]) => (
      <button key={f} className={`btn btn-sm${f === 'pdf' ? ' btn-primary' : ''}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }} disabled={disabled || !!busy} onClick={() => get(k, query, f)}>{busy === k + f ? <Spinner /> : <><Icon name="download" size={14} /> Download {l}</>}</button>))}</div>
  );

  return (
    <div className="stack">
      <p className="muted small">Every report is built live from the database — the same numbers as the Google Sheet. PDFs carry the NCC AIRWING FLIGHT-B / 6 KAR AIR SQN NCC header.</p>
      <div className="grid g2">
        <div className="card"><div className="eyebrow">Day report (parade report)</div><div className="field mt-s"><label>Date</label><input type="date" className="input" value={day} max={today} onChange={e => setDay(e.target.value)} /></div><Buttons k="day" query={`type=day&date=${day}`} disabled={!day} /></div>
        <div className="card"><div className="eyebrow">Monthly report</div><div className="field mt-s"><label>Month</label><input type="month" className="input" value={month} max={today.slice(0, 7)} onChange={e => setMonth(e.target.value)} /></div><Buttons k="month" query={`type=month&month=${month}`} disabled={!month} />{month && <p className="hint mt-s">{fmtMonthLong(month)}</p>}</div>
        <div className="card"><div className="eyebrow">Date range</div><div className="grid g2 mt-s"><div className="field"><label>From</label><input type="date" className="input" value={from} max={today} onChange={e => setFrom(e.target.value)} /></div><div className="field"><label>To</label><input type="date" className="input" value={to} max={today} onChange={e => setTo(e.target.value)} /></div></div><Buttons k="range" query={`type=range&from=${from}&to=${to}`} disabled={!from || !to} /></div>
        <div className="card"><div className="eyebrow">Individual cadet report</div><input className="input mt-s" placeholder="Search cadet…" value={cq} onChange={e => setCq(e.target.value)} />
          <select className="input mt-s tbl-dense" value={cadet} onChange={e => setCadet(e.target.value)} size={4} style={{ backgroundImage: 'none', paddingRight: 14 }}>{people.map(c => <option key={c.id} value={c.id}>{c.name} — {c.regNo || 'No Reg No.'}{c.role === 'cadet' ? ` · Y${c.year}` : ''}</option>)}</select>
          <label className="row small muted mt-s" style={{ cursor: 'pointer' }}><input type="checkbox" checked={allCycles} onChange={e => setAllCycles(e.target.checked)} /> Include earlier years (all cycles)</label>
          <Buttons k="cadet" query={`type=cadet&cadetId=${cadet}${allCycles ? '&cycle=all' : ''}`} disabled={!cadet} formats={[['pdf', 'PDF'], ['xlsx', 'Excel']]} /></div>
        <div className="card"><div className="eyebrow">Year-wise summary</div><div className="seg mt-s">{[1, 2, 3].map(y => <button key={y} className={year === y ? 'on' : ''} onClick={() => setYear(y)}>Year {y}</button>)}</div><Buttons k="year" query={`type=year&year=${year}`} /></div>
        <div className="card"><div className="eyebrow">Whole unit summary</div><p className="muted small mt-s">Every cadet with parades, present, absent, benefit credits and percentage.</p><Buttons k="summary" query="type=summary" /></div>
        <div className="card"><div className="eyebrow">Absentees report</div><div className="grid g2 mt-s"><div className="field"><label>From (optional)</label><input type="date" className="input" value={aFrom} onChange={e => setAFrom(e.target.value)} /></div><div className="field"><label>To (optional)</label><input type="date" className="input" value={aTo} onChange={e => setATo(e.target.value)} /></div></div><Buttons k="abs" query={`type=absentees${aFrom ? `&from=${aFrom}` : ''}${aTo ? `&to=${aTo}` : ''}`} /></div>
        <div className="card"><div className="eyebrow">Attendance benefits</div><p className="muted small mt-s">All benefit credits given this cycle.</p><Buttons k="ben" query="type=benefits" formats={[['pdf', 'PDF'], ['xlsx', 'Excel']]} /></div>
        <div className="card">
          <div className="eyebrow">Contact details check</div>
          <p className="muted small mt-s">Review cadet emails, phone numbers and flags. PDF adds columns for physical paper verification.</p>
          <div className="seg mt-s">
            {[['all', 'All'], ['1', 'Year 1'], ['2', 'Year 2'], ['3', 'Year 3']].map(([y, l]) => (
              <button key={y} className={cYear === y ? 'on' : ''} onClick={() => setCYear(y)}>{l}</button>
            ))}
          </div>
          <Buttons k="contacts" query={`type=contacts&year=${cYear}`} formats={[['pdf', 'PDF'], ['xlsx', 'Excel']]} />
        </div>
      </div>
    </div>
  );
}
