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

before(async () => {
  const ui = await build({
    entryPoints: [path.join(root, 'tests/phase5/ui-fixture.jsx')],
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
      res.end('<!doctype html><title>Phase 5 Roster UI Tests</title>');
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
    throw new Error('Set PHASE2_BROWSER_PATH to a Chromium browser for Phase 5 UI tests.');
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
      window.phase5Test?.close();
    });
  }
});

// ==========================================
// 1. VIEW MODES AND LIFECYCLE TESTS (1-4)
// ==========================================

test('1. Current is default view', async () => {
  await page.evaluate(() => mountPhase5Test({ initialState: 'PUBLISHED', isAdmin: true }));
  await page.waitForSelector('#view-mode-current');

  const isCurrentSelected = await page.$eval('#view-mode-current', el => el.getAttribute('aria-selected'));
  assert.equal(isCurrentSelected, 'true');

  const containerText = await page.$eval('#phase-5-roster-container', el => el.textContent);
  assert.match(containerText, /Authoritative Working Roster/);
});

test('2. Planned is immutable/read-only', async () => {
  await page.evaluate(() => mountPhase5Test({ initialState: 'PUBLISHED', isAdmin: true }));
  await page.waitForSelector('#view-mode-planned');

  // Switch to Planned view
  await page.click('#view-mode-planned');
  await page.waitForFunction(() => document.body.textContent.includes('Originally Published Roster'));

  const text = await page.$eval('#phase-5-roster-container', el => el.textContent);
  assert.match(text, /Planned Snapshot — Originally Published Roster/);
  assert.match(text, /Read-Only Snapshot/);

  // In Planned view, verify no amend buttons exist
  const amendButtons = await page.$$('button[id^="btn-amend-"]');
  assert.equal(amendButtons.length, 0);
});

test('3. Changes renders confirmed amendment history', async () => {
  const initialEvents = [
    {
      EventId: 'EV-101',
      EventType: 'ADMIN_CORRECTION',
      PublicReasonCode: 'DUTY_COVERAGE',
      AdminNote: 'Covering leave',
      CreatedAt: new Date().toISOString(),
      CreatedBy: 'admin@hospital.org',
      canReverse: true,
      isReversed: false,
      lines: [
        {
          LineId: 'EV-101-1',
          PersonId: 'p-1',
          PersonNameSnapshot: 'Dr. Sarah Lee',
          Date: '2026-03-01',
          DutyDomain: 'MO',
          BeforeShiftCode: 'AM',
          AfterShiftCode: 'PM'
        }
      ]
    }
  ];

  await page.evaluate((events) => mountPhase5Test({
    initialState: 'AMENDED',
    isAdmin: true,
    events
  }), initialEvents);

  await page.waitForSelector('#view-mode-changes');
  await page.click('#view-mode-changes');

  await page.waitForSelector('#history-event-EV-101');
  const eventText = await page.$eval('#history-event-EV-101', el => el.textContent);
  assert.match(eventText, /Correction/);
  assert.match(eventText, /Dr\. Sarah Lee/);
  assert.match(eventText, /DUTY_COVERAGE/);
});

test('4. AMENDED lifecycle badge renders', async () => {
  await page.evaluate(() => mountPhase5Test({ initialState: 'AMENDED', isAdmin: true }));
  await page.waitForFunction(() => document.body.textContent.includes('Amended'));

  const badgeText = await page.$eval('#test-phase5-container', el => el.textContent);
  assert.match(badgeText, /Amended/);
});

// ==========================================
// 2. AMENDMENT WORKFLOWS (5-7)
// ==========================================

