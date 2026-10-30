import { chromium } from 'playwright';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { cleanKey } from '../lib/keys.mjs';
import { createToken, hashTabId } from '../lib/auth.js';
import { DEFAULT_PERMISSIONS } from '../lib/permissions.js';

async function run() {
  console.log('=== NCC AMS "Correct and Resubmit" Reproduction & Verification ===');
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

  // Ensure test users exist
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

  await db.collection('users').doc('screenshot-cadet-2').set({
    name: 'Priya Sharma',
    regNo: 'KA2026SWAF2490430',
    role: 'cadet',
    year: 1,
    type: 'SW',
    isActive: true,
    mustChangePassword: false,
    tokenVersion: 0,
    stats: { total: 10, present: 8, absent: 2, months: {} },
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

  const testDate = '2026-09-15'; // Specific past date distinct from today
  const testReason = 'Fever and medical rest';
  const testPhoto = 'https://images.unsplash.com/photo-1541872703-74c5e44368f9?auto=format&fit=crop&w=400&q=80';
  const rejectionReason = 'Incorrect uniform details and blurry photo';

  console.log(`Creating rejected submission for date ${testDate} via API...`);

  // 1. Marker creates a submission via API
  const submitRes = await fetch('http://localhost:3000/api/attendance', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'cookie': `ncc_token=${markerToken}`,
      'x-tab-id': markerTabId,
    },
    body: JSON.stringify({
      date: testDate,
      activity_type: 'Parade',
      activity_description: 'Annual Inspection Drill',
      years: [1],
      photo_urls: [testPhoto],
      records: [
        { cadet_id: 'screenshot-cadet', status: 'Present', reason: '' },
        { cadet_id: 'screenshot-cadet-2', status: 'Absent', reason: testReason },
      ],
    }),
  });

  const submitJson = await submitRes.json();
  if (!submitRes.ok || !submitJson.sessionId) {
    throw new Error(`Failed to create submission via API: ${JSON.stringify(submitJson)}`);
  }
  const sessionId = submitJson.sessionId;
  console.log(`Created submission ${sessionId}. Rejecting via API as Admin...`);

  // 2. Admin rejects the submission via API
  const rejectRes = await fetch('http://localhost:3000/api/approvals', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'cookie': `ncc_token=${adminToken}`,
      'x-tab-id': adminTabId,
    },
    body: JSON.stringify({
      id: sessionId,
      action: 'reject',
      reason: rejectionReason,
    }),
  });
  const rejectJson = await rejectRes.json();
  if (!rejectRes.ok || !rejectJson.success) {
    throw new Error(`Failed to reject submission via API: ${JSON.stringify(rejectJson)}`);
  }
  console.log(`Submission ${sessionId} successfully rejected.`);

  // 3. Launch browser and test marker flow
  console.log('\nLaunching Playwright browser to test "Correct and resubmit"...');
  const browser = await chromium.launch({ headless: true });

  try {
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
      } catch {}
    }, markerTabId);

    const markerPage = await markerContext.newPage();

    // Navigate to History page
    console.log('Navigating to /dashboard/marker/history...');
    await markerPage.goto('http://localhost:3000/dashboard/marker/history', { waitUntil: 'domcontentloaded' });
    await markerPage.waitForSelector('.sidebar', { timeout: 15000 });

    // Wait for "My submissions" section
    console.log('Waiting for "My submissions" card with rejected item...');
    await markerPage.waitForSelector('.card .item.absent', { timeout: 15000 });

    const rejectedItem = markerPage.locator('.card .item.absent').filter({ hasText: rejectionReason }).first();
    await rejectedItem.waitFor({ state: 'visible', timeout: 5000 });

    const correctBtn = rejectedItem.locator('button', { hasText: 'Correct and resubmit' });
    await correctBtn.waitFor({ state: 'visible', timeout: 5000 });

    console.log('Clicking "Correct and resubmit" button...');
    await correctBtn.click();

    // Wait for Mark attendance screen to render
    await markerPage.waitForTimeout(2000); // allow transitions and effects to run

    console.log('Checking assertions on the Mark screen...');

    // Assertion 1: Date input should match testDate
    const dateInput = markerPage.locator('input#d[type="date"]');
    await dateInput.waitFor({ state: 'visible', timeout: 5000 });
    const actualDate = await dateInput.inputValue();
    console.log(`  Assertion 1 (Date): Expected "${testDate}", got "${actualDate}"`);
    if (actualDate !== testDate) {
      throw new Error(`Date prefill failed: expected "${testDate}", got "${actualDate}"`);
    }

    // Assertion 2: Selected year chips (Year 1 chip should have class 'on')
    const year1Chip = markerPage.locator('.chip').filter({ hasText: 'Year 1' }).first();
    await year1Chip.waitFor({ state: 'visible', timeout: 5000 });
    const isYear1On = await year1Chip.evaluate(el => el.classList.contains('on'));
    console.log(`  Assertion 2 (Year chip): Year 1 active = ${isYear1On}`);
    if (!isYear1On) {
      throw new Error('Year chips prefill failed: Year 1 chip is not active (.on)');
    }

    // Assertion 3: At least one Absent cadet with its reason
    const cadet2Item = markerPage.locator('.item').filter({ hasText: 'Priya Sharma' }).first();
    await cadet2Item.waitFor({ state: 'visible', timeout: 5000 });
    const isAbsentActive = await cadet2Item.locator('.pa button.a.on').count() > 0;
    const reasonValue = await cadet2Item.locator('input, select').evaluateAll(inputs => {
      for (const i of inputs) {
        if (i.value && i.value.includes('Fever')) return i.value;
      }
      return '';
    });
    console.log(`  Assertion 3 (Absent cadet & reason): Absent selected = ${isAbsentActive}, reason = "${reasonValue}"`);
    if (!isAbsentActive || !reasonValue.includes('Fever')) {
      throw new Error(`Absent cadet prefill failed: absent=${isAbsentActive}, reason="${reasonValue}"`);
    }

    // Assertion 4: Photo thumbnails present
    const photoThumbs = markerPage.locator('img[alt="Parade"], img[alt="Parade photo"], .photo-thumb img, .thumb img');
    const photoCount = await photoThumbs.count();
    console.log(`  Assertion 4 (Photo thumbnails): Found ${photoCount} thumbnail(s)`);
    if (photoCount === 0) {
      throw new Error('Photo thumbnails prefill failed: no photo thumbnails found');
    }

    // Assertion 5: Red banner is present with rejection details
    const redBanner = markerPage.locator('.banner.bad');
    await redBanner.waitFor({ state: 'visible', timeout: 5000 });
    const bannerText = await redBanner.innerText();
    console.log(`  Assertion 5 (Red banner): "${bannerText.replace(/\n/g, ' ')}"`);
    if (!bannerText.includes(rejectionReason)) {
      throw new Error(`Red banner failed: missing rejection reason "${rejectionReason}" in banner "${bannerText}"`);
    }

    console.log('\nAll "Correct and resubmit" assertions PASSED!');
    await markerContext.close();
    await browser.close();
    process.exit(0);
  } catch (err) {
    console.error('\nFAILED check-resubmit:', err.message);
    await browser.close().catch(() => {});
    process.exit(1);
  }
}

run().catch((err) => {
  console.error('Fatal check-resubmit runner error:', err);
  process.exit(1);
});
