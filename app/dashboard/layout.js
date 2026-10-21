'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { UIProvider, useUI, api, Spinner, initials } from '@/app/components/ui';
import { Icon } from '@/app/components/Icon';
import { UserCtx, hasPerm } from '@/app/components/user';
import { useRealtimeData } from '@/lib/useRealtimeData';
import { listQueue, syncQueue } from '@/lib/offlineQueue';
import Sidebar from '@/app/components/shell/Sidebar';
import MobileHeader from '@/app/components/shell/MobileHeader';
import BottomBar from '@/app/components/shell/BottomBar';

export default function DashboardLayout({ children }) {
  return (
    <UIProvider>
      <Shell>{children}</Shell>
    </UIProvider>
  );
}

// ── spoken welcome (administrator only) ───────────────────────────────────────
function pickVoice(synth) {
  const voices = synth.getVoices();
  if (!voices.length) return null;
  const score = (v) => {
    let s = 0;
    if (/^en[-_]IN/i.test(v.lang)) s += 6;
    else if (/^en[-_](GB|AU|US)/i.test(v.lang)) s += 3;
    else if (/^en/i.test(v.lang)) s += 1;
    else return -1;
    if (/natural|neural|online/i.test(v.name)) s += 6;
    if (/google/i.test(v.name)) s += 3;
    if (/aria|jenny|neerja|prabhat|sonia|ryan|samantha|rishi|veena|serena|daniel|karen|moira/i.test(v.name)) s += 2;
    return s;
  };
  return [...voices].sort((a, b) => score(b) - score(a))[0];
}

function speak(text) {
  const synth = typeof window !== 'undefined' && window.speechSynthesis;
  if (!synth) return;
  const go = () => {
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const v = pickVoice(synth);
    if (v) {
      u.voice = v;
      u.lang = v.lang;
    } else {
      u.lang = 'en-IN';
    }
    u.rate = 0.95;
    u.pitch = 1;
    u.volume = 1;
    synth.speak(u);
  };
  if (synth.getVoices().length) go();
  else {
    synth.onvoiceschanged = () => {
      synth.onvoiceschanged = null;
      go();
    };
    setTimeout(go, 700);
  }
}

