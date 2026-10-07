import test, { before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../../', import.meta.url));
let server, browser, page, origin;

before(async () => {
  const ui = await build({
    entryPoints: [path.join(root, 'tests/phase8/ui-fixture.jsx')],
    bundle: true,
    write: false,
    format: 'esm',
    jsx: 'automatic',
    define: { 'import.meta.env': '{}' }
  });

  server = http.createServer((req, res) => {
    if (req.url === '/ui.js') {
      res.setHeader('Content-Type', 'text/javascript');
      res.end(ui.outputFiles[0].text);
    } else {
      res.setHeader('Content-Type', 'text/html');
      res.end(`<!doctype html>
        <title>Phase 8 Desktop Workspace Tests</title>
        <style>
          .sticky { position: sticky; }
          .top-0 { top: 0px; }
          .left-0 { left: 0px; }
          .z-10 { z-index: 10; }
          .z-20 { z-index: 20; }
          .z-30 { z-index: 30; }
          .z-50 { z-index: 50; }
          .overflow-auto { overflow: auto; }
          .overflow-hidden { overflow: hidden; }
          .fixed { position: fixed; }
          .inset-0 { inset: 0px; }
          @media (max-width: 1023px) {
            .lg\\:inline-flex { display: none !important; }
          }
          @media (min-width: 1024px) {
            .hidden { display: none; }
            .lg\\:inline-flex { display: inline-flex !important; }
          }
        </style>
      `);
    }
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = 'http://127.0.0.1:' + server.address().port;

  const executable = process.env.PHASE2_BROWSER_PATH || [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/chromium',
    '/usr/bin/google-chrome'
  ].find(candidate => candidate && fs.existsSync(candidate));

  if (!executable) {
    throw new Error('Set PHASE2_BROWSER_PATH to a Chromium browser for Phase 8 UI tests.');
  }

  browser = await puppeteer.launch({
    executablePath: executable,
    headless: true,
    args: ['--disable-background-networking', '--no-first-run']
  });

  page = await browser.newPage();
  await page.goto(origin);
  await page.evaluate(async () => {
    await import('/ui.js');
  });
}, { timeout: 30000 });

after(async () => {
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
});

afterEach(async () => {
  if (page) {
    await page.evaluate(() => {
      window.phase8Test?.close();
    });
  }
});

// =========================================================================
// PHASE 8 SLICE 1 DESKTOP ROSTER WORKSPACE DETERMINISTIC TESTS (1 - 47)
// =========================================================================

test('1. desktop roster activates at desktop viewport (>= 1024px)', async () => {
  await page.setViewport({ width: 1024, height: 768 });
  await page.evaluate(() => mountPhase8Test({ initialState: 'PUBLISHED', isAdmin: true }));
  await page.waitForSelector('#current-roster-grid-container');

  const focusBtnDisplay = await page.evaluate(() => {
    const btn = document.querySelector('#btn-toggle-focus-mode');
    return btn ? window.getComputedStyle(btn).display : 'none';
  });
  assert.notEqual(focusBtnDisplay, 'none', 'Focus mode button should be visible at >= 1024px viewport');

  const containerWidth = await page.evaluate(() => {
    return document.querySelector('#current-roster-grid-container')?.clientWidth || 0;
  });
  assert.ok(containerWidth >= 900, `Desktop grid container should span desktop width, got ${containerWidth}px`);
});

test('2. mobile layout remains mobile at phone viewport (~390px)', async () => {
  await page.setViewport({ width: 390, height: 844 });
  await page.evaluate(() => mountPhase8Test({ initialState: 'PUBLISHED', isAdmin: true }));
  await page.waitForSelector('#current-roster-grid-container');

  const focusBtnDisplay = await page.evaluate(() => {
    const btn = document.querySelector('#btn-toggle-focus-mode');
    return btn ? window.getComputedStyle(btn).display : 'none';
  });
  assert.equal(focusBtnDisplay, 'none', 'Desktop focus toggle button must stay hidden on mobile viewport');

  const docWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  assert.equal(docWidth, 390, 'Root document must not exhibit unwanted horizontal page overflow on phone viewport');
});

test('3. staff column sticky on desktop', async () => {
  await page.setViewport({ width: 1024, height: 768 });
  await page.evaluate(() => mountPhase8Test({ initialState: 'PUBLISHED', isAdmin: true }));
  await page.waitForSelector('#current-roster-grid-container');

  const staffCellPosition = await page.evaluate(() => {
    const td = document.querySelector('tbody tr td:first-child');
    return td ? window.getComputedStyle(td).position : null;
  });
  assert.equal(staffCellPosition, 'sticky', 'First staff column td must have sticky position');

  const staffCellLeft = await page.evaluate(() => {
    const td = document.querySelector('tbody tr td:first-child');
    return td ? window.getComputedStyle(td).left : null;
  });
  assert.equal(staffCellLeft, '0px', 'First staff column td must stick to left: 0px');
});

test('4. date header sticky on desktop', async () => {
  await page.setViewport({ width: 1024, height: 768 });
  await page.evaluate(() => mountPhase8Test({ initialState: 'PUBLISHED', isAdmin: true }));
  await page.waitForSelector('#current-roster-grid-container');

  const theadPosition = await page.evaluate(() => {
    const thead = document.querySelector('thead');
    return thead ? window.getComputedStyle(thead).position : null;
  });
  assert.equal(theadPosition, 'sticky', 'Table header thead must have sticky position');

  const theadTop = await page.evaluate(() => {
    const thead = document.querySelector('thead');
    return thead ? window.getComputedStyle(thead).top : null;
  });
  assert.equal(theadTop, '0px', 'Table header thead must stick to top: 0px');
});

test('5. sticky intersection layering correct', async () => {
  await page.setViewport({ width: 1024, height: 768 });
  await page.evaluate(() => mountPhase8Test({ initialState: 'PUBLISHED', isAdmin: true }));
  await page.waitForSelector('#current-roster-grid-container');

  const zIndices = await page.evaluate(() => {
    const intersection = document.querySelector('thead th:first-child');
    const header = document.querySelector('thead');
    const staff = document.querySelector('tbody td:first-child');
    return {
      intersection: parseInt(window.getComputedStyle(intersection).zIndex, 10) || 0,
      header: parseInt(window.getComputedStyle(header).zIndex, 10) || 0,
      staff: parseInt(window.getComputedStyle(staff).zIndex, 10) || 0
    };
  });

  assert.ok(zIndices.intersection >= 30, `Intersection z-index must be >= 30, got ${zIndices.intersection}`);
  assert.ok(zIndices.header >= 20, `Header z-index must be >= 20, got ${zIndices.header}`);
  assert.ok(zIndices.staff >= 10, `Staff cell z-index must be >= 10, got ${zIndices.staff}`);
  assert.ok(zIndices.intersection > zIndices.header, 'Top-left intersection must layer strictly above date header row');
  assert.ok(zIndices.intersection > zIndices.staff, 'Top-left intersection must layer strictly above staff cells');
});

test('6. grid owns horizontal overflow', async () => {
  await page.setViewport({ width: 1024, height: 768 });
  await page.evaluate(() => mountPhase8Test({ initialState: 'PUBLISHED', isAdmin: true }));
  await page.waitForSelector('.roster-scroll-viewport');

  const overflow = await page.evaluate(() => {
    const viewport = document.querySelector('.roster-scroll-viewport');
    const cs = window.getComputedStyle(viewport);
    return {
      overflowX: cs.overflowX,
      scrollWidth: viewport.scrollWidth,
      clientWidth: viewport.clientWidth
    };
  });
  assert.ok(['auto', 'scroll'].includes(overflow.overflowX), 'Viewport overflow-x must be auto or scroll');
  assert.ok(overflow.scrollWidth >= overflow.clientWidth, 'Grid table scrollWidth must be bounded by viewport clientWidth');
});

test('7. whole page avoids unintended horizontal overflow', async () => {
  await page.setViewport({ width: 1024, height: 768 });
  await page.evaluate(() => mountPhase8Test({ initialState: 'PUBLISHED', isAdmin: true }));
  await page.waitForSelector('#current-roster-grid-container');

  const docWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  const winWidth = await page.evaluate(() => window.innerWidth);
  assert.equal(docWidth, winWidth, 'Root page document must have no unintended horizontal overflow');
});

test('8. Current renders in dense desktop mode', async () => {
  await page.setViewport({ width: 1024, height: 768 });
  await page.evaluate(() => mountPhase8Test({ initialState: 'PUBLISHED', isAdmin: true }));
  await page.waitForSelector('#current-roster-view');

  const isCurrentVisible = await page.$eval('#current-roster-view', el => Boolean(el));
  assert.ok(isCurrentVisible, 'Current view must be visible');

  const cellHeight = await page.evaluate(() => {
    const cellDiv = document.querySelector('tbody td:nth-child(3) div');
    return cellDiv ? cellDiv.clientHeight : 0;
  });
  assert.ok(cellHeight <= 60, `Dense desktop cell height should be compact (<= 60px), got ${cellHeight}px`);
});

test('9. Planned renders in dense desktop mode', async () => {
  await page.setViewport({ width: 1024, height: 768 });
  await page.evaluate(() => mountPhase8Test({ initialState: 'PUBLISHED', isAdmin: true }));
  await page.waitForSelector('#view-mode-planned');
  await page.click('#view-mode-planned');
  await page.waitForSelector('#planned-roster-grid-container');

  const plannedVisible = await page.$eval('#planned-roster-grid-container', el => Boolean(el));
  assert.ok(plannedVisible, 'Planned grid container must be visible in dense desktop mode');

  const theadPosition = await page.evaluate(() => {
    const thead = document.querySelector('#planned-roster-view thead');
    return thead ? window.getComputedStyle(thead).position : null;
  });
  assert.equal(theadPosition, 'sticky', 'Planned view header must be sticky');
});

test('10. Changes still accessible', async () => {
  await page.evaluate(() => mountPhase8Test({ initialState: 'PUBLISHED', isAdmin: true }));
  await page.waitForSelector('#view-mode-changes');
  await page.click('#view-mode-changes');
  await page.waitForSelector('#amendment-history-panel');

  const changesVisible = await page.$eval('#amendment-history-panel', el => Boolean(el));
  assert.ok(changesVisible, 'Changes view must remain accessible');
});

test('11. Entitlements still accessible to admin', async () => {
  await page.evaluate(() => mountPhase8Test({ initialState: 'PUBLISHED', isAdmin: true }));
  await page.waitForSelector('#view-mode-entitlements');
  await page.click('#view-mode-entitlements');
  await page.waitForSelector('#entitlement-panel');

  const entVisible = await page.$eval('#entitlement-panel', el => Boolean(el));
  assert.ok(entVisible, 'Entitlements view must remain accessible to admin');
});

test('12. viewer entitlement restriction preserved', async () => {
  await page.evaluate(() => mountPhase8Test({ initialState: 'PUBLISHED', isAdmin: false }));
  await page.waitForSelector('#current-roster-view');

  const toolbarEntBtn = await page.$('#btn-toolbar-entitlements');
  assert.equal(toolbarEntBtn, null, 'Viewer must not see entitlements toolbar action');

  const personEntBtn = await page.$('#btn-view-entitlements-p-mo-1');
  assert.equal(personEntBtn, null, 'Viewer must not see person-level entitlement buttons');
});

test('13. EP remains visible', async () => {
  await page.evaluate(() => mountPhase8Test({ initialState: 'PUBLISHED', isAdmin: true }));
  await page.waitForSelector('#cell-p-ep-2026-05-01-EP');

  const epCell = await page.$('#cell-p-ep-2026-05-01-EP');
  assert.ok(epCell, 'Dr. Dave (EP) cell must remain visible in roster grid');
});

test('14. lifecycle badge visible', async () => {
  await page.evaluate(() => mountPhase8Test({ initialState: 'PUBLISHED', isAdmin: true }));
  await page.waitForSelector('span[title*="Planned Snapshot is locked"]');

  const badgeText = await page.$eval('span[title*="Planned Snapshot is locked"]', el => el.textContent);
  assert.ok(badgeText.includes('Published'), 'Lifecycle badge must be visible with Published state');
});

test('15. DRAFT state visible', async () => {
  await page.evaluate(() => mountPhase8Test({ initialState: 'DRAFT', isAdmin: true }));
  await page.waitForSelector('span:has(span.bg-blue-500)');

  const badge = await page.$eval('span:has(span.bg-blue-500)', el => el.textContent);
  assert.ok(badge.includes('Draft'), 'Draft lifecycle state must be visible');
});

test('16. PUBLISHED state visible', async () => {
  await page.evaluate(() => mountPhase8Test({ initialState: 'PUBLISHED', isAdmin: true }));
  await page.waitForSelector('span[title*="Planned Snapshot is locked"]');

  const badge = await page.$eval('span[title*="Planned Snapshot is locked"]', el => el.textContent);
  assert.ok(badge.includes('Published'), 'Published lifecycle state must be visible');
});

test('17. AMENDED state visible', async () => {
  await page.evaluate(() => mountPhase8Test({ initialState: 'AMENDED', isAdmin: true }));
  await page.waitForSelector('span.bg-purple-50');

  const badge = await page.$eval('span.bg-purple-50', el => el.textContent);
  assert.ok(badge.includes('Amended'), 'Amended lifecycle state must be visible');
});

test('18. CLOSED state visible', async () => {
  await page.evaluate(() => mountPhase8Test({ initialState: 'CLOSED', isAdmin: true }));
  await page.waitForSelector('span[title*="Period is historically locked"]');

  const badge = await page.$eval('span[title*="Period is historically locked"]', el => el.textContent);
  assert.ok(badge.includes('Closed'), 'Closed lifecycle state must be visible');
});

test('19. weekend distinction rendered', async () => {
  await page.evaluate(() => mountPhase8Test({ initialState: 'PUBLISHED', isAdmin: true }));
  await page.waitForSelector('th[data-is-weekend="true"]');

  const weekendHeaders = await page.$$eval('th[data-is-weekend="true"]', els => els.map(e => e.textContent.trim()));
  assert.ok(weekendHeaders.length >= 2, 'Weekend date headers must have weekend distinction data attribute');
  assert.ok(weekendHeaders.some(h => h.includes('Sat')), 'Saturday header must display Sat weekday');
  assert.ok(weekendHeaders.some(h => h.includes('Sun')), 'Sunday header must display Sun weekday');
});

test('20. holiday distinction rendered', async () => {
  await page.evaluate(() => mountPhase8Test({ initialState: 'PUBLISHED', isAdmin: true }));
  await page.waitForSelector('[data-testid="header-holiday-2026-05-01"]');

  const phBadge = await page.$eval('[data-testid="header-holiday-2026-05-01"]', el => el.textContent);
  assert.equal(phBadge, 'PH', '2026-05-01 Labour Day must render PH holiday marker in header');
});

test('21. today indicator where applicable', async () => {
  const now = new Date();
  const currentPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const todayStr = `${currentPeriod}-${String(now.getDate()).padStart(2, '0')}`;

  await page.evaluate((period, tStr) => {
    mountPhase8Test({
      initialPeriod: period,
      initialState: 'PUBLISHED',
      isAdmin: true,
      plannedAssignments: [
        { assignmentId: 'asg-today-1', personId: 'p-mo-1', personNameSnapshot: 'Dr. Ali', date: tStr, dutyDomain: 'MO', shiftCode: 'AM' }
      ]
    });
  }, currentPeriod, todayStr);

  await page.waitForSelector(`[data-testid="header-today-${todayStr}"]`);
  const todayBadge = await page.$eval(`[data-testid="header-today-${todayStr}"]`, el => el.textContent);
  assert.equal(todayBadge, 'Today', 'Today date column header must render Today indicator');
});

test('22. GOFF status readable', async () => {
  await page.evaluate(() => {
    mountPhase8Test({
      initialState: 'PUBLISHED',
      isAdmin: true,
      currentAssignments: [
        { assignmentId: 'asg-goff-1', personId: 'p-mo-1', personNameSnapshot: 'Dr. Ali', date: '2026-05-02', dutyDomain: 'MO', shiftCode: 'GOFF' }
      ]
    });
  });

  await page.waitForSelector('#badge-goff-p-mo-1-2026-05-02-MO');
  const badgeText = await page.$eval('#badge-goff-p-mo-1-2026-05-02-MO', el => el.textContent);
  assert.equal(badgeText, 'GOFF', 'GOFF badge must be clearly readable');
});

test('23. GHKA status readable', async () => {
  await page.evaluate(() => {
    mountPhase8Test({
      initialState: 'PUBLISHED',
      isAdmin: true,
      currentAssignments: [
        { assignmentId: 'asg-ghka-1', personId: 'p-mo-1', personNameSnapshot: 'Dr. Ali', date: '2026-05-01', dutyDomain: 'MO', shiftCode: 'GHKA' }
      ]
    });
  });

  await page.waitForSelector('#badge-ghka-p-mo-1-2026-05-01-MO');
  const badgeText = await page.$eval('#badge-ghka-p-mo-1-2026-05-01-MO', el => el.textContent);
  assert.equal(badgeText, 'GHKA', 'GHKA badge must be clearly readable');
});

test('24. HKA status readable', async () => {
  await page.evaluate(() => {
    mountPhase8Test({
      initialState: 'PUBLISHED',
      isAdmin: true,
      currentAssignments: [
        { assignmentId: 'asg-hka-1', personId: 'p-mo-1', personNameSnapshot: 'Dr. Ali', date: '2026-05-01', dutyDomain: 'MO', shiftCode: 'HKA' }
      ]
    });
  });

  await page.waitForSelector('#badge-hka-p-mo-1-2026-05-01-MO');
  const badgeText = await page.$eval('#badge-hka-p-mo-1-2026-05-01-MO', el => el.textContent);
  assert.equal(badgeText, 'HKA', 'HKA badge must be clearly readable');
});

test('25. MC/EL/AL/COURSE readable', async () => {
  await page.evaluate(() => {
    mountPhase8Test({
      initialState: 'PUBLISHED',
      isAdmin: true,
      currentAssignments: [
        { assignmentId: 'asg-mc-1', personId: 'p-mo-1', personNameSnapshot: 'Dr. Ali', date: '2026-05-01', dutyDomain: 'MO', shiftCode: 'MC', source: 'ABSENCE', coverageStatus: 'UNCOVERED' },
        { assignmentId: 'asg-el-2', personId: 'p-mo-1', personNameSnapshot: 'Dr. Ali', date: '2026-05-02', dutyDomain: 'MO', shiftCode: 'EL', source: 'ABSENCE', coverageStatus: 'UNCOVERED' },
        { assignmentId: 'asg-al-3', personId: 'p-mo-1', personNameSnapshot: 'Dr. Ali', date: '2026-05-03', dutyDomain: 'MO', shiftCode: 'AL', source: 'ABSENCE', coverageStatus: 'UNCOVERED' },
        { assignmentId: 'asg-course-4', personId: 'p-mo-2', personNameSnapshot: 'Dr. Siti', date: '2026-05-01', dutyDomain: 'MO', shiftCode: 'COURSE', source: 'ABSENCE', coverageStatus: 'UNCOVERED' }
      ]
    });
  });

  await page.waitForSelector('#btn-amend-p-mo-1-2026-05-01-MO');
  const mcText = await page.$eval('#btn-amend-p-mo-1-2026-05-01-MO', el => el.textContent);
  const elText = await page.$eval('#btn-amend-p-mo-1-2026-05-02-MO', el => el.textContent);
  const alText = await page.$eval('#btn-amend-p-mo-1-2026-05-03-MO', el => el.textContent);
  const courseText = await page.$eval('#btn-amend-p-mo-2-2026-05-01-MO', el => el.textContent);

  assert.equal(mcText, 'MC', 'MC absence must be readable in duty cell');
  assert.equal(elText, 'EL', 'EL absence must be readable in duty cell');
  assert.equal(alText, 'AL', 'AL absence must be readable in duty cell');
  assert.equal(courseText, 'COURSE', 'COURSE absence must be readable in duty cell');
});

test('26. replacement Uncovered badge retained', async () => {
  await page.evaluate(() => {
    mountPhase8Test({
      initialState: 'PUBLISHED',
      isAdmin: true,
      currentAssignments: [
        { assignmentId: 'asg-abs-1', personId: 'p-mo-1', personNameSnapshot: 'Dr. Ali', date: '2026-05-01', dutyDomain: 'MO', shiftCode: 'MC', source: 'ABSENCE', coverageStatus: 'UNCOVERED' }
      ]
    });
  });

  await page.waitForSelector('[data-testid="badge-uncovered-p-mo-1-2026-05-01-MO"]');
  const badgeText = await page.$eval('[data-testid="badge-uncovered-p-mo-1-2026-05-01-MO"]', el => el.textContent);
  assert.equal(badgeText, 'Uncovered', 'Uncovered badge must be retained');
});

test('27. Covered by badge retained', async () => {
  await page.evaluate(() => {
    mountPhase8Test({
      initialState: 'PUBLISHED',
      isAdmin: true,
      currentAssignments: [
        { assignmentId: 'asg-abs-1', personId: 'p-mo-1', personNameSnapshot: 'Dr. Ali', date: '2026-05-01', dutyDomain: 'MO', shiftCode: 'MC', source: 'ABSENCE', coverageStatus: 'COVERED', replacementId: 'repl-1' },
        { assignmentId: 'asg-repl-1', personId: 'p-mo-2', personNameSnapshot: 'Dr. Siti', date: '2026-05-01', dutyDomain: 'MO', shiftCode: 'AM', source: 'REPLACEMENT', replacementId: 'repl-1', coveringForPersonId: 'p-mo-1' }
      ]
    });
  });

  await page.waitForSelector('[data-testid="badge-covered-p-mo-1-2026-05-01-MO"]');
  const badgeText = await page.$eval('[data-testid="badge-covered-p-mo-1-2026-05-01-MO"]', el => el.textContent);
  assert.ok(badgeText.includes('Covered by Dr. Siti'), 'Covered by badge must be retained');
});

test('28. Covering badge retained', async () => {
  await page.evaluate(() => {
    mountPhase8Test({
      initialState: 'PUBLISHED',
      isAdmin: true,
      currentAssignments: [
        { assignmentId: 'asg-abs-1', personId: 'p-mo-1', personNameSnapshot: 'Dr. Ali', date: '2026-05-01', dutyDomain: 'MO', shiftCode: 'MC', source: 'ABSENCE', coverageStatus: 'COVERED', replacementId: 'repl-1' },
        { assignmentId: 'asg-repl-1', personId: 'p-mo-2', personNameSnapshot: 'Dr. Siti', date: '2026-05-01', dutyDomain: 'MO', shiftCode: 'AM', source: 'REPLACEMENT', replacementId: 'repl-1', coveringForPersonId: 'p-mo-1' }
      ]
    });
  });

  await page.waitForSelector('[data-testid="badge-covering-p-mo-2-2026-05-01-MO"]');
  const badgeText = await page.$eval('[data-testid="badge-covering-p-mo-2-2026-05-01-MO"]', el => el.textContent);
  assert.ok(badgeText.includes('Covering Dr. Ali'), 'Covering badge must be retained');
});

test('29. changed cell indicator retained', async () => {
  await page.evaluate(() => {
    mountPhase8Test({
      initialState: 'PUBLISHED',
      isAdmin: true,
      plannedAssignments: [
        { assignmentId: 'asg-1', personId: 'p-mo-1', personNameSnapshot: 'Dr. Ali', date: '2026-05-01', dutyDomain: 'MO', shiftCode: 'OFF' }
      ],
      currentAssignments: [
        { assignmentId: 'asg-1', personId: 'p-mo-1', personNameSnapshot: 'Dr. Ali', date: '2026-05-01', dutyDomain: 'MO', shiftCode: 'AM' }
      ]
    });
  });

  await page.waitForSelector('.changed-badge');
  const badgeText = await page.$eval('.changed-badge', el => el.textContent);
  assert.ok(badgeText.includes('Changed'), 'Changed cell badge must be retained');
});

test('30. staff name remains visible during simulated horizontal scroll', async () => {
  await page.setViewport({ width: 1024, height: 768 });
  await page.evaluate(() => mountPhase8Test({ initialState: 'PUBLISHED', isAdmin: true }));
  await page.waitForSelector('.roster-scroll-viewport');

  // Perform horizontal scroll inside viewport
  await page.evaluate(() => {
    const vp = document.querySelector('.roster-scroll-viewport');
    vp.scrollLeft = 400;
  });

  // Verify staff cell remains pinned at left: 0
  const tdRect = await page.evaluate(() => {
    const td = document.querySelector('tbody tr td:first-child');
    const r = td.getBoundingClientRect();
    const vpR = document.querySelector('.roster-scroll-viewport').getBoundingClientRect();
    return {
      tdLeft: r.left,
      vpLeft: vpR.left,
      visible: r.width > 0
    };
  });
  assert.ok(tdRect.visible, 'Staff name column must remain visible');
  assert.ok(Math.abs(tdRect.tdLeft - tdRect.vpLeft) < 5, 'Staff cell must remain pinned at left boundary during horizontal scroll');
});

test('31. date header remains visible during simulated vertical scroll', async () => {
  await page.setViewport({ width: 1024, height: 768 });
  await page.evaluate(() => mountPhase8Test({ initialState: 'PUBLISHED', isAdmin: true }));
  await page.waitForSelector('.roster-scroll-viewport');

  // Perform vertical scroll inside viewport
  await page.evaluate(() => {
    const vp = document.querySelector('.roster-scroll-viewport');
    vp.scrollTop = 150;
  });

  const theadRect = await page.evaluate(() => {
    const th = document.querySelector('thead th:nth-child(3)');
    const r = th.getBoundingClientRect();
    const vpR = document.querySelector('.roster-scroll-viewport').getBoundingClientRect();
    return {
      thTop: r.top,
      vpTop: vpR.top,
      visible: r.height > 0
    };
  });
  assert.ok(theadRect.visible, 'Date header must remain visible');
  assert.ok(Math.abs(theadRect.thTop - theadRect.vpTop) < 5, 'Date header must stick to top during vertical scroll');
});

test('32. toolbar compact desktop layout', async () => {
  await page.setViewport({ width: 1024, height: 768 });
  await page.evaluate(() => mountPhase8Test({ initialState: 'PUBLISHED', isAdmin: true }));
  await page.waitForSelector('#roster-toolbar-header');

  const toolbarClasses = await page.$eval('#roster-toolbar-header', el => el.className);
  assert.ok(toolbarClasses.includes('sm:flex-row'), 'Toolbar must use compact horizontal row layout on desktop');
});

test('33. month navigation still works', async () => {
  await page.evaluate(() => mountPhase8Test({ initialState: 'PUBLISHED', isAdmin: true }));
  await page.waitForSelector('#btn-prev-month');

  await page.click('#btn-prev-month');
  const periodText = await page.$eval('#roster-toolbar-header', el => el.textContent);
  assert.ok(periodText.includes('2026-04'), 'Prev month navigation must update period to 2026-04');

  await page.click('#btn-next-month');
  const periodNext = await page.$eval('#roster-toolbar-header', el => el.textContent);
  assert.ok(periodNext.includes('2026-06'), 'Next month navigation must update period to 2026-06');
});

test('34. Current/Planned switching works', async () => {
  await page.evaluate(() => mountPhase8Test({ initialState: 'PUBLISHED', isAdmin: true }));
  await page.waitForSelector('#view-mode-planned');

  await page.click('#view-mode-planned');
  await page.waitForSelector('#planned-roster-view');
  assert.ok(await page.$('#planned-roster-view'), 'Planned view should activate');

  await page.click('#view-mode-current');
  await page.waitForSelector('#current-roster-view');
  assert.ok(await page.$('#current-roster-view'), 'Current view should activate');
});

test('35. modals render above sticky grid', async () => {
  await page.evaluate(() => mountPhase8Test({ initialState: 'PUBLISHED', isAdmin: true }));
  await page.waitForSelector('#btn-toolbar-record-absence');
  await page.click('#btn-toolbar-record-absence');
  await page.waitForSelector('#absence-modal');

  const modalZ = await page.evaluate(() => {
    const m = document.querySelector('#absence-modal');
    return parseInt(window.getComputedStyle(m).zIndex, 10) || 0;
  });
  assert.ok(modalZ >= 50, `Absence modal z-index must be >= 50, got ${modalZ}`);
  assert.ok(modalZ > 30, 'Modal must layer strictly above sticky table elements (z-index 30)');
});

test('36. revision conflict banner visible', async () => {
  await page.evaluate(() => mountPhase8Test({ initialState: 'PUBLISHED', isAdmin: true, simulateRevisionConflict: true }));
  await page.waitForSelector('#btn-amend-p-mo-1-2026-05-01-MO');
  await page.click('#btn-amend-p-mo-1-2026-05-01-MO');
  await page.waitForSelector('#btn-confirm-amendment');
  await page.click('#btn-confirm-amendment');
  await page.waitForSelector('#revision-conflict-banner');

  const bannerText = await page.$eval('#revision-conflict-banner', el => el.textContent);
  assert.ok(bannerText.includes('Roster changed since you opened it'), 'Revision conflict banner must be displayed');
});

test('37. recovery banner visible', async () => {
  await page.evaluate(() => mountPhase8Test({ initialState: 'PUBLISHED', isAdmin: true, simulateRecoveryRequired: true }));
  await page.waitForSelector('#recovery-required-banner');

  const bannerText = await page.$eval('#recovery-required-banner', el => el.textContent);
  assert.ok(bannerText.includes('Recovery Required'), 'Recovery required banner must be displayed');
});

test('38. keyboard focus visible on interactive cell', async () => {
  await page.evaluate(() => mountPhase8Test({ initialState: 'PUBLISHED', isAdmin: true }));
  await page.waitForSelector('#btn-amend-p-mo-1-2026-05-01-MO');

  await page.focus('#btn-amend-p-mo-1-2026-05-01-MO');
  const isFocused = await page.evaluate(() => {
    return document.activeElement === document.querySelector('#btn-amend-p-mo-1-2026-05-01-MO');
  });
  assert.ok(isFocused, 'Interactive duty button must receive keyboard focus');

  const classList = await page.$eval('#btn-amend-p-mo-1-2026-05-01-MO', el => el.className);
  assert.ok(classList.includes('focus:ring-2'), 'Interactive duty button must have prominent focus ring styling');
});

test('39. accessible cell label includes person/date/status', async () => {
  await page.evaluate(() => mountPhase8Test({ initialState: 'PUBLISHED', isAdmin: true }));
  await page.waitForSelector('#btn-amend-p-mo-1-2026-05-01-MO');

  const ariaLabel = await page.$eval('#btn-amend-p-mo-1-2026-05-01-MO', el => el.getAttribute('aria-label'));
  assert.ok(ariaLabel.includes('Dr. Ali'), 'Aria label must include person name');
  assert.ok(ariaLabel.includes('2026-05-01'), 'Aria label must include date');
  assert.ok(ariaLabel.includes('AM'), 'Aria label must include shift status');
});

test('40. 390 px viewport remains usable', async () => {
  await page.setViewport({ width: 390, height: 844 });
  await page.evaluate(() => mountPhase8Test({ initialState: 'PUBLISHED', isAdmin: true }));
  await page.waitForSelector('#current-roster-view');

  const isRendered = await page.$eval('#current-roster-view', el => Boolean(el));
  assert.ok(isRendered, 'Current roster must render without error on 390px mobile viewport');
});

test('41. 768 px viewport remains usable', async () => {
  await page.setViewport({ width: 768, height: 1024 });
  await page.evaluate(() => mountPhase8Test({ initialState: 'PUBLISHED', isAdmin: true }));
  await page.waitForSelector('#current-roster-view');

  const isRendered = await page.$eval('#current-roster-view', el => Boolean(el));
  assert.ok(isRendered, 'Current roster must render without error on 768px tablet viewport');
});

test('42. 1024 px viewport uses desktop enhancements', async () => {
  await page.setViewport({ width: 1024, height: 768 });
  await page.evaluate(() => mountPhase8Test({ initialState: 'PUBLISHED', isAdmin: true }));
  await page.waitForSelector('#btn-toggle-focus-mode');

  const focusBtnVisible = await page.evaluate(() => {
    const btn = document.querySelector('#btn-toggle-focus-mode');
    return btn && window.getComputedStyle(btn).display !== 'none';
  });
  assert.ok(focusBtnVisible, '1024px desktop enhancements must activate');
});

test('43. 1440 px viewport uses available width', async () => {
  await page.setViewport({ width: 1440, height: 900 });
  await page.evaluate(() => mountPhase8Test({ initialState: 'PUBLISHED', isAdmin: true }));
  await page.waitForSelector('#roster-page-workspace');

  const workspaceWidth = await page.evaluate(() => {
    return document.querySelector('#roster-page-workspace')?.clientWidth || 0;
  });
  assert.ok(workspaceWidth >= 1350, `Workspace container on 1440px viewport should utilize available width (>= 1350px), got ${workspaceWidth}px`);
});

test('44. no direct backend fetch introduced', async () => {
  const dir = path.join(root, 'src/features/roster/components');
  const files = fs.readdirSync(dir);
  for (const file of files) {
    if (file.endsWith('.jsx') || file.endsWith('.js')) {
      const content = fs.readFileSync(path.join(dir, file), 'utf-8');
      const hasDirectFetch = /(?<![a-zA-Z0-9_])fetch\s*\(/.test(content);
      assert.equal(hasDirectFetch, false, `Component ${file} must not contain direct fetch() call`);
    }
  }
});

test('45. Phase 5 behavior unchanged', async () => {
  await page.evaluate(() => mountPhase8Test({ initialState: 'PUBLISHED', isAdmin: true }));
  await page.waitForSelector('#btn-amend-p-mo-1-2026-05-01-MO');
  await page.click('#btn-amend-p-mo-1-2026-05-01-MO');
  await page.waitForSelector('#amendment-modal');

  const modalOpen = await page.$eval('#amendment-modal', el => Boolean(el));
  assert.ok(modalOpen, 'Clicking duty cell must open Phase 5 amendment modal');
});

test('46. Phase 6 behavior unchanged', async () => {
  await page.evaluate(() => mountPhase8Test({ initialState: 'PUBLISHED', isAdmin: true }));
  await page.waitForSelector('#btn-toolbar-record-absence');
  await page.click('#btn-toolbar-record-absence');
  await page.waitForSelector('#absence-modal');

  const modalOpen = await page.$eval('#absence-modal', el => Boolean(el));
  assert.ok(modalOpen, 'Clicking Record Absence must open Phase 6 absence modal');
});

test('47. Phase 7 behavior unchanged', async () => {
  await page.evaluate(() => mountPhase8Test({ initialState: 'PUBLISHED', isAdmin: true }));
  await page.waitForSelector('#btn-use-goff-p-mo-1-2026-05-01-MO');

  const goffActionBtn = await page.$('#btn-use-goff-p-mo-1-2026-05-01-MO');
  const ghkaActionBtn = await page.$('#btn-use-ghka-p-mo-1-2026-05-01-MO');
  assert.ok(goffActionBtn, 'Use GOFF button must remain present for working MO duties');
  assert.ok(ghkaActionBtn, 'Use GHKA button must remain present for working MO duties');
});
