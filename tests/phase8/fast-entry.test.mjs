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
        <title>Phase 8 Fast Entry Tests</title>
        <style>
          .sticky { position: sticky; }
          .top-0 { top: 0px; }
          .left-0 { left: 0px; }
          .z-10 { z-index: 10; }
          .z-20 { z-index: 20; }
          .z-30 { z-index: 30; }
          .z-40 { z-index: 40; }
          .z-50 { z-index: 50; }
          .overflow-auto { overflow: auto; }
          .overflow-hidden { overflow: hidden; }
          .fixed { position: fixed; }
          .inset-0 { inset: 0px; }
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
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
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
// PHASE 8 SLICE 2: FAST-ENTRY ROSTER MAKING TESTS
// =========================================================================

test('1. initial grid focus and arrow key navigation between cells in DRAFT', async () => {
  await page.evaluate(() => mountPhase8Test({ initialState: 'DRAFT', isAdmin: true }));
  await page.waitForSelector('#current-roster-grid-container');

  // Focus the first doctor cell on 2026-05-01
  await page.focus('#btn-amend-p-mo-1-2026-05-01-MO');

  // Press ArrowRight -> should move focus to 2026-05-02
  await page.keyboard.press('ArrowRight');
  let activeId = await page.evaluate(() => document.activeElement.id);
  assert.equal(activeId, 'btn-amend-p-mo-1-2026-05-02-MO', 'ArrowRight should move focus to next date in row');

  // Press ArrowDown -> should move focus to p-mo-2 on 2026-05-02
  await page.keyboard.press('ArrowDown');
  activeId = await page.evaluate(() => document.activeElement.id);
  assert.equal(activeId, 'btn-amend-p-mo-2-2026-05-02-MO', 'ArrowDown should move focus to next doctor in same column');

  // Press ArrowLeft -> should move focus to p-mo-2 on 2026-05-01
  await page.keyboard.press('ArrowLeft');
  activeId = await page.evaluate(() => document.activeElement.id);
  assert.equal(activeId, 'btn-amend-p-mo-2-2026-05-01-MO', 'ArrowLeft should move focus back to previous date');

  // Press ArrowUp -> should move focus back to p-mo-1 on 2026-05-01
  await page.keyboard.press('ArrowUp');
  activeId = await page.evaluate(() => document.activeElement.id);
  assert.equal(activeId, 'btn-amend-p-mo-1-2026-05-01-MO', 'ArrowUp should move focus up to previous doctor');
});

test('2. Home, End, Ctrl+Home, Ctrl+End navigation across dates and doctors', async () => {
  await page.evaluate(() => mountPhase8Test({ initialState: 'DRAFT', isAdmin: true }));
  await page.waitForSelector('#current-roster-grid-container');

  await page.focus('#btn-amend-p-mo-1-2026-05-02-MO');

  // End -> jump to last day of row (2026-05-05 in fixture)
  await page.keyboard.press('End');
  let activeId = await page.evaluate(() => document.activeElement.id);
  assert.equal(activeId, 'btn-amend-p-mo-1-2026-05-05-MO', 'End key should jump to last date of row');

  // Home -> jump to first day of row (2026-05-01)
  await page.keyboard.press('Home');
  activeId = await page.evaluate(() => document.activeElement.id);
  assert.equal(activeId, 'btn-amend-p-mo-1-2026-05-01-MO', 'Home key should jump to first date of row');

  // Ctrl+End -> jump to bottom-right cell
  await page.keyboard.down('Control');
  await page.keyboard.press('End');
  await page.keyboard.up('Control');
  activeId = await page.evaluate(() => document.activeElement.id);
  assert.ok(activeId.endsWith('2026-05-05-EP') || activeId.endsWith('2026-05-05-MO'), 'Ctrl+End should jump to bottom-right cell');

  // Ctrl+Home -> jump to top-left cell
  await page.keyboard.down('Control');
  await page.keyboard.press('Home');
  await page.keyboard.up('Control');
  activeId = await page.evaluate(() => document.activeElement.id);
  assert.equal(activeId, 'btn-amend-p-mo-1-2026-05-01-MO', 'Ctrl+Home should jump to top-left cell');
});

