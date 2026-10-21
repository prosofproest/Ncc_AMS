'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { UIProvider, api, Spinner } from '@/app/components/ui';
import { Icon } from '@/app/components/Icon';
import { BrandMark } from '@/app/components/BrandMark';

export default function Page() { return <UIProvider><ChangePassword /></UIProvider>; }

function ChangePassword() {
  const router = useRouter();
  const [pw, setPw] = useState(''); const [pw2, setPw2] = useState(''); const [show, setShow] = useState(false);
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const strong = pw.length >= 8 && /\d/.test(pw) && /[A-Za-z]/.test(pw);

  async function submit(e) {
    e.preventDefault(); setErr('');
    if (pw.length < 6) return setErr('Use at least 6 characters (8 or more is better).');
    if (pw !== pw2) return setErr('The two passwords do not match.');
    setBusy(true);
    const r = await api('/api/auth/change-password', { method: 'POST', body: { password: pw } });
    setBusy(false);
    if (!r.ok) return setErr(r.error);
    router.replace(r.data.dashboardPath);
  }

  return (
    <main style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: '24px 16px' }}>
      <form onSubmit={submit} className="card col" style={{ width: '100%', maxWidth: 400, padding: 20, gap: 14 }}>
        <div className="center">
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
            <BrandMark size={40} />
          </div>
          <h1 className="h2" style={{ fontSize: 20 }}>Set a new password</h1>
          <p className="muted small mt-s">For your safety, choose your own password before continuing.</p>
        </div>
        <div className="field"><label htmlFor="p1">New password</label>
          <input id="p1" className="input" type={show ? 'text' : 'password'} value={pw} onChange={e => setPw(e.target.value)} autoComplete="new-password" required autoFocus /></div>
        <div className="field"><label htmlFor="p2">Confirm password</label>
          <input id="p2" className="input" type={show ? 'text' : 'password'} value={pw2} onChange={e => setPw2(e.target.value)} autoComplete="new-password" required /></div>
        <label className="row small muted" style={{ cursor: 'pointer' }}><input type="checkbox" checked={show} onChange={e => setShow(e.target.checked)} /> Show passwords</label>
        {pw && <div className="bar"><i style={{ width: strong ? '100%' : pw.length >= 6 ? '55%' : '25%', background: strong ? 'var(--success)' : pw.length >= 6 ? 'var(--warning)' : 'var(--danger)' }} /></div>}
        {err && <div className="banner bad" role="alert"><Icon name="alert-triangle" size={16} /> {err}</div>}
        <button className="btn btn-primary btn-lg btn-block" disabled={busy}>{busy ? <Spinner /> : 'Save & continue'}</button>
      </form>
    </main>
  );
}
