// E-mail building blocks — a formal, restrained "official report" look that follows the app's navy / gold identity.
// Real glass blur does not exist in e-mail clients, so the style is clean cards on a soft gradient. Table based with
// inline CSS so it renders the same in Gmail, Outlook and Apple Mail, and stays single-column on phones.
import { UNIT } from '@/lib/brand';

export const esc = s => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI','Helvetica Neue',Roboto,Arial,sans-serif";
export const C = { navy: '#0B2A5B', navy2: '#16407F', blue: '#0A66D6', gold: '#B8912A', ink: '#1B2433', dim: '#5B6577', mute: '#8A94A6',
  line: '#E1E6EF', soft: '#F5F7FB', green: '#157A3D', greenBg: '#EAF6EE', red: '#B42318', redBg: '#FDEDEB', amber: '#9A5B00', amberBg: '#FFF4DB' };

const numeric = h => /^(#|%|yr|year|strength|present|absent|pct|total|credits)/i.test(h);

// A row of key figures separated by thin dividers (replaces the colourful tiles)
export function tile(label, value, color) {
  return `<td align="center" valign="middle" style="padding:14px 4px;border-left:1px solid ${C.line}">
    <div style="font:700 24px/1.1 ${FONT};color:${color || C.navy}">${esc(value)}</div>
    <div style="font:700 9.5px/1.2 ${FONT};letter-spacing:1.2px;color:${C.mute};margin-top:6px;text-transform:uppercase">${esc(label)}</div></td>`;
}
export function tiles(list) {
  const cells = list.map(t => tile(t[0], t[1], t[2])).join('').replace('border-left:1px solid ' + C.line, 'border-left:0');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0;background:${C.soft};border:1px solid ${C.line};border-radius:10px"><tr>${cells}</tr></table>`;
}
export function pill(text, color, bg) {
  return `<span style="display:inline-block;background:${bg};color:${color};font:700 11px/1 ${FONT};padding:4px 9px;border-radius:99px">${esc(text)}</span>`;
}
export function button(href, text) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:20px 0 4px"><tr><td align="center" style="background:${C.navy};border-radius:8px">
    <a href="${esc(href)}" style="display:inline-block;padding:12px 26px;font:600 14px/1 ${FONT};color:#ffffff;text-decoration:none">${esc(text)}</a></td></tr></table>`;
}
export function heading(text) {
  return `<div style="font:700 11px/1 ${FONT};letter-spacing:1.6px;color:${C.navy};text-transform:uppercase;margin:24px 0 10px;padding-bottom:8px;border-bottom:2px solid ${C.gold}">${esc(text)}</div>`;
}
export function dataTable(headers, rows, widths = []) {
  const th = headers.map((h, i) => `<th align="${numeric(h) ? 'center' : 'left'}" ${widths[i] ? `width="${widths[i]}"` : ''} style="padding:9px 8px;font:700 9.5px/1.2 ${FONT};letter-spacing:1px;color:#ffffff;background:${C.navy};text-transform:uppercase">${esc(h)}</th>`).join('');
  const body = rows.map((r, i) => `<tr>${r.map((c, j) => {
    const raw = typeof c === 'object' && c !== null ? c : { t: c };
    return `<td align="${raw.align || (numeric(headers[j]) ? 'center' : 'left')}" style="padding:9px 8px;border-bottom:1px solid ${C.line};font:${raw.bold ? 700 : 500} 12.5px/1.4 ${FONT};color:${raw.color || C.ink};background:${raw.bg || (i % 2 ? '#FAFBFD' : '#ffffff')}">${raw.html ?? esc(raw.t)}</td>`;
  }).join('')}</tr>`).join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${C.line};border-radius:8px;border-collapse:separate;overflow:hidden"><tr>${th}</tr>${body}</table>`;
}
// Label / value list
export function keyValues(pairs) {
  const rows = pairs.filter(Boolean).map(([k, v]) => `<tr><td style="padding:8px 0;border-bottom:1px solid ${C.line};font:700 10px/1.3 ${FONT};letter-spacing:1.1px;color:${C.mute};text-transform:uppercase;width:34%;vertical-align:top">${esc(k)}</td><td style="padding:8px 0;border-bottom:1px solid ${C.line};font:600 13px/1.45 ${FONT};color:${C.ink}">${typeof v === 'object' && v?.html ? v.html : esc(v)}</td></tr>`).join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0">${rows}</table>`;
}
export function notice(text, color = C.amber, bg = C.amberBg) {
  return `<div style="background:${bg};color:${color};border-left:4px solid ${color};border-radius:6px;padding:11px 14px;font:600 12.5px/1.5 ${FONT};margin:14px 0">${text}</div>`;
}
// Approval trail: who marked it, who approved for each side, and when
export function trail(steps) {
  const cells = steps.map(s => `<td valign="top" style="padding:10px 12px;border-left:3px solid ${s.done === false ? C.line : C.green};background:${C.soft}">
    <div style="font:700 9.5px/1.2 ${FONT};letter-spacing:1.1px;color:${C.mute};text-transform:uppercase">${esc(s.role)}</div>
    <div style="font:700 13px/1.4 ${FONT};color:${C.ink};margin-top:3px">${esc(s.name)}</div>
    <div style="font:500 11.5px/1.4 ${FONT};color:${C.dim}">${esc(s.when)}</div></td>`).join('<td width="8" style="font-size:0">&nbsp;</td>');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0"><tr>${cells}</tr></table>`;
}

