'use client';
import { useState, useEffect, useMemo } from 'react';
import { useRealtimeData } from '@/lib/useRealtimeData';
import { api, download, useUI, Skeleton, Switch, Spinner, Field } from '@/app/components/ui';
import Icon from '@/app/components/Icon';
import { useUser, hasPerm } from '@/app/components/user';
import { normalizeRegNo } from '@/lib/keys.mjs';

export default function SettingsPanel() {
  const me = useUser(); const { toast } = useUI();
  const canEdit = hasPerm(me, 'canManageSettings');
  const { data, loading, refresh } = useRealtimeData('/api/settings', 0);
  const [f, setF] = useState(null); const [saving, setSaving] = useState(false); const [testing, setTesting] = useState(false); const [downloading, setDownloading] = useState(false); const [downloadingPdf, setDownloadingPdf] = useState(false); const [newReason, setNewReason] = useState('');
  const [testReg, setTestReg] = useState('');
  useEffect(() => { if (data) setF({ ...data.settings }); }, [data]);

  const testMatches = useMemo(() => {
    if (!testReg.trim()) return null;
    try {
      const re = new RegExp(f?.regNoPattern || '^KA\\d{4}(SD|SW)AF\\d{7}$');
      return re.test(normalizeRegNo(testReg));
    } catch (_) {
      return false;
    }
  }, [f?.regNoPattern, testReg]);

  if (loading && !data) return <Skeleton n={3} h={140} />;
  if (!f) return null;
  const set = (k, v) => setF(s => ({ ...s, [k]: v }));

  async function save() {
    setSaving(true);
    const r = await api('/api/settings', { method: 'PUT', body: {
      sirEmail: f.sirEmail, backupEmail: f.backupEmail, thresholdPct: f.thresholdPct,
      absentReasons: f.absentReasons, absenceMailEnabled: f.absenceMailEnabled,
      changeMailEnabled: f.changeMailEnabled, monthlyMailEnabled: f.monthlyMailEnabled,
      weeklyBackupMailEnabled: f.weeklyBackupMailEnabled !== false,
      requirePhotos: f.requirePhotos !== false, mailRouting: f.mailRouting,
      regNoPattern: f.regNoPattern,
    } });
    setSaving(false);
    if (!r.ok) return toast(r.error, 'err'); toast('Settings saved.', 'ok'); refresh();
  }
  async function test() {
    setTesting(true); const r = await api('/api/health', { method: 'POST', body: {} }); setTesting(false);
    if (!r.ok || !r.data?.success) return toast(`Test mail failed: ${r.error || r.data?.error}`, 'err', 8000);
    toast(`Test email sent to ${r.data.to} (${r.data.ms} ms).`, 'ok');
  }
  async function downloadBackup() {
    setDownloading(true);
    const r = await download('/api/backup');
    setDownloading(false);
    if (!r.ok) toast(r.error || 'Backup download failed', 'err');
  }
  async function downloadBackupPdf() {
    setDownloadingPdf(true);
    const r = await download('/api/backup?format=pdf');
    setDownloadingPdf(false);
    if (!r.ok) toast(r.error || 'Backup PDF download failed', 'err');
  }
  const addReason = () => { const v = newReason.trim(); if (!v || f.absentReasons.includes(v)) return; set('absentReasons', [...f.absentReasons, v]); setNewReason(''); };
  const dis = !canEdit;

  return (
    <div className="stack">
      <div className="card col" style={{ gap: 16 }}>
        <div><h2 className="h2">Official emails</h2><p className="muted small mt-s">Parade reports (with PDF), every attendance change, benefits and the monthly summary go to both addresses.</p></div>
        <div className="grid g2">
          <Field label="Sir's email"><input className="input" type="email" inputMode="email" autoCapitalize="none" value={f.sirEmail || ''} onChange={e => set('sirEmail', e.target.value)} disabled={dis} placeholder="sir@example.com" /></Field>
          <Field label="Backup email"><input className="input" type="email" inputMode="email" autoCapitalize="none" value={f.backupEmail || ''} onChange={e => set('backupEmail', e.target.value)} disabled={dis} placeholder="backup@example.com" /></Field>
        </div>
        {canEdit && <button className="btn btn-sm" style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 6 }} onClick={test} disabled={testing}>{testing ? <Spinner /> : <><Icon name="mail" size={14} /> Send a test email</>}</button>}
      </div>

      <div className="card col" style={{ gap: 12 }}>
        <div>
          <h2 className="h2">Who receives which e-mail</h2>
          <p className="muted small mt-s">Choose which recipients receive each type of automated report.</p>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              <th style={{ padding: '8px 12px' }}></th>
              <th style={{ padding: '8px 12px' }}>
                <div>Sir</div>
                <div className="hint" style={{ fontWeight: 'normal' }}>{f.sirEmail || 'No address set'}</div>
              </th>
              <th style={{ padding: '8px 12px' }}>
                <div>Backup address</div>
                <div className="hint" style={{ fontWeight: 'normal' }}>{f.backupEmail || 'No address set'}</div>
              </th>
            </tr>
          </thead>
          <tbody>
            {[
              ['parade', 'Parade report (each approved parade)'],
              ['changes', 'Change log (edits, deletes, benefits)'],
              ['weekly', 'Weekly digest'],
              ['monthly', 'Monthly report'],
              ['backup', 'Weekly data backup'],
            ].map(([k, label]) => {
              const isBackup = k === 'backup';
              const sirChecked = !isBackup && !!f.mailRouting?.[k]?.sir;
              const backupChecked = !!f.mailRouting?.[k]?.backup;
              return (
                <tr key={k} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  <td style={{ padding: '10px 12px' }}>
                    <div className="bold">{label}</div>
                    {isBackup && (
                      <div className="hint">The backup contains personal data and goes to the backup address only.</div>
                    )}
                  </td>
                  <td style={{ padding: '10px 12px', verticalAlign: 'middle' }}>
                    <input
                      type="checkbox"
                      checked={sirChecked}
                      disabled={dis || isBackup}
                      onChange={e => {
                        const checked = e.target.checked;
                        setF(s => ({
                          ...s,
                          mailRouting: {
                            ...s.mailRouting,
                            [k]: { ...(s.mailRouting?.[k] || {}), sir: checked },
                          },
                        }));
                      }}
                    />
                  </td>
                  <td style={{ padding: '10px 12px', verticalAlign: 'middle' }}>
                    <input
                      type="checkbox"
                      checked={backupChecked}
                      disabled={dis}
                      onChange={e => {
                        const checked = e.target.checked;
                        setF(s => ({
                          ...s,
                          mailRouting: {
                            ...s.mailRouting,
                            [k]: { ...(s.mailRouting?.[k] || {}), backup: checked },
                          },
                        }));
                      }}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="card col" style={{ gap: 12 }}>
        <h2 className="h2">Automatic emails</h2>
        {[
          ['absenceMailEnabled', 'Absence notice to the cadet', 'A mail to each absent cadet (only if an email is in the sheet).'],
          ['changeMailEnabled', 'Change log to Sir + backup', 'Whenever attendance is edited, deleted, or a benefit is given.'],
          ['monthlyMailEnabled', 'Monthly summary to Sir + backup', 'On the 1st of each month, with the monthly report PDF.'],
          ['weeklyBackupMailEnabled', 'Weekly backup e-mail', 'On Sundays, sends the complete Excel backup to the backup email.'],
          ['notifyAdminOnReturn', 'E-mail the Administrator when the CTO returns a submission', 'Whenever the CTO returns a submission for correction.'],
          ['notifyCtoOnAdminApproval', 'E-mail Sir when a submission reaches him for approval', 'Whenever an approved submission reaches the CTO stage.'],
        ].map(([k, t, d]) => (
          <div key={k} className="row between"><div><div className="bold">{t}</div><div className="hint">{d}</div></div><Switch on={f[k] !== undefined ? !!f[k] : true} onChange={v => set(k, v)} disabled={dis} label={t} /></div>))}
      </div>

      <div className="card col" style={{ gap: 12 }}>
        <div>
          <h2 className="h2">Data backup</h2>
          <p className="muted small mt-s">Download an Excel workbook (.xlsx) containing all unit data: cadets, accounts, sessions, attendance, benefits, settings, and audit logs.</p>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button className="btn btn-sm" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }} onClick={downloadBackup} disabled={downloading}>
            {downloading ? <Spinner /> : <><Icon name="download" size={14} /> Download backup (Excel)</>}
          </button>
          <button className="btn btn-sm" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }} onClick={downloadBackupPdf} disabled={downloadingPdf}>
            {downloadingPdf ? <Spinner /> : <><Icon name="download" size={14} /> Download year-wise PDF</>}
          </button>
        </div>
      </div>

      <div className="card col" style={{ gap: 12 }}>
        <div>
          <h2 className="h2">Regimental Number pattern</h2>
          <p className="muted small mt-s">Used to validate Regimental Numbers during roster import. Flags warnings when a Reg No does not match.</p>
        </div>
        <div className="grid g2">
          <Field label="Pattern (regex)">
            <input
              className="input mono"
              value={f.regNoPattern ?? '^KA\\d{4}(SD|SW)AF\\d{7}$'}
              onChange={e => set('regNoPattern', e.target.value)}
              disabled={dis}
              placeholder="^KA\d{4}(SD|SW)AF\d{7}$"
            />
          </Field>
          <Field label="Test a Regimental Number">
            <div className="row gap-s">
              <input
                className="input mono grow"
                value={testReg}
                onChange={e => setTestReg(e.target.value)}
                placeholder="e.g. KA2024SDAF1234567"
              />
              {testReg.trim() && (
                <span className={`badge ${testMatches ? 'b-green' : 'b-red'}`} style={{ alignSelf: 'center', whiteSpace: 'nowrap' }}>
                  {testMatches ? 'Matches' : 'No match'}
                </span>
              )}
            </div>
          </Field>
        </div>
      </div>

      <div className="card col" style={{ gap: 12 }}>
        <h2 className="h2">Parade photos</h2>
        <div className="row between">
          <div>
            <div className="bold">Require parade photos for live attendance</div>
            <div className="hint">Turn off only if photo storage is down. Submissions are marked 'no photo'.</div>
          </div>
          <Switch on={f.requirePhotos !== false} onChange={v => set('requirePhotos', v)} disabled={dis} label="Require parade photos for live attendance" />
        </div>
      </div>

      <div className="grid g2">
        <div className="card col" style={{ gap: 12 }}><h2 className="h2">Required attendance</h2>
          <div className="row"><input className="input" style={{ maxWidth: 110 }} inputMode="numeric" value={f.thresholdPct} onChange={e => set('thresholdPct', e.target.value.replace(/\D/g, '').slice(0, 3))} disabled={dis} /><span className="muted">% — cadets below this are flagged in reports and emails</span></div></div>
        <div className="card col" style={{ gap: 6 }}><h2 className="h2">Current cycle</h2><div className="muted small">Attendance cycle <b>{f.cycleLabel}</b> (started {f.cycleStartedAt ? new Date(f.cycleStartedAt).toLocaleDateString('en-IN') : 'at setup'}). A new cycle starts when you promote cadets.</div></div>
      </div>

      <div className="card col" style={{ gap: 12 }}>
        <div><h2 className="h2">Absence reasons</h2><p className="muted small mt-s">The dropdown shown when a cadet is marked Absent. “Other…” (typed reason) is always available.</p></div>
        <div className="row wrap gap-s">{f.absentReasons.map(r => <span key={r} className="badge b-blue" style={{ fontSize: 13, padding: '6px 6px 6px 12px', display: 'inline-flex', alignItems: 'center', gap: 6 }}>{r}{canEdit && <button className="btn btn-icon btn-ghost" style={{ width: 24, minHeight: 24, border: 0, padding: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => set('absentReasons', f.absentReasons.filter(x => x !== r))} aria-label={`Remove ${r}`}><Icon name="x" size={12} /></button>}</span>)}</div>
        {canEdit && <div className="row"><input className="input" maxLength={40} value={newReason} onChange={e => setNewReason(e.target.value)} onKeyDown={e => e.key === 'Enter' && addReason()} placeholder="Add a reason…" /><button className="btn" onClick={addReason}>Add</button></div>}
      </div>
      {canEdit && <div style={{ position: 'sticky', bottom: 100 }}><button className="btn btn-primary btn-lg btn-block" onClick={save} disabled={saving}>{saving ? <Spinner /> : 'Save settings'}</button></div>}
    </div>
  );
}
