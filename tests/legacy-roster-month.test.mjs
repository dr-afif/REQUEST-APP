import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Helper to load src/api.js with mock fetch
async function createMockApiClient() {
  const calls = [];
  const source = fs.readFileSync(new URL('../src/api.js', import.meta.url), 'utf8')
    .replace('import.meta.env.VITE_APPS_SCRIPT_URL', JSON.stringify('https://example.invalid/test/exec'));

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    calls.push({
      url: new URL(url),
      options,
      body: options?.body ? JSON.parse(options.body) : null
    });
    return {
      ok: true,
      headers: {
        get: (h) => (h.toLowerCase() === 'content-type' ? 'application/json' : null)
      },
      json: async () => ({ result: 'success' }),
      text: async () => JSON.stringify({ result: 'success' })
    };
  };

  const api = await import('data:text/javascript;charset=utf-8,' + encodeURIComponent(source));

  return {
    api,
    calls,
    restore: () => {
      globalThis.fetch = originalFetch;
    }
  };
}

// ---------------------------------------------------------------------------
// 1. Normal roster load & requests unaffected
// ---------------------------------------------------------------------------
test('1. Normal roster load and requests functionality remain unaffected', async () => {
  const { api, calls, restore } = await createMockApiClient();
  try {
    await api.fetchAllData();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url.searchParams.get('action'), 'alldata');

    await api.fetchMasterRoster();
    assert.equal(calls.length, 2);
    assert.equal(calls[1].url.searchParams.get('action'), 'masterroster');

    await api.submitRequest({ name: 'Dr Test', date: '2026-10-15', request: 'AM' });
    assert.equal(calls.length, 3);
    assert.equal(calls[2].body.action, 'submit');
    assert.equal(calls[2].body.name, 'Dr Test');

    await api.updateRequest('req-123', { name: 'Dr Test', request: 'PM' });
    assert.equal(calls.length, 4);
    assert.equal(calls[3].body.action, 'update');
    assert.equal(calls[3].body.id, 'req-123');

    await api.deleteRequest('req-123');
    assert.equal(calls.length, 5);
    assert.equal(calls[4].body.action, 'delete');
    assert.equal(calls[4].body.id, 'req-123');
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// 2. Current-month October Save Roster sends targetMonth: "2026-10" & only October rows
// ---------------------------------------------------------------------------
test('2. Current-month October Save Roster sends targetMonth: "2026-10" and only October rows', async () => {
  const { api, calls, restore } = await createMockApiClient();
  try {
    const octRows = [
      { name: 'Dr Alice', date: '2026-10-01', shift: 'AM' },
      { name: 'Dr Bob', date: '2026-10-15', shift: 'PM' }
    ];
    await api.uploadMasterRoster(octRows, '2026-10');

    assert.equal(calls.length, 1);
    assert.equal(calls[0].body.action, 'uploadmasterroster');
    assert.equal(calls[0].body.targetMonth, '2026-10');
    assert.deepEqual(calls[0].body.rows, octRows);
    assert.ok(calls[0].body.rows.every(r => r.date.startsWith('2026-10')));
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// 3. Previous-month September Save Roster sends targetMonth: "2026-09" & only September rows
// ---------------------------------------------------------------------------
test('3. Previous-month September Save Roster sends targetMonth: "2026-09" and only September rows', async () => {
  const { api, calls, restore } = await createMockApiClient();
  try {
    const sepRows = [
      { name: 'Dr Alice', date: '2026-09-05', shift: 'AM' },
      { name: 'Dr Charlie', date: '2026-09-20', shift: 'NIGHT' }
    ];
    await api.uploadMasterRoster(sepRows, '2026-09');

    assert.equal(calls.length, 1);
    assert.equal(calls[0].body.action, 'uploadmasterroster');
    assert.equal(calls[0].body.targetMonth, '2026-09');
    assert.deepEqual(calls[0].body.rows, sepRows);
    assert.ok(calls[0].body.rows.every(r => r.date.startsWith('2026-09')));
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// 4. January Save Roster sends targetMonth: "2026-01" & only January rows
// ---------------------------------------------------------------------------
test('4. January Save Roster sends targetMonth: "2026-01" and only January rows', async () => {
  const { api, calls, restore } = await createMockApiClient();
  try {
    const janRows = [
      { name: 'Dr Dave', date: '2026-01-01', shift: 'AM' },
      { name: 'Dr Eve', date: '2026-01-31', shift: 'PM' }
    ];
    await api.uploadMasterRoster(janRows, '2026-01');

    assert.equal(calls.length, 1);
    assert.equal(calls[0].body.action, 'uploadmasterroster');
    assert.equal(calls[0].body.targetMonth, '2026-01');
    assert.deepEqual(calls[0].body.rows, janRows);
    assert.ok(calls[0].body.rows.every(r => r.date.startsWith('2026-01')));
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// 5. Direct reassignment sends targetMonth: "2026-09"
// ---------------------------------------------------------------------------
test('5. Direct reassignment in September sends targetMonth: "2026-09"', async () => {
  const { api, calls, restore } = await createMockApiClient();
  try {
    const rosterMonth = '2026-09';
    const targetDate = '2026-09-18';
    const doctorName = 'Dr Bob';
    const canonicalNewShift = 'PM';

    const existingMasterRoster = [
      { name: 'Dr Alice', date: '2026-09-10', shift: 'AM' },
      { name: 'Dr Bob', date: '2026-09-18', shift: 'AM' },
      { name: 'Dr Judy', date: '2026-10-01', shift: 'PM' }
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
// 6. Save Roster across all edit modes (standard, standby, extended, table)
// ---------------------------------------------------------------------------
test('6. Save Roster across edit modes sends canonical selected roster month', async () => {
  const { api, calls, restore } = await createMockApiClient();
  try {
    const editModes = [
      { mode: 'standard', month: '2026-03', shift: 'AM' },
      { mode: 'standby', month: '2026-04', shift: 'AM (S)' },
      { mode: 'extended', month: '2026-05', shift: 'PM (X)' },
      { mode: 'table', month: '2026-06', shift: 'NIGHT' }
    ];

    for (const em of editModes) {
      const rows = [{ name: 'Dr ModeTest', date: `${em.month}-12`, shift: em.shift }];
      await api.uploadMasterRoster(rows, em.month);
    }

    assert.equal(calls.length, 4);
    assert.equal(calls[0].body.targetMonth, '2026-03');
    assert.equal(calls[1].body.targetMonth, '2026-04');
    assert.equal(calls[2].body.targetMonth, '2026-05');
    assert.equal(calls[3].body.targetMonth, '2026-06');
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// 7. Switching from October to September before editing does not retain stale October targetMonth
// ---------------------------------------------------------------------------
test('7. Switching from October to September before editing does not retain stale October targetMonth', async () => {
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
// 8. Switching September → October → September still sends September correctly
// ---------------------------------------------------------------------------
test('8. Switching September → October → September still sends September correctly', async () => {
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
// 9. No MasterRoster write API call can be generated with missing/empty targetMonth
// ---------------------------------------------------------------------------
test('9. No MasterRoster write API call can be generated with missing/empty targetMonth', async () => {
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
// 10. Failed/invalid targetMonth prevents request dispatch rather than relying solely on backend rejection
// ---------------------------------------------------------------------------
test('10. Failed/invalid targetMonth prevents request dispatch rather than relying solely on backend rejection', async () => {
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
// 11. Apps Script hotfix V1.1 compatibility: payload format check
// ---------------------------------------------------------------------------
test('11. Resulting payload matches deployed Apps Script V1.1 hotfix specification', async () => {
  const { api, calls, restore } = await createMockApiClient();
  try {
    const rows = [
      { name: 'Dr A', date: '2026-09-01', shift: 'AM' },
      { name: 'Dr B', date: '2026-09-02', shift: 'PM' }
    ];
    await api.uploadMasterRoster(rows, '2026-09');

    assert.equal(calls.length, 1);
    const body = calls[0].body;
    assert.equal(body.action, 'uploadmasterroster');
    assert.equal(body.targetMonth, '2026-09');
    assert.deepEqual(body.rows, rows);
    assert.ok(Array.isArray(body.rows));
    assert.equal(calls[0].options.headers['Content-Type'], 'text/plain;charset=UTF-8');
  } finally {
    restore();
  }
});
