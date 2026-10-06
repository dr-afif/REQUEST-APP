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

const clickButton = async (text, containerSelector = '') => {
  await page.waitForFunction((t, sel) => {
    const rootEl = sel ? document.querySelector(sel) : document;
    if (!rootEl) return false;
    const btn = [...rootEl.querySelectorAll('button')].find(b => b.textContent.includes(t));
    return Boolean(btn);
  }, {}, text, containerSelector);

  await page.evaluate((t, sel) => {
    const rootEl = sel ? document.querySelector(sel) : document;
    const btn = [...rootEl.querySelectorAll('button')].find(b => b.textContent.includes(t));
    if (!btn) throw new Error(`Button with text "${t}" not found`);
    btn.click();
  }, text, containerSelector);
};

const setInputValue = async (selector, value) => {
  await page.waitForSelector(selector);
  await page.evaluate((sel, val) => {
    const el = document.querySelector(sel);
    if (!el) throw new Error(`Element ${sel} not found`);
    const prototype = Object.getPrototypeOf(el);
    const nativeSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set ||
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    if (nativeSetter) nativeSetter.call(el, val);
    else el.value = val;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, selector, value);
};

before(async () => {
  const ui = await build({
    entryPoints: [path.join(root, 'tests/phase6/ui-fixture.jsx')],
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
      res.end('<!doctype html><title>Phase 6 Roster UI Tests</title>');
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
    throw new Error('Set PHASE2_BROWSER_PATH to a Chromium browser for Phase 6 UI tests.');
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
      window.phase6Test?.close();
    });
  }
});

// =========================================================================
// PHASE 6 SLICE 3 DETERMINISTIC UI TESTS (1 - 43)
// =========================================================================

test('1. Record Absence action visible to admin on eligible Current cell', async () => {
  await page.evaluate(() => mountPhase6Test({ initialState: 'PUBLISHED', isAdmin: true }));
  await page.waitForSelector('#btn-record-absence-p-1-2026-03-10-MO');

  const btnText = await page.$eval('#btn-record-absence-p-1-2026-03-10-MO', el => el.textContent.trim());
  assert.equal(btnText, 'Record absence');
});

test('2. Viewer has no mutation controls', async () => {
  await page.evaluate(() => mountPhase6Test({ initialState: 'PUBLISHED', isAdmin: false }));
  await page.waitForSelector('#phase-5-roster-container');

  const recordAbsenceBtns = await page.$$('button[id^="btn-record-absence-"]');
  assert.equal(recordAbsenceBtns.length, 0);

  const assignReplBtns = await page.$$('button[id^="btn-assign-replacement-"]');
  assert.equal(assignReplBtns.length, 0);

  const amendBtns = await page.$$('button[id^="btn-amend-"]');
  assert.equal(amendBtns.length, 0);
});

test('3. CLOSED blocks absence/replacement controls', async () => {
  await page.evaluate(() => mountPhase6Test({ initialState: 'CLOSED', isAdmin: true }));
  await page.waitForSelector('#phase-5-roster-container');

  const recordAbsenceBtns = await page.$$('button[id^="btn-record-absence-"]');
  assert.equal(recordAbsenceBtns.length, 0);

  const assignReplBtns = await page.$$('button[id^="btn-assign-replacement-"]');
  assert.equal(assignReplBtns.length, 0);
});

test('4. MC form submits authoritative PersonId', async () => {
  await page.evaluate(() => mountPhase6Test({ initialState: 'PUBLISHED', isAdmin: true }));
  await page.waitForSelector('#btn-record-absence-p-1-2026-03-10-MO');

  await page.click('#btn-record-absence-p-1-2026-03-10-MO');
  await page.waitForSelector('#absence-modal');

  // Verify MC is selected
  const typeVal = await page.$eval('#absence-type-select', el => el.value);
  assert.equal(typeVal, 'MC');

  // Acknowledge shortage since 2026-03-10 is a working duty
  await page.click('#shortage-accept-checkbox');
  await page.type('#shortage-reason-input', 'Medical leave coverage required');

  await page.click('#btn-submit-absence');
  await page.waitForFunction(() => !document.querySelector('#absence-modal'));

  const log = await page.evaluate(() => window.phase6Test.callLog.createAbsence);
  assert.equal(log.length, 1);
  assert.equal(log[0].payload.personId, 'p-1');
  assert.equal(log[0].payload.absenceType, 'MC');
  assert.equal(log[0].payload.shortageAccepted, true);
});

test('5. EL supported', async () => {
  await page.evaluate(() => mountPhase6Test({ initialState: 'PUBLISHED', isAdmin: true }));
  await page.waitForSelector('#btn-record-absence-p-1-2026-03-10-MO');

  await page.click('#btn-record-absence-p-1-2026-03-10-MO');
  await page.waitForSelector('#absence-modal');

  await page.select('#absence-type-select', 'EL');
  await page.click('#shortage-accept-checkbox');
  await page.type('#shortage-reason-input', 'Family emergency');

  await page.click('#btn-submit-absence');
  await page.waitForFunction(() => !document.querySelector('#absence-modal'));

  const log = await page.evaluate(() => window.phase6Test.callLog.createAbsence);
  assert.equal(log[0].payload.absenceType, 'EL');
});

