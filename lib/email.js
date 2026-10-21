import { sendMail, pool } from '@/lib/mailer';
import { shell, esc, tiles, dataTable, keyValues, heading, notice, button, trail, C, FONT as F } from '@/lib/email-theme';
import { UNIT, UNIT_LINE } from '@/lib/brand';
import { fmtDate, fmtDateLong, fmtDateTimeIST, fmtMonthLong, fmtTimeIST } from '@/lib/time';
import { summarize, byYear, personOrder, yearTag, normStatus } from '@/lib/groups';
import { officialRecipients, cleanEmail } from '@/lib/settings';
import { buildParadeReportPdf } from '@/lib/pdf';

const appUrl = () => (process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/$/, '');
const thumb  = u => String(u).replace('/upload/', '/upload/c_fill,w_300,h_200,q_auto,f_auto/');
const safeFile = s => String(s).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
const p = (t, extra = '') => `<p style="font:500 14px/1.65 ${F};margin:0 0 10px;color:${C.ink};${extra}">${t}</p>`;
const refOf = s => String(s || '').replace(/^(\d{4})-(\d{2})-(\d{2})_/, '$1$2$3-').toUpperCase();

// ── OTP ───────────────────────────────────────────────────────────────────────
export async function sendOtpEmail({ to, name, code, minutes = 5 }) {
  const body = `
    ${p(`Hello <b>${esc(name)}</b>,`)}
    ${p('Use the verification code below to finish signing in to AMS.', `color:${C.dim}`)}
    <table role="presentation" align="center" cellpadding="0" cellspacing="0" style="margin:22px auto"><tr><td align="center" style="background:${C.soft};border:1px solid ${C.line};border-radius:10px;padding:16px 30px">
      <div style="font:700 34px/1 'SF Mono',Menlo,Consolas,monospace;letter-spacing:10px;color:${C.navy};padding-left:10px">${esc(code)}</div></td></tr></table>
    ${notice(`This code is valid for <b>${minutes} minutes</b> and can be used only once.`, C.navy, '#EAF0FB')}
    ${p('If you did not try to sign in, ignore this message and inform the administrator — someone may know your password.', `font-size:12.5px;color:${C.dim}`)}`;
  return sendMail({
    to, kind: 'otp',
    subject: `${code} is your sign-in code — ${UNIT.wing} ${UNIT.flight}`,
    html: shell({ preheader: `Your sign-in code is ${code}`, eyebrow: 'Secure sign-in', title: 'Verification code', tag: 'SECURITY', body }),
  });
}