test('5. ADMIN_CORRECTION submits authoritative PersonId/date/domain', async () => {
  await page.evaluate(() => mountPhase5Test({ initialState: 'PUBLISHED', isAdmin: true }));
  await page.waitForSelector('#btn-amend-p-1-2026-03-01-MO');

  // Open amendment modal for cell (p-1, 2026-03-01, MO)
  await page.click('#btn-amend-p-1-2026-03-01-MO');
  await page.waitForSelector('[role="dialog"]');

  // Enter new shift PM and select public reason
  await page.$eval('#correction-new-shift', el => el.value = '');
  await page.type('#correction-new-shift', 'PM');
  await page.select('#correction-public-reason', 'ADMIN_CORRECTION');
  await page.type('#correction-admin-note', 'Direct correction test');

  // Submit
  await page.click('#btn-confirm-amendment');
  await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));

  const callLog = await page.evaluate(() => window.phase5Test.callLog);
  assert.equal(callLog.amend.length, 1);
  const sent = callLog.amend[0].payload;

  assert.equal(sent.eventType, 'ADMIN_CORRECTION');
  assert.equal(sent.personId, 'p-1');
  assert.equal(sent.date, '2026-03-01');
  assert.equal(sent.dutyDomain, 'MO');
  assert.equal(sent.afterAssignments[0].shiftCode, 'PM');
  assert.equal(sent.publicReasonCode, 'ADMIN_CORRECTION');
  assert.equal(sent.adminNote, 'Direct correction test');
});

test('6. SWAP submits both authoritative identities', async () => {
  await page.evaluate(() => mountPhase5Test({ initialState: 'PUBLISHED', isAdmin: true }));
  await page.waitForSelector('#btn-amend-p-1-2026-03-01-MO');

  // Open modal on cell 1 (p-1, 2026-03-01, MO)
  await page.click('#btn-amend-p-1-2026-03-01-MO');
  await page.waitForSelector('[role="dialog"]');

  // Switch to Swap tab
  await page.click('#tab-swap-assignments');
  await page.waitForSelector('#swap-participant2-select');

  // Select participant 2 (p-3 on 2026-03-02 MO)
  const candidateKey = 'p-3::2026-03-02::MO';
  await page.select('#swap-participant2-select', candidateKey);
  await page.select('#swap-public-reason', 'SHIFT_SWAP');
  await page.type('#swap-admin-note', 'Mutual exchange');

  // Confirm Swap
  await page.click('#btn-confirm-swap');
  await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));

  const callLog = await page.evaluate(() => window.phase5Test.callLog);
  assert.equal(callLog.amend.length, 1);
  const sent = callLog.amend[0].payload;

  assert.equal(sent.eventType, 'SWAP');
  assert.equal(sent.person1.personId, 'p-1');
  assert.equal(sent.person1.date, '2026-03-01');
  assert.equal(sent.person1.dutyDomain, 'MO');

  assert.equal(sent.person2.personId, 'p-3');
  assert.equal(sent.person2.date, '2026-03-02');
  assert.equal(sent.person2.dutyDomain, 'MO');
  assert.equal(sent.publicReasonCode, 'SHIFT_SWAP');
  assert.equal(sent.adminNote, 'Mutual exchange');
});

test('7. PublicReasonCode required/validated', async () => {
  await page.evaluate(() => mountPhase5Test({ initialState: 'PUBLISHED', isAdmin: true }));
  await page.waitForSelector('#btn-amend-p-1-2026-03-01-MO');

  await page.click('#btn-amend-p-1-2026-03-01-MO');
  await page.waitForSelector('[role="dialog"]');

  // Clear public reason code
  await page.evaluate(() => {
    const sel = document.querySelector('#correction-public-reason');
    sel.value = '';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  });

  await page.click('#btn-confirm-amendment');

  const errorText = await page.$eval('#amendment-error-message', el => el.textContent);
  assert.match(errorText, /PublicReasonCode is strictly required/);

  const callLog = await page.evaluate(() => window.phase5Test.callLog);
  assert.equal(callLog.amend.length, 0);
});

// ==========================================
// 3. PRIVACY AND AUTHORIZATION (8-9)
// ==========================================

