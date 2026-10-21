'use client';
import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useRealtimeData } from '@/lib/useRealtimeData';
import { api, useUI, Modal, Spinner, Skeleton, Empty, Stat, initials } from '@/app/components/ui';
import { Icon } from '@/app/components/Icon';
import { compressImage } from '@/lib/image';
import { queueSubmission, listQueue, removeItem } from '@/lib/offlineQueue';
import { todayIST, fmtDate, fmtDateLong } from '@/lib/time';
import { groupLabel } from '@/lib/groups';

const ACTIVITIES = ['Parade', 'Camp', 'Event', 'PT', 'Others'];
const OTHER = '__other__';

// The marking screen — used by markers (Marker page) and by the Admin / CTO (their "Mark" tab).
// `goHistory` opens the page that shows the submission's approval status.
// ═════════════════════════════════════════════════════════════════════════════
export default function MarkAttendance({ goHistory, who = 'marker' }) {
  const { toast } = useUI();
  const today = todayIST();
  const { data: meta } = useRealtimeData('/api/meta', 0);
  const { data: cdata, loading, refresh: refreshCadets } = useRealtimeData('/api/cadets', 120000);
  const cadets = cdata?.cadets;

  const [date, setDate] = useState(today);
  const [activity, setActivity] = useState('Parade');
  const [desc, setDesc] = useState('');
  const [years, setYears] = useState([]);
  const [marks, setMarks] = useState({});
  const [filter, setFilter] = useState('');
  const [existing, setExisting] = useState({});
  const [photos, setPhotos] = useState([]);
  const [geo, setGeo] = useState({ status: 'idle' });
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const [queued, setQueued] = useState([]);
  const gal = useRef(null), cam = useRef(null);
  const live = date === today;
  const reasons = meta?.reasons || ['Sick / Medical', 'Family function', 'Exam / Academic duty', 'Out of station', 'Late arrival', 'No information'];

  // ── people shown for the chosen group ────────────────────────────────────────
  const visible = useMemo(() => (cadets || []).filter(c => years.includes(c.year)), [cadets, years]);
  const counts = useMemo(() => ({ 1: (cadets || []).filter(c => c.year === 1).length, 2: (cadets || []).filter(c => c.year === 2).length, 3: (cadets || []).filter(c => c.year === 3).length }), [cadets]);
  const editable = visible.filter(c => !existing[c.id]);
  const locked = visible.filter(c => existing[c.id]);
  const shown = useMemo(() => { const f = filter.trim().toLowerCase(); return f ? visible.filter(c => c.name.toLowerCase().includes(f) || c.regNo.toLowerCase().includes(f)) : visible; }, [visible, filter]);
  const get = id => marks[id] || { status: 'Present', reason: '', other: '' };
  const setMark = (id, patch) => setMarks(m => ({ ...m, [id]: { ...get(id), ...patch } }));
  const reasonOf = m => (m.reason === OTHER ? m.other.trim() : m.reason);
  const absentees = editable.filter(c => get(c.id).status === 'Absent');
  const missingReason = absentees.filter(c => !reasonOf(get(c.id)));
  const presentN = editable.length - absentees.length;

  // ── duplicate protection: who already has attendance on this date ───────────
  const loadExisting = useCallback(async () => {
    const r = await api(`/api/attendance?date=${date}`);
    if (r.ok) setExisting(Object.fromEntries(r.data.records.map(x => [x.cadetId, x])));
  }, [date]);
  useEffect(() => { loadExisting(); }, [loadExisting]);

  const loadQueued = useCallback(async () => setQueued((await listQueue()).filter(i => i.status !== 'failed')), []);
  useEffect(() => { loadQueued(); }, [loadQueued]);

  // ── GPS (live attendance only) ───────────────────────────────────────────────
  const getLocation = useCallback(() => {
    if (!navigator.geolocation) return setGeo({ status: 'unsupported' });
    setGeo({ status: 'getting' });
    navigator.geolocation.getCurrentPosition(
      p => setGeo({ status: 'ok', lat: p.coords.latitude, lng: p.coords.longitude, acc: Math.round(p.coords.accuracy) }),
      e => setGeo({ status: e.code === 1 ? 'denied' : 'error' }), { enableHighAccuracy: true, timeout: 20000, maximumAge: 30000 });
  }, []);
  useEffect(() => { if (live) getLocation(); }, [live, getLocation]);

  // ── photos: camera OR gallery ────────────────────────────────────────────────
  async function addFiles(fileList) {
    const files = [...fileList].filter(f => f.type.startsWith('image/')).slice(0, 6 - photos.length);
    if (!files.length) return;
    const fresh = await Promise.all(files.map(async f => { const small = await compressImage(f); return { key: Math.random().toString(36).slice(2), file: small, preview: URL.createObjectURL(small), status: 'pending', url: null }; }));
    setPhotos(p => [...p, ...fresh]);
    if (navigator.onLine && (!live || geo.status === 'ok')) uploadPending(fresh);
  }
  // Uploads the given photos one by one; returns the URLs that succeeded.
  async function uploadPending(list) {
    const urls = [];
    for (const ph of list) {
      setPhotos(p => p.map(x => x.key === ph.key ? { ...x, status: 'up' } : x));
      const fd = new FormData(); fd.append('file', ph.file); fd.append('date', date);
      if (geo.status === 'ok') { fd.append('geo_lat', geo.lat); fd.append('geo_lng', geo.lng); }
      try {
        const r = await fetch('/api/attendance/upload-photo', { method: 'POST', body: fd });
        const j = await r.json().catch(() => ({}));
        if (r.ok) urls.push(j.url);
        setPhotos(p => p.map(x => x.key === ph.key ? (r.ok ? { ...x, status: 'ok', url: j.url } : { ...x, status: 'err', err: j.error }) : x));
        if (!r.ok) toast(j.error || 'Photo upload failed', 'err');
      } catch { setPhotos(p => p.map(x => x.key === ph.key ? { ...x, status: 'pending' } : x)); }
    }
    return urls;
  }
  const removePhoto = key => setPhotos(p => p.filter(x => x.key !== key));
  useEffect(() => () => photos.forEach(p => URL.revokeObjectURL(p.preview)), []); // eslint-disable-line

  // ── submit ───────────────────────────────────────────────────────────────────
  function problem() {
    if (!years.length) return 'Choose which years you are marking.';
    if (activity === 'Others' && !desc.trim()) return 'Describe the activity (Others).';
    if (!editable.length) return locked.length ? 'Attendance for this group is already submitted and locked.' : 'No cadets in this group.';
    if (missingReason.length) return `Select a reason for ${missingReason[0].name}${missingReason.length > 1 ? ` and ${missingReason.length - 1} more` : ''}.`;
    if (live && geo.status !== 'ok') return 'Location is required for live attendance — allow location access.';
    const photosRequired = live && meta?.requirePhotos !== false;
    if (photosRequired && !photos.length) return 'Add at least one parade photo (camera or gallery).';
    if (photos.some(p => p.status === 'up')) return 'Photos are still uploading…';
    return null;
  }
  async function submit() {
    setConfirmOpen(false); setBusy(true);
    const photosRequired = live && meta?.requirePhotos !== false;
    const base = {
      date, activity_type: activity, activity_description: desc.trim(), years,
      records: editable.map(c => { const m = get(c.id); return { cadet_id: c.id, status: m.status, reason: m.status === 'Absent' ? reasonOf(m) : '' }; }),
    };
    const geoPayload = geo.status === 'ok' ? { geo_lat: geo.lat, geo_lng: geo.lng } : {};
    const saveOffline = async why => {
      await queueSubmission({ payload: { ...base, ...geoPayload, photo_urls: photos.filter(p => p.url).map(p => p.url) }, photos: photos.filter(p => !p.url).map(p => p.file), geo: geo.status === 'ok' ? { lat: geo.lat, lng: geo.lng } : null });
      window.dispatchEvent(new Event('ncc-queue-changed'));
      setDone({ offline: true, why, present: presentN, absent: absentees.length });
    };
    try {
      if (!navigator.onLine) { await saveOffline('You are offline.'); return; }
      const urls = photos.filter(p => p.url).map(p => p.url);
      const todo = photos.filter(p => !p.url);
      if (todo.length) urls.push(...await uploadPending(todo));
      if (photosRequired && !urls.length) { toast('Photo upload failed — check your connection and try again.', 'err'); return; }
      const r = await api('/api/attendance', { method: 'POST', body: { ...base, ...geoPayload, photo_urls: urls } });
      if (r.network) { await saveOffline('The connection dropped.'); return; }
      if (!r.ok) { toast(r.error, 'err'); if (r.status === 409) loadExisting(); return; }
      setDone({ ...r.data });
      loadExisting();
    } finally { setBusy(false); }
  }
  function reset() { setDone(null); setMarks({}); setPhotos([]); setYears([]); setDesc(''); setFilter(''); window.scrollTo({ top: 0, behavior: 'smooth' }); }

  // ═══ result screen ═══
  if (done) return (
    <div className="card center" style={{ padding: 28, maxWidth: 520, margin: '20px auto' }}>
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
        <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'var(--accent-tint)', color: 'var(--accent)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={done.offline ? 'clock' : 'clipboard-check'} size={24} />
        </div>
      </div>
      <h2 className="h2 mt-s" style={{ fontSize: 20 }}>{done.offline ? 'Saved on this phone' : 'Sent for approval'}</h2>
      {done.offline
        ? <p className="muted mt-s">{done.why} It will be sent <b>automatically</b> the next time this app is open with internet. Please open the app once you are back online.</p>
        : <>
            <p className="muted mt-s">{done.present} present · {done.absent} absent. It is locked now and <b>waiting for approval from {done.waitingFor?.join(' and ') || 'the Admin and the CTO'}</b>.</p>
            <p className="muted small mt-s">Only after {done.waitingFor?.length === 1 ? 'that approval' : 'both approve'} is it saved to the records{done.isHistorical ? '' : ', the parade report is e-mailed to Sir and absentees are notified'}.</p>
          </>}
      <div className="row wrap mt" style={{ justifyContent: 'center' }}><button className="btn btn-primary" onClick={reset}>Mark another group</button><button className="btn" onClick={goHistory}>{who === 'marker' ? 'View status' : 'Open approvals'}</button></div>
    </div>);

  const err = problem();
  const yBtn = (y) => <button key={y} className={`chip${years.includes(y) ? ' on' : ''}`} onClick={() => setYears(s => s.includes(y) ? s.filter(x => x !== y) : [...s, y].sort())}>Year {y} <span style={{ opacity: .7 }}>· {counts[y]}</span></button>;
  const presets = [['All years', [1, 2, 3]], ['1 & 2', [1, 2]], ['2 & 3', [2, 3]], ['1 & 3', [1, 3]]];
  const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

  return (
    <div className="stack">
      {queued.length > 0 && (
        <div className="card">
          <div className="bold mb" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Icon name="alert-triangle" size={16} /> Saved on this phone — could not be sent
          </div>
          {queued.map(i => (
            <div key={i.id} className="item"><div className="grow"><div className="name">{fmtDate(i.payload.date)} · {i.payload.activity_type} · {groupLabel(i.payload.years)}</div><div className="sub" style={{ color: 'var(--danger)' }}>{i.error}</div></div>
              <button className="btn btn-sm" onClick={async () => { await removeItem(i.id); loadQueued(); window.dispatchEvent(new Event('ncc-queue-changed')); }}>Dismiss</button></div>))}
        </div>)}

      {/* 1 · when & what */}
      <div className="card col" style={{ gap: 14 }}>
        <div className="eyebrow">1 · Parade details</div>
        <div className="grid g2">
          <div className="field"><label htmlFor="d">Date</label><input id="d" type="date" className="input" value={date} max={today} onChange={e => e.target.value && setDate(e.target.value)} />
            <span className="hint">{fmtDateLong(date)}{!live ? ' · past date — location & photo optional' : meta?.requirePhotos === false ? ' · photo optional (emergency mode)' : ''}</span></div>
          <div className="field"><label>Activity</label><div className="row wrap gap-s">{ACTIVITIES.map(a => <button key={a} className={`chip${activity === a ? ' on' : ''}`} onClick={() => setActivity(a)}>{a}</button>)}</div></div>
        </div>
        <div className="field"><label htmlFor="ds">Description {activity === 'Others' ? '(required)' : '(optional)'}</label><input id="ds" className="input" maxLength={120} value={desc} onChange={e => setDesc(e.target.value)} placeholder="e.g. Drill practice, Republic Day rehearsal" /></div>
      </div>

      {/* 2 · who */}
      <div className="card col" style={{ gap: 12 }}>
        <div className="row between wrap"><div className="eyebrow">2 · Who is on parade?</div><span className="badge b-blue">{groupLabel(years)}</span></div>
        <div className="row wrap gap-s">{[1, 2, 3].map(yBtn)}</div>
        <div className="row wrap gap-s"><span className="small muted">Quick pick:</span>
          {presets.map(([l, v]) => <button key={l} className={`chip${same(years, v) ? ' on' : ''}`} style={{ minHeight: 32, padding: '4px 12px', fontSize: 13 }} onClick={() => setYears(v)}>{l}</button>)}
          <button className="chip" style={{ minHeight: 32, padding: '4px 12px', fontSize: 13 }} onClick={() => setYears([])}>Clear</button></div>
      </div>

      {/* 3 · roll call */}
      {years.length > 0 && (
        <div className="card">
          <div className="row between wrap mb">
            <div className="eyebrow">3 · Roll call</div>
            <div className="row gap-s">
              <span className="badge b-green">{presentN} present</span>
              <span className="badge b-red">{absentees.length} absent</span>
              {locked.length > 0 && <span className="badge b-gray"><Icon name="lock" size={12} /> {locked.length} locked</span>}
            </div>
          </div>
          {locked.length > 0 && (
            <div className="banner warn mb">
              <Icon name="lock" size={16} /> {locked.length} cadet{locked.length > 1 ? 's are' : ' is'} already submitted for this date{locked.some(c => existing[c.id].pending) ? ' (some are waiting for approval)' : ''} and cannot be changed here. Ask the Admin or CTO to edit.
            </div>
          )}
          <div className="row wrap mb"><input className="input grow" style={{ minWidth: 180 }} placeholder="Filter by name or reg. no…" value={filter} onChange={e => setFilter(e.target.value)} />
            <button className="btn btn-sm" onClick={() => setMarks({})} disabled={!absentees.length}>Reset all to present</button></div>
          {loading && !cadets ? <Skeleton n={5} h={62} /> : !shown.length ? <Empty icon="search">No cadets match.</Empty> : (
            <div>
              {shown.map((c, i) => {
                const m = get(c.id), isLocked = !!existing[c.id];
                const head = i === 0 || `${c.year}${c.type}` !== `${shown[i - 1].year}${shown[i - 1].type}`;
                return (
                  <div key={c.id}>
                    {head && <div className="group-h">{`Year ${c.year} - ${c.type}`}</div>}
                    <div className={`item${m.status === 'Absent' && !isLocked ? ' absent' : ''}${isLocked ? ' locked' : ''}`} style={{ flexWrap: 'wrap' }}>
                      <span className="avatar">{initials(c.name)}</span>
                      <div className="grow"><div className="name ellipsis">{c.name}</div><div className="sub ellipsis">{c.regNo || 'No Reg No.'}</div></div>
                      {isLocked ? <span className={`badge ${existing[c.id].pending ? 'b-amber' : 'b-gray'}`}>{existing[c.id].pending ? 'Awaiting approval' : `Locked: ${existing[c.id].status}`}</span> : (
                        <div className="pa" role="group" aria-label={`Attendance for ${c.name}`}>
                          <button className={`p${m.status === 'Present' ? ' on' : ''}`} onClick={() => setMark(c.id, { status: 'Present' })} aria-pressed={m.status === 'Present'}>P</button>
                          <button className={`a${m.status === 'Absent' ? ' on' : ''}`} onClick={() => setMark(c.id, { status: 'Absent' })} aria-pressed={m.status === 'Absent'}>A</button>
                        </div>)}
                      {m.status === 'Absent' && !isLocked && (
                        <div className="col" style={{ width: '100%', gap: 8 }}>
                          <select className="input" value={m.reason} onChange={e => setMark(c.id, { reason: e.target.value })} aria-label="Reason for absence">
                            <option value="">Select reason…</option>{reasons.map(r => <option key={r}>{r}</option>)}<option value={OTHER}>Other…</option></select>
                          {m.reason === OTHER && <input className="input" maxLength={100} placeholder="Type the reason" value={m.other} onChange={e => setMark(c.id, { other: e.target.value })} autoFocus />}
                        </div>)}
                    </div>
                  </div>);
              })}
            </div>)}
        </div>)}

      {/* 4 · proof */}
      {years.length > 0 && (
        <div className="card col" style={{ gap: 14 }}>
          <div className="row between wrap">
            <div className="eyebrow">4 · Parade photos {live && meta?.requirePhotos !== false ? '(required)' : '(optional)'}</div>
            {live && (
              <button className={`badge ${geo.status === 'ok' ? 'b-green' : geo.status === 'getting' ? 'b-amber' : 'b-red'}`} style={{ border: 0, cursor: 'pointer' }} onClick={getLocation}>
                <Icon name="map-pin" size={12} />
                {geo.status === 'ok' ? `Location captured (±${geo.acc} m)` : geo.status === 'getting' ? 'Getting location…' : geo.status === 'denied' ? 'Location blocked — tap to retry' : 'Tap to get location'}
              </button>
            )}
          </div>
          {live && geo.status === 'denied' && <div className="banner bad">Location is blocked. Allow it in your browser / phone settings for this site, then tap the badge above.</div>}
          <div className="row wrap photo-actions">
            <button className="btn" onClick={() => cam.current?.click()} disabled={photos.length >= 6}>
              <Icon name="camera" size={16} /> Take photo
            </button>
            <button className="btn" onClick={() => gal.current?.click()} disabled={photos.length >= 6}>
              <Icon name="image" size={16} /> Choose from gallery
            </button>
            <span className="hint">Up to 6 photos</span>
          </div>
          <input ref={cam} type="file" accept="image/*" capture="environment" hidden onChange={e => { addFiles(e.target.files); e.target.value = ''; }} />
          <input ref={gal} type="file" accept="image/*" multiple hidden onChange={e => { addFiles(e.target.files); e.target.value = ''; }} />
          {photos.length > 0 && <div className="row wrap">{photos.map(p => (
            <div key={p.key} className="thumb">
              <img src={p.preview} alt="Parade" />
              {p.status === 'err' && (
                <button type="button" className="retry" onClick={() => uploadPending([p])} aria-label="Retry upload" title="Retry upload">
                  <Icon name="refresh" size={12} />
                </button>
              )}
              <button type="button" className="x" onClick={() => removePhoto(p.key)} aria-label="Remove photo">
                <Icon name="x" size={12} />
              </button>
              <div className="st">{p.status === 'ok' ? 'Uploaded' : p.status === 'up' ? 'Uploading…' : p.status === 'err' ? 'Failed' : 'Ready'}</div>
            </div>))}</div>}
        </div>)}

      {years.length > 0 && <div className="submitbar-spacer" style={{ height: 96 }} />}

      {years.length > 0 && (
        <div className="submitbar">
          <div className="grow"><div className="bold small">{editable.length} cadets · <span style={{ color: 'var(--success)' }}>{presentN} P</span> · <span style={{ color: 'var(--danger)' }}>{absentees.length} A</span></div>
            <div className="tiny muted ellipsis">{err || 'Ready to submit'}</div></div>
          <button className="btn btn-primary btn-lg" disabled={!!err || busy} onClick={() => setConfirmOpen(true)}>{busy ? <><Spinner /> Submitting…</> : 'Submit'}</button>
        </div>)}

      <Modal open={confirmOpen} onClose={() => setConfirmOpen(false)} title="Submit attendance?"
        footer={<><button className="btn" onClick={() => setConfirmOpen(false)}>Check again</button><button className="btn btn-primary" onClick={submit} disabled={busy}>Yes, submit</button></>}>
        <p className="muted">{fmtDateLong(date)} · {activity}{desc ? ` — ${desc}` : ''}</p>
        <div className="grid g3 mt"><Stat value={editable.length} label="Cadets" /><Stat value={presentN} label="Present" color="var(--success)" /><Stat value={absentees.length} label="Absent" color="var(--danger)" /></div>
        <div className="banner warn mt">
          <Icon name="lock" size={16} /> Once submitted, attendance is locked and goes for approval by the Admin and the CTO. Only they can change it, and every change is e-mailed to Sir.
        </div>
      </Modal>
    </div>
  );
}
