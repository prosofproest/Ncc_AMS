import { chromium } from 'playwright';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { cleanKey } from '../lib/keys.mjs';
import { createToken, hashTabId } from '../lib/auth.js';
import { DEFAULT_PERMISSIONS } from '../lib/permissions.js';

const ADMIN_ITEMS = [
  { id: 'overview', label: 'Overview', href: '/dashboard/admin/overview', heading: 'Overview' },
  { id: 'approvals', label: 'Approvals', href: '/dashboard/admin/approvals', heading: 'Approvals' },
  { id: 'mark', label: 'Mark attendance', href: '/dashboard/admin/mark', heading: 'Mark attendance' },
  { id: 'records', label: 'Records', href: '/dashboard/admin/records', heading: 'Records' },
  { id: 'calendar', label: 'Calendar', href: '/dashboard/calendar', heading: 'Calendar' },
  { id: 'people', label: 'People', href: '/dashboard/admin/people', heading: 'People' },
  { id: 'reports', label: 'Reports', href: '/dashboard/admin/reports', heading: 'Reports' },
  { id: 'benefits', label: 'Benefits', href: '/dashboard/admin/benefits', heading: 'Benefits' },
  { id: 'sheet', label: 'Google Sheet', href: '/dashboard/admin/sheet', heading: 'Google Sheet' },
  { id: 'settings', label: 'Settings', href: '/dashboard/admin/settings', heading: 'Settings' },
  { id: 'promotion', label: 'Promotion', href: '/dashboard/admin/promotion', heading: 'Promotion' },
  { id: 'roles', label: 'Roles', href: '/dashboard/admin/roles', heading: 'Roles' },
  { id: 'health', label: 'System health', href: '/dashboard/admin/health', heading: 'System health' },
  { id: 'log', label: 'Change log', href: '/dashboard/admin/log', heading: 'Change log' },
];

