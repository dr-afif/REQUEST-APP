// c:\Dev\REQUEST-APP\src\features\roster\simplified\devMockApi.js
/**
 * Development-Only Mock API Provider for Simplified Roster
 *
 * Guarantees zero network calls to production Google Apps Script / Google Sheets
 * during localhost development and acceptance testing.
 *
 * Provides:
 * 1. Seeded synthetic master roster (MO + EP) for past, current, and future months
 * 2. Pre-seeded amendments for the current month showing Main + Amend composition
 * 3. PIN verification and session issuing with failed-attempt throttling simulation
 * 4. DRAFT mode saving (Main Roster target) with concurrency conflict simulation
 * 5. AMEND mode saving (RosterAmendments target) with conflict / failure simulation
 * 6. Interactive controls to reset mock state, simulate conflict, simulate network failure
 */

const STORAGE_KEY_STORE = 'resq_dev_mock_store_v1';
const STORAGE_KEY_ACTIVE = 'resq_dev_mock';
const STORAGE_KEY_SIM_CONFLICT = 'resq_dev_mock_sim_conflict';
const STORAGE_KEY_SIM_FAILURE = 'resq_dev_mock_sim_failure';
const STORAGE_KEY_PIN_FAILS = 'resq_dev_mock_pin_fails';

const MOCK_TEAM_MEMBERS = [
  { MemberName: 'Person A', FullName: 'Doctor Person A', Active: 'TRUE', StaffId: 'A05157', Role: 'MO' },
  { MemberName: 'Person B', FullName: 'Doctor Person B', Active: 'TRUE', StaffId: 'A05156', Role: 'MO' },
  { MemberName: 'Syuhada', FullName: 'Dr Syuhada', Active: 'TRUE', StaffId: 'A05155', Role: 'MO' },
  { MemberName: 'Dr Faiz', FullName: 'Dr Faiz', Active: 'TRUE', StaffId: 'A05154', Role: 'MO' },
  { MemberName: 'Dr Hanim', FullName: 'Dr Hanim', Active: 'TRUE', StaffId: 'A05153', Role: 'MO' },
  { MemberName: 'Dr Afiq', FullName: 'Dr Afiq', Active: 'TRUE', StaffId: 'A05152', Role: 'MO' },
  { MemberName: 'Dr Nurul', FullName: 'Dr Nurul', Active: 'TRUE', StaffId: 'A05151', Role: 'MO' },
  { MemberName: 'Dr Daniel', FullName: 'Dr Daniel', Active: 'TRUE', StaffId: 'A05150', Role: 'MO' },
  { MemberName: 'Dr Nabil', FullName: 'Dr Nabil', Active: 'TRUE', StaffId: 'A05149', Role: 'MO' },
  { MemberName: 'Dr Sarah', FullName: 'Dr Sarah', Active: 'TRUE', StaffId: 'A05148', Role: 'MO' },
  { MemberName: 'Dr Kelvin', FullName: 'Dr Kelvin', Active: 'TRUE', StaffId: 'A05147', Role: 'MO' },
  { MemberName: 'Dr Zulaikha', FullName: 'Dr Zulaikha', Active: 'TRUE', StaffId: 'A05146', Role: 'MO' },
  { MemberName: 'Dr Amir', FullName: 'Dr Amir', Active: 'TRUE', StaffId: 'A05145', Role: 'MO' },
];

const MOCK_EP_MEMBERS = [
  { MemberName: 'Echo', FullName: 'Dr Echo', Active: 'TRUE', StaffId: 'EP01', Role: 'EP' },
  { MemberName: 'Foxtrot', FullName: 'Dr Foxtrot', Active: 'TRUE', StaffId: 'EP02', Role: 'EP' },
  { MemberName: 'Golf', FullName: 'Dr Golf', Active: 'TRUE', StaffId: 'EP03', Role: 'EP' },
  { MemberName: 'Hotel', FullName: 'Dr Hotel', Active: 'TRUE', StaffId: 'EP04', Role: 'EP' },
  { MemberName: 'India', FullName: 'Dr India', Active: 'TRUE', StaffId: 'EP05', Role: 'EP' },
  { MemberName: 'Juliet', FullName: 'Dr Juliet', Active: 'TRUE', StaffId: 'EP06', Role: 'EP' },
];

