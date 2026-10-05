import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, harness, currentSource } from './apps-script-harness.mjs';

function createYearlyRoster() {
  return [
    ['Name', 'Date', 'Shift'],
    ['Dr Alice', '2026-01-15', 'AM'],
    ['Dr Bob', '2026-02-14', 'PM'],
    ['Dr Charlie', '2026-03-20', 'NIGHT'],
    ['Dr David', '2026-04-10', 'AM'],
    ['Dr Eve', '2026-05-01', 'OFF'],
    ['Dr Frank', '2026-06-18', 'AM'],
    ['Dr Grace', '2026-07-04', 'PM'],
    ['Dr Heidi', '2026-08-12', 'AM'],
    ['Dr Ivan', '2026-09-25', 'NIGHT'],
    ['Dr Judy', '2026-10-05', 'AM'],
    ['Dr Judy', '2026-10-06', 'PM'],
  ];
}

function getPopulatedRows(grid) {
  return grid.filter(r => r.some(v => v !== '' && v !== null && v !== undefined));
}

function setupHarnessWithRoster(rosterRows = createYearlyRoster()) {
  const tables = structuredClone(fixture.tables);
  tables.MasterRoster = structuredClone(rosterRows);
  // Ensure RosterPeriods does not have V2 enrolled periods interfering with test
  tables.RosterPeriods = [['PeriodId', 'State', 'Status', 'SchemaVersion']];
  return harness(currentSource, { tables });
}

test('1. October update preserves Jan–Sep byte-for-byte', () => {
  const h = setupHarnessWithRoster();
  const janSepBefore = structuredClone(h.grids.MasterRoster.slice(1, 10));
  assert.equal(janSepBefore.length, 9);

  const res = h.post({
    action: 'uploadmasterroster',
    targetMonth: '2026-10',
    rows: [
      { name: 'Dr Judy Updated', date: '2026-10-20', shift: 'PM' }
    ]
  });

  assert.equal(res.result, 'success');
  assert.equal(res.count, 1);

  const populated = getPopulatedRows(h.grids.MasterRoster);

  // Jan–Sep rows preserved byte-for-byte at indices 1 through 9
  assert.deepEqual(populated.slice(1, 10), janSepBefore);

  // Total populated rows: 1 (header) + 9 (Jan-Sep) + 1 (new Oct) = 11
  assert.equal(populated.length, 11);
  assert.deepEqual(populated[10], ['Dr Judy Updated', '2026-10-20', 'PM']);
});

test('2. January update preserves Feb–Oct', () => {
  const h = setupHarnessWithRoster();
  const febOctBefore = structuredClone(h.grids.MasterRoster.slice(2)); // Feb through Oct (10 rows)
  assert.equal(febOctBefore.length, 10);

  const res = h.post({
    action: 'uploadmasterroster',
    targetMonth: '2026-01',
    rows: [
      { name: 'Dr Alice Updated', date: '2026-01-01', shift: 'OFF' }
    ]
  });

  assert.equal(res.result, 'success');
  assert.equal(res.count, 1);

  const populated = getPopulatedRows(h.grids.MasterRoster);

  // Feb–Oct preserved rows appear first in preserved order
  assert.deepEqual(populated.slice(1, 11), febOctBefore);

  // Total populated rows: 1 (header) + 10 (Feb-Oct) + 1 (new Jan) = 12
  assert.equal(populated.length, 12);
  assert.deepEqual(populated[11], ['Dr Alice Updated', '2026-01-01', 'OFF']);
});

test('3. Native Apps Script Date objects preserve other months', () => {
  const roster = createYearlyRoster();
  const marchDate = new Date('2026-03-20T00:00:00.000Z');
  const julyDate = new Date('2026-07-04T00:00:00.000Z');
  roster[3][1] = marchDate; // Dr Charlie (March)
  roster[7][1] = julyDate;  // Dr Grace (July)

  const h = setupHarnessWithRoster(roster);

  const res = h.post({
    action: 'uploadmasterroster',
    targetMonth: '2026-10',
    rows: [{ name: 'Dr Judy Oct', date: '2026-10-15', shift: 'AM' }]
  });

  assert.equal(res.result, 'success');
  // Check that March and July Date objects were preserved as identical Date objects
  assert.ok(h.grids.MasterRoster[3][1] instanceof Date);
  assert.equal(h.grids.MasterRoster[3][1].getTime(), marchDate.getTime());
  assert.ok(h.grids.MasterRoster[7][1] instanceof Date);
  assert.equal(h.grids.MasterRoster[7][1].getTime(), julyDate.getTime());
});

