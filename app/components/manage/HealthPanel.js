'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { api, useUI, Spinner } from '@/app/components/ui';
import Icon from '@/app/components/Icon';
import { fmtDateTimeIST } from '@/lib/time';

const verdict = ms => (ms == null ? ['—', 'b-gray'] : ms < 300 ? ['Fast', 'b-green'] : ms < 900 ? ['OK', 'b-amber'] : ['Slow', 'b-red']);
const ago = iso => { const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000)); return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago`; };

export default function HealthPanel() {
  const { toast } = useUI();
  const [live, setLive] = useState([]);            // rolling latency samples
  const [last, setLast] = useState(null);
  const [full, setFull] = useState(null); const [checking, setChecking] = useState(false);
  const [events, setEvents] = useState([]);
  const alive = useRef(true);

  // Live probe every 5 s: browser -> server round trip + server -> database read/write
  const probe = useCallback(async () => {
    const t0 = performance.now();
    const ping = await api('/api/ping');
    const rtt = Math.round(performance.now() - t0);
    const h = await api('/api/health?mode=quick');
    if (!alive.current) return;
    if (!ping.ok || !h.ok) { setLive(l => [...l.slice(-29), { rtt: null, db: null, ok: false }]); setLast({ ok: false, error: h.error || ping.error }); return; }
    const total = Math.round(performance.now() - t0);
    setLive(l => [...l.slice(-29), { rtt, db: h.data.database.readMs, write: h.data.database.writeMs, ok: h.data.database.ok, total }]);
    setLast({ ok: h.data.database.ok, rtt, read: h.data.database.readMs, write: h.data.database.writeMs, at: new Date().toISOString(), msg: h.data.database.message });
    setEvents(h.data.events || []);
  }, []);
  const check = useCallback(async () => {
    setChecking(true); const r = await api('/api/health?mode=full'); setChecking(false);
    if (r.ok) { setFull(r.data); setEvents(r.data.events); } else toast(r.error, 'err');
  }, [toast]);

  useEffect(() => { alive.current = true; probe(); check(); const a = setInterval(probe, 5000), b = setInterval(check, 60000); return () => { alive.current = false; clearInterval(a); clearInterval(b); }; }, [probe, check]);

  const svc = full?.services ? Object.entries(full.services) : [];
  const bad = svc.filter(([, v]) => !v.ok);
  const allOk = full && bad.length === 0 && last?.ok;
  const max = Math.max(200, ...live.map(s => s.total || 0));
  const avg = k => { const v = live.map(s => s[k]).filter(x => x != null); return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null; };

  return (
    <div className="stack">
      <div className={`banner ${!full ? 'info' : allOk ? 'good' : 'bad'}`} style={{ fontSize: 16 }}>
        {!full ? <><Spinner /> Running the first check…</> : allOk ? <><span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon name="check-circle" size={16} /> Everything is working</span>{full.activity.failures ? ` — ${full.activity.failures} background task(s) failed in the last 24 h (see activity below)` : ''}.</> : <><span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon name="alert-triangle" size={16} /> {bad.length ? `${bad.map(([, v]) => v.label).join(', ')} need attention.` : 'The connection to the server is failing.'}</span></>}
        <button className="btn btn-sm right" onClick={() => { probe(); check(); }} disabled={checking}>{checking ? <Spinner /> : 'Run full check'}</button>
      </div>

      <div className="card">
        <div className="row between wrap mb"><div><div className="eyebrow">Live speed · updates every 5 seconds</div><div className="row gap-s mt-s"><span className={`dot ${last?.ok ? 'g' : 'r'}`} /><b>{last?.ok ? 'Server responding' : 'No response'}</b></div></div>
          {last?.ok && <span className={`badge ${verdict(last.rtt)[1]}`}>{verdict(last.rtt)[0]}</span>}</div>
        <div className="grid g4">
          <div className="card tight center"><b style={{ fontSize: 24 }}>{last?.rtt ?? '—'}<small className="muted"> ms</small></b><div className="tiny muted">Your device -&gt; server</div></div>
          <div className="card tight center"><b style={{ fontSize: 24 }}>{last?.read ?? '—'}<small className="muted"> ms</small></b><div className="tiny muted">Database read</div></div>
          <div className="card tight center"><b style={{ fontSize: 24 }}>{last?.write ?? '—'}<small className="muted"> ms</small></b><div className="tiny muted">Database write</div></div>
          <div className="card tight center"><b style={{ fontSize: 24 }}>{avg('rtt') ?? '—'}<small className="muted"> ms</small></b><div className="tiny muted">Average (last {live.length})</div></div>
        </div>
        <div className="spark mt" aria-label="Latency history">{live.map((s, i) => <i key={i} style={{ height: `${Math.max(6, ((s.total || 0) / max) * 100)}%`, background: s.ok ? undefined : 'var(--red)' }} title={s.total ? `${s.total} ms` : 'failed'} />)}</div>
        <p className="hint mt-s">If “Your device -&gt; server” is high but the database is fast, the slowness is the phone’s network. If the database is slow, check that Vercel and Firebase are in the same region (Mumbai).</p>
      </div>

      <div className="grid g2">{svc.map(([k, v]) => { const [vt, vc] = verdict(v.ms); return (
        <div key={k} className="item" style={{ margin: 0, alignItems: 'flex-start' }}><span className={`dot ${v.ok ? 'g' : 'r'}`} style={{ marginTop: 6 }} />
          <div className="grow"><div className="name">{v.label}</div><div className="sub" style={{ whiteSpace: 'normal', color: v.ok ? undefined : 'var(--red)' }}>{v.message || (v.ok ? 'OK' : 'Problem')}</div></div>
          {v.ms != null && k !== 'env' && <span className={`badge ${vc}`}>{v.ms} ms</span>}</div>); })}</div>

      {full && (
        <div className="card"><h2 className="h2 mb">Background activity · last 24 hours</h2>
          <div className="grid g4">{Object.entries(full.activity.counts).map(([k, v]) => (
            <div key={k} className="card tight center"><div className="eyebrow">{({ sheets: 'Sheet syncs', email: 'Emails', mail: 'Emails', cron: 'Scheduled jobs', photo: 'Photo uploads' })[k] || k}</div><b style={{ fontSize: 22, color: v.failed ? 'var(--red)' : 'var(--green)' }}>{v.ok}<small className="muted"> ok</small>{v.failed ? <small style={{ color: 'var(--red)' }}> · {v.failed} failed</small> : null}</b></div>))}</div>
          <div className="row wrap gap-s mt">
            {full.activity.avgMs.sheets != null && <span className="badge b-blue">Sheet sync avg {full.activity.avgMs.sheets} ms</span>}
            {full.activity.avgMs.email != null && <span className="badge b-blue">Email avg {full.activity.avgMs.email} ms</span>}
            {Object.entries(full.activity.crons).map(([k, v]) => <span key={k} className={`badge ${v ? (v.ok ? 'b-green' : 'b-red') : 'b-gray'}`}>{k}: {v ? ago(v.at) : 'not run yet'}</span>)}</div>
        </div>)}

      <div className="card"><h2 className="h2 mb">Recent events</h2>
        {!events.length ? <p className="muted small">Nothing yet — events appear when attendance is submitted, mails are sent and sheets sync.</p> : events.slice(0, 30).map(e => (
          <div key={e.id} className="row" style={{ padding: '7px 0', borderBottom: '1px solid var(--line)', alignItems: 'flex-start' }}><span className={`dot ${e.ok ? 'g' : 'r'}`} style={{ marginTop: 6 }} />
            <div className="grow"><div className="small"><b>{e.type}</b> {e.ms != null && <span className="muted">· {e.ms} ms</span>}</div><div className="tiny muted" style={{ whiteSpace: 'normal', color: e.ok ? undefined : 'var(--red)' }}>{e.message}</div></div><span className="tiny muted" title={fmtDateTimeIST(e.at)}>{ago(e.at)}</span></div>))}
      </div>
    </div>
  );
}