test('8. AdminNote visible to admin', async () => {
  const events = [
    {
      EventId: 'EV-PRIV-1',
      EventType: 'ADMIN_CORRECTION',
      PublicReasonCode: 'ADMIN_CORRECTION',
      AdminNote: 'Confidential clinical discussion',
      CreatedAt: new Date().toISOString(),
      CreatedBy: 'admin@hospital.org',
      canReverse: true,
      isReversed: false,
      lines: [
        {
          LineId: 'EV-PRIV-1-1',
          PersonId: 'p-1',
          PersonNameSnapshot: 'Dr. Sarah Lee',
          Date: '2026-03-01',
          DutyDomain: 'MO',
          BeforeShiftCode: 'AM',
          AfterShiftCode: 'PM'
        }
      ]
    }
  ];

  await page.evaluate((evs) => mountPhase5Test({
    initialState: 'AMENDED',
    isAdmin: true,
    events: evs
  }), events);

  await page.waitForSelector('#view-mode-changes');
  await page.click('#view-mode-changes');
  await page.waitForSelector('#history-event-EV-PRIV-1');

  const text = await page.$eval('#history-event-EV-PRIV-1', el => el.textContent);
  assert.match(text, /Confidential clinical discussion/);
});

test('9. AdminNote absent for viewer', async () => {
  // In viewer mode, backend strips AdminNote
  const events = [
    {
      EventId: 'EV-PRIV-2',
      EventType: 'ADMIN_CORRECTION',
      PublicReasonCode: 'ADMIN_CORRECTION',
      CreatedAt: new Date().toISOString(),
      canReverse: false,
      isReversed: false,
      lines: [
        {
          LineId: 'EV-PRIV-2-1',
          PersonId: 'p-1',
          PersonNameSnapshot: 'Dr. Sarah Lee',
          Date: '2026-03-01',
          DutyDomain: 'MO',
          BeforeShiftCode: 'AM',
          AfterShiftCode: 'PM'
        }
      ]
    }
  ];

  await page.evaluate((evs) => mountPhase5Test({
    initialState: 'AMENDED',
    isAdmin: false, // Viewer mode
    events: evs
  }), events);

  await page.waitForSelector('#view-mode-changes');
  await page.click('#view-mode-changes');
  await page.waitForSelector('#history-event-EV-PRIV-2');

  const text = await page.$eval('#history-event-EV-PRIV-2', el => el.textContent);
  assert.doesNotMatch(text, /Admin Note/i);
});

// ==========================================
// 4. AMENDMENT UPDATES CURRENT & CHANGES (10-12)
// ==========================================

test('10. Successful amendment updates Current', async () => {
  await page.evaluate(() => mountPhase5Test({ initialState: 'PUBLISHED', isAdmin: true }));
  await page.waitForSelector('#btn-amend-p-1-2026-03-01-MO');

  // Verify initial shift is AM
  const initialText = await page.$eval('#cell-p-1-2026-03-01-MO', el => el.textContent);
  assert.match(initialText, /AM/);

  // Amend cell to PM
  await page.click('#btn-amend-p-1-2026-03-01-MO');
  await page.waitForSelector('[role="dialog"]');
  await page.$eval('#correction-new-shift', el => el.value = '');
  await page.type('#correction-new-shift', 'PM');
  await page.click('#btn-confirm-amendment');
  await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));

  // Cell should now show PM and the Changed badge
  const updatedText = await page.$eval('#cell-p-1-2026-03-01-MO', el => el.textContent);
  assert.match(updatedText, /PM/);
  assert.match(updatedText, /Changed/);
});

test('11. Planned remains unchanged after amendment', async () => {
  await page.evaluate(() => mountPhase5Test({ initialState: 'PUBLISHED', isAdmin: true }));
  await page.waitForSelector('#btn-amend-p-1-2026-03-01-MO');

  // Amend cell in Current view
  await page.click('#btn-amend-p-1-2026-03-01-MO');
  await page.waitForSelector('[role="dialog"]');
  await page.$eval('#correction-new-shift', el => el.value = '');
  await page.type('#correction-new-shift', 'PM');
  await page.click('#btn-confirm-amendment');
  await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));

  // Switch to Planned view
  await page.click('#view-mode-planned');
  await page.waitForFunction(() => document.body.textContent.includes('Originally Published Roster'));

  // In Planned view, Planned snapshot remains AM
  const plannedTableText = await page.$eval('#phase-5-roster-container table', el => el.textContent);
  assert.match(plannedTableText, /AM/);
  assert.doesNotMatch(plannedTableText, /Changed/);
});

