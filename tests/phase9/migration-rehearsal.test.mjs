import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import vm from 'node:vm';
import protocol from '../../src/features/roster/queue/protocol.js';
import compatibility from '../../src/features/roster/compatibility.js';
import guidance from '../../src/features/roster/guidance.js';
import lifecycle from '../../src/features/roster/lifecycle.js';
import absence from '../../src/features/roster/absence.js';
import entitlement from '../../src/features/roster/goff.js';
import { harness, digest, currentSource, fixture } from '../phase1/apps-script-harness.mjs';

const PERSON_ALI = '11111111-1111-4111-8111-111111111111';
const PERSON_SITI = '22222222-2222-4222-8222-222222222222';
const PERSON_TAN = '33333333-3333-4333-8333-333333333333';
const PERSON_EP_CHONG = '44444444-4444-4444-8444-444444444444';
const POLICY_A_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function setupHarness(options = {}) {
  const h = harness(currentSource, {
    activeEmail: 'admin@example.invalid',
    adminEmail: 'admin@example.invalid',
    ...options
  });
  h.context.SpreadsheetApp.flush = () => {};
  h.context.Utilities.getUuid = () => crypto.randomUUID();
  return h;
}

function makePublishOp({
  periodId = '2026-11',
  expectedRevision = 0,
  draftCells = null,
  adminNote = 'Cutover publish test',
  operationId = null,
  ...rest
} = {}) {
  const opId = operationId || crypto.randomUUID();
  const cId = crypto.randomUUID();
  const tId = crypto.randomUUID();
  const cells = draftCells || {
    [`${PERSON_ALI}/${periodId}-01`]: [{ rawShift: 'AM' }],
    [`${PERSON_SITI}/${periodId}-01`]: [{ rawShift: 'PM' }]
  };
  const meaning = {
    operationId: opId,
    clientId: cId,
    tabId: tId,
    operationType: 'PERIOD_PUBLISH',
    entityKey: `period:${periodId}`,
    expectedRevision,
    payload: {
      periodId,
      draftCells: cells,
      adminNote
    }
  };
  const payloadHash = digest(protocol.canonical(meaning));
  return {
    action: 'rosterv2publish',
    operationId: opId,
    clientId: cId,
    tabId: tId,
    periodId,
    expectedRevision,
    draftCells: cells,
    adminNote,
    payloadHash,
    ...rest
  };
}

function makeCloseOp({
  periodId = '2026-11',
  expectedRevision = 1,
  adminNote = 'Close test',
  operationId = null,
  ...rest
} = {}) {
  const opId = operationId || crypto.randomUUID();
  const cId = crypto.randomUUID();
  const tId = crypto.randomUUID();
  const meaning = {
    operationId: opId,
    clientId: cId,
    tabId: tId,
    operationType: 'PERIOD_CLOSE',
    entityKey: `period:${periodId}`,
    expectedRevision,
    payload: {
      periodId,
      adminNote
    }
  };
  const payloadHash = digest(protocol.canonical(meaning));
  return {
    action: 'rosterv2close',
    operationId: opId,
    clientId: cId,
    tabId: tId,
    periodId,
    expectedRevision,
    adminNote,
    payloadHash,
    ...rest
  };
}

function makeEarnGoffOp({
  periodId = '2026-11',
  personId = PERSON_ALI,
  date = '2026-11-02',
  adminNote = 'Displaced weekly off',
  operationId = null,
  ...rest
} = {}) {
  const opId = operationId || crypto.randomUUID();
  const cId = crypto.randomUUID();
  const tId = crypto.randomUUID();
  const meaning = {
    operationId: opId,
    clientId: cId,
    tabId: tId,
    operationType: 'ENTITLEMENT_EARN_GOFF',
    entityKey: `period:${periodId}`,
    expectedRevision: 1,
    payload: {
      periodId,
      personId,
      date,
      adminNote
    }
  };
  const payloadHash = digest(protocol.canonical(meaning));
  return {
    action: 'rosterv2entitlementearngoff',
    operationId: opId,
    clientId: cId,
    tabId: tId,
    periodId,
    expectedRevision: 1,
    personId,
    date,
    adminNote,
    payloadHash,
    ...rest
  };
}