test('4. ISO strings preserve other months', () => {
  const roster = createYearlyRoster();
  const aprIso = '2026-04-10T00:00:00.000Z';
  const augIso = '2026-08-12T08:30:00.000Z';
  roster[4][1] = aprIso; // Dr David (April)
  roster[8][1] = augIso; // Dr Heidi (August)

  const h = setupHarnessWithRoster(roster);

  const res = h.post({
    action: 'uploadmasterroster',
    targetMonth: '2026-10',
    rows: [{ name: 'Dr Judy Oct', date: '2026-10-15', shift: 'AM' }]
  });

  assert.equal(res.result, 'success');
  assert.equal(h.grids.MasterRoster[4][1], aprIso);
  assert.equal(h.grids.MasterRoster[8][1], augIso);
});

test('5. Mixed representations preserve other months', () => {
  const roster = createYearlyRoster();
  roster[1][1] = '2026-01-15'; // Jan: plain string
  roster[2][1] = new Date('2026-02-14T00:00:00.000Z'); // Feb: Date obj
  roster[3][1] = '2026-03-20T12:00:00.000Z'; // Mar: ISO string
  roster[4][1] = '2026-04-10'; // Apr: plain string
  roster[5][1] = new Date('2026-05-01T04:00:00.000Z'); // May: Date obj
  roster[6][1] = '2026-06-18T00:00:00.000Z'; // Jun: ISO string
  roster[7][1] = '2026-07-04'; // Jul: plain string
  roster[8][1] = new Date('2026-08-12T00:00:00.000Z'); // Aug: Date obj
  roster[9][1] = '2026-09-25'; // Sep: plain string

  const h = setupHarnessWithRoster(roster);
  const expectedJanSep = roster.slice(1, 10);

  const res = h.post({
    action: 'uploadmasterroster',
    targetMonth: '2026-10',
    rows: [{ name: 'Dr Judy New', date: '2026-10-01', shift: 'AM' }]
  });

  assert.equal(res.result, 'success');
  for (let i = 0; i < 9; i++) {
    const actual = h.grids.MasterRoster[i + 1];
    const exp = expectedJanSep[i];
    assert.equal(actual[0], exp[0]);
    if (exp[1] instanceof Date) {
      assert.ok(actual[1] instanceof Date);
      assert.equal(actual[1].getTime(), exp[1].getTime());
    } else {
      assert.equal(actual[1], exp[1]);
    }
    assert.equal(actual[2], exp[2]);
  }
});

test('6. Blank/unparseable historical rows are preserved', () => {
  const roster = createYearlyRoster();
  // Insert unparseable row and blank row among historical data
  roster.splice(3, 0, ['Administrative Notice', 'NOT_A_DATE', 'NOTE']);
  roster.splice(6, 0, ['', '', '']);

  const h = setupHarnessWithRoster(roster);

  const res = h.post({
    action: 'uploadmasterroster',
    targetMonth: '2026-10',
    rows: [{ name: 'Dr Judy', date: '2026-10-01', shift: 'AM' }]
  });

  assert.equal(res.result, 'success');
  const foundNotice = h.grids.MasterRoster.find(r => r[0] === 'Administrative Notice');
  assert.ok(foundNotice, 'Administrative Notice should be preserved');
  assert.equal(foundNotice[1], 'NOT_A_DATE');

  const foundBlank = h.grids.MasterRoster.find(r => r[0] === '' && r[1] === '' && r[2] === '');
  assert.ok(foundBlank, 'Blank row should be preserved');
});

test('7. Empty replacement rows remove only target month, not other months', () => {
  const h = setupHarnessWithRoster();
  const janSepBefore = structuredClone(h.grids.MasterRoster.slice(1, 10));

  const res = h.post({
    action: 'uploadmasterroster',
    targetMonth: '2026-10',
    rows: [] // Empty replacement for October
  });

  assert.equal(res.result, 'success');
  assert.equal(res.count, 0);

  const populated = getPopulatedRows(h.grids.MasterRoster);

  // Jan–Sep preserved completely
  assert.deepEqual(populated.slice(1, 10), janSepBefore);

  // Total populated rows is now 1 (header) + 9 (Jan–Sep) = 10 rows. October rows are gone.
  assert.equal(populated.length, 10);
  assert.ok(!populated.some(r => r[1].startsWith('2026-10')));
});

test('8. Missing targetMonth rejects without modifying sheet', () => {
  const h = setupHarnessWithRoster();
  const stateBefore = JSON.stringify(h.grids.MasterRoster);

  const res = h.post({
    action: 'uploadmasterroster',
    rows: [{ name: 'Dr Attacker', date: '2026-10-01', shift: 'AM' }]
  });

  assert.equal(res.result, 'error');
  assert.match(res.message, /targetMonth is required/);

  // No modification to sheet
  assert.equal(JSON.stringify(h.grids.MasterRoster), stateBefore);
  // Zero write operations performed
  assert.equal(h.writes.length, 0);
});

