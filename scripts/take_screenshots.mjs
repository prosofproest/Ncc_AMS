import { chromium } from 'playwright';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { cleanKey } from '../lib/keys.mjs';
import { createToken } from '../lib/auth.js';
import { DEFAULT_PERMISSIONS } from '../lib/permissions.js';
import path from 'path';

const outDir = '/Users/hruthwicktn/.gemini/antigravity-ide/brain/03be2276-0aa9-4a03-8d7a-ee36213360c8';

async function run() {
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

  // Set up test documents so /api/me validates cleanly
  await db.collection('users').doc('screenshot-admin').set({
    name: 'Admin Officer',
    role: 'admin',
    username: 'admin',
    isActive: true,
    mustChangePassword: false,
    tokenVersion: 0,
  });

  await db.collection('users').doc('screenshot-marker').set({
    name: 'Sgt Rohan',
    role: 'marker',
    username: 'rohan',
    isActive: true,
    mustChangePassword: false,
    tokenVersion: 0,
  });

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
  });

  const adminToken = await createToken({
    id: 'screenshot-admin',
    name: 'Admin Officer',
    role: 'admin',
    username: 'admin',
    dashboardPath: '/dashboard/admin',
    permissions: DEFAULT_PERMISSIONS.admin,
    tokenVersion: 0,
  });

  const markerToken = await createToken({
    id: 'screenshot-marker',
    name: 'Sgt Rohan',
    role: 'marker',
    username: 'rohan',
    dashboardPath: '/dashboard/marker',
    permissions: DEFAULT_PERMISSIONS.marker,
    tokenVersion: 0,
  });

  const cadetToken = await createToken({
    id: 'screenshot-cadet',
    name: 'Dishan B V',
    regNo: 'KA2026SDAF2490429',
    role: 'cadet',
    username: null,
    dashboardPath: '/dashboard/cadet',
    permissions: DEFAULT_PERMISSIONS.cadet,
    tokenVersion: 0,
  });

  const browser = await chromium.launch({ headless: true });

  try {
    // 1. Desktop 1440x900
    console.log('1. Capturing Desktop 1440x900...');
    const desktopCtx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    await desktopCtx.addCookies([
      { name: 'ncc_token', value: adminToken, url: 'http://localhost:3000' }
    ]);
    const page = await desktopCtx.newPage();

    // Overview (Light)
    await page.goto('http://localhost:3000/dashboard/admin/overview', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.sidebar', { timeout: 15000 });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(outDir, 'desktop_admin_overview_light.png') });

    // Overview (Dark)
    const themeBtn = page.locator('button[aria-label="Switch to dark mode"]');
    if (await themeBtn.isVisible()) {
      await themeBtn.click();
      await page.waitForTimeout(800);
      await page.screenshot({ path: path.join(outDir, 'desktop_admin_overview_dark.png') });
      const lightBtn = page.locator('button[aria-label="Switch to light mode"]');
      if (await lightBtn.isVisible()) await lightBtn.click();
      await page.waitForTimeout(500);
    }

    // Approvals
    await page.goto('http://localhost:3000/dashboard/admin/approvals', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.page-header', { timeout: 15000 });
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(outDir, 'desktop_admin_approvals.png') });

    // People (Add account modal)
    await page.goto('http://localhost:3000/dashboard/admin/people', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.page-header', { timeout: 15000 });
    await page.waitForTimeout(1000);
    const addAccountBtn = page.getByRole('button', { name: /Add account/i });
    if (await addAccountBtn.isVisible()) {
      await addAccountBtn.click();
      await page.waitForTimeout(800);
      await page.screenshot({ path: path.join(outDir, 'desktop_admin_people_modal.png') });
      const closeBtn = page.getByRole('button', { name: /Cancel|Close/i }).first();
      if (await closeBtn.isVisible()) await closeBtn.click();
      await page.waitForTimeout(400);
    }

    // Reports
    await page.goto('http://localhost:3000/dashboard/admin/reports', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.page-header', { timeout: 15000 });
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(outDir, 'desktop_admin_reports.png') });
    await desktopCtx.close();

    // 2. Tablet 900x700
    console.log('2. Capturing Tablet 900x700...');
    const tabletCtx = await browser.newContext({
      viewport: { width: 900, height: 700 },
    });
    await tabletCtx.addCookies([
      { name: 'ncc_token', value: adminToken, url: 'http://localhost:3000' }
    ]);
    const tabletPage = await tabletCtx.newPage();
    await tabletPage.goto('http://localhost:3000/dashboard/admin/overview', { waitUntil: 'domcontentloaded' });
    await tabletPage.waitForSelector('.sidebar', { timeout: 15000 });
    await tabletPage.waitForTimeout(1000);
    await tabletPage.screenshot({ path: path.join(outDir, 'tablet_admin_rail.png') });

    // Expand rail toggle
    const railToggle = tabletPage.locator('.rail-toggle');
    if (await railToggle.isVisible()) {
      await railToggle.click();
      await tabletPage.waitForTimeout(600);
      await tabletPage.screenshot({ path: path.join(outDir, 'tablet_admin_rail_expanded.png') });
    }
    await tabletCtx.close();

    // 3. Mobile 390x844 (Admin, Drawer)
    console.log('3. Capturing Mobile 390x844 Admin...');
    const mobileAdminCtx = await browser.newContext({
      viewport: { width: 390, height: 844 },
    });
    await mobileAdminCtx.addCookies([
      { name: 'ncc_token', value: adminToken, url: 'http://localhost:3000' }
    ]);
    const mobileAdminPage = await mobileAdminCtx.newPage();
    await mobileAdminPage.goto('http://localhost:3000/dashboard/admin/overview', { waitUntil: 'domcontentloaded' });
    await mobileAdminPage.waitForSelector('.mobile-header', { timeout: 15000 });
    await mobileAdminPage.waitForTimeout(1000);
    const menuBtn = mobileAdminPage.locator('button[aria-label="Open navigation menu"]');
    if (await menuBtn.isVisible()) {
      await menuBtn.click();
      await mobileAdminPage.waitForTimeout(600);
      await mobileAdminPage.screenshot({ path: path.join(outDir, 'mobile_admin_drawer.png') });
      await mobileAdminPage.keyboard.press('Escape');
      await mobileAdminPage.waitForTimeout(300);
    }
    await mobileAdminCtx.close();

    // 4. Mobile 390x844 (Marker - Mark attendance with Year 1)
    console.log('4. Capturing Mobile 390x844 Marker...');
    const mobileMarkerCtx = await browser.newContext({
      viewport: { width: 390, height: 844 },
    });
    await mobileMarkerCtx.addCookies([
      { name: 'ncc_token', value: markerToken, url: 'http://localhost:3000' }
    ]);
    const mobileMarkerPage = await mobileMarkerCtx.newPage();
    await mobileMarkerPage.goto('http://localhost:3000/dashboard/marker/mark', { waitUntil: 'domcontentloaded' });
    await mobileMarkerPage.waitForSelector('.page-header', { timeout: 15000 });
    await mobileMarkerPage.waitForTimeout(1000);
    const year1Chip = mobileMarkerPage.getByRole('button', { name: /Year 1/i });
    if (await year1Chip.isVisible()) {
      await year1Chip.click();
      await mobileMarkerPage.waitForTimeout(600);
    }
    await mobileMarkerPage.screenshot({ path: path.join(outDir, 'mobile_marker_mark.png') });
    await mobileMarkerCtx.close();

    // 5. Mobile 390x844 (Cadet - My attendance)
    console.log('5. Capturing Mobile 390x844 Cadet...');
    const mobileCadetCtx = await browser.newContext({
      viewport: { width: 390, height: 844 },
    });
    await mobileCadetCtx.addCookies([
      { name: 'ncc_token', value: cadetToken, url: 'http://localhost:3000' }
    ]);
    const mobileCadetPage = await mobileCadetCtx.newPage();
    await mobileCadetPage.goto('http://localhost:3000/dashboard/cadet', { waitUntil: 'domcontentloaded' });
    await mobileCadetPage.waitForSelector('.page-header', { timeout: 15000 });
    await mobileCadetPage.waitForTimeout(1000);
    await mobileCadetPage.screenshot({ path: path.join(outDir, 'mobile_cadet_attendance.png') });
    await mobileCadetCtx.close();

    console.log('All screenshots captured successfully!');
  } finally {
    await browser.close();
    // Clean up temporary test documents
    await db.collection('users').doc('screenshot-admin').delete().catch(() => {});
    await db.collection('users').doc('screenshot-marker').delete().catch(() => {});
    await db.collection('users').doc('screenshot-cadet').delete().catch(() => {});
  }
}

run().catch(e => { console.error(e); process.exit(1); });