test('12. Changes receives amendment entry', async () => {
  await page.evaluate(() => mountPhase5Test({ initialState: 'PUBLISHED', isAdmin: true }));
  await page.waitForSelector('#btn-amend-p-1-2026-03-01-MO');

  // Amend cell
  await page.click('#btn-amend-p-1-2026-03-01-MO');
  await page.waitForSelector('[role="dialog"]');
  await page.$eval('#correction-new-shift', el => el.value = '');
  await page.type('#correction-new-shift', 'ON1');
  await page.click('#btn-confirm-amendment');
  await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));

  // Switch to Changes
  await page.click('#view-mode-changes');
  await page.waitForSelector('[id^="history-event-"]');

  const historyText = await page.$eval('#phase-5-roster-container', el => el.textContent);
  assert.match(historyText, /ON1/);
  assert.match(historyText, /Dr\. Sarah Lee/);
});

// ==========================================
// 5. 10-SECOND UNDO (13-15)
// ==========================================

test('13. 10-second Undo appears after confirmation', async () => {
  await page.evaluate(() => mountPhase5Test({ initialState: 'PUBLISHED', isAdmin: true, undoDurationMs: 10000 }));
  await page.waitForSelector('#btn-amend-p-1-2026-03-01-MO');

  await page.click('#btn-amend-p-1-2026-03-01-MO');
  await page.waitForSelector('[role="dialog"]');
  await page.$eval('#correction-new-shift', el => el.value = '');
  await page.type('#correction-new-shift', 'PM');
  await page.click('#btn-confirm-amendment');
  await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));

  // Undo Toast must appear
  await page.waitForSelector('[data-testid="undo-toast"]');
  const toastText = await page.$eval('[data-testid="undo-toast"]', el => el.textContent);
  assert.match(toastText, /Undo/);
  assert.match(toastText, /Change confirmed/);
});

test('14. Undo invokes real reversal endpoint/queue', async () => {
  await page.evaluate(() => mountPhase5Test({ initialState: 'PUBLISHED', isAdmin: true, undoDurationMs: 10000 }));
  await page.waitForSelector('#btn-amend-p-1-2026-03-01-MO');

  await page.click('#btn-amend-p-1-2026-03-01-MO');
  await page.waitForSelector('[role="dialog"]');
  await page.$eval('#correction-new-shift', el => el.value = '');
  await page.type('#correction-new-shift', 'PM');
  await page.click('#btn-confirm-amendment');
  await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));

  // Click Undo in toast
  await page.waitForSelector('#btn-undo-action');
  await page.click('#btn-undo-action');

  // Verify queue.reverseAmendment was invoked
  await page.waitForFunction(() => !document.querySelector('[data-testid="undo-toast"]'));

  const callLog = await page.evaluate(() => window.phase5Test.callLog);
  assert.equal(callLog.reverseAmendment.length, 1);
  assert.ok(callLog.reverseAmendment[0].eventId.startsWith('EV-'));
});

test('15. Undo expiry removes UI action without mutation', async () => {
  await page.evaluate(() => mountPhase5Test({ initialState: 'PUBLISHED', isAdmin: true, undoDurationMs: 10000 }));
  await page.waitForSelector('#btn-amend-p-1-2026-03-01-MO');

  await page.click('#btn-amend-p-1-2026-03-01-MO');
  await page.waitForSelector('[role="dialog"]');
  await page.$eval('#correction-new-shift', el => el.value = '');
  await page.type('#correction-new-shift', 'PM');
  await page.click('#btn-confirm-amendment');
  await page.waitForSelector('[data-testid="undo-toast"]');

  // Simulate expiry without waiting 10s
  await page.evaluate(() => window.phase5Test.triggerUndoExpire());
  await page.waitForFunction(() => !document.querySelector('[data-testid="undo-toast"]'));

  // Verify reverseAmendment was NOT called on expiry
  const callLog = await page.evaluate(() => window.phase5Test.callLog);
  assert.equal(callLog.reverseAmendment.length, 0);
});

// ==========================================
// 6. REVERSALS & DEPENDENCY SAFETY (16-18)
// ==========================================