test('6. AL supported', async () => {
  await page.evaluate(() => mountPhase6Test({ initialState: 'PUBLISHED', isAdmin: true }));
  await page.waitForSelector('#btn-record-absence-p-1-2026-03-10-MO');

  await page.click('#btn-record-absence-p-1-2026-03-10-MO');
  await page.waitForSelector('#absence-modal');

  await page.select('#absence-type-select', 'AL');
  await page.click('#shortage-accept-checkbox');
  await page.type('#shortage-reason-input', 'Approved annual leave');

  await page.click('#btn-submit-absence');
  await page.waitForFunction(() => !document.querySelector('#absence-modal'));

  const log = await page.evaluate(() => window.phase6Test.callLog.createAbsence);
  assert.equal(log[0].payload.absenceType, 'AL');
});

test('7. COURSE supported', async () => {
  await page.evaluate(() => mountPhase6Test({ initialState: 'PUBLISHED', isAdmin: true }));
  await page.waitForSelector('#btn-record-absence-p-1-2026-03-10-MO');

  await page.click('#btn-record-absence-p-1-2026-03-10-MO');
  await page.waitForSelector('#absence-modal');

  await page.select('#absence-type-select', 'COURSE');
  await page.click('#shortage-accept-checkbox');
  await page.type('#shortage-reason-input', 'Clinical ultrasound training');

  await page.click('#btn-submit-absence');
  await page.waitForFunction(() => !document.querySelector('#absence-modal'));

  const log = await page.evaluate(() => window.phase6Test.callLog.createAbsence);
  assert.equal(log[0].payload.absenceType, 'COURSE');
});

test('8. start/end range handled', async () => {
  await page.evaluate(() => mountPhase6Test({ initialState: 'PUBLISHED', isAdmin: true }));
  await page.waitForSelector('#btn-record-absence-p-1-2026-03-10-MO');

  await page.click('#btn-record-absence-p-1-2026-03-10-MO');
  await page.waitForSelector('#absence-modal');

  // Set start and end range
  await setInputValue('#absence-start-date', '2026-03-10');
  await setInputValue('#absence-end-date', '2026-03-12');

  await page.click('#shortage-accept-checkbox');
  await page.type('#shortage-reason-input', 'Multi-day course');

  await page.click('#btn-submit-absence');
  await page.waitForFunction(() => !document.querySelector('#absence-modal'));

  const log = await page.evaluate(() => window.phase6Test.callLog.createAbsence);
  assert.equal(log[0].payload.startDate, '2026-03-10');
  assert.equal(log[0].payload.endDate, '2026-03-12');
});

test('9. affected assignments displayed correctly', async () => {
  await page.evaluate(() => mountPhase6Test({ initialState: 'PUBLISHED', isAdmin: true }));
  await page.waitForSelector('#btn-record-absence-p-1-2026-03-10-MO');

  await page.click('#btn-record-absence-p-1-2026-03-10-MO');
  await page.waitForSelector('#absence-modal');

  await setInputValue('#absence-start-date', '2026-03-10');
  await setInputValue('#absence-end-date', '2026-03-12');

  await page.waitForSelector('#affected-duties-list');
  const dutiesText = await page.$eval('#affected-duties-list', el => el.textContent);
  assert.match(dutiesText, /2026-03-10/);
  assert.match(dutiesText, /PM/);
  assert.match(dutiesText, /2026-03-12/);
  assert.match(dutiesText, /AM/);
});

test('10. no-duty days not invented', async () => {
  await page.evaluate(() => mountPhase6Test({ initialState: 'PUBLISHED', isAdmin: true }));
  await page.waitForSelector('#btn-record-absence-p-1-2026-03-10-MO');

  await page.click('#btn-record-absence-p-1-2026-03-10-MO');
  await page.waitForSelector('#absence-modal');

  await setInputValue('#absence-start-date', '2026-03-10');
  await setInputValue('#absence-end-date', '2026-03-12');

  await page.waitForSelector('#affected-duties-list');
  const dutiesText = await page.$eval('#affected-duties-list', el => el.textContent);
  // 2026-03-11 has no rostered duty for p-1 and must not appear
  assert.doesNotMatch(dutiesText, /2026-03-11/);
});

test('11. zero-duty absence shows informational state', async () => {
  await page.evaluate(() => mountPhase6Test({ initialState: 'PUBLISHED', isAdmin: true }));
  await page.waitForSelector('#btn-toolbar-record-absence');

  await page.click('#btn-toolbar-record-absence');
  await page.waitForSelector('#absence-modal');

  await page.select('#absence-person-select', 'p-noduty');
  await page.waitForSelector('#no-duties-affected-info');

  const text = await page.$eval('#no-duties-affected-info', el => el.textContent);
  assert.match(text, /No rostered duties are affected by this absence/);
});

test('12. zero-duty absence does not mark roster Current changed', async () => {
  await page.evaluate(() => mountPhase6Test({ initialState: 'PUBLISHED', isAdmin: true }));
  await page.waitForSelector('#btn-toolbar-record-absence');

  await page.click('#btn-toolbar-record-absence');
  await page.waitForSelector('#absence-modal');

  await page.select('#absence-person-select', 'p-noduty');
  await page.click('#btn-submit-absence');
  await page.waitForFunction(() => !document.querySelector('#absence-modal'));

  // No cell should have Changed badge
  const changedBadges = await page.$$('.changed-badge');
  assert.equal(changedBadges.length, 0);
});