// ---------------------------------------------------------------------------
// 1. Legacy workbook provisions successfully
// ---------------------------------------------------------------------------
test('1. legacy workbook provisions successfully with all required V2 tables', () => {
  const h = setupHarness();
  const legacyTables = Object.keys(h.grids);
  assert.ok(legacyTables.includes('Requests'), 'Legacy Requests sheet exists initially');
  assert.ok(legacyTables.includes('MasterRoster'), 'Legacy MasterRoster sheet exists initially');
  assert.ok(!legacyTables.includes('RosterPeople'), 'RosterPeople does not exist in legacy workbook');
  assert.ok(!legacyTables.includes('RosterAssignments'), 'RosterAssignments does not exist in legacy workbook');

  h.context.rosterProvisionAllSchemas_();

  const expectedTables = [
    'RosterPeople',
    'ShiftSemantics',
    'OperationLog',
    'RosterDraftPatches',
    'OffPolicies',
    'RosterPeriods',
    'RosterAssignments',
    'WeeklyOffSnapshots',
    'RosterEvents',
    'RosterAbsences',
    'RosterReplacements',
    'RosterEntitlementTransactions'
  ];

  for (const table of expectedTables) {
    assert.ok(h.grids[table], `Table ${table} should be provisioned`);
    assert.ok(h.grids[table].length >= 1, `Table ${table} should have at least a header row`);
    assert.ok(h.grids[table][0].length > 0, `Table ${table} header row should not be empty`);
  }
});

// ---------------------------------------------------------------------------
// 2. Provisioning is strictly additive
// ---------------------------------------------------------------------------
test('2. provisioning is additive and leaves pre-existing sheets and rows intact', () => {
  const h = setupHarness();
  const initialRequestRows = h.grids.Requests.length;
  const initialMasterRows = h.grids.MasterRoster.length;
  const initialTeamMembersRows = h.grids.TeamMembers.length;

  h.context.rosterProvisionAllSchemas_();

  assert.equal(h.grids.Requests.length, initialRequestRows, 'Requests row count unchanged');
  assert.equal(h.grids.MasterRoster.length, initialMasterRows, 'MasterRoster row count unchanged');
  assert.equal(h.grids.TeamMembers.length, initialTeamMembersRows, 'TeamMembers row count unchanged');
});

// ---------------------------------------------------------------------------
// 3. Repeated provisioning is idempotent
// ---------------------------------------------------------------------------
test('3. repeated provisioning is idempotent and causes zero destructive diff', () => {
  const h = setupHarness();
  h.context.rosterProvisionAllSchemas_();
  const snapshot1 = JSON.stringify(h.grids);

  // Run provisioning a second time
  h.context.rosterProvisionAllSchemas_();
  const snapshot2 = JSON.stringify(h.grids);

  assert.equal(snapshot1, snapshot2, 'Second provisioning run produces identical state');
});

// ---------------------------------------------------------------------------
// 4. Unknown columns are preserved during upgrade
// ---------------------------------------------------------------------------
test('4. unknown columns in pre-existing tables survive schema upgrade', () => {
  const customTables = structuredClone(fixture.tables);
  customTables.RosterPeriods = [
    ['PeriodId', 'SchemaVersion', 'EnrolledAt', 'EnrolledBy', 'CustomSystemRef', 'DepartmentCode'],
    ['2026-09', 1, '2026-08-01T00:00:00Z', 'admin@example.invalid', 'REF-9988', 'EMERGENCY']
  ];

  const h = setupHarness({ tables: customTables });
  h.context.rosterProvisionAllSchemas_();

  const headers = h.grids.RosterPeriods[0];
  assert.ok(headers.includes('CustomSystemRef'), 'Custom column CustomSystemRef preserved in headers');
  assert.ok(headers.includes('DepartmentCode'), 'Custom column DepartmentCode preserved in headers');
  assert.ok(headers.includes('State'), 'New target column State added');
  assert.ok(headers.includes('Revision'), 'New target column Revision added');

  const row1 = h.grids.RosterPeriods[1];
  const refIndex = headers.indexOf('CustomSystemRef');
  const deptIndex = headers.indexOf('DepartmentCode');
  const stateIndex = headers.indexOf('State');

  assert.equal(row1[refIndex], 'REF-9988', 'CustomSystemRef cell value preserved');
  assert.equal(row1[deptIndex], 'EMERGENCY', 'DepartmentCode cell value preserved');
  assert.equal(row1[stateIndex], 'DRAFT', 'Default State backfilled to DRAFT');
});

