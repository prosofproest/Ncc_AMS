'use client';
import { useState, useMemo } from 'react';
import { useRealtimeData } from '@/lib/useRealtimeData';
import { api, useUI, Modal, Skeleton, Empty, Spinner, Switch, Field, PctBadge, initials } from '@/app/components/ui';
import Icon from '@/app/components/Icon';
import { useUser, hasPerm } from '@/app/components/user';
import { normalizeRegNo } from '@/lib/keys.mjs';

const BUILTIN = { marker: 'Attendance marker', cadet: 'Cadet', cto: 'CTO (Sir)', admin: 'Administrator' };
const blank = { role: 'marker', name: '', reg_no: '', year: 1, type: 'SD', username: '', password: '', email: '', phone: '', otp_required: true, must_change_password: true, is_active: true };
const genPw = () => { const a = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'; const r = crypto.getRandomValues(new Uint32Array(10)); return [...r].map(n => a[n % a.length]).join(''); };

export default function UsersPanel({ readOnly = false }) {
  const me = useUser(); const { toast, confirm } = useUI();
  const canManage = hasPerm(me, 'canManageUsers') && !readOnly;
  const { data, loading, refresh } = useRealtimeData('/api/cadets?all=1', 30000);
  const { data: rolesData } = useRealtimeData(me.role === 'admin' ? '/api/roles' : null, 0);
  const roleOptions = useMemo(() => {
    const o = { ...BUILTIN };
    if (rolesData?.roles) Object.entries(rolesData.roles).forEach(([k, v]) => { if (!v.isBuiltin) o[k] = v.label || k; });
    return o;
  }, [rolesData]);
  const [q, setQ] = useState(''); const [fRole, setFRole] = useState('all'); const [fYear, setFYear] = useState('all'); const [fStatus, setFStatus] = useState('active');
  const [form, setForm] = useState(null); const [saving, setSaving] = useState(false); const [showPw, setShowPw] = useState(false);

  const dupGroups = useMemo(() => {
    const cadets = (data?.cadets || []).filter(u => u.role === 'cadet' && u.regNo);
    const byReg = new Map();
    cadets.forEach(u => {
      const nr = normalizeRegNo(u.regNo);
      if (nr) {
        if (!byReg.has(nr)) byReg.set(nr, []);
        byReg.get(nr).push(u);
      }
    });
    const groups = [];
    byReg.forEach((list, nr) => {
      if (list.length > 1) groups.push({ regNo: nr, cadets: list });
    });
    return groups;
  }, [data]);

  const dupCadetCount = useMemo(() => dupGroups.reduce((acc, g) => acc + g.cadets.length, 0), [dupGroups]);

  const list = useMemo(() => (data?.cadets || []).filter(u => {
    if (fStatus === 'duplicates') return false;
    if (fRole !== 'all' && u.role !== fRole) return false;
    if (fYear !== 'all' && String(u.year) !== fYear) return false;
    if (fStatus === 'active' && !(u.isActive && !u.discharged)) return false;
    if (fStatus === 'inactive' && (u.isActive || u.discharged)) return false;
    if (fStatus === 'discharged' && !u.discharged) return false;
    const s = q.trim().toLowerCase();
    return !s || `${u.name} ${u.regNo || ''} ${u.username || ''} ${u.email || ''}`.toLowerCase().includes(s);
  }), [data, q, fRole, fYear, fStatus]);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const openAdd = () => { setForm({ ...blank, password: genPw() }); setShowPw(true); };
  const openEdit = u => {
    setForm({
      id: u.id, role: u.role, name: u.name, reg_no: u.regNo || '',
      year: u.year || 1, type: u.type || 'SD', username: u.username || '',
      password: '', email: u.email || '', phone: u.phone || '',
      otp_required: !!u.otpRequired, must_change_password: false,
      is_active: u.isActive, discharged: u.discharged,
      locked: u.lockedUntil && Date.parse(u.lockedUntil) > Date.now(),
      pct: u.pct
    });
    setShowPw(false);
  };

  const isCadet = form?.role === 'cadet';
  const isMarker = form?.role === 'marker';

  async function save() {
    if (!form.name.trim()) return toast('Enter the name.', 'err');
    if (isCadet) {
      if (!form.reg_no.trim()) return toast('Enter the regimental number.', 'err');
    } else {
      if (!form.email.trim()) return toast('Enter an e-mail address.', 'err');
      if (form.otp_required && !form.email.trim() && form.role !== 'admin')
        return toast('Add an e-mail address first — it is needed to send the OTP.', 'err');
    }
    const effPw = form.password || (isCadet && !form.id ? form.reg_no : '');
    if (!form.id && effPw.length < 6) return toast('Password must be at least 6 characters.', 'err');

    setSaving(true);
    const body = {
      name: form.name, role: form.role, email: form.email, phone: form.phone, otp_required: form.otp_required,
      ...(isCadet ? { reg_no: form.reg_no, year: form.year, type: form.type, username: form.username } : {})
    };
    let r;
    if (form.id) {
      r = await api(`/api/cadets/${form.id}`, { method: 'PUT', body: { ...body, is_active: form.is_active, ...(form.password ? { password: form.password, must_change_password: form.must_change_password } : {}) } });
    } else {
      r = await api('/api/cadets', { method: 'POST', body: { ...body, password: effPw, must_change_password: form.must_change_password } });
    }
    setSaving(false);
    if (!r.ok) return toast(r.error, 'err');

    if (form.id) {
      toast('Saved.', 'ok', 3500);
    } else {
      const idInfo = form.email ? `E-mail: ${form.email}` : `Reg. No.: ${form.reg_no}`;
      toast(`Account created. ${idInfo}  Password: ${effPw}`, 'ok', 12000);
    }
    setForm(null); refresh();
  }

  async function toggleOtp(u, v) {
    if (v && !u.email && u.role !== 'cadet' && u.role !== 'admin')
      return toast(`Add an e-mail for ${u.name} first — it is needed to send the OTP.`, 'err');
    const r = await api(`/api/cadets/${u.id}`, { method: 'PUT', body: { otp_required: v } });
    if (!r.ok) return toast(r.error, 'err');
    toast(`OTP ${v ? 'on' : 'off'} for ${u.name}. Applies from the next sign-in.`, 'ok');
    refresh();
  }

  async function unlock() { const r = await api(`/api/cadets/${form.id}`, { method: 'PUT', body: { unlock: true } }); if (!r.ok) return toast(r.error, 'err'); toast('Account unlocked.', 'ok'); set('locked', false); refresh(); }
  async function discharge() {
    if (!await confirm({ title: `Discharge ${form.name}?`, message: 'They are removed from the active roster and the sheet, and signed out. Their attendance history is kept. You can roll this back.', confirmText: 'Discharge', danger: true })) return;
    const r = await api(`/api/cadets/${form.id}`, { method: 'DELETE', body: { action: 'discharge' } }); if (!r.ok) return toast(r.error, 'err'); toast('Discharged.', 'ok'); setForm(null); refresh();
  }
  async function deleteAccount() {
    const isCadetAccount = form.role === 'cadet';
    if (!await confirm({
      title: isCadetAccount ? `Delete cadet ${form.name}?` : `Delete account for ${form.name}?`,
      message: isCadetAccount
        ? `Are you sure you want to permanently delete cadet ${form.name}? This is only allowed if they have no attendance history.`
        : 'This permanently removes the account and signs the person out. This action cannot be undone.',
      confirmText: isCadetAccount ? 'Delete cadet' : 'Delete account',
      danger: true
    })) return;
    const r = await api(`/api/cadets/${form.id}`, { method: 'DELETE', body: { action: 'delete' } });
    if (!r.ok) return toast(r.error, 'err');
    toast(isCadetAccount ? 'Cadet deleted.' : 'Account deleted.', 'ok');
    setForm(null);
    refresh();
  }

  async function deleteCadetDirect(u) {
    if (!await confirm({
      title: `Delete cadet ${u.name}?`,
      message: `Are you sure you want to permanently delete cadet ${u.name}? This is only allowed if they have no attendance history.`,
      confirmText: 'Delete cadet',
      danger: true,
    })) return;
    const r = await api(`/api/cadets/${u.id}`, { method: 'DELETE', body: { action: 'delete' } });
    if (!r.ok) return toast(r.error, 'err');
    toast('Cadet deleted.', 'ok');
    refresh();
  }

  async function dischargeCadetDirect(u) {
    if (!await confirm({
      title: `Discharge ${u.name}?`,
      message: 'They are removed from the active roster and the sheet, and signed out. Their attendance history is kept.',
      confirmText: 'Discharge',
      danger: true,
    })) return;
    const r = await api(`/api/cadets/${u.id}`, { method: 'DELETE', body: { action: 'discharge' } });
    if (!r.ok) return toast(r.error, 'err');
    toast('Discharged.', 'ok');
    refresh();
  }

  async function rollback() { const r = await api(`/api/cadets/${form.id}`, { method: 'PUT', body: { rollback: true } }); if (!r.ok) return toast(r.error, 'err'); toast('Restored to the active roster.', 'ok'); setForm(null); refresh(); }

  return (
    <div className="stack">
      {dupGroups.length > 0 && (
        <div className="banner bad" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Icon name="alert-triangle" size={16} />
            Duplicate Regimental Numbers detected among {dupCadetCount} cadets ({dupGroups.length} group{dupGroups.length > 1 ? 's' : ''}).
          </span>
          {fStatus !== 'duplicates' && (
            <button className="btn btn-sm btn-danger" onClick={() => setFStatus('duplicates')}>View duplicates</button>
          )}
        </div>
      )}

      <div className="row wrap">
        <input className="input grow" style={{ minWidth: 180 }} placeholder="Search name, reg. no., username, email…" value={q} onChange={e => setQ(e.target.value)} />
        {canManage && <button className="btn btn-primary" onClick={openAdd} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon name="plus" size={16} /> Add account</button>}
      </div>
      <div className="row wrap gap-s">
        <select className="input" style={{ width: 'auto' }} value={fRole} onChange={e => setFRole(e.target.value)}><option value="all">All roles</option>{Object.entries(roleOptions).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <select className="input" style={{ width: 'auto' }} value={fYear} onChange={e => setFYear(e.target.value)}><option value="all">All years</option><option value="1">Year 1</option><option value="2">Year 2</option><option value="3">Year 3</option></select>
        <div className="seg">
          {[
            ['active', 'Active'],
            ['inactive', 'Inactive'],
            ['discharged', 'Discharged'],
            ['all', 'All'],
            ...(dupGroups.length ? [['duplicates', `Duplicates (${dupCadetCount})`]] : [])
          ].map(([k, l]) => <button key={k} className={fStatus === k ? 'on' : ''} onClick={() => setFStatus(k)}>{l}</button>)}
        </div>
        <span className="muted small right">{fStatus === 'duplicates' ? `${dupCadetCount} duplicates` : `${list.length} shown`}</span>
      </div>

      {fStatus === 'duplicates' ? (
        <div className="col gap mt">
          {dupGroups.map(g => (
            <div key={g.regNo} className="card col" style={{ gap: 12 }}>
              <div className="row between">
                <h3 className="h2" style={{ margin: 0 }}>Reg No: <span className="mono">{g.regNo}</span></h3>
                <span className="badge b-amber">{g.cadets.length} cadets</span>
              </div>
              <div className="grid g2 gap-s">
                {g.cadets.map(u => (
                  <div key={u.id} className="card tight col" style={{ gap: 8, background: 'var(--bg-subtle)' }}>
                    <div className="row between">
                      <div>
                        <div className="bold">{u.name}</div>
                        <div className="small muted">Year {u.year || '—'} · {u.type || 'SD'} · {u.regNo}</div>
                      </div>
                      <span className={`badge ${u.isActive && !u.discharged ? 'b-green' : u.discharged ? 'b-red' : 'b-gray'}`}>
                        {u.isActive && !u.discharged ? 'Active' : u.discharged ? 'Discharged' : 'Inactive'}
                      </span>
                    </div>
                    <div className="row wrap gap-s small muted">
                      <span>Parades: {u.pct != null ? `${u.pct}%` : `${u.stats?.total || 0} total`}</span>
                      <span>·</span>
                      <span>Created: {u.createdAt ? new Date(u.createdAt).toLocaleDateString('en-IN') : '—'}</span>
                      <span>·</span>
                      <span className="mono">{u.id}</span>
                    </div>
                    {canManage && (
                      <div className="row gap-s mt-s">
                        {me?.role === 'admin' && (
                          <button className="btn btn-sm btn-danger" onClick={() => deleteCadetDirect(u)}>Delete</button>
                        )}
                        {!u.discharged && (
                          <button className="btn btn-sm" onClick={() => dischargeCadetDirect(u)}>Discharge</button>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : loading && !data ? <Skeleton n={6} h={66} /> : !list.length ? <div className="card"><Empty icon="users">No one matches.</Empty></div> : (
        <div className="grid g2 tbl-dense">{list.map(u => (
          <div key={u.id} className={`item tbl-dense${!u.isActive ? ' locked' : ''}`} style={{ margin: 0 }}>
            <span className="avatar">{initials(u.name)}</span>
            <div className="grow" style={{ cursor: canManage ? 'pointer' : undefined }} onClick={() => canManage && openEdit(u)}>
              <div className="name ellipsis">{u.name}</div>
              <div className="sub ellipsis">{u.regNo || u.username || '—'}{u.role === 'cadet' ? ` · Y${u.year} ${u.type}` : ''}</div>
              <div className="row wrap gap-s mt-s">
                <span className="badge b-blue">{roleOptions[u.role] || u.role}</span>
                {u.role === 'marker' && <span className="badge b-amber">Marker</span>}
                {u.role === 'cadet' && <PctBadge pct={u.pct} />}
                {u.email ? <span className="badge b-gray" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="mail" size={12} /> Email</span> : null}
                {u.otpRequired && !u.email && <span className="badge b-amber">No e-mail</span>}
                {u.discharged && <span className="badge b-red">discharged</span>}
                {u.lockedUntil && Date.parse(u.lockedUntil) > Date.now() && <span className="badge b-red" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="lock" size={12} /> Locked</span>}
              </div>
            </div>
            {canManage && u.isActive && (
              <div className="col" style={{ alignItems: 'center', gap: 4 }} title={u.role === 'cadet' && !u.email ? 'Needs an e-mail. Without one the cadet signs in with the password only.' : 'Two-step OTP by e-mail'}>
                <Switch on={!!u.otpRequired} onChange={v => toggleOtp(u, v)} label={`OTP for ${u.name}`} />
                <span className="tiny muted">OTP</span>
              </div>
            )}
          </div>))}</div>)}

      <Modal open={!!form} onClose={() => setForm(null)} wide title={form?.id ? `Edit · ${form.name}` : 'New account'}
        footer={<><button className="btn" onClick={() => setForm(null)}>Cancel</button><button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? <Spinner /> : form?.id ? 'Save changes' : 'Create account'}</button></>}>
        {form && (
          <div className="col" style={{ gap: 16 }}>
            {form.locked && <div className="banner bad"><span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon name="lock" size={16} /> Locked after too many wrong passwords.</span> <button className="btn btn-sm right" onClick={unlock}>Unlock</button></div>}
            {form.discharged && <div className="banner warn">Discharged. <button className="btn btn-sm right" onClick={rollback}>Roll back</button></div>}
            <div className="grid g2">
              <Field label="Account type">
                <select className="input" value={form.role} onChange={e => { const nr = e.target.value; setForm(f => ({ ...f, role: nr, otp_required: true, password: nr !== 'cadet' ? (f.password || genPw()) : f.password })); }} disabled={form.id === me.id}>
                  {Object.entries(roleOptions).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </Field>
              <Field label="Full name"><input className="input" value={form.name} onChange={e => set('name', e.target.value)} maxLength={80} /></Field>

              {isMarker && (
                <>
                  <div className="col" style={{ gridColumn: 'span 2' }}>
                    <p className="hint" style={{ color: 'var(--accent)' }}>Signs in with this e-mail and password and marks attendance. Not part of the cadet roll.</p>
                  </div>
                  <Field label="E-mail"><input className="input" type="email" inputMode="email" autoCapitalize="none" value={form.email} onChange={e => set('email', e.target.value)} required /></Field>
                  <Field label="Phone (optional)"><input className="input" type="tel" value={form.phone} onChange={e => set('phone', e.target.value)} maxLength={20} /></Field>
                </>
              )}

              {isCadet && (
                <>
                  <Field label="Regimental number"><input className="input" value={form.reg_no} onChange={e => { const r = e.target.value.toUpperCase(); set('reg_no', r); if (!form.id && !form.password) set('password', r); }} autoCapitalize="characters" required /></Field>
                  <Field label="Year"><select className="input" value={form.year} onChange={e => set('year', +e.target.value)}><option value={1}>Year 1</option><option value={2}>Year 2</option><option value={3}>Year 3</option></select></Field>
                  <Field label="Division"><select className="input" value={form.type} onChange={e => set('type', e.target.value)}><option value="SD">SD</option><option value="SW">SW</option></select></Field>
                  <Field label="E-mail" hint="Used for absence notices and two-step OTP"><input className="input" type="email" inputMode="email" autoCapitalize="none" value={form.email} onChange={e => set('email', e.target.value)} /></Field>
                  <Field label="Phone (optional)"><input className="input" type="tel" value={form.phone} onChange={e => set('phone', e.target.value)} maxLength={20} /></Field>
                  <Field label="Username (optional)" hint="Letters, numbers, . _ - · used to sign in"><input className="input" value={form.username} onChange={e => set('username', e.target.value.toLowerCase())} autoCapitalize="none" autoComplete="off" /></Field>
                </>
              )}

              {!isCadet && !isMarker && (
                <>
                  <Field label="E-mail"><input className="input" type="email" inputMode="email" autoCapitalize="none" value={form.email} onChange={e => set('email', e.target.value)} required /></Field>
                  <Field label="Phone (optional)"><input className="input" type="tel" value={form.phone} onChange={e => set('phone', e.target.value)} maxLength={20} /></Field>
                </>
              )}
            </div>

            <Field label={form.id ? 'Reset password (leave empty to keep)' : 'Password'} hint={form.id ? 'Setting a new password signs the person out everywhere.' : isCadet ? 'Defaults to the Regimental Number. They can change it after signing in.' : 'Give this to the person. They can change it after signing in.'}>
              <div className="row">
                <input className="input mono" type={showPw ? 'text' : 'password'} value={form.password} placeholder={!form.id && isCadet ? (form.reg_no || 'Regimental number') : ''} onChange={e => set('password', e.target.value)} autoComplete="new-password" />
                <button type="button" className="btn btn-icon" onClick={() => setShowPw(s => !s)} aria-label={showPw ? 'Hide password' : 'Show password'}><Icon name={showPw ? 'eye-off' : 'eye'} size={16} /></button>
                <button type="button" className="btn" onClick={() => { set('password', genPw()); setShowPw(true); }}>Generate</button>
              </div>
            </Field>

            <div className="card tight col" style={{ gap: 12 }}>
              <div className="row between">
                <div>
                  <div className="bold">Two-step OTP by e-mail</div>
                  <div className="hint">{isCadet ? 'Needs an e-mail. Without one the cadet signs in with the password only.' : 'After the password, a 6-digit code is emailed. Switch on or off any time.'}</div>
                </div>
                <Switch on={form.otp_required} onChange={v => set('otp_required', v)} label="Two-step OTP by e-mail" />
              </div>
              <div className="row between">
                <div><div className="bold">Ask for a new password at first sign-in</div></div>
                <Switch on={form.must_change_password} onChange={v => set('must_change_password', v)} label="Ask for a new password at first sign-in" />
              </div>
              {form.id && (
                <div className="row between">
                  <div><div className="bold">Account active</div></div>
                  <Switch on={form.is_active} onChange={v => set('is_active', v)} label="Account active" />
                </div>
              )}
            </div>
            <div className="row gap-s" style={{ alignSelf: 'flex-start' }}>
              {form.id && isCadet && !form.discharged && form.id !== me.id && (
                <button type="button" className="btn btn-danger btn-sm" onClick={discharge}>Discharge from the unit…</button>
              )}
              {form.id && isCadet && me?.role === 'admin' && form.id !== me.id && (
                <button type="button" className="btn btn-danger btn-sm" onClick={deleteAccount}>Delete cadet…</button>
              )}
              {form.id && !isCadet && me?.role === 'admin' && (
                <button type="button" className="btn btn-danger btn-sm" onClick={deleteAccount}>Delete account…</button>
              )}
            </div>
          </div>)}
      </Modal>
    </div>
  );
}
