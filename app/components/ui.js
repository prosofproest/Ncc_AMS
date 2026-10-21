'use client';
import { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import { Icon } from '@/app/components/Icon';

// ── network helpers ───────────────────────────────────────────────────────────
export async function api(url, { method = 'GET', body } = {}) {
  try {
    const r = await fetch(url, { method, cache: 'no-store', headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
    if (r.status === 401 && !url.startsWith('/api/auth')) {
      if (typeof window !== 'undefined' && !location.pathname.startsWith('/login')) location.href = '/login';
      return { ok: false, status: 401, error: 'Session expired. Please sign in again.' };
    }
    const data = (r.headers.get('content-type') || '').includes('json') ? await r.json().catch(() => null) : null;
    return { ok: r.ok, status: r.status, data, error: r.ok ? null : (data?.error || `Something went wrong (${r.status}).`) };
  } catch {
    return { ok: false, status: 0, network: true, error: 'No connection. Check your internet and try again.' };
  }
}

// Download a generated report (PDF / Excel / CSV). Errors from the server are shown, not saved as files.
export async function download(url) {
  try {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) { const j = await r.json().catch(() => null); return { ok: false, error: j?.error || `Could not create the report (${r.status}).` }; }
    const blob = await r.blob();
    const name = (r.headers.get('content-disposition') || '').match(/filename="?([^"]+)"?/)?.[1] || 'report';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    return { ok: true, name };
  } catch { return { ok: false, error: 'No connection. Check your internet and try again.' }; }
}

// ── toast + confirm ───────────────────────────────────────────────────────────
const UICtx = createContext(null);
export const useUI = () => useContext(UICtx);

export function UIProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const [dlg, setDlg] = useState(null);
  const id = useRef(0);
  const toast = useCallback((msg, type = 'info', ms = 4200) => {
    const k = ++id.current;
    setToasts(t => [...t.slice(-3), { k, msg, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.k !== k)), ms);
  }, []);
  const confirm = useCallback(opts => new Promise(res => setDlg({ ...opts, res })), []);
  const close = v => { dlg?.res(v); setDlg(null); };
  return (
    <UICtx.Provider value={{ toast, confirm }}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map(t => (
          <div key={t.k} className={`toast ${t.type}`}>
            <Icon name={t.type === 'ok' ? 'check-circle' : t.type === 'err' ? 'alert-triangle' : 'info'} size={18} />
            <span>{t.msg}</span>
          </div>
        ))}
      </div>
      {dlg && (
        <div className="backdrop" onClick={() => close(false)}>
          <div className="modal" style={{ maxWidth: 440 }} onClick={e => e.stopPropagation()} role="dialog" aria-modal="true">
            <h3 className="h2">{dlg.title}</h3>
            {dlg.message && <p className="muted mt-s" style={{ whiteSpace: 'pre-line' }}>{dlg.message}</p>}
            <div className="row mt" style={{ justifyContent: 'flex-end' }}>
              <button className="btn" onClick={() => close(false)}>{dlg.cancelText || 'Cancel'}</button>
              <button className={`btn ${dlg.danger ? 'btn-danger' : 'btn-primary'}`} onClick={() => close(true)} autoFocus>{dlg.confirmText || 'Confirm'}</button>
            </div>
          </div>
        </div>
      )}
    </UICtx.Provider>
  );
}