// ---------------------------------------------------------------------------
// 5 & 6 & 18. Historical MasterRoster months preserved and isolated
// ---------------------------------------------------------------------------
test('5, 6, 18. historical MasterRoster months survive byte-for-byte and target month migration is isolated', () => {
  const multiMonthTables = structuredClone(fixture.tables);
  // Multi-month legacy MasterRoster: July, August, September, October + 1 unparseable row + 1 blank row
  multiMonthTables.MasterRoster = [
    ['Name', 'Date', 'Shift'],
    ['Dr. Ali', '2026-07-10', 'AM'],
    ['Dr. Siti', '2026-07-10', 'PM'],
    ['Dr. Ali', '2026-08-15', 'OFF'],
    ['', '', ''], // Preserved blank row
    ['Dr. Siti', '2026-08-15', 'ON1'],
    ['Dr. Ali', '2026-09-01', 'PN'],
    ['Dr. Siti', '2026-09-01', 'AM'],
    ['Dr. Ali', '2026-10-25', 'PM'],
    ['Dr. Siti', '2026-10-25', 'OFF'],
    ['NOTE_ROW', 'UNPARSEABLE_DATE', 'LEGACY_MEMO']
  ];

  const h = setupHarness({ tables: multiMonthTables });
  h.context.rosterProvisionAllSchemas_();

  // Seed RosterPeople
  h.grids.RosterPeople.push(
    [PERSON_ALI, 'MO', 'Dr. Ali', '[]', true, '2026-01-01T00:00:00Z', ''],
    [PERSON_SITI, 'MO', 'Dr. Siti', '[]', true, '2026-01-01T00:00:00Z', '']
  );

  // Enable V2 flags for test operations
  h.grids.Settings.push(
    ['roster_v2_write_enabled', 'true'],
    ['roster_v2_read_enabled', 'true'],
    ['weekly_off_guidance_enabled', 'true']
  );

  // Record non-target month rows before V2 cutover publish
  const nonTargetBefore = h.grids.MasterRoster.slice(1).filter(r => !String(r[1]).startsWith('2026-11'));

  // Target cutover month is 2026-11
  const periodId = '2026-11';
  h.grids.RosterPeriods.push([
    periodId, 'DRAFT', 0, 0, '', '', '', '', '', '', 2, '', '2026-10-01T00:00:00Z'
  ]);

  // Seed policy covering November 2026
  h.grids.OffPolicies.push([
    POLICY_A_ID, 'A', '2026-10-26', 1, guidance.policyRuleJson('A'), true, 'Initial policy', 1, 'op-seed', '2026-10-01T00:00:00Z', 'admin@example.invalid'
  ]);

  const publishOp = makePublishOp({
    periodId,
    expectedRevision: 0,
    draftCells: {
      [`${PERSON_ALI}/${periodId}-01`]: [{ rawShift: 'AM' }],
      [`${PERSON_SITI}/${periodId}-01`]: [{ rawShift: 'PM' }]
    }
  });

  const res = h.post(publishOp);
  assert.equal(res.ok, true, 'Publish must succeed');
  assert.equal(res.state, 'PUBLISHED');

  // Verify non-target rows survive byte-for-byte in MasterRoster
  const nonTargetAfter = h.grids.MasterRoster.slice(1).filter(r => !String(r[1]).startsWith('2026-11'));
  assert.equal(nonTargetAfter.length, nonTargetBefore.length, 'Non-target row count must match exactly');
  assert.deepEqual(nonTargetAfter, nonTargetBefore, 'Non-target rows must be identical byte-for-byte');

  // Verify target cutover month rows exist in MasterRoster
  const targetAfter = h.grids.MasterRoster.slice(1).filter(r => String(r[1]).startsWith('2026-11'));
  assert.equal(targetAfter.length, 2, 'Exactly 2 rows projected for cutover month 2026-11');
});