test('9. Malformed targetMonth rejects without modifying sheet', () => {
  const malformedInputs = [
    '2026-1',
    '2026-13',
    '2026-00',
    '2026/10',
    'October-2026',
    '0000-05',
    '2026-10-01',
    'INVALID'
  ];

  for (const badMonth of malformedInputs) {
    const h = setupHarnessWithRoster();
    const stateBefore = JSON.stringify(h.grids.MasterRoster);

    const res = h.post({
      action: 'uploadmasterroster',
      targetMonth: badMonth,
      rows: [{ name: 'Dr Test', date: '2026-10-01', shift: 'AM' }]
    });

    assert.equal(res.result, 'error', `Expected error for targetMonth: ${badMonth}`);
    assert.match(res.message, /Invalid targetMonth format/);
    assert.equal(JSON.stringify(h.grids.MasterRoster), stateBefore);
    assert.equal(h.writes.length, 0);
  }
});

test('10. Simulated failure while reading existing roster causes no clear/write', () => {
  const h = setupHarnessWithRoster();
  const stateBefore = JSON.stringify(h.grids.MasterRoster);

  // Intercept getActiveSpreadsheet to inject reading error on MasterRoster getRange
  const origGetActive = h.context.SpreadsheetApp.getActiveSpreadsheet;
  h.context.SpreadsheetApp.getActiveSpreadsheet = function() {
    const ss = origGetActive();
    const origGetSheet = ss.getSheetByName;
    ss.getSheetByName = function(name) {
      const sh = origGetSheet(name);
      if (name === 'MasterRoster') {
        const origRange = sh.getRange;
        sh.getRange = function(r, c, nr, nc) {
          if (r === 2 && c === 1) {
            throw new Error('Simulated Sheets I/O failure');
          }
          return origRange.apply(this, arguments);
        };
      }
      return sh;
    };
    return ss;
  };

  const res = h.post({
    action: 'uploadmasterroster',
    targetMonth: '2026-10',
    rows: [{ name: 'Dr Test', date: '2026-10-01', shift: 'AM' }]
  });

  assert.equal(res.result, 'error');
  assert.match(res.message, /Failed to read existing MasterRoster rows/);

  // Verify no writes or clears were performed on MasterRoster
  assert.equal(h.writes.filter(w => w.name === 'MasterRoster').length, 0);
  assert.equal(JSON.stringify(h.grids.MasterRoster), stateBefore);
});

test('11. Current frontend October payload produces Jan–Sep + updated October', () => {
  const h = setupHarnessWithRoster();
  const janSepBefore = structuredClone(h.grids.MasterRoster.slice(1, 10));

  // Exact frontend payload format from RosterPage.jsx / App.jsx
  const frontendPayload = {
    action: 'uploadmasterroster',
    targetMonth: '2026-10',
    rows: [
      { name: 'Dr Afif', date: '2026-10-01', shift: 'AM' },
      { name: 'Dr Afif', date: '2026-10-02', shift: 'PM' },
      { name: 'Dr Sarah', date: '2026-10-01', shift: 'PM' }
    ]
  };

  const res = h.post(frontendPayload);
  assert.equal(res.result, 'success');
  assert.equal(res.count, 3);

  const populated = getPopulatedRows(h.grids.MasterRoster);

  // Jan–Sep rows preserved byte-for-byte
  assert.deepEqual(populated.slice(1, 10), janSepBefore);

  // Total populated rows: 1 (header) + 9 (Jan-Sep) + 3 (new Oct) = 13
  assert.equal(populated.length, 13);
  assert.deepEqual(populated.slice(10), [
    ['Dr Afif', '2026-10-01', 'AM'],
    ['Dr Afif', '2026-10-02', 'PM'],
    ['Dr Sarah', '2026-10-01', 'PM']
  ]);
});

