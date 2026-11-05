'use client';
import { useState, useMemo } from 'react';
import { useRealtimeData } from '@/lib/useRealtimeData';
import { api, download, useUI, Modal, Skeleton, Empty, Spinner, PctBadge } from '@/app/components/ui';
import Icon from '@/app/components/Icon';
import { useUser, hasPerm } from '@/app/components/user';
import { fmtDate, fmtMonthLong, fmtDateTimeIST } from '@/lib/time';
import { personOrder } from '@/lib/groups';

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
  const [modalYear, setModalYear] = useState('all');
  const [modalSearch, setModalSearch] = useState('');

  const reasons = meta?.reasons || [];
  const sessions = useMemo(() => {
    const list = (data?.sessions || []).filter(s =>
      !q.trim() || `${s.date} ${s.activityType} ${s.groupLabel} ${s.markedByName}`.toLowerCase().includes(q.trim().toLowerCase())
    );
    return list.slice().sort((a, b) => (b.date || '').localeCompare(a.date || '') || String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  }, [data, q]);

  const monthGroups = useMemo(() => {
    const groups = [];
    let curMonth = null;
    let curSessions = [];
    for (const s of sessions) {
      const m = s.date ? fmtMonthLong(s.date.slice(0, 7)) : '';
      if (m !== curMonth) {
        if (curSessions.length > 0) groups.push({ month: curMonth, sessions: curSessions });
        curMonth = m;
        curSessions = [s];
      } else {
        curSessions.push(s);
      }
    }
    if (curSessions.length > 0) groups.push({ month: curMonth, sessions: curSessions });
    return groups;
  }, [sessions]);

  const isCurrent = open && (open.cycle || 1) === data?.cycle;

  async function view(s) {
    setOpen(s);
    setDetail(null);
    setEdits({});
    setNote('');
    setModalYear('all');
    setModalSearch('');
    const r = await api(`/api/attendance?sessionId=${s.id}`);
    if (r.ok) setDetail(r.data);
    else toast(r.error, 'err');
  }

  const cur = r => edits[r.cadetId] || { status: r.status, reason: reasons.includes(r.reason) || !r.reason ? r.reason : OTHER, other: reasons.includes(r.reason) ? '' : r.reason };
  const reasonOf = e => (e.reason === OTHER ? (e.other || '').trim() : e.reason);
  const dirty = detail ? detail.records.filter(r => { const e = cur(r); return e.status !== r.status || (e.status === 'Absent' && reasonOf(e) !== (r.reason || '')); }) : [];

  const yearsInSession = useMemo(() => {
    if (!detail?.records) return [];
    const ys = [...new Set(detail.records.map(r => r.cadetYear || r.year))].filter(Boolean).sort((a, b) => a - b);
    return ys;
  }, [detail]);

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

  const sessModal = detail?.session || open;
  const ap = sessModal?.approvals || {};
  const adminName = ap.admin?.byName;
  const ctoName = ap.cto?.byName;
  const approvers = [adminName, ctoName].filter(Boolean).join(' and ');
  const approvedAt = sessModal?.approvedAt || ap.cto?.at || ap.admin?.at;

  const yearsToDisplay = (modalYear === 'all' ? yearsInSession : [modalYear]).filter(Boolean);

  const renderRow = r => {
    const e = cur(r);
    return (
      <div key={r.id} className={`item${e.status === 'Absent' ? ' absent' : ''}`} style={{ flexWrap: 'wrap' }}>
        <div className="grow">
          <div className="name">{r.cadetName}{dirty.includes(r) && <span className="badge b-amber" style={{ marginLeft: 8 }}>changed</span>}</div>
          <div className="sub">{r.cadetRegNo || 'No Reg No.'} · Year {r.cadetYear}{e.status === 'Absent' && !canEdit ? ` · ${r.reason || 'no reason'}` : ''}</div>
        </div>
        {canEdit ? (
          <div className="pa">
            <button className={`p${e.status === 'Present' ? ' on' : ''}`} onClick={() => setEdits(s => ({ ...s, [r.cadetId]: { ...e, status: 'Present' } }))}>P</button>
            <button className={`a${e.status === 'Absent' ? ' on' : ''}`} onClick={() => setEdits(s => ({ ...s, [r.cadetId]: { ...e, status: 'Absent' } }))}>A</button>
          </div>
        ) : <span className={`badge ${e.status === 'Present' ? 'b-green' : 'b-red'}`}>{e.status}</span>}
        {canEdit && e.status === 'Absent' && (
          <div className="col" style={{ width: '100%', gap: 8 }}>
            <select className="input" value={e.reason} onChange={ev => setEdits(s => ({ ...s, [r.cadetId]: { ...e, reason: ev.target.value } }))}>
              <option value="">Select reason…</option>
              {reasons.map(x => <option key={x}>{x}</option>)}
              <option value={OTHER}>Other…</option>
            </select>
            {e.reason === OTHER && <input className="input" maxLength={100} placeholder="Type the reason" value={e.other} onChange={ev => setEdits(s => ({ ...s, [r.cadetId]: { ...e, other: ev.target.value } }))} />}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="stack">
      <div className="row wrap"><input className="input grow" style={{ minWidth: 200 }} placeholder="Search by date, activity, group, marker…" value={q} onChange={e => setQ(e.target.value)} />
        <div className="seg"><button className={cycle === 'current' ? 'on' : ''} onClick={() => setCycle('current')}>This cycle</button><button className={cycle === 'all' ? 'on' : ''} onClick={() => setCycle('all')}>All cycles</button></div></div>
      {loading && !data ? <Skeleton n={5} h={78} /> : !sessions.length ? <div className="card"><Empty icon="calendar">No sessions found.</Empty></div> : (
        <div className="stack">
          {monthGroups.map(g => (
            <div key={g.month} className="month-group mb">
              <div className="month-divider" style={{ fontWeight: 700, fontSize: 15, color: 'var(--text)', padding: '6px 0 10px' }}>{g.month}</div>
              <div className="grid g2">
                {g.sessions.map(s => (
                  <button key={s.id} className="item" style={{ textAlign: 'left', cursor: 'pointer', border: '1px solid var(--edge)', margin: 0 }} onClick={() => view(s)}>
                    <div className="grow">
                      <div className="name">{fmtDate(s.date)} · {s.activityType}{s.activityDescription ? ` — ${s.activityDescription}` : ''}</div>
                      <div className="sub">{s.groupLabel} · by {s.markedByName}{s.lastEditedByName ? ` · edited by ${s.lastEditedByName}` : ''}</div>
                      {s.createdAt && <div className="sub muted" style={{ fontSize: 12 }}>Submitted {fmtDateTimeIST(s.createdAt)}</div>}
                      <div className="row gap-s mt-s wrap"><span className="badge b-green">{s.present} P</span><span className="badge b-red">{s.absent} A</span>{s.photosRequired === false && <span className="badge b-gray">No photo</span>}{(s.cycle || 1) !== data.cycle && <span className="badge b-gray">archived</span>}{s.isHistorical && <span className="badge b-gray">past entry</span>}</div>
                    </div>
                    <PctBadge pct={s.total ? Math.round(s.present / s.total * 100) : 0} />
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={!!open} onClose={() => setOpen(null)} wide title={open ? `${fmtDate(open.date)} · ${open.activityType}` : ''}
        footer={open && <>{canDelete && <button className="btn btn-danger btn-sm" onClick={del} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon name="trash" size={14} /> Delete session</button>}<button className="btn btn-sm" onClick={pdf} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon name="download" size={14} /> Parade report</button>
          {canEdit && <button className="btn btn-primary" disabled={!dirty.length || saving} onClick={save}>{saving ? <Spinner /> : `Save ${dirty.length || ''} change${dirty.length === 1 ? '' : 's'}`}</button>}</>}>
        {!open ? null : !detail ? <Skeleton n={4} h={56} /> : (
          <div>
            <div className="sub mb-s" style={{ color: 'var(--dim)', fontSize: 13, lineHeight: 1.5 }}>
              {sessModal?.createdAt && <div>Submitted {fmtDateTimeIST(sessModal.createdAt)} by {sessModal.markedByName || '—'}</div>}
              {approvedAt && approvers && <div>Approved {fmtDateTimeIST(approvedAt)} by {approvers}</div>}
            </div>
            <div className="row wrap mb"><span className="badge b-blue">{open.groupLabel}</span><span className="badge b-gray">by {open.markedByName}</span>{open.photosRequired === false && <span className="badge b-gray">No photo</span>}
              {open.geoLat && <a className="badge b-gray" target="_blank" rel="noreferrer" href={`https://maps.google.com/?q=${open.geoLat},${open.geoLng}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="map-pin" size={12} /> Map</a>}
              {(open.photoUrls || []).map((u, i) => <a key={i} className="badge b-blue" target="_blank" rel="noreferrer" href={u} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="camera" size={12} /> Photo {i + 1}</a>)}</div>
            {canEdit && !isCurrent && <div className="banner warn mb">This session belongs to an archived cycle. Edits are saved and logged but do not change the current counters.</div>}
            {canEdit && isCurrent && <div className="banner info mb">Tap P / A to correct a record. Every change is logged and emailed to Sir + backup.</div>}

            {yearsInSession.length > 1 && (
              <div className="seg mb">
                <button className={modalYear === 'all' ? 'on' : ''} onClick={() => setModalYear('all')}>
                  All ({detail.records.length})
                </button>
                {yearsInSession.map(y => {
                  const yCount = detail.records.filter(r => (r.cadetYear || r.year) === y).length;
                  return (
                    <button key={y} className={modalYear === y ? 'on' : ''} onClick={() => setModalYear(y)}>
                      Year {y} ({yCount})
                    </button>
                  );
                })}
              </div>
            )}

            <div className="mb-s">
              <input
                className="input"
                style={{ width: '100%' }}
                placeholder="Search cadet by name or Reg No.…"
                value={modalSearch}
                onChange={e => setModalSearch(e.target.value)}
              />
            </div>

            {yearsToDisplay.map(y => {
              const allYRecords = detail.records.filter(r => (r.cadetYear || r.year) === y);
              const yTotal = allYRecords.length;
              const yPresent = allYRecords.filter(r => cur(r).status === 'Present').length;
              const yAbsent = allYRecords.filter(r => cur(r).status === 'Absent').length;

              const filteredYRecords = allYRecords.filter(r => {
                if (!modalSearch.trim()) return true;
                const term = modalSearch.trim().toLowerCase();
                return (r.cadetName || '').toLowerCase().includes(term) || (r.cadetRegNo || '').toLowerCase().includes(term);
              });

              const sdRecords = filteredYRecords.filter(r => (r.cadetType || r.type || 'SD') !== 'SW').sort(personOrder);
              const swRecords = filteredYRecords.filter(r => (r.cadetType || r.type || 'SD') === 'SW').sort(personOrder);

              return (
                <div key={y} className="year-section mb" style={{ border: '1px solid var(--edge)', borderRadius: 'var(--r-sm)', padding: 12, background: 'var(--surface-subtle)' }}>
                  <div style={{ position: 'sticky', top: 0, zIndex: 2, background: 'var(--surface-subtle)', padding: '6px 0', borderBottom: '1px solid var(--border)', fontWeight: 700, fontSize: 14 }}>
                    Year {y} - {yTotal} cadet{yTotal === 1 ? '' : 's'} - {yPresent} present - {yAbsent} absent
                  </div>
                  {filteredYRecords.length === 0 ? (
                    <div className="sub muted mt-s" style={{ padding: 8 }}>No cadets match the search.</div>
                  ) : (
                    <>
                      {sdRecords.length > 0 && (
                        <div className="eyebrow mt-s mb-xs" style={{ fontWeight: 700, color: 'var(--dim)' }}>SD</div>
                      )}
                      {sdRecords.map(renderRow)}
                      {swRecords.length > 0 && (
                        <div className="eyebrow mt-s mb-xs" style={{ fontWeight: 700, color: 'var(--dim)' }}>SW</div>
                      )}
                      {swRecords.map(renderRow)}
                    </>
                  )}
                </div>
              );
            })}

            {canEdit && dirty.length > 0 && <div className="field mt"><label>Note for the change log (optional)</label><input className="input" maxLength={200} value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. Corrected after roll call" /></div>}
          </div>)}
      </Modal>
    </div>
  );
}