// Full page. `body` is trusted HTML (callers escape their data).
export function shell({ preheader = '', eyebrow, title, subtitle = '', body, footer = '', tag = 'OFFICIAL', ref = '' }) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="color-scheme" content="light"/><meta name="x-apple-disable-message-reformatting"/>
<style>@media (max-width:520px){.card{padding:20px 16px !important}.wrap{padding:8px 4px !important}.hd{padding:18px 16px !important}.ttl{font-size:20px !important}}</style></head>
<body style="margin:0;padding:0;background:#E9EEF7">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#E9EEF7;background-image:linear-gradient(160deg,#DDE7F8 0%,#ECE9F9 55%,#DDEFF6 100%)"><tr><td align="center" class="wrap" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #D5DDEB;box-shadow:0 10px 34px rgba(11,42,91,.14)">
  <tr><td class="hd" style="padding:22px 28px;background:${C.navy};background-image:linear-gradient(135deg,${C.navy} 0%,${C.navy2} 100%)">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td valign="middle"><div style="font:800 16px/1.2 ${FONT};letter-spacing:1.4px;color:#ffffff">${esc(UNIT.wing)} &middot; ${esc(UNIT.flight)}</div>
        <div style="font:600 11px/1.3 ${FONT};letter-spacing:2px;color:#B9CCF2;margin-top:5px">${esc(UNIT.squadron)}</div></td>
      <td valign="middle" align="right"><span style="display:inline-block;font:700 9.5px/1 ${FONT};letter-spacing:1.6px;color:#E8C766;border:1px solid rgba(232,199,102,.55);border-radius:4px;padding:5px 8px">${esc(tag)}</span></td>
    </tr></table></td></tr>
  <tr><td style="height:3px;background:${C.gold};font-size:0;line-height:0">&nbsp;</td></tr>
  <tr><td class="card" style="padding:28px 28px 22px;background:#ffffff;font-family:${FONT};color:${C.ink}">
    <div style="font:700 10.5px/1 ${FONT};letter-spacing:1.8px;color:${C.mute};text-transform:uppercase">${esc(eyebrow)}</div>
    <div class="ttl" style="font:800 23px/1.25 ${FONT};color:${C.navy};margin-top:9px">${esc(title)}</div>
    ${subtitle ? `<div style="font:500 13.5px/1.5 ${FONT};color:${C.dim};margin-top:5px">${esc(subtitle)}</div>` : ''}
    ${ref ? `<div style="font:500 11px/1.4 ${FONT};color:${C.mute};margin-top:8px">Ref. ${esc(ref)}</div>` : ''}
    <div style="height:1px;background:${C.line};margin:18px 0 18px;font-size:0;line-height:0">&nbsp;</div>
    ${body}
  </td></tr>
  <tr><td style="padding:18px 28px 22px;background:${C.soft};border-top:1px solid ${C.line}">
    ${footer ? `<div style="font:500 12px/1.55 ${FONT};color:${C.dim};margin-bottom:10px">${footer}</div>` : ''}
    <div style="font:500 11px/1.6 ${FONT};color:${C.mute}">This is an automated message from <b style="color:${C.dim}">AMS</b>. Please do not reply to this e-mail.</div>
    <div style="font:700 9.5px/1.7 ${FONT};letter-spacing:1.6px;color:#98A2B3;margin-top:8px">${esc(UNIT.wing)} &middot; ${esc(UNIT.flight)} &middot; ${esc(UNIT.squadron)} &nbsp;|&nbsp; ${esc(UNIT.motto)}</div>
  </td></tr>
</table></td></tr></table></body></html>`;
}
