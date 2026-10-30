process.env.VITE_APPS_SCRIPT_URL = 'https://example.invalid/test/exec';

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { harness, currentSource, fixture } from '../phase1/apps-script-harness.mjs';
import * as adminAuth from '../../src/features/roster/auth/adminAuth.js';

const authUrl = new URL('../../src/features/roster/auth/adminAuth.js', import.meta.url).href;
const apiSource = fs.readFileSync(new URL('../../src/api.js', import.meta.url), 'utf8')
  .replace('import.meta.env.VITE_APPS_SCRIPT_URL', JSON.stringify('https://example.invalid/test/exec'))
  .replace('./features/roster/auth/adminAuth.js', authUrl);
const api = await import('data:text/javascript;charset=utf-8,' + encodeURIComponent(apiSource));

const ADMIN_EMAIL = 'admin@example.invalid';
const ATTACKER_EMAIL = 'attacker@example.invalid';
const SESSION_SECRET = 'test-legacy-auth-secret-key-32-bytes-minimum!';

const LEGACY_ADMIN_ACTIONS = [
  { action: 'uploadmasterroster', payload: { rows: [{ name: 'Dr Test', date: '2026-10-01', shift: 'AM' }], targetMonth: '2026-10' } },
  { action: 'updaterequestapproval', payload: { id: 'req-01', approvalStatus: 'Approved' } },
  { action: 'addshiftblock', payload: { date: '2026-10-01', shiftType: 'LEAVES', maxSlots: 2 } },
  { action: 'deleteshiftblock', payload: { id: 'block-01' } },
  { action: 'addshifttype', payload: { name: 'OH', isPublic: false, groupId: '' } },
  { action: 'updateshifttype', payload: { id: 'type-01', name: 'AM', isPublic: true, groupId: '' } },
  { action: 'deleteshifttype', payload: { id: 'type-01' } },
  { action: 'reordershifttypes', payload: { ids: ['type-02', 'type-01'] } },
  { action: 'addlimitgroup', payload: { groupName: 'Synthetic', defaultLimit: 2 } },
  { action: 'updatelimitgroup', payload: { id: 'LEAVES', groupName: 'Leaves & Offs', defaultLimit: 3 } },
  { action: 'deletelimitgroup', payload: { id: 'LEAVES' } },
  { action: 'addactivity', payload: { name: 'Dr Test', date: '2026-10-01', request: 'AM' } },
  { action: 'deleteactivity', payload: { id: 'act-01' } },
  { action: 'updatesetting', payload: { key: 'phTrackerOpeningBalances', value: '{"test": 1}' } },
  { action: 'updateteammembers', payload: { members: [{ name: 'Dr Test', active: true }] } },
  { action: 'updateemergencyphysicians', payload: { members: [{ name: 'Echo', active: true }] } },
  { action: 'upsertpublicholiday', payload: { date: '2030-07-28', name: 'Test Holiday' } },
  { action: 'deletepublicholiday', payload: { date: '2030-07-28' } },
  { action: 'upsertleaveapplication', payload: { id: 'leave-01', memberName: 'Dr Test', leaveType: 'MC', startDate: '2026-10-01', endDate: '2026-10-01' } },
  { action: 'deleteleaveapplication', payload: { id: 'leave-01' } }
];

