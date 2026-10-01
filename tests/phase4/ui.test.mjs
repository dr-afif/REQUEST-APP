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

const isButtonDisabled = async (text, containerSelector = '') => {
  return page.evaluate((t, sel) => {
    const rootEl = sel ? document.querySelector(sel) : document;
    const btn = [...rootEl.querySelectorAll('button')].find(b => b.textContent.includes(t));
    if (!btn) throw new Error(`Button with text "${t}" not found`);
    return btn.disabled;
  }, text, containerSelector);
};

before(async () => {
  const ui = await build({
    entryPoints: [path.join(root, 'tests/phase4/ui-fixture.jsx')],
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
      res.end('<!doctype html><title>Phase 4 Lifecycle UI Tests</title>');
    }
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = 'http://127.0.0.1:' + server.address().port;

  const executable = process.env.PHASE2_BROWSER_PATH || [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/chromium',
    '/usr/bin/google-chrome'
  ].find(candidate => fs.existsSync(candidate));

  if (!executable) {
    throw new Error('Set PHASE2_BROWSER_PATH to a Chromium browser for Phase 4 UI tests.');
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
      window.lifecycleTest?.close();
      window.draftPanelTest?.close();
    });
  }
});

// ==========================================
// 1. STATE DISPLAY TESTS
// ==========================================

test('1.1. Lifecycle state display — Draft badge renders correctly', async () => {
  await page.evaluate(() => mountLifecycleTest({ initialState: 'DRAFT', isAdmin: true }));
  await page.waitForFunction(() => document.body.textContent.includes('Draft'));

  const text = await page.$eval('#test-lifecycle-container', el => el.textContent);
  assert.match(text, /Draft/);
  assert.match(text, /Publish Roster/);
  assert.doesNotMatch(text, /Close Period/);
  assert.doesNotMatch(text, /Reopen Period/);
});

test('1.2. Lifecycle state display — Published badge renders and lock is communicated', async () => {
  await page.evaluate(() => mountLifecycleTest({ initialState: 'PUBLISHED', isAdmin: true }));
  await page.waitForFunction(() => document.body.textContent.includes('Published'));

  const text = await page.$eval('#test-lifecycle-container', el => el.textContent);
  assert.match(text, /Published/);
  assert.match(text, /Close Period/);
  assert.doesNotMatch(text, /Publish Roster/);
  assert.doesNotMatch(text, /Reopen Period/);
  assert.doesNotMatch(text, /Amended/i);
});

test('1.3. Lifecycle state display — Closed badge renders correctly', async () => {
  await page.evaluate(() => mountLifecycleTest({ initialState: 'CLOSED', isAdmin: true }));
  await page.waitForFunction(() => document.body.textContent.includes('Closed'));

  const text = await page.$eval('#test-lifecycle-container', el => el.textContent);
  assert.match(text, /Closed/);
  assert.match(text, /Reopen Period/);
  assert.doesNotMatch(text, /Publish Roster/);
  assert.doesNotMatch(text, /Close Period/);
});

test('1.4. Lifecycle state display — Loading state is displayed during fetch', async () => {
  await page.evaluate(() => mountLifecycleTest({ getPeriodLifecycleDelay: 200 }));
  const initialText = await page.$eval('#test-lifecycle-container', el => el.textContent);
  assert.match(initialText, /Checking lifecycle…/);

  await page.waitForFunction(() => document.body.textContent.includes('Draft'));
  const settledText = await page.$eval('#test-lifecycle-container', el => el.textContent);
  assert.match(settledText, /Draft/);
});

// ==========================================
// 2. PUBLISH ROSTER ACTION TESTS
// ==========================================

test('2.1. Publish Roster — modal terms display, confirm invokes queue.publish, and UI updates to Published', async () => {
  await page.evaluate(() => mountLifecycleTest({ initialState: 'DRAFT', isAdmin: true }));
  await page.waitForFunction(() => document.body.textContent.includes('Publish Roster'));

  // Open Publish Modal
  await clickButton('Publish Roster');
  await page.waitForSelector('[role="dialog"]');

  // Verify modal terms per governing specification
  const modalText = await page.$eval('[role="dialog"]', el => el.textContent);
  assert.match(modalText, /immutable Planned Snapshot/i);
  assert.match(modalText, /Normal draft editing for period 2026-03 will stop/i);
  assert.match(modalText, /flushed and server-confirmed before publication/i);
  assert.match(modalText, /post-publication amendment workflow/i);

  // Enter optional admin note
  await page.type('#publish-admin-note', 'Approved by Clinical Lead');

  // Confirm publication
  await clickButton('Publish Roster', '[role="dialog"]');

  // Wait for modal to close and state to update
  await page.waitForFunction(() => !document.querySelector('[role="dialog"]') && document.body.textContent.includes('Published'));

  // Verify queue method call was logged with note
  const calls = await page.evaluate(() => window.lifecycleTest.callLog.publish);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].period, '2026-03');
  assert.equal(calls[0].opts.adminNote, 'Approved by Clinical Lead');

  // Verify badge updated to Published and Close Period button is now exposed
  const updatedText = await page.$eval('#test-lifecycle-container', el => el.textContent);
  assert.match(updatedText, /Published/);
  assert.match(updatedText, /Close Period/);
});

