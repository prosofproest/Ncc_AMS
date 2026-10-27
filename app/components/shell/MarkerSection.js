'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useRealtimeData } from '@/lib/useRealtimeData';
import { api, download, useUI, Modal, Skeleton, Empty, PctBadge } from '@/app/components/ui';
import { Icon } from '@/app/components/Icon';
import MarkAttendance from '@/app/components/MarkAttendance';
import PageHeader from './PageHeader';
import { fmtDate } from '@/lib/time';

export default function MarkerSection({ section }) {
  const router = useRouter();
  const sec = String(section || '').toLowerCase();
  const [activeSec, setActiveSec] = useState(sec);

  useEffect(() => {
    setActiveSec(sec);
  }, [sec]);

  const currentSec = activeSec;

  useEffect(() => {
    if (currentSec !== 'mark' && currentSec !== 'history') {
      router.replace('/dashboard/marker/mark');
    }
  }, [currentSec, router]);

  if (currentSec !== 'mark' && currentSec !== 'history') {
    return null;
  }

  return (
    <>
      <PageHeader
        title={currentSec === 'mark' ? 'Mark attendance' : 'History & status'}
        description={currentSec === 'mark' ? 'Take live or historical parade attendance for cadets' : 'Track your submitted attendance sessions and view past parade records'}
      />
      {currentSec === 'mark' ? (
        <MarkAttendance
          goHistory={() => {
            setActiveSec('history');
            router.push('/dashboard/marker/history');
          }}
          who="marker"
        />
      ) : (
        <History
          onMark={() => {
            setActiveSec('mark');
            router.push('/dashboard/marker/mark');
          }}
        />
      )}
    </>
  );
}

function Stage({ s }) {
  if (s.state === 'rejected') return <span className="badge b-red">Rejected</span>;
  const a = s.approvals || {};
  return (
    <span className="row gap-s wrap">
      <span className={`badge ${a.admin ? 'b-green' : 'b-amber'}`}>{a.admin ? 'Approved' : 'Awaiting'} Admin</span>
      <span className={`badge ${a.cto ? 'b-green' : 'b-amber'}`}>{a.cto ? 'Approved' : 'Awaiting'} CTO</span>
    </span>
  );
}

function History({ onMark }) {
  const router = useRouter();
  const { toast } = useUI();
  const { data, loading } = useRealtimeData('/api/attendance?history=1', 10000);
  const { data: mine } = useRealtimeData('/api/approvals?mine=1', 8000);
  const [open, setOpen] = useState(null);
  const [detail, setDetail] = useState(null);
  const sessions = data?.sessions;
  const waiting = mine?.submissions || [];
  async function view(s) {
    setOpen(s);
    setDetail(null);
    const r = await api(`/api/attendance?sessionId=${s.id}`);
    if (r.ok) setDetail(r.data);
    else toast(r.error, 'err');
  }
  async function pdf(s) {
    const r = await download(`/api/reports?type=day&date=${s.date}&format=pdf`);
    if (!r.ok) toast(r.error, 'err');
  }

  return (
    <div className="stack">
      {waiting.length > 0 && (
        <div className="card">
          <div className="row between mb">
            <h2 className="h2">My submissions</h2>
            <span className="badge b-amber">{waiting.filter(w => w.state !== 'rejected').length} waiting</span>
          </div>
          {waiting.map(w => (
            <div key={w.id} className={`item${w.state === 'rejected' ? ' absent' : ''}`} style={{ flexWrap: 'wrap' }}>
              <div className="grow">
                <div className="name">{fmtDate(w.date)} · {w.activityType} · {w.groupLabel}</div>
                <div className="sub">{w.present} present · {w.absent} absent</div>
                {w.state === 'rejected' && (
                  <div className="small mt-s" style={{ color: 'var(--danger)' }}>
                    Rejected by {w.rejection?.byName} ({w.rejection?.side === 'cto' ? 'CTO' : 'Admin'}): "{w.rejection?.reason}" — please mark it again correctly.
                  </div>
                )}
              </div>
              <div className="row gap-s wrap" style={{ alignItems: 'center' }}>
                {w.state === 'rejected' && (
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() => {
                      sessionStorage.setItem('ncc_resubmit', w.id);
                      if (onMark) onMark();
                      else router.push('/dashboard/marker/mark');
                    }}
                  >
                    Correct and resubmit
                  </button>
                )}
                <Stage s={w} />
              </div>
            </div>
          ))}
        </div>
      )}

      {loading && !sessions ? (
        <Skeleton n={5} h={78} />
      ) : !sessions?.length ? (
        <div className="card"><Empty icon="history">No approved attendance yet.</Empty></div>
      ) : (
        <div>
          <h2 className="h2 mb">Approved &amp; saved</h2>
          <div className="grid g2">
            {sessions.map(s => {
              const pct = s.total ? Math.round(s.present / s.total * 100) : 0;
              return (
                <button
                  key={s.id}
                  type="button"
                  className="item"
                  style={{ textAlign: 'left', cursor: 'pointer', border: '1px solid var(--edge)', width: '100%', margin: 0 }}
                  onClick={() => view(s)}
                >
                  <div className="grow">
                    <div className="name">{fmtDate(s.date)} · {s.activityType}</div>
                    <div className="sub">{s.groupLabel} · by {s.markedByName}</div>
                    <div className="row gap-s mt-s">
                      <span className="badge b-green">{s.present} P</span>
                      <span className="badge b-red">{s.absent} A</span>
                      <span className="badge b-green">Approved</span>
                    </div>
                  </div>
                  <PctBadge pct={pct} />
                </button>
              );
            })}
          </div>
        </div>
      )}

      <Modal
        open={!!open}
        onClose={() => setOpen(null)}
        title={open ? `${fmtDate(open.date)} · ${open.activityType}` : ''}
        wide
        footer={open && (
          <button type="button" className="btn btn-primary" onClick={() => pdf(open)}>
            <Icon name="download" size={16} /> Download Parade report (PDF)
          </button>
        )}
      >
        {!open ? null : !detail ? (
          <Skeleton n={4} h={52} />
        ) : (
          <div>
            <div className="row wrap mb">
              <span className="badge b-blue">{open.groupLabel}</span>
              <span className="badge b-green">{open.present} present</span>
              <span className="badge b-red">{open.absent} absent</span>
              {open.approvals?.admin && <span className="badge b-gray">Admin: {open.approvals.admin.byName}</span>}
              {open.approvals?.cto && <span className="badge b-gray">CTO: {open.approvals.cto.byName}</span>}
            </div>
            {[...detail.records]
              .sort((a, b) => (a.status === b.status ? 0 : a.status === 'Absent' ? -1 : 1))
              .map(r => (
                <div key={r.id} className={`item${r.status === 'Absent' ? ' absent' : ''}`}>
                  <div className="grow">
                    <div className="name">{r.cadetName}</div>
                    <div className="sub">
                      {r.cadetRegNo || 'No Reg No.'}
                      {r.status === 'Absent' ? ` · ${r.reason || 'No reason'}` : ''}
                    </div>
                  </div>
                  <span className={`badge ${r.status === 'Present' ? 'b-green' : 'b-red'}`}>{r.status}</span>
                </div>
              ))}
          </div>
        )}
      </Modal>
    </div>
  );
}