function generateMonthMasterRoster(yearMonth, daysInMonth) {
  const rows = [];
  const shiftsCycle = ['AM', 'PM', 'NIGHT', 'STANDBY1', 'STANDBY2', 'OFF', 'GOFF'];

  for (let d = 1; d <= daysInMonth; d++) {
    const dayStr = String(d).padStart(2, '0');
    const date = `${yearMonth}-${dayStr}`;

    // 13 MO assignments
    MOCK_TEAM_MEMBERS.forEach((m, idx) => {
      const shift = shiftsCycle[(d + idx) % shiftsCycle.length];
      if (shift !== 'OFF') {
        rows.push({
          Name: m.MemberName,
          Date: date,
          Shift: shift,
        });
      }
    });

    // EP assignments
    const epOffice = MOCK_EP_MEMBERS[d % MOCK_EP_MEMBERS.length].MemberName;
    const epOncall = MOCK_EP_MEMBERS[(d + 1) % MOCK_EP_MEMBERS.length].MemberName;
    rows.push({ Name: epOffice, Date: date, Shift: 'EP_OFFICE_HOUR' });
    rows.push({ Name: epOncall, Date: date, Shift: 'EP_ONCALL' });
  }
  return rows;
}

function createInitialMockDatabase() {
  const octRows = generateMonthMasterRoster('2026-10', 31);
  const novRows = generateMonthMasterRoster('2026-11', 30);
  const sepRows = generateMonthMasterRoster('2026-09', 30);

  const initialAmendments = [
    {
      amendmentId: 'amend_sample_01',
      date: '2026-10-05',
      targetType: 'MO',
      field: 'MO_SHIFT',
      staffKey: 'A05157',
      staffName: 'Person A',
      previousValue: 'AM',
      newValue: 'PM',
      amendedAt: '2026-10-02T10:00:00.000Z',
      amendedBy: 'admin@pin.local',
    },
    {
      amendmentId: 'amend_sample_02',
      date: '2026-10-12',
      targetType: 'EP',
      field: 'EP_OFFICE_HOUR',
      staffKey: 'EP01',
      staffName: 'Echo',
      previousValue: 'Echo',
      newValue: 'Foxtrot',
      amendedAt: '2026-10-03T11:00:00.000Z',
      amendedBy: 'admin@pin.local',
    },
  ];

  return {
    teamMembers: MOCK_TEAM_MEMBERS,
    emergencyPhysicians: MOCK_EP_MEMBERS,
    masterRoster: [...sepRows, ...octRows, ...novRows],
    rosterAmendments: initialAmendments,
    requests: [],
    shiftBlocks: [],
    shiftTypes: [
      { ShiftType: 'AM', Description: 'Morning' },
      { ShiftType: 'PM', Description: 'Afternoon' },
      { ShiftType: 'NIGHT', Description: 'Night' },
      { ShiftType: 'STANDBY1', Description: 'Standby 1' },
      { ShiftType: 'STANDBY2', Description: 'Standby 2' },
      { ShiftType: 'OFF', Description: 'Day Off' },
      { ShiftType: 'GOFF', Description: 'Golden Off' },
      { ShiftType: 'EP_OFFICE_HOUR', Description: 'EP Office' },
      { ShiftType: 'EP_ONCALL', Description: 'EP On-Call' },
    ],
    limitGroups: [],
    activityHistory: [],
    settings: {
      adminPin: '5707',
      currentRosterMonth: '2026-10',
    },
    publicHolidays: [],
    leaveApplications: [],
  };
}

export function isDevMockActive() {
  if (typeof window === 'undefined') return false;
  // Strictly disabled in production builds
  if (import.meta.env?.PROD) return false;

  try {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('mock') === '1' || urlParams.get('mock') === 'true') {
      return true;
    }
  } catch (_) {}

  try {
    if (window.localStorage?.getItem(STORAGE_KEY_ACTIVE) === 'true') {
      return true;
    }
  } catch (_) {}

  if (import.meta.env?.VITE_MOCK_MODE === 'true') {
    return true;
  }

  return false;
}

