export async function call(handler, { method = 'GET', url = '/api/x', body, cookie, params } = {}) {
  const init = { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) } };
  if (body !== undefined && method !== 'GET') init.body = JSON.stringify(body);
  const res = await handler(new Request('http://localhost' + url, init), params ? { params } : undefined);
  const ct = res.headers.get('content-type') || '';
  const out = { status: res.status, headers: res.headers, cookie: (res.headers.get('set-cookie') || '').split(';')[0] };
  if (ct.includes('application/json')) out.json = await res.json();
  else out.buffer = Buffer.from(await res.arrayBuffer());
  return out;
}
export async function flushBg() {
  for (let i = 0; i < 20; i++) {
    const n = globalThis.__bg.length; await Promise.all(globalThis.__bg);
    if (globalThis.__bg.length === n) break;
  }
  if (globalThis.__bgErrors.length) throw globalThis.__bgErrors[0];
}
export const mailTo = (addr) => globalThis.__mail.filter(m => String(m.to).includes(addr));
