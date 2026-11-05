# NCC AIRWING · FLIGHT-B · 6 KAR AIR SQN NCC — AMS (attendance system)

Next.js 14 · Firebase (Firestore) · Cloudinary · Google Sheets · Gmail SMTP · deploys on Vercel.

## What it does

| Area | How it works |
|---|---|
| **Sign-in** | Username (or Reg. No.) + password. Optional **2-step email OTP** — switched on/off per account by the Admin at any time. 5 wrong passwords lock the account for 15 min. |
| **Marking** | Cadet marker picks date, activity and **any combination of years** (1, 2, 3, 1&2, 2&3, 1&3, All), taps **P / A**. Absent → reason dropdown (Admin-editable) or typed "Other". Photos from **camera or gallery**, GPS for live parades. |
| **Approval** | A submission is **locked and pending**. It is saved, counted, written to the sheet and e-mailed **only after BOTH the Admin and the CTO approve** (Approvals tab, live counter, review + correct + approve / reject with reason). If the Admin or CTO takes attendance themselves, their own side is approved automatically — the other side is still needed. Promotion is blocked while anything is pending. |
| **Lock** | Once submitted, attendance is locked for the marker. Only Admin / CTO can edit it (before or after approval); every edit is logged and e-mailed with a corrected PDF. |
| **E-mails** | (after approval) Parade report (+ **PDF**, with the approval record) → Sir + backup · absence notice → each absent cadet (if an email is in the sheet) · change log → Sir + backup · monthly + weekly summary (+ PDF). All in the same glass theme. |
| **Google Sheet** | You type Name / Reg No. / Type / Email / Phone. The app creates headers and keeps **Attendance Log, Daily Report, Absentees, Monthly Report, Cadet Summary, Benefits, Change Log** up to date within seconds. Nightly self-heal at 11 PM IST. |
| **Reports** | Day (parade report), month, date range, single cadet, year, whole unit, absentees, benefits — **PDF / Excel / CSV**. |
| **Benefit** | Separate tab: bonus attendance credits (camps etc.), capped at 100 %. |
| **Promotion** | Year 1→2→3, Year 3 graduates, attendance restarts from 0, old sheet tabs are **archived** and fresh ones created. Nothing is deleted. |
| **System health** | Admin → *System health*: live latency (every 5 s), database / Sheets / e-mail / photos checks, failed background jobs, recent events. |

Roles: **Admin**, **CTO (Sir)**, **Cadet marker**, **Cadet**, plus custom roles (Admin → Roles). Only the Admin and CTO roles can approve; both can also mark attendance.

## First-time setup

```bash
npm install
cp .env.local.example .env.local        # fill in every value
npm run check-env                      # verifies every value in .env.local
ADMIN_PASSWORD="a-strong-password" ADMIN_EMAIL="you@example.com" npm run setup-admin   # first admin (username: admin)
npm run dev
```

**Upgrading from the old version?** (your Firestore already has attendance)
```bash
npm run migrate -- --dry   # shows what will change
npm run migrate            # converts old records, "Leave" → Absent, rebuilds every counter
```

Then sign in as admin and:
1. **Settings** → set *Sir's email* and *Backup email*, check the absence reasons, **Send a test email**.
2. **Google Sheet → Set up / repair tabs** (creates all tabs + headers; never touches typed data).
3. Type your cadets in *Year 1 / Year 2 / Year 3* (Name, Reg No., Type SD/SW, Email, Phone), then **Import cadets now** (after this it syncs by itself).
4. **People → Add account** for each cadet marker: username, password, email, OTP on/off.
5. Open **System health** — everything should be green.

## Deploy on Vercel — step by step

**0 · Check your settings first (on your computer)**
```bash
npm run check-env          # are all values present and correctly formatted?
npm run check-env:live     # really connects to Firebase, Google Sheets, Gmail and Cloudinary
```
Fix every ❌ before continuing. (The file must be named `.env.local` and sit next to `package.json`.)

**1 · Put the project on GitHub** — create a *private* repository and upload the project folder (the `.gitignore` already keeps `.env.local` and `node_modules` out).

