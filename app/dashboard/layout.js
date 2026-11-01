'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { UIProvider, useUI, api, Spinner, initials } from '@/app/components/ui';
import { Icon } from '@/app/components/Icon';
import { UserCtx, hasPerm } from '@/app/components/user';
import { useRealtimeData } from '@/lib/useRealtimeData';
import { clearTab } from '@/lib/tab';
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
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [railExpanded, setRailExpanded] = useState(false);
  const [navPending, setNavPending] = useState(null);
  const fallbackTimer = useRef(null);

  // Optimistic navigation handler with 3-second fallback
  const handleNavigate = useCallback((href) => {
    if (!href || href === pathname) return;
    setNavPending(href);
    if (fallbackTimer.current) clearTimeout(fallbackTimer.current);
    fallbackTimer.current = setTimeout(() => {
      if (typeof window !== 'undefined') {
        window.location.assign(href);
      }
    }, 3000);
  }, [pathname]);

  // Clear optimistic state when pathname changes
  useEffect(() => {
    setNavPending(null);
    if (fallbackTimer.current) {
      clearTimeout(fallbackTimer.current);
      fallbackTimer.current = null;
    }
  }, [pathname]);

  useEffect(() => {
    return () => {
      if (fallbackTimer.current) clearTimeout(fallbackTimer.current);
    };
  }, []);

  // Session expiry tracking & warnings
  const [expiresAt, setExpiresAt] = useState(null);
  const [serverOffset, setServerOffset] = useState(0);
  const [remainingSec, setRemainingSec] = useState(null);
  const toasted1m = useRef(false);
  const timingOut = useRef(false);

  // who am I?
  useEffect(() => {
    api('/api/me').then((r) => {
      if (!r.ok || !r.data?.user) return router.replace('/login');
      const u = r.data.user;
      if (u.mustChangePassword) return router.replace('/change-password');
      setUser(u);
      try {
        if (u.id) sessionStorage.setItem('ncc_uid', u.id);
      } catch {}

      if (r.data.expiresAt) {
        setExpiresAt(r.data.expiresAt);
        const offset = r.data.serverNow ? (r.data.serverNow - Date.now()) : 0;
        setServerOffset(offset);
      }

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

  // Session timer
  useEffect(() => {
    if (!expiresAt) return;
    const tick = () => {
      const estimatedServerNow = Date.now() + serverOffset;
      const diffMs = expiresAt - estimatedServerNow;
      const sec = Math.max(0, Math.ceil(diffMs / 1000));
      setRemainingSec(sec);

      if (sec <= 60 && sec > 0 && !toasted1m.current) {
        toasted1m.current = true;
        toast('You will be signed out in 1:00 for security. Submit your attendance now.', 'err');
      }

      if (sec === 0 && !timingOut.current) {
        timingOut.current = true;
        api('/api/auth/logout', { method: 'POST' }).finally(() => {
          clearTab();
          router.replace('/login?reason=timeout');
        });
      }
    };

    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [expiresAt, serverOffset, router, toast]);

  // Close drawer on path change
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  // Online / offline tracking
  useEffect(() => {
    if (!user) return;
    setOnline(navigator.onLine);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, [user]);

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

  // Toggle rail expansion
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
      if (user?.id) sessionStorage.removeItem(`ncc_draft_${user.id}`);
      clearTab();
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
      help: 'Help',
    };
    return names[last] || (last.charAt(0).toUpperCase() + last.slice(1));
  };

  const approvalsPath = user.role === 'cto' ? '/dashboard/cto/approvals' : '/dashboard/admin/approvals';

  return (
    <UserCtx.Provider value={user}>
      {navPending && (
        <div
          className="nav-progress-bar"
          role="progressbar"
          aria-label="Loading page"
        />
      )}
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
          navPending={navPending}
          onNavigate={handleNavigate}
        />

        <div className={`app-main ${railExpanded ? 'rail-expanded' : ''}`}>
          <MobileHeader
            title={getMobileTitle()}
            user={user}
            onOpenDrawer={() => setDrawerOpen(true)}
          />

          <main id="main-content" className="content-wrap" tabIndex={-1}>
            {welcome && <div className="welcome">Jai Hind, {user.name}</div>}

            {remainingSec !== null && remainingSec <= 300 && remainingSec > 0 && (
              <div className="banner warn mb" role="alert">
                <Icon name="alert-triangle" size={16} />
                <span>
                  You will be signed out in {Math.floor(remainingSec / 60)}:{String(remainingSec % 60).padStart(2, '0')} for security. Submit your attendance now.
                </span>
              </div>
            )}

            {!online && (
              <div className="banner warn mb">
                <Icon name="wifi-off" size={16} />
                <span>
                  You are offline. Attendance can only be submitted when you are connected.
                </span>
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
            navPending={navPending}
            onNavigate={handleNavigate}
          />
        </div>
      </div>
    </UserCtx.Provider>
  );
}