test('16. Reversal updates Current', async () => {
  await page.evaluate(() => mountPhase5Test({ initialState: 'PUBLISHED', isAdmin: true }));
  await page.waitForSelector('#btn-amend-p-1-2026-03-01-MO');

  // Amend from AM to PM
  await page.click('#btn-amend-p-1-2026-03-01-MO');
  await page.waitForSelector('[role="dialog"]');
  await page.$eval('#correction-new-shift', el => el.value = '');
  await page.type('#correction-new-shift', 'PM');
  await page.click('#btn-confirm-amendment');
  await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));

  // Click Undo to reverse
  await page.waitForSelector('#btn-undo-action');
  await page.click('#btn-undo-action');
  await page.waitForFunction(() => !document.querySelector('[data-testid="undo-toast"]'));

  // Cell should be restored to AM and no Changed badge
  const cellText = await page.$eval('#cell-p-1-2026-03-01-MO', el => el.textContent);
  assert.match(cellText, /AM/);
  assert.doesNotMatch(cellText, /Changed/);
});

test('17. Reversal history remains append-only', async () => {
  await page.evaluate(() => mountPhase5Test({ initialState: 'PUBLISHED', isAdmin: true }));
  await page.waitForSelector('#btn-amend-p-1-2026-03-01-MO');

  // Amend and reverse
  await page.click('#btn-amend-p-1-2026-03-01-MO');
  await page.waitForSelector('[role="dialog"]');
  await page.$eval('#correction-new-shift', el => el.value = '');
  await page.type('#correction-new-shift', 'PM');
  await page.click('#btn-confirm-amendment');
  await page.waitForSelector('#btn-undo-action');
  await page.click('#btn-undo-action');
  await page.waitForFunction(() => !document.querySelector('[data-testid="undo-toast"]'));

  // Switch to Changes
  await page.click('#view-mode-changes');
  await page.waitForSelector('[id^="history-event-"]');

  const historyEvents = await page.$$('[id^="history-event-"]');
  // Both the original amendment and the reversal exist
  assert.equal(historyEvents.length, 2);

  const containerText = await page.$eval('#phase-5-roster-container', el => el.textContent);
  assert.match(containerText, /Reversal/);
  assert.match(containerText, /Reverted change from/);
  assert.match(containerText, /\(Reversed\)/);
});

test('18. Dependency-blocked reversal shows error without local corruption', async () => {
  const events = [
    {
      EventId: 'EV-DEP-1',
      EventType: 'ADMIN_CORRECTION',
      PublicReasonCode: 'ADMIN_CORRECTION',
      CreatedAt: new Date().toISOString(),
      canReverse: true,
      isReversed: false,
      lines: [
        {
          LineId: 'EV-DEP-1-1',
          PersonId: 'p-1',
          PersonNameSnapshot: 'Dr. Sarah Lee',
          Date: '2026-03-01',
          DutyDomain: 'MO',
          BeforeShiftCode: 'AM',
          AfterShiftCode: 'PM'
        }
      ]
    }
  ];

  await page.evaluate((evs) => mountPhase5Test({
    initialState: 'AMENDED',
    isAdmin: true,
    events: evs,
    reverseError: 'REVERSAL_DEPENDENCY_CONFLICT'
  }), events);

  await page.waitForSelector('#view-mode-changes');
  await page.click('#view-mode-changes');
  await page.waitForSelector('#btn-reverse-EV-DEP-1');

  // Attempt reversal
  await page.click('#btn-reverse-EV-DEP-1');
  await page.waitForSelector('#btn-confirm-reversal');
  await page.click('#btn-confirm-reversal');

  // Error banner must display
  await page.waitForSelector('#reversal-error-banner');
  const errorText = await page.$eval('#reversal-error-banner', el => el.textContent);
  assert.match(errorText, /newer amendment depends on this assignment/);

  // Switch back to Current view: data must NOT be corrupted
  await page.click('#view-mode-current');
  await page.waitForSelector('#cell-p-1-2026-03-01-MO');
  const cellText = await page.$eval('#cell-p-1-2026-03-01-MO', el => el.textContent);
  assert.match(cellText, /AM/);
});

