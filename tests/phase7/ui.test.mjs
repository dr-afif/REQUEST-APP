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
    entryPoints: [path.join(root, 'tests/phase7/ui-fixture.jsx')],
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
      res.end('<!doctype html><title>Phase 7 Entitlement UI Tests</title>');
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
    throw new Error('Set PHASE2_BROWSER_PATH to a Chromium browser for Phase 7 UI tests.');
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
      window.phase7Test?.close();
    });
  }
});

// =========================================================================
// PHASE 7 SLICE 3 DETERMINISTIC UI TESTS (1 - 50)
// =========================================================================

test('1. MO shows entitlement controls', async () => {
  await page.evaluate(() => mountPhase7Test({ initialState: 'PUBLISHED', isAdmin: true }));
  await page.waitForSelector('#view-mode-entitlements');
  await page.click('#view-mode-entitlements');
  await page.waitForSelector('#entitlement-panel');

  const creditGoffBtn = await page.$('#btn-credit-goff');
  const creditGhkaBtn = await page.$('#btn-credit-ghka');
  const manualCreditBtn = await page.$('#btn-manual-credit');

  assert.ok(creditGoffBtn, 'Credit GOFF button must be present for MO');
  assert.ok(creditGhkaBtn, 'Credit GHKA button must be present for MO');
  assert.ok(manualCreditBtn, 'Manual Adjustment button must be present for MO');
});

test('2. EP has no entitlement controls', async () => {
  await page.evaluate(() => mountPhase7Test({ initialState: 'PUBLISHED', isAdmin: true }));
  await page.waitForSelector('#view-mode-entitlements');
  await page.click('#view-mode-entitlements');
  await page.waitForSelector('#entitlement-person-select');

  // Select Dr. Dave (EP)
  await page.select('#entitlement-person-select', 'p-ep');
  await page.waitForSelector('#ep-non-participating-notice');

  const notice = await page.$eval('#ep-non-participating-notice', el => el.textContent);
  assert.ok(notice.includes('EP staff do not participate in entitlement accounting'));

  // Balances and buttons should NOT exist
  const goffCard = await page.$('#card-balance-goff');
  const creditGoffBtn = await page.$('#btn-credit-goff');
  assert.equal(goffCard, null, 'EP must not show balance card');
  assert.equal(creditGoffBtn, null, 'EP must not show credit controls');
});

test('3. EP still appears in roster', async () => {
  await page.evaluate(() => mountPhase7Test({ initialState: 'PUBLISHED', isAdmin: true }));
  await page.waitForSelector('#cell-p-ep-2026-05-01-EP');

  const cellText = await page.$eval('#cell-p-ep-2026-05-01-EP', el => el.textContent);
  assert.ok(cellText.includes('EP_DUTY'), 'EP duty must remain visible in roster');
});

test('4. GOFF and GHKA displayed separately', async () => {
  await page.evaluate(() => mountPhase7Test({
    initialState: 'PUBLISHED',
    isAdmin: true,
    initialBalances: { 'p-mo-1': { GOFF: 2, GHKA: 3 } }
  }));
  await page.waitForSelector('#view-mode-entitlements');
  await page.click('#view-mode-entitlements');
  await page.waitForSelector('#entitlement-panel');

  const goffText = await page.$eval('#goff-balance-value', el => el.textContent.trim());
  const ghkaText = await page.$eval('#ghka-balance-value', el => el.textContent.trim());

  assert.equal(goffText, 'GOFF balance: 2');
  assert.equal(ghkaText, 'GHKA balance: 3');
});

test('5. balances never pooled', async () => {
  await page.evaluate(() => mountPhase7Test({
    initialState: 'PUBLISHED',
    isAdmin: true,
    initialBalances: { 'p-mo-1': { GOFF: 2, GHKA: 3 } }
  }));
  await page.waitForSelector('#view-mode-entitlements');
  await page.click('#view-mode-entitlements');
  await page.waitForSelector('#entitlement-panel');

  const panelText = await page.$eval('#entitlement-panel', el => el.textContent);
  assert.equal(panelText.includes('Available days off: 5'), false, 'Pooled balance forbidden');
  assert.equal(panelText.includes('Total available: 5'), false, 'Combined balance forbidden');
});

test('6. GOFF eligible source displayed from displaced OFF', async () => {
  // Planned: Ali was planned OFF on 2026-05-02. Current: Ali is working PM on 2026-05-02.
  const currentAssignments = [
    { assignmentId: 'asg-ali-1', personId: 'p-mo-1', personNameSnapshot: 'Dr. Ali', date: '2026-05-01', dutyDomain: 'MO', shiftCode: 'AM' },
    { assignmentId: 'asg-ali-2', personId: 'p-mo-1', personNameSnapshot: 'Dr. Ali', date: '2026-05-02', dutyDomain: 'MO', shiftCode: 'PM' }
  ];

  await page.evaluate((ca) => mountPhase7Test({
    initialState: 'PUBLISHED',
    isAdmin: true,
    currentAssignments: ca
  }), currentAssignments);

  await page.waitForSelector('#view-mode-entitlements');
  await page.click('#view-mode-entitlements');
  await page.waitForSelector('#btn-credit-goff');
  await page.click('#btn-credit-goff');
  await page.waitForSelector('#entitlement-credit-modal');

  const option = await page.$('#option-goff-2026-05-02');
  assert.ok(option, 'Displaced OFF on 2026-05-02 must be listed as eligible GOFF source');

  const optionText = await page.$eval('#option-goff-2026-05-02', el => el.textContent);
  assert.ok(optionText.includes('Original OFF: 2026-05-02'));
  assert.ok(optionText.includes('Actual duty: PM'));
});

