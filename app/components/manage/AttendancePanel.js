'use client';
import { useState, useMemo } from 'react';
import { useRealtimeData } from '@/lib/useRealtimeData';
import { api, download, useUI, Modal, Skeleton, Empty, Spinner, PctBadge } from '@/app/components/ui';
import Icon from '@/app/components/Icon';
import { useUser, hasPerm } from '@/app/components/user';
import { fmtDate } from '@/lib/time';

const OTHER = '__other__';

export default function AttendancePanel() {
  const user = useUser(); const { toast, confirm } = useUI();
  const canEdit = hasPerm(user, 'canEditAttendance'), canDelete = hasPerm(user, 'canDeleteAttendance');
  const { data: meta } = useRealtimeData('/api/meta', 0);
  const [cycle, setCycle] = useState('current');
  const { data, loading, refresh } = useRealtimeData(`/api/attendance?history=1${cycle === 'all' ? '&cycle=all' : ''}`, 30000);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(null); const [detail, setDetail] = useState(null);
  const [edits, setEdits] = useState({}); const [note, setNote] = useState(''); const [saving, setSaving] = useState(false);
  const reasons = meta?.reasons || [];
  const sessions = useMemo(() => (data?.sessions || []).filter(s => !q.trim() || `${s.date} ${s.activityType} ${s.groupLabel} ${s.markedByName}`.toLowerCase().includes(q.trim().toLowerCase())), [data, q]);
  const isCurrent = open && (open.cycle || 1) === data?.cycle;

  async function view(s) { setOpen(s); setDetail(null); setEdits({}); setNote(''); const r = await api(`/api/attendance?sessionId=${s.id}`); if (r.ok) setDetail(r.data); else toast(r.error, 'err'); }
  const cur = r => edits[r.cadetId] || { status: r.status, reason: reasons.includes(r.reason) || !r.reason ? r.reason : OTHER, other: reasons.includes(r.reason) ? '' : r.reason };
  const reasonOf = e => (e.reason === OTHER ? (e.other || '').trim() : e.reason);
  const dirty = detail ? detail.records.filter(r => { const e = cur(r); return e.status !== r.status || (e.status === 'Absent' && reasonOf(e) !== (r.reason || '')); }) : [];

  async function save() {
    for (const r of dirty) if (cur(r).status === 'Absent' && !reasonOf(cur(r))) return toast(`Select a reason for ${r.cadetName}.`, 'err');
    const ok = await confirm({ title: 'Save changes?', message: `${dirty.length} change(s) will be saved, logged, and emailed to Sir and the backup email together with a corrected parade report.`, confirmText: 'Save changes' });
    if (!ok) return;
    setSaving(true);
    const r = await api('/api/attendance', { method: 'PUT', body: { sessionId: open.id, note, changes: dirty.map(x => ({ cadet_id: x.cadetId, status: cur(x).status, reason: cur(x).status === 'Absent' ? reasonOf(cur(x)) : '' })) } });
    setSaving(false);
    if (!r.ok) return toast(r.error, 'err');
    toast(`Saved ${r.data.changed} change(s). Sir has been emailed.`, 'ok'); setOpen(null); refresh();
  }
  async function del() {
    const ok = await confirm({ title: 'Delete this whole session?', message: `${fmtDate(open.date)} · ${open.activityType} · ${open.groupLabel}\nAll ${open.total} records are removed and every cadet's attendance count is reduced. This is logged and emailed to Sir.`, confirmText: 'Delete session', danger: true });
    if (!ok) return;
    const r = await api(`/api/attendance?sessionId=${open.id}`, { method: 'DELETE' });
    if (!r.ok) return toast(r.error, 'err');
    toast('Session deleted.', 'ok'); setOpen(null); refresh();
  }
  async function pdf() { const r = await download(`/api/reports?type=day&date=${open.date}&format=pdf`); if (!r.ok) toast(r.error, 'err'); }

  return (
    <div className="stack">
      <div className="row wrap"><input className="input grow" style={{ minWidth: 200 }} placeholder="Search by date, activity, group, marker…" value={q} onChange={e => setQ(e.target.value)} />
        <div className="seg"><button className={cycle === 'current' ? 'on' : ''} onClick={() => setCycle('current')}>This cycle</button><button className={cycle === 'all' ? 'on' : ''} onClick={() => setCycle('all')}>All cycles</button></div></div>
      {loading && !data ? <Skeleton n={5} h={78} /> : !sessions.length ? <div className="card"><Empty icon="calendar">No sessions found.</Empty></div> : (
        <div className="grid g2">{sessions.map(s => (
          <button key={s.id} className="item" style={{ textAlign: 'left', cursor: 'pointer', border: '1px solid var(--edge)', margin: 0 }} onClick={() => view(s)}>
            <div className="grow"><div className="name">{fmtDate(s.date)} · {s.activityType}{s.activityDescription ? ` — ${s.activityDescription}` : ''}</div>
              <div className="sub">{s.groupLabel} · by {s.markedByName}{s.lastEditedByName ? ` · edited by ${s.lastEditedByName}` : ''}</div>
              <div className="row gap-s mt-s wrap"><span className="badge b-green">{s.present} P</span><span className="badge b-red">{s.absent} A</span>{s.photosRequired === false && <span className="badge b-gray">No photo</span>}{(s.cycle || 1) !== data.cycle && <span className="badge b-gray">archived</span>}{s.isHistorical && <span className="badge b-gray">past entry</span>}</div></div>
            <PctBadge pct={s.total ? Math.round(s.present / s.total * 100) : 0} /></button>))}</div>)}

      <Modal open={!!open} onClose={() => setOpen(null)} wide title={open ? `${fmtDate(open.date)} · ${open.activityType}` : ''}
        footer={open && <>{canDelete && <button className="btn btn-danger btn-sm" onClick={del} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon name="trash" size={14} /> Delete session</button>}<button className="btn btn-sm" onClick={pdf} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon name="download" size={14} /> Parade report</button>
          {canEdit && <button className="btn btn-primary" disabled={!dirty.length || saving} onClick={save}>{saving ? <Spinner /> : `Save ${dirty.length || ''} change${dirty.length === 1 ? '' : 's'}`}</button>}</>}>
        {!open ? null : !detail ? <Skeleton n={4} h={56} /> : (
          <div>
            <div className="row wrap mb"><span className="badge b-blue">{open.groupLabel}</span><span className="badge b-gray">by {open.markedByName}</span>{open.photosRequired === false && <span className="badge b-gray">No photo</span>}
              {open.geoLat && <a className="badge b-gray" target="_blank" rel="noreferrer" href={`https://maps.google.com/?q=${open.geoLat},${open.geoLng}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="map-pin" size={12} /> Map</a>}
              {(open.photoUrls || []).map((u, i) => <a key={i} className="badge b-blue" target="_blank" rel="noreferrer" href={u} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="camera" size={12} /> Photo {i + 1}</a>)}</div>
            {canEdit && !isCurrent && <div className="banner warn mb">This session belongs to an archived cycle. Edits are saved and logged but do not change the current counters.</div>}
            {canEdit && isCurrent && <div className="banner info mb">Tap P / A to correct a record. Every change is logged and emailed to Sir + backup.</div>}
            {[...detail.records].sort((a, b) => (a.cadetYear || 9) - (b.cadetYear || 9) || a.cadetName.localeCompare(b.cadetName)).map(r => {
              const e = cur(r);
              return (
                <div key={r.id} className={`item${e.status === 'Absent' ? ' absent' : ''}`} style={{ flexWrap: 'wrap' }}>
                  <div className="grow"><div className="name">{r.cadetName}{dirty.includes(r) && <span className="badge b-amber" style={{ marginLeft: 8 }}>changed</span>}</div><div className="sub">{r.cadetRegNo || 'No Reg No.'} · Year {r.cadetYear}{e.status === 'Absent' && !canEdit ? ` · ${r.reason || 'no reason'}` : ''}</div></div>
                  {canEdit ? (
                    <div className="pa"><button className={`p${e.status === 'Present' ? ' on' : ''}`} onClick={() => setEdits(s => ({ ...s, [r.cadetId]: { ...e, status: 'Present' } }))}>P</button>
                      <button className={`a${e.status === 'Absent' ? ' on' : ''}`} onClick={() => setEdits(s => ({ ...s, [r.cadetId]: { ...e, status: 'Absent' } }))}>A</button></div>
                  ) : <span className={`badge ${e.status === 'Present' ? 'b-green' : 'b-red'}`}>{e.status}</span>}
                  {canEdit && e.status === 'Absent' && (
                    <div className="col" style={{ width: '100%', gap: 8 }}>
                      <select className="input" value={e.reason} onChange={ev => setEdits(s => ({ ...s, [r.cadetId]: { ...e, reason: ev.target.value } }))}><option value="">Select reason…</option>{reasons.map(x => <option key={x}>{x}</option>)}<option value={OTHER}>Other…</option></select>
                      {e.reason === OTHER && <input className="input" maxLength={100} placeholder="Type the reason" value={e.other} onChange={ev => setEdits(s => ({ ...s, [r.cadetId]: { ...e, other: ev.target.value } }))} />}
                    </div>)}
                </div>);
            })}
            {canEdit && dirty.length > 0 && <div className="field mt"><label>Note for the change log (optional)</label><input className="input" maxLength={200} value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. Corrected after roll call" /></div>}
          </div>)}
      </Modal>
    </div>
  );
}