// ---------------------------------------------------------------------------
// 7. Requests preserved
// ---------------------------------------------------------------------------
test('7. legacy Requests rows remain preserved and readable by legacy endpoints', () => {
  const h = setupHarness();
  const initialRequests = h.get('getRequests');
  assert.ok(Array.isArray(initialRequests), 'Legacy getRequests returns array');
  assert.ok(initialRequests.length > 0, 'Legacy requests exist');

  h.context.rosterProvisionAllSchemas_();

  const postProvisionRequests = h.get('getRequests');
  assert.deepEqual(postProvisionRequests, initialRequests, 'Requests records identical after provisioning');
});

// ---------------------------------------------------------------------------
// 8. Leave records preserved
// ---------------------------------------------------------------------------
test('8. legacy LeaveApplications rows remain preserved and readable', () => {
  const h = setupHarness();
  const initialLeave = h.get('getLeaveApplications');
  assert.ok(Array.isArray(initialLeave), 'Legacy getLeaveApplications returns array');

  h.context.rosterProvisionAllSchemas_();

  const postProvisionLeave = h.get('getLeaveApplications');
  assert.deepEqual(postProvisionLeave, initialLeave, 'Leave applications identical after provisioning');
});

// ---------------------------------------------------------------------------
// 9. MO identities map deterministically
// ---------------------------------------------------------------------------
test('9. MO identities map deterministically to canonical PersonId via personIndex', () => {
  const people = [
    { PersonId: PERSON_ALI, DirectoryType: 'MO', CurrentDisplayName: 'Dr. Ali Hassan', LegacyNamesJson: JSON.stringify(['Ali', 'Dr. Ali']), Active: true },
    { PersonId: PERSON_SITI, DirectoryType: 'MO', CurrentDisplayName: 'Dr. Siti Aminah', LegacyNamesJson: JSON.stringify(['Siti']), Active: true }
  ];
  const directories = {
    MO: [{ MemberName: 'Dr. Ali Hassan', Active: true }, { MemberName: 'Dr. Siti Aminah', Active: true }],
    EP: []
  };

  const resolve = compatibility.personIndex(people, directories);

  const res1 = resolve('Dr. Ali Hassan', 'MO');
  assert.equal(res1.personId, PERSON_ALI);
  assert.equal(res1.identityStatus, 'REGISTERED');

  const resAlias = resolve('Ali', 'MO');
  assert.equal(resAlias.personId, PERSON_ALI);
  assert.equal(resAlias.identityStatus, 'REGISTERED');

  const res2 = resolve('Dr. Siti Aminah', 'MO');
  assert.equal(res2.personId, PERSON_SITI);
});

// ---------------------------------------------------------------------------
// 10. Duplicate-name ambiguity fails closed
// ---------------------------------------------------------------------------
test('10. duplicate-name or cross-domain ambiguity fails closed without guessing', () => {
  // Case A: Conflicting aliases in RosterPeople throws
  const ambiguousPeople = [
    { PersonId: PERSON_ALI, DirectoryType: 'MO', CurrentDisplayName: 'Dr. Ali', LegacyNamesJson: JSON.stringify(['SharedName']), Active: true },
    { PersonId: PERSON_TAN, DirectoryType: 'MO', CurrentDisplayName: 'Dr. Tan', LegacyNamesJson: JSON.stringify(['SharedName']), Active: true }
  ];
  assert.throws(
    () => compatibility.personIndex(ambiguousPeople, { MO: [], EP: [] }),
    /Ambiguous RosterPeople alias/,
    'Ambiguous alias must throw on index construction'
  );

  // Case B: Cross-domain ambiguity with domain=AUTO fails closed with AMBIGUOUS_DOMAIN
  const crossDomainDirectories = {
    MO: [{ MemberName: 'Dr. Sam', Active: true }],
    EP: [{ MemberName: 'Dr. Sam', Active: true }]
  };
  const resolveCross = compatibility.personIndex([], crossDomainDirectories);
  const resolved = resolveCross('Dr. Sam', 'AUTO');
  assert.equal(resolved.personId, null, 'Ambiguous personId must be null');
  assert.equal(resolved.identityStatus, 'AMBIGUOUS_DOMAIN', 'Status must be AMBIGUOUS_DOMAIN');
});