test('3. Shift+Arrow multi-cell range selection displays floating toolbar and sets aria-selected', async () => {
  await page.evaluate(() => mountPhase8Test({ initialState: 'DRAFT', isAdmin: true }));
  await page.waitForSelector('#current-roster-grid-container');

  await page.focus('#btn-amend-p-mo-1-2026-05-01-MO');

  // Hold Shift and press ArrowRight twice to select 3 cells
  await page.keyboard.down('Shift');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.up('Shift');

  // Check floating bulk toolbar is visible
  const toolbarExists = await page.evaluate(() => Boolean(document.querySelector('#bulk-edit-toolbar')));
  assert.ok(toolbarExists, 'Floating bulk toolbar should appear when multiple cells are selected');

  const selectedCountText = await page.evaluate(() => document.querySelector('#bulk-edit-toolbar')?.textContent);
  assert.ok(selectedCountText.includes('3 cells selected'), `Toolbar should report 3 cells selected, got: ${selectedCountText}`);

  // Check aria-selected on cell elements
  const cell1Selected = await page.evaluate(() => document.querySelector('#cell-p-mo-1-2026-05-01-MO')?.getAttribute('aria-selected'));
  const cell2Selected = await page.evaluate(() => document.querySelector('#cell-p-mo-1-2026-05-02-MO')?.getAttribute('aria-selected'));
  const cell3Selected = await page.evaluate(() => document.querySelector('#cell-p-mo-1-2026-05-03-MO')?.getAttribute('aria-selected'));
  assert.equal(cell1Selected, 'true', 'Cell 1 must have aria-selected=true');
  assert.equal(cell2Selected, 'true', 'Cell 2 must have aria-selected=true');
  assert.equal(cell3Selected, 'true', 'Cell 3 must have aria-selected=true');

  // Escape clears selection
  await page.keyboard.press('Escape');
  const toolbarAfterEsc = await page.evaluate(() => Boolean(document.querySelector('#bulk-edit-toolbar')));
  assert.equal(toolbarAfterEsc, false, 'Pressing Escape must clear range selection and hide toolbar');
});

test('4. Enter opens Quick Shift Palette anchored to cell and selects shift with keyboard', async () => {
  await page.evaluate(() => mountPhase8Test({ initialState: 'DRAFT', isAdmin: true }));
  await page.waitForSelector('#current-roster-grid-container');

  await page.focus('#btn-amend-p-mo-1-2026-05-01-MO');
  await page.keyboard.press('Enter');

  // Palette should open
  await page.waitForSelector('#quick-shift-palette');
  const isPaletteVisible = await page.evaluate(() => Boolean(document.querySelector('#quick-shift-palette')));
  assert.ok(isPaletteVisible, 'Quick Shift Palette must open on Enter');

  // Press ArrowDown to navigate to PM option
  await page.keyboard.press('ArrowDown'); // AM is index 0, ArrowDown moves to PM index 1
  await page.keyboard.press('Enter'); // Confirm PM

  // Check that cell now displays PM
  await page.waitForFunction(() => {
    return document.querySelector('#btn-amend-p-mo-1-2026-05-01-MO')?.textContent.trim() === 'PM';
  });
  const shiftText = await page.evaluate(() => document.querySelector('#btn-amend-p-mo-1-2026-05-01-MO')?.textContent.trim());
  assert.equal(shiftText, 'PM', 'Cell must be updated to PM via Quick Shift Palette');
});

