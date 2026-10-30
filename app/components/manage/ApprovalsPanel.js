'use client';
import { useState } from 'react';
import { useRealtimeData } from '@/lib/useRealtimeData';
import { api, useUI, Modal, Skeleton, Empty, Spinner } from '@/app/components/ui';
import Icon from '@/app/components/Icon';
import { useUser } from '@/app/components/user';
import { fmtDate, fmtDateTimeIST } from '@/lib/time';

const OTHER = '__other__';
const SIDE = { admin: 'Admin', cto: 'CTO' };

function StageChip({ s, side }) {
  if (s.state === 'rejected') return <span className="badge b-red">Rejected by {s.rejection?.byName}</span>;
  const stage = s.stage || (s.approvals?.admin ? 'cto' : 'admin');
  if (stage === 'admin' && s.returnedByCto && side === 'admin') {
    return <span className="badge b-amber">Returned by CTO</span>;
  }
  return (
    <span className="badge b-blue">{stage === 'cto' ? 'With CTO' : 'With Administrator'}</span>
  );
}

// Everything the Admin / CTO needs to review a submission before it becomes a real record
export default function ApprovalsPanel({ onChanged }) {
  const user = useUser(); const { toast, confirm } = useUI();
  const [state, setState] = useState('pending');
  const { data, loading, refresh } = useRealtimeData(`/api/approvals?state=${state}`, 6000);      // refreshes every 6 s
  const { data: meta } = useRealtimeData('/api/meta', 0);
  const [open, setOpen] = useState(null); const [detail, setDetail] = useState(null);
  const [edits, setEdits] = useState({}); const [note, setNote] = useState(''); const [busy, setBusy] = useState('');
  const [rejecting, setRejecting] = useState(false); const [reason, setReason] = useState('');
  const isAdmin = user?.role === 'admin';
  const reasons = meta?.reasons || [];
  const side = data?.side || user.role;
  const list = data?.submissions || [];

  async function view(s) { setOpen(s); setDetail(null); setEdits({}); setNote(''); setRejecting(false); setReason(''); const r = await api(`/api/approvals?id=${s.id}`); if (r.ok) setDetail(r.data.submission); else { toast(r.error, 'err'); setOpen(null); refresh(); } }
  const cur = r => edits[r.cadetId] || { status: r.status === 'Present' ? 'Present' : 'Absent', reason: reasons.includes(r.reason) || !r.reason ? r.reason || '' : OTHER, other: reasons.includes(r.reason) ? '' : r.reason || '' };
  const reasonOf = e => (e.reason === OTHER ? (e.other || '').trim() : e.reason);
  const dirty = detail ? detail.records.filter(r => { const e = cur(r); return e.status !== (r.status === 'Present' ? 'Present' : 'Absent') || (e.status === 'Absent' && reasonOf(e) !== (r.reason || '')); }) : [];
  const done = () => { setOpen(null); refresh(); onChanged?.(); };

  async function saveEdits() {
    for (const r of dirty) if (cur(r).status === 'Absent' && !reasonOf(cur(r))) return toast(`Select a reason for ${r.cadetName}.`, 'err');
    setBusy('edit');
    const r = await api('/api/approvals', { method: 'PUT', body: { id: open.id, note, changes: dirty.map(x => ({ cadet_id: x.cadetId, status: cur(x).status, reason: cur(x).status === 'Absent' ? reasonOf(cur(x)) : '' })) } });
    setBusy('');
    if (!r.ok) return toast(r.error, 'err');
    toast(`Saved ${r.data.changed} change(s).`, 'ok', 4000);
    const up = await api(`/api/approvals?id=${open.id}`);
    if (up.ok) setDetail(up.data.submission);
    setEdits({});
    setNote('');
    refresh();
  }
  async function approve() {
    if (dirty.length) return toast('Save your edits first (or discard them), then approve.', 'err');
    if (side === 'cto') {
      if (!await confirm({
        title: 'Approve and finalise?',
        confirmText: 'Approve & finalise',
        message: 'You are the last approval. It will be saved to the records, counted, added to the Google Sheet, and the parade report (PDF) will be e-mailed to Sir + backup. Absentees with an e-mail are notified.'
      })) return;
    }
    setBusy('approve');
    const r = await api('/api/approvals', { method: 'POST', body: { id: open.id, action: 'approve' } });
    setBusy('');
    if (!r.ok) { toast(r.error, 'err'); if (r.status === 404 || r.status === 409) done(); return; }
    toast(r.data.final ? 'Approved and saved. Parade report is being e-mailed.' : 'Approved. Waiting for the CTO.', 'ok', 5000); done();
  }
  async function doReject() {
    if (!reason.trim()) {
      return toast(side === 'cto' ? 'Write a reason for returning to the Administrator.' : 'Write a short reason so the marker can correct it.', 'err');
    }
    setBusy('reject');
    const r = await api('/api/approvals', { method: 'POST', body: { id: open.id, action: 'reject', reason } });
    setBusy('');
    if (!r.ok) return toast(r.error, 'err');
    toast(side === 'cto' ? 'Returned to Administrator.' : 'Rejected. The marker will see your reason.', 'ok');
    done();
  }

  const myStage = detail?.state === 'pending' && detail?.stage === side;
  const editable = isAdmin && myStage;

  return (
    <div className="stack">
      <div className="row between wrap">
        <p className="muted small" style={{ maxWidth: 600 }}>Submitted attendance is <b>locked and pending</b> until <b>both the Admin and the CTO approve</b>. Only then is it saved, counted, added to the sheet and e-mailed. You can correct mistakes before approving.</p>
        <div className="seg"><button className={state === 'pending' ? 'on' : ''} onClick={() => setState('pending')}>Pending</button><button className={state === 'rejected' ? 'on' : ''} onClick={() => setState('rejected')}>Rejected</button></div>
      </div>

      {loading && !data ? <Skeleton n={3} h={96} /> : !list.length ? <div className="card"><Empty icon={state === 'pending' ? 'check-circle' : 'mail'}>{state === 'pending' ? 'Nothing is waiting for approval.' : 'No rejected submissions.'}</Empty></div> : (
        <div className="grid g2">{list.map(s => (
          <button key={s.id} className="item" style={{ textAlign: 'left', cursor: 'pointer', border: `1px solid ${s.needsMe ? 'var(--amber)' : 'var(--edge)'}`, margin: 0, alignItems: 'flex-start', flexDirection: 'column' }} onClick={() => view(s)}>
            <div className="row between" style={{ width: '100%', alignItems: 'flex-start' }}>
              <div className="grow"><div className="name">{fmtDate(s.date)} · {s.activityType}{s.activityDescription ? ` — ${s.activityDescription}` : ''}</div><div className="sub">{s.groupLabel} · by {s.markedByName}{s.markerRole === 'admin' || s.markerRole === 'cto' ? ` (${SIDE[s.markerRole]})` : ''}</div></div>
              {s.needsMe && <span className="badge b-amber">Needs you</span>}
            </div>
            <div className="row gap-s wrap mt-s">
              <span className="badge b-green">{s.present} P</span>
              <span className="badge b-red">{s.absent} A</span>
              {s.previousRejection && <span className="badge b-blue">Resubmitted</span>}
              {s.photosRequired === false && <span className="badge b-gray">No photo</span>}
              <StageChip s={s} side={side} />
            </div>
            {state === 'rejected' && <div className="small muted">“{s.rejection?.reason}”</div>}
            <div className="row between" style={{ width: '100%', alignItems: 'center', marginTop: 4 }}>
              <div className="tiny muted">Submitted {fmtDateTimeIST(s.createdAt)}</div>
              {isAdmin && state === 'rejected' && (
                <span
                  role="button"
                  tabIndex={0}
                  className="btn btn-danger btn-sm"
                  style={{ padding: '2px 8px', fontSize: 12, display: 'inline-flex', alignItems: 'center' }}
                  onClick={async (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    if (!await confirm({
                      title: 'Delete rejected submission?',
                      message: 'This will permanently remove this rejected attendance submission.',
                      confirmText: 'Delete',
                      danger: true,
                    })) return;
                    setBusy(s.id);
                    const r = await api(`/api/approvals?id=${s.id}`, { method: 'DELETE' });
                    setBusy('');
                    if (!r.ok) return toast(r.error || 'Failed to delete', 'err');
                    toast('Rejected submission deleted.', 'ok');
                    refresh();
                  }}
                >
                  {busy === s.id ? <Spinner /> : 'Delete'}
                </span>
              )}
            </div>
          </button>))}</div>)}

      <Modal open={!!open} onClose={() => setOpen(null)} wide title={open ? `${fmtDate(open.date)} · ${open.activityType}` : 'Review'}
        footer={open && detail && (open.state === 'rejected' ? (isAdmin && (
          <button
            type="button"
            className="btn btn-danger btn-sm"
            onClick={async () => {
              if (!await confirm({
                title: 'Delete rejected submission?',
                message: 'This will permanently remove this rejected attendance submission.',
                confirmText: 'Delete',
                danger: true,
              })) return;
              setBusy(open.id);
              const r = await api(`/api/approvals?id=${open.id}`, { method: 'DELETE' });
              setBusy('');
              if (!r.ok) return toast(r.error || 'Failed to delete', 'err');
              toast('Rejected submission deleted.', 'ok');
              setOpen(null);
              refresh();
            }}
            disabled={busy === open.id}
          >
            {busy === open.id ? <Spinner /> : 'Delete'}
          </button>
        )) : (!rejecting && (
          myStage ? (
            side === 'admin' ? (
              <>
                <button className="btn btn-danger btn-sm" onClick={() => setRejecting(true)} disabled={!!busy}>Reject and send to marker</button>
                {dirty.length > 0 && <button className="btn" onClick={saveEdits} disabled={!!busy}>{busy === 'edit' ? <Spinner /> : `Save edits (${dirty.length})`}</button>}
                <button className="btn btn-success" onClick={approve} disabled={!!busy || dirty.length > 0}>{busy === 'approve' ? <Spinner /> : <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon name="check" size={16} /> Approve</span>}</button>
              </>
            ) : (
              <>
                <button className="btn btn-danger btn-sm" onClick={() => setRejecting(true)} disabled={!!busy}>Return to Administrator</button>
                <button className="btn btn-success" onClick={approve} disabled={!!busy}>{busy === 'approve' ? <Spinner /> : <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon name="check" size={16} /> Approve</span>}</button>
              </>
            )
          ) : (
            <span className="muted small">This is with the {detail.stage === 'cto' ? 'CTO' : 'Administrator'} now.</span>
          )
        )))}>
        {!open ? null : !detail ? <Skeleton n={4} h={56} /> : (
          <div>
            <div className="timeline mb">
              <div className="done"><div className="eyebrow">Marked by</div><div className="bold">{detail.markedByName}</div><div className="small muted">{fmtDateTimeIST(detail.createdAt)}</div></div>
              <div className={detail.approvals?.admin ? 'done' : ''}>
                <div className="eyebrow">Administrator</div>
                {detail.approvals?.admin ? (
                  <><div className="bold">{detail.approvals.admin.byName}</div><div className="small muted">{fmtDateTimeIST(detail.approvals.admin.at)}</div></>
                ) : (
                  <div className="bold" style={{ color: 'var(--amber)', display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="clock" size={14} /> Waiting</div>
                )}
              </div>
              <div className={detail.approvals?.cto ? 'done' : ''}>
                <div className="eyebrow">CTO</div>
                {detail.approvals?.cto ? (
                  <><div className="bold">{detail.approvals.cto.byName}</div><div className="small muted">{fmtDateTimeIST(detail.approvals.cto.at)}</div></>
                ) : (
                  <div className="bold" style={{ color: 'var(--amber)', display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="clock" size={14} /> Waiting</div>
                )}
              </div>
            </div>

            {Array.isArray(detail.history) && detail.history.length > 0 && (
              <div className="card tight mb col" style={{ gap: 6, fontSize: 13 }}>
                <div className="eyebrow">History</div>
                <div className="col" style={{ gap: 4 }}>
                  {detail.history.map((h, i) => (
                    <div key={i} className="row between wrap small">
                      <div>
                        <b>{h.byName}</b> ({h.role === 'admin' ? 'Administrator' : h.role === 'cto' ? 'CTO' : 'Marker'})
                        {' — '}
                        <span className="muted">{h.action}{h.note ? `: “${h.note}”` : ''}</span>
                      </div>
                      <span className="tiny muted">{fmtDateTimeIST(h.at)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {detail.returnedByCto && (
              <div className="banner warn mb">
                Returned by {detail.returnedByCto.byName}: &apos;{detail.returnedByCto.reason}&apos;. Correct it or reject it to the marker.
              </div>
            )}

            <div className="row wrap mb"><span className="badge b-blue">{detail.groupLabel}</span><span className="badge b-green">{detail.present} present</span><span className="badge b-red">{detail.absent} absent</span>
              {detail.photosRequired === false && <span className="badge b-gray">No photo</span>}
              {detail.geoLat && <a className="badge b-gray" target="_blank" rel="noreferrer" href={`https://maps.google.com/?q=${detail.geoLat},${detail.geoLng}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="map-pin" size={12} /> Location</a>}
              {(detail.photoUrls || []).map((u, i) => <a key={i} className="badge b-blue" target="_blank" rel="noreferrer" href={u} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="camera" size={12} /> Photo {i + 1}</a>)}</div>
            {detail.previousRejection && (
              <div className="small muted mb">Earlier rejected by {detail.previousRejection.byName}: &apos;{detail.previousRejection.reason}&apos;</div>
            )}
            {detail.state === 'rejected' && <div className="banner bad mb">Rejected by {detail.rejection?.byName}: “{detail.rejection?.reason}”</div>}
            {rejecting && (
              <div className="card tight mb col" style={{ gap: 10 }}>
                <div className="bold">{side === 'cto' ? 'Return to Administrator' : 'Reject and send to marker'}</div>
                <input
                  className="input"
                  maxLength={200}
                  autoFocus
                  placeholder={side === 'cto' ? 'Reason for returning to Administrator' : 'Reason (the marker will see this)'}
                  value={reason}
                  onChange={e => setReason(e.target.value)}
                />
                <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
                  <button className="btn" onClick={() => setRejecting(false)}>Cancel</button>
                  <button className="btn btn-danger" onClick={doReject} disabled={busy === 'reject'}>
                    {busy === 'reject' ? <Spinner /> : side === 'cto' ? 'Return to Administrator' : 'Reject and send to marker'}
                  </button>
                </div>
              </div>
            )}
            {detail.state !== 'rejected' && (
              <div className="banner info mb">
                {!myStage
                  ? `Waiting for the ${detail.stage === 'cto' ? 'CTO' : 'Administrator'}.`
                  : isAdmin
                    ? 'Check the roll. Tap P / A to correct a mistake, or approve/reject.'
                    : 'Review the roll and approve, or return to the Administrator if corrections are needed.'}
              </div>
            )}
            {[...detail.records].sort((a, b) => (a.cadetYear || 9) - (b.cadetYear || 9) || a.cadetName.localeCompare(b.cadetName)).map(r => {
              const e = cur(r);
              return (
                <div key={r.cadetId} className={`item${e.status === 'Absent' ? ' absent' : ''}`} style={{ flexWrap: 'wrap' }}>
                  <div className="grow"><div className="name">{r.cadetName}{dirty.includes(r) && <span className="badge b-amber" style={{ marginLeft: 8 }}>changed</span>}</div><div className="sub">{r.cadetRegNo || 'No Reg No.'} · Year {r.cadetYear}{e.status === 'Absent' && !editable ? ` · ${r.reason || 'no reason'}` : ''}</div></div>
                  {editable ? <div className="pa"><button className={`p${e.status === 'Present' ? ' on' : ''}`} onClick={() => setEdits(s => ({ ...s, [r.cadetId]: { ...e, status: 'Present' } }))}>P</button><button className={`a${e.status === 'Absent' ? ' on' : ''}`} onClick={() => setEdits(s => ({ ...s, [r.cadetId]: { ...e, status: 'Absent' } }))}>A</button></div>
                    : <span className={`badge ${e.status === 'Present' ? 'b-green' : 'b-red'}`}>{e.status}</span>}
                  {editable && e.status === 'Absent' && <div className="col" style={{ width: '100%', gap: 8 }}>
                    <select className="input" value={e.reason} onChange={ev => setEdits(s => ({ ...s, [r.cadetId]: { ...e, reason: ev.target.value } }))}><option value="">Select reason…</option>{reasons.map(x => <option key={x}>{x}</option>)}<option value={OTHER}>Other…</option></select>
                    {e.reason === OTHER && <input className="input" maxLength={100} placeholder="Type the reason" value={e.other} onChange={ev => setEdits(s => ({ ...s, [r.cadetId]: { ...e, other: ev.target.value } }))} />}</div>}
                </div>);
            })}
            {isAdmin && dirty.length > 0 && <div className="field mt"><label>Note for the log (optional)</label><input className="input" maxLength={200} value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. Priya was late, not absent" /></div>}
          </div>)}
      </Modal>
    </div>
  );
}