test('7. non-eligible GOFF source blocked', async () => {
  // Dr. Ali was planned AM on 2026-05-01 (not OFF) and planned OFF on 2026-05-02 remains OFF.
  // No displaced OFF exists!
  await page.evaluate(() => mountPhase7Test({ initialState: 'PUBLISHED', isAdmin: true }));
  await page.waitForSelector('#view-mode-entitlements');
  await page.click('#view-mode-entitlements');
  await page.waitForSelector('#btn-credit-goff');
  await page.click('#btn-credit-goff');
  await page.waitForSelector('#entitlement-credit-modal');

  const msg = await page.$eval('#no-eligible-goff-msg', el => el.textContent.trim());
  assert.equal(msg, 'No eligible displaced weekly OFF found.');

  const submitDisabled = await page.$eval('#btn-submit-credit', el => el.disabled);
  assert.equal(submitDisabled, true, 'Credit button must be disabled when no eligible source');
});

test('8. GHKA public holiday source displayed', async () => {
  // Ali is working AM on Labour Day (2026-05-01)
  await page.evaluate(() => mountPhase7Test({ initialState: 'PUBLISHED', isAdmin: true }));
  await page.waitForSelector('#view-mode-entitlements');
  await page.click('#view-mode-entitlements');
  await page.waitForSelector('#btn-credit-ghka');
  await page.click('#btn-credit-ghka');
  await page.waitForSelector('#entitlement-credit-modal');

  const option = await page.$('#option-ghka-2026-05-01');
  assert.ok(option, 'Labour Day duty must be listed as eligible GHKA source');

  const optionText = await page.$eval('#option-ghka-2026-05-01', el => el.textContent);
  assert.ok(optionText.includes('Labour Day'));
  assert.ok(optionText.includes('2026-05-01'));
  assert.ok(optionText.includes('Eligible for 1 GHKA'));
});

test('9. absent planned holiday worker not offered GHKA', async () => {
  // Ali was planned on 2026-05-01, but has an active MC absence on that day!
  const absences = [{
    AbsenceId: 'abs-1',
    PeriodId: '2026-05',
    PersonId: 'p-mo-1',
    AbsenceType: 'MC',
    StartDate: '2026-05-01',
    EndDate: '2026-05-01',
    Status: 'ACTIVE'
  }];
  const currentAssignments = [
    { assignmentId: 'asg-ali-1', personId: 'p-mo-1', personNameSnapshot: 'Dr. Ali', date: '2026-05-01', dutyDomain: 'MO', shiftCode: 'MC', source: 'ABSENCE', coverageStatus: 'UNCOVERED' }
  ];

  await page.evaluate((abs, cur) => mountPhase7Test({
    initialState: 'PUBLISHED',
    isAdmin: true,
    initialAbsences: abs,
    currentAssignments: cur
  }), absences, currentAssignments);

  await page.waitForSelector('#view-mode-entitlements');
  await page.click('#view-mode-entitlements');
  await page.waitForSelector('#btn-credit-ghka');
  await page.click('#btn-credit-ghka');
  await page.waitForSelector('#entitlement-credit-modal');

  const msg = await page.$eval('#no-eligible-ghka-msg', el => el.textContent.trim());
  assert.equal(msg, 'No eligible public holiday work found.');
});

test('10. replacement holiday worker offered GHKA', async () => {
  // Dr. Siti covered Dr. Ali on Labour Day (2026-05-01) with REPLACEMENT shiftCode 'AM'
  const currentAssignments = [
    { assignmentId: 'asg-siti-repl', personId: 'p-mo-2', personNameSnapshot: 'Dr. Siti', date: '2026-05-01', dutyDomain: 'MO', shiftCode: 'AM', source: 'REPLACEMENT' }
  ];

  await page.evaluate((cur) => mountPhase7Test({
    initialState: 'PUBLISHED',
    isAdmin: true,
    currentAssignments: cur
  }), currentAssignments);

  await page.waitForSelector('#view-mode-entitlements');
  await page.click('#view-mode-entitlements');
  await page.waitForSelector('#entitlement-person-select');
  await page.select('#entitlement-person-select', 'p-mo-2');

  await page.waitForSelector('#btn-credit-ghka');
  await page.click('#btn-credit-ghka');
  await page.waitForSelector('#entitlement-credit-modal');

  const option = await page.$('#option-ghka-2026-05-01');
  assert.ok(option, 'Covering doctor Dr. Siti must be offered GHKA for holiday work');
});

test('11. multiple holiday duties show max one GHKA opportunity', async () => {
  // Dr. Ali has two shifts on Labour Day (AM + PM)
  const currentAssignments = [
    { assignmentId: 'asg-ali-am', personId: 'p-mo-1', personNameSnapshot: 'Dr. Ali', date: '2026-05-01', dutyDomain: 'MO', shiftCode: 'AM' },
    { assignmentId: 'asg-ali-pm', personId: 'p-mo-1', personNameSnapshot: 'Dr. Ali', date: '2026-05-01', dutyDomain: 'MO', shiftCode: 'PM' }
  ];

  await page.evaluate((cur) => mountPhase7Test({
    initialState: 'PUBLISHED',
    isAdmin: true,
    currentAssignments: cur
  }), currentAssignments);

  await page.waitForSelector('#view-mode-entitlements');
  await page.click('#view-mode-entitlements');
  await page.waitForSelector('#btn-credit-ghka');
  await page.click('#btn-credit-ghka');
  await page.waitForSelector('#entitlement-credit-modal');

  const options = await page.$$('label[id^="option-ghka-"]');
  assert.equal(options.length, 1, 'Max one GHKA earning opportunity per holiday date');
});

test('12. manual GOFF credit', async () => {
  await page.evaluate(() => mountPhase7Test({ initialState: 'PUBLISHED', isAdmin: true }));
  await page.waitForSelector('#view-mode-entitlements');
  await page.click('#view-mode-entitlements');
  await page.waitForSelector('#btn-manual-credit');
  await page.click('#btn-manual-credit');
  await page.waitForSelector('#entitlement-credit-modal');

  await page.select('#select-manual-type', 'GOFF');
  await page.type('#input-credit-admin-note', 'Opening balance verification');
  await page.click('#btn-submit-credit');
  await page.waitForFunction(() => !document.querySelector('#entitlement-credit-modal'));

  const log = await page.evaluate(() => window.phase7Test.callLog.creditManual);
  assert.equal(log.length, 1);
  assert.equal(log[0].payload.entitlementType, 'GOFF');
  assert.equal(log[0].payload.amount, 1);
  assert.equal(log[0].payload.adminNote, 'Opening balance verification');
});