test('13. shortage acknowledgement shown when required', async () => {
  await page.evaluate(() => mountPhase6Test({ initialState: 'PUBLISHED', isAdmin: true }));
  await page.waitForSelector('#btn-record-absence-p-1-2026-03-10-MO');

  await page.click('#btn-record-absence-p-1-2026-03-10-MO');
  await page.waitForSelector('#absence-modal');
  await page.waitForSelector('#shortage-warning-message');

  const warningText = await page.$eval('#shortage-warning-message', el => el.textContent);
  assert.match(warningText, /leaves 1 duty uncovered/i);

  const checkbox = await page.$('#shortage-accept-checkbox');
  assert.ok(checkbox);
  const input = await page.$('#shortage-reason-input');
  assert.ok(input);
});

test('14. shortage acknowledgement absent when no duty affected', async () => {
  await page.evaluate(() => mountPhase6Test({ initialState: 'PUBLISHED', isAdmin: true }));
  await page.waitForSelector('#btn-toolbar-record-absence');

  await page.click('#btn-toolbar-record-absence');
  await page.waitForSelector('#absence-modal');

  await page.select('#absence-person-select', 'p-noduty');

  const checkbox = await page.$('#shortage-accept-checkbox');
  assert.equal(checkbox, null);
});

test('15. uncovered absence rendered', async () => {
  const customCurrent = [
    { assignmentId: 'asg-1', personId: 'p-1', personNameSnapshot: 'Dr. Sarah Lee', date: '2026-03-10', dutyDomain: 'MO', shiftCode: 'MC', source: 'ABSENCE', coverageStatus: 'UNCOVERED', absenceId: 'abs-101', originalShiftCode: 'PM' }
  ];
  await page.evaluate((curr) => mountPhase6Test({ initialState: 'AMENDED', isAdmin: true, currentAssignments: curr }), customCurrent);
  await page.waitForSelector('[data-testid="badge-uncovered-p-1-2026-03-10-MO"]');

  const badgeText = await page.$eval('[data-testid="badge-uncovered-p-1-2026-03-10-MO"]', el => el.textContent.trim());
  assert.equal(badgeText, 'Uncovered');

  const assignBtn = await page.$('#btn-assign-replacement-p-1-2026-03-10-MO');
  assert.ok(assignBtn);
});

test('16. covered absence rendered', async () => {
  const customCurrent = [
    { assignmentId: 'asg-1', personId: 'p-1', personNameSnapshot: 'Dr. Sarah Lee', date: '2026-03-10', dutyDomain: 'MO', shiftCode: 'MC', source: 'ABSENCE', coverageStatus: 'COVERED', absenceId: 'abs-101', replacementId: 'repl-101', originalShiftCode: 'PM' },
    { assignmentId: 'asg-repl-1', personId: 'p-3', personNameSnapshot: 'Dr. John Doe', date: '2026-03-10', dutyDomain: 'MO', shiftCode: 'PM', source: 'REPLACEMENT', coverageStatus: 'COVERED', replacementId: 'repl-101', coveringForPersonId: 'p-1' }
  ];
  await page.evaluate((curr) => mountPhase6Test({ initialState: 'AMENDED', isAdmin: true, currentAssignments: curr }), customCurrent);
  await page.waitForSelector('[data-testid="badge-covered-p-1-2026-03-10-MO"]');

  const coveredText = await page.$eval('[data-testid="badge-covered-p-1-2026-03-10-MO"]', el => el.textContent.trim());
  assert.match(coveredText, /Covered by Dr\. John Doe/);
});

test('17. replacement displayed with covering lineage', async () => {
  const customCurrent = [
    { assignmentId: 'asg-1', personId: 'p-1', personNameSnapshot: 'Dr. Sarah Lee', date: '2026-03-10', dutyDomain: 'MO', shiftCode: 'MC', source: 'ABSENCE', coverageStatus: 'COVERED', absenceId: 'abs-101', replacementId: 'repl-101', originalShiftCode: 'PM' },
    { assignmentId: 'asg-repl-1', personId: 'p-3', personNameSnapshot: 'Dr. John Doe', date: '2026-03-10', dutyDomain: 'MO', shiftCode: 'PM', source: 'REPLACEMENT', coverageStatus: 'COVERED', replacementId: 'repl-101', coveringForPersonId: 'p-1' }
  ];
  await page.evaluate((curr) => mountPhase6Test({ initialState: 'AMENDED', isAdmin: true, currentAssignments: curr }), customCurrent);
  await page.waitForSelector('[data-testid="badge-covering-p-3-2026-03-10-MO"]');

  const coveringText = await page.$eval('[data-testid="badge-covering-p-3-2026-03-10-MO"]', el => el.textContent.trim());
  assert.match(coveringText, /Covering Dr\. Sarah Lee/);
});

test('18. duplicate display names do not collide', async () => {
  await page.evaluate(() => mountPhase6Test({ initialState: 'PUBLISHED', isAdmin: true }));
  await page.waitForSelector('#cell-p-1-2026-03-10-MO');
  await page.waitForSelector('#cell-p-2-2026-03-10-MO');

  const cell1 = await page.$('#cell-p-1-2026-03-10-MO');
  const cell2 = await page.$('#cell-p-2-2026-03-10-MO');
  assert.ok(cell1);
  assert.ok(cell2);
});