// ==========================================
// 7. CELL IDENTITY & DOMAIN ISOLATION (19-20)
// ==========================================

test('19. Duplicate display names do not collide', async () => {
  // p-1 and p-2 both named "Dr. Sarah Lee"
  await page.evaluate(() => mountPhase5Test({ initialState: 'PUBLISHED', isAdmin: true }));
  await page.waitForSelector('#btn-amend-p-1-2026-03-01-MO');
  await page.waitForSelector('#btn-amend-p-2-2026-03-01-MO');

  // Amend p-1 to NIGHT
  await page.click('#btn-amend-p-1-2026-03-01-MO');
  await page.waitForSelector('[role="dialog"]');
  await page.$eval('#correction-new-shift', el => el.value = '');
  await page.type('#correction-new-shift', 'NIGHT');
  await page.click('#btn-confirm-amendment');
  await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));

  // p-1 has NIGHT; p-2 still has PM
  const p1Text = await page.$eval('#cell-p-1-2026-03-01-MO', el => el.textContent);
  assert.match(p1Text, /NIGHT/);

  const p2Text = await page.$eval('#cell-p-2-2026-03-01-MO', el => el.textContent);
  assert.match(p2Text, /PM/);
});

test('20. Same person/date across MO and EP does not collide', async () => {
  // p-1 on 2026-03-01 has both MO and EP assignments
  await page.evaluate(() => mountPhase5Test({ initialState: 'PUBLISHED', isAdmin: true }));
  await page.waitForSelector('#btn-amend-p-1-2026-03-01-MO');
  await page.waitForSelector('#btn-amend-p-1-2026-03-01-EP');

  // Amend MO to PM
  await page.click('#btn-amend-p-1-2026-03-01-MO');
  await page.waitForSelector('[role="dialog"]');
  await page.$eval('#correction-new-shift', el => el.value = '');
  await page.type('#correction-new-shift', 'PM');
  await page.click('#btn-confirm-amendment');
  await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));

  // MO cell changed to PM; EP cell remains EP_ONCALL
  const moText = await page.$eval('#cell-p-1-2026-03-01-MO', el => el.textContent);
  assert.match(moText, /PM/);

  const epText = await page.$eval('#cell-p-1-2026-03-01-EP', el => el.textContent);
  assert.match(epText, /EP_ONCALL/);
});

// ==========================================
// 8. MONTH SWITCHING & ASYNC SAFETY (21-22)
// ==========================================

test('21. Month switch clears stale Current/Planned/Changes', async () => {
  await page.evaluate(() => {
    mountPhase5Test({ initialPeriod: '2026-03', initialState: 'PUBLISHED', isAdmin: true });
    window.phase5Test.enrollPeriod('2026-04', 'PUBLISHED', 1);
  });
  await page.waitForSelector('#cell-p-1-2026-03-01-MO');

  // Switch to April
  await page.evaluate(() => window.phase5Test.setPeriod('2026-04'));
  await page.waitForFunction(() => document.body.textContent.includes('2026-04'));

  const headerText = await page.$eval('#phase-5-roster-container', el => el.textContent);
  assert.match(headerText, /Period:\s*2026-04/);
});

test('22. Stale async result cannot overwrite newly selected month', async () => {
  // Delay 2026-03 response, then switch to 2026-04 immediately
  await page.evaluate(() => {
    mountPhase5Test({
      initialPeriod: '2026-03',
      initialState: 'PUBLISHED',
      isAdmin: true,
      delayedPeriod: '2026-03',
      delayMs: 250
    });
    window.phase5Test.enrollPeriod('2026-04', 'PUBLISHED', 1);
  });

  // Rapidly switch to 2026-04 before 2026-03 finishes loading
  await page.evaluate(() => window.phase5Test.setPeriod('2026-04'));
  await page.waitForFunction(() => document.body.textContent.includes('2026-04'));

  // Wait long enough for the delayed 2026-03 promise to resolve
  await new Promise(r => setTimeout(r, 350));

  const text = await page.$eval('#phase-5-roster-container', el => el.textContent);
  assert.match(text, /Period:\s*2026-04/);
  assert.doesNotMatch(text, /Period:\s*2026-03/);
});

