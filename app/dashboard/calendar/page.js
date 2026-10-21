'use client';
import { useState, useMemo } from 'react';
import Link from 'next/link';
import { useRealtimeData } from '@/lib/useRealtimeData';
import { Modal, Skeleton, Empty } from '@/app/components/ui';
import { Icon } from '@/app/components/Icon';
import { useUser, hasPerm } from '@/app/components/user';
import { todayIST, fmtDateLong } from '@/lib/time';
import PageHeader from '@/app/components/shell/PageHeader';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export default function CalendarPage() {
  const user = useUser();
  const canSee = ['canMarkAttendance', 'canViewAllAttendance', 'canEditAttendance'].some(p => hasPerm(user, p));
  const { data, loading } = useRealtimeData(canSee ? '/api/attendance?history=1&cycle=all' : '/api/attendance?my=1&cycle=all', 60000);
  const today = todayIST();
  const [ym, setYm] = useState({ y: +today.slice(0, 4), m: +today.slice(5, 7) });
  const [pick, setPick] = useState(null);

  // date -> list of { title, sub, pct }
  const byDate = useMemo(() => {
    const map = {};
    if (canSee) (data?.sessions || []).forEach(s => { (map[s.date] ||= []).push({ title: `${s.activityType} · ${s.groupLabel}`, sub: `${s.present}/${s.total} present`, pct: s.total ? Math.round(s.present / s.total * 100) : 0 }); });
    else (data?.records || []).forEach(r => { (map[r.date] ||= []).push({ title: `${r.activityType}${r.activityDescription ? ' — ' + r.activityDescription : ''}`, sub: r.status === 'Absent' ? `Absent — ${r.reason || 'no reason'}` : 'Present', pct: r.status === 'Present' ? 100 : 0 }); });
    return map;
  }, [data, canSee]);

  const first = new Date(Date.UTC(ym.y, ym.m - 1, 1)); const days = new Date(Date.UTC(ym.y, ym.m, 0)).getUTCDate();
  const lead = (first.getUTCDay() + 6) % 7;                       // week starts Monday
  const cells = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  const key = d => `${ym.y}-${String(ym.m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const shift = n => setYm(({ y, m }) => { const t = new Date(Date.UTC(y, m - 1 + n, 1)); return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1 }; });
  const tone = p => (p >= 75 ? 'var(--green)' : p >= 60 ? 'var(--amber)' : 'var(--red)');

  return (
    <div className="stack">
      <PageHeader
        title="Calendar"
        description={canSee ? 'All unit parades and attendance' : 'My parade attendance and duty schedule'}
      />
      {loading && !data ? <Skeleton h={340} /> : (
        <div className="card">
          <div className="row between mb">
            <button className="btn btn-icon btn-sm" onClick={() => shift(-1)} aria-label="Previous month">
              <Icon name="chevron-left" size={16} />
            </button>
            <h2 className="h2">{MONTHS[ym.m - 1]} {ym.y}</h2>
            <button className="btn btn-icon btn-sm" onClick={() => shift(1)} aria-label="Next month">
              <Icon name="chevron-right" size={16} />
            </button>
          </div>
          <div className="cal">{['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => <div key={i} className="h">{d}</div>)}
            {cells.map((d, i) => { if (!d) return <div key={i} />; const k = key(d), ev = byDate[k]; const avg = ev ? Math.round(ev.reduce((n, e) => n + e.pct, 0) / ev.length) : null;
              return <button key={i} className={`d${ev ? ' has' : ''}${k === today ? ' today' : ''}`} style={{ font: 'inherit', color: 'inherit' }} disabled={!ev} onClick={() => setPick(k)}>{d}{ev && <i style={{ background: tone(avg) }} />}</button>; })}
          </div>
          <div className="row wrap gap-s mt tiny muted"><span className="dot g" /> 75%+ <span className="dot a" /> 60–74% <span className="dot r" /> below 60%</div>
        </div>)}
      {!loading && !Object.keys(byDate).length && <div className="card"><Empty icon="calendar">No parades recorded yet.</Empty></div>}
      <Modal open={!!pick} onClose={() => setPick(null)} title={pick ? fmtDateLong(pick) : ''}>
        {(byDate[pick] || []).map((e, i) => <div key={i} className="item"><div className="grow"><div className="name">{e.title}</div><div className="sub">{e.sub}</div></div><span className={`badge ${e.pct >= 75 ? 'b-green' : e.pct >= 60 ? 'b-amber' : 'b-red'}`}>{e.pct}%</span></div>)}
      </Modal>
    </div>
  );
}