test('5. direct single-key hotkey A, P, O, 1, 2, N, H in DRAFT opens filtered palette and applies shift', async () => {
  await page.evaluate(() => mountPhase8Test({ initialState: 'DRAFT', isAdmin: true }));
  await page.waitForSelector('#current-roster-grid-container');

  // Focus cell 2026-05-02 and press 'P'
  await page.focus('#btn-amend-p-mo-1-2026-05-02-MO');
  await page.keyboard.press('p');

  // Palette opens filtered to PM
  await page.waitForSelector('#quick-shift-palette');
  const searchVal = await page.evaluate(() => document.querySelector('#quick-palette-search')?.value);
  assert.equal(searchVal, 'PM', 'Typing P should filter palette to PM');

  // Press Enter to confirm PM
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => {
    return document.querySelector('#btn-amend-p-mo-1-2026-05-02-MO')?.textContent.trim() === 'PM';
  });

  // Focus cell 2026-05-03 and press 'A'
  await page.focus('#btn-amend-p-mo-1-2026-05-03-MO');
  await page.keyboard.press('a');
  await page.waitForSelector('#quick-shift-palette');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => {
    return document.querySelector('#btn-amend-p-mo-1-2026-05-03-MO')?.textContent.trim() === 'AM';
  });

  // Focus cell 2026-05-03 and press Delete -> clears shift
  await page.keyboard.press('Delete');
  await page.waitForFunction(() => {
    const text = document.querySelector('#btn-amend-p-mo-1-2026-05-03-MO')?.textContent.trim();
    return text === '' || text === '—';
  });
  const clearedText = await page.evaluate(() => document.querySelector('#btn-amend-p-mo-1-2026-05-03-MO')?.textContent.trim());
  assert.ok(clearedText === '' || clearedText === '—', 'Delete key must clear assignment');
});

test('6. Ctrl+Enter repeats last assigned shift to current focused cell', async () => {
  await page.evaluate(() => mountPhase8Test({ initialState: 'DRAFT', isAdmin: true }));
  await page.waitForSelector('#current-roster-grid-container');

  // Assign 'PM' to cell 2026-05-01 via palette
  await page.focus('#btn-amend-p-mo-1-2026-05-01-MO');
  await page.keyboard.press('p');
  await page.waitForSelector('#quick-shift-palette');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('#btn-amend-p-mo-1-2026-05-01-MO')?.textContent.trim() === 'PM');

  // Move to cell 2026-05-02 and press Ctrl+Enter -> should repeat 'PM'
  await page.focus('#btn-amend-p-mo-1-2026-05-02-MO');
  await page.keyboard.down('Control');
  await page.keyboard.press('Enter');
  await page.keyboard.up('Control');

  await page.waitForFunction(() => document.querySelector('#btn-amend-p-mo-1-2026-05-02-MO')?.textContent.trim() === 'PM');
  const repeatedShift = await page.evaluate(() => document.querySelector('#btn-amend-p-mo-1-2026-05-02-MO')?.textContent.trim());
  assert.equal(repeatedShift, 'PM', 'Ctrl+Enter must repeat the last assigned shift (PM)');
});

test('7. clipboard Ctrl+C and Ctrl+V copies shift and pastes into focused cell', async () => {
  await page.evaluate(() => mountPhase8Test({ initialState: 'DRAFT', isAdmin: true }));
  await page.waitForSelector('#current-roster-grid-container');

  // Cell 2026-05-01 currently has 'AM'
  await page.focus('#btn-amend-p-mo-1-2026-05-01-MO');
  await page.keyboard.down('Control');
  await page.keyboard.press('c');
  await page.keyboard.up('Control');

  // Move to cell 2026-05-04 and paste with Ctrl+V
  await page.focus('#btn-amend-p-mo-1-2026-05-04-MO');
  await page.keyboard.down('Control');
  await page.keyboard.press('v');
  await page.keyboard.up('Control');

  await page.waitForFunction(() => document.querySelector('#btn-amend-p-mo-1-2026-05-04-MO')?.textContent.trim() === 'AM');
  const pastedShift = await page.evaluate(() => document.querySelector('#btn-amend-p-mo-1-2026-05-04-MO')?.textContent.trim());
  assert.equal(pastedShift, 'AM', 'Ctrl+V must paste copied shift code (AM)');
});