// ── PARADE REPORT -> Sir + backup (PDF attached) — sent only after Admin AND CTO approved ───
export async function sendParadeReport({ session, records, settings, isUpdate = false, editedBy = '' }) {
  const to = officialRecipients(settings);
  if (!to.length) return { success: false, error: 'No official email set (Settings -> Sir / backup email)' };

  const recs = records.map(r => ({ ...r, status: normStatus(r.status) })).sort(personOrder);
  const sum  = summarize(recs);
  const yrs  = byYear(recs);
  const th   = settings.thresholdPct || 75;
  const absentees = recs.filter(r => r.status === 'Absent');
  const label = session.activityDescription ? `${session.activityType} — ${session.activityDescription}` : session.activityType;
  const good = sum.pct >= th;
  const pdf = await buildParadeReportPdf({ session, records: recs, threshold: th });

  const photos = (session.photoUrls || []).slice(0, 6);
  const photoHtml = photos.length ? heading('Parade photographs') + `<table role="presentation" cellpadding="0" cellspacing="0"><tr>${photos.map(u =>
    `<td style="padding:0 6px 6px 0"><a href="${esc(u)}"><img src="${esc(thumb(u))}" width="130" style="width:130px;max-width:100%;border-radius:8px;border:1px solid ${C.line};display:block" alt="Parade photo"/></a></td>`).join('')}</tr></table>`
    : heading('Parade photographs') + p('No parade photo', `color:${C.dim}`);
  const maps = session.geoLat && session.geoLng
    ? { html: `<a href="https://maps.google.com/?q=${esc(session.geoLat)},${esc(session.geoLng)}" style="color:${C.blue};text-decoration:none">${Number(session.geoLat).toFixed(5)}, ${Number(session.geoLng).toFixed(5)}</a>` }
    : (session.isHistorical ? 'Past-date entry' : 'Not recorded');

  const ap = session.approvals || {};
  const steps = [{ role: 'Marked by', name: session.markedByName || '—', when: fmtDateTimeIST(session.createdAt) }];
  if (ap.admin) steps.push({ role: 'Approved · Admin', name: ap.admin.byName, when: fmtDateTimeIST(ap.admin.at) });
  if (ap.cto) steps.push({ role: 'Approved · CTO', name: ap.cto.byName, when: fmtDateTimeIST(ap.cto.at) });

  const body = `
    ${isUpdate ? notice(`<b>CORRECTED REPORT</b> — attendance was edited${editedBy ? ` by ${esc(editedBy)}` : ''}. This replaces the earlier report for this parade.`) : ''}
    ${p('Respected Sir,')}
    ${p(`The attendance for <b>${esc(label)}</b> (${esc(session.groupLabel)}) on <b>${esc(fmtDate(session.date))}</b> has been verified and approved by the Admin and the CTO. The complete nominal roll is attached as a PDF.`, `color:${C.dim}`)}
    ${tiles([['Strength', sum.total, C.navy], ['Present', sum.present, C.green], ['Absent', sum.absent, sum.absent ? C.red : C.dim], ['Attendance', `${sum.pct}%`, good ? C.green : C.red]])}
    ${yrs.length > 1 ? heading('Year-wise strength') + dataTable(['Group', 'Strength', 'Present', 'Absent', '%'], yrs.map(y => [{ t: y.label, bold: true }, y.total, { t: y.present, color: C.green, bold: true }, { t: y.absent, color: y.absent ? C.red : C.dim, bold: true }, { t: `${y.pct}%`, bold: true, color: y.pct >= th ? C.green : C.red }])) : ''}
    ${heading(`Absentees (${absentees.length})`)}
    ${absentees.length
      ? dataTable(['Reg No.', 'Name', 'Yr', 'Reason'], absentees.map(r => [{ t: r.cadetRegNo || 'No Reg No.', color: C.dim }, { t: r.cadetName, bold: true }, yearTag(r), { t: r.reason || r.remarks || 'Not specified', color: C.red }]), ['26%', '32%', '8%', '34%'])
      : notice('FULL ATTENDANCE — every cadet is present.', C.green, C.greenBg)}
    ${heading('Parade details')}
    ${keyValues([['Date', fmtDateLong(session.date)], ['Activity', label], ['Group', session.groupLabel], ['Location', maps]])}
    ${steps.length > 1 ? heading('Approval record') + trail(steps) : ''}
    ${photoHtml}
    ${appUrl() ? button(appUrl() + '/login', 'Open AMS') : ''}
    ${p('Respectfully,<br/><b>AMS</b> — ' + esc(UNIT.flight) + ', ' + esc(UNIT.squadron), `margin-top:18px;color:${C.dim};font-size:13px`)}`;

  const html = shell({
    preheader: `${sum.present}/${sum.total} present (${sum.pct}%) — ${label} — ${fmtDate(session.date)}`,
    eyebrow: isUpdate ? 'Corrected parade report' : 'Parade attendance report',
    title: fmtDateLong(session.date), subtitle: `${label} · ${session.groupLabel}`, tag: isUpdate ? 'CORRECTED' : 'OFFICIAL REPORT', ref: refOf(session.id),
    body, footer: `Report prepared by <b>AMS</b> at ${esc(fmtTimeIST(new Date().toISOString()))} IST${editedBy ? ` after correction by ${esc(editedBy)}` : ''}.`,
  });

  return sendMail({
    to, kind: 'parade',
    subject: `[${UNIT.wing} ${UNIT.flight}]${isUpdate ? ' CORRECTED' : ''} Parade Report — ${fmtDate(session.date)} · ${session.activityType} · ${session.groupLabel} | P:${sum.present} A:${sum.absent} (${sum.pct}%)`,
    html,
    attachments: [{ filename: safeFile(`${UNIT.wing}_${UNIT.flight}_Parade_Report_${session.date}_${session.groupLabel}.pdf`), content: pdf, contentType: 'application/pdf' }],
  });
}

