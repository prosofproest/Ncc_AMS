'use client';
import { useState, useMemo } from 'react';
import { useRealtimeData } from '@/lib/useRealtimeData';
import { api, useUI, Modal, Skeleton, Empty, Spinner, Field } from '@/app/components/ui';
import Icon from '@/app/components/Icon';
import { useUser, hasPerm } from '@/app/components/user';
import { todayIST, fmtDate } from '@/lib/time';

export default function BenefitsPanel() {
  const me = useUser(); const { toast, confirm } = useUI();
  const canManage = hasPerm(me, 'canManageBenefits');
  const { data, loading, refresh } = useRealtimeData('/api/benefits', 30000);
  const { data: cd } = useRealtimeData(canManage ? '/api/cadets' : null, 0);
  const [open, setOpen] = useState(false); const [sel, setSel] = useState(new Set()); const [q, setQ] = useState('');
  const [credits, setCredits] = useState(1); const [reason, setReason] = useState(''); const [date, setDate] = useState(todayIST()); const [saving, setSaving] = useState(false);
  const people = useMemo(() => (cd?.cadets || []).filter(c => !q.trim() || `${c.name} ${c.regNo}`.toLowerCase().includes(q.trim().toLowerCase())), [cd, q]);
  const toggle = id => setSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const pickYear = y => setSel(s => { const n = new Set(s); (cd?.cadets || []).filter(c => y === 'all' ? true : c.year === y).forEach(c => n.add(c.id)); return n; });

  async function save() {
    if (!sel.size) return toast('Select at least one cadet.', 'err');
    if (!reason.trim()) return toast('Enter the reason (e.g. "Republic Day camp").', 'err');
    setSaving(true);
    const r = await api('/api/benefits', { method: 'POST', body: { cadet_ids: [...sel], credits, reason, date } });
    setSaving(false);
    if (!r.ok) return toast(r.error, 'err');
    toast(`Benefit added for ${r.data.count} cadet(s). Sir has been emailed.`, 'ok'); setOpen(false); setSel(new Set()); setReason(''); setCredits(1); refresh();
  }
  async function remove(b) {
    if (!await confirm({ title: 'Remove this benefit?', message: `${b.cadetName} · +${b.credits} · ${b.reason}`, confirmText: 'Remove', danger: true })) return;
    const r = await api(`/api/benefits?id=${b.id}`, { method: 'DELETE' }); if (!r.ok) return toast(r.error, 'err'); toast('Removed.', 'ok'); refresh();
  }
  const list = data?.benefits || [];

  return (
    <div className="stack">
      <div className="card"><div className="row between wrap"><div><h2 className="h2">Attendance benefit</h2><p className="muted small mt-s" style={{ maxWidth: 560 }}>Bonus credit for cadets who were on official NCC duty (camps, competitions, rehearsals). Each credit counts as one extra present parade in their percentage — never above 100%. Kept separate from normal attendance and listed in its own sheet tab.</p></div>
        {canManage && <button className="btn btn-primary" onClick={() => setOpen(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon name="plus" size={16} /> Give benefit</button>}</div></div>
      {loading && !data ? <Skeleton n={3} h={64} /> : !list.length ? <div className="card"><Empty icon="award">No benefits given this cycle.</Empty></div> : (
        <div className="grid g2">{list.map(b => (
          <div key={b.id} className="item" style={{ margin: 0 }}><div className="grow"><div className="name">{b.cadetName} <span className="badge b-blue">+{b.credits}</span></div><div className="sub">{b.reason} · {fmtDate(b.date)} · by {b.addedByName}</div></div>
            {canManage && <button className="btn btn-sm btn-ghost" onClick={() => remove(b)} aria-label="Remove"><Icon name="trash" size={14} /></button>}</div>))}</div>)}

      <Modal open={open} onClose={() => setOpen(false)} wide title="Give attendance benefit" footer={<><button className="btn" onClick={() => setOpen(false)}>Cancel</button><button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? <Spinner /> : `Give to ${sel.size} cadet${sel.size === 1 ? '' : 's'}`}</button></>}>
        <div className="col" style={{ gap: 14 }}>
          <div className="grid g3">
            <Field label="Credits (parades)"><div className="row"><button className="btn btn-icon" onClick={() => setCredits(c => Math.max(1, c - 1))} aria-label="Decrease credits"><Icon name="minus" size={14} /></button><input className="input center" inputMode="numeric" value={credits} onChange={e => setCredits(Math.min(30, Math.max(1, parseInt(e.target.value, 10) || 1)))} /><button className="btn btn-icon" onClick={() => setCredits(c => Math.min(30, c + 1))} aria-label="Increase credits"><Icon name="plus" size={14} /></button></div></Field>
            <Field label="Date"><input type="date" className="input" value={date} max={todayIST()} onChange={e => setDate(e.target.value)} /></Field>
            <Field label="Reason"><input className="input" maxLength={120} value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Republic Day camp" /></Field>
          </div>
          <div><div className="row between wrap mb"><span className="lbl">Select cadets · {sel.size} chosen</span>
            <div className="row gap-s wrap">{[1, 2, 3].map(y => <button key={y} className="chip" style={{ minHeight: 32, padding: '4px 12px', fontSize: 13 }} onClick={() => pickYear(y)}>+ Year {y}</button>)}<button className="chip" style={{ minHeight: 32, padding: '4px 12px', fontSize: 13 }} onClick={() => setSel(new Set())}>Clear</button></div></div>
            <input className="input mb" placeholder="Search…" value={q} onChange={e => setQ(e.target.value)} />
            <div style={{ maxHeight: 280, overflow: 'auto' }}>{people.map(c => (
              <label key={c.id} className="item" style={{ cursor: 'pointer', padding: '8px 12px' }}><input type="checkbox" checked={sel.has(c.id)} onChange={() => toggle(c.id)} style={{ width: 20, height: 20 }} />
                <div className="grow"><div className="name ellipsis">{c.name}</div><div className="sub">{c.regNo || 'No Reg No.'} · Year {c.year}</div></div></label>))}</div></div>
        </div>
      </Modal>
    </div>
  );
}