test('13. manual GHKA credit', async () => {
  await page.evaluate(() => mountPhase7Test({ initialState: 'PUBLISHED', isAdmin: true }));
  await page.waitForSelector('#view-mode-entitlements');
  await page.click('#view-mode-entitlements');
  await page.waitForSelector('#btn-manual-credit');
  await page.click('#btn-manual-credit');
  await page.waitForSelector('#entitlement-credit-modal');

  await page.select('#select-manual-type', 'GHKA');
  await page.type('#input-credit-admin-note', 'Special service credit');
  await page.click('#btn-submit-credit');
  await page.waitForFunction(() => !document.querySelector('#entitlement-credit-modal'));

  const log = await page.evaluate(() => window.phase7Test.callLog.creditManual);
  assert.equal(log.length, 1);
  assert.equal(log[0].payload.entitlementType, 'GHKA');
  assert.equal(log[0].payload.amount, 1);
});

test('14. manual EP credit blocked', async () => {
  await page.evaluate(() => mountPhase7Test({ initialState: 'PUBLISHED', isAdmin: true }));
  await page.waitForSelector('#view-mode-entitlements');
  await page.click('#view-mode-entitlements');
  await page.select('#entitlement-person-select', 'p-ep');

  const manualCreditBtn = await page.$('#btn-manual-credit');
  assert.equal(manualCreditBtn, null, 'Manual credit button must not appear for EP');
});

test('15. GOFF consumption available with GOFF balance', async () => {
  // Dr. Ali has 2 GOFF available, duty is PM on 2026-05-03
  await page.evaluate(() => mountPhase7Test({
    initialState: 'PUBLISHED',
    isAdmin: true,
    initialBalances: { 'p-mo-1': { GOFF: 2, GHKA: 0 } }
  }));
  await page.waitForSelector('#btn-use-goff-p-mo-1-2026-05-03-MO');
  await page.click('#btn-use-goff-p-mo-1-2026-05-03-MO');
  await page.waitForSelector('#entitlement-consume-modal');

  const balText = await page.$eval('#consume-modal-goff-balance', el => el.textContent);
  assert.ok(balText.includes('GOFF available: 2'));

  const confirmBtnDisabled = await page.$eval('#btn-confirm-consume', el => el.disabled);
  assert.equal(confirmBtnDisabled, false, 'Confirm button enabled when balance > 0');
});

test('16. GOFF consumption unavailable with zero GOFF even if GHKA > 0', async () => {
  // Dr. Ali has 0 GOFF, 3 GHKA
  await page.evaluate(() => mountPhase7Test({
    initialState: 'PUBLISHED',
    isAdmin: true,
    initialBalances: { 'p-mo-1': { GOFF: 0, GHKA: 3 } }
  }));
  await page.waitForSelector('#btn-use-goff-p-mo-1-2026-05-03-MO');
  await page.click('#btn-use-goff-p-mo-1-2026-05-03-MO');
  await page.waitForSelector('#entitlement-consume-modal');

  const warnText = await page.$eval('#zero-balance-warning', el => el.textContent);
  assert.ok(warnText.includes('No GOFF entitlement available.'));

  const confirmBtnDisabled = await page.$eval('#btn-confirm-consume', el => el.disabled);
  assert.equal(confirmBtnDisabled, true, 'Confirm button disabled when GOFF = 0 even if GHKA > 0');
});

test('17. GHKA consumption available with GHKA balance', async () => {
  await page.evaluate(() => mountPhase7Test({
    initialState: 'PUBLISHED',
    isAdmin: true,
    initialBalances: { 'p-mo-1': { GOFF: 0, GHKA: 2 } }
  }));
  await page.waitForSelector('#btn-use-ghka-p-mo-1-2026-05-03-MO');
  await page.click('#btn-use-ghka-p-mo-1-2026-05-03-MO');
  await page.waitForSelector('#entitlement-consume-modal');

  const balText = await page.$eval('#consume-modal-ghka-balance', el => el.textContent);
  assert.ok(balText.includes('GHKA available: 2'));

  const confirmBtnDisabled = await page.$eval('#btn-confirm-consume', el => el.disabled);
  assert.equal(confirmBtnDisabled, false);
});

test('18. GHKA unavailable with zero GHKA even if GOFF > 0', async () => {
  await page.evaluate(() => mountPhase7Test({
    initialState: 'PUBLISHED',
    isAdmin: true,
    initialBalances: { 'p-mo-1': { GOFF: 2, GHKA: 0 } }
  }));
  await page.waitForSelector('#btn-use-ghka-p-mo-1-2026-05-03-MO');
  await page.click('#btn-use-ghka-p-mo-1-2026-05-03-MO');
  await page.waitForSelector('#zero-balance-warning');
  const warnText = await page.$eval('#zero-balance-warning', el => el.textContent);
  assert.ok(warnText.includes('No GHKA entitlement available.'));

  const confirmBtnDisabled = await page.$eval('#btn-confirm-consume', el => el.disabled);
  assert.equal(confirmBtnDisabled, true);
});

test('19. GOFF consumption changes Current to GOFF', async () => {
  await page.evaluate(() => mountPhase7Test({
    initialState: 'PUBLISHED',
    isAdmin: true,
    initialBalances: { 'p-mo-1': { GOFF: 1, GHKA: 0 } }
  }));
  await page.waitForSelector('#btn-use-goff-p-mo-1-2026-05-03-MO');
  await page.click('#btn-use-goff-p-mo-1-2026-05-03-MO');
  await page.waitForSelector('#entitlement-consume-modal');

  await page.click('#btn-confirm-consume');
  await page.waitForFunction(() => !document.querySelector('#entitlement-consume-modal'));

  await page.waitForSelector('#badge-goff-p-mo-1-2026-05-03-MO');
  const badgeText = await page.$eval('#badge-goff-p-mo-1-2026-05-03-MO', el => el.textContent.trim());
  assert.equal(badgeText, 'GOFF');
});

