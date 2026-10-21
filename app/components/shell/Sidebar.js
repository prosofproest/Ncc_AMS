'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon } from '@/app/components/Icon';
import { BrandMark } from '@/app/components/BrandMark';
import { initials, Modal, PctBadge, api, download, useUI } from '@/app/components/ui';
import { navFor, isItemActive } from './nav';
import { fmtDate } from '@/lib/time';

export function Sidebar({
  user,
  needsMe = 0,
  theme,
  onFlipTheme,
  muted,
  onFlipVoice,
  onLogout,
  drawerOpen = false,
  onCloseDrawer,
  railExpanded = false,
  onToggleRail,
}) {
  const pathname = usePathname();
  const sidebarRef = useRef(null);
  const searchInputRef = useRef(null);
  const groups = navFor(user, needsMe);
  const home = user?.dashboardPath || '/dashboard/cadet';
  const roleLabel = { admin: 'Administrator', cto: 'Care Taker Officer', marker: 'Attendance marker', cadet: 'Cadet' }[user?.role] || user?.role;

  // Global search shortcut: Cmd+K / Ctrl+K
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Close drawer on Esc key and implement focus trap
  useEffect(() => {
    if (!drawerOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onCloseDrawer?.();
        return;
      }
      if (e.key === 'Tab' && sidebarRef.current) {
        const focusables = sidebarRef.current.querySelectorAll(
          'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        if (!focusables.length) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [drawerOpen, onCloseDrawer]);

  return (
    <>
      {drawerOpen && (
        <div
          className="drawer-backdrop"
          onClick={onCloseDrawer}
          aria-hidden="true"
        />
      )}
      <aside
        ref={sidebarRef}
        className={`sidebar ${railExpanded ? 'expanded' : ''} ${drawerOpen ? 'drawer-open' : ''}`}
        aria-label="Sidebar navigation"
      >
        {/* Brand Block */}
        <Link
          href={home}
          className="sidebar-brand"
          onClick={onCloseDrawer}
          aria-label="NCC AMS Home"
        >
          <BrandMark size={32} />
          <div className="sidebar-brand-text">
            <div className="sidebar-brand-title">NCC AIRWING · FLIGHT-B</div>
            <div className="sidebar-brand-sub">6 KAR AIR SQN NCC</div>
          </div>
        </Link>

        {/* Global Search (if permitted) */}
        <SidebarSearch user={user} inputRef={searchInputRef} onNavigate={onCloseDrawer} />

        {/* Navigation Groups */}
        <nav className="sidebar-nav" aria-label="Main">
          {groups.map((group, gIdx) => (
            <div key={group.title || gIdx} className="nav-group">
              {group.title && <div className="nav-group-title">{group.title}</div>}
              <ul className="nav-group-items">
                {group.items.map((item) => {
                  const active = isItemActive(pathname, item.href);
                  return (
                    <li key={item.id}>
                      <Link
                        href={item.href}
                        className={`nav-link ${active ? 'active' : ''}`}
                        aria-current={active ? 'page' : undefined}
                        onClick={onCloseDrawer}
                        title={item.label}
                      >
                        <span className="nav-icon">
                          <Icon name={item.icon} size={18} />
                        </span>
                        <span className="nav-label">{item.label}</span>
                        {item.badge > 0 && <span className="nav-badge">{item.badge}</span>}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        {/* Tablet Rail Expand Toggle */}
        <div className="rail-toggle" style={{ padding: '8px', borderTop: '1px solid var(--border-subtle)', justifyContent: 'center' }}>
          <button
            type="button"
            className="btn btn-icon btn-ghost btn-sm"
            onClick={onToggleRail}
            title={railExpanded ? 'Collapse sidebar' : 'Expand sidebar'}
            aria-label={railExpanded ? 'Collapse sidebar' : 'Expand sidebar'}
          >
            <Icon name={railExpanded ? 'chevron-left' : 'chevron-right'} size={16} />
          </button>
        </div>

        {/* Footer */}
        <div className="sidebar-footer">
          <div className="sidebar-user">
            <span className="avatar" style={{ width: 32, height: 32, fontSize: 13 }}>
              {initials(user?.name)}
            </span>
            <div className="sidebar-user-info" style={{ minWidth: 0, overflow: 'hidden' }}>
              <div className="sidebar-user-name ellipsis">{user?.name}</div>
              <div className="sidebar-user-role ellipsis">{roleLabel}</div>
            </div>
          </div>
          <div className="sidebar-actions">
            <button
              type="button"
              className="btn btn-icon btn-ghost btn-sm"
              onClick={onFlipTheme}
              title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
              aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            >
              <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={16} />
            </button>
            {user?.role === 'admin' && (
              <button
                type="button"
                className="btn btn-icon btn-ghost btn-sm"
                onClick={onFlipVoice}
                title={muted ? 'Turn voice greeting on' : 'Mute voice greeting'}
                aria-label="Toggle voice greeting"
              >
                <Icon name={muted ? 'wifi-off' : 'activity'} size={16} />
              </button>
            )}
            <button
              type="button"
              className="btn btn-ghost btn-sm sidebar-signout"
              onClick={onLogout}
              aria-label="Sign out"
            >
              <Icon name="log-out" size={14} />
              <span>Sign out</span>
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}

// GlobalSearch inside the Sidebar
function SidebarSearch({ user, inputRef, onNavigate }) {
  const { toast } = useUI();
  const canSearch = user?.role === 'admin' || ['canMarkAttendance', 'canViewAllAttendance', 'canManageUsers'].some(p => user?.permissions?.[p]);
  const [q, setQ] = useState('');
  const [res, setRes] = useState(null);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(null);
  const box = useRef(null);

  useEffect(() => {
    if (q.trim().length < 2) {
      setRes(null);
      return;
    }
    const t = setTimeout(async () => {
      const r = await api(`/api/search?q=${encodeURIComponent(q.trim())}`);
      if (r.ok) {
        setRes(r.data);
        setOpen(true);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    const h = (e) => {
      if (box.current && !box.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  if (!canSearch) return null;
  const canReports = user?.role === 'admin' || user?.permissions?.canViewAllAttendance;
  const get = async (url) => {
    const r = await download(url);
    if (!r.ok) toast(r.error, 'err');
  };

  return (
    <div className="sidebar-search" ref={box}>
      <span className="ico">
        <Icon name="search" size={15} />
      </span>
      <input
        ref={inputRef}
        className="input"
        placeholder="Search… ⌘K"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => res && setOpen(true)}
        aria-label="Search cadet, reg. no. or parade"
      />
      <span className="sidebar-search-kbd">⌘K</span>
      {open && res && (
        <div className="sidebar-search-pop glass">
          {!res.cadets.length && !res.sessions.length && (
            <div className="empty" style={{ padding: 16 }}>No matches</div>
          )}
          {res.cadets.map((c) => (
            <button
              key={c.id}
              type="button"
              className="item"
              style={{ width: '100%', textAlign: 'left', cursor: 'pointer', border: 0 }}
              onClick={() => {
                setView({ type: 'cadet', ...c });
                setOpen(false);
                onNavigate?.();
              }}
            >
              <span className="avatar">{initials(c.name)}</span>
              <span className="grow">
                <span className="name ellipsis" style={{ display: 'block' }}>{c.name}</span>
                <span className="sub">{c.regNo || 'No Reg No.'} · Year {c.year} {c.type}</span>
              </span>
              <PctBadge pct={c.pct} />
            </button>
          ))}
          {res.sessions.map((s) => (
            <button
              key={s.id}
              type="button"
              className="item"
              style={{ width: '100%', textAlign: 'left', cursor: 'pointer', border: 0 }}
              onClick={() => {
                setView({ type: 'session', ...s });
                setOpen(false);
                onNavigate?.();
              }}
            >
              <span className="avatar"><Icon name="clipboard-check" size={16} /></span>
              <span className="grow">
                <span className="name" style={{ display: 'block' }}>{fmtDate(s.date)} · {s.activity}</span>
                <span className="sub">{s.group} · {s.present}/{s.count} present</span>
              </span>
            </button>
          ))}
        </div>
      )}
      <Modal
        open={!!view}
        onClose={() => setView(null)}
        title={view?.type === 'cadet' ? view.name : view ? `${fmtDate(view.date)} · ${view.activity}` : ''}
      >
        {view?.type === 'cadet' && (
          <div className="col">
            <div className="row wrap">
              <span className="badge b-blue">Year {view.year} · {view.type}</span>
              <span className="badge b-gray">{view.regNo || 'No Reg No.'}</span>
              <PctBadge pct={view.pct} />
            </div>
            {canReports ? (
              <div className="row wrap">
                <button type="button" className="btn btn-primary" onClick={() => get(`/api/reports?type=cadet&cadetId=${view.id}&format=pdf`)}>
                  <Icon name="download" size={16} /> Download Cadet report (PDF)
                </button>
                <button type="button" className="btn" onClick={() => get(`/api/reports?type=cadet&cadetId=${view.id}&format=xlsx`)}>
                  Download Excel
                </button>
              </div>
            ) : (
              <p className="muted small">Attendance {view.pct === null ? 'not recorded yet' : `${view.pct}%`}.</p>
            )}
          </div>
        )}
        {view?.type === 'session' && (
          <div className="col">
            <div className="row wrap">
              <span className="badge b-blue">{view.group}</span>
              <span className="badge b-green">{view.present} present</span>
              <span className="badge b-red">{view.count - view.present} absent</span>
            </div>
            {view.description && <p className="muted">{view.description}</p>}
            <button type="button" className="btn btn-primary" onClick={() => get(`/api/reports?type=day&date=${view.date}&format=pdf`)}>
              <Icon name="download" size={16} /> Download Day report (PDF)
            </button>
          </div>
        )}
      </Modal>
    </div>
  );
}

export default Sidebar;
