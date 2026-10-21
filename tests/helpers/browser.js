// Runs the real UI inside jsdom and routes every fetch() to the real API route handlers
// (backed by the in-memory database), with a proper cookie jar — so screens are tested end to end.
import 'fake-indexeddb/auto';
import { TextEncoder as NodeTextEncoder } from 'node:util';

import * as loginR from '@/app/api/auth/login/route';
import * as otpR from '@/app/api/auth/verify-otp/route';
import * as resendR from '@/app/api/auth/resend-otp/route';
import * as cpR from '@/app/api/auth/change-password/route';
import * as logoutR from '@/app/api/auth/logout/route';
import * as meR from '@/app/api/me/route';
import * as syncR from '@/app/api/sync/route';
import * as cadetsR from '@/app/api/cadets/route';
import * as cadetIdR from '@/app/api/cadets/[id]/route';
import * as attR from '@/app/api/attendance/route';
import * as auditR from '@/app/api/attendance/audit/route';
import * as photoR from '@/app/api/attendance/upload-photo/route';
import * as benR from '@/app/api/benefits/route';
import * as setR from '@/app/api/settings/route';
import * as repR from '@/app/api/reports/route';
import * as promoR from '@/app/api/cadets/promote/route';
import * as healthR from '@/app/api/health/route';
import * as overR from '@/app/api/overview/route';
import * as boardR from '@/app/api/leaderboard/route';
import * as metaR from '@/app/api/meta/route';
import * as searchR from '@/app/api/search/route';
import * as rolesR from '@/app/api/roles/route';
import * as pingR from '@/app/api/ping/route';
import * as apprR from '@/app/api/approvals/route';

const routes = { '/api/auth/login': loginR, '/api/auth/verify-otp': otpR, '/api/auth/resend-otp': resendR, '/api/auth/change-password': cpR, '/api/auth/logout': logoutR,
  '/api/me': meR, '/api/sync': syncR, '/api/cadets': cadetsR, '/api/attendance': attR, '/api/attendance/audit': auditR, '/api/attendance/upload-photo': photoR,
  '/api/benefits': benR, '/api/settings': setR, '/api/reports': repR, '/api/cadets/promote': promoR, '/api/health': healthR, '/api/overview': overR,
  '/api/leaderboard': boardR, '/api/meta': metaR, '/api/search': searchR, '/api/roles': rolesR, '/api/ping': pingR, '/api/approvals': apprR };

export const jar = { cookie: '' };
export const calls = [];

export function installBrowser() {
  globalThis.TextEncoder = NodeTextEncoder;     // jsdom's TextEncoder returns a foreign Uint8Array that `jose` rejects (test-only quirk)
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url, 'http://localhost');
    const method = (init.method || 'GET').toUpperCase();
    let mod = routes[url.pathname], params;
    const m = url.pathname.match(/^\/api\/cadets\/([^/]+)$/);
    if (!mod && m) { mod = cadetIdR; params = { id: m[1] }; }
    if (!mod) throw new Error(`UI called an API that does not exist: ${method} ${url.pathname}`);
    const handler = mod[method];
    if (!handler) throw new Error(`UI used ${method} on ${url.pathname} which is not implemented`);
    const headers = new Headers(init.headers || {}); if (jar.cookie) headers.set('cookie', jar.cookie);
    const req = new Request(url.href, { method, headers, body: method === 'GET' ? undefined : init.body });
    let res;
    try { res = await handler(req, params ? { params } : undefined); } catch (e) { console.error('API HANDLER THREW', method, url.pathname, e); throw e; }
    const sc = res.headers.get('set-cookie');
    if (sc) { const kv = sc.split(';')[0]; jar.cookie = /=$/.test(kv) ? '' : kv; }
    calls.push(`${method} ${url.pathname}${url.search}`);
    return res;
  };
  window.matchMedia ||= () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  window.scrollTo = () => {};
  URL.createObjectURL = () => 'blob:test'; URL.revokeObjectURL = () => {};
  const speech = []; window.speechSynthesis = { speak: u => speech.push(u.text), cancel() {}, getVoices: () => [{ name: 'Microsoft Neerja Online (Natural)', lang: 'en-IN' }, { name: 'Robot', lang: 'en-US' }], onvoiceschanged: null };
  window.SpeechSynthesisUtterance = function (t) { this.text = t; };
  navigator.geolocation = { getCurrentPosition: ok => ok({ coords: { latitude: 12.9141, longitude: 74.856, accuracy: 8 } }) };
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  return { speech };
}