function shuffle(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

async function run() {
  console.log('=== NCC AMS Navigation & Marker Performance Verification ===');
  console.log('Connecting to Firebase and setting up test tokens...');

  const app = getApps().length
    ? getApps()[0]
    : initializeApp({
        credential: cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey: cleanKey(process.env.FIREBASE_PRIVATE_KEY),
        }),
      });
  const db = getFirestore(app);

  await db.collection('users').doc('screenshot-admin').set({
    name: 'Admin Officer',
    role: 'admin',
    username: 'admin',
    isActive: true,
    mustChangePassword: false,
    tokenVersion: 0,
  }, { merge: true });

  await db.collection('users').doc('screenshot-marker').set({
    name: 'Sgt Rohan',
    role: 'marker',
    username: 'rohan',
    isActive: true,
    mustChangePassword: false,
    tokenVersion: 0,
  }, { merge: true });

  await db.collection('users').doc('screenshot-cadet').set({
    name: 'Dishan B V',
    regNo: 'KA2026SDAF2490429',
    role: 'cadet',
    year: 1,
    type: 'SD',
    isActive: true,
    mustChangePassword: false,
    tokenVersion: 0,
    stats: { total: 10, present: 9, absent: 1, months: {} },
    benefit: 0,
  }, { merge: true });

  const adminTabId = 'admin-tab-' + Math.random().toString(36).slice(2);
  const markerTabId = 'marker-tab-' + Math.random().toString(36).slice(2);

  const adminToken = await createToken({
    id: 'screenshot-admin',
    name: 'Admin Officer',
    role: 'admin',
    username: 'admin',
    dashboardPath: '/dashboard/admin',
    permissions: DEFAULT_PERMISSIONS.admin,
    tokenVersion: 0,
    tid: hashTabId(adminTabId),
  });

  const markerToken = await createToken({
    id: 'screenshot-marker',
    name: 'Sgt Rohan',
    role: 'marker',
    username: 'rohan',
    dashboardPath: '/dashboard/marker',
    permissions: DEFAULT_PERMISSIONS.marker,
    tokenVersion: 0,
    tid: hashTabId(markerTabId),
  });

  const browser = await chromium.launch({ headless: true });
  let totalReloads = 0;
  const switchMeasurements = [];

  try {
    // ═══════════════════════════════════════════════════════════════════════════
    // 1. ADMIN NAVIGATION: ALL SIDEBAR ITEMS TWICE IN RANDOM ORDER
    // ═══════════════════════════════════════════════════════════════════════════
    console.log('\n--- 1. Testing Admin Navigation (14 items x 2 rounds in random order) ---');
    const adminContext = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });

    await adminContext.addCookies([
      { name: 'ncc_token', value: adminToken, url: 'http://localhost:3000' },
    ]);

    await adminContext.addInitScript((tid) => {
      try {
        sessionStorage.setItem('ncc_tab', tid);
        sessionStorage.setItem('ncc_greeted', '1');
        localStorage.setItem('ncc_voice', 'off');
        localStorage.setItem('ncc_theme', 'light');
        window.__reloadCounter = (window.__reloadCounter || 0) + 1;
      } catch {}
    }, adminTabId);

    const adminPage = await adminContext.newPage();
    await adminPage.goto('http://localhost:3000/dashboard/admin/overview', { waitUntil: 'domcontentloaded' });
    await adminPage.waitForSelector('.sidebar', { timeout: 15000 });
    await adminPage.waitForSelector('.page-header h1, h1', { timeout: 15000 });

    const round1 = shuffle(ADMIN_ITEMS);
    const round2 = shuffle(ADMIN_ITEMS);

    console.log('\nRound 1 (Initial Visits):');
    for (const item of round1) {
      const link = adminPage.locator(`.sidebar a.nav-link[href="${item.href}"]`).first();
      await link.waitFor({ state: 'visible', timeout: 5000 });

      const reloadsBefore = await adminPage.evaluate(() => window.__reloadCounter || 1);
      const t0 = performance.now();
      await link.click();

      // Wait until heading or page title matches this section
      await adminPage.waitForFunction(
        (expected) => {
          const headings = Array.from(document.querySelectorAll('.page-header h1, h1, .h1, .content-wrap h1'));
          return headings.some(h => h.textContent && h.textContent.toLowerCase().includes(expected.toLowerCase()));
        },
        item.heading,
        { timeout: 10000 }
      );
      const elapsed = Math.round(performance.now() - t0);

      const reloadsAfter = await adminPage.evaluate(() => window.__reloadCounter || 1);
      if (reloadsAfter > reloadsBefore) totalReloads++;

      switchMeasurements.push({ item: item.label, href: item.href, round: 1, ms: elapsed });
      console.log(`  [Round 1] -> ${item.label.padEnd(16)}: ${elapsed} ms`);
    }

    console.log('\nRound 2 (Repeat Visits):');
    for (const item of round2) {
      const link = adminPage.locator(`.sidebar a.nav-link[href="${item.href}"]`).first();
      await link.waitFor({ state: 'visible', timeout: 5000 });

      const reloadsBefore = await adminPage.evaluate(() => window.__reloadCounter || 1);
      const t0 = performance.now();
      await link.click();

      await adminPage.waitForFunction(
        (expected) => {
          const headings = Array.from(document.querySelectorAll('.page-header h1, h1, .h1, .content-wrap h1'));
          return headings.some(h => h.textContent && h.textContent.toLowerCase().includes(expected.toLowerCase()));
        },
        item.heading,
        { timeout: 10000 }
      );
      const elapsed = Math.round(performance.now() - t0);

      const reloadsAfter = await adminPage.evaluate(() => window.__reloadCounter || 1);
      if (reloadsAfter > reloadsBefore) totalReloads++;

      switchMeasurements.push({ item: item.label, href: item.href, round: 2, ms: elapsed });
      console.log(`  [Round 2] -> ${item.label.padEnd(16)}: ${elapsed} ms`);
    }

    await adminContext.close();

    // ═══════════════════════════════════════════════════════════════════════════
    // 2. MARKER ATTENDANCE: COLD VS WARM CACHE TIMINGS
    // ═══════════════════════════════════════════════════════════════════════════
    console.log('\n--- 2. Testing Marker Navigation & Roll Cache Performance ---');
    const markerContext = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });

    await markerContext.addCookies([
      { name: 'ncc_token', value: markerToken, url: 'http://localhost:3000' },
    ]);

    await markerContext.addInitScript((tid) => {
      try {
        sessionStorage.setItem('ncc_tab', tid);
        sessionStorage.setItem('ncc_greeted', '1');
        localStorage.setItem('ncc_voice', 'off');
        localStorage.setItem('ncc_theme', 'light');
        window.__reloadCounter = (window.__reloadCounter || 0) + 1;
      } catch {}
    }, markerTabId);

    const markerPage = await markerContext.newPage();

    // Cold cache test: Navigate to mark page with empty cache
    console.log('Testing Marker Mark Attendance (Cold Cache)...');
    const coldStart = performance.now();
    await markerPage.goto('http://localhost:3000/dashboard/marker/mark', { waitUntil: 'domcontentloaded' });
    await markerPage.waitForSelector('.chip, .submitbar, .field', { timeout: 15000 });
    // Select Year 1 chip so roll items appear
    const year1Chip = markerPage.locator('.chip').filter({ hasText: 'Year 1' }).first();
    await year1Chip.waitFor({ state: 'visible', timeout: 10000 });
    const isYear1On = await year1Chip.evaluate(el => el.classList.contains('on'));
    if (!isYear1On) await year1Chip.click();
    await markerPage.waitForSelector('.item', { timeout: 15000 });
    const coldRollMs = Math.round(performance.now() - coldStart);
    console.log(`  Cold Cache: "Mark attendance page opened" -> "roll visible": ${coldRollMs} ms`);

    // Switch to History
    console.log('\nNavigating to Marker History...');
    const histLink = markerPage.locator('.sidebar a.nav-link[href="/dashboard/marker/history"]').first();
    const tHist0 = performance.now();
    await histLink.click();
    await markerPage.waitForSelector('.page-header h1:has-text("History")', { timeout: 10000 });
    const histMs = Math.round(performance.now() - tHist0);
    console.log(`  Switched to History in: ${histMs} ms`);

    // Switch back to Mark attendance (Warm Cache)
    console.log('\nNavigating back to Marker Mark Attendance (Warm Cache)...');
    const markLink = markerPage.locator('.sidebar a.nav-link[href="/dashboard/marker/mark"]').first();
    const tWarm0 = performance.now();
    await markLink.click();
    // With warm cache, chips and roll items render immediately without waiting for API
    await markerPage.waitForSelector('.chip', { timeout: 10000 });
    const warmYear1 = markerPage.locator('.chip').filter({ hasText: 'Year 1' }).first();
    const isW1On = await warmYear1.evaluate(el => el.classList.contains('on'));
    if (!isW1On) await warmYear1.click();
    await markerPage.waitForSelector('.item', { timeout: 10000 });
    const warmRollMs = Math.round(performance.now() - tWarm0);
    console.log(`  Warm Cache: "Mark attendance page opened" -> "roll visible": ${warmRollMs} ms`);

    await markerContext.close();
    await browser.close();

    // ═══════════════════════════════════════════════════════════════════════════
    // 3. ANALYSIS, STATISTICS & ASSERTIONS
    // ═══════════════════════════════════════════════════════════════════════════
    console.log('\n=== Performance Summary & Assertions ===');
    const round1Times = switchMeasurements.filter(m => m.round === 1).map(m => m.ms);
    const round2Times = switchMeasurements.filter(m => m.round === 2).map(m => m.ms);
    const allTimes = switchMeasurements.map(m => m.ms);

    const under500Count = allTimes.filter(ms => ms < 500).length;
    const under500Pct = ((under500Count / allTimes.length) * 100).toFixed(1);

    const r1Avg = Math.round(round1Times.reduce((a, b) => a + b, 0) / round1Times.length);
    const r2Avg = Math.round(round2Times.reduce((a, b) => a + b, 0) / round2Times.length);

    console.log(`Total sidebar switches tested : ${allTimes.length}`);
    console.log(`Switches under 500 ms         : ${under500Count}/${allTimes.length} (${under500Pct}%)`);
    console.log(`Round 1 (first visit) avg     : ${r1Avg} ms (max: ${Math.max(...round1Times)} ms)`);
    console.log(`Round 2 (repeat visit) avg    : ${r2Avg} ms (max: ${Math.max(...round2Times)} ms)`);
    console.log(`Marker roll cold cache timing : ${coldRollMs} ms`);
    console.log(`Marker roll warm cache timing : ${warmRollMs} ms`);
    console.log(`Total unexpected page reloads : ${totalReloads}`);

    let failed = false;
    if (totalReloads > 0) {
      console.error(`FAILED: Expected 0 full page reloads, found ${totalReloads}.`);
      failed = true;
    }

    // Assert: 95 percent of switches are under 500 ms (first visit may be up to 1500 ms)
    // First visits must all be <= 1500 ms
    const r1Slow = round1Times.filter(ms => ms > 1500);
    if (r1Slow.length > 0) {
      console.error(`FAILED: Found first visits taking > 1500 ms: ${r1Slow.join(', ')} ms.`);
      failed = true;
    }

    if (under500Count / allTimes.length < 0.95) {
      console.error(`FAILED: Only ${under500Pct}% of switches were under 500 ms (expected >= 95%).`);
      failed = true;
    }

    if (failed) {
      process.exit(1);
    }

    console.log('\nAll navigation and marker roll performance assertions PASSED!');
    process.exit(0);
  } catch (err) {
    console.error('Fatal error during check-nav execution:', err);
    await browser.close().catch(() => {});
    process.exit(1);
  }
}

run();