function forgeHmacToken({ sub = 'admin-sub-123', email = ADMIN_EMAIL, secret = SESSION_SECRET, expOffset = 900 } = {}) {
  const now = Math.floor(Date.parse('2030-09-07T08:00:00.000Z') / 1000);
  const exp = now + expOffset;
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = { v: 1, sub, email, iat: now, exp, jti: crypto.randomUUID() };

  const encode = obj => Buffer.from(JSON.stringify(obj)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const dataToSign = encode(header) + '.' + encode(payload);
  const sig = crypto.createHmac('sha256', secret).update(dataToSign).digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${dataToSign}.${sig}`;
}

test('Legacy Backend Authorization — Suite Preflight', () => {
  assert.equal(LEGACY_ADMIN_ACTIONS.length, 20, 'Must cover exactly 20 legacy administrative actions');
  assert.equal(api.LEGACY_ADMIN_MUTATION_ACTIONS.size, 20, 'Frontend api client must recognize all 20 actions');
});

for (const { action, payload } of LEGACY_ADMIN_ACTIONS) {
  test(`Backend Security Gate — Rejected: [${action}] without token (zero handler calls, zero writes)`, () => {
    const h = harness(currentSource, {
      adminEmail: ADMIN_EMAIL,
      sessionSecret: SESSION_SECRET,
      activeEmail: ''
    });

    const writesBefore = h.writes.length;
    const res = h.post({ action, ...payload });

    assert.equal(res.result, 'error', `Action ${action} must fail when unauthenticated`);
    assert.match(res.message, /V2 administrator authorization required/, `Action ${action} must produce expected auth error`);
    assert.equal(h.writes.length, writesBefore, `Action ${action} must produce zero sheet writes on rejection`);
  });

  test(`Backend Security Gate — Rejected: [${action}] with expired token (zero writes)`, () => {
    const h = harness(currentSource, {
      adminEmail: ADMIN_EMAIL,
      sessionSecret: SESSION_SECRET,
      activeEmail: ''
    });

    const expiredToken = forgeHmacToken({ expOffset: -60 });
    const writesBefore = h.writes.length;
    const res = h.post({ action, adminSessionToken: expiredToken, ...payload });

    assert.equal(res.result, 'error');
    assert.match(res.message, /V2 administrator authorization required/);
    assert.equal(h.writes.length, writesBefore);
  });

  test(`Backend Security Gate — Rejected: [${action}] with tampered token (zero writes)`, () => {
    const h = harness(currentSource, {
      adminEmail: ADMIN_EMAIL,
      sessionSecret: SESSION_SECRET,
      activeEmail: ''
    });

    const validToken = forgeHmacToken();
    const parts = validToken.split('.');
    const tamperedPayload = Buffer.from(JSON.stringify({ v: 1, email: ADMIN_EMAIL, exp: Math.floor(Date.parse('2030-09-07T08:00:00.000Z') / 1000) + 9999 }))
      .toString('base64').replace(/=+$/, '');
    const tamperedToken = `${parts[0]}.${tamperedPayload}.${parts[2]}`;

    const writesBefore = h.writes.length;
    const res = h.post({ action, adminSessionToken: tamperedToken, ...payload });

    assert.equal(res.result, 'error');
    assert.match(res.message, /V2 administrator authorization required/);
    assert.equal(h.writes.length, writesBefore);
  });

  test(`Backend Security Gate — Rejected: [${action}] signed for unauthorized identity [${ATTACKER_EMAIL}]`, () => {
    const h = harness(currentSource, {
      adminEmail: ADMIN_EMAIL,
      sessionSecret: SESSION_SECRET,
      activeEmail: ''
    });

    const unauthorizedToken = forgeHmacToken({ email: ATTACKER_EMAIL });
    const writesBefore = h.writes.length;
    const res = h.post({ action, adminSessionToken: unauthorizedToken, ...payload });

    assert.equal(res.result, 'error');
    assert.match(res.message, /V2 administrator authorization required/);
    assert.equal(h.writes.length, writesBefore);
  });

  test(`Backend Security Gate — Authorized: [${action}] with valid HMAC token dispatches to handler`, () => {
    const h = harness(currentSource, {
      adminEmail: ADMIN_EMAIL,
      sessionSecret: SESSION_SECRET,
      activeEmail: ''
    });

    const validToken = forgeHmacToken();
    const res = h.post({ action, adminSessionToken: validToken, ...payload });

    assert.notEqual(res.message, 'V2 administrator authorization required.', `Valid token must pass auth gate for ${action}`);
    assert.equal(res.result, 'success', `Action ${action} with valid token must succeed`);
  });
}

test('Staff Requests Compatibility — submit, update, delete remain accessible without token', () => {
  const h = harness(currentSource, {
    adminEmail: ADMIN_EMAIL,
    sessionSecret: SESSION_SECRET,
    activeEmail: ''
  });

  const submitRes = h.post({
    action: 'submit',
    name: 'Dr Staff',
    date: '2026-10-15',
    request: 'AM',
    comment: 'Staff request without token'
  });
  assert.equal(submitRes.result, 'success', 'submit must succeed without admin token');

  const updateRes = h.post({
    action: 'update',
    id: 'req-01',
    name: 'Dr Staff',
    date: '2026-10-15',
    request: 'PM'
  });
  assert.equal(updateRes.result, 'success', 'update must succeed without admin token');

  const deleteRes = h.post({
    action: 'delete',
    id: 'req-01'
  });
  assert.equal(deleteRes.result, 'success', 'delete must succeed without admin token');
});

test('Public Reads Compatibility — doGet routes remain accessible without token', () => {
  const h = harness(currentSource, {
    adminEmail: ADMIN_EMAIL,
    sessionSecret: SESSION_SECRET,
    activeEmail: ''
  });

  const readActions = [
    'teammembers',
    'emergencyphysicians',
    'alldata',
    'masterroster',
    'shiftblocks',
    'shifttypes',
    'limitgroups',
    'activityhistory',
    'publicholidays',
    'leaveapplications'
  ];

  for (const readAction of readActions) {
    const res = h.get(readAction);
    assert.notEqual(res?.result, 'error', `GET action ${readAction} must succeed without token`);
  }

  const defaultRequestsRes = h.get('');
  assert.ok(Array.isArray(defaultRequestsRes) || defaultRequestsRes?.requests, 'Default requests read must succeed');

  const schemaRes = h.get('rosterv2schema');
  assert.equal(schemaRes?.schemaVersion, 2, 'Schema read must succeed without token');
});

test('Legacy Upload Guard — Enrolled V2 periods block legacy upload even with valid admin token', () => {
  const tables = structuredClone(fixture.tables);
  tables.RosterPeriods = [
    ['PeriodId', 'State', 'Status', 'SchemaVersion'],
    ['2026-11', 'DRAFT', 'ENROLLED', 2]
  ];

  const h = harness(currentSource, {
    tables,
    adminEmail: ADMIN_EMAIL,
    sessionSecret: SESSION_SECRET,
    activeEmail: ''
  });

  const validToken = forgeHmacToken();
  const res = h.post({
    action: 'uploadmasterroster',
    adminSessionToken: validToken,
    targetMonth: '2026-11',
    rows: [{ name: 'Dr Test', date: '2026-11-01', shift: 'AM' }]
  });

  assert.equal(res.result, 'error');
  assert.match(res.message, /Legacy roster upload is (disabled|blocked)/);
});

test('Reserved Settings Guard — Reserved V2 settings block updates even with valid admin token', () => {
  const h = harness(currentSource, {
    adminEmail: ADMIN_EMAIL,
    sessionSecret: SESSION_SECRET,
    activeEmail: ADMIN_EMAIL
  });

  const validToken = forgeHmacToken();
  const res = h.post({
    action: 'updatesetting',
    adminSessionToken: validToken,
    key: 'roster_v2_write_enabled',
    value: 'true'
  });

  assert.equal(res.result, 'error');
  assert.match(res.message, /configuration writes are disabled in Phase 1/);
});

test('Unknown Mutation Actions — Cannot bypass authorization and fail closed', () => {
  const h = harness(currentSource, {
    adminEmail: ADMIN_EMAIL,
    sessionSecret: SESSION_SECRET,
    activeEmail: ''
  });

  const res = h.post({ action: 'nonexistent_malicious_action' });
  assert.equal(res.result, 'error');
  assert.match(res.message, /Unknown action: nonexistent_malicious_action/);
});

test('Frontend API Client — Privileged mutations fail fast without active admin session', async () => {
  adminAuth.clearAdminSessionToken();

  const originalFetch = globalThis.fetch;
  let fetchCalled = false;
  globalThis.fetch = async () => {
    fetchCalled = true;
    return { ok: true, headers: { get: () => 'application/json' }, json: async () => ({ result: 'success' }) };
  };

  try {
    await assert.rejects(
      async () => api.uploadMasterRoster([{ name: 'X', date: '2026-10-01', shift: 'AM' }], '2026-10'),
      /Administrator session required for this operation/
    );
    await assert.rejects(
      async () => api.updateRequestApproval('req-01', 'Approved'),
      /Administrator session required for this operation/
    );
    await assert.rejects(
      async () => api.submitShiftBlock({ date: '2026-10-01', shiftType: 'LEAVES' }),
      /Administrator session required for this operation/
    );
    await assert.rejects(
      async () => api.deleteShiftBlock('block-01'),
      /Administrator session required for this operation/
    );
    await assert.rejects(
      async () => api.submitShiftType({ name: 'OH' }),
      /Administrator session required for this operation/
    );
    await assert.rejects(
      async () => api.updateShiftType('t1', { name: 'AM' }),
      /Administrator session required for this operation/
    );
    await assert.rejects(
      async () => api.deleteShiftType('t1'),
      /Administrator session required for this operation/
    );
    await assert.rejects(
      async () => api.reorderShiftTypes(['t2', 't1']),
      /Administrator session required for this operation/
    );
    await assert.rejects(
      async () => api.submitLimitGroup({ groupName: 'G1' }),
      /Administrator session required for this operation/
    );
    await assert.rejects(
      async () => api.updateLimitGroup('g1', { groupName: 'G2' }),
      /Administrator session required for this operation/
    );
    await assert.rejects(
      async () => api.deleteLimitGroup('g1'),
      /Administrator session required for this operation/
    );
    await assert.rejects(
      async () => api.submitActivity({ name: 'Dr Test' }),
      /Administrator session required for this operation/
    );
    await assert.rejects(
      async () => api.deleteActivity('act-1'),
      /Administrator session required for this operation/
    );
    await assert.rejects(
      async () => api.updateSetting('theme', 'dark'),
      /Administrator session required for this operation/
    );
    await assert.rejects(
      async () => api.updateTeamMembers([{ name: 'Doc' }]),
      /Administrator session required for this operation/
    );
    await assert.rejects(
      async () => api.updateEmergencyPhysicians([{ name: 'EP' }]),
      /Administrator session required for this operation/
    );
    await assert.rejects(
      async () => api.upsertPublicHoliday({ date: '2026-10-01', name: 'PH' }),
      /Administrator session required for this operation/
    );
    await assert.rejects(
      async () => api.deletePublicHoliday('2026-10-01'),
      /Administrator session required for this operation/
    );
    await assert.rejects(
      async () => api.upsertLeaveApplication({ id: 'l1' }),
      /Administrator session required for this operation/
    );
    await assert.rejects(
      async () => api.deleteLeaveApplication('l1'),
      /Administrator session required for this operation/
    );

    assert.equal(fetchCalled, false, 'No network requests should be made when session token is missing');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Frontend API Client — Attaches adminSessionToken strictly to designated legacy admin mutations', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({
      url: new URL(url),
      method: options.method,
      headers: options.headers,
      body: options.body ? JSON.parse(options.body) : null
    });
    return {
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => ({ result: 'success' })
    };
  };

  const MOCK_TOKEN = 'mock-frontend-admin-session-token-xyz';
  adminAuth.setAdminSessionToken(MOCK_TOKEN, ADMIN_EMAIL, Math.floor(Date.now() / 1000) + 3600);

  try {
    await api.uploadMasterRoster([{ name: 'Dr Sarah', date: '2026-10-01', shift: 'AM' }], '2026-10');
    assert.equal(calls.at(-1).body.adminSessionToken, MOCK_TOKEN);
    assert.equal(calls.at(-1).body.action, 'uploadmasterroster');

    await api.updateRequestApproval('req-01', 'Approved');
    assert.equal(calls.at(-1).body.adminSessionToken, MOCK_TOKEN);
    assert.equal(calls.at(-1).body.action, 'updaterequestapproval');

    await api.submitShiftBlock({ date: '2026-10-01', shiftType: 'LEAVES' });
    assert.equal(calls.at(-1).body.adminSessionToken, MOCK_TOKEN);

    await api.deleteShiftBlock('block-01');
    assert.equal(calls.at(-1).body.adminSessionToken, MOCK_TOKEN);

    await api.submitShiftType({ name: 'OH' });
    assert.equal(calls.at(-1).body.adminSessionToken, MOCK_TOKEN);

    await api.updateShiftType('t1', { name: 'AM' });
    assert.equal(calls.at(-1).body.adminSessionToken, MOCK_TOKEN);

    await api.deleteShiftType('t1');
    assert.equal(calls.at(-1).body.adminSessionToken, MOCK_TOKEN);

    await api.reorderShiftTypes(['t2', 't1']);
    assert.equal(calls.at(-1).body.adminSessionToken, MOCK_TOKEN);

    await api.submitLimitGroup({ groupName: 'G1' });
    assert.equal(calls.at(-1).body.adminSessionToken, MOCK_TOKEN);

    await api.updateLimitGroup('g1', { groupName: 'G2' });
    assert.equal(calls.at(-1).body.adminSessionToken, MOCK_TOKEN);

    await api.deleteLimitGroup('g1');
    assert.equal(calls.at(-1).body.adminSessionToken, MOCK_TOKEN);

    await api.submitActivity({ name: 'Dr Test' });
    assert.equal(calls.at(-1).body.adminSessionToken, MOCK_TOKEN);

    await api.deleteActivity('act-1');
    assert.equal(calls.at(-1).body.adminSessionToken, MOCK_TOKEN);

    await api.updateSetting('theme', 'dark');
    assert.equal(calls.at(-1).body.adminSessionToken, MOCK_TOKEN);

    await api.updateTeamMembers([{ name: 'Doc' }]);
    assert.equal(calls.at(-1).body.adminSessionToken, MOCK_TOKEN);

    await api.updateEmergencyPhysicians([{ name: 'EP' }]);
    assert.equal(calls.at(-1).body.adminSessionToken, MOCK_TOKEN);

    await api.upsertPublicHoliday({ date: '2026-10-01', name: 'PH' });
    assert.equal(calls.at(-1).body.adminSessionToken, MOCK_TOKEN);

    await api.deletePublicHoliday('2026-10-01');
    assert.equal(calls.at(-1).body.adminSessionToken, MOCK_TOKEN);

    await api.upsertLeaveApplication({ id: 'l1' });
    assert.equal(calls.at(-1).body.adminSessionToken, MOCK_TOKEN);

    await api.deleteLeaveApplication('l1');
    assert.equal(calls.at(-1).body.adminSessionToken, MOCK_TOKEN);

    // Verify ordinary staff requests do NOT have adminSessionToken attached
    await api.submitRequest({ name: 'Dr Staff', date: '2026-10-01', request: 'AM' });
    assert.equal(calls.at(-1).body.adminSessionToken, undefined, 'submitRequest must NOT attach admin token');
    assert.equal(calls.at(-1).body.action, 'submit');

    await api.updateRequest('req-01', { request: 'PM' });
    assert.equal(calls.at(-1).body.adminSessionToken, undefined, 'updateRequest must NOT attach admin token');
    assert.equal(calls.at(-1).body.action, 'update');

    await api.deleteRequest('req-01');
    assert.equal(calls.at(-1).body.adminSessionToken, undefined, 'deleteRequest must NOT attach admin token');
    assert.equal(calls.at(-1).body.action, 'delete');

    // Verify public reads do NOT place token in query string or body
    await api.fetchAllData();
    assert.equal(calls.at(-1).url.searchParams.get('adminSessionToken'), null, 'GET must not leak token in query');
    assert.equal(calls.at(-1).body, null);

    await api.fetchTeamMembers();
    assert.equal(calls.at(-1).url.searchParams.get('adminSessionToken'), null);

    await api.fetchEmergencyPhysicians();
    assert.equal(calls.at(-1).url.searchParams.get('adminSessionToken'), null);

    await api.fetchMasterRoster();
    assert.equal(calls.at(-1).url.searchParams.get('adminSessionToken'), null);

    await api.fetchShiftBlocks();
    assert.equal(calls.at(-1).url.searchParams.get('adminSessionToken'), null);

    await api.fetchLeaveApplications();
    assert.equal(calls.at(-1).url.searchParams.get('adminSessionToken'), null);
  } finally {
    adminAuth.clearAdminSessionToken();
    globalThis.fetch = originalFetch;
  }
});