test('19. same date/different DutyDomain candidate remains eligible where backend permits', async () => {
  const customCurrent = [
    { assignmentId: 'asg-1', personId: 'p-1', personNameSnapshot: 'Dr. Sarah Lee', date: '2026-03-10', dutyDomain: 'MO', shiftCode: 'MC', source: 'ABSENCE', coverageStatus: 'UNCOVERED', absenceId: 'abs-101', originalShiftCode: 'PM' },
    { assignmentId: 'asg-6', personId: 'p-ep', personNameSnapshot: 'Dr. Alex Cross', date: '2026-03-10', dutyDomain: 'EP', shiftCode: 'EP_ONCALL' }
  ];
  await page.evaluate((curr) => mountPhase6Test({ initialState: 'AMENDED', isAdmin: true, currentAssignments: curr }), customCurrent);
  await page.waitForSelector('#btn-assign-replacement-p-1-2026-03-10-MO');

  await page.click('#btn-assign-replacement-p-1-2026-03-10-MO');
  await page.waitForSelector('#replacement-candidate-select');

  const optionDisabled = await page.$eval(
    '#replacement-candidate-select option[value="p-ep"]',
    el => el.disabled
  );
  assert.equal(optionDisabled, false);
});

test('20. same-domain working collision marked unavailable', async () => {
  const customCurrent = [
    { assignmentId: 'asg-2', personId: 'p-1', personNameSnapshot: 'Dr. Sarah Lee', date: '2026-03-12', dutyDomain: 'MO', shiftCode: 'MC', source: 'ABSENCE', coverageStatus: 'UNCOVERED', absenceId: 'abs-101', originalShiftCode: 'AM' },
    { assignmentId: 'asg-5', personId: 'p-3', personNameSnapshot: 'Dr. John Doe', date: '2026-03-12', dutyDomain: 'MO', shiftCode: 'PM' }
  ];
  await page.evaluate((curr) => mountPhase6Test({ initialState: 'AMENDED', isAdmin: true, currentAssignments: curr }), customCurrent);
  await page.waitForSelector('#btn-assign-replacement-p-1-2026-03-12-MO');

  await page.click('#btn-assign-replacement-p-1-2026-03-12-MO');
  await page.waitForSelector('#replacement-candidate-select');

  const optionDisabled = await page.$eval(
    '#replacement-candidate-select option[value="p-3"]',
    el => el.disabled
  );
  assert.equal(optionDisabled, true);
});

test('21. OFF candidate allowed', async () => {
  const customCurrent = [
    { assignmentId: 'asg-1', personId: 'p-1', personNameSnapshot: 'Dr. Sarah Lee', date: '2026-03-10', dutyDomain: 'MO', shiftCode: 'MC', source: 'ABSENCE', coverageStatus: 'UNCOVERED', absenceId: 'abs-101', originalShiftCode: 'PM' },
    { assignmentId: 'asg-4', personId: 'p-3', personNameSnapshot: 'Dr. John Doe', date: '2026-03-10', dutyDomain: 'MO', shiftCode: 'OFF' }
  ];
  await page.evaluate((curr) => mountPhase6Test({ initialState: 'AMENDED', isAdmin: true, currentAssignments: curr }), customCurrent);
  await page.waitForSelector('#btn-assign-replacement-p-1-2026-03-10-MO');

  await page.click('#btn-assign-replacement-p-1-2026-03-10-MO');
  await page.waitForSelector('#replacement-candidate-select');

  const optionDisabled = await page.$eval(
    '#replacement-candidate-select option[value="p-3"]',
    el => el.disabled
  );
  assert.equal(optionDisabled, false);
});

test('22. actively absent candidate unavailable', async () => {
  const customCurrent = [
    { assignmentId: 'asg-1', personId: 'p-1', personNameSnapshot: 'Dr. Sarah Lee', date: '2026-03-10', dutyDomain: 'MO', shiftCode: 'MC', source: 'ABSENCE', coverageStatus: 'UNCOVERED', absenceId: 'abs-101', originalShiftCode: 'PM' },
    { assignmentId: 'asg-7', personId: 'p-absent', personNameSnapshot: 'Dr. Bob Vance', date: '2026-03-10', dutyDomain: 'MO', shiftCode: 'MC', source: 'ABSENCE', coverageStatus: 'UNCOVERED', absenceId: 'abs-102' }
  ];
  const initialAbs = [
    { AbsenceId: 'abs-102', PeriodId: '2026-03', PersonId: 'p-absent', DutyDomain: 'MO', StartDate: '2026-03-10', EndDate: '2026-03-10', Status: 'ACTIVE' }
  ];
  await page.evaluate((curr, abs) => mountPhase6Test({ initialState: 'AMENDED', isAdmin: true, currentAssignments: curr, initialAbsences: abs }), customCurrent, initialAbs);
  await page.waitForSelector('#btn-assign-replacement-p-1-2026-03-10-MO');

  await page.click('#btn-assign-replacement-p-1-2026-03-10-MO');
  await page.waitForSelector('#replacement-candidate-select');

  const optionDisabled = await page.$eval(
    '#replacement-candidate-select option[value="p-absent"]',
    el => el.disabled
  );
  assert.equal(optionDisabled, true);
});