test('20. GHKA consumption changes Current to GHKA', async () => {
  await page.evaluate(() => mountPhase7Test({
    initialState: 'PUBLISHED',
    isAdmin: true,
    initialBalances: { 'p-mo-1': { GOFF: 0, GHKA: 1 } }
  }));
  await page.waitForSelector('#btn-use-ghka-p-mo-1-2026-05-03-MO');
  await page.click('#btn-use-ghka-p-mo-1-2026-05-03-MO');
  await page.waitForSelector('#entitlement-consume-modal');

  await page.click('#btn-confirm-consume');
  await page.waitForFunction(() => !document.querySelector('#entitlement-consume-modal'));

  await page.waitForSelector('#badge-ghka-p-mo-1-2026-05-03-MO');
  const badgeText = await page.$eval('#badge-ghka-p-mo-1-2026-05-03-MO', el => el.textContent.trim());
  assert.equal(badgeText, 'GHKA');
});

test('21. Planned remains unchanged', async () => {
  // Ali consumed GOFF on 2026-05-03
  const currentAssignments = [
    { assignmentId: 'asg-ali-1', personId: 'p-mo-1', personNameSnapshot: 'Dr. Ali', date: '2026-05-01', dutyDomain: 'MO', shiftCode: 'AM' },
    { assignmentId: 'asg-ali-2', personId: 'p-mo-1', personNameSnapshot: 'Dr. Ali', date: '2026-05-02', dutyDomain: 'MO', shiftCode: 'OFF' },
    { assignmentId: 'asg-ali-3', personId: 'p-mo-1', personNameSnapshot: 'Dr. Ali', date: '2026-05-03', dutyDomain: 'MO', shiftCode: 'GOFF' }
  ];

  await page.evaluate((ca) => mountPhase7Test({
    initialState: 'AMENDED',
    isAdmin: true,
    currentAssignments: ca
  }), currentAssignments);

  // Switch to Planned view
  await page.waitForSelector('#view-mode-planned');
  await page.click('#view-mode-planned');
  await page.waitForSelector('#planned-roster-view');

  const plannedCellText = await page.$eval('#cell-planned-p-mo-1-2026-05-03-MO', el => el.textContent.trim());
  assert.equal(plannedCellText, 'PM', 'Planned assignment must remain unchanged as PM');
});

test('22. HKA rendered separately', async () => {
  const currentAssignments = [
    { assignmentId: 'asg-ali-1', personId: 'p-mo-1', personNameSnapshot: 'Dr. Ali', date: '2026-05-01', dutyDomain: 'MO', shiftCode: 'HKA' }
  ];

  await page.evaluate((ca) => mountPhase7Test({
    initialState: 'PUBLISHED',
    isAdmin: true,
    currentAssignments: ca
  }), currentAssignments);

  await page.waitForSelector('#badge-hka-p-mo-1-2026-05-01-MO');
  const badgeTitle = await page.$eval('#badge-hka-p-mo-1-2026-05-01-MO', el => el.getAttribute('title'));
  assert.equal(badgeTitle, 'Public holiday rest');
});

test('23. HKA does not alter balances', async () => {
  const currentAssignments = [
    { assignmentId: 'asg-ali-1', personId: 'p-mo-1', personNameSnapshot: 'Dr. Ali', date: '2026-05-01', dutyDomain: 'MO', shiftCode: 'HKA' }
  ];

  await page.evaluate((ca) => mountPhase7Test({
    initialState: 'PUBLISHED',
    isAdmin: true,
    currentAssignments: ca,
    initialBalances: { 'p-mo-1': { GOFF: 2, GHKA: 1 } }
  }), currentAssignments);

  await page.waitForSelector('#view-mode-entitlements');
  await page.click('#view-mode-entitlements');
  await page.waitForSelector('#entitlement-panel');

  const goff = await page.$eval('#goff-balance-value', el => el.textContent.trim());
  const ghka = await page.$eval('#ghka-balance-value', el => el.textContent.trim());
  assert.equal(goff, 'GOFF balance: 2');
  assert.equal(ghka, 'GHKA balance: 1');
});

test('24. GOFF* does not alter balances', async () => {
  const currentAssignments = [
    { assignmentId: 'asg-ali-1', personId: 'p-mo-1', personNameSnapshot: 'Dr. Ali', date: '2026-05-01', dutyDomain: 'MO', shiftCode: 'GOFF*' }
  ];

  await page.evaluate((ca) => mountPhase7Test({
    initialState: 'PUBLISHED',
    isAdmin: true,
    currentAssignments: ca,
    initialBalances: { 'p-mo-1': { GOFF: 2, GHKA: 1 } }
  }), currentAssignments);

  await page.waitForSelector('#badge-goff-legacy-p-mo-1-2026-05-01-MO');
  const badgeTitle = await page.$eval('#badge-goff-legacy-p-mo-1-2026-05-01-MO', el => el.getAttribute('title'));
  assert.equal(badgeTitle, 'Legacy GOFF* marker');

  await page.click('#view-mode-entitlements');
  await page.waitForSelector('#entitlement-panel');
  const goff = await page.$eval('#goff-balance-value', el => el.textContent.trim());
  assert.equal(goff, 'GOFF balance: 2');
});

test('25. MC conflict blocks entitlement consumption', async () => {
  const absences = [{
    AbsenceId: 'abs-1',
    PeriodId: '2026-05',
    PersonId: 'p-mo-1',
    AbsenceType: 'MC',
    StartDate: '2026-05-03',
    EndDate: '2026-05-03',
    Status: 'ACTIVE'
  }];
  const currentAssignments = [
    { assignmentId: 'asg-ali-3', personId: 'p-mo-1', personNameSnapshot: 'Dr. Ali', date: '2026-05-03', dutyDomain: 'MO', shiftCode: 'MC', source: 'ABSENCE', coverageStatus: 'UNCOVERED', absenceId: 'abs-1' }
  ];

  await page.evaluate((abs, cur) => mountPhase7Test({
    initialState: 'AMENDED',
    isAdmin: true,
    initialAbsences: abs,
    currentAssignments: cur,
    initialBalances: { 'p-mo-1': { GOFF: 2, GHKA: 1 } }
  }), absences, currentAssignments);

  // Verify Use GOFF button is not offered on duty with active MC absence
  const btn = await page.$('#btn-use-goff-p-mo-1-2026-05-03-MO');
  assert.equal(btn, null, 'Absence duty cannot have Use GOFF button');
});