// ── building blocks ───────────────────────────────────────────────────────────
export function Modal({ open, onClose, title, children, footer, wide }) {
  useEffect(() => {
    if (!open) return;
    const k = e => e.key === 'Escape' && onClose?.();
    document.addEventListener('keydown', k);
    const prev = document.body.style.overflow; document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', k); document.body.style.overflow = prev; };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="backdrop" onMouseDown={e => e.target === e.currentTarget && onClose?.()}>
      <div className={`modal${wide ? ' wide' : ''}`} role="dialog" aria-modal="true">
        <div className="row between mb">
          <h3 className="h2">{title}</h3>
          <button className="btn btn-icon btn-ghost" onClick={onClose} aria-label="Close">
            <Icon name="x" size={18} />
          </button>
        </div>
        {children}
        {footer && <div className="row wrap mt" style={{ justifyContent: 'flex-end' }}>{footer}</div>}
      </div>
    </div>
  );
}

export function Spinner() { return <span className="spin" role="status" aria-label="Loading" />; }
export function Skeleton({ h = 64, n = 1 }) { return <div className="stack">{Array.from({ length: n }, (_, i) => <div key={i} className="skeleton" style={{ height: h }} />)}</div>; }

export function Empty({ icon = 'mail', children }) {
  return (
    <div className="empty">
      <div className="e">
        <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'var(--border-subtle)', color: 'var(--muted)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
          {typeof icon === 'string' ? <Icon name={icon} size={20} /> : icon}
        </div>
      </div>
      <div>{children}</div>
    </div>
  );
}

export function Stat({ value, label, color }) { return <div className="card stat"><b style={{ color }}>{value}</b><span>{label}</span></div>; }
export function Switch({ on, onChange, disabled, label }) { return <button type="button" role="switch" aria-checked={!!on} aria-label={label} className={`switch${on ? ' on' : ''}`} disabled={disabled} onClick={() => onChange(!on)} />; }
export function Field({ label, hint, children }) { return <div className="field">{label && <label>{label}</label>}{children}{hint && <span className="hint">{hint}</span>}</div>; }
export function initials(name = '') { return name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?'; }
export function PctBadge({ pct, threshold = 75 }) {
  if (pct === null || pct === undefined) return <span className="badge b-gray">No data</span>;
  return <span className={`badge ${pct >= threshold ? 'b-green' : pct >= threshold - 15 ? 'b-amber' : 'b-red'}`}>{pct}%</span>;
}
export function Ring({ pct, threshold = 75 }) {
  const c = pct >= threshold ? 'var(--green)' : pct >= threshold - 15 ? 'var(--amber)' : 'var(--red)';
  return <div className="ring" style={{ '--p': pct || 0, '--c': c }}><b>{pct ?? 0}%</b></div>;
}
export const barClass = (p, th = 75) => (p >= th ? 'g' : p >= th - 15 ? 'a' : 'r');

// Segmented tabs on desktop, floating glass bottom bar on phones (extra tabs go under "More")
export function TabNav({ tabs, active, onChange, max = 5 }) {
  const [more, setMore] = useState(false);
  const shown = tabs.length > max ? tabs.slice(0, max - 1) : tabs;
  const rest = tabs.length > max ? tabs.slice(max - 1) : [];
  const moreActive = rest.some(t => t.id === active);

  const renderIcon = (ico) => {
    if (!ico) return null;
    if (typeof ico === 'string') return <Icon name={ico} size={18} />;
    return ico;
  };

  return (
    <>
      <div className="seg desk" role="tablist">
        {tabs.map(t => <button key={t.id} role="tab" aria-selected={active === t.id} className={active === t.id ? 'on' : ''} onClick={() => onChange(t.id)}>{t.label}{t.badge > 0 && <span className="count">{t.badge}</span>}</button>)}
      </div>
      <nav className="bottom-nav" aria-label="Sections">
        {shown.map(t => (
          <button key={t.id} className={active === t.id ? 'on' : ''} onClick={() => { onChange(t.id); window.scrollTo({ top: 0 }); }}>
            <span className="i">{renderIcon(t.icon)}{t.badge > 0 && <span className="count">{t.badge}</span>}</span>
            {t.short || t.label}
          </button>
        ))}
        {rest.length > 0 && (
          <button className={moreActive ? 'on' : ''} onClick={() => setMore(true)}>
            <span className="i"><Icon name="more-horizontal" size={18} />{rest.some(t => t.badge > 0) && <span className="count">!</span>}</span>
            More
          </button>
        )}
      </nav>
      <Modal open={more} onClose={() => setMore(false)} title="More">
        <div className="stack">
          {rest.map(t => (
            <button key={t.id} className={`btn btn-block${active === t.id ? ' btn-primary' : ''}`} style={{ justifyContent: 'flex-start' }} onClick={() => { onChange(t.id); setMore(false); window.scrollTo({ top: 0 }); }}>
              <span>{renderIcon(t.icon)}</span>
              {t.label}
              {t.badge > 0 && <span className="count" style={{ position: 'static', marginLeft: 8 }}>{t.badge}</span>}
            </button>
          ))}
        </div>
      </Modal>
    </>
  );
}