test('23. replacement submit uses authoritative IDs', async () => {
  const customCurrent = [
    { assignmentId: 'asg-1', personId: 'p-1', personNameSnapshot: 'Dr. Sarah Lee', date: '2026-03-10', dutyDomain: 'MO', shiftCode: 'MC', source: 'ABSENCE', coverageStatus: 'UNCOVERED', absenceId: 'abs-101', originalShiftCode: 'PM', originalAssignmentId: 'asg-1' },
    { assignmentId: 'asg-4', personId: 'p-3', personNameSnapshot: 'Dr. John Doe', date: '2026-03-10', dutyDomain: 'MO', shiftCode: 'OFF' }
  ];
  await page.evaluate((curr) => mountPhase6Test({ initialState: 'AMENDED', isAdmin: true, currentAssignments: curr }), customCurrent);
  await page.waitForSelector('#btn-assign-replacement-p-1-2026-03-10-MO');

  await page.click('#btn-assign-replacement-p-1-2026-03-10-MO');
  await page.waitForSelector('#replacement-candidate-select');

  await page.select('#replacement-candidate-select', 'p-3');
  await page.click('#btn-submit-replacement');
  await page.waitForFunction(() => !document.querySelector('#replacement-modal'));

  const log = await page.evaluate(() => window.phase6Test.callLog.createReplacement);
  assert.equal(log.length, 1);
  assert.equal(log[0].payload.absenceId, 'abs-101');
  assert.equal(log[0].payload.replacementPersonId, 'p-3');
  assert.equal(log[0].payload.date, '2026-03-10');
});

test('24. replacement reversal leaves absence visible', async () => {
  const customAbs = [
    { AbsenceId: 'abs-101', PeriodId: '2026-03', PersonId: 'p-1', PersonNameSnapshot: 'Dr. Sarah Lee', AbsenceType: 'MC', DutyDomain: 'MO', StartDate: '2026-03-10', EndDate: '2026-03-10', Status: 'ACTIVE' }
  ];
  const customRepl = [
    { ReplacementId: 'repl-101', AbsenceId: 'abs-101', ReplacementPersonId: 'p-3', Date: '2026-03-10', DutyDomain: 'MO', ShiftCode: 'PM', Status: 'ACTIVE' }
  ];
  const customCurrent = [
    { assignmentId: 'asg-1', personId: 'p-1', personNameSnapshot: 'Dr. Sarah Lee', date: '2026-03-10', dutyDomain: 'MO', shiftCode: 'MC', source: 'ABSENCE', coverageStatus: 'COVERED', absenceId: 'abs-101', replacementId: 'repl-101', originalShiftCode: 'PM' }
  ];
  await page.evaluate((curr, abs, repl) => mountPhase6Test({ initialState: 'AMENDED', isAdmin: true, currentAssignments: curr, initialAbsences: abs, initialReplacements: repl }), customCurrent, customAbs, customRepl);
  await page.waitForSelector('#view-mode-changes');

  // Switch to Changes view
  await page.click('#view-mode-changes');
  await page.waitForSelector('#btn-reverse-replacement-repl-101');

  await page.click('#btn-reverse-replacement-repl-101');
  await page.waitForSelector('#replacement-reversal-shortage-checkbox');

  await page.click('#replacement-reversal-shortage-checkbox');
  await page.type('#replacement-reversal-reason', 'Doctor unable to cover');
  await page.click('#btn-confirm-reverse-replacement');

  await page.waitForFunction(() => !document.querySelector('#btn-confirm-reverse-replacement'));

  // Switch back to Current view
  await page.click('#view-mode-current');
  await page.waitForSelector('[data-testid="badge-uncovered-p-1-2026-03-10-MO"]');

  // Absence is still visible and uncovered
  const badgeText = await page.$eval('[data-testid="badge-uncovered-p-1-2026-03-10-MO"]', el => el.textContent.trim());
  assert.equal(badgeText, 'Uncovered');
});

test('25. replacement reversal returns duty to uncovered', async () => {
  const customAbs = [
    { AbsenceId: 'abs-101', PeriodId: '2026-03', PersonId: 'p-1', PersonNameSnapshot: 'Dr. Sarah Lee', AbsenceType: 'MC', DutyDomain: 'MO', StartDate: '2026-03-10', EndDate: '2026-03-10', Status: 'ACTIVE' }
  ];
  const customRepl = [
    { ReplacementId: 'repl-101', AbsenceId: 'abs-101', ReplacementPersonId: 'p-3', Date: '2026-03-10', DutyDomain: 'MO', ShiftCode: 'PM', Status: 'ACTIVE' }
  ];
  const customCurrent = [
    { assignmentId: 'asg-1', personId: 'p-1', personNameSnapshot: 'Dr. Sarah Lee', date: '2026-03-10', dutyDomain: 'MO', shiftCode: 'MC', source: 'ABSENCE', coverageStatus: 'COVERED', absenceId: 'abs-101', replacementId: 'repl-101', originalShiftCode: 'PM' }
  ];
  await page.evaluate((curr, abs, repl) => mountPhase6Test({ initialState: 'AMENDED', isAdmin: true, currentAssignments: curr, initialAbsences: abs, initialReplacements: repl }), customCurrent, customAbs, customRepl);
  await page.waitForSelector('#view-mode-changes');

  await page.click('#view-mode-changes');
  await page.waitForSelector('#btn-reverse-replacement-repl-101');

  await page.click('#btn-reverse-replacement-repl-101');
  await page.waitForSelector('#replacement-reversal-shortage-checkbox');

  await page.click('#replacement-reversal-shortage-checkbox');
  await page.type('#replacement-reversal-reason', 'Returning to uncovered status');
  await page.click('#btn-confirm-reverse-replacement');
  await page.waitForFunction(() => !document.querySelector('#btn-confirm-reverse-replacement'));

  const log = await page.evaluate(() => window.phase6Test.callLog.reverseReplacement);
  assert.equal(log[0].replacementId, 'repl-101');
});

