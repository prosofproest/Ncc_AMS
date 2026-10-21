'use client';
import { useState, useEffect } from 'react';
import { useRealtimeData } from '@/lib/useRealtimeData';
import { api, useUI, Modal, Skeleton, Switch, Spinner, Field } from '@/app/components/ui';
import Icon from '@/app/components/Icon';

export default function RolesPanel() {
  const { toast, confirm } = useUI();
  const { data, loading, refresh } = useRealtimeData('/api/roles', 0);
  const [draft, setDraft] = useState({}); const [saving, setSaving] = useState('');
  const [add, setAdd] = useState(null);
  useEffect(() => { if (data) setDraft(Object.fromEntries(Object.entries(data.roles).map(([k, v]) => [k, { ...v }]))); }, [data]);
  if (loading && !data) return <Skeleton n={3} h={160} />;
  if (!data) return null;
  const labels = data.permissionLabels;
  const nameOf = (k, v) => ({ admin: 'Administrator', cto: 'CTO (Sir)', marker: 'Attendance marker', cadet: 'Cadet' }[k] || v.label || k);

  async function save(k) {
    const { isBuiltin, label, ...perms } = draft[k]; setSaving(k);
    const r = await api('/api/roles', { method: 'PUT', body: { role: k, label, permissions: perms } }); setSaving('');
    if (!r.ok) return toast(r.error, 'err'); toast('Saved. People with this role must sign in again.', 'ok'); refresh();
  }
  async function del(k) {
    if (!await confirm({ title: 'Delete this role?', message: 'People who have it fall back to cadet access.', confirmText: 'Delete', danger: true })) return;
    const r = await api('/api/roles', { method: 'DELETE', body: { roleId: k } }); if (!r.ok) return toast(r.error, 'err'); refresh();
  }
  async function create() {
    const r = await api('/api/roles', { method: 'POST', body: { roleId: add.id, label: add.label, permissions: {} } }); if (!r.ok) return toast(r.error, 'err'); setAdd(null); refresh();
  }
  return (
    <div className="stack">
      <div className="row between wrap"><p className="muted small" style={{ maxWidth: 560 }}>Choose what each role may do. Changes sign out everyone with that role so the new rights apply.</p><button className="btn btn-primary" onClick={() => setAdd({ id: '', label: '' })} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon name="plus" size={16} /> New role</button></div>
      <div className="grid g2">{Object.entries(draft).map(([k, v]) => (
        <div key={k} className="card">
          <div className="row between mb"><div><h3 className="h2">{nameOf(k, v)}</h3><span className="badge b-gray">{v.isBuiltin ? 'built-in' : 'custom'}</span></div>{!v.isBuiltin && <button className="btn btn-sm btn-ghost" onClick={() => del(k)} aria-label="Delete role"><Icon name="trash" size={14} /></button>}</div>
          {Object.entries(labels).map(([p, l]) => (
            <div key={p} className="row between" style={{ padding: '7px 0', borderBottom: '1px solid var(--line)' }}><span className="small">{l}</span>
              <Switch on={!!v[p]} disabled={k === 'admin'} onChange={on => setDraft(d => ({ ...d, [k]: { ...d[k], [p]: on } }))} label={l} /></div>))}
          {k !== 'admin' ? <button className="btn btn-primary btn-block mt" onClick={() => save(k)} disabled={saving === k}>{saving === k ? <Spinner /> : 'Save'}</button> : <p className="hint mt">The administrator always keeps every permission.</p>}
        </div>))}</div>
      <Modal open={!!add} onClose={() => setAdd(null)} title="New custom role" footer={<><button className="btn" onClick={() => setAdd(null)}>Cancel</button><button className="btn btn-primary" onClick={create} disabled={!add?.id || !add?.label}>Create</button></>}>
        {add && <div className="col"><Field label="Role id (letters / numbers)"><input className="input" value={add.id} onChange={e => setAdd({ ...add, id: e.target.value })} autoCapitalize="none" /></Field><Field label="Display name"><input className="input" value={add.label} onChange={e => setAdd({ ...add, label: e.target.value })} /></Field></div>}
      </Modal>
    </div>
  );
}