// ── ABSENCE NOTICE -> each absent cadet who has an email ─────────────────────
export async function sendAbsenceNotices({ session, absentRecords, usersById, settings }) {
  if (!settings.absenceMailEnabled) return { sent: 0, skipped: absentRecords.length, failed: 0, disabled: true };
  const jobs = absentRecords.map(r => ({ r, u: usersById[r.cadetId] })).filter(x => cleanEmail(x.u?.email));
  const skipped = absentRecords.length - jobs.length;
  const label = session.activityDescription ? `${session.activityType} — ${session.activityDescription}` : session.activityType;
  const th = settings.thresholdPct || 75;

  const results = await pool(jobs, async ({ r, u }) => {
    const pct = (() => { const s = u.stats || {}; return s.total ? Math.min(100, Math.round(((s.present || 0) + (u.benefit || 0)) / s.total * 1000) / 10) : null; })();
    const low = pct !== null && pct < th;
    const body = `
      ${p(`Dear Cadet <b>${esc(r.cadetName)}</b>,`)}
      ${p(`You were marked <b style="color:${C.red}">ABSENT</b> in the attendance recorded below.`, `color:${C.dim}`)}
      ${keyValues([['Date', fmtDateLong(session.date)], ['Activity', label], ['Reg No.', r.cadetRegNo || '—'], ['Reason recorded', { html: `<b style="color:${C.red}">${esc(r.reason || r.remarks || 'Not specified')}</b>` }]])}
      ${pct !== null ? tiles([['Your attendance', `${pct}%`, low ? C.red : C.green], ['Required', `${th}%`, C.navy]]) : ''}
      ${low ? notice('Your attendance is below the required minimum. Please attend regularly and speak to the Care Taker Officer.', C.red, C.redBg) : ''}
      ${p('If this record is wrong, inform the Care Taker Officer or your attendance marker so that it can be corrected.', `font-size:12.5px;color:${C.dim}`)}
      ${p('Regards,<br/><b>AMS</b> — ' + esc(UNIT.flight) + ', ' + esc(UNIT.squadron), `margin-top:16px;color:${C.dim};font-size:13px`)}`;
    return sendMail({
      to: cleanEmail(u.email), kind: 'absence', silent: true,
      subject: `Absence notice — ${fmtDate(session.date)} · ${session.activityType} | ${UNIT.wing} ${UNIT.flight}`,
      html: shell({ preheader: `You were marked absent on ${fmtDate(session.date)}`, eyebrow: 'Absence notice', title: 'You were marked absent', subtitle: `${fmtDate(session.date)} · ${label}`, tag: 'NOTICE', body }),
    });
  }, 3);
  const sent = results.filter(x => x.success).length;
  return { sent, skipped, failed: results.length - sent, firstError: results.find(x => !x.success)?.error };
}

// ── CHANGE LOG -> Sir + backup ──────────────────────────────────────────────
// changes: [{ name, regNo, from, to, reason }]
export async function sendChangeLog({ settings, kind, byName, date, activity = '', group = '', changes = [], note = '', reportSession = null, reportRecords = null }) {
  if (!settings.changeMailEnabled) return { success: true, disabled: true };
  const to = officialRecipients(settings);
  if (!to.length) return { success: false, error: 'No official email set' };
  const titles = { edit: 'Attendance edited', delete: 'Attendance deleted', benefit: 'Attendance benefit', 'benefit-remove': 'Benefit removed' };
  const rows = changes.slice(0, 80).map(c => [{ t: c.regNo || '—', color: C.dim }, { t: c.name, bold: true }, { t: c.from ?? '—', color: C.dim }, { t: c.to ?? '—', bold: true, color: /absent|delet|remov/i.test(String(c.to)) ? C.red : C.green }, { t: c.reason || '' }]);
  const body = `
    ${p('Respected Sir,')}
    ${p('A change was made to the attendance records. Every change is logged for audit.', `color:${C.dim}`)}
    ${keyValues([['Action', titles[kind] || kind], ['Changed by', byName], ['When', fmtDateTimeIST(new Date().toISOString())], date ? ['Parade date', fmtDateLong(date)] : null, activity ? ['Activity', `${activity}${group ? ' · ' + group : ''}`] : null, note ? ['Note', note] : null])}
    ${heading(`Changes (${changes.length})`)}
    ${dataTable(['Reg No.', 'Cadet', 'Before', 'After', 'Reason'], rows)}
    ${changes.length > 80 ? p(`…and ${changes.length - 80} more. See the Change Log in AMS.`, `font-size:12px;color:${C.dim}`) : ''}
    ${notice('If you did not expect this change, open the Change Log in AMS and contact the administrator.', C.navy, '#EAF0FB')}`;
  let attachments = [];
  if (reportSession && reportRecords?.length) {
    try {
      const pdf = await buildParadeReportPdf({ session: reportSession, records: reportRecords, threshold: settings.thresholdPct || 75 });
      attachments = [{ filename: safeFile(`${UNIT.flight}_CORRECTED_Parade_Report_${reportSession.date}.pdf`), content: pdf, contentType: 'application/pdf' }];
    } catch (e) { console.error('[MAIL] corrected PDF failed:', e.message); }
  }
  return sendMail({
    to, kind: 'changelog', attachments,
    subject: `[${UNIT.flight}] ${titles[kind] || 'Attendance change'}${date ? ' — ' + fmtDate(date) : ''} · by ${byName} (${changes.length})`,
    html: shell({ preheader: `${titles[kind] || 'Change'} by ${byName}`, eyebrow: 'Attendance change log', title: titles[kind] || 'Attendance change', subtitle: `by ${byName}`, tag: 'AUDIT', ref: refOf(reportSession?.id),
      body: body + (attachments.length ? notice('The corrected parade report is attached as a PDF.', C.green, C.greenBg) : '') }),
  });
}

