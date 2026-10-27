'use client';
import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useRealtimeData } from '@/lib/useRealtimeData';
import { useUser } from '@/app/components/user';
import { api, useUI, Modal, Spinner, Skeleton, Empty, Stat, initials } from '@/app/components/ui';
import { Icon } from '@/app/components/Icon';
import { compressImage } from '@/lib/image';
import { tabHeaders } from '@/lib/tab';
import { todayIST, fmtDateLong } from '@/lib/time';
import { groupLabel } from '@/lib/groups';

const ACTIVITIES = ['Parade', 'Camp', 'Event', 'PT', 'Others'];
const OTHER = '__other__';

function getCached(key) {
  if (typeof window === 'undefined' || typeof sessionStorage === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.timestamp || !parsed.data) return null;
    const age = Date.now() - parsed.timestamp;
    if (age > 6 * 3600 * 1000) return null; // 6 hours
    return parsed.data;
  } catch {
    return null;
  }
}

function setCache(key, data) {
  if (typeof window === 'undefined' || typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.setItem(key, JSON.stringify({ data, timestamp: Date.now() }));
  } catch {}
}

// The marking screen — used by markers (Marker page) and by the Admin / CTO (their "Mark" tab).
// `goHistory` opens the page that shows the submission's approval status.
// ═════════════════════════════════════════════════════════════════════════════
export default function MarkAttendance({ goHistory, who = 'marker' }) {
  const router = useRouter();
  const ctxUser = useUser();
  const { toast } = useUI();
  const today = todayIST();
  const { data: meData } = useRealtimeData('/api/me');
  const authUid = ctxUser?.id || meData?.user?.id;
  const userId = authUid || (typeof window !== 'undefined' ? sessionStorage.getItem('ncc_uid') : null);

  const [meta, setMeta] = useState(() => {
    return userId ? getCached(`ncc_cache_meta_${userId}`) : null;
  });
  const [cadets, setCadets] = useState(() => {
    const c = userId ? getCached(`ncc_cache_cadets_${userId}`) : null;
    return c?.cadets || (Array.isArray(c) ? c : null);
  });
  const [loading, setLoading] = useState(() => !cadets);

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
  const [resubmitOf, setResubmitOf] = useState(null);
  const [rejectionBanner, setRejectionBanner] = useState(null);
  const [draftBanner, setDraftBanner] = useState(false);
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);

  const gal = useRef(null), cam = useRef(null);
  const live = date === today;
  const reasons = meta?.reasons || ['Sick / Medical', 'Family function', 'Exam / Academic duty', 'Out of station', 'Late arrival', 'No information'];
  const userInteracted = useRef(false);
  const draftChecked = useRef(false);

  // ── online status listener ──────────────────────────────────────────────────
  useEffect(() => {
    const on = () => setIsOnline(true);
    const off = () => setIsOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  // ── pre-fill rejected submission if ncc_resubmit key exists ─────────────────
  const resubmitChecked = useRef(false);
  useEffect(() => {
    if (resubmitChecked.current) return;
    const resubmitId = typeof window !== 'undefined' ? sessionStorage.getItem('ncc_resubmit') : null;
    if (!resubmitId) return;
    resubmitChecked.current = true;
    sessionStorage.removeItem('ncc_resubmit');

    let mounted = true;
    (async () => {
      const r = await api(`/api/approvals?id=${resubmitId}`);
      if (!mounted) return;
      if (!r.ok || !r.data?.submission) {
        toast(r.error || 'Could not load rejected submission', 'err');
        return;
      }
      const s = r.data.submission;
      setResubmitOf(s.id);
      if (s.rejection) {
        setRejectionBanner({
          byName: s.rejection.byName || '',
          side: s.rejection.side === 'cto' ? 'CTO' : 'Admin',
          reason: s.rejection.reason || '',
        });
      }
      if (s.date) setDate(s.date);
      if (s.activityType) setActivity(s.activityType);
      setDesc(s.activityDescription || '');
      if (Array.isArray(s.years)) setYears(s.years);

      const reasonsList = meta?.reasons || ['Sick / Medical', 'Family function', 'Exam / Academic duty', 'Out of station', 'Late arrival', 'No information'];
      const loadedMarks = {};
      for (const rec of (s.records || [])) {
        const cid = rec.cadetId || rec.cadet_id;
        if (!cid) continue;
        const isAbsent = rec.status === 'Absent';
        if (isAbsent) {
          const isKnown = reasonsList.includes(rec.reason);
          loadedMarks[cid] = {
            status: 'Absent',
            reason: isKnown ? rec.reason : (rec.reason ? OTHER : ''),
            other: isKnown ? '' : (rec.reason || ''),
          };
        } else {
          loadedMarks[cid] = { status: 'Present', reason: '', other: '' };
        }
      }
      setMarks(loadedMarks);

      if (Array.isArray(s.photoUrls) && s.photoUrls.length) {
        setPhotos(s.photoUrls.map(u => ({
          key: Math.random().toString(36).slice(2),
          file: null,
          preview: u,
          status: 'ok',
          url: u,
        })));
      }
    })();
    return () => { mounted = false; };
  }, [meta, toast]);

  // ── restore draft if saved for the same user ────────────────────────────────
  useEffect(() => {
    if (!authUid || draftChecked.current) return;
    draftChecked.current = true;
    if (typeof window === 'undefined' || typeof sessionStorage === 'undefined') return;
    if (sessionStorage.getItem('ncc_resubmit')) return;

    try {
      const raw = sessionStorage.getItem(`ncc_draft_${authUid}`);
      if (raw) {
        const d = JSON.parse(raw);
        if (d && typeof d === 'object') {
          if (d.date) setDate(d.date);
          if (d.activity) setActivity(d.activity);
          if (typeof d.description === 'string') setDesc(d.description);
          if (Array.isArray(d.years)) setYears(d.years);
          if (d.marks && typeof d.marks === 'object') setMarks(d.marks);
          if (Array.isArray(d.photoUrls) && d.photoUrls.length) {
            setPhotos(d.photoUrls.map(u => ({
              key: Math.random().toString(36).slice(2),
              file: null,
              preview: u,
              status: 'ok',
              url: u,
            })));
          }
          setDraftBanner(true);
        }
      }
    } catch {}
  }, [authUid]);

  // ── auto-save draft every second after a change ─────────────────────────────
  useEffect(() => {
    if (!authUid || done) return;
    if (!userInteracted.current) return;
    const t = setTimeout(() => {
      try {
        const draft = {
          date,
          activity,
          description: desc,
          years,
          marks,
          photoUrls: photos.filter(p => p.url).map(p => p.url),
        };
        const hasContent = years.length > 0 || desc.trim() || Object.keys(marks).length > 0 || draft.photoUrls.length > 0;
        if (hasContent) {
          sessionStorage.setItem(`ncc_draft_${authUid}`, JSON.stringify(draft));
        }
      } catch {}
    }, 1000);
    return () => clearTimeout(t);
  }, [authUid, date, activity, desc, years, marks, photos, done]);

  function discardDraft() {
    if (authUid) {
      try {
        sessionStorage.removeItem(`ncc_draft_${authUid}`);
      } catch {}
    }
    setDraftBanner(false);
    startFresh();
  }

  function startFresh() {
    setResubmitOf(null);
    setRejectionBanner(null);
    setDate(today);
    setActivity('Parade');
    setDesc('');
    setYears([]);
    setMarks({});
    setPhotos([]);
    setFilter('');
    setDone(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ── people shown for the chosen group ────────────────────────────────────────
  const visible = useMemo(() => (cadets || []).filter(c => years.includes(c.year)), [cadets, years]);
  const counts = useMemo(() => ({ 1: (cadets || []).filter(c => c.year === 1).length, 2: (cadets || []).filter(c => c.year === 2).length, 3: (cadets || []).filter(c => c.year === 3).length }), [cadets]);
  const editable = visible.filter(c => !existing[c.id]);
  const locked = visible.filter(c => existing[c.id]);
  const shown = useMemo(() => { const f = filter.trim().toLowerCase(); return f ? visible.filter(c => c.name.toLowerCase().includes(f) || c.regNo.toLowerCase().includes(f)) : visible; }, [visible, filter]);
  const get = id => marks[id] || { status: 'Present', reason: '', other: '' };
  const setMark = (id, patch) => {
    userInteracted.current = true;
    setMarks(m => ({ ...m, [id]: { ...get(id), ...patch } }));
  };
  const reasonOf = m => (m.reason === OTHER ? m.other.trim() : m.reason);
  const absentees = editable.filter(c => get(c.id).status === 'Absent');
  const missingReason = absentees.filter(c => !reasonOf(get(c.id)));
  const presentN = editable.length - absentees.length;

  // ── Parallel fetch: /api/meta, /api/cadets, and duplicate lock /api/attendance?date= ────────
  useEffect(() => {
    let mounted = true;
    (async () => {
      const [rMeta, rCadets, rAtt] = await Promise.all([
        api('/api/meta'),
        api('/api/cadets'),
        api(`/api/attendance?date=${date}`),
      ]);
      if (!mounted) return;

      // Duplicate-day lock check is NEVER cached
      if (rAtt.ok && rAtt.data?.records) {
        setExisting(Object.fromEntries(rAtt.data.records.map(x => [x.cadetId, x])));
      }

      const uid = userId || (typeof window !== 'undefined' ? sessionStorage.getItem('ncc_uid') : null);

      if (rMeta.ok && rMeta.data) {
        if (uid) {
          const cachedM = getCached(`ncc_cache_meta_${uid}`);
          if (JSON.stringify(cachedM) !== JSON.stringify(rMeta.data)) {
            setMeta(rMeta.data);
            setCache(`ncc_cache_meta_${uid}`, rMeta.data);
          }
        } else {
          setMeta(rMeta.data);
        }
      }

      if (rCadets.ok && rCadets.data) {
        const freshCadets = rCadets.data.cadets || (Array.isArray(rCadets.data) ? rCadets.data : []);
        if (uid) {
          const cachedC = getCached(`ncc_cache_cadets_${uid}`);
          const oldList = cachedC?.cadets || (Array.isArray(cachedC) ? cachedC : null);
          if (JSON.stringify(oldList) !== JSON.stringify(freshCadets)) {
            setCadets(freshCadets);
            setCache(`ncc_cache_cadets_${uid}`, rCadets.data);
          }
        } else {
          setCadets(freshCadets);
        }
      }

      setLoading(false);
    })();
    return () => { mounted = false; };
  }, [date, userId]);

  // Sync uid & cache when userId becomes available
  useEffect(() => {
    if (authUid) {
      try { sessionStorage.setItem('ncc_uid', authUid); } catch {}
    }
    if (!userId) return;
    if (!cadets) {
      const c = getCached(`ncc_cache_cadets_${userId}`);
      if (c) {
        setCadets(c.cadets || (Array.isArray(c) ? c : null));
        setLoading(false);
      }
    }
    if (!meta) {
      const m = getCached(`ncc_cache_meta_${userId}`);
      if (m) setMeta(m);
    }
  }, [authUid, userId, cadets, meta]);

  // Prefetch History section for markers
  useEffect(() => {
    if (who === 'marker' && router?.prefetch) {
      router.prefetch('/dashboard/marker/history');
    }
  }, [who, router]);

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
    userInteracted.current = true;
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
        const r = await fetch('/api/attendance/upload-photo', { method: 'POST', headers: { ...tabHeaders() }, body: fd });
        const j = await r.json().catch(() => ({}));
        if (r.ok) urls.push(j.url);
        setPhotos(p => p.map(x => x.key === ph.key ? (r.ok ? { ...x, status: 'ok', url: j.url } : { ...x, status: 'err', err: j.error }) : x));
        if (!r.ok) toast(j.error || 'Photo upload failed', 'err');
      } catch { setPhotos(p => p.map(x => x.key === ph.key ? { ...x, status: 'pending' } : x)); }
    }
    return urls;
  }
  const removePhoto = key => {
    userInteracted.current = true;
    setPhotos(p => p.filter(x => x.key !== key));
  };
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

    try {
      if (!navigator.onLine) {
        toast('No connection. Your attendance was NOT submitted. Check your internet and press Submit again.', 'err');
        return;
      }
      const urls = photos.filter(p => p.url).map(p => p.url);
      const todo = photos.filter(p => !p.url);
      if (todo.length) {
        try {
          urls.push(...await uploadPending(todo));
        } catch {
          toast('No connection. Your attendance was NOT submitted. Check your internet and press Submit again.', 'err');
          return;
        }
      }
      if (photosRequired && !urls.length) { toast('Photo upload failed — check your connection and try again.', 'err'); return; }
      const r = await api('/api/attendance', {
        method: 'POST',
        body: {
          ...base,
          ...geoPayload,
          photo_urls: urls,
          ...(resubmitOf ? { resubmit_of: resubmitOf } : {})
        }
      });
      if (r.network) {
        toast('No connection. Your attendance was NOT submitted. Check your internet and press Submit again.', 'err');
        return;
      }
      if (!r.ok) { toast(r.error, 'err'); if (r.status === 409) loadExisting(); return; }

      // Clear draft on successful submit
      if (userId) {
        try { sessionStorage.removeItem(`ncc_draft_${userId}`); } catch {}
      }
      setDraftBanner(false);

      setDone({ ...r.data });
      loadExisting();
    } catch {
      toast('No connection. Your attendance was NOT submitted. Check your internet and press Submit again.', 'err');
    } finally { setBusy(false); }
  }

  function reset() {
    setResubmitOf(null); setRejectionBanner(null); setDone(null); setMarks({}); setPhotos([]); setYears([]); setDesc(''); setFilter('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ═══ result screen ═══
  if (done) return (
    <div className="card center" style={{ padding: 28, maxWidth: 520, margin: '20px auto' }}>
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
        <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'var(--accent-tint)', color: 'var(--accent)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="clipboard-check" size={24} />
        </div>
      </div>
      <h2 className="h2 mt-s" style={{ fontSize: 20 }}>Sent for approval</h2>
      <p className="muted mt-s">{done.present} present · {done.absent} absent. It is locked now and <b>waiting for approval from {done.waitingFor?.join(' and ') || 'the Admin and the CTO'}</b>.</p>
      <p className="muted small mt-s">Only after {done.waitingFor?.length === 1 ? 'that approval' : 'both approve'} is it saved to the records{done.isHistorical ? '' : ', the parade report is e-mailed to Sir and absentees are notified'}.</p>
      <div className="row wrap mt" style={{ justifyContent: 'center' }}>
        <button className="btn btn-primary" onClick={reset}>Mark another group</button>
        <button className="btn" onClick={goHistory}>{who === 'marker' ? 'View status' : 'Open approvals'}</button>
      </div>
    </div>
  );

  const err = problem();
  const yBtn = (y) => (
    <button
      key={y}
      className={`chip${years.includes(y) ? ' on' : ''}`}
      onClick={() => {
        userInteracted.current = true;
        setYears(s => s.includes(y) ? s.filter(x => x !== y) : [...s, y].sort());
      }}
    >
      Year {y} <span style={{ opacity: .7 }}>· {counts[y]}</span>
    </button>
  );
  const presets = [['All years', [1, 2, 3]], ['1 & 2', [1, 2]], ['2 & 3', [2, 3]], ['1 & 3', [1, 3]]];
  const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

  return (
    <div className="stack">
      {draftBanner && (
        <div className="banner info mb row between wrap" style={{ alignItems: 'center' }}>
          <div className="grow">
            Draft restored from your earlier session. Check it before submitting.
          </div>
          <button type="button" className="btn btn-sm" onClick={discardDraft}>
            Discard draft
          </button>
        </div>
      )}

      {rejectionBanner && (
        <div className="banner bad mb row between wrap" style={{ alignItems: 'center' }}>
          <div className="grow">
            Rejected by {rejectionBanner.byName} ({rejectionBanner.side}): &apos;{rejectionBanner.reason}&apos;. Correct what is needed and submit again.
          </div>
          <button type="button" className="btn btn-sm" onClick={startFresh}>
            Start fresh
          </button>
        </div>
      )}

      {/* 1 · when & what */}
      <div className="card col" style={{ gap: 14 }}>
        <div className="eyebrow">1 · Parade details</div>
        <div className="grid g2">
          <div className="field">
            <label htmlFor="d">Date</label>
            <input
              id="d"
              type="date"
              className="input"
              value={date}
              max={today}
              onChange={e => {
                if (e.target.value) {
                  userInteracted.current = true;
                  setDate(e.target.value);
                }
              }}
            />
            <span className="hint">{fmtDateLong(date)}{!live ? ' · past date — location & photo optional' : meta?.requirePhotos === false ? ' · photo optional (emergency mode)' : ''}</span>
          </div>
          <div className="field">
            <label>Activity</label>
            <div className="row wrap gap-s">
              {ACTIVITIES.map(a => (
                <button
                  key={a}
                  className={`chip${activity === a ? ' on' : ''}`}
                  onClick={() => {
                    userInteracted.current = true;
                    setActivity(a);
                  }}
                >
                  {a}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="field">
          <label htmlFor="ds">Description {activity === 'Others' ? '(required)' : '(optional)'}</label>
          <input
            id="ds"
            className="input"
            maxLength={120}
            value={desc}
            onChange={e => {
              userInteracted.current = true;
              setDesc(e.target.value);
            }}
            placeholder="e.g. Drill practice, Republic Day rehearsal"
          />
        </div>
      </div>

      {/* 2 · who */}
      <div className="card col" style={{ gap: 12 }}>
        <div className="row between wrap"><div className="eyebrow">2 · Who is on parade?</div><span className="badge b-blue">{groupLabel(years)}</span></div>
        <div className="row wrap gap-s">{[1, 2, 3].map(yBtn)}</div>
        <div className="row wrap gap-s"><span className="small muted">Quick pick:</span>
          {presets.map(([l, v]) => (
            <button
              key={l}
              className={`chip${same(years, v) ? ' on' : ''}`}
              style={{ minHeight: 32, padding: '4px 12px', fontSize: 13 }}
              onClick={() => {
                userInteracted.current = true;
                setYears(v);
              }}
            >
              {l}
            </button>
          ))}
          <button
            className="chip"
            style={{ minHeight: 32, padding: '4px 12px', fontSize: 13 }}
            onClick={() => {
              userInteracted.current = true;
              setYears([]);
            }}
          >
            Clear
          </button>
        </div>
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
          <div className="row wrap mb">
            <input className="input grow" style={{ minWidth: 180 }} placeholder="Filter by name or reg. no…" value={filter} onChange={e => setFilter(e.target.value)} />
            <button
              className="btn btn-sm"
              onClick={() => {
                userInteracted.current = true;
                setMarks({});
              }}
              disabled={!absentees.length}
            >
              Reset all to present
            </button>
          </div>
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
          <div className="grow">
            <div className="bold small">{editable.length} cadets · <span style={{ color: 'var(--success)' }}>{presentN} P</span> · <span style={{ color: 'var(--danger)' }}>{absentees.length} A</span></div>
            <div className="tiny muted ellipsis">{!isOnline ? 'You are offline.' : (err || 'Ready to submit')}</div>
          </div>
          <button
            className="btn btn-primary btn-lg"
            disabled={!isOnline || !!err || busy}
            onClick={() => setConfirmOpen(true)}
          >
            {busy ? <><Spinner /> Submitting…</> : 'Submit'}
          </button>
        </div>
      )}

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
