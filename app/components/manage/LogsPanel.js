'use client';
import { useRealtimeData } from '@/lib/useRealtimeData';
import { Skeleton, Empty } from '@/app/components/ui';
import { fmtDateTimeIST, fmtDate } from '@/lib/time';

const KIND = { submit: ['Submitted', 'b-blue'], resubmit: ['Resubmitted', 'b-blue'], approve: ['Approved', 'b-green'], reject: ['Rejected', 'b-red'], return: ['Returned to Administrator', 'b-amber'], 'pending-edit': ['Edited (pending)', 'b-amber'], create: ['Saved', 'b-green'], edit: ['Edited', 'b-amber'], delete: ['Deleted', 'b-red'], 'delete-rejected': ['Deleted (rejected)', 'b-red'], benefit: ['Benefit', 'b-blue'], 'benefit-remove': ['Benefit removed', 'b-red'], promotion: ['Promotion', 'b-blue'] };

export default function LogsPanel() {
  const { data, loading } = useRealtimeData('/api/attendance/audit', 30000);
  if (loading && !data) return <Skeleton n={5} h={80} />;
  const logs = data?.logs || [];
  if (!logs.length) return <div className="card"><Empty icon="history">No activity logged yet.</Empty></div>;
  return (
    <div className="stack">
      <p className="muted small">Every submission, edit, deletion, benefit and promotion — who did it and when. Edits are also emailed to Sir and the backup address.</p>
      {logs.map(l => { const [t, c] = KIND[l.type] || [l.type, 'b-gray']; return (
        <div key={l.id} className="card tight">
          <div className="row between wrap"><div className="row gap-s wrap"><span className={`badge ${c}`}>{t}</span><b>{l.byName}</b>{l.date && <span className="muted small">· parade {fmtDate(l.date)}{l.activityType ? ` · ${l.activityType}` : ''}{l.groupLabel ? ` · ${l.groupLabel}` : ''}</span>}</div><span className="muted small">{fmtDateTimeIST(l.at)}</span></div>
          {l.note && <div className="small muted mt-s">“{l.note}”</div>}
          {l.changes?.length > 0 && <div className="mt-s">{l.changes.slice(0, 6).map((x, i) => <div key={i} className="small" style={{ padding: '3px 0' }}><b>{x.name}</b> <span className="muted">{x.regNo}</span> — {x.from} -&gt; <b>{x.to}</b>{x.reason ? <span className="muted"> ({x.reason})</span> : ''}</div>)}{l.changes.length > 6 && <div className="tiny muted">+{l.changes.length - 6} more</div>}</div>}
        </div>); })}
    </div>
  );
}
