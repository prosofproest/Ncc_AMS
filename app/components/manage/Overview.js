'use client';
import { useRealtimeData } from '@/lib/useRealtimeData';
import { Skeleton, Stat, Empty, PctBadge, barClass } from '@/app/components/ui';
import { fmtDate } from '@/lib/time';

export default function Overview({ goTab }) {
  const { data, loading } = useRealtimeData('/api/overview', 25000);
  if (loading && !data) return <Skeleton n={4} h={100} />;
  if (!data) return <div className="card"><Empty icon="alert-triangle">Could not load the overview.</Empty></div>;
  const { totals, yearAvg, cadets, sessions, threshold: th, cycleLabel } = data;
  const low = cadets.filter(c => c.pct !== null && c.pct < th).sort((a, b) => a.pct - b.pct);
  return (
    <div className="stack">
      <div className="eyebrow">Cycle {cycleLabel} · required {th}%</div>
      <div className="grid g4">
        <Stat value={totals.cadets} label="Cadets" /><Stat value={totals.sessions} label="Parades" color="var(--blue)" />
        <Stat value={`${totals.avg}%`} label="Average" color={totals.avg >= th ? 'var(--green)' : 'var(--red)'} /><Stat value={totals.below} label={`Below ${th}%`} color={totals.below ? 'var(--red)' : 'var(--green)'} />
      </div>
      <div className="grid g2">
        <div className="card"><h2 className="h2 mb">Year-wise average</h2>
          {yearAvg.map(y => (<div key={y.year} className="mb"><div className="row between small"><b>Year {y.year}</b><span className="muted">{y.cadets} cadets · {y.avg === null ? 'no data' : `${y.avg}%`}</span></div>
            <div className={`bar ${y.avg === null ? '' : barClass(y.avg, th)} mt-s`}><i style={{ width: `${y.avg || 0}%` }} /></div></div>))}
        </div>
        <div className="card"><div className="row between mb"><h2 className="h2">Below {th}%</h2><span className="badge b-red">{low.length}</span></div>
          {!low.length ? <Empty icon="award">Every cadet meets the requirement.</Empty> : low.slice(0, 8).map(c => (
            <div key={c.id} className="item"><div className="grow"><div className="name ellipsis">{c.name}</div><div className="sub">{c.regNo || 'No Reg No.'} · Year {c.year} · {c.present}/{c.total}</div></div><PctBadge pct={c.pct} threshold={th} /></div>))}
          {low.length > 8 && <button className="btn btn-sm btn-block mt-s" onClick={() => goTab('reports')}>See all in reports</button>}
        </div>
      </div>
      <div className="card"><div className="row between mb"><h2 className="h2">Recent parades</h2><button className="btn btn-sm" onClick={() => goTab('attendance')}>All</button></div>
        {!sessions.length ? <Empty icon="calendar">No parades yet this cycle.</Empty> : <div className="grid g2">{sessions.slice(0, 6).map(s => (
          <div key={s.id} className="item" style={{ margin: 0 }}><div className="grow"><div className="name">{fmtDate(s.date)} · {s.activityType}</div><div className="sub">{s.groupLabel} · {s.present}P / {s.absent}A</div></div><PctBadge pct={s.total ? Math.round(s.present / s.total * 100) : 0} threshold={th} /></div>))}</div>}
      </div>
    </div>
  );
}