test('2.2. Publish Roster — prevents duplicate clicks while submitting', async () => {
  await page.evaluate(() => mountLifecycleTest({ initialState: 'DRAFT', isAdmin: true, publishDelay: 300 }));
  await page.waitForFunction(() => document.body.textContent.includes('Publish Roster'));

  await clickButton('Publish Roster');
  await page.waitForSelector('[role="dialog"]');

  // Click confirm
  await clickButton('Publish Roster', '[role="dialog"]');

  // Button should immediately show spinner/disabled
  const disabled = await isButtonDisabled('Publishing…', '[role="dialog"]');
  assert.equal(disabled, true);

  await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
  const calls = await page.evaluate(() => window.lifecycleTest.callLog.publish);
  assert.equal(calls.length, 1);
});

test('2.3. Publish Roster — revision conflict displays useful error without premature state change', async () => {
  await page.evaluate(() => mountLifecycleTest({
    initialState: 'DRAFT',
    isAdmin: true,
    publishError: 'REVISION_CONFLICT'
  }));
  await page.waitForFunction(() => document.body.textContent.includes('Publish Roster'));

  await clickButton('Publish Roster');
  await page.waitForSelector('[role="dialog"]');
  await clickButton('Publish Roster', '[role="dialog"]');

  // Error message rendered inside modal
  await page.waitForSelector('[role="alert"]');
  const errorText = await page.$eval('[role="alert"]', el => el.textContent);
  assert.match(errorText, /updated from another session/i);

  // Period remains Draft
  const mainText = await page.$eval('#test-lifecycle-container', el => el.textContent);
  assert.match(mainText, /Draft/);
  assert.doesNotMatch(mainText, /✓ Published/);
});

test('2.4. Publish Roster — ambiguous outcome leaves period pending without false failure', async () => {
  await page.evaluate(() => mountLifecycleTest({
    initialState: 'DRAFT',
    isAdmin: true,
    publishResult: { ok: true, operationId: 'op-123', status: 'AWAITING_STATUS', pending: true }
  }));
  await page.waitForFunction(() => document.body.textContent.includes('Publish Roster'));

  await clickButton('Publish Roster');
  await page.waitForSelector('[role="dialog"]');
  await clickButton('Publish Roster', '[role="dialog"]');

  // Modal closes
  await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));

  // Should NOT falsely report failed or Published
  const text = await page.$eval('#test-lifecycle-container', el => el.textContent);
  assert.doesNotMatch(text, /Publication Error/);
});

// ==========================================
// 3. PUBLISHED-STATE BEHAVIOR TESTS
// ==========================================

test('3.1. Published state — DraftQueuePanel disables draft editing with locked banner', async () => {
  await page.evaluate(() => mountDraftPanelTest({ lifecycleState: 'PUBLISHED' }));
  await page.waitForSelector('section[aria-label="V2 draft editor"]');
  await page.waitForFunction(() => document.body.textContent.includes('Planned Snapshot is locked'));

  // Lock banner displayed
  const panelText = await page.$eval('section[aria-label="V2 draft editor"]', el => el.textContent);
  assert.match(panelText, /Planned Snapshot is locked/i);

  // Textarea disabled
  const isTextareaDisabled = await page.$eval('textarea', el => el.disabled);
  assert.equal(isTextareaDisabled, true);

  // Save button disabled
  const isSaveBtnDisabled = await isButtonDisabled('Save draft cell');
  assert.equal(isSaveBtnDisabled, true);
});