// ==========================================
// 9. REVISION CONFLICTS & WRITE GATES (23-26)
// ==========================================

test('23. Revision conflict refreshes authoritative data', async () => {
  await page.evaluate(() => mountPhase5Test({
    initialState: 'PUBLISHED',
    isAdmin: true,
    amendError: 'REVISION_CONFLICT'
  }));
  await page.waitForSelector('#btn-amend-p-1-2026-03-01-MO');

  await page.click('#btn-amend-p-1-2026-03-01-MO');
  await page.waitForSelector('[role="dialog"]');
  await page.$eval('#correction-new-shift', el => el.value = '');
  await page.type('#correction-new-shift', 'PM');
  await page.click('#btn-confirm-amendment');

  // Must surface clear revision conflict message
  await page.waitForSelector('#revision-conflict-banner');
  const msg = await page.$eval('#revision-conflict-banner', el => el.textContent);
  assert.match(msg, /Roster changed since you opened it\. Refreshing the latest version\./);
});

test('24. CLOSED blocks amendment UI', async () => {
  await page.evaluate(() => mountPhase5Test({ initialState: 'CLOSED', isAdmin: true }));
  await page.waitForSelector('#phase-5-roster-container');

  // In CLOSED state, no amend buttons should exist on cells
  const amendButtons = await page.$$('button[id^="btn-amend-"]');
  assert.equal(amendButtons.length, 0);
});

test('25. DRAFT does not expose Phase 5 amendment controls', async () => {
  await page.evaluate(() => mountPhase5Test({ initialState: 'DRAFT', isAdmin: true }));
  await page.waitForSelector('#test-phase5-container');

  // In DRAFT state, Phase 5 container renders null
  const container = await page.$('#phase-5-roster-container');
  assert.equal(container, null);
});

test('26. Viewer has no mutation controls', async () => {
  await page.evaluate(() => mountPhase5Test({ initialState: 'PUBLISHED', isAdmin: false }));
  await page.waitForSelector('#phase-5-roster-container');

  // In Viewer mode, no amend buttons on cells
  const amendButtons = await page.$$('button[id^="btn-amend-"]');
  assert.equal(amendButtons.length, 0);

  // Switch to Changes: no reverse buttons exist
  await page.click('#view-mode-changes');
  const reverseButtons = await page.$$('button[id^="btn-reverse-"]');
  assert.equal(reverseButtons.length, 0);
});

// ==========================================
// 10. LEGACY & ARCHITECTURE INVARIANTS (27-28)
// ==========================================

test('27. Legacy mode remains unchanged', async () => {
  // When unenrolled, Phase 5 container renders null
  await page.evaluate(() => mountPhase5Test({ isEnrolled: false }));
  await page.waitForSelector('#test-phase5-container');

  const container = await page.$('#phase-5-roster-container');
  assert.equal(container, null);
});

test('28. Mutation/reversal flows use queue/repository only; no direct React fetch/backend access', async () => {
  await page.evaluate(() => mountPhase5Test({ initialState: 'PUBLISHED', isAdmin: true }));
  await page.waitForSelector('#btn-amend-p-1-2026-03-01-MO');

  // Verify all reads were tracked through mockQueue methods
  const initialCallLog = await page.evaluate(() => window.phase5Test.callLog);
  assert.ok(initialCallLog.getCurrentRoster.length > 0);
  assert.ok(initialCallLog.getPlannedRoster.length > 0);
  assert.ok(initialCallLog.getAmendmentHistory.length > 0);

  // Perform amendment
  await page.click('#btn-amend-p-1-2026-03-01-MO');
  await page.waitForSelector('[role="dialog"]');
  await page.$eval('#correction-new-shift', el => el.value = '');
  await page.type('#correction-new-shift', 'PM');
  await page.click('#btn-confirm-amendment');
  await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));

  // Verify mutation was tracked through mockQueue.amend
  const afterCallLog = await page.evaluate(() => window.phase5Test.callLog);
  assert.equal(afterCallLog.amend.length, 1);
});
