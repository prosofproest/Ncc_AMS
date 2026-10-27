'use client';
import { useState, useEffect, useRef, Suspense } from 'react';
import { useRouter } from 'next/navigation';
import { UIProvider, api, Spinner } from '@/app/components/ui';
import { Icon } from '@/app/components/Icon';
import { BrandMark } from '@/app/components/BrandMark';
import { getTabId } from '@/lib/tab';

export default function LoginPage() {
  return (
    <UIProvider>
      <Suspense fallback={null}>
        <Login />
      </Suspense>
    </UIProvider>
  );
}

const REASONS = {
  tab: 'Your session ended because the page was closed or opened in another tab. Please sign in again.',
  timeout: 'Your session ended after 30 minutes. Please sign in again.',
  expired: 'Your session expired. Please sign in again.',
  'other-tab': 'You signed in from another tab, so this one was signed out.',
};

function getReasonParam() {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get('reason');
}

function Login() {
  const router = useRouter();
  const [reasonMsg, setReasonMsg] = useState(() => {
    const q = getReasonParam();
    return q && REASONS[q.toLowerCase()] ? REASONS[q.toLowerCase()] : '';
  });

  const [step, setStep] = useState('creds');            // creds -> otp
  const [id, setId] = useState(''); const [pw, setPw] = useState(''); const [showPw, setShowPw] = useState(false);
  const [code, setCode] = useState('');
  const [challenge, setChallenge] = useState(null);     // { id, hint }
  const [left, setLeft] = useState(0);                  // seconds until the code expires
  const [cool, setCool] = useState(0);                  // resend cooldown
  const [err, setErr] = useState(''); const [info, setInfo] = useState(''); const [busy, setBusy] = useState(false);
  const codeRef = useRef(null);

  useEffect(() => {
    getTabId();
    const q = getReasonParam();
    if (q && REASONS[q.toLowerCase()]) {
      setReasonMsg(REASONS[q.toLowerCase()]);
    }
  }, []);

  useEffect(() => {
    // If arriving without an explicit session termination reason, check if already signed in
    const q = getReasonParam();
    if (!q) {
      api('/api/me').then(r => {
        if (r.ok && r.data?.user) router.replace(r.data.user.dashboardPath || '/dashboard/cadet');
      });
    }
  }, [router]);

  useEffect(() => { if (step !== 'otp') return; const t = setInterval(() => { setLeft(s => Math.max(0, s - 1)); setCool(s => Math.max(0, s - 1)); }, 1000); return () => clearInterval(t); }, [step]);
  useEffect(() => { if (step === 'otp') setTimeout(() => codeRef.current?.focus(), 80); }, [step]);

  const finish = d => {
    try {
      sessionStorage.setItem('ncc_has_session', '1');
    } catch {}
    router.replace(d.mustChangePassword ? '/change-password' : d.dashboardPath);
  };

  async function submitCreds(e) {
    e.preventDefault(); if (busy) return; setErr(''); setInfo(''); setBusy(true);
    const tabId = getTabId();
    const r = await api('/api/auth/login', { method: 'POST', body: { identifier: id.trim(), password: pw, tabId } });
    setBusy(false);
    if (!r.ok) return setErr(r.error);
    if (r.data.otpRequired) { setChallenge({ id: r.data.challengeId, hint: r.data.emailHint }); setLeft(r.data.expiresInSec); setCool(30); setCode(''); setStep('otp'); return; }
    finish(r.data);
  }
  async function submitOtp(e, value = code) {
    e?.preventDefault(); if (busy || value.length !== 6) return; setErr(''); setBusy(true);
    const tabId = getTabId();
    const r = await api('/api/auth/verify-otp', { method: 'POST', body: { challengeId: challenge.id, code: value, tabId } });
    setBusy(false);
    if (!r.ok) { setErr(r.error); setCode(''); if (r.data?.restart) backToCreds(); else codeRef.current?.focus(); return; }
    finish(r.data);
  }
  async function resend() {
    if (cool > 0 || busy) return; setErr(''); setInfo(''); setBusy(true);
    const tabId = getTabId();
    const r = await api('/api/auth/resend-otp', { method: 'POST', body: { challengeId: challenge.id, tabId } });
    setBusy(false);
    if (!r.ok) { setErr(r.error); if (r.data?.restart) backToCreds(); return; }
    setLeft(r.data.expiresInSec); setCool(30); setInfo(`A new code was sent to ${r.data.emailHint}.`);
  }
  function backToCreds() { setStep('creds'); setChallenge(null); setCode(''); setPw(''); }

  const mm = String(Math.floor(left / 60)).padStart(1, '0') + ':' + String(left % 60).padStart(2, '0');

  return (
    <main style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: '24px 16px' }}>
      <div style={{ width: '100%', maxWidth: 400 }}>
        <div className="center mb" style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
            <BrandMark size={44} />
          </div>
          <div className="eyebrow">Jai Hind</div>
          <h1 style={{ fontSize: 22, fontWeight: 600, marginTop: 4 }}>NCC AIRWING · FLIGHT-B</h1>
          <p className="muted small" style={{ marginTop: 2 }}>6 KAR AIR SQN NCC</p>
        </div>

        <div className="card" style={{ padding: 20 }}>
          {reasonMsg && (
            <div className="banner info mb" role="status">
              <Icon name="info" size={16} /> {reasonMsg}
            </div>
          )}

          {step === 'creds' ? (
            <form onSubmit={submitCreds} className="col" style={{ gap: 14 }}>
              <div><h2 className="h2">Sign in</h2><p className="muted small">Use your e-mail, username or regimental number.</p></div>
              <div className="field"><label htmlFor="id">E-mail, username or Reg. No.</label>
                <input id="id" className="input" value={id} onChange={e => setId(e.target.value)} autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} required autoFocus placeholder="e.g. rohan, marker@test.in or KAR/NCC/2026/101" /></div>
              <div className="field"><label htmlFor="pw">Password</label>
                <div style={{ position: 'relative' }}>
                  <input id="pw" className="input" type={showPw ? 'text' : 'password'} value={pw} onChange={e => setPw(e.target.value)} autoComplete="current-password" required style={{ paddingRight: 44 }} placeholder="••••••••" />
                  <button type="button" className="btn btn-ghost btn-icon" onClick={() => setShowPw(s => !s)} aria-label={showPw ? 'Hide password' : 'Show password'} style={{ position: 'absolute', right: 2, top: 1, border: 0 }}>
                    <Icon name={showPw ? 'eye-off' : 'eye'} size={16} />
                  </button>
                </div></div>
              {err && <div className="banner bad" role="alert"><Icon name="alert-triangle" size={16} /> {err}</div>}
              <button className="btn btn-primary btn-lg btn-block" disabled={busy || !id.trim() || !pw}>{busy ? <Spinner /> : 'Sign in'}</button>
            </form>
          ) : (
            <form onSubmit={submitOtp} className="col" style={{ gap: 14 }}>
              <div className="center">
                <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 44, height: 44, borderRadius: '50%', background: 'var(--accent-tint)', color: 'var(--accent)', margin: '0 auto' }}>
                  <Icon name="mail" size={22} />
                </div>
                <h2 className="h2 mt-s">Check your email</h2>
                <p className="muted small mt-s">We sent a 6-digit code to <b>{challenge.hint}</b>.</p>
              </div>
              <input ref={codeRef} className="input otp" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*" maxLength={6} value={code} placeholder="••••••"
                onChange={e => { const v = e.target.value.replace(/\D/g, '').slice(0, 6); setCode(v); if (v.length === 6) submitOtp(null, v); }} aria-label="6-digit code" />
              <p className="center small muted">{left > 0 ? <>Code expires in <b className="mono">{mm}</b></> : <span style={{ color: 'var(--danger)' }}>Code expired — go back and sign in again.</span>}</p>
              {err && <div className="banner bad" role="alert"><Icon name="alert-triangle" size={16} /> {err}</div>}
              {info && <div className="banner good"><Icon name="check-circle" size={16} /> {info}</div>}
              <button className="btn btn-primary btn-lg btn-block" disabled={busy || code.length !== 6 || left === 0}>{busy ? <Spinner /> : 'Verify & continue'}</button>
              <div className="row between">
                <button type="button" className="btn btn-ghost btn-sm" onClick={backToCreds}><Icon name="chevron-left" size={14} /> Back</button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={resend} disabled={cool > 0 || busy}>{cool > 0 ? `Resend in ${cool}s` : 'Resend code'}</button>
              </div>
            </form>
          )}
        </div>
        <p className="center tiny muted" style={{ marginTop: 16 }}>Unity and Discipline</p>
      </div>
    </main>
  );
}