**2 · Import it in Vercel** — vercel.com → *Add New → Project* → pick the repository. Framework: **Next.js** (auto-detected). Build / install commands: leave the defaults.

**3 · Add the environment variables** — *Settings → Environment Variables*. Add every line of `.env.local` (names and values; do **not** upload the file). Rules:
* Paste values as they are — quotes are tolerated, and for the two private keys either real line breaks or the `\n` form works.
* `JWT_SECRET` and `CRON_SECRET` are mandatory. `NEXT_PUBLIC_APP_URL` = your final address (e.g. `https://ncc-ams.vercel.app`).
* Tick **Production** (and Preview if you want).

**4 · Region** — `vercel.json` pins the functions to **Mumbai (bom1)**. Create the Firestore database in **asia-south1 (Mumbai)** as well. This is the single biggest factor for speed.

**5 · Deploy**, then open the site and:
1. Run the first-time setup above (create the admin with `npm run setup-admin` on your computer — it writes to the same Firestore).
2. Sign in → **System health** → all green.
3. Vercel → *Settings → Deployment Protection*: make sure **Vercel Authentication is OFF for Production**, otherwise your cadets are asked to log in to Vercel and the nightly job is blocked.

**Scheduled job** — one cron job (`vercel.json`, 11 PM IST every night) rebuilds the sheet and cleans old logs; on **Mondays** it also sends the weekly digest and on the **1st** the monthly summary. One job keeps you inside the free plan's limit of two. It is protected by `CRON_SECRET` (Vercel sends it automatically). Check it under *Settings → Cron Jobs*, or press **Run** there.

**Updating later** — push to GitHub; Vercel redeploys. Changing an environment variable needs a redeploy to take effect.

**Troubleshooting**
| Symptom | Cause / fix |
|---|---|
| Sign-in says "Server error" | a variable is missing or wrong → run `npm run check-env:live`, or read the error in *Vercel → Logs* |
| No e-mails | `EMAIL_PASS` must be a Gmail **App password**; check **System health → Email** and *Settings → Send a test email* |
| Sheet tabs not updating | the sheet is not shared with the service-account e-mail as **Editor**, or the Sheets API is not enabled |
| Slow responses | Firestore not in Mumbai; compare the *Database read* time in **System health** |
| Photos fail | `CLOUDINARY_*` values; photos are compressed on the phone, but a >4 MB photo from an old browser can still fail |
| "Unauthorized" on the cron job | `CRON_SECRET` missing in Vercel |
## If the administrator is locked out

If an administrator or user forgets their password or gets locked out:

```bash
NEW_PASSWORD='your-new-password' npm run reset-password -- <username | e-mail | regNo> --yes
```

Example:
```bash
NEW_PASSWORD='NewPassword123' npm run reset-password -- admin --yes
```

The script:
1. Looks up the account (username lower-case, e-mail lower-case, regNo upper-case) and displays the user name and role.
2. Refuses if the account is not found or if several accounts match.
3. Requires the `--yes` confirmation flag and requires `NEW_PASSWORD` of at least 8 characters from the environment (never as an argument, never printed).
4. Stores a bcrypt (cost 10) hash, sets `mustChangePassword` to true, `failedLogins` to 0, `lockedUntil` to null, and `tokenVersion` to `Date.now()` (signing out all active sessions).
5. Writes an audit log entry (`type: 'password-reset'`, `byName: 'recovery script'`).

## Notes

* Only **Present / Absent** exist. Old "Leave" records are converted to Absent with the old remark as the reason.
* A cadet with no valid e-mail simply receives no absence mail.
* Cadets removed from the sheet are **deactivated, never deleted** (history stays).
* Marker session lifetime: defaults to 30 minutes (configurable via `MARKER_SESSION_MINUTES` environment variable); all other roles have an 8-hour session.
* `ALLOW_ADMIN_WITHOUT_OTP`: Emergency use only. When set to `'true'`, allows an administrator account with OTP enabled to sign in even if no email address is configured on the account. Defaults to off.
* `npm test` runs automated checks (API simulation with fake Firebase / Sheets / SMTP, plus the real screens in a simulated browser).

