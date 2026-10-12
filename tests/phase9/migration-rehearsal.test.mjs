import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import protocol from '../../src/features/roster/queue/protocol.js';
import compatibility from '../../src/features/roster/compatibility.js';
import guidance from '../../src/features/roster/guidance.js';
import lifecycle from '../../src/features/roster/lifecycle.js';
import absence from '../../src/features/roster/absence.js';
import entitlement from '../../src/features/roster/goff.js';
import identityMigration from '../../src/features/roster/identityMigration.js';
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

function makeCreditManualOp({
  periodId = '2026-11',
  personId = PERSON_ALI,
  entitlementType = 'GOFF',
  amount = 1,
  effectiveDate = '2026-11-01',
  reasonCode = 'OPENING_BALANCE',
  adminNote = 'Opening balance migration: 2026-10 reviewed sign-off',
  expectedRevision = 0,
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
    operationType: 'ENTITLEMENT_CREDIT_MANUAL',
    entityKey: `period:${periodId}`,
    expectedRevision,
    payload: {
      periodId,
      personId,
      entitlementType,
      amount,
      effectiveDate,
      reasonCode,
      adminNote
    }
  };
  const payloadHash = digest(protocol.canonical(meaning));
  return {
    action: 'rosterv2entitlementcreditmanual',
    operationId: opId,
    clientId: cId,
    tabId: tId,
    periodId,
    expectedRevision,
    personId,
    entitlementType,
    amount,
    effectiveDate,
    reasonCode,
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

// ---------------------------------------------------------------------------
// 21. Stage B — New backend + all V2 flags disabled + legacy upload enabled
// ---------------------------------------------------------------------------
test('21. Stage B: new backend + all V2 flags disabled keeps legacy endpoints working and blocks V2 writes', () => {
  const h = setupHarness();
  h.grids.Settings.push(
    ['roster_workspace_v2_enabled', 'false'],
    ['roster_v2_read_enabled', 'false'],
    ['roster_v2_write_enabled', 'false'],
    ['legacy_upload_enabled', 'true']
  );

  // Smoke test legacy endpoints against new backend bundle
  const requests = h.get('getRequests');
  assert.ok(Array.isArray(requests), 'Legacy getRequests works against new backend');

  const leave = h.get('getLeaveApplications');
  assert.ok(Array.isArray(leave), 'Legacy getLeaveApplications works against new backend');

  // Verify V2 write endpoints are rejected
  const pubOp = makePublishOp({ periodId: '2026-11' });
  const pubRes = h.post(pubOp);
  assert.equal(pubRes.ok, false);
  assert.equal(pubRes.error.code, 'FEATURE_DISABLED', 'V2 write blocked when roster_v2_write_enabled=false');

  const creditOp = makeCreditManualOp({ periodId: '2026-11' });
  const creditRes = h.post(creditOp);
  assert.equal(creditRes.ok, false);
  assert.equal(creditRes.error.code, 'FEATURE_DISABLED', 'Manual credit write blocked when roster_v2_write_enabled=false');

  // Verify V2 read endpoints are rejected
  const readRes = h.get('rosterv2current', { period: '2026-11' });
  assert.equal(readRes.ok, false);
  assert.equal(readRes.error.code, 'FEATURE_DISABLED', 'V2 read blocked when roster_v2_read_enabled=false');
});

// ---------------------------------------------------------------------------
// 22. Stage C — Mandatory seed prerequisites checked before first publish
// ---------------------------------------------------------------------------
test('22. Stage C: schema provisioning is additive and audits mandatory reference seeds before first publish', () => {
  const h = setupHarness();
  h.context.rosterProvisionAllSchemas_();

  h.grids.Settings.push(
    ['roster_v2_write_enabled', 'true'],
    ['roster_v2_read_enabled', 'true']
  );

  const testDraftCells = {
    [`${PERSON_ALI}/2026-11-01`]: [{ rawShift: 'AM' }]
  };

  // Case A: Missing RosterPeople causes publish to fail with VALIDATION_FAILED
  h.grids.RosterPeriods.push([
    '2026-11', 'DRAFT', 0, 0, '', '', '', '', '', '', 2, '', '2026-10-01T00:00:00Z'
  ]);
  const pubOpNoPeople = makePublishOp({ periodId: '2026-11', draftCells: testDraftCells });
  const resNoPeople = h.post(pubOpNoPeople);
  assert.equal(resNoPeople.ok, false);
  assert.equal(resNoPeople.error.code, 'VALIDATION_FAILED', 'Publish fails if assigned staff missing from RosterPeople');
  assert.equal(h.grids.RosterAssignments.length, 1, 'Zero assignments persisted on initial validation failure');

  // Case B: Missing OffPolicies causes publish to halt and enter RECOVERY_REQUIRED
  h.grids.RosterPeople.push(
    [PERSON_ALI, 'MO', 'Dr. Ali', '[]', true, '2026-01-01T00:00:00Z', '']
  );
  h.grids.RosterPeriods.push([
    '2026-12', 'DRAFT', 0, 0, '', '', '', '', '', '', 2, '', '2026-10-01T00:00:00Z'
  ]);
  const draftDec = { [`${PERSON_ALI}/2026-12-01`]: [{ rawShift: 'AM' }] };
  const pubOpNoPolicy = makePublishOp({ periodId: '2026-12', draftCells: draftDec });
  const resNoPolicy = h.post(pubOpNoPolicy);
  assert.equal(resNoPolicy.ok, false);
  assert.equal(resNoPolicy.error.code, 'RECOVERY_REQUIRED', 'Missing OffPolicies halts publish and triggers RECOVERY_REQUIRED');

  // Case C: With mandatory seeds in place, publish succeeds cleanly
  h.grids.OffPolicies.push([
    POLICY_A_ID, 'A', '2026-10-26', 1, guidance.policyRuleJson('A'), true, 'Policy A', 1, 'op-seed', '2026-10-01T00:00:00Z', 'admin@example.invalid'
  ]);
  h.grids.RosterPeriods.push([
    '2027-01', 'DRAFT', 0, 0, '', '', '', '', '', '', 2, '', '2026-10-01T00:00:00Z'
  ]);
  const draftJan = { [`${PERSON_ALI}/2027-01-01`]: [{ rawShift: 'AM' }] };
  const pubOpSuccess = makePublishOp({ periodId: '2027-01', draftCells: draftJan });
  const resSuccess = h.post(pubOpSuccess);
  assert.equal(resSuccess.ok, true, 'Publish succeeds when mandatory reference seeds exist');
  assert.equal(resSuccess.state, 'PUBLISHED');
});

// ---------------------------------------------------------------------------
// 23. Stage D — Identity migration dry-run and deterministic derivation
// ---------------------------------------------------------------------------
test('23. Stage D: dry-run identity migration classifies all 6 categories and derives deterministic UUIDs', () => {
  const teamMembers = [
    // CREATE: New MO with StaffId
    { MemberName: 'Dr. Zaid', StaffId: 'MO-77', Email: 'zaid@example.com', Active: true },
    // REUSE: Existing MO with matching PersonId and identical display name
    { MemberName: 'Dr. Ali Hassan', StaffId: 'MO-01', Email: 'ali@example.com', Active: true },
    // ALIAS_UPDATE: Existing MO whose name changed
    { MemberName: 'Dr. Siti Updated', StaffId: 'MO-02', Email: 'siti@example.com', Active: true },
    // INACTIVE: Staff marked inactive
    { MemberName: 'Dr. Retired Staff', StaffId: 'MO-99', Email: 'retired@example.com', Active: false },
    // AMBIGUOUS: Duplicate StaffId within directory
    { MemberName: 'Dr. Collide One', StaffId: 'MO-DUP', Email: 'c1@example.com', Active: true },
    { MemberName: 'Dr. Collide Two', StaffId: 'MO-DUP', Email: 'c2@example.com', Active: true },
    // MISSING_STABLE_ID: Entry lacking both StaffId and Email
    { MemberName: 'Dr. Unknown Temp', Active: true }
  ];

  // In RosterPeople, map Dr. Ali Hassan and Dr. Siti to their deterministic IDs
  const aliId = lifecycle.deterministicUuid('person:MO:staffId:MO-01', digest);
  const sitiId = lifecycle.deterministicUuid('person:MO:staffId:MO-02', digest);

  const matchedExisting = [
    { PersonId: aliId, DirectoryType: 'MO', CurrentDisplayName: 'Dr. Ali Hassan', LegacyNamesJson: JSON.stringify(['Ali']), Active: true },
    { PersonId: sitiId, DirectoryType: 'MO', CurrentDisplayName: 'Dr. Siti Former', LegacyNamesJson: '[]', Active: true }
  ];

  const plan = identityMigration.planIdentityMigration({
    teamMembers,
    emergencyPhysicians: [],
    existingPeople: matchedExisting,
    digestFn: digest
  });

  assert.equal(plan.summary.total, 7);
  assert.equal(plan.summary.create, 1, 'Exactly 1 CREATE');
  assert.equal(plan.summary.reuse, 1, 'Exactly 1 REUSE');
  assert.equal(plan.summary.aliasUpdate, 1, 'Exactly 1 ALIAS_UPDATE');
  assert.equal(plan.summary.inactive, 1, 'Exactly 1 INACTIVE');
  assert.equal(plan.summary.ambiguous, 2, 'Exactly 2 AMBIGUOUS due to duplicate StaffId');
  assert.equal(plan.summary.missingStableId, 1, 'Exactly 1 MISSING_STABLE_ID');
  assert.equal(plan.summary.canProceed, false, 'Migration cannot proceed while ambiguities exist');

  // Verify ALIAS_UPDATE added previous name to legacyNames
  const aliasPlan = plan.plans.find(p => p.category === 'ALIAS_UPDATE');
  assert.ok(aliasPlan.legacyNames.includes('Dr. Siti Former'), 'Former name tracked in LegacyNames');

  // Verify Cross-Domain Collision fails closed as AMBIGUOUS
  const crossDomainPlan = identityMigration.planIdentityMigration({
    teamMembers: [{ MemberName: 'Dr. Cross Staff', StaffId: 'CROSS-1', Active: true }],
    emergencyPhysicians: [{ MemberName: 'Dr. Cross Staff', StaffId: 'CROSS-1', Active: true }],
    existingPeople: [],
    digestFn: digest
  });
  assert.equal(crossDomainPlan.summary.ambiguous, 2, 'Cross-domain collision in StaffId produces AMBIGUOUS');

  // Verify Determinism: repeated derivation produces identical PersonId
  const plan2 = identityMigration.planIdentityMigration({
    teamMembers,
    emergencyPhysicians: [],
    existingPeople: matchedExisting,
    digestFn: digest
  });
  const zaidId1 = plan.plans.find(p => p.memberName === 'Dr. Zaid').personId;
  const zaidId2 = plan2.plans.find(p => p.memberName === 'Dr. Zaid').personId;
  assert.equal(zaidId1, zaidId2, 'Derived PersonId is completely deterministic');
});

// ---------------------------------------------------------------------------
// 24. Stage E — Hidden V2 initialization flag state permits enrollment, publish, and opening credit import
// ---------------------------------------------------------------------------
test('24. Stage E: hidden V2 initialization flag state permits enrollment, publish, and opening credit import', () => {
  const h = setupHarness();
  h.context.rosterProvisionAllSchemas_();

  // Exact Stage E Flag Combination:
  // roster_workspace_v2_enabled: false (workspace hidden from users)
  // roster_v2_write_enabled: true (permits backend mutations)
  // roster_v2_read_enabled: true (permits readback and verification)
  // legacy_upload_enabled: true (legacy upload remains permitted until cutover)
  // goff_ledger_enabled: true
  // weekly_off_guidance_enabled: true
  h.grids.Settings.push(
    ['roster_workspace_v2_enabled', 'false'],
    ['roster_v2_write_enabled', 'true'],
    ['roster_v2_read_enabled', 'true'],
    ['legacy_upload_enabled', 'true'],
    ['goff_ledger_enabled', 'true'],
    ['weekly_off_guidance_enabled', 'true']
  );

  // Seed reference data
  h.grids.RosterPeople.push(
    [PERSON_ALI, 'MO', 'Dr. Ali', '[]', true, '2026-01-01T00:00:00Z', ''],
    [PERSON_SITI, 'MO', 'Dr. Siti', '[]', true, '2026-01-01T00:00:00Z', '']
  );
  h.grids.OffPolicies.push([
    POLICY_A_ID, 'A', '2026-10-26', 1, guidance.policyRuleJson('A'), true, 'Policy A', 1, 'op-seed', '2026-10-01T00:00:00Z', 'admin@example.invalid'
  ]);

  const periodId = '2026-11';
  // Step 1: Enroll period in DRAFT state
  h.grids.RosterPeriods.push([
    periodId, 'DRAFT', 0, 0, '', '', '', '', '', '', 2, '', '2026-10-01T00:00:00Z'
  ]);

  // Step 2: Publish period
  const publishOp = makePublishOp({
    periodId,
    expectedRevision: 0,
    draftCells: {
      [`${PERSON_ALI}/${periodId}-01`]: [{ rawShift: 'AM' }],
      [`${PERSON_SITI}/${periodId}-01`]: [{ rawShift: 'PM' }]
    }
  });
  const pubRes = h.post(publishOp);
  assert.equal(pubRes.ok, true, 'Publish succeeds under Stage E flags');
  assert.equal(pubRes.state, 'PUBLISHED');

  // Step 3: Import reviewed GOFF/GHKA opening balance
  const creditOp = makeCreditManualOp({
    periodId,
    personId: PERSON_ALI,
    entitlementType: 'GOFF',
    amount: 1,
    effectiveDate: '2026-11-01',
    reasonCode: 'OPENING_BALANCE',
    adminNote: 'Reviewed opening balance sign-off from October manual ledger',
    expectedRevision: 0
  });

  const creditRes = h.post(creditOp);
  assert.equal(creditRes.ok, true, 'Opening credit import succeeds with reasonCode OPENING_BALANCE');
  assert.equal(creditRes.status, 'CONFIRMED');

  // Step 4: Verify readback confirms opening credit
  const balanceRes = h.get('rosterv2entitlementbalances', { period: periodId, personId: PERSON_ALI });
  assert.equal(balanceRes.ok, true);
  assert.equal(balanceRes.balances?.GOFF, 1, 'Opening balance credited in ledger');

  // Step 5: Prove opening credit import FAILS if roster_v2_write_enabled is false
  const settingsSheet = h.grids.Settings;
  for (let i = 1; i < settingsSheet.length; i++) {
    if (settingsSheet[i][0] === 'roster_v2_write_enabled') {
      settingsSheet[i][1] = 'false';
    }
  }
  const blockedCreditOp = makeCreditManualOp({
    periodId,
    personId: PERSON_ALI,
    operationId: '12345678-aaaa-bbbb-cccc-dddddddddddd'
  });
  const blockedRes = h.post(blockedCreditOp);
  assert.equal(blockedRes.ok, false, 'Credit import blocked when write flag is false');
  assert.equal(blockedRes.error.code, 'FEATURE_DISABLED');
});

// ---------------------------------------------------------------------------
// 25. Baseline Planned vs Current persistence semantics
// ---------------------------------------------------------------------------
test('25. baseline Planned vs Current persistence semantics: RosterAssignments stores only PLANNED; Current is derived', () => {
  const h = setupHarness();
  h.context.rosterProvisionAllSchemas_();
  h.grids.Settings.push(
    ['roster_v2_write_enabled', 'true'],
    ['roster_v2_read_enabled', 'true'],
    ['weekly_off_guidance_enabled', 'true']
  );
  h.grids.RosterPeople.push(
    [PERSON_ALI, 'MO', 'Dr. Ali', '[]', true, '2026-01-01T00:00:00Z', ''],
    [PERSON_SITI, 'MO', 'Dr. Siti', '[]', true, '2026-01-01T00:00:00Z', '']
  );
  h.grids.OffPolicies.push([
    POLICY_A_ID, 'A', '2026-10-26', 1, guidance.policyRuleJson('A'), true, 'Policy A', 1, 'op-seed', '2026-10-01T00:00:00Z', 'admin@example.invalid'
  ]);

  const periodId = '2026-11';
  h.grids.RosterPeriods.push([
    periodId, 'DRAFT', 0, 0, '', '', '', '', '', '', 2, '', '2026-10-01T00:00:00Z'
  ]);

  const publishOp = makePublishOp({
    periodId,
    expectedRevision: 0,
    draftCells: {
      [`${PERSON_ALI}/${periodId}-01`]: [{ rawShift: 'AM' }],
      [`${PERSON_SITI}/${periodId}-01`]: [{ rawShift: 'PM' }]
    }
  });
  const pubRes = h.post(publishOp);
  assert.equal(pubRes.ok, true);

  // Inspect physical rows in RosterAssignments
  const assignmentRows = h.grids.RosterAssignments.slice(1);
  assert.equal(assignmentRows.length, 2, 'Exactly 2 rows persisted in RosterAssignments');

  const headers = h.grids.RosterAssignments[0];
  const layerIdx = headers.indexOf('Layer');
  assert.ok(layerIdx >= 0, 'Layer header exists in RosterAssignments');

  const layers = assignmentRows.map(r => r[layerIdx]);
  assert.ok(layers.every(l => l === 'PLANNED'), 'All physical rows have Layer === PLANNED');
  assert.ok(!layers.includes('CURRENT'), 'Zero physical rows have Layer === CURRENT');

  // Verify resolved Current output via endpoint DTO
  const currentRes = h.get('rosterv2current', { period: periodId });
  assert.equal(currentRes.ok, true);
  assert.equal(currentRes.assignments.length, 2);
  assert.ok(currentRes.assignments.some(a => a.personId === PERSON_ALI && a.shiftCode === 'AM'));
  assert.ok(currentRes.assignments.some(a => a.personId === PERSON_SITI && a.shiftCode === 'PM'));

  // Verify pure resolution function explicitly assigns Layer: 'CURRENT'
  const resolved = lifecycle.resolveCurrentRoster({
    periodId,
    plannedAssignments: assignmentRows.map(r => Object.fromEntries(headers.map((h, i) => [h, r[i]]))),
    digestFn: digest
  });
  assert.ok(resolved.currentAssignments.every(a => a.Layer === 'CURRENT'), 'Resolved Current layer assignments have Layer: CURRENT');

  // Verify MasterRoster projection matches resolved Current
  const projected = h.grids.MasterRoster.slice(1).filter(r => String(r[1]).startsWith('2026-11'));
  assert.equal(projected.length, 2);
  assert.ok(projected.some(r => r[0] === 'Dr. Ali' && r[1] === '2026-11-01' && r[2] === 'AM'));
  assert.ok(projected.some(r => r[0] === 'Dr. Siti' && r[1] === '2026-11-01' && r[2] === 'PM'));
});

// ---------------------------------------------------------------------------
// 26. Stage F & G — Workspace gating and final cutover activation
// ---------------------------------------------------------------------------
test('26. Stage F & G: workspace gating protects legacy users until final activation switch', () => {
  const h = setupHarness();
  h.context.rosterProvisionAllSchemas_();
  h.grids.RosterPeople.push([PERSON_ALI, 'MO', 'Dr. Ali', '[]', true, '2026-01-01T00:00:00Z', '']);
  h.grids.OffPolicies.push([
    POLICY_A_ID, 'A', '2026-10-26', 1, guidance.policyRuleJson('A'), true, 'Policy A', 1, 'op-seed', '2026-10-01T00:00:00Z', 'admin@example.invalid'
  ]);

  const periodId = '2026-11';
  h.grids.RosterPeriods.push([
    periodId, 'DRAFT', 0, 0, '', '', '', '', '', '', 2, '', '2026-10-01T00:00:00Z'
  ]);

  // Stage F: New frontend deployed, workspace flag remains false
  h.grids.Settings.push(
    ['roster_workspace_v2_enabled', 'false'],
    ['roster_v2_read_enabled', 'true'],
    ['roster_v2_write_enabled', 'true'],
    ['legacy_upload_enabled', 'true']
  );

  // Publish period so Planned assignments and snapshot exist
  const pubOp = makePublishOp({
    periodId,
    draftCells: { [`${PERSON_ALI}/${periodId}-01`]: [{ rawShift: 'AM' }] }
  });
  const pubRes = h.post(pubOp);
  assert.equal(pubRes.ok, true);

  // Stage F verification: Workspace flag is false
  const switchesF = compatibility.featureSwitches(h.grids.Settings);
  assert.equal(switchesF.roster_workspace_v2_enabled, false, 'Workspace disabled in Stage F');

  // Stage G: Final Cutover Activation
  const settingsSheet = h.grids.Settings;
  for (let i = 1; i < settingsSheet.length; i++) {
    if (settingsSheet[i][0] === 'roster_workspace_v2_enabled') {
      settingsSheet[i][1] = 'true';
    }
    if (settingsSheet[i][0] === 'legacy_upload_enabled') {
      settingsSheet[i][1] = 'false';
    }
  }

  // V2 reads and writes operate normally
  const readRes = h.get('rosterv2current', { period: periodId });
  assert.equal(readRes.ok, true, 'V2 current read operational');

  // Legacy full roster upload is blocked because legacy_upload_enabled = false
  assert.throws(
    () => h.context.rosterV2GuardLegacyUpload_({}),
    /Legacy roster upload is disabled/,
    'Legacy upload strictly blocked after Stage G activation'
  );
});

// ---------------------------------------------------------------------------
// 27. Multi-tier rollback restores legacy compatibility without audit loss
// ---------------------------------------------------------------------------
test('27. multi-tier rollback restores legacy compatibility without audit loss', () => {
  const h = setupHarness();
  h.context.rosterProvisionAllSchemas_();
  h.grids.RosterPeople.push([PERSON_ALI, 'MO', 'Dr. Ali', '[]', true, '2026-01-01T00:00:00Z', '']);
  h.grids.OffPolicies.push([
    POLICY_A_ID, 'A', '2026-10-26', 1, guidance.policyRuleJson('A'), true, 'Policy A', 1, 'op-seed', '2026-10-01T00:00:00Z', 'admin@example.invalid'
  ]);

  const periodId = '2026-11';
  h.grids.RosterPeriods.push([
    periodId, 'DRAFT', 0, 0, '', '', '', '', '', '', 2, '', '2026-10-01T00:00:00Z'
  ]);

  // Activate V2 to produce state
  h.grids.Settings.push(
    ['roster_workspace_v2_enabled', 'true'],
    ['roster_v2_write_enabled', 'true'],
    ['roster_v2_read_enabled', 'true'],
    ['legacy_upload_enabled', 'false']
  );

  const pubOp = makePublishOp({
    periodId,
    expectedRevision: 0,
    draftCells: { [`${PERSON_ALI}/${periodId}-01`]: [{ rawShift: 'AM' }] }
  });
  const pubRes = h.post(pubOp);
  assert.equal(pubRes.ok, true);

  const preRollbackOpCount = h.grids.OperationLog.length;
  const preRollbackAssignments = h.grids.RosterAssignments.length;

  // Execute Tier 1 Rollback: Feature switches reverted
  const settingsSheet = h.grids.Settings;
  for (let i = 1; i < settingsSheet.length; i++) {
    const k = settingsSheet[i][0];
    if (k === 'roster_workspace_v2_enabled' || k === 'roster_v2_write_enabled' || k === 'roster_v2_read_enabled') {
      settingsSheet[i][1] = 'false';
    }
    if (k === 'legacy_upload_enabled') {
      settingsSheet[i][1] = 'true';
    }
  }

  // Verify: V2 writes fail closed
  const postRollbackOp = makeCloseOp({ periodId, expectedRevision: 1 });
  const postRes = h.post(postRollbackOp);
  assert.equal(postRes.ok, false);
  assert.equal(postRes.error.code, 'FEATURE_DISABLED');

  // Verify: Legacy endpoints function
  const reqs = h.get('getRequests');
  assert.ok(Array.isArray(reqs));

  // Verify: Audit structures completely preserved
  assert.equal(h.grids.OperationLog.length, preRollbackOpCount);
  assert.equal(h.grids.RosterAssignments.length, preRollbackAssignments);
});

// ---------------------------------------------------------------------------
// 28. RosterPage workspace cutover gate (workspace disabled vs enabled)
// ---------------------------------------------------------------------------
test('28. RosterPage workspace cutover gate: workspace disabled retains legacy UI and blocks V2 invocations, workspace enabled renders V2', () => {
  const rosterPageSrc = fs.readFileSync(path.resolve('src/components/RosterPage.jsx'), 'utf8');

  // Verify RosterPage source code strictly gates LifecycleControls behind roster_workspace_v2_enabled
  const lifecycleControlsGate = /\{Boolean\(settings\?\.roster_workspace_v2_enabled\s*===\s*true\s*\|\|\s*String\(settings\?\.roster_workspace_v2_enabled\s*\|\|\s*''\)\.toLowerCase\(\)\s*===\s*'true'\)\s*&&\s*\(\s*<div[^>]*>\s*<LifecycleControls/;
  assert.ok(lifecycleControlsGate.test(rosterPageSrc), 'LifecycleControls must be strictly gated by roster_workspace_v2_enabled');

  // Verify RosterPage source code strictly gates Phase5RosterContainer behind roster_workspace_v2_enabled
  const rosterContainerGate = /\{Boolean\(settings\?\.roster_workspace_v2_enabled\s*===\s*true\s*\|\|\s*String\(settings\?\.roster_workspace_v2_enabled\s*\|\|\s*''\)\.toLowerCase\(\)\s*===\s*'true'\)\s*&&\s*lifecycleInfo\.isEnrolled\s*&&/;
  assert.ok(rosterContainerGate.test(rosterPageSrc), 'Phase5RosterContainer must be strictly gated by roster_workspace_v2_enabled');

  // Verify RosterPage contains ZERO direct calls to V2 backend endpoints
  assert.equal(rosterPageSrc.includes('rosterv2'), false, 'RosterPage must not make direct rosterv2 calls outside gated components');

  // Helper evaluating exact gate condition from RosterPage.jsx
  const evaluateRosterPageGates = (settings, lifecycleInfo) => {
    const isWorkspaceEnabled = Boolean(
      settings?.roster_workspace_v2_enabled === true ||
      String(settings?.roster_workspace_v2_enabled || '').toLowerCase() === 'true'
    );
    const renderLifecycleControls = isWorkspaceEnabled;
    const renderPhase5Container = isWorkspaceEnabled &&
      lifecycleInfo.isEnrolled &&
      ['DRAFT', 'PUBLISHED', 'AMENDED', 'CLOSED'].includes(lifecycleInfo.state) &&
      settings?.roster_v2_read_enabled !== false;
    const renderLegacyRosterUi = !renderPhase5Container;
    return {
      isWorkspaceEnabled,
      renderLifecycleControls,
      renderPhase5Container,
      renderLegacyRosterUi
    };
  };

  const enrolledPeriod = {
    period: '2026-11',
    isEnrolled: true,
    state: 'PUBLISHED',
    revision: 1
  };

  // State 1: Workspace disabled (various falsy representations)
  const disabledCases = [
    { roster_workspace_v2_enabled: false },
    { roster_workspace_v2_enabled: 'false' },
    { roster_workspace_v2_enabled: 'FALSE' },
    { roster_workspace_v2_enabled: undefined },
    { roster_workspace_v2_enabled: null },
    {}
  ];

  for (const settings of disabledCases) {
    const res = evaluateRosterPageGates(settings, enrolledPeriod);
    assert.equal(res.renderLifecycleControls, false, 'LifecycleControls must NOT render when workspace is disabled');
    assert.equal(res.renderPhase5Container, false, 'Phase5RosterContainer must NOT render when workspace is disabled');
    assert.equal(res.renderLegacyRosterUi, true, 'Legacy roster UI must render when workspace is disabled');
  }

  // State 2: Workspace enabled (boolean and string representations)
  const enabledCases = [
    { roster_workspace_v2_enabled: true, roster_v2_read_enabled: true },
    { roster_workspace_v2_enabled: 'true', roster_v2_read_enabled: true },
    { roster_workspace_v2_enabled: 'TRUE', roster_v2_read_enabled: true }
  ];

  for (const settings of enabledCases) {
    const res = evaluateRosterPageGates(settings, enrolledPeriod);
    assert.equal(res.renderLifecycleControls, true, 'LifecycleControls must render when workspace is enabled');
    assert.equal(res.renderPhase5Container, true, 'Phase5RosterContainer must render when workspace is enabled');
    assert.equal(res.renderLegacyRosterUi, false, 'Legacy roster UI must be superseded when workspace is enabled');
  }

  // State 3: Workspace enabled but read disabled fails closed to legacy UI
  const readDisabled = evaluateRosterPageGates({ roster_workspace_v2_enabled: true, roster_v2_read_enabled: false }, enrolledPeriod);
  assert.equal(readDisabled.renderLifecycleControls, true, 'Lifecycle controls remain for admin status');
  assert.equal(readDisabled.renderPhase5Container, false, 'V2 container blocked when read is false');
  assert.equal(readDisabled.renderLegacyRosterUi, true, 'Falls back to legacy UI when V2 read is false');
});