test('3.2. Published state — no Phase 5 amendment controls exposed', async () => {
  await page.evaluate(() => mountLifecycleTest({ initialState: 'PUBLISHED', isAdmin: true }));
  await page.waitForFunction(() => document.body.textContent.includes('Published'));

  const bodyText = await page.$eval('body', el => el.textContent);
  assert.doesNotMatch(bodyText, /Amend/i);
  assert.doesNotMatch(bodyText, /Phase 5/i);
});

// ==========================================
// 4. CLOSE PERIOD ACTION TESTS
// ==========================================

test('4.1. Close Period — confirmation explains historical lock, invokes queue.close, and transitions to Closed', async () => {
  await page.evaluate(() => mountLifecycleTest({ initialState: 'PUBLISHED', isAdmin: true }));
  await page.waitForFunction(() => document.body.textContent.includes('Close Period'));

  // Open Close Modal
  await clickButton('Close Period');
  await page.waitForSelector('[role="dialog"]');

  // Verify historical lock & server reconciliation terms
  const modalText = await page.$eval('[role="dialog"]', el => el.textContent);
  assert.match(modalText, /historically locked and read-only/i);
  assert.match(modalText, /Authoritative server reconciliation will run upon confirmation/i);

  // Enter admin note
  await page.type('#close-admin-note', 'Final monthly close by Admin');

  // Confirm close
  await clickButton('Close Period', '[role="dialog"]');

  // Wait for state transition to CLOSED
  await page.waitForFunction(() => !document.querySelector('[role="dialog"]') && document.body.textContent.includes('Closed'));

  const calls = await page.evaluate(() => window.lifecycleTest.callLog.close);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].period, '2026-03');
  assert.equal(calls[0].opts.adminNote, 'Final monthly close by Admin');

  const text = await page.$eval('#test-lifecycle-container', el => el.textContent);
  assert.match(text, /Closed/);
  assert.match(text, /Reopen Period/);
});

test('4.2. Close Period — server reconciliation failure blocks close and leaves period Published', async () => {
  await page.evaluate(() => mountLifecycleTest({
    initialState: 'PUBLISHED',
    isAdmin: true,
    closeError: 'RECONCILIATION_FAILED'
  }));
  await page.waitForFunction(() => document.body.textContent.includes('Close Period'));

  await clickButton('Close Period');
  await page.waitForSelector('[role="dialog"]');
  await clickButton('Close Period', '[role="dialog"]');

  // Error message displayed
  await page.waitForSelector('[role="alert"]');
  const errorText = await page.$eval('[role="alert"]', el => el.textContent);
  assert.match(errorText, /Cannot close period: pending or unconfirmed operations remain in the journal/i);

  // Period remains Published
  const mainText = await page.$eval('#test-lifecycle-container', el => el.textContent);
  assert.match(mainText, /Published/);
  assert.doesNotMatch(mainText, /🔒 Closed/);
});

// ==========================================
// 5. REOPEN PERIOD ACTION TESTS
// ==========================================

test('5.1. Reopen Period — rejects blank reason, accepts valid reason, and transitions to Published', async () => {
  await page.evaluate(() => mountLifecycleTest({ initialState: 'CLOSED', isAdmin: true }));
  await page.waitForFunction(() => document.body.textContent.includes('Reopen Period'));

  // Open Reopen Modal
  await clickButton('Reopen Period');
  await page.waitForSelector('[role="dialog"]');

  // Confirm button disabled when reason is empty
  const isReopenDisabled = await isButtonDisabled('Reopen Period', '[role="dialog"]');
  assert.equal(isReopenDisabled, true);

  // Type whitespace only
  await page.type('#reopen-reason', '   ');
  const isStillDisabled = await isButtonDisabled('Reopen Period', '[role="dialog"]');
  assert.equal(isStillDisabled, true);

  // Enter valid trimmed reason
  await page.type('#reopen-reason', 'Approved audit correction by Medical Director');
  const isEnabled = await isButtonDisabled('Reopen Period', '[role="dialog"]');
  assert.equal(isEnabled, false);

  // Confirm reopen
  await clickButton('Reopen Period', '[role="dialog"]');

  // Transitions back to PUBLISHED
  await page.waitForFunction(() => !document.querySelector('[role="dialog"]') && document.body.textContent.includes('Published'));

  const calls = await page.evaluate(() => window.lifecycleTest.callLog.reopen);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].period, '2026-03');
  assert.equal(calls[0].reason, 'Approved audit correction by Medical Director');

  const text = await page.$eval('#test-lifecycle-container', el => el.textContent);
  assert.match(text, /Published/);
  assert.match(text, /Close Period/);
});