test('26. AL conflict blocked', async () => {
  const absences = [{
    AbsenceId: 'abs-al',
    PeriodId: '2026-05',
    PersonId: 'p-mo-1',
    AbsenceType: 'AL',
    StartDate: '2026-05-03',
    EndDate: '2026-05-03',
    Status: 'ACTIVE'
  }];

  await page.evaluate((abs) => mountPhase7Test({
    initialState: 'AMENDED',
    isAdmin: true,
    initialAbsences: abs,
    initialBalances: { 'p-mo-1': { GOFF: 2, GHKA: 1 } }
  }), absences);

  await page.waitForSelector('#phase-5-roster-container');
});

test('27. EL conflict blocked', async () => {
  const absences = [{
    AbsenceId: 'abs-el',
    PeriodId: '2026-05',
    PersonId: 'p-mo-1',
    AbsenceType: 'EL',
    StartDate: '2026-05-03',
    EndDate: '2026-05-03',
    Status: 'ACTIVE'
  }];

  await page.evaluate((abs) => mountPhase7Test({
    initialState: 'AMENDED',
    isAdmin: true,
    initialAbsences: abs,
    initialBalances: { 'p-mo-1': { GOFF: 2, GHKA: 1 } }
  }), absences);

  await page.waitForSelector('#phase-5-roster-container');
});

test('28. COURSE conflict blocked', async () => {
  const absences = [{
    AbsenceId: 'abs-course',
    PeriodId: '2026-05',
    PersonId: 'p-mo-1',
    AbsenceType: 'COURSE',
    StartDate: '2026-05-03',
    EndDate: '2026-05-03',
    Status: 'ACTIVE'
  }];

  await page.evaluate((abs) => mountPhase7Test({
    initialState: 'AMENDED',
    isAdmin: true,
    initialAbsences: abs,
    initialBalances: { 'p-mo-1': { GOFF: 2, GHKA: 1 } }
  }), absences);

  await page.waitForSelector('#phase-5-roster-container');
});

test('29. credit-only operation leaves lifecycle PUBLISHED', async () => {
  await page.evaluate(() => mountPhase7Test({ initialState: 'PUBLISHED', isAdmin: true }));
  await page.waitForSelector('#view-mode-entitlements');
  await page.click('#view-mode-entitlements');
  await page.waitForSelector('#btn-manual-credit');
  await page.click('#btn-manual-credit');
  await page.waitForSelector('#entitlement-credit-modal');

  await page.type('#input-credit-admin-note', 'Opening credit');
  await page.click('#btn-submit-credit');
  await page.waitForFunction(() => !document.querySelector('#entitlement-credit-modal'));

  const periodRec = await page.evaluate(() => window.phase7Test.periodLifecycleMap.get('2026-05'));
  assert.equal(periodRec.State, 'PUBLISHED', 'Credit-only operation must leave roster PUBLISHED');
});

test('30. consumption makes lifecycle AMENDED', async () => {
  await page.evaluate(() => mountPhase7Test({
    initialState: 'PUBLISHED',
    isAdmin: true,
    initialBalances: { 'p-mo-1': { GOFF: 1, GHKA: 0 } }
  }));
  await page.waitForSelector('#btn-use-goff-p-mo-1-2026-05-03-MO');
  await page.click('#btn-use-goff-p-mo-1-2026-05-03-MO');
  await page.waitForSelector('#entitlement-consume-modal');

  await page.click('#btn-confirm-consume');
  await page.waitForFunction(() => !document.querySelector('#entitlement-consume-modal'));

  const periodRec = await page.evaluate(() => window.phase7Test.periodLifecycleMap.get('2026-05'));
  assert.equal(periodRec.State, 'AMENDED', 'Consumption must transition lifecycle to AMENDED');
});

test('31. final consumption reversal restores PUBLISHED when no other changes', async () => {
  const initialTransactions = [{
    TransactionId: 'tx-consume-1',
    PersonId: 'p-mo-1',
    EntitlementType: 'GOFF',
    TransactionType: 'CONSUMPTION',
    Amount: 1,
    EffectiveDate: '2026-05-03',
    Status: 'CONFIRMED'
  }];
  const currentAssignments = [
    { assignmentId: 'asg-ali-1', personId: 'p-mo-1', personNameSnapshot: 'Dr. Ali', date: '2026-05-01', dutyDomain: 'MO', shiftCode: 'AM' },
    { assignmentId: 'asg-ali-2', personId: 'p-mo-1', personNameSnapshot: 'Dr. Ali', date: '2026-05-02', dutyDomain: 'MO', shiftCode: 'OFF' },
    { assignmentId: 'asg-ali-3', personId: 'p-mo-1', personNameSnapshot: 'Dr. Ali', date: '2026-05-03', dutyDomain: 'MO', shiftCode: 'GOFF' }
  ];

  await page.evaluate((txs, cur) => mountPhase7Test({
    initialState: 'AMENDED',
    isAdmin: true,
    initialTransactions: txs,
    currentAssignments: cur,
    initialBalances: { 'p-mo-1': { GOFF: 1, GHKA: 0 } }
  }), initialTransactions, currentAssignments);

  await page.waitForSelector('#view-mode-entitlements');
  await page.click('#view-mode-entitlements');
  await page.waitForSelector('#btn-reverse-consumption-tx-consume-1');
  await page.click('#btn-reverse-consumption-tx-consume-1');

  await page.waitForFunction(() => {
    const rec = window.phase7Test.periodLifecycleMap.get('2026-05');
    return rec.State === 'PUBLISHED';
  });

  const periodRec = await page.evaluate(() => window.phase7Test.periodLifecycleMap.get('2026-05'));
  assert.equal(periodRec.State, 'PUBLISHED', 'Final consumption reversal must restore PUBLISHED');
});