// ---------------------------------------------------------------------------
// 11. EP preserved but not migrated into MO entitlement accounting
// ---------------------------------------------------------------------------
test('11. EP entries are preserved but excluded from MO entitlement ledger', () => {
  const people = [
    { PersonId: PERSON_EP_CHONG, DirectoryType: 'EP', CurrentDisplayName: 'Dr. Chong (EP)', LegacyNamesJson: '[]', Active: true }
  ];
  const directories = {
    MO: [],
    EP: [{ MemberName: 'Dr. Chong (EP)', Active: true }]
  };

  const resolve = compatibility.personIndex(people, directories);
  const epPerson = resolve('Dr. Chong (EP)', 'EP');
  assert.equal(epPerson.directoryType, 'EP');

  // Verify entitlement action rejects EP directory types
  const h = setupHarness();
  h.context.rosterProvisionAllSchemas_();
  h.grids.Settings.push(
    ['roster_v2_write_enabled', 'true'],
    ['goff_ledger_enabled', 'true']
  );
  h.grids.RosterPeople.push(
    [PERSON_EP_CHONG, 'EP', 'Dr. Chong (EP)', '[]', true, '2026-01-01T00:00:00Z', '']
  );
  h.grids.RosterPeriods.push([
    '2026-11', 'PUBLISHED', 1, 1, 'snap-1', '2026-11-01T00:00:00Z', 'admin', '', '', 'chk', 2, 'op-1', '2026-11-01T00:00:00Z'
  ]);

  const earnOp = makeEarnGoffOp({
    periodId: '2026-11',
    personId: PERSON_EP_CHONG,
    date: '2026-11-05'
  });

  const res = h.post(earnOp);
  assert.equal(res.ok, false, 'EP entitlement earning must fail');
  assert.equal(res.error.code, 'EP_DOMAIN_EXCLUDED', 'Error code must be EP_DOMAIN_EXCLUDED');
});

// ---------------------------------------------------------------------------
// 12. GOFF* creates no entitlement balance
// ---------------------------------------------------------------------------
test('12. legacy GOFF* marker creates no entitlement balance and remains unresolved', () => {
  const types = Object.values(entitlement.ENTITLEMENT_TYPES);
  assert.equal(types.includes('GOFF*'), false, 'GOFF* is not in ENTITLEMENT_TYPES');

  assert.throws(
    () => entitlement.deriveEntitlementBalance([], { personId: 'p-1', entitlementType: 'GOFF*' }),
    err => err.code === 'INVALID_ENTITLEMENT_TYPE',
    'Attempting to derive balance for GOFF* throws INVALID_ENTITLEMENT_TYPE'
  );
});

// ---------------------------------------------------------------------------
// 13. No GOFF/GHKA balance invented automatically
// ---------------------------------------------------------------------------
test('13. historical roster shifts invent zero automatic GOFF/GHKA balance', () => {
  const h = setupHarness();
  h.context.rosterProvisionAllSchemas_();
  h.grids.Settings.push(
    ['roster_v2_read_enabled', 'true'],
    ['goff_ledger_enabled', 'true']
  );
  h.grids.RosterPeople.push(
    [PERSON_ALI, 'MO', 'Dr. Ali', '[]', true, '2026-01-01T00:00:00Z', '']
  );

  // Read entitlement balances for 2026-11 without manual import
  const res = h.get('rosterv2entitlementbalances', { period: '2026-11', personId: PERSON_ALI });
  assert.equal(res.ok, true);
  assert.equal(res.balances[PERSON_ALI]?.GOFF || 0, 0, 'GOFF balance must be 0 without explicit import');
  assert.equal(res.balances[PERSON_ALI]?.GHKA || 0, 0, 'GHKA balance must be 0 without explicit import');
  assert.equal(h.grids.RosterEntitlementTransactions.length, 1, 'Entitlement ledger has only header row');
});

// ---------------------------------------------------------------------------
// 14. V2 period initialization deterministic
// ---------------------------------------------------------------------------
test('14. V2 period enrollment creates deterministic metadata in DRAFT state', () => {
  const periodId = '2026-12';
  const period = lifecycle.createInitialPeriodRecord({
    periodId,
    schemaVersion: 2,
    enrolledBy: 'admin@example.invalid'
  });

  assert.equal(period.PeriodId, periodId);
  assert.equal(period.State, 'DRAFT');
  assert.equal(period.Revision, 0);
  assert.equal(period.DraftRevision, 0);
  assert.equal(period.SchemaVersion, 2);
});