export function setDevMockActive(active) {
  if (typeof window === 'undefined') return;
  if (active) {
    window.localStorage?.setItem(STORAGE_KEY_ACTIVE, 'true');
  } else {
    window.localStorage?.removeItem(STORAGE_KEY_ACTIVE);
  }
}

export function getMockStore() {
  if (typeof window === 'undefined') return createInitialMockDatabase();
  try {
    const raw = window.localStorage?.getItem(STORAGE_KEY_STORE);
    if (raw) return JSON.parse(raw);
  } catch (_) {}
  const fresh = createInitialMockDatabase();
  saveMockStore(fresh);
  return fresh;
}

export function saveMockStore(db) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage?.setItem(STORAGE_KEY_STORE, JSON.stringify(db));
  } catch (_) {}
}

export function resetMockStore() {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage?.removeItem(STORAGE_KEY_STORE);
    window.localStorage?.removeItem(STORAGE_KEY_SIM_CONFLICT);
    window.localStorage?.removeItem(STORAGE_KEY_SIM_FAILURE);
    window.localStorage?.removeItem(STORAGE_KEY_PIN_FAILS);
  } catch (_) {}
  const fresh = createInitialMockDatabase();
  saveMockStore(fresh);
  return fresh;
}

export function setSimulateSaveConflict(enabled) {
  if (typeof window === 'undefined') return;
  if (enabled) {
    window.localStorage?.setItem(STORAGE_KEY_SIM_CONFLICT, 'true');
  } else {
    window.localStorage?.removeItem(STORAGE_KEY_SIM_CONFLICT);
  }
}

export function setSimulateSaveFailure(enabled) {
  if (typeof window === 'undefined') return;
  if (enabled) {
    window.localStorage?.setItem(STORAGE_KEY_SIM_FAILURE, 'true');
  } else {
    window.localStorage?.removeItem(STORAGE_KEY_SIM_FAILURE);
  }
}

export function getMockSimulationState() {
  if (typeof window === 'undefined') return { conflict: false, failure: false };
  return {
    conflict: window.localStorage?.getItem(STORAGE_KEY_SIM_CONFLICT) === 'true',
    failure: window.localStorage?.getItem(STORAGE_KEY_SIM_FAILURE) === 'true',
  };
}

