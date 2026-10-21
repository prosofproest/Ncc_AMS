'use client';
import Link from 'next/link';
import { useRealtimeData } from '@/lib/useRealtimeData';
import { download, useUI, Skeleton, Empty, Ring, Stat } from '@/app/components/ui';
import { Icon } from '@/app/components/Icon';
import { useUser } from '@/app/components/user';
import { fmtDate } from '@/lib/time';
import PageHeader from '@/app/components/shell/PageHeader';

export default function CadetPage() {
  const user = useUser(); const { toast } = useUI();
  const { data, loading } = useRealtimeData('/api/attendance?my=1', 30000);
  if (loading && !data) return <Skeleton n={4} h={110} />;
  if (!data) return <div className="card"><Empty icon="alert-triangle">Could not load your attendance. Pull down to retry.</Empty></div>;

  const { total, present, absent, benefit, percentage: pct, threshold: th, records, cycleLabel } = data;
  // parades needed in a row to climb back to the required percentage
  const need = pct >= th || th >= 100 ? 0 : Math.max(0, Math.ceil((th * total - 100 * (present + benefit)) / (100 - th)));
  const pdf = async () => { const r = await download(`/api/reports?type=cadet&cadetId=${user.id}&format=pdf`); if (!r.ok) toast(r.error, 'err'); };

  return (
    <div className="stack">
      <PageHeader
        title={user.name}
        description={`My attendance · Cycle ${cycleLabel || ''} · ${user.regNo || 'No Reg No.'}`}
        actions={
          <button className="btn btn-primary" onClick={pdf}>
            <Icon name="download" size={16} /> Download My report (PDF)
          </button>
        }
      />

      <div className="card center" style={{ padding: 24 }}>
        <Ring pct={pct} threshold={th} />
        <div className="mt bold" style={{ fontSize: 16 }}>{total === 0 ? 'No parades recorded yet' : pct >= th ? 'Great — you are above the required attendance' : 'Below the required attendance'}</div>
        <div className="muted small mt-s">Required: {th}%</div>
        {need > 0 && (
          <div className="banner warn mt" style={{ justifyContent: 'center' }}>
            <Icon name="alert-triangle" size={16} /> Attend the next {need} parade{need > 1 ? 's' : ''} in a row to reach {th}%.
          </div>
        )}
      </div>

      <div className="grid g4">
        <Stat value={total} label="Parades" />
        <Stat value={present} label="Present" color="var(--success)" />
        <Stat value={absent} label="Absent" color="var(--danger)" />
        <Stat value={benefit} label="Benefit credits" color="var(--accent)" />
      </div>

      <div className="card">
        <div className="row between mb">
          <h2 className="h2">Record</h2>
          <div className="row gap-s">
            <Link href="/dashboard/leaderboard" className="btn btn-sm">
              <Icon name="trophy" size={14} /> Leaderboard
            </Link>
            <Link href="/dashboard/calendar" className="btn btn-sm">
              <Icon name="calendar" size={14} /> Calendar
            </Link>
          </div>
        </div>
        {!records.length ? (
          <Empty icon="calendar">Your attendance will appear here after the first parade.</Empty>
        ) : records.map(r => (
          <div key={r.id} className={`item${r.status === 'Absent' ? ' absent' : ''}`}>
            <div className="grow"><div className="name">{fmtDate(r.date)} · {r.activityType}</div><div className="sub">{r.status === 'Absent' ? `Reason: ${r.reason || 'Not specified'}` : r.activityDescription || 'Present'}</div></div>
            <span className={`badge ${r.status === 'Present' ? 'b-green' : 'b-red'}`}>{r.status}</span></div>))}
      </div>
    </div>
  );
}
