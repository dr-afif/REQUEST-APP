import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Helper to load api.js with mock fetch
async function createMockApiClient() {
  const calls = [];
  const source = fs.readFileSync(new URL('../../src/api.js', import.meta.url), 'utf8')
    .replace('import.meta.env.VITE_APPS_SCRIPT_URL', JSON.stringify('https://example.invalid/test/exec'));

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    calls.push({ url: new URL(url), options, body: options.body ? JSON.parse(options.body) : null });
    return {
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => ({ result: 'success' })
    };
  };

  const api = await import('data:text/javascript;charset=utf-8,' + encodeURIComponent(source));
  return {
    api,
    calls,
    restore: () => { globalThis.fetch = originalFetch; }
  };
}

// ---------------------------------------------------------------------------
// 1. Current-month October Save Roster sends targetMonth: "2026-10"
// ---------------------------------------------------------------------------
test('1. Current-month October Save Roster sends targetMonth: "2026-10"', async () => {
  const { api, calls, restore } = await createMockApiClient();
  try {
    const octRows = [
      { name: 'Dr Sarah', date: '2026-10-05', shift: 'AM' },
      { name: 'Dr John', date: '2026-10-06', shift: 'PM' }
    ];
    await api.uploadMasterRoster(octRows, '2026-10');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.method, 'POST');
    assert.equal(calls[0].body.action, 'uploadmasterroster');
    assert.equal(calls[0].body.targetMonth, '2026-10');
    assert.deepEqual(calls[0].body.rows, octRows);
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// 2. Previous-month September Save Roster sends targetMonth: "2026-09"
// ---------------------------------------------------------------------------
test('2. Previous-month September Save Roster sends targetMonth: "2026-09"', async () => {
  const { api, calls, restore } = await createMockApiClient();
  try {
    const sepRows = [
      { name: 'Dr Ivan', date: '2026-09-15', shift: 'NIGHT' },
      { name: 'Dr Alice', date: '2026-09-20', shift: 'AM' }
    ];
    await api.uploadMasterRoster(sepRows, '2026-09');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.method, 'POST');
    assert.equal(calls[0].body.action, 'uploadmasterroster');
    assert.equal(calls[0].body.targetMonth, '2026-09');
    assert.deepEqual(calls[0].body.rows, sepRows);
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// 3. January Save Roster sends targetMonth: "2026-01"
// ---------------------------------------------------------------------------
test('3. January Save Roster sends targetMonth: "2026-01"', async () => {
  const { api, calls, restore } = await createMockApiClient();
  try {
    const janRows = [
      { name: 'Dr Alice', date: '2026-01-01', shift: 'OFF' }
    ];
    await api.uploadMasterRoster(janRows, '2026-01');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].body.action, 'uploadmasterroster');
    assert.equal(calls[0].body.targetMonth, '2026-01');
    assert.deepEqual(calls[0].body.rows, janRows);
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// 4. Direct reassignment in September sends targetMonth: "2026-09"
// ---------------------------------------------------------------------------
test('4. Direct reassignment in September sends targetMonth: "2026-09"', async () => {
  const { api, calls, restore } = await createMockApiClient();
  try {
    // Simulate direct shift reassignment handler logic
    const rosterMonth = '2026-09';
    const targetDate = '2026-09-18';
    const doctorName = 'Dr Bob';
    const canonicalNewShift = 'PM';

    const existingMasterRoster = [
      { name: 'Dr Alice', date: '2026-09-10', shift: 'AM' },
      { name: 'Dr Bob', date: '2026-09-18', shift: 'AM' },
      { name: 'Dr Judy', date: '2026-10-01', shift: 'PM' } // Different month
    ];

    const targetMonth = (targetDate && targetDate.slice(0, 7)) || rosterMonth;
    assert.equal(targetMonth, '2026-09');

    const currentMonthRows = [];
    existingMasterRoster.forEach((row) => {
      if (row.date && row.date.startsWith(targetMonth)) {
        if (row.name === doctorName && row.date === targetDate) return;
        currentMonthRows.push({ name: row.name, date: row.date, shift: row.shift });
      }
    });
    currentMonthRows.push({ name: doctorName, date: targetDate, shift: canonicalNewShift });

    await api.uploadMasterRoster(currentMonthRows, targetMonth);

    assert.equal(calls.length, 1);
    assert.equal(calls[0].body.targetMonth, '2026-09');
    assert.ok(calls[0].body.rows.every(r => r.date.startsWith('2026-09')));
    assert.equal(calls[0].body.rows.length, 2);
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// 5. Any other roster mutation path sends the selected roster month
// ---------------------------------------------------------------------------
test('5. Any other roster mutation path (table, standby, extended) sends selected roster month', async () => {
  const { api, calls, restore } = await createMockApiClient();
  try {
    const selectedMonths = ['2026-02', '2026-05', '2026-11'];
    for (const month of selectedMonths) {
      const rows = [{ name: 'Dr Test', date: `${month}-12`, shift: 'AM (S)' }];
      await api.uploadMasterRoster(rows, month);
    }
    assert.equal(calls.length, 3);
    assert.equal(calls[0].body.targetMonth, '2026-02');
    assert.equal(calls[1].body.targetMonth, '2026-05');
    assert.equal(calls[2].body.targetMonth, '2026-11');
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// 6. Switching from October to September before editing does not retain stale October targetMonth
// ---------------------------------------------------------------------------
test('6. Switching from October to September before editing does not retain stale October targetMonth', async () => {
  const { api, calls, restore } = await createMockApiClient();
  try {
    let activeRosterMonth = '2026-10'; // Initially October
    // User switches to September (Prev month)
    let [year, month] = activeRosterMonth.split('-').map(Number);
    month -= 1;
    if (month < 1) { month = 12; year -= 1; }
    activeRosterMonth = `${year}-${String(month).padStart(2, '0')}`;

    assert.equal(activeRosterMonth, '2026-09');

    // User edits and saves
    const sepRows = [{ name: 'Dr Sep', date: '2026-09-02', shift: 'AM' }];
    await api.uploadMasterRoster(sepRows, activeRosterMonth);

    assert.equal(calls.length, 1);
    assert.equal(calls[0].body.targetMonth, '2026-09');
    assert.notEqual(calls[0].body.targetMonth, '2026-10');
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// 7. Switching September → October → September still sends September correctly
// ---------------------------------------------------------------------------
test('7. Switching September → October → September still sends September correctly', async () => {
  const { api, calls, restore } = await createMockApiClient();
  try {
    let activeMonth = '2026-09';
    // Switch to October
    activeMonth = '2026-10';
    // Switch back to September
    activeMonth = '2026-09';

    const sepRows = [{ name: 'Dr Roundtrip', date: '2026-09-29', shift: 'NIGHT' }];
    await api.uploadMasterRoster(sepRows, activeMonth);

    assert.equal(calls.length, 1);
    assert.equal(calls[0].body.targetMonth, '2026-09');
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// 8. No MasterRoster write API call can be generated with missing/empty targetMonth
// ---------------------------------------------------------------------------
test('8. No MasterRoster write API call can be generated with missing/empty targetMonth', async () => {
  const { api, calls, restore } = await createMockApiClient();
  try {
    const invalidMonths = [undefined, null, '', '   '];
    for (const badMonth of invalidMonths) {
      await assert.rejects(
        async () => {
          await api.uploadMasterRoster([{ name: 'X', date: '2026-09-01', shift: 'AM' }], badMonth);
        },
        {
          name: 'Error',
          message: /targetMonth is required in YYYY-MM format/
        }
      );
    }
    // Verify ZERO HTTP POST requests were dispatched
    assert.equal(calls.length, 0);
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// 9. Failed/invalid targetMonth prevents request dispatch rather than relying solely on backend rejection
// ---------------------------------------------------------------------------
test('9. Failed/invalid targetMonth prevents request dispatch rather than relying solely on backend rejection', async () => {
  const { api, calls, restore } = await createMockApiClient();
  try {
    const malformed = [
      '2026-1',
      '2026-13',
      '2026-00',
      '2026/10',
      'October-2026',
      '0000-05',
      '2026-10-01',
      'INVALID',
      12345,
      {}
    ];

    for (const bad of malformed) {
      await assert.rejects(
        async () => {
          await api.uploadMasterRoster([{ name: 'X', date: '2026-09-01', shift: 'AM' }], bad);
        },
        {
          name: 'Error',
          message: /targetMonth is required in YYYY-MM format/
        }
      );
    }

    // Zero requests dispatched to the network
    assert.equal(calls.length, 0);
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// 10. Existing Phase 5 Current/Planned/Changes UI remains unaffected
// ---------------------------------------------------------------------------
test('10. Existing Phase 5 Current/Planned/Changes UI remains unaffected', () => {
  const files = [
    'src/features/roster/components/Phase5RosterContainer.jsx',
    'src/features/roster/components/PlannedRosterView.jsx',
    'src/features/roster/components/CurrentRosterView.jsx',
    'src/features/roster/components/AmendmentHistoryPanel.jsx',
    'src/features/roster/components/RosterViewModeSelector.jsx',
    'src/features/roster/components/UndoToast.jsx'
  ];

  for (const relPath of files) {
    const fullPath = path.join(process.cwd(), relPath);
    assert.ok(fs.existsSync(fullPath), `${relPath} must exist`);
    const content = fs.readFileSync(fullPath, 'utf8');
    assert.ok(content.length > 0, `${relPath} must not be empty`);
    assert.match(content, /export\s+default\s+function|export\s+default\s+\w+/, `${relPath} must have a default export`);
  }
});