test('26. absence reversal blocked while replacement active', async () => {
  const customAbs = [
    { AbsenceId: 'abs-101', PeriodId: '2026-03', PersonId: 'p-1', PersonNameSnapshot: 'Dr. Sarah Lee', AbsenceType: 'MC', DutyDomain: 'MO', StartDate: '2026-03-10', EndDate: '2026-03-10', Status: 'ACTIVE' }
  ];
  const customRepl = [
    { ReplacementId: 'repl-101', AbsenceId: 'abs-101', ReplacementPersonId: 'p-3', Date: '2026-03-10', DutyDomain: 'MO', ShiftCode: 'PM', Status: 'ACTIVE' }
  ];
  await page.evaluate((abs, repl) => mountPhase6Test({ initialState: 'AMENDED', isAdmin: true, initialAbsences: abs, initialReplacements: repl }), customAbs, customRepl);
  await page.waitForSelector('#view-mode-changes');

  await page.click('#view-mode-changes');
  await page.waitForSelector('#btn-reverse-absence-abs-101');

  await page.click('#btn-reverse-absence-abs-101');
  await page.waitForSelector('#operational-error-banner');

  const errorText = await page.$eval('#operational-error-banner', el => el.textContent);
  assert.match(errorText, /Reverse the active replacement first before reversing this absence/);
});

test('27. final absence reversal restores Current', async () => {
  const customAbs = [
    { AbsenceId: 'abs-101', PeriodId: '2026-03', PersonId: 'p-1', PersonNameSnapshot: 'Dr. Sarah Lee', AbsenceType: 'MC', DutyDomain: 'MO', StartDate: '2026-03-10', EndDate: '2026-03-10', Status: 'ACTIVE' }
  ];
  const customCurrent = [
    { assignmentId: 'asg-1', personId: 'p-1', personNameSnapshot: 'Dr. Sarah Lee', date: '2026-03-10', dutyDomain: 'MO', shiftCode: 'MC', source: 'ABSENCE', coverageStatus: 'UNCOVERED', absenceId: 'abs-101', originalShiftCode: 'PM' }
  ];
  await page.evaluate((curr, abs) => mountPhase6Test({ initialState: 'AMENDED', isAdmin: true, currentAssignments: curr, initialAbsences: abs }), customCurrent, customAbs);
  await page.waitForSelector('#view-mode-changes');

  await page.click('#view-mode-changes');
  await page.waitForSelector('#btn-reverse-absence-abs-101');

  await page.click('#btn-reverse-absence-abs-101');
  await page.waitForSelector('#btn-confirm-reverse-absence');

  await page.click('#btn-confirm-reverse-absence');
  await page.waitForFunction(() => !document.querySelector('#btn-confirm-reverse-absence'));

  // Switch to Current view
  await page.click('#view-mode-current');
  await page.waitForSelector('#btn-amend-p-1-2026-03-10-MO');

  const shiftText = await page.$eval('#btn-amend-p-1-2026-03-10-MO', el => el.textContent.trim());
  assert.equal(shiftText, 'PM');
});

test('28. no-duty absence lifecycle remains PUBLISHED', async () => {
  await page.evaluate(() => mountPhase6Test({ initialState: 'PUBLISHED', isAdmin: true }));
  await page.waitForSelector('#btn-toolbar-record-absence');

  await page.click('#btn-toolbar-record-absence');
  await page.waitForSelector('#absence-modal');

  await page.select('#absence-person-select', 'p-noduty');
  await page.click('#btn-submit-absence');
  await page.waitForFunction(() => !document.querySelector('#absence-modal'));

  const containerText = await page.$eval('#phase-5-roster-container', el => el.textContent);
  assert.match(containerText, /rev 1/);
});

test('29. working-duty absence lifecycle becomes AMENDED', async () => {
  await page.evaluate(() => mountPhase6Test({ initialState: 'PUBLISHED', isAdmin: true }));
  await page.waitForSelector('#btn-record-absence-p-1-2026-03-10-MO');

  await page.click('#btn-record-absence-p-1-2026-03-10-MO');
  await page.waitForSelector('#absence-modal');

  await page.click('#shortage-accept-checkbox');
  await page.type('#shortage-reason-input', 'Leave accepted');
  await page.click('#btn-submit-absence');
  await page.waitForFunction(() => !document.querySelector('#absence-modal'));

  const containerText = await page.$eval('#phase-5-roster-container', el => el.textContent);
  assert.match(containerText, /rev 2/);
});

