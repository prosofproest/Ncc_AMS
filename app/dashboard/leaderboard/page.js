'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRealtimeData } from '@/lib/useRealtimeData';
import { Skeleton, Empty, barClass } from '@/app/components/ui';
import { Icon } from '@/app/components/Icon';
import { useUser } from '@/app/components/user';

import PageHeader from '@/app/components/shell/PageHeader';

export default function Leaderboard() {
  const user = useUser(); const [year, setYear] = useState(0);
  const { data, loading } = useRealtimeData(`/api/leaderboard${year ? `?year=${year}` : ''}`, 60000);
  const list = data?.leaderboard || [];

  return (
    <div className="stack">
      <PageHeader
        title="Leaderboard"
        description="Cadet attendance rankings and parade standings"
      />
      <div className="seg">{[[0, 'All'], [1, 'Year 1'], [2, 'Year 2'], [3, 'Year 3']].map(([v, l]) => <button key={v} className={year === v ? 'on' : ''} onClick={() => setYear(v)}>{l}</button>)}</div>
      {loading && !data ? <Skeleton n={6} h={66} /> : !list.length ? <div className="card"><Empty icon="trophy">The leaderboard appears after a few parades (minimum 3 per cadet).</Empty></div> : (
        <div className="stack">{list.map((c, i) => (
          <div key={c.id} className="item" style={c.id === user.id ? { outline: '2px solid var(--accent)' } : undefined}>
            <div style={{ width: 32, textAlign: 'center', fontSize: 14, fontWeight: 600, color: i < 3 ? 'var(--accent)' : 'var(--dim)' }}>#{i + 1}</div>
            <div className="grow"><div className="name ellipsis">{c.name}{c.id === user.id && <span className="badge b-blue" style={{ marginLeft: 8 }}>You</span>}</div>
              <div className="sub">Year {c.year} · {c.type} · {c.present}/{c.total} parades</div>
              <div className={`bar ${barClass(c.pct)} mt-s`}><i style={{ width: `${c.pct}%` }} /></div></div>
            <b style={{ fontSize: 16 }}>{c.pct}%</b></div>))}</div>)}
    </div>
  );
}