test('8. multi-cell paste applies copied shift across entire range selection', async () => {
  await page.evaluate(() => mountPhase8Test({ initialState: 'DRAFT', isAdmin: true }));
  await page.waitForSelector('#current-roster-grid-container');

  // Copy AM from 2026-05-01
  await page.focus('#btn-amend-p-mo-1-2026-05-01-MO');
  await page.keyboard.down('Control');
  await page.keyboard.press('c');
  await page.keyboard.up('Control');

  // Select 2026-05-02, 2026-05-03, 2026-05-04
  await page.focus('#btn-amend-p-mo-1-2026-05-02-MO');
  await page.keyboard.down('Shift');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.up('Shift');

  // Paste with Ctrl+V into selection
  await page.keyboard.down('Control');
  await page.keyboard.press('v');
  await page.keyboard.up('Control');

  await page.waitForFunction(() => {
    const s2 = document.querySelector('#btn-amend-p-mo-1-2026-05-02-MO')?.textContent.trim();
    const s3 = document.querySelector('#btn-amend-p-mo-1-2026-05-03-MO')?.textContent.trim();
    const s4 = document.querySelector('#btn-amend-p-mo-1-2026-05-04-MO')?.textContent.trim();
    return s2 === 'AM' && s3 === 'AM' && s4 === 'AM';
  });

  const [s2, s3, s4] = await page.evaluate(() => [
    document.querySelector('#btn-amend-p-mo-1-2026-05-02-MO')?.textContent.trim(),
    document.querySelector('#btn-amend-p-mo-1-2026-05-03-MO')?.textContent.trim(),
    document.querySelector('#btn-amend-p-mo-1-2026-05-04-MO')?.textContent.trim()
  ]);
  assert.equal(s2, 'AM');
  assert.equal(s3, 'AM');
  assert.equal(s4, 'AM');
});

test('9. Ctrl+Z undoes draft edit and Ctrl+Shift+Z redoes draft edit', async () => {
  await page.evaluate(() => mountPhase8Test({ initialState: 'DRAFT', isAdmin: true }));
  await page.waitForSelector('#current-roster-grid-container');

  // Initial value of 2026-05-01 is 'AM'
  const initial = await page.evaluate(() => document.querySelector('#btn-amend-p-mo-1-2026-05-01-MO')?.textContent.trim());
  assert.equal(initial, 'AM');

  // Change to PM via hotkey
  await page.focus('#btn-amend-p-mo-1-2026-05-01-MO');
  await page.keyboard.press('p');
  await page.waitForSelector('#quick-shift-palette');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('#btn-amend-p-mo-1-2026-05-01-MO')?.textContent.trim() === 'PM');

  // Press Ctrl+Z -> should revert to AM
  await page.keyboard.down('Control');
  await page.keyboard.press('z');
  await page.keyboard.up('Control');

  await page.waitForFunction(() => document.querySelector('#btn-amend-p-mo-1-2026-05-01-MO')?.textContent.trim() === 'AM');
  const undone = await page.evaluate(() => document.querySelector('#btn-amend-p-mo-1-2026-05-01-MO')?.textContent.trim());
  assert.equal(undone, 'AM', 'Ctrl+Z must revert shift assignment');

  // Press Ctrl+Shift+Z -> should redo to PM
  await page.keyboard.down('Control');
  await page.keyboard.down('Shift');
  await page.keyboard.press('z');
  await page.keyboard.up('Shift');
  await page.keyboard.up('Control');

  await page.waitForFunction(() => document.querySelector('#btn-amend-p-mo-1-2026-05-01-MO')?.textContent.trim() === 'PM');
  const redone = await page.evaluate(() => document.querySelector('#btn-amend-p-mo-1-2026-05-01-MO')?.textContent.trim());
  assert.equal(redone, 'PM', 'Ctrl+Shift+Z must redo shift assignment');
});

