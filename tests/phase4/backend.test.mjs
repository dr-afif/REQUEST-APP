import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import vm from 'node:vm';
import protocol from '../../src/features/roster/queue/protocol.js';
import compatibility from '../../src/features/roster/compatibility.js';
import guidance from '../../src/features/roster/guidance.js';
import lifecycle from '../../src/features/roster/lifecycle.js';
import { harness, digest, currentSource, fixture } from '../phase1/apps-script-harness.mjs';

const person1 = '11111111-1111-4111-8111-111111111111';
const person2 = '22222222-2222-4222-8222-222222222222';

function setup(options = {}) {
  const h = harness(currentSource, {
    activeEmail: 'admin@example.invalid',
    adminEmail: 'admin@example.invalid',
    ...options
  });
  h.context.SpreadsheetApp.flush = () => {};
  h.grids.Settings.push(
    ['roster_v2_write_enabled', 'true'],
    ['roster_v2_read_enabled', 'true'],
    ['write_queue_v2_enabled', 'true'],
    ['weekly_off_guidance_enabled', 'true']
  );
  h.grids.RosterPeriods = [
    ['PeriodId', 'SchemaVersion', 'EnrolledAt', 'EnrolledBy'],
    ['2030-07', 2, '2030-01-01', 'owner'],
    ['2030-08', 2, '2030-01-01', 'owner']
  ];
  h.grids.RosterPeople = [
    ['PersonId', 'DirectoryType', 'CurrentDisplayName', 'LegacyNamesJson', 'Active'],
    [person1, 'MO', 'Dr. Ali', '[]', true],
    [person2, 'MO', 'Dr. Siti', '[]', true]
  ];
  h.grids.OffPolicies = [
    [...guidance.OFF_POLICY_HEADERS],
    ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'A', '2030-01-07', 1, guidance.policyRuleJson('A'), true, 'Initial policy', '2030-01-01', 'admin@example.invalid', '']
  ];

  const draftSchemas = vm.runInContext('ROSTER_DRAFT_SCHEMAS', h.context);
  for (const [k, v] of Object.entries(draftSchemas)) {
    if (!h.grids[k]) h.grids[k] = [[...v]];
  }

  const lifecycleSchemas = vm.runInContext('RosterLifecycle.ROSTER_LIFECYCLE_SCHEMAS', h.context);
  for (const [k, v] of Object.entries(lifecycleSchemas)) {
    if (!h.grids[k]) h.grids[k] = [[...v]];
  }

  return h;
}