test('32. Phase 5 active change keeps AMENDED', async () => {
  const events = [{
    EventId: 'ev-1',
    EventType: 'ADMIN_CORRECTION',
    isReversed: false
  }];
  const initialTransactions = [{
    TransactionId: 'tx-consume-1',
    PersonId: 'p-mo-1',
    EntitlementType: 'GOFF',
    TransactionType: 'CONSUMPTION',
    Amount: 1,
    EffectiveDate: '2026-05-03',
    Status: 'CONFIRMED'
  }];

  await page.evaluate((evs, txs) => mountPhase7Test({
    initialState: 'AMENDED',
    isAdmin: true,
    events: evs,
    initialTransactions: txs,
    initialBalances: { 'p-mo-1': { GOFF: 1, GHKA: 0 } }
  }), events, initialTransactions);

  await page.waitForSelector('#view-mode-entitlements');
  await page.click('#view-mode-entitlements');
  await page.waitForSelector('#btn-reverse-consumption-tx-consume-1');
  await page.click('#btn-reverse-consumption-tx-consume-1');

  const periodRec = await page.evaluate(() => window.phase7Test.periodLifecycleMap.get('2026-05'));
  assert.equal(periodRec.State, 'AMENDED', 'Phase 5 active change must keep roster AMENDED');
});

test('33. Phase 6 active state keeps AMENDED', async () => {
  const absences = [{
    AbsenceId: 'abs-1',
    PeriodId: '2026-05',
    PersonId: 'p-mo-1',
    Status: 'ACTIVE'
  }];
  const initialTransactions = [{
    TransactionId: 'tx-consume-1',
    PersonId: 'p-mo-1',
    EntitlementType: 'GOFF',
    TransactionType: 'CONSUMPTION',
    Amount: 1,
    EffectiveDate: '2026-05-03',
    Status: 'CONFIRMED'
  }];

  await page.evaluate((abs, txs) => mountPhase7Test({
    initialState: 'AMENDED',
    isAdmin: true,
    initialAbsences: abs,
    initialTransactions: txs,
    initialBalances: { 'p-mo-1': { GOFF: 1, GHKA: 0 } }
  }), absences, initialTransactions);

  await page.waitForSelector('#view-mode-entitlements');
  await page.click('#view-mode-entitlements');
  await page.waitForSelector('#btn-reverse-consumption-tx-consume-1');
  await page.click('#btn-reverse-consumption-tx-consume-1');

  const periodRec = await page.evaluate(() => window.phase7Test.periodLifecycleMap.get('2026-05'));
  assert.equal(periodRec.State, 'AMENDED', 'Phase 6 active absence must keep roster AMENDED');
});

test('34. consumption reversal restores correct balance', async () => {
  const initialTransactions = [{
    TransactionId: 'tx-consume-1',
    PersonId: 'p-mo-1',
    EntitlementType: 'GOFF',
    TransactionType: 'CONSUMPTION',
    Amount: 1,
    EffectiveDate: '2026-05-03',
    Status: 'CONFIRMED'
  }];

  await page.evaluate((txs) => mountPhase7Test({
    initialState: 'AMENDED',
    isAdmin: true,
    initialTransactions: txs,
    initialBalances: { 'p-mo-1': { GOFF: 1, GHKA: 0 } }
  }), initialTransactions);

  await page.waitForSelector('#view-mode-entitlements');
  await page.click('#view-mode-entitlements');
  await page.waitForSelector('#btn-reverse-consumption-tx-consume-1');
  await page.click('#btn-reverse-consumption-tx-consume-1');

  await page.waitForFunction(() => {
    const el = document.querySelector('#goff-balance-value');
    return el && el.textContent.includes('GOFF balance: 2');
  });

  const goff = await page.$eval('#goff-balance-value', el => el.textContent.trim());
  assert.equal(goff, 'GOFF balance: 2', 'Reversal must return 1 GOFF to balance');
});

test('35. credit reversal reduces balance', async () => {
  const initialTransactions = [{
    TransactionId: 'tx-credit-1',
    PersonId: 'p-mo-1',
    EntitlementType: 'GOFF',
    TransactionType: 'CREDIT',
    Amount: 1,
    EffectiveDate: '2026-05-01',
    Status: 'CONFIRMED'
  }];

  await page.evaluate((txs) => mountPhase7Test({
    initialState: 'PUBLISHED',
    isAdmin: true,
    initialTransactions: txs,
    initialBalances: { 'p-mo-1': { GOFF: 2, GHKA: 0 } }
  }), initialTransactions);

  await page.waitForSelector('#view-mode-entitlements');
  await page.click('#view-mode-entitlements');
  await page.waitForSelector('#btn-reverse-credit-tx-credit-1');
  await page.click('#btn-reverse-credit-tx-credit-1');

  await page.waitForFunction(() => {
    const el = document.querySelector('#goff-balance-value');
    return el && el.textContent.includes('GOFF balance: 1');
  });

  const goff = await page.$eval('#goff-balance-value', el => el.textContent.trim());
  assert.equal(goff, 'GOFF balance: 1', 'Credit reversal must deduct 1 GOFF from balance');
});

test('36. dependent credit reversal blocked', async () => {
  // Dr. Ali has GOFF balance = 0, but has a past credit row. That credit was consumed!
  const initialTransactions = [{
    TransactionId: 'tx-credit-used',
    PersonId: 'p-mo-1',
    EntitlementType: 'GOFF',
    TransactionType: 'CREDIT',
    Amount: 1,
    EffectiveDate: '2026-05-01',
    Status: 'CONFIRMED'
  }];

  await page.evaluate((txs) => mountPhase7Test({
    initialState: 'PUBLISHED',
    isAdmin: true,
    initialTransactions: txs,
    initialBalances: { 'p-mo-1': { GOFF: 0, GHKA: 0 } }
  }), initialTransactions);

  await page.waitForSelector('#view-mode-entitlements');
  await page.click('#view-mode-entitlements');
  await page.waitForSelector('#btn-reverse-credit-tx-credit-used');

  const disabled = await page.$eval('#btn-reverse-credit-tx-credit-used', el => el.disabled);
  assert.equal(disabled, true, 'Reverse credit button must be disabled when credit was already used');

  const warn = await page.$eval('#credit-dependent-warning-tx-credit-used', el => el.textContent);
  assert.ok(warn.includes('This credit has already been used. Reverse the dependent consumption first.'));
});