test('12. Repeated month-scoped calls remain idempotently safe', () => {
  const h = setupHarnessWithRoster();
  const janSepBefore = structuredClone(h.grids.MasterRoster.slice(1, 10));

  const payloadA = {
    action: 'uploadmasterroster',
    targetMonth: '2026-10',
    rows: [
      { name: 'Dr Afif', date: '2026-10-01', shift: 'AM' },
      { name: 'Dr Afif', date: '2026-10-02', shift: 'PM' }
    ]
  };

  // Call 1
  const res1 = h.post(payloadA);
  assert.equal(res1.result, 'success');
  const stateAfterFirst = JSON.stringify(getPopulatedRows(h.grids.MasterRoster));

  // Call 2 (identical payload)
  const res2 = h.post(payloadA);
  assert.equal(res2.result, 'success');
  const stateAfterSecond = JSON.stringify(getPopulatedRows(h.grids.MasterRoster));

  // Exact idempotency: second call leaves sheet identical to first call
  assert.equal(stateAfterSecond, stateAfterFirst);
  const populated2 = getPopulatedRows(h.grids.MasterRoster);
  assert.deepEqual(populated2.slice(1, 10), janSepBefore);
  assert.equal(populated2.length, 12);

  // Call 3 (new payload B with 1 row)
  const payloadB = {
    action: 'uploadmasterroster',
    targetMonth: '2026-10',
    rows: [
      { name: 'Dr Afif', date: '2026-10-01', shift: 'NIGHT' }
    ]
  };
  const res3 = h.post(payloadB);
  assert.equal(res3.result, 'success');
  const populated3 = getPopulatedRows(h.grids.MasterRoster);
  assert.deepEqual(populated3.slice(1, 10), janSepBefore);
  assert.equal(populated3.length, 11);
  assert.deepEqual(populated3[10], ['Dr Afif', '2026-10-01', 'NIGHT']);
});

test('13. Primary write failure: simulated setValues error causes zero clear and leaves MasterRoster unchanged', () => {
  const h = setupHarnessWithRoster();
  const stateBefore = JSON.stringify(h.grids.MasterRoster);

  // Intercept getActiveSpreadsheet to inject primary setValues error
  const origGetActive = h.context.SpreadsheetApp.getActiveSpreadsheet;
  h.context.SpreadsheetApp.getActiveSpreadsheet = function() {
    const ss = origGetActive();
    const origGetSheet = ss.getSheetByName;
    ss.getSheetByName = function(name) {
      const sh = origGetSheet(name);
      if (name === 'MasterRoster') {
        const origRange = sh.getRange;
        sh.getRange = function(r, c, nr, nc) {
          const rng = origRange.apply(this, arguments);
          rng.setValues = function() {
            throw new Error('Simulated primary setValues write failure');
          };
          return rng;
        };
      }
      return sh;
    };
    return ss;
  };

  const res = h.post({
    action: 'uploadmasterroster',
    targetMonth: '2026-10',
    rows: [{ name: 'Dr Judy New', date: '2026-10-20', shift: 'PM' }]
  });

  assert.equal(res.result, 'error');
  assert.match(res.message, /Simulated primary setValues write failure/);

  // Assert NO clearContent was performed before the failed write
  const clears = h.writes.filter(w => w.name === 'MasterRoster' && w.method === 'clearContent');
  assert.equal(clears.length, 0, 'No clearContent must be called before or during primary write');

  // Assert MasterRoster remains completely unchanged
  assert.equal(JSON.stringify(h.grids.MasterRoster), stateBefore);
});

test('14. Trailing cleanup failure: simulated clearContent error leaves new roster written without historical wipe', () => {
  // Seed a larger roster where old row count > new row count so cleanup is triggered
  const largeRoster = createYearlyRoster(); // 12 rows (header + 9 Jan-Sep + 2 Oct)
  largeRoster.push(['Dr Judy Extra 1', '2026-10-07', 'NIGHT']);
  largeRoster.push(['Dr Judy Extra 2', '2026-10-08', 'AM']); // Now 14 rows (4 Oct rows)

  const h = setupHarnessWithRoster(largeRoster);
  const janSepExpected = largeRoster.slice(1, 10);

  // Intercept trailing clearContent to fail
  const origGetActive = h.context.SpreadsheetApp.getActiveSpreadsheet;
  h.context.SpreadsheetApp.getActiveSpreadsheet = function() {
    const ss = origGetActive();
    const origGetSheet = ss.getSheetByName;
    ss.getSheetByName = function(name) {
      const sh = origGetSheet(name);
      if (name === 'MasterRoster') {
        const origRange = sh.getRange;
        sh.getRange = function(r, c, nr, nc) {
          const rng = origRange.apply(this, arguments);
          rng.clearContent = function() {
            throw new Error('Simulated trailing clearContent failure');
          };
          return rng;
        };
      }
      return sh;
    };
    return ss;
  };

  // Upload 1 October row (new data count = 9 Jan-Sep + 1 Oct = 10 rows. Old was 13 data rows.)
  const res = h.post({
    action: 'uploadmasterroster',
    targetMonth: '2026-10',
    rows: [{ name: 'Dr Judy Replacement', date: '2026-10-25', shift: 'PM' }]
  });

  assert.equal(res.result, 'error');
  assert.match(res.message, /trailing row cleanup failed/);

  // Assert primary write DID execute successfully
  const setValuesWrites = h.writes.filter(w => w.name === 'MasterRoster' && w.method === 'setValues');
  assert.ok(setValuesWrites.length > 0, 'setValues must have executed before cleanup');

  // Assert new validated data is present at rows 2..11
  const rowsInSheet = h.grids.MasterRoster.slice(1, 11);
  assert.deepEqual(rowsInSheet.slice(0, 9), janSepExpected, 'Jan-Sep historical rows must be intact');
  assert.deepEqual(rowsInSheet[9], ['Dr Judy Replacement', '2026-10-25', 'PM'], 'New October row must be written');

  // Only defect is stale trailing rows remaining at rows 12..14, NOT a historical wipe!
  assert.equal(h.grids.MasterRoster.length, 14);
});