function makePublishOp({
  periodId = '2030-07',
  expectedRevision = 0,
  draftCells = null,
  adminNote = 'Publish test',
  ...rest
} = {}) {
  const opId = crypto.randomUUID();
  const cId = crypto.randomUUID();
  const tId = crypto.randomUUID();
  const cells = draftCells || {
    [`${person1}/${periodId}-01`]: [{ rawShift: 'AM' }],
    [`${person2}/${periodId}-01`]: [{ rawShift: 'PM' }]
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
  periodId = '2030-07',
  expectedRevision = 1,
  adminNote = 'Close test',
  ...rest
} = {}) {
  const opId = crypto.randomUUID();
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

function makeReopenOp({
  periodId = '2030-07',
  expectedRevision = 2,
  reason = 'Reopen test audit reason',
  ...rest
} = {}) {
  const opId = crypto.randomUUID();
  const cId = crypto.randomUUID();
  const tId = crypto.randomUUID();
  const meaning = {
    operationId: opId,
    clientId: cId,
    tabId: tId,
    operationType: 'PERIOD_REOPEN',
    entityKey: `period:${periodId}`,
    expectedRevision,
    payload: {
      periodId,
      reason
    }
  };
  const payloadHash = digest(protocol.canonical(meaning));
  return {
    operationId: opId,
    clientId: cId,
    tabId: tId,
    periodId,
    expectedRevision,
    reason,
    payloadHash,
    ...rest
  };
}

const publish = (h, op) => h.post({ action: 'rosterv2publish', ...op });
const close = (h, op) => h.post({ action: 'rosterv2close', ...op });
const reopen = (h, op) => h.post({ action: 'rosterv2reopen', ...op });
const status = (h, opId) => h.get('rosterv2operation', { operationId: opId });
const recover = (h, opId) => h.post({ action: 'rosterv2lifecyclerecover', operationId: opId });
const periodLifecycle = (h, periodId) => h.get('rosterv2periodlifecycle', { periodId });

// ==========================================
// 1. SCHEMA UPGRADE & PERSISTENCE TESTS
// ==========================================

test('fresh lifecycle schema creation initializes all tables with correct Phase 4 headers', () => {
  const h = setup();
  h.context.rosterLifecycleEnsureAllSchemas_();
  const schemas = lifecycle.ROSTER_LIFECYCLE_SCHEMAS;
  for (const [name, expectedHeaders] of Object.entries(schemas)) {
    assert.ok(h.grids[name], `Table ${name} must exist`);
    assert.deepEqual(h.grids[name][0], expectedHeaders, `Table ${name} headers must match schema`);
  }
  assert.ok(h.grids.OperationLog, 'OperationLog must exist');
});

test('4-column Phase 1 RosterPeriods upgrades dynamically to 13 columns preserving legacy values', () => {
  const h = setup();
  h.grids.RosterPeriods = [
    ['PeriodId', 'SchemaVersion', 'EnrolledAt', 'EnrolledBy'],
    ['2030-07', 2, '2030-01-01', 'owner'],
    ['2030-08', 2, '2030-01-02', 'owner']
  ];

  h.context.rosterLifecycleEnsureSchema_('RosterPeriods');

  const headers = h.grids.RosterPeriods[0];
  assert.equal(headers.length, 13);
  assert.deepEqual(headers, lifecycle.ROSTER_LIFECYCLE_SCHEMAS.RosterPeriods);

  // Check row 1 preserved
  const row1 = h.grids.RosterPeriods[1];
  const pIdIdx = headers.indexOf('PeriodId');
  const stateIdx = headers.indexOf('State');
  const revIdx = headers.indexOf('Revision');
  const draftRevIdx = headers.indexOf('DraftRevision');
  const schemaVerIdx = headers.indexOf('SchemaVersion');
  const updatedIdx = headers.indexOf('UpdatedAt');

  assert.equal(row1[pIdIdx], '2030-07');
  assert.equal(row1[stateIdx], 'DRAFT');
  assert.equal(row1[revIdx], 0);
  assert.equal(row1[draftRevIdx], 0);
  assert.equal(row1[schemaVerIdx], 2);
  assert.equal(row1[updatedIdx], '2030-01-01');

  // Check row 2 preserved
  const row2 = h.grids.RosterPeriods[2];
  assert.equal(row2[pIdIdx], '2030-08');
  assert.equal(row2[stateIdx], 'DRAFT');
  assert.equal(row2[updatedIdx], '2030-01-02');
});

test('schema upgrade is strictly idempotent on repeated calls', () => {
  const h = setup();
  h.grids.RosterPeriods = [
    ['PeriodId', 'SchemaVersion', 'EnrolledAt', 'EnrolledBy'],
    ['2030-07', 2, '2030-01-01', 'owner']
  ];

  h.context.rosterLifecycleEnsureSchema_('RosterPeriods');
  const afterFirst = JSON.stringify(h.grids.RosterPeriods);

  h.context.rosterLifecycleEnsureSchema_('RosterPeriods');
  const afterSecond = JSON.stringify(h.grids.RosterPeriods);

  assert.equal(afterFirst, afterSecond);
});

// ==========================================
// 2. PUBLISH SUCCESS & VERIFICATION TESTS
// ==========================================

test('valid DRAFT -> PUBLISHED publish commits snapshot, projection, event, and confirmed log', () => {
  const h = setup();
  const op = makePublishOp();
  const res = publish(h, op);

  assert.equal(res.ok, true);
  assert.equal(res.state, 'PUBLISHED');
  assert.equal(res.revision, 1);
  assert.ok(res.plannedSnapshotId);
  assert.ok(res.projectionChecksum);
  assert.equal(res.assignmentCount, 2);

  // Verify RosterPeriods
  const period = h.context.rosterLifecycleFindPeriod_('2030-07');
  assert.equal(period.State, 'PUBLISHED');
  assert.equal(Number(period.Revision), 1);
  assert.equal(period.PlannedSnapshotId, res.plannedSnapshotId);
  assert.equal(period.ProjectionChecksum, res.projectionChecksum);
  assert.equal(period.LastOperationId, op.operationId);

  // Verify RosterAssignments
  const assignments = h.context.rosterLifecycleFindAssignmentsBySnapshot_(res.plannedSnapshotId);
  assert.equal(assignments.length, 2);
  assert.equal(assignments[0].Layer, 'PLANNED');
  assert.equal(assignments[0].OperationId, op.operationId);

  // Verify RosterEvents
  const events = h.context.rosterLifecycleFindEventsByOperation_(op.operationId);
  assert.equal(events.length, 1);
  assert.equal(events[0].EventType, 'PUBLISH');
  assert.equal(events[0].PeriodId, '2030-07');

  // Verify OperationLog
  const log = h.context.rosterLifecycleFindOperationLog_(op.operationId);
  assert.equal(log.Status, 'CONFIRMED');
  assert.equal(Number(log.ResultRevision), 1);
  assert.equal(log.ErrorCode, '');

  // Verify MasterRoster projection
  const masterTable = h.context.rosterV2ReadTable_('MasterRoster');
  const projectedRows = masterTable.rows.filter(r => String(r[1]).startsWith('2030-07'));
  assert.equal(projectedRows.length, 2);
});

test('persisted projection checksum matches domain contract and verifies readback', () => {
  const h = setup();
  const op = makePublishOp();
  const res = publish(h, op);

  const masterTable = h.context.rosterV2ReadTable_('MasterRoster');
  const rows = masterTable.rows.map(r => ({ Name: r[0], Date: r[1], Shift: r[2] }))
    .filter(r => r.Date.startsWith('2030-07'));

  const expectedChecksum = lifecycle.computeProjectionChecksum(rows, digest);
  assert.equal(res.projectionChecksum, expectedChecksum);
});

// ==========================================
// 3. PUBLISH IDEMPOTENCY & REPLAY TESTS
// ==========================================

test('exact same publish operation replay after success returns confirmed result with no duplicate rows', () => {
  const h = setup();
  const op = makePublishOp();
  const first = publish(h, op);
  assert.equal(first.ok, true);

  const assignCount = h.grids.RosterAssignments.length;
  const eventCount = h.grids.RosterEvents.length;
  const logCount = h.grids.OperationLog.length;

  for (let i = 0; i < 3; i++) {
    const replay = publish(h, op);
    assert.deepEqual(replay, first);
  }

  assert.equal(h.grids.RosterAssignments.length, assignCount, 'Assignments must not be duplicated');
  assert.equal(h.grids.RosterEvents.length, eventCount, 'Events must not be duplicated');
  assert.equal(h.grids.OperationLog.length, logCount, 'Logs must not be duplicated');
});

test('retry after partial planned assignment persistence deduplicates and finishes successfully', () => {
  const h = setup();
  const op = makePublishOp();

  // Injected fault: crash after writing first assignment
  let appendCount = 0;
  const originalAppend = h.context.rosterLifecycleAppendRows_;
  h.context.rosterLifecycleAppendRows_ = function(sheetName, records) {
    if (sheetName === 'RosterAssignments' && ++appendCount === 1) {
      originalAppend(sheetName, records.slice(0, 1));
      throw new Error('Injected crash after partial assignment write');
    }
    return originalAppend(sheetName, records);
  };

  const failed = publish(h, op);
  assert.equal(failed.ok, false);
  assert.equal(failed.error.code, 'RECOVERY_REQUIRED');

  // Verify only 1 assignment was written and period is still DRAFT
  assert.equal(h.context.rosterLifecycleFindPeriod_('2030-07').State, 'DRAFT');
  assert.equal(h.grids.RosterAssignments.length, 2); // header + 1 row

  // Restore and retry with same operationId
  h.context.rosterLifecycleAppendRows_ = originalAppend;
  const retry = publish(h, op);

  assert.equal(retry.ok, true);
  assert.equal(retry.state, 'PUBLISHED');
  assert.equal(h.grids.RosterAssignments.length, 3); // header + 2 rows total, NO duplicate of first row!
});

test('critical retry window: retry after RosterPeriods state mutation before journal confirmation recovers successfully', () => {
  const h = setup();
  const op = makePublishOp();

  // Injected fault: simulate crash after RosterPeriods is written to PUBLISHED but before journal CONFIRMED
  const originalWriteRow = h.context.rosterLifecycleWriteRow_;
  let periodWritten = false;
  h.context.rosterLifecycleWriteRow_ = function(sheetName, record, row) {
    if (sheetName === 'RosterPeriods' && record.State === 'PUBLISHED') {
      periodWritten = true;
      originalWriteRow(sheetName, record, row);
      throw new Error('Injected crash right after RosterPeriods mutation before OperationLog confirmation');
    }
    return originalWriteRow(sheetName, record, row);
  };

  const crashResult = publish(h, op);
  assert.equal(periodWritten, true);
  assert.equal(crashResult.ok, false);

  // Restore writer
  h.context.rosterLifecycleWriteRow_ = originalWriteRow;

  // The period is PUBLISHED, but the journal was not marked CONFIRMED.
  // When the client retries with the SAME operationId:
  const retryResult = publish(h, op);

  assert.equal(retryResult.ok, true);
  assert.equal(retryResult.state, 'PUBLISHED');
  assert.equal(retryResult.revision, 1);
  assert.equal(retryResult.operationId, op.operationId);

  // OperationLog must now be CONFIRMED
  const log = h.context.rosterLifecycleFindOperationLog_(op.operationId);
  assert.equal(log.Status, 'CONFIRMED');
  assert.ok(log.ResultJson);
});

// ==========================================
// 4. PUBLISH FAULT INJECTION TESTS
// ==========================================

test('failure during MasterRoster write leaves period in DRAFT and is recoverable', () => {
  const h = setup();
  const op = makePublishOp();

  let masterWriteAttempted = false;
  const originalFlush = h.context.SpreadsheetApp.flush;
  h.context.SpreadsheetApp.flush = function() {
    if (h.grids.MasterRoster && h.grids.MasterRoster.some(r => String(r[1]).startsWith('2030-07')) && !masterWriteAttempted) {
      masterWriteAttempted = true;
      throw new Error('Injected MasterRoster write failure');
    }
    return originalFlush.apply(this, arguments);
  };

  const failed = publish(h, op);
  assert.equal(failed.ok, false);
  assert.equal(h.context.rosterLifecycleFindPeriod_('2030-07').State, 'DRAFT');

  // Retry succeeds
  h.context.SpreadsheetApp.flush = originalFlush;
  const retry = publish(h, op);
  assert.equal(retry.ok, true);
  assert.equal(retry.state, 'PUBLISHED');
});

test('failure during checksum verification sets RECOVERY_REQUIRED and blocks publication', () => {
  const h = setup();
  const op = makePublishOp();

  const originalDigest = h.context.rosterV2Digest_;
  let corrupted = false;
  h.context.rosterV2Digest_ = function(content) {
    if (!corrupted && typeof content === 'string' && content.includes('"Name"')) {
      corrupted = true;
      return '0000000000000000000000000000000000000000000000000000000000000000';
    }
    return originalDigest.apply(this, arguments);
  };

  const failed = publish(h, op);
  assert.equal(failed.ok, false);
  assert.equal(failed.error.code, 'CHECKSUM_MISMATCH');
  assert.equal(h.context.rosterLifecycleFindPeriod_('2030-07').State, 'DRAFT');

  // Journal marked RECOVERY_REQUIRED
  const log = h.context.rosterLifecycleFindOperationLog_(op.operationId);
  assert.equal(log.Status, 'RECOVERY_REQUIRED');

  // Restore and retry
  h.context.rosterV2Digest_ = originalDigest;
  const retry = publish(h, op);
  assert.equal(retry.ok, true);
  assert.equal(retry.state, 'PUBLISHED');
});

// ==========================================
// 5. IMMUTABILITY TESTS
// ==========================================

test('re-publishing an already PUBLISHED period with a different operationId is rejected as SNAPSHOT_IMMUTABLE', () => {
  const h = setup();
  const op1 = makePublishOp();
  const res1 = publish(h, op1);
  assert.equal(res1.ok, true);

  const op2 = makePublishOp(); // new operationId
  const res2 = publish(h, op2);

  assert.equal(res2.ok, false);
  assert.equal(res2.error.code, 'SNAPSHOT_IMMUTABLE');
});

test('publishing a CLOSED period is rejected as INVALID_STATE', () => {
  const h = setup();
  const pubOp = makePublishOp();
  publish(h, pubOp);

  const closeOp = makeCloseOp();
  close(h, closeOp);
  assert.equal(h.context.rosterLifecycleFindPeriod_('2030-07').State, 'CLOSED');

  const pubOp2 = makePublishOp();
  const res = publish(h, pubOp2);
  assert.equal(res.ok, false);
  assert.equal(res.error.code, 'INVALID_STATE');
});

// ==========================================
// 6. LEGACY UPLOAD PROTECTION TESTS
// ==========================================

test('legacy upload allows non-enrolled legacy month when permitted', () => {
  const h = setup();
  // 2030-09 is not in RosterPeriods
  const uploadData = {
    action: 'uploadmasterroster',
    targetMonth: '2030-09',
    rows: [{ name: 'Person A', date: '2030-09-01', shift: 'AM' }]
  };
  const res = h.post(uploadData);
  assert.equal(res.result, 'success');
});

test('legacy upload rejects enrolled/protected period before mutating MasterRoster', () => {
  const h = setup();
  // 2030-07 is enrolled in RosterPeriods (SchemaVersion 2)
  const masterBefore = JSON.stringify(h.grids.MasterRoster);
  const uploadData = {
    action: 'uploadmasterroster',
    targetMonth: '2030-07',
    rows: [{ name: 'Person A', date: '2030-07-01', shift: 'AM' }]
  };
  const res = h.post(uploadData);
  assert.equal(res.result, 'error');
  assert.match(res.message, /protected period/);
  assert.equal(JSON.stringify(h.grids.MasterRoster), masterBefore);
});

test('mixed legacy and protected upload fails atomically and alters no data', () => {
  const h = setup();
  const masterBefore = JSON.stringify(h.grids.MasterRoster);
  const uploadData = {
    action: 'uploadmasterroster',
    targetMonth: '2030-09', // targetMonth itself not enrolled
    rows: [
      { name: 'Person A', date: '2030-09-01', shift: 'AM' },
      { name: 'Person B', date: '2030-07-01', shift: 'PM' } // touches enrolled 2030-07!
    ]
  };
  const res = h.post(uploadData);
  assert.equal(res.result, 'error');
  assert.match(res.message, /protected period/);
  assert.equal(JSON.stringify(h.grids.MasterRoster), masterBefore);
});

test('global legacy switch legacy_upload_enabled=false rejects regardless of enrollment', () => {
  const h = setup();
  h.grids.Settings.push(['legacy_upload_enabled', 'false']);
  const uploadData = {
    action: 'uploadmasterroster',
    targetMonth: '2030-09',
    rows: [{ name: 'Person A', date: '2030-09-01', shift: 'AM' }]
  };
  const res = h.post(uploadData);
  assert.equal(res.result, 'error');
  assert.match(res.message, /Legacy roster upload is disabled/);
});

// ==========================================
// 7. CLOSE TESTS
// ==========================================

test('valid close transitions PUBLISHED -> CLOSED, increments revision, and appends CLOSE event', () => {
  const h = setup();
  publish(h, makePublishOp());

  const closeOp = makeCloseOp({ expectedRevision: 1 });
  const res = close(h, closeOp);

  assert.equal(res.ok, true);
  assert.equal(res.state, 'CLOSED');
  assert.equal(res.revision, 2);

  const period = h.context.rosterLifecycleFindPeriod_('2030-07');
  assert.equal(period.State, 'CLOSED');
  assert.equal(Number(period.Revision), 2);
  assert.ok(period.ClosedAt);
  assert.equal(period.ClosedBy, 'admin@example.invalid');

  const events = h.context.rosterLifecycleFindEventsByOperation_(closeOp.operationId);
  assert.equal(events.length, 1);
  assert.equal(events[0].EventType, 'CLOSE');
});

test('close rejects period not in PUBLISHED state', () => {
  const h = setup();
  // 2030-07 is in DRAFT
  const closeOp = makeCloseOp({ expectedRevision: 0 });
  const res = close(h, closeOp);
  assert.equal(res.ok, false);
  assert.equal(res.error.code, 'INVALID_STATE');
});

test('close is blocked when pending journal operations exist on the entity', () => {
  const h = setup();
  publish(h, makePublishOp());

  // Inject a PENDING operation on period:2030-07 in OperationLog
  h.grids.OperationLog.push([
    crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID(),
    'PERIOD_PUBLISH', 'period:2030-07', 1, 2, '0000000000000000000000000000000000000000000000000000000000000000',
    'PENDING', '', '', '2030-01-01', ''
  ]);

  const closeOp = makeCloseOp({ expectedRevision: 1 });
  const res = close(h, closeOp);

  assert.equal(res.ok, false);
  assert.equal(res.error.code, 'RECONCILIATION_FAILED');
  assert.match(res.error.message, /pending operations remain/);
});

test('exact close operation replay is idempotent and returns confirmed result', () => {
  const h = setup();
  publish(h, makePublishOp());

  const closeOp = makeCloseOp({ expectedRevision: 1 });
  const first = close(h, closeOp);
  assert.equal(first.ok, true);

  const eventsBefore = h.grids.RosterEvents.length;
  for (let i = 0; i < 3; i++) {
    const replay = close(h, closeOp);
    assert.deepEqual(replay, first);
  }
  assert.equal(h.grids.RosterEvents.length, eventsBefore);
});

test('retry of close after state mutation before journal confirmation recovers cleanly', () => {
  const h = setup();
  publish(h, makePublishOp());

  const closeOp = makeCloseOp({ expectedRevision: 1 });
  const originalWriteRow = h.context.rosterLifecycleWriteRow_;
  h.context.rosterLifecycleWriteRow_ = function(sheetName, record, row) {
    if (sheetName === 'RosterPeriods' && record.State === 'CLOSED') {
      originalWriteRow(sheetName, record, row);
      throw new Error('Injected crash right after period CLOSED mutation');
    }
    return originalWriteRow(sheetName, record, row);
  };

  const failed = close(h, closeOp);
  assert.equal(failed.ok, false);

  h.context.rosterLifecycleWriteRow_ = originalWriteRow;
  const retry = close(h, closeOp);
  assert.equal(retry.ok, true);
  assert.equal(retry.state, 'CLOSED');
  assert.equal(retry.revision, 2);
});

// ==========================================
// 8. REOPEN TESTS
// ==========================================

test('valid reopen transitions CLOSED -> PUBLISHED with non-empty reason and appends REOPEN event', () => {
  const h = setup();
  publish(h, makePublishOp());
  close(h, makeCloseOp());

  const reopenOp = makeReopenOp({ expectedRevision: 2, reason: 'Staff emergency schedule change' });
  const res = reopen(h, reopenOp);

  assert.equal(res.ok, true);
  assert.equal(res.state, 'PUBLISHED');
  assert.equal(res.revision, 3);
  assert.equal(res.reason, 'Staff emergency schedule change');

  const period = h.context.rosterLifecycleFindPeriod_('2030-07');
  assert.equal(period.State, 'PUBLISHED');
  assert.equal(Number(period.Revision), 3);
  assert.equal(period.ClosedAt, '');
  assert.equal(period.ClosedBy, '');

  const events = h.context.rosterLifecycleFindEventsByOperation_(reopenOp.operationId);
  assert.equal(events.length, 1);
  assert.equal(events[0].EventType, 'REOPEN');
  assert.equal(events[0].AdminNote, 'Staff emergency schedule change');
});

test('reopen rejects empty or whitespace-only reason string with REOPEN_REASON_REQUIRED', () => {
  const h = setup();
  publish(h, makePublishOp());
  close(h, makeCloseOp());

  for (const emptyReason of ['', '   ']) {
    const reopenOp = makeReopenOp({ expectedRevision: 2, reason: emptyReason });
    const res = reopen(h, reopenOp);
    assert.equal(res.ok, false);
    assert.equal(res.error.code, 'REOPEN_REASON_REQUIRED');
  }
});

test('reopen rejects period not in CLOSED state', () => {
  const h = setup();
  publish(h, makePublishOp());
  // Period is in PUBLISHED state, not CLOSED
  const reopenOp = makeReopenOp({ expectedRevision: 1 });
  const res = reopen(h, reopenOp);
  assert.equal(res.ok, false);
  assert.equal(res.error.code, 'INVALID_STATE');
});

test('exact reopen operation replay is idempotent', () => {
  const h = setup();
  publish(h, makePublishOp());
  close(h, makeCloseOp());

  const reopenOp = makeReopenOp({ expectedRevision: 2 });
  const first = reopen(h, reopenOp);
  assert.equal(first.ok, true);

  const eventsBefore = h.grids.RosterEvents.length;
  for (let i = 0; i < 3; i++) {
    const replay = reopen(h, reopenOp);
    assert.deepEqual(replay, first);
  }
  assert.equal(h.grids.RosterEvents.length, eventsBefore);
});

test('retry of reopen after state mutation before journal confirmation recovers cleanly', () => {
  const h = setup();
  publish(h, makePublishOp());
  close(h, makeCloseOp());

  const reopenOp = makeReopenOp({ expectedRevision: 2 });
  const originalWriteRow = h.context.rosterLifecycleWriteRow_;
  h.context.rosterLifecycleWriteRow_ = function(sheetName, record, row) {
    if (sheetName === 'RosterPeriods' && record.State === 'PUBLISHED') {
      originalWriteRow(sheetName, record, row);
      throw new Error('Injected crash right after period REOPEN mutation');
    }
    return originalWriteRow(sheetName, record, row);
  };

  const failed = reopen(h, reopenOp);
  assert.equal(failed.ok, false);

  h.context.rosterLifecycleWriteRow_ = originalWriteRow;
  const retry = reopen(h, reopenOp);
  assert.equal(retry.ok, true);
  assert.equal(retry.state, 'PUBLISHED');
  assert.equal(retry.revision, 3);
});

test('complete audit history preserved across DRAFT -> PUBLISH -> CLOSE -> REOPEN in RosterEvents', () => {
  const h = setup();
  const pubOp = makePublishOp();
  publish(h, pubOp);

  const closeOp = makeCloseOp({ expectedRevision: 1, adminNote: 'Audited monthly close' });
  close(h, closeOp);

  const reopenOp = makeReopenOp({ expectedRevision: 2, reason: 'Audited correction reopen' });
  reopen(h, reopenOp);

  const events = h.context.rosterLifecycleFindEventsByPeriod_('2030-07');
  assert.equal(events.length, 3);
  assert.equal(events[0].EventType, 'PUBLISH');
  assert.equal(events[1].EventType, 'CLOSE');
  assert.equal(events[1].AdminNote, 'Audited monthly close');
  assert.equal(events[2].EventType, 'REOPEN');
  assert.equal(events[2].AdminNote, 'Audited correction reopen');
});