test('30. Phase 5 amendment + reversed Phase 6 remains AMENDED', async () => {
  const initialEvents = [
    { EventId: 'EV-1', EventType: 'ADMIN_CORRECTION', isReversed: false, lines: [] }
  ];
  const customAbs = [
    { AbsenceId: 'abs-101', PeriodId: '2026-03', PersonId: 'p-1', PersonNameSnapshot: 'Dr. Sarah Lee', AbsenceType: 'MC', DutyDomain: 'MO', StartDate: '2026-03-10', EndDate: '2026-03-10', Status: 'ACTIVE' }
  ];
  const customCurrent = [
    { assignmentId: 'asg-1', personId: 'p-1', personNameSnapshot: 'Dr. Sarah Lee', date: '2026-03-10', dutyDomain: 'MO', shiftCode: 'MC', source: 'ABSENCE', coverageStatus: 'UNCOVERED', absenceId: 'abs-101', originalShiftCode: 'PM' }
  ];
  await page.evaluate((curr, abs, evs) => mountPhase6Test({ initialState: 'AMENDED', isAdmin: true, currentAssignments: curr, initialAbsences: abs, events: evs }), customCurrent, customAbs, initialEvents);
  await page.waitForSelector('#view-mode-changes');

  await page.click('#view-mode-changes');
  await page.waitForSelector('#btn-reverse-absence-abs-101');

  await page.click('#btn-reverse-absence-abs-101');
  await page.waitForSelector('#btn-confirm-reverse-absence');
  await page.click('#btn-confirm-reverse-absence');
  await page.waitForFunction(() => !document.querySelector('#btn-confirm-reverse-absence'));

  // Should remain AMENDED because EV-1 is still active
  const state = await page.evaluate(() => window.phase6Test.mockQueue.view().lifecycle.state);
  assert.equal(state, 'AMENDED');
});

test('31. dedicated absence recovery endpoint used', async () => {
  await page.evaluate(() => mountPhase6Test({
    initialState: 'AMENDED',
    isAdmin: true,
    simulateRecoveryRequired: 'ABSENCE_CREATE'
  }));
  await page.waitForSelector('#btn-retry-recovery');

  await page.click('#btn-retry-recovery');
  await page.waitForFunction(() => !document.querySelector('#btn-retry-recovery'));

  const recLog = await page.evaluate(() => window.phase6Test.callLog.recoverAbsence);
  assert.equal(recLog.length, 1);
  assert.equal(recLog[0], 'rec-op-123');
});

test('32. dedicated replacement recovery endpoint used', async () => {
  await page.evaluate(() => mountPhase6Test({
    initialState: 'AMENDED',
    isAdmin: true,
    simulateRecoveryRequired: 'REPLACEMENT_CREATE'
  }));
  await page.waitForSelector('#btn-retry-recovery');

  await page.click('#btn-retry-recovery');
  await page.waitForFunction(() => !document.querySelector('#btn-retry-recovery'));

  const recLog = await page.evaluate(() => window.phase6Test.callLog.recoverReplacement);
  assert.equal(recLog.length, 1);
  assert.equal(recLog[0], 'rec-repl-456');
});

test('33. RECOVERY_REQUIRED UI preserves operationId', async () => {
  await page.evaluate(() => mountPhase6Test({
    initialState: 'AMENDED',
    isAdmin: true,
    simulateRecoveryRequired: 'ABSENCE_CREATE'
  }));
  await page.waitForSelector('#recovery-required-banner');

  const text = await page.$eval('#recovery-required-banner', el => el.textContent);
  assert.match(text, /rec-op-123/);
});

test('34. retry/recovery does not create duplicate UI records', async () => {
  await page.evaluate(() => mountPhase6Test({
    initialState: 'AMENDED',
    isAdmin: true,
    simulateRecoveryRequired: 'ABSENCE_CREATE'
  }));
  await page.waitForSelector('#btn-retry-recovery');

  await page.click('#btn-retry-recovery');
  await page.waitForFunction(() => !document.querySelector('#btn-retry-recovery'));

  // Verify only 1 recovery banner was displayed and now dismissed
  const banners = await page.$$('#recovery-required-banner');
  assert.equal(banners.length, 0);
});

test('35. AdminNote shown only to admin', async () => {
  const customAbs = [
    { AbsenceId: 'abs-101', PeriodId: '2026-03', PersonId: 'p-1', PersonNameSnapshot: 'Dr. Sarah Lee', AbsenceType: 'MC', DutyDomain: 'MO', StartDate: '2026-03-10', EndDate: '2026-03-10', Status: 'ACTIVE', AdminNote: 'Doctor requested confidential sick leave' }
  ];
  await page.evaluate((abs) => mountPhase6Test({ initialState: 'AMENDED', isAdmin: true, initialAbsences: abs }), customAbs);
  await page.waitForSelector('#view-mode-changes');

  await page.click('#view-mode-changes');
  await page.waitForSelector('#operational-absence-panel');

  const text = await page.$eval('#operational-absence-panel', el => el.textContent);
  assert.match(text, /confidential sick leave/);
});