test('15. Missing targetMonth fails closed even with allowFullReplacement or authorizeFullReplacement flags', () => {
  for (const flag of [{ allowFullReplacement: true }, { authorizeFullReplacement: true }, {}]) {
    const h = setupHarnessWithRoster();
    const stateBefore = JSON.stringify(h.grids.MasterRoster);

    const res = h.post({
      action: 'uploadmasterroster',
      ...flag,
      rows: [{ name: 'Dr Rogue', date: '2026-10-01', shift: 'AM' }]
    });

    assert.equal(res.result, 'error');
    assert.match(res.message, /targetMonth is required/);
    assert.equal(JSON.stringify(h.grids.MasterRoster), stateBefore);
    assert.equal(h.writes.filter(w => w.name === 'MasterRoster').length, 0);
  }
});

test('16. Malformed new row date rejects and causes zero mutation', () => {
  const h = setupHarnessWithRoster();
  const stateBefore = JSON.stringify(h.grids.MasterRoster);

  const res = h.post({
    action: 'uploadmasterroster',
    targetMonth: '2026-10',
    rows: [
      { name: 'Dr A', date: 'not-a-date', shift: 'AM' }
    ]
  });

  assert.equal(res.result, 'error');
  assert.match(res.message, /does not match targetMonth/);
  assert.equal(JSON.stringify(h.grids.MasterRoster), stateBefore);
  assert.equal(h.writes.filter(w => w.name === 'MasterRoster').length, 0);
});

test('17. Missing row date in new payload rejects and causes zero mutation', () => {
  const h = setupHarnessWithRoster();
  const stateBefore = JSON.stringify(h.grids.MasterRoster);

  const res = h.post({
    action: 'uploadmasterroster',
    targetMonth: '2026-10',
    rows: [
      { name: 'Dr A', date: '', shift: 'AM' }
    ]
  });

  assert.equal(res.result, 'error');
  assert.match(res.message, /Missing date for row/);
  assert.equal(JSON.stringify(h.grids.MasterRoster), stateBefore);
  assert.equal(h.writes.filter(w => w.name === 'MasterRoster').length, 0);
});

test('18. Wrong-month row (October upload with September date) rejects and causes zero mutation', () => {
  const h = setupHarnessWithRoster();
  const stateBefore = JSON.stringify(h.grids.MasterRoster);

  const res = h.post({
    action: 'uploadmasterroster',
    targetMonth: '2026-10',
    rows: [
      { name: 'Dr A', date: '2026-09-15', shift: 'AM' }
    ]
  });

  assert.equal(res.result, 'error');
  assert.match(res.message, /does not match targetMonth/);
  assert.equal(JSON.stringify(h.grids.MasterRoster), stateBefore);
  assert.equal(h.writes.filter(w => w.name === 'MasterRoster').length, 0);
});

test('19. Missing MasterRoster sheet fails closed and does not auto-create replacement sheet', () => {
  const tables = structuredClone(fixture.tables);
  delete tables.MasterRoster;
  tables.RosterPeriods = [['PeriodId', 'State', 'Status', 'SchemaVersion']];
  const h = harness(currentSource, { tables });

  const res = h.post({
    action: 'uploadmasterroster',
    targetMonth: '2026-10',
    rows: [{ name: 'Dr Test', date: '2026-10-01', shift: 'AM' }]
  });

  assert.equal(res.result, 'error');
  assert.match(res.message, /Sheet "MasterRoster" not found/);
  assert.equal(Object.hasOwn(h.grids, 'MasterRoster'), false);
  assert.equal(h.writes.filter(w => w.name === 'MasterRoster').length, 0);
});