export async function handleDevMockRequest({ method = 'GET', body, query = {} } = {}) {
  // Artificial slight network delay (80ms) for realistic UI responsiveness
  await new Promise((r) => setTimeout(r, 80));

  const action = String(
    (query && query.action) ||
    (body && body.action) ||
    ''
  ).trim().toLowerCase();

  const db = getMockStore();
  const simState = getMockSimulationState();

  // 1. GET ALLDATA
  if (action === 'alldata' || (method === 'GET' && !action)) {
    return {
      result: 'success',
      ...db,
    };
  }

  // 2. GET MASTERROSTER
  if (action === 'masterroster') {
    return {
      result: 'success',
      data: db.masterRoster,
    };
  }

  // 3. GET ROSTERAMENDMENTS
  if (action === 'rosteramendments' && method === 'GET') {
    const targetMonth = query?.targetMonth;
    let filtered = db.rosterAmendments;
    if (targetMonth) {
      filtered = filtered.filter((a) => String(a.date || '').startsWith(targetMonth));
    }
    return {
      result: 'success',
      data: filtered,
    };
  }

  // 4. POST VERIFYADMINPIN
  if (action === 'verifyadminpin') {
    const enteredPin = String(body?.pin || body?.adminPin || '').trim();
    const correctPin = String(import.meta.env?.VITE_ADMIN_PIN || '5707').trim();

    let failCount = 0;
    try {
      failCount = parseInt(window.localStorage?.getItem(STORAGE_KEY_PIN_FAILS) || '0', 10);
    } catch (_) {}

    if (failCount >= 5) {
      return {
        result: 'error',
        code: 'PIN_LOCKED',
        message: 'Too many incorrect PIN attempts. Security lockout active for 5 minutes.',
      };
    }

    if (!enteredPin || enteredPin !== correctPin) {
      const nextFail = failCount + 1;
      try {
        window.localStorage?.setItem(STORAGE_KEY_PIN_FAILS, String(nextFail));
      } catch (_) {}
      return {
        result: 'error',
        code: 'INVALID_PIN',
        message: 'Incorrect Security PIN.',
      };
    }

    // Success: reset failures
    try {
      window.localStorage?.removeItem(STORAGE_KEY_PIN_FAILS);
    } catch (_) {}

    return {
      result: 'success',
      verified: true,
      adminSessionToken: 'mock-pin-hmac-session-token-' + Date.now(),
      expiresInSeconds: 28800,
    };
  }

  // 5. POST SAVEMASTERROSTERDRAFT (Target: Main Roster, Future Months Only)
  if (action === 'savemasterrosterdraft') {
    if (simState.failure) {
      throw new Error('Simulated network save failure (500 Server Error).');
    }
    if (simState.conflict) {
      setSimulateSaveConflict(false); // One-shot
      throw new Error('CONFLICT: Master roster was modified by another session. Please reload the roster.');
    }

    const targetMonth = String(body?.targetMonth || '').trim();
    if (!targetMonth || !/^\d{4}-(0[1-9]|1[0-2])$/.test(targetMonth)) {
      throw new Error('Invalid targetMonth for draft save.');
    }

    const incomingRows = Array.isArray(body?.rows) ? body.rows : [];
    // Filter existing master roster: preserve other months, replace target month
    const preserved = db.masterRoster.filter((r) => !String(r.Date || r.date || '').startsWith(targetMonth));
    const normalizedIncoming = incomingRows.map((r) => ({
      Name: r.name || r.Name,
      Date: r.date || r.Date,
      Shift: r.shift || r.Shift,
    }));
    db.masterRoster = [...preserved, ...normalizedIncoming];
    saveMockStore(db);

    return {
      result: 'success',
      mode: 'DRAFT',
      target: 'MAIN',
      targetMonth,
      count: normalizedIncoming.length,
      operationId: body?.operationId || `op_${Date.now()}`,
      savedAt: new Date().toISOString(),
    };
  }

  // 6. POST APPENDROSTERAMENDMENTS (Target: RosterAmendments, Current/Past Months Only)
  if (action === 'appendrosteramendments' || (action === 'rosteramendments' && method === 'POST')) {
    if (simState.failure) {
      throw new Error('Simulated network save failure (500 Server Error).');
    }
    if (simState.conflict) {
      setSimulateSaveConflict(false); // One-shot
      throw new Error('CONFLICT: Concurrent amendment collision detected on server.');
    }

    const targetMonth = String(body?.targetMonth || '').trim();
    const incomingAmendments = Array.isArray(body?.amendments) ? body.amendments : [];
    const formatted = incomingAmendments.map((a, idx) => ({
      amendmentId: a.amendmentId || `amend_${Date.now()}_${idx + 1}`,
      date: a.date,
      targetType: a.targetType || 'MO',
      field: a.field || 'MO_SHIFT',
      staffKey: a.staffKey || '',
      staffName: a.staffName || '',
      previousValue: a.previousValue || '',
      newValue: a.newValue || '',
      amendedAt: new Date().toISOString(),
      amendedBy: 'admin@pin.local',
    }));

    db.rosterAmendments = [...(db.rosterAmendments || []), ...formatted];
    saveMockStore(db);

    return {
      result: 'success',
      mode: 'AMEND',
      target: 'AMENDMENTS',
      targetMonth,
      count: formatted.length,
      operationId: body?.operationId || `op_${Date.now()}`,
      savedAt: new Date().toISOString(),
    };
  }

  // Default passthrough for other read actions
  if (action && db[action]) {
    return {
      result: 'success',
      data: db[action],
    };
  }

  return {
    result: 'success',
    data: [],
  };
}