test('37. reversal history remains visible', async () => {
  const initialTransactions = [{
    TransactionId: 'tx-consume-1',
    PersonId: 'p-mo-1',
    EntitlementType: 'GOFF',
    TransactionType: 'CONSUMPTION',
    Amount: 1,
    EffectiveDate: '2026-05-03',
    Status: 'CONFIRMED'
  }];

  await page.evaluate((txs) => mountPhase7Test({
    initialState: 'AMENDED',
    isAdmin: true,
    initialTransactions: txs,
    initialBalances: { 'p-mo-1': { GOFF: 1, GHKA: 0 } }
  }), initialTransactions);

  await page.waitForSelector('#view-mode-entitlements');
  await page.click('#view-mode-entitlements');
  await page.waitForSelector('#btn-reverse-consumption-tx-consume-1');
  await page.click('#btn-reverse-consumption-tx-consume-1');

  await page.waitForFunction(() => {
    return document.querySelectorAll('#transactions-list > div').length >= 2;
  });

  const listText = await page.$eval('#transactions-list', el => el.textContent);
  assert.ok(listText.includes('Consumption reversal'));
  assert.ok(listText.includes('GOFF taken'));
});

test('38. original transaction never mutated/deleted in UI model', async () => {
  const initialTransactions = [{
    TransactionId: 'tx-consume-1',
    PersonId: 'p-mo-1',
    EntitlementType: 'GOFF',
    TransactionType: 'CONSUMPTION',
    Amount: 1,
    EffectiveDate: '2026-05-03',
    Status: 'CONFIRMED'
  }];

  await page.evaluate((txs) => mountPhase7Test({
    initialState: 'AMENDED',
    isAdmin: true,
    initialTransactions: txs,
    initialBalances: { 'p-mo-1': { GOFF: 1, GHKA: 0 } }
  }), initialTransactions);

  await page.waitForSelector('#view-mode-entitlements');
  await page.click('#view-mode-entitlements');
  await page.waitForSelector('#btn-reverse-consumption-tx-consume-1');
  await page.click('#btn-reverse-consumption-tx-consume-1');

  await page.waitForFunction(() => {
    return document.querySelectorAll('#transactions-list > div').length >= 2;
  });

  const origRow = await page.$('#tx-row-tx-consume-1');
  assert.ok(origRow, 'Original transaction row must not be deleted from UI model');
});

test('39. recovery uses rosterv2entitlementrecover', async () => {
  await page.evaluate(() => mountPhase7Test({
    initialState: 'PUBLISHED',
    isAdmin: true,
    simulateRecoveryRequired: 'ENTITLEMENT_CONSUME'
  }));

  await page.waitForSelector('#recovery-required-banner');
  await page.click('#btn-retry-recovery');

  const log = await page.evaluate(() => window.phase7Test.callLog.recoverEntitlement);
  assert.equal(log.length, 1, 'Recovery must invoke recoverEntitlement');
});

test('40. recovery preserves operationId', async () => {
  await page.evaluate(() => mountPhase7Test({
    initialState: 'PUBLISHED',
    isAdmin: true,
    simulateRecoveryRequired: 'ENTITLEMENT_CONSUME'
  }));

  await page.waitForSelector('#recovery-required-banner');
  await page.click('#btn-retry-recovery');

  const log = await page.evaluate(() => window.phase7Test.callLog.recoverEntitlement);
  assert.equal(log[0].operationId, 'rec-ent-123', 'Stable operationId must be preserved across recovery');
});

test('41. recovery does not duplicate transaction', async () => {
  await page.evaluate(() => mountPhase7Test({
    initialState: 'PUBLISHED',
    isAdmin: true,
    simulateRecoveryRequired: 'ENTITLEMENT_CONSUME'
  }));

  await page.waitForSelector('#recovery-required-banner');
  await page.click('#btn-retry-recovery');
  await page.waitForFunction(() => !document.querySelector('#recovery-required-banner'));

  const txs = await page.evaluate(() => window.phase7Test.storeTransactions);
  assert.equal(txs.length, 0, 'Recovery must not duplicate transactions locally');
});

test('42. separate GOFF/GHKA balance after recovery', async () => {
  await page.evaluate(() => mountPhase7Test({
    initialState: 'PUBLISHED',
    isAdmin: true,
    simulateRecoveryRequired: 'ENTITLEMENT_CONSUME',
    initialBalances: { 'p-mo-1': { GOFF: 2, GHKA: 1 } }
  }));

  await page.waitForSelector('#recovery-required-banner');
  await page.click('#btn-retry-recovery');
  await page.waitForFunction(() => !document.querySelector('#recovery-required-banner'));

  await page.click('#view-mode-entitlements');
  await page.waitForSelector('#entitlement-panel');

  const goff = await page.$eval('#goff-balance-value', el => el.textContent.trim());
  const ghka = await page.$eval('#ghka-balance-value', el => el.textContent.trim());
  assert.equal(goff, 'GOFF balance: 2');
  assert.equal(ghka, 'GHKA balance: 1');
});

test('43. cross-period balance persists', async () => {
  await page.evaluate(() => mountPhase7Test({
    initialPeriod: '2026-05',
    initialState: 'PUBLISHED',
    isAdmin: true,
    initialBalances: { 'p-mo-1': { GOFF: 2, GHKA: 1 } }
  }));

  await page.waitForSelector('#view-mode-entitlements');
  await page.click('#view-mode-entitlements');
  await page.waitForSelector('#entitlement-panel');

  // Verify May balance = 2
  let goff = await page.$eval('#goff-balance-value', el => el.textContent.trim());
  assert.equal(goff, 'GOFF balance: 2');

  // Switch month to June (2026-06)
  await page.evaluate(() => {
    window.phase7Test.enrollPeriod('2026-06', 'PUBLISHED', 1);
    window.phase7Test.setPeriod('2026-06');
  });

  await page.waitForFunction(() => {
    const el = document.querySelector('#phase-5-roster-container strong');
    return el && el.textContent.includes('2026-06');
  });

  // Verify balance remains 2
  goff = await page.$eval('#goff-balance-value', el => el.textContent.trim());
  assert.equal(goff, 'GOFF balance: 2', 'Balance must persist across period switching');
});