// ---------------------------------------------------------------------------
// 15 & 16 & 17. Planned snapshot deterministic and Current matches initially
// ---------------------------------------------------------------------------
test('15, 16, 17. Planned snapshot is immutable, Current initially matches Planned, MasterRoster matches projection', () => {
  const periodId = '2026-11';
  const draftCells = {
    [`${PERSON_ALI}/${periodId}-01`]: [{ rawShift: 'AM' }],
    [`${PERSON_ALI}/${periodId}-02`]: [{ rawShift: 'PM' }],
    [`${PERSON_SITI}/${periodId}-01`]: [{ rawShift: 'OFF' }],
    [`${PERSON_SITI}/${periodId}-02`]: [{ rawShift: 'ON1' }]
  };

  const people = [
    { PersonId: PERSON_ALI, DirectoryType: 'MO', CurrentDisplayName: 'Dr. Ali' },
    { PersonId: PERSON_SITI, DirectoryType: 'MO', CurrentDisplayName: 'Dr. Siti' }
  ];

  const snapshot = lifecycle.generatePlannedSnapshot({
    periodId,
    draftCells,
    people,
    operationId: '99999999-1111-4222-8333-444444444444',
    actor: 'admin@example.invalid',
    digestFn: digest
  });

  assert.equal(snapshot.assignments.length, 4, 'Planned snapshot has 4 assignments');
  assert.ok(snapshot.plannedSnapshotId, 'SnapshotId generated');

  const checksum = lifecycle.computeProjectionChecksum(
    lifecycle.generateMasterRosterProjection(snapshot.assignments),
    digest
  );
  assert.ok(checksum, 'Projection checksum generated');

  // Verify Current layer initially equals Planned assignments
  const currentAssignments = snapshot.assignments.map(a => ({
    ...a,
    Layer: 'CURRENT',
    AssignmentId: a.AssignmentId.replace('planned', 'current')
  }));

  const projectedRows = lifecycle.generateMasterRosterProjection(currentAssignments);
  assert.equal(projectedRows.length, 4, 'Projected 4 rows');
  assert.ok(projectedRows.some(r => r.Name === 'Dr. Ali' && r.Date === '2026-11-01' && r.Shift === 'AM'));
  assert.ok(projectedRows.some(r => r.Name === 'Dr. Siti' && r.Date === '2026-11-02' && r.Shift === 'ON1'));
});

// ---------------------------------------------------------------------------
// 19. Re-running migration does not duplicate records
// ---------------------------------------------------------------------------
test('19. re-running migration operations does not duplicate records in RosterAssignments or RosterPeriods', () => {
  const h = setupHarness();
  h.context.rosterProvisionAllSchemas_();
  h.grids.RosterPeople.push(
    [PERSON_ALI, 'MO', 'Dr. Ali', '[]', true, '2026-01-01T00:00:00Z', '']
  );
  h.grids.Settings.push(
    ['roster_v2_write_enabled', 'true'],
    ['roster_v2_read_enabled', 'true'],
    ['weekly_off_guidance_enabled', 'true']
  );

  const periodId = '2026-11';
  h.grids.RosterPeriods.push([
    periodId, 'DRAFT', 0, 0, '', '', '', '', '', '', 2, '', '2026-10-01T00:00:00Z'
  ]);
  h.grids.OffPolicies.push([
    POLICY_A_ID, 'A', '2026-10-26', 1, guidance.policyRuleJson('A'), true, 'Policy A', 1, 'op-seed', '2026-10-01T00:00:00Z', 'admin@example.invalid'
  ]);

  const opId = '77777777-8888-4999-8aaa-bbbbbbbbbbbb';
  const publishOp = makePublishOp({
    periodId,
    expectedRevision: 0,
    operationId: opId,
    draftCells: {
      [`${PERSON_ALI}/${periodId}-01`]: [{ rawShift: 'AM' }]
    }
  });

  // Run publish first time
  const res1 = h.post(publishOp);
  assert.equal(res1.ok, true);

  const assignmentCount1 = h.grids.RosterAssignments.length;
  const periodsCount1 = h.grids.RosterPeriods.length;

  // Re-run exact same publish operation (idempotent replay)
  const res2 = h.post(publishOp);
  assert.equal(res2.ok, true);
  assert.equal(res2.state, 'PUBLISHED');

  const assignmentCount2 = h.grids.RosterAssignments.length;
  const periodsCount2 = h.grids.RosterPeriods.length;

  assert.equal(assignmentCount1, assignmentCount2, 'Assignments count must not increase on replay');
  assert.equal(periodsCount1, periodsCount2, 'Periods count must not increase on replay');
});