// ── PERIOD SUMMARY (monthly / weekly) -> Sir + backup (PDF attached) ───────────
export async function sendPeriodSummary({ settings, kind = 'Monthly', label, stats, pdf, fileTag }) {
  const to = officialRecipients(settings);
  if (!to.length) return { success: false, error: 'No official email set' };
  const th = settings.thresholdPct || 75;
  const low = stats.cadets.filter(c => c.pct !== null && c.pct < th).sort((a, b) => a.pct - b.pct);
  const best = [...stats.cadets].filter(c => c.pct !== null).sort((a, b) => b.pct - a.pct).slice(0, 5);
  const body = `
    ${p('Respected Sir,')}
    ${p(`${esc(kind)} attendance summary for <b>${esc(label)}</b>. The detailed cadet-wise report is attached as a PDF.`, `color:${C.dim}`)}
    ${tiles([['Parades held', stats.sessions, C.navy], ['Avg attendance', `${stats.avg}%`, stats.avg >= th ? C.green : C.red], [`Below ${th}%`, low.length, low.length ? C.red : C.green]])}
    ${heading(`Cadets below ${th}% (overall, this cycle)`)}
    ${low.length ? dataTable(['Reg No.', 'Cadet', 'Yr', '%'], low.slice(0, 40).map(c => [{ t: c.regNo || '—', color: C.dim }, { t: c.name, bold: true }, c.year ? `Y${c.year}` : 'Sr', { t: `${c.pct}%`, bold: true, color: C.red }])) : notice('Every cadet is at or above the required attendance.', C.green, C.greenBg)}
    ${best.length ? heading('Highest attendance') + dataTable(['Reg No.', 'Cadet', 'Yr', '%'], best.map(c => [{ t: c.regNo || '—', color: C.dim }, { t: c.name, bold: true }, c.year ? `Y${c.year}` : 'Sr', { t: `${c.pct}%`, bold: true, color: C.green }])) : ''}
    ${p('Respectfully,<br/><b>AMS</b> — ' + esc(UNIT.flight) + ', ' + esc(UNIT.squadron), `margin-top:18px;color:${C.dim};font-size:13px`)}`;
  return sendMail({
    to, kind: kind.toLowerCase(),
    subject: `[${UNIT.wing} ${UNIT.flight}] ${kind} Attendance Summary — ${label}`,
    html: shell({ preheader: `${stats.sessions} parades · average ${stats.avg}%`, eyebrow: `${kind} summary`, title: label, subtitle: UNIT.squadron, tag: 'SUMMARY', body }),
    attachments: pdf ? [{ filename: safeFile(`${UNIT.flight}_${kind}_Report_${fileTag || label}.pdf`), content: pdf, contentType: 'application/pdf' }] : [],
  });
}

export async function sendTestEmail(to) {
  const body = `${p('The e-mail system of AMS is working correctly.')}
    ${tiles([['SMTP', 'OK', C.green], ['Login', 'OK', C.green], ['Delivery', 'OK', C.green]])}
    ${p(`Sent ${esc(fmtDateTimeIST(new Date().toISOString()))}`, `font-size:12.5px;color:${C.dim}`)}`;
  return sendMail({ to, kind: 'test', subject: `System test — ${UNIT_LINE}`, html: shell({ eyebrow: 'System test', title: 'E-mail is working', tag: 'TEST', body }) });
}