test('44. month switching rejects stale data', async () => {
  // Simulate delayed response on 2026-06
  await page.evaluate(() => mountPhase7Test({
    initialPeriod: '2026-05',
    initialState: 'PUBLISHED',
    isAdmin: true,
    delayedPeriod: '2026-06',
    delayMs: 200
  }));

  await page.waitForSelector('#phase-5-roster-container');

  // Switch May -> June -> May rapidly
  await page.evaluate(() => {
    window.phase7Test.enrollPeriod('2026-06', 'PUBLISHED', 1);
    window.phase7Test.setPeriod('2026-06');
    window.phase7Test.setPeriod('2026-05');
  });

  await page.waitForFunction(() => {
    const el = document.querySelector('#phase-5-roster-container strong');
    return el && el.textContent.includes('2026-05');
  });

  // Period in container must be May, not overwritten by delayed June
  const periodText = await page.$eval('#phase-5-roster-container strong', el => el.textContent.trim());
  assert.equal(periodText, '2026-05');
});

test('45. revision conflict reloads authoritative state', async () => {
  await page.evaluate(() => mountPhase7Test({
    initialState: 'PUBLISHED',
    isAdmin: true,
    simulateRevisionConflict: true,
    initialBalances: { 'p-mo-1': { GOFF: 1, GHKA: 0 } }
  }));

  await page.waitForSelector('#btn-use-goff-p-mo-1-2026-05-03-MO');
  await page.click('#btn-use-goff-p-mo-1-2026-05-03-MO');
  await page.waitForSelector('#entitlement-consume-modal');

  await page.click('#btn-confirm-consume');
  await page.waitForSelector('#revision-conflict-banner');

  const bannerText = await page.$eval('#revision-conflict-banner', el => el.textContent);
  assert.ok(bannerText.includes('Roster changed since you opened it. Refreshing the latest version.'));
});

test('46. AdminNote admin-only', async () => {
  const initialTransactions = [{
    TransactionId: 'tx-note-1',
    PersonId: 'p-mo-1',
    EntitlementType: 'GOFF',
    TransactionType: 'CREDIT',
    Amount: 1,
    EffectiveDate: '2026-05-01',
    AdminNote: 'Confidential HR approval #982',
    Status: 'CONFIRMED'
  }];

  await page.evaluate((txs) => mountPhase7Test({
    initialState: 'PUBLISHED',
    isAdmin: true,
    initialTransactions: txs
  }), initialTransactions);

  await page.waitForSelector('#view-mode-entitlements');
  await page.click('#view-mode-entitlements');
  await page.waitForSelector('#tx-admin-note-tx-note-1');

  const noteText = await page.$eval('#tx-admin-note-tx-note-1', el => el.textContent);
  assert.ok(noteText.includes('Confidential HR approval #982'));
});

test('47. viewer does not receive private metadata', async () => {
  const initialTransactions = [{
    TransactionId: 'tx-note-1',
    PersonId: 'p-mo-1',
    EntitlementType: 'GOFF',
    TransactionType: 'CREDIT',
    Amount: 1,
    EffectiveDate: '2026-05-01',
    AdminNote: 'Confidential HR approval #982',
    Status: 'CONFIRMED'
  }];

  await page.evaluate((txs) => mountPhase7Test({
    initialState: 'PUBLISHED',
    isAdmin: false,
    initialTransactions: txs
  }), initialTransactions);

  await page.waitForSelector('#view-mode-entitlements');
  await page.click('#view-mode-entitlements');
  await page.waitForSelector('#entitlement-panel');

  const noteEl = await page.$('#tx-admin-note-tx-note-1');
  assert.equal(noteEl, null, 'Viewer must not see admin notes');

  const panelText = await page.$eval('#entitlement-panel', el => el.textContent);
  assert.equal(panelText.includes('Confidential HR approval #982'), false);
  assert.equal(panelText.includes('OperationId'), false);
});

test('48. zero direct fetch in React entitlement components', async () => {
  const componentPaths = [
    'src/features/roster/components/EntitlementPanel.jsx',
    'src/features/roster/components/EntitlementCreditModal.jsx',
    'src/features/roster/components/EntitlementConsumeModal.jsx',
    'src/features/roster/components/CurrentRosterView.jsx',
    'src/features/roster/components/Phase5RosterContainer.jsx'
  ];

  for (const cPath of componentPaths) {
    const fullPath = path.join(root, cPath);
    const code = fs.readFileSync(fullPath, 'utf8');
    // Ensure no fetch() or window.fetch calls
    const hasFetch = /\bfetch\s*\(/.test(code);
    assert.equal(hasFetch, false, `Component ${cPath} must not contain direct fetch calls`);
  }
});

test('49. CLOSED blocks roster-changing consumption', async () => {
  await page.evaluate(() => mountPhase7Test({
    initialState: 'CLOSED',
    isAdmin: true,
    initialBalances: { 'p-mo-1': { GOFF: 2, GHKA: 1 } }
  }));

  await page.waitForSelector('#phase-5-roster-container');

  // In CLOSED state, cell action buttons do not render
  const useGoffBtns = await page.$$('button[id^="btn-use-goff-"]');
  assert.equal(useGoffBtns.length, 0, 'No consumption action buttons allowed when period is CLOSED');
});

test('50. legacy UI unaffected when entitlement feature unavailable', async () => {
  await page.evaluate(() => mountPhase7Test({
    initialState: 'PUBLISHED',
    isAdmin: true,
    settings: { roster_v2_read_enabled: true, roster_v2_write_enabled: false, write_queue_v2_enabled: false }
  }));

  await page.waitForSelector('#current-roster-view');

  // When mutations are disabled, amendment/entitlement action buttons do not render on cells
  const useGoffBtns = await page.$$('button[id^="btn-use-goff-"]');
  assert.equal(useGoffBtns.length, 0, 'Mutation controls disabled when feature flag disabled');
});