// ==========================================
// 6. PENDING OPERATIONS & RECOVERY UX TESTS
// ==========================================

test('6.1. In-flight lifecycle operation renders pending label and suppresses duplicate actions', async () => {
  await page.evaluate(() => mountLifecycleTest({
    initialState: 'DRAFT',
    isAdmin: true,
    initialPendingOp: {
      operationId: 'op-publish-1',
      operationClass: 'LIFECYCLE',
      operationType: 'PERIOD_PUBLISH',
      status: 'AWAITING_STATUS'
    }
  }));

  await page.waitForFunction(() => document.body.textContent.includes('Publishing…'));
  const text = await page.$eval('#test-lifecycle-container', el => el.textContent);
  assert.match(text, /Publishing…/);

  // Action buttons suppressed while op is pending
  assert.doesNotMatch(text, /Publish Roster/);
});

test('6.2. Recovery required op displays recovery badge and Retry / Reconcile button', async () => {
  await page.evaluate(() => mountLifecycleTest({
    initialState: 'DRAFT',
    isAdmin: true,
    initialPendingOp: {
      operationId: 'op-pub-recovery',
      operationClass: 'LIFECYCLE',
      operationType: 'PERIOD_PUBLISH',
      status: 'RECOVERY_REQUIRED'
    }
  }));

  await page.waitForFunction(() => document.body.textContent.includes('Recovery required'));
  const text = await page.$eval('#test-lifecycle-container', el => el.textContent);
  assert.match(text, /Recovery required/);
  assert.match(text, /Retry \/ Reconcile/);

  // Clicking retry calls queue.retry
  await clickButton('Retry / Reconcile');
  const retries = await page.evaluate(() => window.lifecycleTest.callLog.retry);
  assert.equal(retries.length, 1);
  assert.equal(retries[0].opId, 'op-pub-recovery');
});

// ==========================================
// 7. AUTHORIZATION & FEATURE SWITCHES TESTS
// ==========================================

test('7.1. Non-admin users see lifecycle badges but no mutation buttons', async () => {
  await page.evaluate(() => mountLifecycleTest({ initialState: 'DRAFT', isAdmin: false }));
  await page.waitForFunction(() => document.body.textContent.includes('Draft'));

  const text = await page.$eval('#test-lifecycle-container', el => el.textContent);
  assert.match(text, /Draft/);
  assert.doesNotMatch(text, /Publish Roster/);
  assert.doesNotMatch(text, /Close Period/);
  assert.doesNotMatch(text, /Reopen Period/);
});

test('7.2. Feature switches disabled prevents mutation button usage', async () => {
  await page.evaluate(() => mountLifecycleTest({
    initialState: 'DRAFT',
    isAdmin: true,
    settings: { roster_v2_write_enabled: false, write_queue_v2_enabled: false }
  }));
  await page.waitForFunction(() => document.body.textContent.includes('Publish Roster'));

  const disabled = await isButtonDisabled('Publish Roster');
  assert.equal(disabled, true);
});

// ==========================================
// 8. MONTH SWITCH & LEGACY COMPATIBILITY TESTS
// ==========================================

test('8.1. Month switch resets state and resolves target period without leaking previous state', async () => {
  await page.evaluate(() => {
    mountLifecycleTest({ initialPeriod: '2026-03', initialState: 'PUBLISHED', isAdmin: true });
    window.lifecycleTest.periodData.set('2026-04', {
      PeriodId: '2026-04',
      State: 'DRAFT',
      Revision: 1,
      SchemaVersion: 1
    });
  });

  await page.waitForFunction(() => document.body.textContent.includes('Published'));
  assert.match(await page.$eval('#test-lifecycle-container', el => el.textContent), /Published/);

  // Switch to next month
  await page.evaluate(() => window.lifecycleTest.setPeriod('2026-04'));

  // Target month should resolve to Draft
  await page.waitForFunction(() => document.body.textContent.includes('Draft'));
  const text = await page.$eval('#test-lifecycle-container', el => el.textContent);
  assert.match(text, /Draft/);
  assert.match(text, /Publish Roster/);
  assert.doesNotMatch(text, /Close Period/);
});

test('8.2. Unenrolled legacy period renders no V2 lifecycle controls', async () => {
  await page.evaluate(() => mountLifecycleTest({ isEnrolled: false }));
  await new Promise(r => setTimeout(r, 100));

  const text = await page.$eval('body', el => el.textContent.trim());
  assert.equal(text, '');
});
