import nodemailer from 'nodemailer';
import { logEvent } from '@/lib/events';
import { UNIT } from '@/lib/brand';

let transporter = null;
let keyUsed = '';

export function mailConfigured() {
  return !!(process.env.EMAIL_USER && process.env.EMAIL_PASS);
}

function getTransporter() {
  const key = [process.env.EMAIL_HOST, process.env.EMAIL_PORT, process.env.EMAIL_USER, process.env.EMAIL_PASS].join('|');
  if (transporter && key === keyUsed) return transporter;
  const port = parseInt(process.env.EMAIL_PORT || '587', 10);
  transporter = nodemailer.createTransport({
    host:   process.env.EMAIL_HOST || 'smtp.gmail.com',
    port,
    secure: port === 465,
    pool:   true,                 // keep the SMTP connection warm — avoids a fresh handshake per mail
    maxConnections: 3,
    maxMessages:    50,
    auth:   { user: (process.env.EMAIL_USER || '').trim(), pass: (process.env.EMAIL_PASS || '').replace(/[\s"']/g, '') },
    connectionTimeout: 12000,
    greetingTimeout:   8000,
    socketTimeout:     25000,
  });
  keyUsed = key;
  return transporter;
}

const plain = html => String(html)
  .replace(/<style[\s\S]*?<\/style>/gi, '')
  .replace(/<br\s*\/?>|<\/tr>|<\/p>|<\/div>/gi, '\n')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();

// Send one message. Never throws. Records failures for the health panel.
export async function sendMail({ to, subject, html, attachments = [], kind = 'mail', silent = false }) {
  const recipients = [].concat(to || []).filter(Boolean);
  if (!mailConfigured()) return { success: false, error: 'EMAIL_USER / EMAIL_PASS not configured' };
  if (!recipients.length) return { success: false, error: 'No recipient' };
  const t0 = Date.now();
  const attempt = () => getTransporter().sendMail({
    from: `"${UNIT.wing} ${UNIT.flight}" <${(process.env.EMAIL_USER || '').trim()}>`,
    to: recipients.join(', '), subject, html, text: plain(html), attachments,
  });
  try {
    try { await attempt(); }
    catch (e) {
      if (/ECONN|ETIMEDOUT|ESOCKET|EAI_AGAIN|421|450|451|452/.test(`${e.code} ${e.message}`)) { transporter = null; await attempt(); }
      else throw e;
    }
    if (!silent) await logEvent({ type: `email:${kind}`, ok: true, ms: Date.now() - t0, message: `to ${recipients.length} recipient(s)` });
    return { success: true };
  } catch (e) {
    console.error(`[MAIL:${kind}]`, e.message);
    await logEvent({ type: `email:${kind}`, ok: false, ms: Date.now() - t0, message: e.message });
    return { success: false, error: e.message };
  }
}

// Run an array of async jobs with limited concurrency
export async function pool(items, worker, size = 3) {
  const results = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) { const idx = i++; results[idx] = await worker(items[idx], idx); }
  }));
  return results;
}

export async function verifyMail() {
  if (!mailConfigured()) return { ok: false, message: 'EMAIL_USER / EMAIL_PASS not configured' };
  const t0 = Date.now();
  try { await getTransporter().verify(); return { ok: true, ms: Date.now() - t0, message: `SMTP ready (${process.env.EMAIL_HOST || 'smtp.gmail.com'})` }; }
  catch (e) { return { ok: false, ms: Date.now() - t0, message: e.message }; }
}