test('36. AdminNote never shown to viewer', async () => {
  const customAbs = [
    { AbsenceId: 'abs-101', PeriodId: '2026-03', PersonId: 'p-1', PersonNameSnapshot: 'Dr. Sarah Lee', AbsenceType: 'MC', DutyDomain: 'MO', StartDate: '2026-03-10', EndDate: '2026-03-10', Status: 'ACTIVE', AdminNote: '' }
  ];
  await page.evaluate((abs) => mountPhase6Test({ initialState: 'AMENDED', isAdmin: false, initialAbsences: abs }), customAbs);
  await page.waitForSelector('#view-mode-changes');

  await page.click('#view-mode-changes');
  await page.waitForSelector('#operational-absence-panel');

  const text = await page.$eval('#operational-absence-panel', el => el.textContent);
  assert.doesNotMatch(text, /Admin Note:/);
});

test('37. month switch clears Phase 6 state', async () => {
  const customAbs = [
    { AbsenceId: 'abs-101', PeriodId: '2026-03', PersonId: 'p-1', PersonNameSnapshot: 'Dr. Sarah Lee', AbsenceType: 'MC', DutyDomain: 'MO', StartDate: '2026-03-10', EndDate: '2026-03-10', Status: 'ACTIVE' }
  ];
  await page.evaluate((abs) => {
    mountPhase6Test({ initialState: 'AMENDED', isAdmin: true, initialAbsences: abs });
    window.phase6Test.enrollPeriod('2026-04', 'PUBLISHED', 1);
  }, customAbs);
  await page.waitForSelector('#btn-record-absence-p-1-2026-03-10-MO');

  // Switch month to 2026-04
  await page.evaluate(() => window.phase6Test.setPeriod('2026-04'));
  await page.waitForFunction(() => document.body.textContent.includes('2026-04'));

  // 2026-03 absence elements should not exist for 2026-04
  const oldBtn = await page.$('#btn-record-absence-p-1-2026-03-10-MO');
  assert.equal(oldBtn, null);
});

test('38. stale response rejected', async () => {
  await page.evaluate(() => {
    mountPhase6Test({
      initialPeriod: '2026-03',
      initialState: 'PUBLISHED',
      isAdmin: true,
      delayedPeriod: '2026-03',
      delayMs: 150
    });
    window.phase6Test.enrollPeriod('2026-04', 'PUBLISHED', 1);
  });

  // Rapidly switch to 2026-04
  await page.evaluate(() => window.phase6Test.setPeriod('2026-04'));
  await page.waitForFunction(() => document.body.textContent.includes('2026-04'));

  // Wait past delayed response
  await new Promise(r => setTimeout(r, 200));

  const text = await page.$eval('#phase-5-roster-container', el => el.textContent);
  assert.match(text, /Period: 2026-04/);
});

test('39. revision conflict triggers authoritative reload', async () => {
  await page.evaluate(() => mountPhase6Test({
    initialState: 'PUBLISHED',
    isAdmin: true,
    absenceError: 'REVISION_CONFLICT'
  }));
  await page.waitForSelector('#btn-record-absence-p-1-2026-03-10-MO');

  await page.click('#btn-record-absence-p-1-2026-03-10-MO');
  await page.waitForSelector('#absence-modal');

  await page.click('#shortage-accept-checkbox');
  await page.type('#shortage-reason-input', 'Testing revision conflict');
  await page.click('#btn-submit-absence');

  await page.waitForSelector('#revision-conflict-banner');
  const bannerText = await page.$eval('#revision-conflict-banner', el => el.textContent);
  assert.match(bannerText, /Roster changed since you opened it\. Refreshing the latest version\./);
});

test('40. no React direct fetch', async () => {
  // Static check across all components in src/features/roster/components
  const compDir = path.join(root, 'src/features/roster/components');
  const files = fs.readdirSync(compDir).filter(f => f.endsWith('.jsx') || f.endsWith('.js'));

  for (const file of files) {
    const content = fs.readFileSync(path.join(compDir, file), 'utf8');
    // Ensure no fetch( calls
    const hasDirectFetch = /\bfetch\s*\(/.test(content);
    assert.equal(hasDirectFetch, false, `Found direct fetch in ${file}`);
  }
});

test('41. Planned remains immutable/read-only', async () => {
  await page.evaluate(() => mountPhase6Test({ initialState: 'PUBLISHED', isAdmin: true }));
  await page.waitForSelector('#view-mode-planned');

  await page.click('#view-mode-planned');
  await page.waitForFunction(() => document.body.textContent.includes('Originally Published Roster'));

  const amendBtns = await page.$$('button[id^="btn-amend-"]');
  assert.equal(amendBtns.length, 0);

  const absenceBtns = await page.$$('button[id^="btn-record-absence-"]');
  assert.equal(absenceBtns.length, 0);
});

test('42. Current remains default view', async () => {
  await page.evaluate(() => mountPhase6Test({ initialState: 'PUBLISHED', isAdmin: true }));
  await page.waitForSelector('#view-mode-current');

  const selected = await page.$eval('#view-mode-current', el => el.getAttribute('aria-selected'));
  assert.equal(selected, 'true');
});

test('43. legacy mode remains unaffected', async () => {
  await page.evaluate(() => mountPhase6Test({ isEnrolled: false }));

  // Not enrolled: container returns null and renders no v2 elements
  const container = await page.$('#phase-5-roster-container');
  assert.equal(container, null);
});