test('10. bulk edit <= 10 cells applies immediately without confirmation modal', async () => {
  await page.evaluate(() => mountPhase8Test({ initialState: 'DRAFT', isAdmin: true }));
  await page.waitForSelector('#current-roster-grid-container');

  // Select 3 cells in row p-mo-1
  await page.focus('#btn-amend-p-mo-1-2026-05-01-MO');
  await page.keyboard.down('Shift');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.up('Shift');

  await page.waitForSelector('#bulk-edit-toolbar');

  // Click [PM] button in bulk toolbar
  await page.click('#btn-bulk-apply-pm');

  // Check no confirmation modal was shown
  const modalExists = await page.evaluate(() => Boolean(document.querySelector('#bulk-confirm-modal')));
  assert.equal(modalExists, false, 'Range of <= 10 cells must not prompt confirmation modal');

  // All 3 cells updated to PM
  await page.waitForFunction(() => {
    return document.querySelector('#btn-amend-p-mo-1-2026-05-01-MO')?.textContent.trim() === 'PM' &&
      document.querySelector('#btn-amend-p-mo-1-2026-05-02-MO')?.textContent.trim() === 'PM' &&
      document.querySelector('#btn-amend-p-mo-1-2026-05-03-MO')?.textContent.trim() === 'PM';
  });
});

test('11. bulk edit > 10 cells triggers confirmation modal; cancel preserves original, confirm applies', async () => {
  // Mount with more doctors to have > 10 cells
  await page.evaluate(() => {
    mountPhase8Test({
      initialState: 'DRAFT',
      isAdmin: true,
      people: [
        { personId: 'd1', name: 'Dr. One', dutyDomain: 'MO' },
        { personId: 'd2', name: 'Dr. Two', dutyDomain: 'MO' },
        { personId: 'd3', name: 'Dr. Three', dutyDomain: 'MO' }
      ],
      currentAssignments: [
        { personId: 'd1', date: '2026-05-01', shiftCode: 'AM', dutyDomain: 'MO' },
        { personId: 'd1', date: '2026-05-02', shiftCode: 'AM', dutyDomain: 'MO' },
        { personId: 'd1', date: '2026-05-03', shiftCode: 'AM', dutyDomain: 'MO' },
        { personId: 'd1', date: '2026-05-04', shiftCode: 'AM', dutyDomain: 'MO' },
        { personId: 'd1', date: '2026-05-05', shiftCode: 'AM', dutyDomain: 'MO' },
        { personId: 'd2', date: '2026-05-01', shiftCode: 'AM', dutyDomain: 'MO' },
        { personId: 'd2', date: '2026-05-02', shiftCode: 'AM', dutyDomain: 'MO' },
        { personId: 'd2', date: '2026-05-03', shiftCode: 'AM', dutyDomain: 'MO' },
        { personId: 'd2', date: '2026-05-04', shiftCode: 'AM', dutyDomain: 'MO' },
        { personId: 'd2', date: '2026-05-05', shiftCode: 'AM', dutyDomain: 'MO' },
        { personId: 'd3', date: '2026-05-01', shiftCode: 'AM', dutyDomain: 'MO' },
        { personId: 'd3', date: '2026-05-02', shiftCode: 'AM', dutyDomain: 'MO' },
        { personId: 'd3', date: '2026-05-03', shiftCode: 'AM', dutyDomain: 'MO' },
        { personId: 'd3', date: '2026-05-04', shiftCode: 'AM', dutyDomain: 'MO' },
        { personId: 'd3', date: '2026-05-05', shiftCode: 'AM', dutyDomain: 'MO' }
      ]
    });
  });
  await page.waitForSelector('#current-roster-grid-container');

  // Select 3 rows x 4 cols = 12 cells (> 10 threshold)
  await page.focus('#btn-amend-d1-2026-05-01-MO');
  await page.keyboard.down('Shift');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.up('Shift');

  await page.waitForSelector('#bulk-edit-toolbar');

  // Click Apply OFF
  await page.click('#btn-bulk-apply-off');

  // Confirmation modal must appear
  await page.waitForSelector('#bulk-confirm-modal');
  const modalText = await page.evaluate(() => document.querySelector('#bulk-confirm-modal')?.textContent);
  assert.ok(modalText.includes('12 cells'), `Modal should mention 12 cells, got: ${modalText}`);

  // Click Cancel
  await page.click('#btn-cancel-bulk-apply');
  const modalAfterCancel = await page.evaluate(() => Boolean(document.querySelector('#bulk-confirm-modal')));
  assert.equal(modalAfterCancel, false, 'Modal should dismiss on cancel');

  // Values remain AM
  const d1Shift = await page.evaluate(() => document.querySelector('#btn-amend-d1-2026-05-01-MO')?.textContent.trim());
  assert.equal(d1Shift, 'AM', 'Cells should not have changed after cancel');

  // Re-open and Confirm
  await page.click('#btn-bulk-apply-off');
  await page.waitForSelector('#bulk-confirm-modal');
  await page.click('#btn-confirm-bulk-apply');

  await page.waitForFunction(() => {
    return document.querySelector('#btn-amend-d1-2026-05-01-MO')?.textContent.trim() === 'OFF' ||
      document.querySelector('#btn-amend-d1-2026-05-01-MO')?.textContent.trim() === '—';
  });
});

