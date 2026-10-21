import { chromium } from 'playwright';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { cleanKey } from '../lib/keys.mjs';
import { createToken } from '../lib/auth.js';
import { DEFAULT_PERMISSIONS } from '../lib/permissions.js';
import path from 'path';
import fs from 'fs';

const outDir = path.resolve(process.cwd(), 'scratch/layout');
fs.mkdirSync(outDir, { recursive: true });

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'tablet', width: 1024, height: 768 },
  { name: 'phone', width: 390, height: 844 },
];

const THEMES = ['light', 'dark'];

function rectsOverlap(r1, r2) {
  if (!r1 || !r2) return false;
  // 1px subpixel tolerance
  return !(
    r1.x + r1.width <= r2.x + 1 ||
    r2.x + r2.width <= r1.x + 1 ||
    r1.y + r1.height <= r2.y + 1 ||
    r2.y + r2.height <= r1.y + 1
  );
}

let totalPass = 0;
let totalFail = 0;

function report(condition, testName, details) {
  if (condition) {
    totalPass++;
    console.log(`  [PASS] ${testName}: ${details}`);
  } else {
    totalFail++;
    console.error(`  [FAIL] ${testName}: ${details}`);
  }
}

async function run() {
  console.log('--- Initializing Test Environment & Tokens ---');
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

  // Setup test users and Year 2 test cadets
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

  // Ensure Year 2 cadets exist for the mark page tests
  await db.collection('users').doc('screenshot-cadet-y2-1').set({
    name: 'Cadet Manoj K',
    regNo: 'KA2025SDAF999001',
    role: 'cadet',
    year: 2,
    type: 'SD',
    isActive: true,
    mustChangePassword: false,
    tokenVersion: 0,
    stats: { total: 10, present: 9, absent: 1, months: {} },
    benefit: 0,
  });

  await db.collection('users').doc('screenshot-cadet-y2-2').set({
    name: 'Cadet Ananya S',
    regNo: 'KA2025SWAF999002',
    role: 'cadet',
    year: 2,
    type: 'SW',
    isActive: true,
    mustChangePassword: false,
    tokenVersion: 0,
    stats: { total: 10, present: 8, absent: 2, months: {} },
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

  const PAGES = [
    { role: 'admin', token: adminToken, key: 'admin_mark', url: 'http://localhost:3000/dashboard/admin/mark', selectYears: [1, 2] },
    { role: 'admin', token: adminToken, key: 'admin_approvals', url: 'http://localhost:3000/dashboard/admin/approvals' },
    { role: 'admin', token: adminToken, key: 'admin_people', url: 'http://localhost:3000/dashboard/admin/people' },
    { role: 'admin', token: adminToken, key: 'admin_reports', url: 'http://localhost:3000/dashboard/admin/reports' },
    { role: 'admin', token: adminToken, key: 'admin_records', url: 'http://localhost:3000/dashboard/admin/records' },
    { role: 'admin', token: adminToken, key: 'admin_overview', url: 'http://localhost:3000/dashboard/admin/overview' },
    { role: 'marker', token: markerToken, key: 'marker_mark', url: 'http://localhost:3000/dashboard/marker/mark', selectYears: [1] },
    { role: 'cadet', token: cadetToken, key: 'cadet_my_attendance', url: 'http://localhost:3000/dashboard/cadet' },
  ];

  try {
    for (const vp of VIEWPORTS) {
      for (const theme of THEMES) {
        console.log(`\n======================================================`);
        console.log(`Testing Viewport ${vp.width}x${vp.height} (${vp.name}) — Mode: ${theme}`);
        console.log(`======================================================`);

        const context = await browser.newContext({
          viewport: { width: vp.width, height: vp.height },
          deviceScaleFactor: 1,
          colorScheme: theme,
        });

        // Suppress initial voice/welcome banner across pages so it doesn't conflict with tests
        await context.addInitScript((th) => {
          try {
            sessionStorage.setItem('ncc_greeted', '1');
            localStorage.setItem('ncc_voice', 'off');
            localStorage.setItem('ncc_theme', th);
          } catch {}
          document.documentElement.setAttribute('data-theme', th);
        }, theme);

        for (const target of PAGES) {
          console.log(`\n--- Page: [${target.role}] ${target.key} (${target.url}) ---`);
          await context.clearCookies();
          await context.addCookies([
            { name: 'ncc_token', value: target.token, url: 'http://localhost:3000' }
          ]);

          const page = await context.newPage();

          // Set theme before load and in localStorage
          await page.addInitScript((th) => {
            try { localStorage.setItem('ncc_theme', th); } catch {}
            document.documentElement.setAttribute('data-theme', th);
          }, theme);

          await page.goto(target.url, { waitUntil: 'domcontentloaded' });
          await page.evaluate((th) => {
            document.documentElement.setAttribute('data-theme', th);
            try { localStorage.setItem('ncc_theme', th); } catch {}
          }, theme);
          await page.waitForSelector('.sidebar, .mobile-header', { timeout: 15000 });

          // If mark page, wait for chips and select required year chips
          if (target.selectYears) {
            await page.waitForSelector('.chip', { timeout: 15000 });
            for (const yr of target.selectYears) {
              const chip = page.locator('.chip').filter({ hasText: `Year ${yr}` }).first();
              await chip.waitFor({ state: 'visible', timeout: 10000 });
              const isSelected = await chip.evaluate(el => el.classList.contains('on'));
              if (!isSelected) {
                await chip.click();
                await page.waitForTimeout(400);
              }
            }
            await page.waitForSelector('.submitbar', { timeout: 10000 });
            await page.waitForSelector('.item', { timeout: 10000 });

            // On mark page, scroll to bottom to test both sticking state and clearance
            await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
            await page.waitForTimeout(500);
          } else {
            await page.waitForTimeout(500);
          }

          // -------------------------------------------------------------------
          // Assertion (a): no element that is position fixed or sticky intersects
          // the sidebar rectangle (except the sidebar's own children), and no two
          // fixed/sticky elements intersect each other.
          // -------------------------------------------------------------------
          const fixedStickyInfo = await page.evaluate(() => {
            const sidebar = document.querySelector('.sidebar');
            const sidebarRect = sidebar ? sidebar.getBoundingClientRect() : null;
            const sidebarVisible = sidebarRect && sidebarRect.width > 0 && sidebarRect.right > 0 &&
              window.getComputedStyle(sidebar).display !== 'none' &&
              window.getComputedStyle(sidebar).visibility !== 'hidden';

            const sRect = sidebarVisible ? {
              left: Math.round(sidebarRect.left),
              top: Math.round(sidebarRect.top),
              right: Math.round(sidebarRect.right),
              bottom: Math.round(sidebarRect.bottom),
              width: Math.round(sidebarRect.width),
              height: Math.round(sidebarRect.height),
            } : null;

            const all = Array.from(document.querySelectorAll('*'));
            const items = [];

            for (const el of all) {
              const cs = window.getComputedStyle(el);
              const pos = cs.position;
              if (pos === 'fixed' || pos === 'sticky') {
                const r = el.getBoundingClientRect();
                if (r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0') {
                  // Ignore elements offscreen (e.g. closed mobile drawer)
                  if (r.right <= 0 || r.bottom <= 0 || r.left >= window.innerWidth || r.top >= window.innerHeight) {
                    continue;
                  }
                  // Skip Next.js dev overlays
                  if (el.closest('[data-nextjs-dialog-overlay]') || el.id === '__next-build-watcher') {
                    continue;
                  }
                  // Skip skip-link when off-screen
                  if (el.classList.contains('skip-link') && r.top < 0) {
                    continue;
                  }

                  const selector = el.className && typeof el.className === 'string'
                    ? `${el.tagName.toLowerCase()}.${el.className.trim().split(/\s+/).join('.')}`
                    : el.tagName.toLowerCase();

                  items.push({
                    selector,
                    pos,
                    isSidebar: el.classList.contains('sidebar'),
                    isSidebarChild: !!el.closest('.sidebar'),
                    rect: {
                      left: Math.round(r.left),
                      top: Math.round(r.top),
                      right: Math.round(r.right),
                      bottom: Math.round(r.bottom),
                      width: Math.round(r.width),
                      height: Math.round(r.height),
                    }
                  });
                }
              }
            }

            return { sRect, items };
          });

          // Check A1: intersection with sidebar
          let sidebarIntersectionFailures = [];
          if (fixedStickyInfo.sRect) {
            const sr = fixedStickyInfo.sRect;
            for (const item of fixedStickyInfo.items) {
              if (item.isSidebar || item.isSidebarChild) continue;
              const ir = item.rect;
              const intersects = !(
                ir.right <= sr.left + 1 ||
                ir.left >= sr.right - 1 ||
                ir.bottom <= sr.top + 1 ||
                ir.top >= sr.bottom - 1
              );
              if (intersects) {
                sidebarIntersectionFailures.push({
                  selector: item.selector,
                  pos: item.pos,
                  rect: ir,
                  sidebarRect: sr,
                });
              }
            }
          }

          report(
            sidebarIntersectionFailures.length === 0,
            'Assertion (a1) No fixed/sticky element intersects sidebar',
            sidebarIntersectionFailures.length === 0
              ? `0 intersections (sidebar: [${fixedStickyInfo.sRect ? `${fixedStickyInfo.sRect.left},${fixedStickyInfo.sRect.top} - ${fixedStickyInfo.sRect.right},${fixedStickyInfo.sRect.bottom}` : 'offscreen'}])`
              : `Found ${sidebarIntersectionFailures.length} offenders: ${JSON.stringify(sidebarIntersectionFailures[0])}`
          );

          // Check A2: no two distinct fixed/sticky elements intersect each other
          const mutualIntersectionFailures = await page.evaluate(() => {
            const elements = [];
            const all = Array.from(document.querySelectorAll('*'));
            for (const el of all) {
              const cs = window.getComputedStyle(el);
              if (cs.position === 'fixed' || cs.position === 'sticky') {
                const r = el.getBoundingClientRect();
                if (r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0') {
                  if (r.right <= 0 || r.bottom <= 0 || r.left >= window.innerWidth || r.top >= window.innerHeight) continue;
                  if (el.closest('[data-nextjs-dialog-overlay]') || el.id === '__next-build-watcher') continue;
                  if (el.classList.contains('skip-link') && r.top < 0) continue;
                  elements.push({ el, rect: r });
                }
              }
            }

            const failures = [];
            for (let i = 0; i < elements.length; i++) {
              for (let j = i + 1; j < elements.length; j++) {
                const A = elements[i];
                const B = elements[j];
                // If one contains the other, that is valid parent-child nesting
                if (A.el.contains(B.el) || B.el.contains(A.el)) continue;

                const rA = A.rect;
                const rB = B.rect;
                const intersects = !(
                  rA.right <= rB.left + 1 ||
                  rA.left >= rB.right - 1 ||
                  rA.bottom <= rB.top + 1 ||
                  rA.top >= rB.bottom - 1
                );
                if (intersects) {
                  failures.push({
                    a: A.el.className || A.el.tagName,
                    b: B.el.className || B.el.tagName,
                    rectA: { left: Math.round(rA.left), top: Math.round(rA.top), right: Math.round(rA.right), bottom: Math.round(rA.bottom) },
                    rectB: { left: Math.round(rB.left), top: Math.round(rB.top), right: Math.round(rB.right), bottom: Math.round(rB.bottom) },
                  });
                }
              }
            }
            return failures;
          });

          report(
            mutualIntersectionFailures.length === 0,
            'Assertion (a2) No two fixed/sticky elements intersect each other',
            mutualIntersectionFailures.length === 0
              ? `0 mutual intersections among ${fixedStickyInfo.items.length} fixed/sticky elements`
              : `Found ${mutualIntersectionFailures.length} collisions: ${JSON.stringify(mutualIntersectionFailures[0])}`
          );

          // -------------------------------------------------------------------
          // Assertion (b): on the mark page scroll to bottom:
          // last roll-call row bottom is above top of .submitbar;
          // Submit button, count text and helper text rectangles do not overlap.
          // -------------------------------------------------------------------
          if (target.selectYears) {
            const markLayout = await page.evaluate(() => {
              const submitbar = document.querySelector('.submitbar');
              if (!submitbar) return { error: 'No .submitbar found' };
              const sRect = submitbar.getBoundingClientRect();

              const rollCallRows = Array.from(document.querySelectorAll('.item')).filter(el => !!el.querySelector('.pa') || el.classList.contains('locked'));
              const lastRow = rollCallRows[rollCallRows.length - 1];
              const lastRowRect = lastRow ? lastRow.getBoundingClientRect() : null;

              const submitBtn = submitbar.querySelector('button.btn-primary');
              const countText = submitbar.querySelector('.bold.small') || submitbar.querySelector('.bold');
              const helperText = submitbar.querySelector('.tiny.muted');

              return {
                submitRect: { x: Math.round(sRect.x), y: Math.round(sRect.y), width: Math.round(sRect.width), height: Math.round(sRect.height) },
                lastRowRect: lastRowRect ? { x: Math.round(lastRowRect.x), y: Math.round(lastRowRect.y), width: Math.round(lastRowRect.width), height: Math.round(lastRowRect.height) } : null,
                submitBtnRect: submitBtn ? { x: Math.round(submitBtn.getBoundingClientRect().x), y: Math.round(submitBtn.getBoundingClientRect().y), width: Math.round(submitBtn.getBoundingClientRect().width), height: Math.round(submitBtn.getBoundingClientRect().height) } : null,
                countTextRect: countText ? { x: Math.round(countText.getBoundingClientRect().x), y: Math.round(countText.getBoundingClientRect().y), width: Math.round(countText.getBoundingClientRect().width), height: Math.round(countText.getBoundingClientRect().height) } : null,
                helperTextRect: helperText ? { x: Math.round(helperText.getBoundingClientRect().x), y: Math.round(helperText.getBoundingClientRect().y), width: Math.round(helperText.getBoundingClientRect().width), height: Math.round(helperText.getBoundingClientRect().height) } : null,
              };
            });

            if (markLayout.error) {
              report(false, 'Assertion (b) .submitbar found', markLayout.error);
            } else {
              const lastRowBottom = markLayout.lastRowRect ? markLayout.lastRowRect.y + markLayout.lastRowRect.height : 0;
              const submitbarTop = markLayout.submitRect.y;
              const rowAboveBar = lastRowBottom <= submitbarTop;

              report(
                rowAboveBar,
                'Assertion (b1) Last roll-call row bottom is above .submitbar top',
                `lastRow.bottom: ${lastRowBottom}px <= submitbar.top: ${submitbarTop}px (clearance: ${submitbarTop - lastRowBottom}px)`
              );

              const btnOverlapCount = rectsOverlap(markLayout.submitBtnRect, markLayout.countTextRect);
              const btnOverlapHelper = rectsOverlap(markLayout.submitBtnRect, markLayout.helperTextRect);
              const countOverlapHelper = rectsOverlap(markLayout.countTextRect, markLayout.helperTextRect);

              const noSubmitBarCollisions = !btnOverlapCount && !btnOverlapHelper && !countOverlapHelper;
              report(
                noSubmitBarCollisions,
                'Assertion (b2) Submit button, count text, and helper text do not overlap',
                `btnOverlapCount: ${btnOverlapCount}, btnOverlapHelper: ${btnOverlapHelper}, countOverlapHelper: ${countOverlapHelper} (submitBtn: [${markLayout.submitBtnRect.x},${markLayout.submitBtnRect.y}], count: [${markLayout.countTextRect.x},${markLayout.countTextRect.y}], helper: [${markLayout.helperTextRect.x},${markLayout.helperTextRect.y}])`
              );
            }
          }

          // -------------------------------------------------------------------
          // Assertion (c): document.documentElement.scrollWidth <= window.innerWidth
          // -------------------------------------------------------------------
          const scrollData = await page.evaluate(() => ({
            scrollWidth: document.documentElement.scrollWidth,
            innerWidth: window.innerWidth,
          }));

          report(
            scrollData.scrollWidth <= scrollData.innerWidth,
            'Assertion (c) No horizontal scrolling',
            `document.scrollWidth: ${scrollData.scrollWidth}px <= window.innerWidth: ${scrollData.innerWidth}px`
          );

          // -------------------------------------------------------------------
          // Assertion (d): sidebar brand block's top >= 0 and footer's bottom <= innerHeight
          // (Applicable when sidebar is in viewport, i.e. width >= 720)
          // -------------------------------------------------------------------
          if (vp.width >= 720) {
            const sidebarBounds = await page.evaluate(() => {
              const brand = document.querySelector('.sidebar-brand');
              const footer = document.querySelector('.sidebar-footer');
              return {
                brand: brand ? { top: Math.round(brand.getBoundingClientRect().top) } : null,
                footer: footer ? { bottom: Math.round(footer.getBoundingClientRect().bottom) } : null,
                innerHeight: window.innerHeight,
              };
            });

            if (sidebarBounds.brand && sidebarBounds.footer) {
              const brandOk = sidebarBounds.brand.top >= 0;
              const footerOk = sidebarBounds.footer.bottom <= sidebarBounds.innerHeight;
              report(
                brandOk && footerOk,
                'Assertion (d) Sidebar brand top >= 0 and footer bottom <= window.innerHeight',
                `brand.top: ${sidebarBounds.brand.top}px >= 0, footer.bottom: ${sidebarBounds.footer.bottom}px <= ${sidebarBounds.innerHeight}px`
              );
            }
          }

          // -------------------------------------------------------------------
          // Assertion (e): no element with text has its right edge beyond the viewport
          // (report the first 5 offenders)
          // -------------------------------------------------------------------
          const textOffenders = await page.evaluate(() => {
            const offenders = [];
            const all = Array.from(document.querySelectorAll('*'));
            for (const el of all) {
              if (el.children.length === 0 && el.textContent && el.textContent.trim().length > 0) {
                const r = el.getBoundingClientRect();
                if (r.width > 0 && r.height > 0) {
                  if (r.right > window.innerWidth + 1) {
                    offenders.push({
                      tag: el.tagName.toLowerCase(),
                      text: el.textContent.trim().slice(0, 24),
                      right: Math.round(r.right),
                      windowWidth: window.innerWidth,
                    });
                  }
                }
              }
            }
            return offenders.slice(0, 5);
          });

          report(
            textOffenders.length === 0,
            'Assertion (e) No text elements overflow viewport right edge',
            textOffenders.length === 0
              ? `0 offenders beyond viewport width ${scrollData.innerWidth}px`
              : `Found ${textOffenders.length} text offenders: ${JSON.stringify(textOffenders)}`
          );

          // -------------------------------------------------------------------
          // Assertion (f): at 390px the bottom bar and .submitbar do not intersect,
          // and the last content element is above the bottom bar after scrolling to the end.
          // -------------------------------------------------------------------
          if (vp.width <= 720) {
            await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
            await page.waitForTimeout(300);

            const mobileData = await page.evaluate(() => {
              const bottomBar = document.querySelector('.mobile-bottom-bar');
              const submitbar = document.querySelector('.submitbar');
              const contentWrap = document.querySelector('.content-wrap');

              // Find the last visible content child
              let lastContentRect = null;
              if (contentWrap) {
                const contentChildren = Array.from(contentWrap.children).filter(el => {
                  const cs = window.getComputedStyle(el);
                  const r = el.getBoundingClientRect();
                  return cs.display !== 'none' && cs.visibility !== 'hidden' && r.height > 0;
                });
                if (contentChildren.length > 0) {
                  const lastChild = contentChildren[contentChildren.length - 1];
                  const r = lastChild.getBoundingClientRect();
                  lastContentRect = {
                    tag: lastChild.tagName.toLowerCase(),
                    className: lastChild.className,
                    top: Math.round(r.top),
                    bottom: Math.round(r.bottom),
                  };
                }
              }

              return {
                bottomBarRect: bottomBar ? { top: Math.round(bottomBar.getBoundingClientRect().top), bottom: Math.round(bottomBar.getBoundingClientRect().bottom) } : null,
                submitRect: submitbar && window.getComputedStyle(submitbar).display !== 'none' ? { top: Math.round(submitbar.getBoundingClientRect().top), bottom: Math.round(submitbar.getBoundingClientRect().bottom) } : null,
                lastContentRect,
              };
            });

            if (mobileData.bottomBarRect) {
              const bTop = mobileData.bottomBarRect.top;

              // If submitbar is present
              if (mobileData.submitRect) {
                const sBottom = mobileData.submitRect.bottom;
                const submitAboveBottomBar = sBottom <= bTop;
                report(
                  submitAboveBottomBar,
                  'Assertion (f1) At 390px, .submitbar bottom is above mobile bottom bar top',
                  `submitbar.bottom: ${sBottom}px <= bottomBar.top: ${bTop}px (clearance: ${bTop - sBottom}px)`
                );
              }

              // Check last content element
              if (mobileData.lastContentRect) {
                const lastBottom = mobileData.lastContentRect.bottom;
                const contentAboveBottomBar = lastBottom <= bTop;
                report(
                  contentAboveBottomBar,
                  'Assertion (f2) At 390px, last content element is above mobile bottom bar',
                  `lastContent (${mobileData.lastContentRect.className || mobileData.lastContentRect.tag}).bottom: ${lastBottom}px <= bottomBar.top: ${bTop}px (clearance: ${bTop - lastBottom}px)`
                );
              }
            }
          }

          // Save screenshots
          const ssName = `${target.key}_${vp.width}x${vp.height}_${theme}.png`;
          const ssPath = path.join(outDir, ssName);
          await page.screenshot({ path: ssPath, fullPage: false });

          const ssFullName = `${target.key}_${vp.width}x${vp.height}_${theme}_full.png`;
          const ssFullPath = path.join(outDir, ssFullName);
          await page.screenshot({ path: ssFullPath, fullPage: true });

          await page.close();
        }

        await context.close();
      }
    }
  } finally {
    await browser.close();
    // Cleanup temporary documents
    await db.collection('users').doc('screenshot-admin').delete().catch(() => {});
    await db.collection('users').doc('screenshot-marker').delete().catch(() => {});
    await db.collection('users').doc('screenshot-cadet').delete().catch(() => {});
    await db.collection('users').doc('screenshot-cadet-y2-1').delete().catch(() => {});
    await db.collection('users').doc('screenshot-cadet-y2-2').delete().catch(() => {});
  }

  console.log(`\n======================================================`);
  console.log(`CHECK-LAYOUT COMPLETED: ${totalPass} PASSED, ${totalFail} FAILED`);
  console.log(`======================================================\n`);

  if (totalFail > 0) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error('Fatal error running check-layout:', err);
  process.exit(1);
});