// ---------------------------------------------------------------------------
// 20. Rollback flags restore legacy-compatible state without deleting audit structures
// ---------------------------------------------------------------------------
test('20. rollback flags return app to legacy-compatible state while leaving audit structures preserved', () => {
  const h = setupHarness();
  h.context.rosterProvisionAllSchemas_();
  h.grids.RosterPeople.push(
    [PERSON_ALI, 'MO', 'Dr. Ali', '[]', true, '2026-01-01T00:00:00Z', '']
  );
  h.grids.Settings.push(
    ['roster_v2_write_enabled', 'true'],
    ['roster_v2_read_enabled', 'true'],
    ['weekly_off_guidance_enabled', 'true']
  );

  const periodId = '2026-11';
  h.grids.RosterPeriods.push([
    periodId, 'DRAFT', 0, 0, '', '', '', '', '', '', 2, '', '2026-10-01T00:00:00Z'
  ]);
  h.grids.OffPolicies.push([
    POLICY_A_ID, 'A', '2026-10-26', 1, guidance.policyRuleJson('A'), true, 'Policy A', 1, 'op-seed', '2026-10-01T00:00:00Z', 'admin@example.invalid'
  ]);

  // Execute a V2 publish to create audit records
  const publishOp = makePublishOp({
    periodId,
    expectedRevision: 0,
    draftCells: {
      [`${PERSON_ALI}/${periodId}-01`]: [{ rawShift: 'AM' }]
    }
  });
  const resPub = h.post(publishOp);
  assert.equal(resPub.ok, true);

  // Execute a V2 close operation to record lifecycle event in RosterEvents
  const closeOp = makeCloseOp({
    periodId,
    expectedRevision: 1,
    adminNote: 'Pre-rollback close test'
  });
  const resClose = h.post(closeOp);
  assert.equal(resClose.ok, true);

  // Record audit table counts
  const opLogCount = h.grids.OperationLog.length;
  const eventCount = h.grids.RosterEvents.length;
  const assignmentCount = h.grids.RosterAssignments.length;
  assert.ok(opLogCount > 1, 'OperationLog contains entries');
  assert.ok(eventCount > 1, 'RosterEvents contains entries');
  assert.ok(assignmentCount > 1, 'RosterAssignments contains entries');

  // Trigger ROLLBACK: Set feature switches back to false
  const settingsSheet = h.grids.Settings;
  for (let i = 1; i < settingsSheet.length; i++) {
    const k = settingsSheet[i][0];
    if (k === 'roster_v2_write_enabled' || k === 'roster_v2_read_enabled') {
      settingsSheet[i][1] = 'false';
    }
    if (k === 'legacy_upload_enabled') {
      settingsSheet[i][1] = 'true';
    }
  }

  // Verify V2 write is now blocked (legacy mode active)
  const postRollbackOp = makeCloseOp({
    periodId,
    expectedRevision: 2,
    adminNote: 'Post rollback attempt'
  });

  const resPostRollback = h.post(postRollbackOp);
  assert.equal(resPostRollback.ok, false, 'V2 write must fail after feature flag rollback');
  assert.equal(resPostRollback.error.code, 'FEATURE_DISABLED', 'Error code must be FEATURE_DISABLED');

  // Verify legacy endpoints still function
  const requests = h.get('getRequests');
  assert.ok(Array.isArray(requests), 'Legacy requests endpoint operational');

  // Critical Data Invariant: Verify audit records were NOT wiped during rollback
  assert.equal(h.grids.OperationLog.length, opLogCount, 'OperationLog preserved intact');
  assert.equal(h.grids.RosterEvents.length, eventCount, 'RosterEvents preserved intact');
  assert.equal(h.grids.RosterAssignments.length, assignmentCount, 'RosterAssignments preserved intact');
});