function Shell({ children }) {
  const router = useRouter();
  const pathname = usePathname();
  const { toast } = useUI();
  const [user, setUser] = useState(null);
  const [theme, setTheme] = useState('light');
  const [welcome, setWelcome] = useState(false);
  const [muted, setMuted] = useState(false);
  const [online, setOnline] = useState(true);
  const [pending, setPending] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [railExpanded, setRailExpanded] = useState(false);

  // who am I?
  useEffect(() => {
    api('/api/me').then((r) => {
      if (!r.ok || !r.data?.user) return router.replace('/login');
      const u = r.data.user;
      if (u.mustChangePassword) return router.replace('/change-password');
      setUser(u);
      try {
        setMuted(localStorage.getItem('ncc_voice') === 'off');
        setRailExpanded(localStorage.getItem('ncc_rail_expanded') === 'true');
        if (!sessionStorage.getItem('ncc_greeted')) {
          sessionStorage.setItem('ncc_greeted', '1');
          setWelcome(true);
          setTimeout(() => setWelcome(false), 4800);
          // Voice is for the administrator only, spoken once per sign-in
          if (u.role === 'admin' && localStorage.getItem('ncc_voice') !== 'off') {
            speak(`Jai Hind. Welcome, ${u.name}. Administrator access granted.`);
          }
        }
      } catch {
        /* storage blocked */
      }
    });
    setTheme(document.documentElement.getAttribute('data-theme') || 'light');
    if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
  }, [router]);

  // Close drawer on path change
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  // offline queue: count + auto sync
  const refreshPending = useCallback(async () => {
    setPending((await listQueue()).filter((i) => i.status !== 'failed').length);
  }, []);

  const doSync = useCallback(
    async (manual) => {
      setSyncing(true);
      const r = await syncQueue();
      setSyncing(false);
      await refreshPending();
      if (r.sent) toast(`${r.sent} saved attendance sent successfully`, 'ok');
      if (r.failed) toast('One saved attendance was rejected — open Mark -> Saved on this phone.', 'err');
      if (manual && !r.sent && !r.failed) toast(navigator.onLine ? 'Nothing left to send.' : 'Still offline.', 'info');
    },
    [toast, refreshPending]
  );

  useEffect(() => {
    if (!user) return;
    setOnline(navigator.onLine);
    refreshPending();
    doSync(false);
    const on = () => {
      setOnline(true);
      doSync(false);
    };
    const off = () => setOnline(false);
    const vis = () => document.visibilityState === 'visible' && (refreshPending(), doSync(false));
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    document.addEventListener('visibilitychange', vis);
    window.addEventListener('ncc-queue-changed', refreshPending);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
      document.removeEventListener('visibilitychange', vis);
      window.removeEventListener('ncc-queue-changed', refreshPending);
    };
  }, [user, doSync, refreshPending]);

  // Live approval count polling for Admin and CTO
  const canApprove = (user?.role === 'admin' || user?.role === 'cto') && hasPerm(user, 'canApproveAttendance');
  const { data: counts } = useRealtimeData(canApprove ? '/api/approvals?summary=1' : null, 6000);
  const needsMe = counts?.needsMe || 0;
  const lastNeeds = useRef(null);

  useEffect(() => {
    if (!counts) return;
    if (lastNeeds.current !== null && counts.needsMe > lastNeeds.current) {
      const diff = counts.needsMe - lastNeeds.current;
      const approvalsHref = user?.role === 'cto' ? '/dashboard/cto/approvals' : '/dashboard/admin/approvals';
      toast(
        <span>
          {diff} new attendance submission{diff > 1 ? 's' : ''} waiting for your approval.{' '}
          <Link href={approvalsHref} style={{ fontWeight: 600, textDecoration: 'underline', color: 'inherit' }}>
            Review
          </Link>
        </span>,
        'info',
        7000
      );
    }
    lastNeeds.current = counts.needsMe;
  }, [counts, toast, user]);

  function flipTheme() {
    const t = theme === 'dark' ? 'light' : 'dark';
    setTheme(t);
    document.documentElement.setAttribute('data-theme', t);
    try {
      localStorage.setItem('ncc_theme', t);
    } catch {}
  }

  function flipVoice() {
    const m = !muted;
    setMuted(m);
    try {
      localStorage.setItem('ncc_voice', m ? 'off' : 'on');
    } catch {}
    if (m) window.speechSynthesis?.cancel();
    else speak('Voice greeting turned on.');
  }

  function toggleRail() {
    const n = !railExpanded;
    setRailExpanded(n);
    try {
      localStorage.setItem('ncc_rail_expanded', String(n));
    } catch {}
  }

  async function logout() {
    try {
      sessionStorage.removeItem('ncc_greeted');
    } catch {}
    window.speechSynthesis?.cancel();
    await api('/api/auth/logout', { method: 'POST' });
    router.replace('/login');
  }

  if (!user) {
    return (
      <div style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center' }}>
        <Spinner />
      </div>
    );
  }

  // Derive mobile header title from pathname
  const getMobileTitle = () => {
    const segs = pathname.split('/').filter(Boolean);
    const last = segs[segs.length - 1];
    if (!last || last === 'dashboard') return 'NCC AMS';
    const names = {
      overview: 'Overview',
      approvals: 'Approvals',
      mark: 'Mark attendance',
      records: 'Records',
      attendance: 'Records',
      people: hasPerm(user, 'canManageUsers') ? 'People' : 'Cadets',
      reports: 'Reports',
      benefits: 'Benefits',
      sheet: 'Google Sheet',
      health: 'System health',
      settings: 'Settings',
      promotion: 'Promotion',
      roles: 'Roles',
      log: 'Change log',
      history: 'History & status',
      cadet: 'My attendance',
      leaderboard: 'Leaderboard',
      calendar: 'Calendar',
    };
    return names[last] || (last.charAt(0).toUpperCase() + last.slice(1));
  };

  const approvalsPath = user.role === 'cto' ? '/dashboard/cto/approvals' : '/dashboard/admin/approvals';

  return (
    <UserCtx.Provider value={user}>
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>

      <div className="app-shell">
        <Sidebar
          user={user}
          needsMe={needsMe}
          theme={theme}
          onFlipTheme={flipTheme}
          muted={muted}
          onFlipVoice={flipVoice}
          onLogout={logout}
          drawerOpen={drawerOpen}
          onCloseDrawer={() => setDrawerOpen(false)}
          railExpanded={railExpanded}
          onToggleRail={toggleRail}
        />

        <div className={`app-main ${railExpanded ? 'rail-expanded' : ''}`}>
          <MobileHeader
            title={getMobileTitle()}
            user={user}
            onOpenDrawer={() => setDrawerOpen(true)}
          />

          <main id="main-content" className="content-wrap" tabIndex={-1}>
            {welcome && <div className="welcome">Jai Hind, {user.name}</div>}

            {!online && (
              <div className="banner warn mb">
                <Icon name="wifi-off" size={16} />
                <span>
                  You are offline. You can still mark attendance — it is saved on this phone and sent when you are back online.
                </span>
              </div>
            )}

            {pending > 0 && (
              <div className="banner info mb">
                <Icon name="clock" size={16} />
                <span>
                  {pending} attendance record{pending > 1 ? 's' : ''} saved on this phone, waiting to be sent.
                </span>
                <button
                  type="button"
                  className="btn btn-sm btn-primary right"
                  onClick={() => doSync(true)}
                  disabled={syncing || !online}
                >
                  {syncing ? <Spinner /> : 'Send now'}
                </button>
              </div>
            )}

            {canApprove && needsMe > 0 && !pathname.endsWith('/approvals') && (
              <div className="banner warn mb">
                <Icon name="clock" size={16} />
                <span>
                  {needsMe} attendance submission{needsMe > 1 ? 's are' : ' is'} waiting for your approval.
                </span>
                <Link href={approvalsPath} className="btn btn-sm btn-primary right">
                  Review
                </Link>
              </div>
            )}

            {children}
          </main>

          <BottomBar
            user={user}
            needsMe={needsMe}
            onOpenDrawer={() => setDrawerOpen(true)}
          />
        </div>
      </div>
    </UserCtx.Provider>
  );
}