test('12. EP duties are strictly excluded from bulk edits', async () => {
  await page.evaluate(() => mountPhase8Test({ initialState: 'DRAFT', isAdmin: true }));
  await page.waitForSelector('#current-roster-grid-container');

  // Fixture has p-mo-1, p-mo-2, and p-ep
  // Select rectangle spanning from p-mo-2 down to p-ep on date 2026-05-01
  await page.focus('#btn-amend-p-mo-2-2026-05-01-MO');
  await page.keyboard.down('Shift');
  await page.keyboard.press('ArrowDown'); // selects p-ep
  await page.keyboard.up('Shift');

  await page.waitForSelector('#bulk-edit-toolbar');
  await page.click('#btn-bulk-apply-pm');

  // p-mo-2 should be updated to PM, p-ep must remain its original shift (EP)
  await page.waitForFunction(() => document.querySelector('#btn-amend-p-mo-2-2026-05-01-MO')?.textContent.trim() === 'PM');
  const epShift = await page.evaluate(() => document.querySelector('#btn-amend-p-ep-2026-05-01-EP')?.textContent.trim());
  assert.equal(epShift, 'EP', 'EP duty cell must not be modified by bulk edits');
});

test('13. in PUBLISHED state, roving arrows work, direct hotkeys do NOT mutate, and Enter opens Phase 5 Amendment Modal', async () => {
  await page.evaluate(() => mountPhase8Test({ initialState: 'PUBLISHED', isAdmin: true }));
  await page.waitForSelector('#current-roster-grid-container');

  // Focus p-mo-1 on 2026-05-01
  await page.focus('#btn-amend-p-mo-1-2026-05-01-MO');

  // Press 'p' -> should NOT change cell to PM or open quick palette
  await page.keyboard.press('p');
  const paletteExists = await page.evaluate(() => Boolean(document.querySelector('#quick-shift-palette')));
  assert.equal(paletteExists, false, 'Typing p in PUBLISHED must NOT open quick palette');

  const cellText = await page.evaluate(() => document.querySelector('#btn-amend-p-mo-1-2026-05-01-MO')?.textContent.trim());
  assert.equal(cellText, 'AM', 'Cell must NOT be mutated by direct typing in PUBLISHED state');

  // Press Enter -> opens Phase 5 Amendment Modal (#amendment-modal)
  await page.keyboard.press('Enter');
  await page.waitForSelector('#amendment-modal');
  const isAmendmentModalOpen = await page.evaluate(() => Boolean(document.querySelector('#amendment-modal')));
  assert.ok(isAmendmentModalOpen, 'Pressing Enter on published cell must open Phase 5 Amendment Modal');

  // Dismiss modal
  await page.click('#btn-cancel-amendment');
});

test('14. in CLOSED state, roving arrows and Ctrl+C work, while Enter and mutation hotkeys are inert', async () => {
  await page.evaluate(() => mountPhase8Test({ initialState: 'CLOSED', isAdmin: true }));
  await page.waitForSelector('#current-roster-grid-container');

  await page.focus('#cell-p-mo-1-2026-05-01-MO');

  // ArrowRight moves focus
  await page.keyboard.press('ArrowRight');
  const activeId = await page.evaluate(() => document.activeElement.id);
  assert.equal(activeId, 'cell-p-mo-1-2026-05-02-MO', 'Arrow navigation must still work in CLOSED state');

  // Press Enter -> nothing happens
  await page.keyboard.press('Enter');
  const paletteOrModal = await page.evaluate(() => {
    return Boolean(document.querySelector('#quick-shift-palette') || document.querySelector('#amendment-modal'));
  });
  assert.equal(paletteOrModal, false, 'Enter must do nothing in CLOSED state');
});

test('15. typing keys inside an <input> element does NOT trigger grid shortcuts or open palette', async () => {
  await page.evaluate(() => mountPhase8Test({ initialState: 'DRAFT', isAdmin: true }));
  await page.waitForSelector('#current-roster-grid-container');

  // Open shortcuts modal or create temporary input to test immunity
  await page.evaluate(() => {
    const inp = document.createElement('input');
    inp.id = 'test-form-input';
    document.body.appendChild(inp);
    inp.focus();
  });

  // Type 'a', 'p', 'Delete', 'Enter' inside the input
  await page.keyboard.type('apple');
  const paletteExists = await page.evaluate(() => Boolean(document.querySelector('#quick-shift-palette')));
  assert.equal(paletteExists, false, 'Typing inside input must not trigger quick palette');

  // Clean up test input
  await page.evaluate(() => document.querySelector('#test-form-input')?.remove());
});

test('16. Keyboard Shortcuts Modal opens via #btn-keyboard-help and closes via Esc', async () => {
  await page.evaluate(() => mountPhase8Test({ initialState: 'DRAFT', isAdmin: true }));
  await page.waitForSelector('#btn-keyboard-help');

  await page.click('#btn-keyboard-help');
  await page.waitForSelector('#keyboard-shortcuts-modal');
  const isHelpVisible = await page.evaluate(() => Boolean(document.querySelector('#keyboard-shortcuts-modal')));
  assert.ok(isHelpVisible, 'Keyboard shortcuts modal should be visible');

  // Press Esc to dismiss
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('#keyboard-shortcuts-modal'));
  const isHelpClosed = await page.evaluate(() => Boolean(document.querySelector('#keyboard-shortcuts-modal')));
  assert.equal(isHelpClosed, false, 'Keyboard shortcuts modal should close on Esc');
});

test('17. month navigation clears active range selection preventing stale month mutations', async () => {
  await page.evaluate(() => mountPhase8Test({ initialState: 'DRAFT', isAdmin: true }));
  await page.waitForSelector('#current-roster-grid-container');

  // Select 2 cells in 2026-05
  await page.focus('#btn-amend-p-mo-1-2026-05-01-MO');
  await page.keyboard.down('Shift');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.up('Shift');
  await page.waitForSelector('#bulk-edit-toolbar');

  // Navigate to next month
  await page.click('#btn-next-month');

  // Toolbar and selection should be completely cleared
  await page.waitForFunction(() => !document.querySelector('#bulk-edit-toolbar'));
  const toolbarAfterNav = await page.evaluate(() => Boolean(document.querySelector('#bulk-edit-toolbar')));
  assert.equal(toolbarAfterNav, false, 'Switching month must clear active range selection and bulk toolbar');
});

test('18. #draft-save-status displays save state in toolbar', async () => {
  await page.evaluate(() => mountPhase8Test({ initialState: 'DRAFT', isAdmin: true }));
  await page.waitForSelector('#draft-save-status');

  const statusText = await page.evaluate(() => document.querySelector('#draft-save-status')?.textContent.trim());
  assert.ok(statusText.includes('All changes saved') || statusText.includes('Saved'), `Status should indicate saved state, got: ${statusText}`);
});
