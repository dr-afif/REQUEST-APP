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
const person3 = '33333333-3333-4333-8333-333333333333';

function setup(options = {}) {
  const h = harness(currentSource, {
    activeEmail: 'admin@example.invalid',
    adminEmail: 'admin@example.invalid',
    ...options
  });
  h.context.SpreadsheetApp.flush = () => {};
  h.context.Utilities.getUuid = () => crypto.randomUUID();
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
    [person2, 'MO', 'Dr. Siti', '[]', true],
    [person3, 'MO', 'Dr. Tan', '[]', true]
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
  adminNote = 'Publish baseline',
  ...rest
} = {}) {
  const opId = crypto.randomUUID();
  const cId = crypto.randomUUID();
  const tId = crypto.randomUUID();
  const cells = draftCells || {
    [`${person1}/${periodId}-01`]: [{ rawShift: 'AM' }],
    [`${person2}/${periodId}-01`]: [{ rawShift: 'PM' }],
    [`${person3}/${periodId}-01`]: [{ rawShift: 'ND' }],
    [`${person1}/${periodId}-02`]: [{ rawShift: 'AM' }],
    [`${person2}/${periodId}-02`]: [{ rawShift: 'PM' }]
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

function setupPublished(options = {}) {
  const h = setup(options);
  const pubOp = makePublishOp();
  const pubRes = h.post({ action: 'rosterv2publish', ...pubOp });
  assert.equal(pubRes.ok, true, 'publish baseline must succeed');
  assert.equal(pubRes.state, 'PUBLISHED');
  assert.equal(pubRes.revision, 1);
  return { h, periodId: pubOp.periodId, pubRes, pubOp };
}

function makeAmendOp({
  periodId = '2030-07',
  expectedRevision = 1,
  personId = person1,
  date = '2030-07-01',
  dutyDomain = 'MO',
  afterAssignments = [{ shiftCode: 'PM', rawShift: 'PM' }],
  publicReasonCode = 'ADMIN_CORRECTION',
  adminNote = 'Single correction note',
  ...rest
} = {}) {
  const opId = crypto.randomUUID();
  const cId = crypto.randomUUID();
  const tId = crypto.randomUUID();
  const meaning = {
    operationId: opId,
    clientId: cId,
    tabId: tId,
    operationType: 'PERIOD_AMEND',
    entityKey: `period:${periodId}`,
    expectedRevision,
    payload: {
      periodId,
      eventType: 'ADMIN_CORRECTION',
      personId,
      date,
      dutyDomain,
      afterAssignments,
      publicReasonCode,
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
    personId,
    date,
    dutyDomain,
    afterAssignments,
    publicReasonCode,
    adminNote,
    payloadHash,
    ...rest
  };
}

function makeSwapOp({
  periodId = '2030-07',
  expectedRevision = 1,
  person1Target = { personId: person1, date: '2030-07-01', dutyDomain: 'MO' },
  person2Target = { personId: person2, date: '2030-07-01', dutyDomain: 'MO' },
  publicReasonCode = 'SHIFT_SWAP',
  adminNote = 'Swap note between person1 and person2',
  ...rest
} = {}) {
  const opId = crypto.randomUUID();
  const cId = crypto.randomUUID();
  const tId = crypto.randomUUID();
  const meaning = {
    operationId: opId,
    clientId: cId,
    tabId: tId,
    operationType: 'PERIOD_AMEND',
    entityKey: `period:${periodId}`,
    expectedRevision,
    payload: {
      periodId,
      eventType: 'SWAP',
      person1: person1Target,
      person2: person2Target,
      publicReasonCode,
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
    eventType: 'SWAP',
    person1: person1Target,
    person2: person2Target,
    publicReasonCode,
    adminNote,
    payloadHash,
    ...rest
  };
}

function makeReversalOp({
  periodId = '2030-07',
  expectedRevision = 2,
  targetEventId,
  adminNote = 'Reversing amendment',
  ...rest
} = {}) {
  const opId = crypto.randomUUID();
  const cId = crypto.randomUUID();
  const tId = crypto.randomUUID();
  const meaning = {
    operationId: opId,
    clientId: cId,
    tabId: tId,
    operationType: 'PERIOD_AMEND_REVERSAL',
    entityKey: `period:${periodId}`,
    expectedRevision,
    payload: {
      periodId,
      targetEventId,
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
    targetEventId,
    adminNote,
    payloadHash,
    ...rest
  };
}

function makeCloseOp({
  periodId = '2030-07',
  expectedRevision = 1,
  adminNote = 'Closing period',
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
  reason = 'Reopening test period',
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

const amend = (h, op) => h.post({ action: 'rosterv2amend', ...op });
const amendReversal = (h, op) => h.post({ action: 'rosterv2amendreversal', ...op });
const amendmentHistory = (h, periodId, params = {}) => h.get('rosterv2amendmenthistory', { periodId, ...params });
const plannedRoster = (h, periodId, params = {}) => h.get('rosterv2planned', { periodId, ...params });
const close = (h, op) => h.post({ action: 'rosterv2close', ...op });
const reopen = (h, op) => h.post({ action: 'rosterv2reopen', ...op });
const status = (h, opId) => h.get('rosterv2operation', { operationId: opId });
const recover = (h, opId) => h.post({ action: 'rosterv2lifecyclerecover', operationId: opId });

// ==========================================
// 1. DETERMINISTIC EVENTID & LINEID STRATEGY
// ==========================================

test('1. First gate: deterministic EventId and LineId strategy across retries and distinct operations', () => {
  const opId = '44444444-4444-4444-8444-444444444444';
  const id1 = lifecycle.deterministicEventId(opId, 'ADMIN_CORRECTION', person1, '2030-07-01', 'MO');
  const id2 = lifecycle.deterministicEventId(opId, 'ADMIN_CORRECTION', person1, '2030-07-01', 'MO');
  assert.equal(id1, id2, 'Same operationId and canonical context must produce byte-identical EventId');

  const line1A = lifecycle.deterministicLineId(id1, 0, person1, '2030-07-01', 'MO');
  const line1B = lifecycle.deterministicLineId(id2, 0, person1, '2030-07-01', 'MO');
  assert.equal(line1A, line1B, 'Deterministic line IDs must match exactly across replays');

  const otherOpId = '55555555-5555-4555-8555-555555555555';
  const otherId = lifecycle.deterministicEventId(otherOpId, 'ADMIN_CORRECTION', person1, '2030-07-01', 'MO');
  assert.notEqual(id1, otherId, 'Different operationIds must produce distinct EventIds');
});

// ==========================================
// 2. ADMIN_CORRECTION ENDPOINT
// ==========================================

test('2. ADMIN_CORRECTION: transitions PUBLISHED -> AMENDED, derives Before/Planned server-side, verifies checksum', () => {
  const { h, periodId } = setupPublished();

  // Snapshot Planned assignments & WeeklyOffSnapshots before amendment
  const plannedBefore = JSON.stringify(h.grids.RosterAssignments.filter(r => r[2] === 'PLANNED'));
  const weeklyOffBefore = JSON.stringify(h.grids.WeeklyOffSnapshots);

  const amendOp = makeAmendOp({
    periodId,
    expectedRevision: 1,
    personId: person1,
    date: '2030-07-01',
    dutyDomain: 'MO',
    afterAssignments: [{ shiftCode: 'PM', rawShift: 'PM' }],
    publicReasonCode: 'ADMIN_CORRECTION',
    adminNote: 'Admin fixed shift'
  });

  const res = amend(h, amendOp);
  assert.equal(res.ok, true, 'amend should succeed');
  assert.equal(res.state, 'AMENDED');
  assert.equal(res.revision, 2);
  assert.ok(res.eventId);
  assert.ok(res.projectionChecksum);

  // Check RosterPeriods row
  const periodRow = h.grids.RosterPeriods.find(r => r[0] === periodId);
  assert.equal(periodRow[1], 'AMENDED');
  assert.equal(periodRow[2], 2);
  assert.equal(periodRow[9], res.projectionChecksum);
  assert.equal(periodRow[11], amendOp.operationId);

  // Check RosterEvents row
  const eventRows = h.grids.RosterEvents.slice(1).filter(r => r[4] === periodId && r[2] === 'ADMIN_CORRECTION');
  assert.equal(eventRows.length, 1);
  const ev = eventRows[0];
  assert.equal(ev[0], res.eventId);
  assert.equal(ev[3], amendOp.operationId);
  assert.equal(ev[5], 1); // BaseRevision
  assert.equal(ev[6], 2); // ResultRevision
  assert.equal(ev[7], person1);
  assert.equal(ev[10], 'MO'); // DutyDomain
  // Planned derived server-side
  const plannedVal = JSON.parse(ev[11]);
  assert.equal(plannedVal[0].ShiftCode, 'AM');
  // Before derived server-side
  const beforeVal = JSON.parse(ev[12]);
  assert.equal(beforeVal[0].ShiftCode, 'AM');
  // After
  const afterVal = JSON.parse(ev[13]);
  assert.equal(afterVal[0].ShiftCode, 'PM');

  // Verify Planned rows and WeeklyOffSnapshots are 100% byte-identical
  const plannedAfter = JSON.stringify(h.grids.RosterAssignments.filter(r => r[2] === 'PLANNED'));
  const weeklyOffAfter = JSON.stringify(h.grids.WeeklyOffSnapshots);
  assert.equal(plannedAfter, plannedBefore, 'Planned rows must remain immutable');
  assert.equal(weeklyOffAfter, weeklyOffBefore, 'WeeklyOffSnapshots must remain immutable');

  // Verify MasterRoster projection updated
  const masterRows = h.grids.MasterRoster.slice(1);
  const p1Day1 = masterRows.find(r => r[0] === 'Dr. Ali' && r[1] === '2030-07-01');
  assert.ok(p1Day1);
  assert.equal(p1Day1[2], 'PM', 'MasterRoster should reflect new Current PM shift');
});

test('3. ADMIN_CORRECTION: AMENDED -> AMENDED preserves revision progression and derives updated BeforeCurrentJson', () => {
  const { h, periodId } = setupPublished();

  // First amendment: person1 day 1 -> PM (rev 1 -> 2)
  const op1 = makeAmendOp({ periodId, expectedRevision: 1, personId: person1, date: '2030-07-01', afterAssignments: [{ shiftCode: 'PM' }] });
  const res1 = amend(h, op1);
  assert.equal(res1.state, 'AMENDED');
  assert.equal(res1.revision, 2);

  // Second amendment: person1 day 1 -> ND (rev 2 -> 3)
  const op2 = makeAmendOp({ periodId, expectedRevision: 2, personId: person1, date: '2030-07-01', afterAssignments: [{ shiftCode: 'ND' }] });
  const res2 = amend(h, op2);
  assert.equal(res2.state, 'AMENDED');
  assert.equal(res2.revision, 3);

  // Check that second event has BeforeCurrentJson reflecting PM (from first amendment)
  const eventRows = h.grids.RosterEvents.slice(1).filter(r => r[3] === op2.operationId);
  assert.equal(eventRows.length, 1);
  const beforeVal = JSON.parse(eventRows[0][12]);
  assert.equal(beforeVal[0].ShiftCode, 'PM', 'BeforeCurrentJson must be derived from previous confirmed amendment');
});

test('4. ADMIN_CORRECTION: requires explicit DutyDomain and rejects when missing', () => {
  const { h, periodId } = setupPublished();
  const op = makeAmendOp({ periodId, expectedRevision: 1, dutyDomain: '' });
  const res = amend(h, op);
  assert.equal(res.ok, false);
  assert.equal(res.error.code, 'VALIDATION_FAILED');
});

// ==========================================
// 3. SWAP ENDPOINT
// ==========================================

test('5. SWAP: writes two lines, single EventId, single revision increment, updates both cells atomically', () => {
  const { h, periodId } = setupPublished();

  // Before swap: person1 day 1 = AM, person2 day 1 = PM
  const swapOp = makeSwapOp({
    periodId,
    expectedRevision: 1,
    person1Target: { personId: person1, date: '2030-07-01', dutyDomain: 'MO' },
    person2Target: { personId: person2, date: '2030-07-01', dutyDomain: 'MO' },
    adminNote: 'Swap AM and PM'
  });

  const res = amend(h, swapOp);
  assert.equal(res.ok, true, 'swap should succeed');
  assert.equal(res.state, 'AMENDED');
  assert.equal(res.revision, 2, 'Revision must increment exactly once for two-line SWAP');
  assert.equal(res.lineCount, 2);

  // Verify RosterEvents has 2 lines with the same EventId
  const swapRows = h.grids.RosterEvents.slice(1).filter(r => r[3] === swapOp.operationId);
  assert.equal(swapRows.length, 2);
  assert.equal(swapRows[0][0], swapRows[1][0], 'Both lines must share the exact same EventId');
  assert.notEqual(swapRows[0][1], swapRows[1][1], 'LineIds must be distinct');

  // Verify server derived both before and after assignments correctly
  const p1Line = swapRows.find(r => r[7] === person1);
  const p2Line = swapRows.find(r => r[7] === person2);
  assert.ok(p1Line && p2Line);

  assert.equal(JSON.parse(p1Line[12])[0].ShiftCode, 'AM'); // p1 before
  assert.equal(JSON.parse(p1Line[13])[0].ShiftCode, 'PM'); // p1 after (got p2 shift)
  assert.equal(JSON.parse(p2Line[12])[0].ShiftCode, 'PM'); // p2 before
  assert.equal(JSON.parse(p2Line[13])[0].ShiftCode, 'AM'); // p2 after (got p1 shift)

  // Verify MasterRoster projection has both changes
  const masterRows = h.grids.MasterRoster.slice(1);
  const p1Master = masterRows.find(r => r[0] === 'Dr. Ali' && r[1] === '2030-07-01');
  const p2Master = masterRows.find(r => r[0] === 'Dr. Siti' && r[1] === '2030-07-01');
  assert.equal(p1Master[2], 'PM');
  assert.equal(p2Master[2], 'AM');
});

// ==========================================
// 4. IDEMPOTENCY & CONCURRENCY
// ==========================================

test('6. Idempotency: exact replay returns confirmed cached result without duplicate rows', () => {
  const { h, periodId } = setupPublished();
  const amendOp = makeAmendOp({ periodId, expectedRevision: 1 });

  const res1 = amend(h, amendOp);
  assert.equal(res1.ok, true);

  const eventCount1 = h.grids.RosterEvents.length;
  const masterCount1 = h.grids.MasterRoster.length;

  // Replay identical operation
  const res2 = amend(h, amendOp);
  assert.equal(res2.ok, true);
  assert.equal(res2.eventId, res1.eventId);
  assert.equal(res2.revision, res1.revision);

  assert.equal(h.grids.RosterEvents.length, eventCount1, 'No duplicate event rows on replay');
  assert.equal(h.grids.MasterRoster.length, masterCount1, 'No duplicate MasterRoster rows on replay');
});

test('7. Idempotency: same operationId with changed payload fails closed with IDEMPOTENCY_MISMATCH', () => {
  const { h, periodId } = setupPublished();
  const amendOp1 = makeAmendOp({ periodId, expectedRevision: 1, afterAssignments: [{ shiftCode: 'PM' }] });
  const res1 = amend(h, amendOp1);
  assert.equal(res1.ok, true);

  // Same opId, different shiftCode
  const amendOp2 = { ...amendOp1, afterAssignments: [{ shiftCode: 'ND' }] };
  const res2 = amend(h, amendOp2);
  assert.equal(res2.ok, false);
  assert.equal(res2.error.code, 'IDEMPOTENCY_MISMATCH');
});

test('8. Concurrency: stale expectedRevision fails with REVISION_CONFLICT', () => {
  const { h, periodId } = setupPublished();
  const op = makeAmendOp({ periodId, expectedRevision: 99 });
  const res = amend(h, op);
  assert.equal(res.ok, false);
  assert.equal(res.error.code, 'REVISION_CONFLICT');
});

// ==========================================
// 5. CONFIRMED-EVENT VISIBILITY & ATOMIC RETRY
// ==========================================

test('9. Visibility contract: unconfirmed PENDING / RECOVERY_REQUIRED events excluded from normal Current reconstruction', () => {
  const { h, periodId } = setupPublished();

  // Inject a PENDING operation log and unconfirmed event row
  const fakeOpId = crypto.randomUUID();
  h.grids.OperationLog.push([
    fakeOpId, fakeOpId, fakeOpId, 'PERIOD_AMEND', `period:${periodId}`,
    1, 2, '0000000000000000000000000000000000000000000000000000000000000000',
    'PENDING', '', '', new Date().toISOString(), ''
  ]);
  h.grids.RosterEvents.push([
    crypto.randomUUID(), crypto.randomUUID(), 'ADMIN_CORRECTION', fakeOpId, periodId,
    1, 2, person1, '[]', '2030-07-01', 'MO',
    JSON.stringify([{ ShiftCode: 'AM' }]), JSON.stringify([{ ShiftCode: 'AM' }]), JSON.stringify([{ ShiftCode: 'ND' }]),
    'ADMIN_CORRECTION', 'unconfirmed note', false, '', '[]', '', new Date().toISOString(), 'admin@example.invalid'
  ]);

  // A legitimate amendment now executes
  const legitOp = makeAmendOp({ periodId, expectedRevision: 1, personId: person1, date: '2030-07-02' });
  const res = amend(h, legitOp);
  assert.equal(res.ok, true);

  // Authoritative Current derived by legitOp must have ignored the PENDING event
  // person1 on 2030-07-01 must still be AM, not ND!
  const masterRows = h.grids.MasterRoster.slice(1);
  const p1Day1 = masterRows.find(r => r[0] === 'Dr. Ali' && r[1] === '2030-07-01');
  assert.equal(p1Day1[2], 'AM', 'Unconfirmed event must NOT be visible to normal Current projection');
});

test('10. SWAP partial write recovery: retry after line 1 persists only missing line 2 without duplicates', () => {
  const { h, periodId } = setupPublished();
  const swapOp = makeSwapOp({ periodId, expectedRevision: 1 });

  // Simulate failure after line 1 was written by intercepting appendRows
  const origAppend = h.context.rosterLifecycleAppendRows_;
  let appendCount = 0;
  h.context.rosterLifecycleAppendRows_ = function(sheetName, records) {
    if (sheetName === 'RosterEvents' && appendCount === 0) {
      appendCount++;
      // Write ONLY the first record to simulate partial crash after writing line 1
      origAppend(sheetName, [records[0]]);
      throw new Error('Simulated crash during multi-line event write');
    }
    return origAppend.apply(this, arguments);
  };

  // First attempt fails during appendRows after persisting line 1
  const firstRes = amend(h, swapOp);
  assert.equal(firstRes.ok, false);

  // Restore normal appendRows
  h.context.rosterLifecycleAppendRows_ = origAppend;

  // Verify exactly 1 line was written so far
  const partialLines = h.grids.RosterEvents.slice(1).filter(r => r[3] === swapOp.operationId);
  assert.equal(partialLines.length, 1);

  const eventCountBeforeRetry = h.grids.RosterEvents.length;

  // Now the client retries the exact same SWAP operation
  const res = amend(h, swapOp);
  assert.equal(res.ok, true, 'Retry must complete successfully');
  assert.equal(res.state, 'AMENDED');
  assert.equal(res.revision, 2);

  // Exactly 1 new line (line 2) was appended, zero duplicates of line 1
  const swapRows = h.grids.RosterEvents.slice(1).filter(r => r[3] === swapOp.operationId);
  assert.equal(swapRows.length, 2, 'Exactly two lines must exist for the SWAP');
  assert.equal(h.grids.RosterEvents.length, eventCountBeforeRetry + 1, 'Only missing line 2 was appended');
});

// ==========================================
// 6. FAULT INJECTION & RECOVERY
// ==========================================

test('11. Fault injection: MasterRoster readback checksum mismatch marks RECOVERY_REQUIRED and same-op retry repairs it', () => {
  const { h, periodId } = setupPublished();
  const amendOp = makeAmendOp({ periodId, expectedRevision: 1 });

  // Let's tamper with rosterV2Digest_ to force CHECKSUM_MISMATCH on readback
  const originalDigest = h.context.rosterV2Digest_;
  let nameCallCount = 0;
  h.context.rosterV2Digest_ = function(content) {
    if (typeof content === 'string' && content.includes('"Name"')) {
      nameCallCount++;
      if (nameCallCount === 3) {
        return '0000000000000000000000000000000000000000000000000000000000000000';
      }
    }
    return originalDigest.apply(this, arguments);
  };

  const failRes = amend(h, amendOp);
  assert.equal(failRes.ok, false);
  assert.equal(failRes.error.code, 'CHECKSUM_MISMATCH');

  // Check OperationLog is RECOVERY_REQUIRED
  const logRow = h.grids.OperationLog.find(r => r[0] === amendOp.operationId);
  assert.ok(logRow);
  assert.equal(logRow[8], 'RECOVERY_REQUIRED');
  assert.equal(logRow[10], 'CHECKSUM_MISMATCH');

  // Period revision and state must NOT have advanced
  const periodRow = h.grids.RosterPeriods.find(r => r[0] === periodId);
  assert.equal(periodRow[1], 'PUBLISHED');
  assert.equal(periodRow[2], 1);

  // Now retry with SAME operationId without tampering: repairs cleanly
  const retryRes = amend(h, amendOp);
  assert.equal(retryRes.ok, true, 'Retry must repair the transition and succeed');
  assert.equal(retryRes.state, 'AMENDED');
  assert.equal(retryRes.revision, 2);

  // Log is now CONFIRMED
  const logRowAfter = h.grids.OperationLog.find(r => r[0] === amendOp.operationId);
  assert.equal(logRowAfter[8], 'CONFIRMED');
});

test('12. Critical window recovery: RosterPeriods updated but OperationLog interrupted before CONFIRMED', () => {
  const { h, periodId } = setupPublished();
  const amendOp = makeAmendOp({ periodId, expectedRevision: 1 });

  // Execute amend once
  const res1 = amend(h, amendOp);
  assert.equal(res1.ok, true);

  // Manually regress OperationLog to PENDING to simulate crash right after RosterPeriods update
  const logIndex = h.grids.OperationLog.findIndex(r => r[0] === amendOp.operationId);
  h.grids.OperationLog[logIndex][8] = 'PENDING';
  h.grids.OperationLog[logIndex][9] = ''; // clear ResultJson

  // Call recover endpoint
  const recRes = recover(h, amendOp.operationId);
  assert.equal(recRes.ok, true);
  assert.equal(recRes.status, 'CONFIRMED');
  assert.equal(recRes.result.state, 'AMENDED');
  assert.equal(recRes.result.revision, 2);
});

// ==========================================
// 7. AMENDMENT REVERSAL ENDPOINT
// ==========================================

test('13. REVERSAL: successful compensating reversal restores prior Current state and adjusts lifecycle state', () => {
  const { h, periodId } = setupPublished();

  // 1. Create single amendment (PUBLISHED -> AMENDED, rev 1 -> 2)
  const amendOp = makeAmendOp({
    periodId,
    expectedRevision: 1,
    personId: person1,
    date: '2030-07-01',
    afterAssignments: [{ shiftCode: 'PM' }]
  });
  const amendRes = amend(h, amendOp);
  assert.equal(amendRes.ok, true);
  assert.equal(amendRes.state, 'AMENDED');
  assert.equal(amendRes.revision, 2);

  // 2. Reverse this amendment (only active amendment -> transitions back to PUBLISHED, rev 2 -> 3)
  const revOp = makeReversalOp({
    periodId,
    expectedRevision: 2,
    targetEventId: amendRes.eventId,
    adminNote: 'Undoing single correction'
  });
  const revRes = amendReversal(h, revOp);
  assert.equal(revRes.ok, true, 'reversal should succeed');
  assert.equal(revRes.state, 'PUBLISHED', 'Final reversal must return period to PUBLISHED');
  assert.equal(revRes.revision, 3);
  assert.equal(revRes.activeAmendmentCount, 0);

  // Verify target event rows are intact and untouched
  const targetRows = h.grids.RosterEvents.slice(1).filter(r => r[0] === amendRes.eventId);
  assert.equal(targetRows.length, 1, 'Target event row must still exist');

  // Verify compensating REVERSAL row was appended
  const revRows = h.grids.RosterEvents.slice(1).filter(r => r[0] === revRes.reversalEventId);
  assert.equal(revRows.length, 1);
  assert.equal(revRows[0][2], 'REVERSAL');
  assert.equal(revRows[0][19], amendRes.eventId, 'ReversesEventId must link to targetEventId');

  // Verify MasterRoster projection is restored to baseline AM
  const masterRows = h.grids.MasterRoster.slice(1);
  const p1Day1 = masterRows.find(r => r[0] === 'Dr. Ali' && r[1] === '2030-07-01');
  assert.equal(p1Day1[2], 'AM', 'Current projection must be restored to baseline AM shift');
});

test('14. REVERSAL: remaining active amendment keeps lifecycle state AMENDED', () => {
  const { h, periodId } = setupPublished();

  // Amendment 1: person1 day 1 -> PM (rev 1 -> 2)
  const op1 = makeAmendOp({ periodId, expectedRevision: 1, personId: person1, date: '2030-07-01', afterAssignments: [{ shiftCode: 'PM' }] });
  const res1 = amend(h, op1);

  // Amendment 2: person2 day 2 -> ND (rev 2 -> 3)
  const op2 = makeAmendOp({ periodId, expectedRevision: 2, personId: person2, date: '2030-07-02', afterAssignments: [{ shiftCode: 'ND' }] });
  const res2 = amend(h, op2);

  // Reverse amendment 1: amendment 2 remains active -> state stays AMENDED (rev 3 -> 4)
  const revOp = makeReversalOp({ periodId, expectedRevision: 3, targetEventId: res1.eventId });
  const revRes = amendReversal(h, revOp);
  assert.equal(revRes.ok, true);
  assert.equal(revRes.state, 'AMENDED', 'State must remain AMENDED while active amendment remains');
  assert.equal(revRes.revision, 4);
  assert.equal(revRes.activeAmendmentCount, 1);
});

test('15. REVERSAL: double reversal rejected with EVENT_ALREADY_REVERSED', () => {
  const { h, periodId } = setupPublished();
  const amendOp1 = makeAmendOp({ periodId, expectedRevision: 1, personId: person1, date: `${periodId}-01`, afterAssignments: [{ shiftCode: 'PM' }] });
  const amendRes1 = amend(h, amendOp1);
  const amendOp2 = makeAmendOp({ periodId, expectedRevision: 2, personId: person2, date: `${periodId}-02`, afterAssignments: [{ shiftCode: 'PM' }] });
  const amendRes2 = amend(h, amendOp2);

  // Reverse amendment 2: amendment 1 remains active, so state stays AMENDED
  const revOp1 = makeReversalOp({ periodId, expectedRevision: 3, targetEventId: amendRes2.eventId });
  const revRes1 = amendReversal(h, revOp1);
  assert.equal(revRes1.ok, true);
  assert.equal(revRes1.state, 'AMENDED');

  // Attempt to reverse the same target event again while state is AMENDED
  const revOp2 = makeReversalOp({ periodId, expectedRevision: 4, targetEventId: amendRes2.eventId });
  const revRes2 = amendReversal(h, revOp2);
  assert.equal(revRes2.ok, false);
  assert.equal(revRes2.error.code, 'EVENT_ALREADY_REVERSED');
});

test('16. REVERSAL: dependency conflict rejected when newer active amendment touched same cell', () => {
  const { h, periodId } = setupPublished();

  // Amendment 1: person1 day 1 -> PM (rev 1 -> 2)
  const op1 = makeAmendOp({ periodId, expectedRevision: 1, personId: person1, date: '2030-07-01', afterAssignments: [{ shiftCode: 'PM' }] });
  const res1 = amend(h, op1);

  // Amendment 2: person1 day 1 -> ND (rev 2 -> 3)
  const op2 = makeAmendOp({ periodId, expectedRevision: 2, personId: person1, date: '2030-07-01', afterAssignments: [{ shiftCode: 'ND' }] });
  const res2 = amend(h, op2);

  // Attempt to reverse amendment 1 while amendment 2 has superseded that cell
  const revOp = makeReversalOp({ periodId, expectedRevision: 3, targetEventId: res1.eventId });
  const revRes = amendReversal(h, revOp);
  assert.equal(revRes.ok, false);
  assert.equal(revRes.error.code, 'REVERSAL_DEPENDENCY_CONFLICT');
});

// ==========================================
// 8. CLOSE / REOPEN EXTENSIONS FOR AMENDED
// ==========================================

test('17. Close: AMENDED period closes successfully without erasing history', () => {
  const { h, periodId } = setupPublished();

  const amendOp = makeAmendOp({ periodId, expectedRevision: 1, personId: person1, date: '2030-07-01', afterAssignments: [{ shiftCode: 'PM' }] });
  const amendRes = amend(h, amendOp);
  assert.equal(amendRes.state, 'AMENDED');

  const closeOp = makeCloseOp({ periodId, expectedRevision: 2 });
  const closeRes = close(h, closeOp);
  assert.equal(closeRes.ok, true);
  assert.equal(closeRes.state, 'CLOSED');
  assert.equal(closeRes.revision, 3);

  // Amendment history must remain completely intact
  const eventRows = h.grids.RosterEvents.slice(1).filter(r => r[4] === periodId);
  assert.ok(eventRows.some(r => r[0] === amendRes.eventId));

  // MasterRoster shows last confirmed Current projection
  const masterRows = h.grids.MasterRoster.slice(1);
  const p1Day1 = masterRows.find(r => r[0] === 'Dr. Ali' && r[1] === '2030-07-01');
  assert.equal(p1Day1[2], 'PM');
});

test('18. Reopen: closed period with active amendments reopens to AMENDED', () => {
  const { h, periodId } = setupPublished();
  const amendOp = makeAmendOp({ periodId, expectedRevision: 1 });
  amend(h, amendOp);
  close(h, makeCloseOp({ periodId, expectedRevision: 2 }));

  const reopenOp = makeReopenOp({ periodId, expectedRevision: 3, reason: 'Reopening amended roster' });
  const reopenRes = reopen(h, reopenOp);
  assert.equal(reopenRes.ok, true);
  assert.equal(reopenRes.state, 'AMENDED', 'Period with active amendments must reopen to AMENDED');
  assert.equal(reopenRes.revision, 4);
});

test('19. Reopen: closed period with NO active amendments reopens to PUBLISHED', () => {
  const { h, periodId } = setupPublished();
  // No amendments made
  close(h, makeCloseOp({ periodId, expectedRevision: 1 }));

  const reopenOp = makeReopenOp({ periodId, expectedRevision: 2, reason: 'Reopening clean published roster' });
  const reopenRes = reopen(h, reopenOp);
  assert.equal(reopenRes.ok, true);
  assert.equal(reopenRes.state, 'PUBLISHED', 'Period with no active amendments must reopen to PUBLISHED');
  assert.equal(reopenRes.revision, 3);
});

// ==========================================
// 9. HISTORY READ ENDPOINT & PRIVACY
// ==========================================

test('20. History: returns reverse-chronological grouped events, reversal status, and admin vs viewer privacy', () => {
  const { h, periodId } = setupPublished();

  // Create amendment 1
  const op1 = makeAmendOp({ periodId, expectedRevision: 1, personId: person1, date: '2030-07-01', adminNote: 'Confidential admin note 1' });
  const res1 = amend(h, op1);

  // Create amendment 2
  const op2 = makeAmendOp({ periodId, expectedRevision: 2, personId: person2, date: '2030-07-02', adminNote: 'Confidential admin note 2' });
  const res2 = amend(h, op2);

  // Admin request: receives AdminNote and CreatedBy
  const adminHist = amendmentHistory(h, periodId);
  assert.equal(adminHist.ok, true);
  assert.equal(adminHist.count, 2);
  assert.equal(adminHist.isAdmin, true);
  assert.equal(adminHist.events[0].EventId, res2.eventId, 'Latest event must be first in reverse chronological order');
  assert.equal(adminHist.events[0].AdminNote, 'Confidential admin note 2');
  assert.ok(adminHist.events[0].CreatedBy);

  // Non-admin request: viewer-safe response strips AdminNote and CreatedBy
  const hViewer = setup({ tables: h.grids, activeEmail: 'viewer@example.invalid', adminEmail: 'admin@example.invalid' });

  const viewerHist = amendmentHistory(hViewer, periodId);
  assert.equal(viewerHist.ok, true);
  assert.equal(viewerHist.isAdmin, false);
  assert.equal(viewerHist.count, 2);

  viewerHist.events.forEach(ev => {
    assert.equal(ev.AdminNote, undefined, 'Viewer must never receive AdminNote on event');
    assert.equal(ev.CreatedBy, undefined, 'Viewer must never receive CreatedBy on event');
    assert.equal(ev.OperationId, undefined, 'Viewer must never receive OperationId on event');
    assert.equal(ev.canReverse, undefined, 'Viewer must never receive canReverse on event');
    assert.equal(ev.reversalIneligibilityReason, undefined, 'Viewer must never receive reversalIneligibilityReason on event');
    ev.lines.forEach(line => {
      assert.equal(line.AdminNote, undefined, 'Viewer must never receive AdminNote on line');
      assert.equal(line.CreatedBy, undefined, 'Viewer must never receive CreatedBy on line');
      assert.equal(line.OperationId, undefined, 'Viewer must never receive OperationId on line');
      assert.equal(line.ShortageReason, undefined, 'Viewer must never receive ShortageReason on line');
    });
  });
});

test('21. Legacy unenrolled period: rejects Phase 5 amendments cleanly', () => {
  const h = setup();
  // '2030-09' is a syntactically valid period but not enrolled in RosterPeriods
  const op = makeAmendOp({ periodId: '2030-09', expectedRevision: 1 });
  const res = amend(h, op);
  assert.equal(res.ok, false);
  assert.equal(res.error.code, 'ENTITY_NOT_FOUND');
});

// ==========================================
// 10. RECOVERY INVARIANTS & HARDENING AUDIT
// ==========================================

function checkRecoveryInvariants({
  h,
  periodId,
  op,
  result,
  expectedEventId,
  expectedLineCount,
  plannedBeforeJson,
  weeklyOffBeforeJson,
  expectedFinalRevision = 2,
  expectedFinalState = 'AMENDED'
}) {
  assert.equal(result.ok, true, 'Result must be ok');
  assert.equal(result.operationId, op.operationId, 'Must return same operationId');
  if (expectedEventId && (result.eventId || result.reversalEventId)) {
    assert.equal(result.eventId || result.reversalEventId, expectedEventId, 'Must return same deterministic EventId');
  }
  assert.equal(result.state, expectedFinalState, `State must be ${expectedFinalState}`);
  assert.equal(result.revision, expectedFinalRevision, `Revision must be ${expectedFinalRevision}`);

  // No duplicate RosterEvents rows
  const eventRows = h.grids.RosterEvents.slice(1).filter(r => r[3] === op.operationId);
  if (expectedLineCount !== undefined) {
    assert.equal(eventRows.length, expectedLineCount, `Expected exactly ${expectedLineCount} event lines`);
  }

  // Planned assignments unchanged
  const plannedAfterJson = JSON.stringify(h.grids.RosterAssignments.filter(r => r[2] === 'PLANNED'));
  assert.equal(plannedAfterJson, plannedBeforeJson, 'Planned rows must remain immutable');

  // WeeklyOffSnapshots unchanged
  const weeklyOffAfterJson = JSON.stringify(h.grids.WeeklyOffSnapshots);
  assert.equal(weeklyOffAfterJson, weeklyOffBeforeJson, 'WeeklyOffSnapshots must remain immutable');

  // RosterPeriods verification
  const periodRow = h.grids.RosterPeriods.find(r => r[0] === periodId);
  assert.equal(periodRow[1], expectedFinalState, `Period state must be ${expectedFinalState}`);
  assert.equal(periodRow[2], expectedFinalRevision, `Period revision must be ${expectedFinalRevision}`);
  assert.equal(periodRow[9], result.projectionChecksum, 'Period checksum must match result projectionChecksum');
  assert.equal(periodRow[11], op.operationId, 'Period LastOperationId must match operationId');

  // MasterRoster equals resolved Current
  const confirmedRows = h.context.rosterLifecycleFindConfirmedEventsByPeriod_(periodId).filter(r => !['PUBLISH', 'CLOSE', 'REOPEN'].includes(r.EventType));
  const confirmedEvents = lifecycle.groupEventLines(confirmedRows);
  const plannedAssignments = h.context.rosterLifecycleFindAssignmentsByPeriod_(periodId).filter(r => r.Layer === 'PLANNED');
  const resolvedCurrent = lifecycle.resolveCurrentRoster({
    periodId,
    plannedAssignments,
    events: confirmedEvents,
    people: h.context.rosterLifecycleGetPeople_(),
    digestFn: digest
  });
  const expectedMasterRows = resolvedCurrent.masterRosterProjection.filter(r => r.Date.slice(0, 7) === periodId);
  const actualMasterRows = h.grids.MasterRoster.slice(1)
    .filter(r => r[1].slice(0, 7) === periodId)
    .map(r => ({ Name: r[0], Date: r[1], Shift: r[2] }));
  assert.deepEqual(actualMasterRows, expectedMasterRows, 'Final MasterRoster must equal resolved Current');

  // Final ProjectionChecksum matches persisted projection
  const computedChecksum = lifecycle.computeProjectionChecksum(actualMasterRows, digest);
  assert.equal(computedChecksum, result.projectionChecksum, 'Computed checksum must match result');

  // OperationLog ends CONFIRMED
  const logRow = h.grids.OperationLog.find(r => r[0] === op.operationId);
  assert.ok(logRow, 'OperationLog row must exist');
  assert.equal(logRow[8], 'CONFIRMED', 'OperationLog Status must be CONFIRMED');
  assert.equal(logRow[10], '', 'ErrorCode must be empty upon confirmation');
}

test('22. Fault injection Window 1: failure before any event row is persisted recovers with identical IDs and zero duplicates', () => {
  const { h, periodId } = setupPublished();
  const plannedBefore = JSON.stringify(h.grids.RosterAssignments.filter(r => r[2] === 'PLANNED'));
  const weeklyOffBefore = JSON.stringify(h.grids.WeeklyOffSnapshots);

  const op = makeAmendOp({ periodId, expectedRevision: 1, personId: person1, date: '2030-07-01', afterAssignments: [{ shiftCode: 'PM' }] });
  const deterministicId = lifecycle.deterministicEventId(op.operationId, 'ADMIN_CORRECTION', person1, '2030-07-01', 'MO');

  // Intercept event persistence on first attempt before any event line is written
  const origPersist = h.context.rosterLifecyclePersistEventsIdempotently_;
  let persistCalls = 0;
  h.context.rosterLifecyclePersistEventsIdempotently_ = function(...args) {
    if (++persistCalls === 1) {
      throw new Error('Simulated crash before persisting any event line');
    }
    return origPersist.apply(this, args);
  };

  const failRes = amend(h, op);
  assert.equal(failRes.ok, false);

  // Assert 0 rows added to RosterEvents
  const eventsForOp = h.grids.RosterEvents.slice(1).filter(r => r[3] === op.operationId);
  assert.equal(eventsForOp.length, 0, 'No event rows must exist after pre-persistence crash');

  // Assert period revision and state did not advance
  const periodRow = h.grids.RosterPeriods.find(r => r[0] === periodId);
  assert.equal(periodRow[1], 'PUBLISHED');
  assert.equal(periodRow[2], 1);

  // Retry with same operationId
  const retryRes = amend(h, op);
  assert.equal(retryRes.ok, true);

  checkRecoveryInvariants({
    h,
    periodId,
    op,
    result: retryRes,
    expectedEventId: deterministicId,
    expectedLineCount: 1,
    plannedBeforeJson: plannedBefore,
    weeklyOffBeforeJson: weeklyOffBefore
  });
});

test('23. Fault injection Window 3: failure after all canonical event rows are persisted but before MasterRoster write recovers cleanly', () => {
  const { h, periodId } = setupPublished();
  const plannedBefore = JSON.stringify(h.grids.RosterAssignments.filter(r => r[2] === 'PLANNED'));
  const weeklyOffBefore = JSON.stringify(h.grids.WeeklyOffSnapshots);

  const op = makeAmendOp({ periodId, expectedRevision: 1, personId: person1, date: '2030-07-01', afterAssignments: [{ shiftCode: 'PM' }] });
  const deterministicId = lifecycle.deterministicEventId(op.operationId, 'ADMIN_CORRECTION', person1, '2030-07-01', 'MO');

  // Intercept MasterRoster write on first attempt
  const origWriteMaster = h.context.rosterLifecycleWriteMasterRoster_;
  let writeCalls = 0;
  h.context.rosterLifecycleWriteMasterRoster_ = function(...args) {
    if (++writeCalls === 1) {
      throw new Error('Simulated crash before MasterRoster projection write');
    }
    return origWriteMaster.apply(this, args);
  };

  const failRes = amend(h, op);
  assert.equal(failRes.ok, false);

  // Canonical event row was persisted
  const eventsForOp = h.grids.RosterEvents.slice(1).filter(r => r[3] === op.operationId);
  assert.equal(eventsForOp.length, 1);

  // Period was not yet updated
  const periodRow = h.grids.RosterPeriods.find(r => r[0] === periodId);
  assert.equal(periodRow[1], 'PUBLISHED');
  assert.equal(periodRow[2], 1);

  // Retry with same operationId
  const retryRes = amend(h, op);
  assert.equal(retryRes.ok, true);

  checkRecoveryInvariants({
    h,
    periodId,
    op,
    result: retryRes,
    expectedEventId: deterministicId,
    expectedLineCount: 1,
    plannedBeforeJson: plannedBefore,
    weeklyOffBeforeJson: weeklyOffBefore
  });
});

test('24. Fault injection Window 4: failure after MasterRoster write but before readback/checksum verification recovers cleanly', () => {
  const { h, periodId } = setupPublished();
  const plannedBefore = JSON.stringify(h.grids.RosterAssignments.filter(r => r[2] === 'PLANNED'));
  const weeklyOffBefore = JSON.stringify(h.grids.WeeklyOffSnapshots);

  const op = makeAmendOp({ periodId, expectedRevision: 1, personId: person1, date: '2030-07-01', afterAssignments: [{ shiftCode: 'PM' }] });
  const deterministicId = lifecycle.deterministicEventId(op.operationId, 'ADMIN_CORRECTION', person1, '2030-07-01', 'MO');

  // Intercept readTable during readback verification
  const origReadTable = h.context.rosterV2ReadTable_;
  let masterReadCount = 0;
  h.context.rosterV2ReadTable_ = function(name) {
    if (name === 'MasterRoster') {
      masterReadCount++;
      if (masterReadCount === 2) {
        // First read was before merge; second read is the readback verification
        throw new Error('Simulated I/O loss during MasterRoster readback');
      }
    }
    return origReadTable.apply(this, arguments);
  };

  const failRes = amend(h, op);
  assert.equal(failRes.ok, false);

  // Period row was not updated yet
  const periodRow = h.grids.RosterPeriods.find(r => r[0] === periodId);
  assert.equal(periodRow[1], 'PUBLISHED');
  assert.equal(periodRow[2], 1);

  // Retry with same operationId
  const retryRes = amend(h, op);
  assert.equal(retryRes.ok, true);

  checkRecoveryInvariants({
    h,
    periodId,
    op,
    result: retryRes,
    expectedEventId: deterministicId,
    expectedLineCount: 1,
    plannedBeforeJson: plannedBefore,
    weeklyOffBeforeJson: weeklyOffBefore
  });
});

test('25. Fault injection Window 6: failure after checksum verification but before RosterPeriods update recovers cleanly', () => {
  const { h, periodId } = setupPublished();
  const plannedBefore = JSON.stringify(h.grids.RosterAssignments.filter(r => r[2] === 'PLANNED'));
  const weeklyOffBefore = JSON.stringify(h.grids.WeeklyOffSnapshots);

  const op = makeAmendOp({ periodId, expectedRevision: 1, personId: person1, date: '2030-07-01', afterAssignments: [{ shiftCode: 'PM' }] });
  const deterministicId = lifecycle.deterministicEventId(op.operationId, 'ADMIN_CORRECTION', person1, '2030-07-01', 'MO');

  // Intercept writeRow for RosterPeriods on first attempt
  const origWriteRow = h.context.rosterLifecycleWriteRow_;
  let periodWriteCount = 0;
  h.context.rosterLifecycleWriteRow_ = function(sheetName, ...args) {
    if (sheetName === 'RosterPeriods' && ++periodWriteCount === 1) {
      throw new Error('Simulated crash right before RosterPeriods update');
    }
    return origWriteRow.call(this, sheetName, ...args);
  };

  const failRes = amend(h, op);
  assert.equal(failRes.ok, false);

  // Period was not yet updated
  const periodRow = h.grids.RosterPeriods.find(r => r[0] === periodId);
  assert.equal(periodRow[1], 'PUBLISHED');
  assert.equal(periodRow[2], 1);

  // Retry with same operationId
  const retryRes = amend(h, op);
  assert.equal(retryRes.ok, true);

  checkRecoveryInvariants({
    h,
    periodId,
    op,
    result: retryRes,
    expectedEventId: deterministicId,
    expectedLineCount: 1,
    plannedBeforeJson: plannedBefore,
    weeklyOffBeforeJson: weeklyOffBefore
  });
});

test('26. Fault injection Windows 7 & 8: crash before OperationLog CONFIRMED and lost response recovery', () => {
  const { h, periodId } = setupPublished();
  const plannedBefore = JSON.stringify(h.grids.RosterAssignments.filter(r => r[2] === 'PLANNED'));
  const weeklyOffBefore = JSON.stringify(h.grids.WeeklyOffSnapshots);

  const op = makeAmendOp({ periodId, expectedRevision: 1, personId: person1, date: '2030-07-01', afterAssignments: [{ shiftCode: 'PM' }] });
  const res1 = amend(h, op);
  assert.equal(res1.ok, true);

  // Simulate Window 7: Period updated to rev 2 / AMENDED, but crash happened before log CONFIRMED
  const logIndex = h.grids.OperationLog.findIndex(r => r[0] === op.operationId);
  h.grids.OperationLog[logIndex][8] = 'PENDING';
  h.grids.OperationLog[logIndex][9] = '';

  // Recover via rosterv2lifecyclerecover
  const recRes = recover(h, op.operationId);
  assert.equal(recRes.ok, true);
  assert.equal(recRes.status, 'CONFIRMED');

  // Verify all invariants hold after recovery
  checkRecoveryInvariants({
    h,
    periodId,
    op,
    result: recRes.result,
    expectedEventId: res1.eventId,
    expectedLineCount: 1,
    plannedBeforeJson: plannedBefore,
    weeklyOffBeforeJson: weeklyOffBefore
  });

  // Simulate Window 8: identical retry after full completion returns cached result without advancing revision
  const replayRes = amend(h, op);
  assert.deepEqual(replayRes, res1);

  checkRecoveryInvariants({
    h,
    periodId,
    op,
    result: replayRes,
    expectedEventId: res1.eventId,
    expectedLineCount: 1,
    plannedBeforeJson: plannedBefore,
    weeklyOffBeforeJson: weeklyOffBefore
  });
});

test('27. Reversal Fault Window 1: reversal event persisted before MasterRoster write failure recovers without double reversal', () => {
  const { h, periodId } = setupPublished();
  const plannedBefore = JSON.stringify(h.grids.RosterAssignments.filter(r => r[2] === 'PLANNED'));
  const weeklyOffBefore = JSON.stringify(h.grids.WeeklyOffSnapshots);

  // 1. Create initial amendment (rev 1 -> 2)
  const amendOp = makeAmendOp({ periodId, expectedRevision: 1, personId: person1, date: '2030-07-01', afterAssignments: [{ shiftCode: 'PM' }] });
  const amendRes = amend(h, amendOp);
  assert.equal(amendRes.ok, true);

  // 2. Prepare reversal op
  const revOp = makeReversalOp({ periodId, expectedRevision: 2, targetEventId: amendRes.eventId, adminNote: 'Reversing amendment' });

  // 3. Intercept MasterRoster write during reversal
  const origWriteMaster = h.context.rosterLifecycleWriteMasterRoster_;
  let writeCalls = 0;
  h.context.rosterLifecycleWriteMasterRoster_ = function(...args) {
    if (++writeCalls === 1) {
      throw new Error('Simulated crash during reversal MasterRoster write');
    }
    return origWriteMaster.apply(this, args);
  };

  const failRes = amendReversal(h, revOp);
  assert.equal(failRes.ok, false);

  // Reversal event line was persisted
  const revEvents = h.grids.RosterEvents.slice(1).filter(r => r[3] === revOp.operationId);
  assert.equal(revEvents.length, 1);

  // Period was not yet updated (remains AMENDED / rev 2)
  const periodRow = h.grids.RosterPeriods.find(r => r[0] === periodId);
  assert.equal(periodRow[1], 'AMENDED');
  assert.equal(periodRow[2], 2);

  // 4. Retry reversal with same operationId
  const retryRes = amendReversal(h, revOp);
  assert.equal(retryRes.ok, true);

  checkRecoveryInvariants({
    h,
    periodId,
    op: revOp,
    result: retryRes,
    expectedLineCount: 1,
    plannedBeforeJson: plannedBefore,
    weeklyOffBeforeJson: weeklyOffBefore,
    expectedFinalRevision: 3,
    expectedFinalState: 'PUBLISHED'
  });

  // Verify only 1 reversal event exists for this operation and target is not reversed twice
  const allReversalsForTarget = h.grids.RosterEvents.slice(1).filter(r => r[2] === 'REVERSAL' && r[19] === amendRes.eventId);
  assert.equal(allReversalsForTarget.length, 1, 'Target event must have exactly one compensating reversal event');
});

test('28. Reversal Fault Window 2: checksum mismatch during reversal readback marks RECOVERY_REQUIRED and same-op retry repairs it', () => {
  const { h, periodId } = setupPublished();
  const plannedBefore = JSON.stringify(h.grids.RosterAssignments.filter(r => r[2] === 'PLANNED'));
  const weeklyOffBefore = JSON.stringify(h.grids.WeeklyOffSnapshots);

  const amendOp = makeAmendOp({ periodId, expectedRevision: 1, personId: person1, date: '2030-07-01', afterAssignments: [{ shiftCode: 'PM' }] });
  const amendRes = amend(h, amendOp);

  const revOp = makeReversalOp({ periodId, expectedRevision: 2, targetEventId: amendRes.eventId });

  // Tamper with digest on reversal readback
  const originalDigest = h.context.rosterV2Digest_;
  let nameCallCount = 0;
  h.context.rosterV2Digest_ = function(content) {
    if (typeof content === 'string' && content.includes('"Name"')) {
      nameCallCount++;
      if (nameCallCount === 3) {
        return 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';
      }
    }
    return originalDigest.apply(this, arguments);
  };

  const failRes = amendReversal(h, revOp);
  assert.equal(failRes.ok, false);
  assert.equal(failRes.error.code, 'CHECKSUM_MISMATCH');

  // OperationLog is RECOVERY_REQUIRED
  const logRow = h.grids.OperationLog.find(r => r[0] === revOp.operationId);
  assert.equal(logRow[8], 'RECOVERY_REQUIRED');

  // Period revision remains 2, state remains AMENDED
  const periodRow = h.grids.RosterPeriods.find(r => r[0] === periodId);
  assert.equal(periodRow[1], 'AMENDED');
  assert.equal(periodRow[2], 2);

  // Retry with same operationId without tampering
  const retryRes = amendReversal(h, revOp);
  assert.equal(retryRes.ok, true);

  checkRecoveryInvariants({
    h,
    periodId,
    op: revOp,
    result: retryRes,
    expectedLineCount: 1,
    plannedBeforeJson: plannedBefore,
    weeklyOffBeforeJson: weeklyOffBefore,
    expectedFinalRevision: 3,
    expectedFinalState: 'PUBLISHED'
  });
});

test('29. Reversal Fault Windows 3 & 4: RosterPeriods updated before OperationLog confirmation & lost response replay idempotency', () => {
  const { h, periodId } = setupPublished();
  const plannedBefore = JSON.stringify(h.grids.RosterAssignments.filter(r => r[2] === 'PLANNED'));
  const weeklyOffBefore = JSON.stringify(h.grids.WeeklyOffSnapshots);

  const amendOp = makeAmendOp({ periodId, expectedRevision: 1, personId: person1, date: '2030-07-01', afterAssignments: [{ shiftCode: 'PM' }] });
  const amendRes = amend(h, amendOp);

  const revOp = makeReversalOp({ periodId, expectedRevision: 2, targetEventId: amendRes.eventId });
  const revRes = amendReversal(h, revOp);
  assert.equal(revRes.ok, true);

  // Simulate Window 3: Period updated to rev 3 / PUBLISHED, but crash happened before log CONFIRMED
  const logIndex = h.grids.OperationLog.findIndex(r => r[0] === revOp.operationId);
  h.grids.OperationLog[logIndex][8] = 'PENDING';
  h.grids.OperationLog[logIndex][9] = '';

  // Recover via rosterv2lifecyclerecover
  const recRes = recover(h, revOp.operationId);
  assert.equal(recRes.ok, true);
  assert.equal(recRes.status, 'CONFIRMED');

  checkRecoveryInvariants({
    h,
    periodId,
    op: revOp,
    result: recRes.result,
    expectedLineCount: 1,
    plannedBeforeJson: plannedBefore,
    weeklyOffBeforeJson: weeklyOffBefore,
    expectedFinalRevision: 3,
    expectedFinalState: 'PUBLISHED'
  });

  // Simulate Window 4: identical replay of completed reversal
  const replayRes = amendReversal(h, revOp);
  assert.deepEqual(replayRes, revRes);

  checkRecoveryInvariants({
    h,
    periodId,
    op: revOp,
    result: replayRes,
    expectedLineCount: 1,
    plannedBeforeJson: plannedBefore,
    weeklyOffBeforeJson: weeklyOffBefore,
    expectedFinalRevision: 3,
    expectedFinalState: 'PUBLISHED'
  });
});

test('30. OperationLog visibility isolation: normal reads and in-progress mutations exclude foreign unconfirmed operations', () => {
  const { h, periodId } = setupPublished();

  // Inject Op A: PENDING amendment on Person 1 Day 1 -> Shift 'PM'
  const opAId = crypto.randomUUID();
  h.grids.OperationLog.push([
    opAId, opAId, opAId, 'PERIOD_AMEND', `period:${periodId}`,
    1, 2, '000000000000000000000000000000000000000000000000000000000000000a',
    'PENDING', '', '', new Date().toISOString(), ''
  ]);
  h.grids.RosterEvents.push([
    crypto.randomUUID(), crypto.randomUUID(), 'ADMIN_CORRECTION', opAId, periodId,
    1, 2, person1, '[]', '2030-07-01', 'MO',
    JSON.stringify([{ ShiftCode: 'AM' }]), JSON.stringify([{ ShiftCode: 'AM' }]), JSON.stringify([{ ShiftCode: 'PM' }]),
    'ADMIN_CORRECTION', 'pending note A', false, '', '[]', '', new Date().toISOString(), 'admin@example.invalid'
  ]);

  // Inject Op B: RECOVERY_REQUIRED amendment on Person 2 Day 1 -> Shift 'ND'
  const opBId = crypto.randomUUID();
  h.grids.OperationLog.push([
    opBId, opBId, opBId, 'PERIOD_AMEND', `period:${periodId}`,
    1, 2, '000000000000000000000000000000000000000000000000000000000000000b',
    'RECOVERY_REQUIRED', '', 'CHECKSUM_MISMATCH', new Date().toISOString(), ''
  ]);
  h.grids.RosterEvents.push([
    crypto.randomUUID(), crypto.randomUUID(), 'ADMIN_CORRECTION', opBId, periodId,
    1, 2, person2, '[]', '2030-07-01', 'MO',
    JSON.stringify([{ ShiftCode: 'PM' }]), JSON.stringify([{ ShiftCode: 'PM' }]), JSON.stringify([{ ShiftCode: 'ND' }]),
    'ADMIN_CORRECTION', 'recovery note B', false, '', '[]', '', new Date().toISOString(), 'admin@example.invalid'
  ]);

  // Inject Op C: FAILED operation on Person 3 Day 1 -> Shift 'OFF'
  const opCId = crypto.randomUUID();
  h.grids.OperationLog.push([
    opCId, opCId, opCId, 'PERIOD_AMEND', `period:${periodId}`,
    1, 2, '000000000000000000000000000000000000000000000000000000000000000c',
    'FAILED', '', 'PERMANENT_FAILURE', new Date().toISOString(), ''
  ]);
  h.grids.RosterEvents.push([
    crypto.randomUUID(), crypto.randomUUID(), 'ADMIN_CORRECTION', opCId, periodId,
    1, 2, person3, '[]', '2030-07-01', 'MO',
    JSON.stringify([{ ShiftCode: 'ND' }]), JSON.stringify([{ ShiftCode: 'ND' }]), JSON.stringify([{ ShiftCode: 'OFF' }]),
    'ADMIN_CORRECTION', 'failed note C', false, '', '[]', '', new Date().toISOString(), 'admin@example.invalid'
  ]);

  // Execute in-progress Op D: legitimate amendment on Person 1 Day 2 -> 'PM'
  const opD = makeAmendOp({ periodId, expectedRevision: 1, personId: person1, date: '2030-07-02', afterAssignments: [{ shiftCode: 'PM' }] });
  const resD = amend(h, opD);
  assert.equal(resD.ok, true);
  assert.equal(resD.revision, 2);

  // Authoritative MasterRoster projection must contain ONLY Op D's change!
  // Person 1 Day 1 must still be baseline AM (not PM from Op A)
  // Person 2 Day 1 must still be baseline PM (not ND from Op B)
  // Person 3 Day 1 must still be baseline ND (not OFF from Op C)
  // Person 1 Day 2 must be PM (from Op D)
  const masterRows = h.grids.MasterRoster.slice(1);
  const p1Day1 = masterRows.find(r => r[0] === 'Dr. Ali' && r[1] === '2030-07-01');
  const p2Day1 = masterRows.find(r => r[0] === 'Dr. Siti' && r[1] === '2030-07-01');
  const p3Day1 = masterRows.find(r => r[0] === 'Dr. Tan' && r[1] === '2030-07-01');
  const p1Day2 = masterRows.find(r => r[0] === 'Dr. Ali' && r[1] === '2030-07-02');

  assert.equal(p1Day1[2], 'AM', 'Op A must not bleed into confirmed projection');
  assert.equal(p2Day1[2], 'PM', 'Op B must not bleed into confirmed projection');
  assert.equal(p3Day1[2], 'ND', 'Op C must not bleed into confirmed projection');
  assert.equal(p1Day2[2], 'PM', 'Op D must be accurately projected');

  // Amendment history read must return ONLY Op D
  const historyRes = amendmentHistory(h, periodId);
  assert.equal(historyRes.ok, true);
  assert.equal(historyRes.count, 1, 'History must contain ONLY confirmed operation D');
  assert.equal(historyRes.events[0].OperationId, opD.operationId);
});

test('31. Semantic request / payloadHash contract: changed semantic payload with same operationId triggers IDEMPOTENCY_MISMATCH', () => {
  const { h, periodId } = setupPublished();

  // Case 1: Changed adminNote
  {
    const op1 = makeAmendOp({ periodId, expectedRevision: 1, adminNote: 'Original Note' });
    const res1 = amend(h, op1);
    assert.equal(res1.ok, true);

    const tampered = { ...op1, adminNote: 'Changed Note' };
    const res2 = amend(h, tampered);
    assert.equal(res2.ok, false);
    assert.equal(res2.error.code, 'IDEMPOTENCY_MISMATCH');
  }

  // Case 2: Changed publicReasonCode
  {
    const op1 = makeAmendOp({ periodId, expectedRevision: 2, date: '2030-07-02', publicReasonCode: 'ADMIN_CORRECTION' });
    const res1 = amend(h, op1);
    assert.equal(res1.ok, true);

    const tampered = { ...op1, publicReasonCode: 'DUTY_COVERAGE' };
    const res2 = amend(h, tampered);
    assert.equal(res2.ok, false);
    assert.equal(res2.error.code, 'IDEMPOTENCY_MISMATCH');
  }

  // Case 3: Changed desired assignment
  {
    const op1 = makeAmendOp({ periodId, expectedRevision: 3, date: '2030-07-03', afterAssignments: [{ shiftCode: 'PM' }] });
    const res1 = amend(h, op1);
    assert.equal(res1.ok, true);

    const tampered = { ...op1, afterAssignments: [{ shiftCode: 'ND' }] };
    const res2 = amend(h, tampered);
    assert.equal(res2.ok, false);
    assert.equal(res2.error.code, 'IDEMPOTENCY_MISMATCH');
  }

  // Case 4: Changed swap counterpart
  {
    const swapOp = makeSwapOp({
      periodId,
      expectedRevision: 4,
      person1Target: { personId: person1, date: '2030-07-01', dutyDomain: 'MO' },
      person2Target: { personId: person2, date: '2030-07-01', dutyDomain: 'MO' }
    });
    const swapRes = amend(h, swapOp);
    assert.equal(swapRes.ok, true);

    const tamperedSwap = {
      ...swapOp,
      person2: { personId: person3, date: '2030-07-01', dutyDomain: 'MO' }
    };
    const res2 = amend(h, tamperedSwap);
    assert.equal(res2.ok, false);
    assert.equal(res2.error.code, 'IDEMPOTENCY_MISMATCH');
  }

  // Case 5: Changed targetEventId in reversal
  {
    // Make an amendment to reverse
    const amendOp = makeAmendOp({ periodId, expectedRevision: 5, date: '2030-07-04' });
    const amendRes = amend(h, amendOp);

    const revOp = makeReversalOp({ periodId, expectedRevision: 6, targetEventId: amendRes.eventId });
    const revRes = amendReversal(h, revOp);
    assert.equal(revRes.ok, true);

    const tamperedRev = { ...revOp, targetEventId: crypto.randomUUID() };
    const res2 = amendReversal(h, tamperedRev);
    assert.equal(res2.ok, false);
    assert.equal(res2.error.code, 'IDEMPOTENCY_MISMATCH');
  }
});

test('32. History privacy boundary: non-admin viewer response strips private identifiers and admin metadata', () => {
  const { h, periodId } = setupPublished();

  const op1 = makeAmendOp({
    periodId,
    expectedRevision: 1,
    personId: person1,
    date: '2030-07-01',
    adminNote: 'Admin confidential internal reason 1'
  });
  const res1 = amend(h, op1);

  const op2 = makeAmendOp({
    periodId,
    expectedRevision: 2,
    personId: person2,
    date: '2030-07-02',
    adminNote: 'Admin confidential internal reason 2'
  });
  const res2 = amend(h, op2);

  // Admin request: receives full metadata
  const adminHist = amendmentHistory(h, periodId);
  assert.equal(adminHist.isAdmin, true);
  assert.equal(adminHist.events[0].AdminNote, 'Admin confidential internal reason 2');
  assert.equal(adminHist.events[0].CreatedBy, 'admin@example.invalid');
  assert.equal(adminHist.events[0].OperationId, op2.operationId);
  assert.equal(adminHist.events[0].canReverse, true);

  // Viewer request: authenticated non-admin viewer
  const hViewer = setup({ tables: h.grids, activeEmail: 'viewer@example.invalid', adminEmail: 'admin@example.invalid' });
  const viewerHist = amendmentHistory(hViewer, periodId);
  assert.equal(viewerHist.isAdmin, false);

  const viewerJson = JSON.stringify(viewerHist);

  // Assert absence of confidential admin note
  assert.equal(viewerJson.includes('Admin confidential internal reason'), false, 'Viewer response must not contain AdminNote');

  // Assert absence of admin email
  assert.equal(viewerJson.includes('admin@example.invalid'), false, 'Viewer response must not contain administrator email');

  // Assert absence of operation IDs
  assert.equal(viewerJson.includes(op1.operationId), false, 'Viewer response must not contain operationId 1');
  assert.equal(viewerJson.includes(op2.operationId), false, 'Viewer response must not contain operationId 2');

  // Assert each event and line has only public/safe fields
  viewerHist.events.forEach(ev => {
    assert.equal(ev.AdminNote, undefined);
    assert.equal(ev.CreatedBy, undefined);
    assert.equal(ev.OperationId, undefined);
    assert.equal(ev.canReverse, undefined);
    assert.equal(ev.reversalIneligibilityReason, undefined);
    assert.ok(ev.EventId);
    assert.ok(ev.EventType);
    assert.ok(ev.PublicReasonCode);
    assert.ok(ev.CreatedAt);
    assert.equal(typeof ev.isReversed, 'boolean');

    ev.lines.forEach(line => {
      assert.equal(line.AdminNote, undefined);
      assert.equal(line.CreatedBy, undefined);
      assert.equal(line.OperationId, undefined);
      assert.equal(line.ShortageReason, undefined);
      assert.ok(line.LineId);
      assert.ok(line.PersonId);
      assert.ok(line.Date);
      assert.ok(line.DutyDomain);
      assert.ok(line.BeforeCurrentJson);
      assert.ok(line.AfterCurrentJson);
    });
  });
});

test('33. Reversal state guard: fresh reversal rejected on PUBLISHED period with INVALID_STATE, idempotent replay allowed', () => {
  const { h, periodId } = setupPublished();

  // Fresh reversal on PUBLISHED period must reject with INVALID_STATE
  const freshRevOp = makeReversalOp({
    periodId,
    expectedRevision: 1,
    targetEventId: crypto.randomUUID()
  });
  const res = amendReversal(h, freshRevOp);
  assert.equal(res.ok, false);
  assert.equal(res.error.code, 'INVALID_STATE');
  assert.match(res.error.message, /must be AMENDED/i);

  // Now create an amendment, then reverse it (transitions to PUBLISHED)
  const amendOp = makeAmendOp({ periodId, expectedRevision: 1 });
  const amendRes = amend(h, amendOp);
  assert.equal(amendRes.ok, true);
  assert.equal(amendRes.state, 'AMENDED');

  const validRevOp = makeReversalOp({
    periodId,
    expectedRevision: 2,
    targetEventId: amendRes.eventId
  });
  const validRevRes = amendReversal(h, validRevOp);
  assert.equal(validRevRes.ok, true);
  assert.equal(validRevRes.state, 'PUBLISHED');

  // Idempotent replay of the SAME reversal operation that set state to PUBLISHED must succeed!
  const replayRes = amendReversal(h, validRevOp);
  assert.equal(replayRes.ok, true);
  assert.equal(replayRes.state, 'PUBLISHED');
  assert.equal(replayRes.reversalEventId, validRevRes.reversalEventId);
});

test('34. Authoritative Planned baseline: at publication, rosterv2planned matches immutable snapshot', () => {
  const { h, periodId, pubOp } = setupPublished();

  const plannedRes = plannedRoster(h, periodId);
  assert.equal(plannedRes.ok, true);
  assert.equal(plannedRes.periodId, periodId);
  assert.ok(plannedRes.plannedSnapshotId);
  assert.equal(plannedRes.count, 5); // 5 draft cells in setupPublished
  assert.equal(plannedRes.assignments.length, 5);

  // Assert expected assignments
  const p1Day1 = plannedRes.assignments.find(a => a.personId === person1 && a.date === `${periodId}-01`);
  assert.ok(p1Day1);
  assert.equal(p1Day1.shiftCode, 'AM');
  assert.equal(p1Day1.dutyDomain, 'MO');
  assert.equal(p1Day1.personNameSnapshot, 'Dr. Ali');

  // Verify MasterRoster projection matches Planned at publication
  const masterRows = h.grids.MasterRoster.slice(1).filter(r => r[1].startsWith(periodId));
  assert.equal(masterRows.length, 5);
});

test('35. Planned integrity: Planned endpoint unchanged after ADMIN_CORRECTION while Current reflects amended assignment', () => {
  const { h, periodId } = setupPublished();
  const plannedBefore = plannedRoster(h, periodId);
  assert.equal(plannedBefore.ok, true);

  const amendOp = makeAmendOp({
    periodId,
    expectedRevision: 1,
    personId: person1,
    date: `${periodId}-01`,
    dutyDomain: 'MO',
    afterAssignments: [{ shiftCode: 'PM', rawShift: 'PM' }]
  });
  const amendRes = amend(h, amendOp);
  assert.equal(amendRes.ok, true);
  assert.equal(amendRes.state, 'AMENDED');

  // 1. Current / MasterRoster reflects amended assignment PM
  const masterRows = h.grids.MasterRoster.slice(1);
  const p1Day1Master = masterRows.find(r => r[0] === 'Dr. Ali' && r[1] === `${periodId}-01`);
  assert.equal(p1Day1Master[2], 'PM', 'Current MasterRoster must reflect amended shift PM');

  // 2. Authoritative Planned endpoint still returns original assignment AM!
  const plannedAfter = plannedRoster(h, periodId);
  assert.equal(plannedAfter.ok, true);
  assert.deepEqual(plannedAfter.assignments, plannedBefore.assignments, 'Planned assignments must remain byte-identical');
  const p1Day1Planned = plannedAfter.assignments.find(a => a.personId === person1 && a.date === `${periodId}-01`);
  assert.equal(p1Day1Planned.shiftCode, 'AM', 'Planned must still be AM');
});

test('36. Planned integrity: Planned remains original for both targets after SWAP while Current reflects swapped assignments', () => {
  const { h, periodId } = setupPublished();
  const plannedBefore = plannedRoster(h, periodId);

  // Before swap: person1 Day 1 is AM, person2 Day 1 is PM
  const swapOp = makeSwapOp({
    periodId,
    expectedRevision: 1,
    person1Target: { personId: person1, date: `${periodId}-01`, dutyDomain: 'MO' },
    person2Target: { personId: person2, date: `${periodId}-01`, dutyDomain: 'MO' }
  });
  const swapRes = amend(h, swapOp);
  assert.equal(swapRes.ok, true);

  // Current MasterRoster reflects swapped shifts
  const masterRows = h.grids.MasterRoster.slice(1);
  const p1Day1Master = masterRows.find(r => r[0] === 'Dr. Ali' && r[1] === `${periodId}-01`);
  const p2Day1Master = masterRows.find(r => r[0] === 'Dr. Siti' && r[1] === `${periodId}-01`);
  assert.equal(p1Day1Master[2], 'PM', 'Dr. Ali must now have PM');
  assert.equal(p2Day1Master[2], 'AM', 'Dr. Siti must now have AM');

  // Planned endpoint returns unchanged original assignments: Dr. Ali is AM, Dr. Siti is PM
  const plannedAfter = plannedRoster(h, periodId);
  assert.deepEqual(plannedAfter.assignments, plannedBefore.assignments, 'Planned assignments must not change after SWAP');
  const p1Planned = plannedAfter.assignments.find(a => a.personId === person1 && a.date === `${periodId}-01`);
  const p2Planned = plannedAfter.assignments.find(a => a.personId === person2 && a.date === `${periodId}-01`);
  assert.equal(p1Planned.shiftCode, 'AM');
  assert.equal(p2Planned.shiftCode, 'PM');
});

test('37. Planned integrity: Planned unchanged after REVERSAL while Current returns to effective state', () => {
  const { h, periodId } = setupPublished();
  const plannedBaseline = plannedRoster(h, periodId);

  const amendOp = makeAmendOp({
    periodId,
    expectedRevision: 1,
    personId: person1,
    date: `${periodId}-01`,
    afterAssignments: [{ shiftCode: 'PM' }]
  });
  const amendRes = amend(h, amendOp);

  const revOp = makeReversalOp({
    periodId,
    expectedRevision: 2,
    targetEventId: amendRes.eventId
  });
  const revRes = amendReversal(h, revOp);
  assert.equal(revRes.ok, true);
  assert.equal(revRes.state, 'PUBLISHED');

  // Planned is still identical to baseline
  const plannedAfter = plannedRoster(h, periodId);
  assert.deepEqual(plannedAfter.assignments, plannedBaseline.assignments, 'Planned remains identical through amendment and reversal');
});

test('38. Planned integrity: Planned remains byte-identical across multiple sequential amendments', () => {
  const { h, periodId } = setupPublished();
  const baselineJson = JSON.stringify(plannedRoster(h, periodId));

  for (let i = 1; i <= 3; i++) {
    const op = makeAmendOp({
      periodId,
      expectedRevision: i,
      personId: person1,
      date: `${periodId}-0${i}`,
      afterAssignments: [{ shiftCode: 'ND' }]
    });
    const res = amend(h, op);
    assert.equal(res.ok, true);

    const currentPlannedJson = JSON.stringify(plannedRoster(h, periodId));
    assert.equal(currentPlannedJson, baselineJson, `Planned snapshot must be byte-identical after amendment ${i}`);
  }
});

test('39. Planned integrity: Planned remains unchanged through Close and Reopen lifecycle state transitions', () => {
  const { h, periodId } = setupPublished();
  const plannedBaseline = plannedRoster(h, periodId);

  // Close period
  const closeOp = makeCloseOp({ periodId, expectedRevision: 1 });
  const closeRes = close(h, closeOp);
  assert.equal(closeRes.ok, true);
  assert.equal(closeRes.state, 'CLOSED');

  // Planned is available and identical in CLOSED state
  const plannedClosed = plannedRoster(h, periodId);
  assert.deepEqual(plannedClosed.assignments, plannedBaseline.assignments, 'Planned must remain identical in CLOSED state');

  // Reopen period
  const reopenOp = makeReopenOp({
    periodId,
    expectedRevision: 2,
    reason: 'Auditing planned changes'
  });
  const reopenRes = reopen(h, reopenOp);
  assert.equal(reopenRes.ok, true);

  // Planned is available and identical in REOPENED state
  const plannedReopened = plannedRoster(h, periodId);
  assert.deepEqual(plannedReopened.assignments, plannedBaseline.assignments, 'Planned must remain identical after Reopen');
});

test('40. Snapshot consistency: foreign SnapshotId and duplicate AssignmentId fail safely with CORRUPT_DATA', () => {
  const { h, periodId } = setupPublished();

  // 40a: Inject foreign SnapshotId row into RosterAssignments
  const foreignRow = [
    crypto.randomUUID(), periodId, 'PLANNED', 'FOREIGN-SNAPSHOT-ID',
    person1, 'Dr. Ali', `${periodId}-05`, 'MO', 'AM', '{}', 1, 'LEGACY', crypto.randomUUID(), new Date().toISOString(), 'admin@example.invalid'
  ];
  h.grids.RosterAssignments.push(foreignRow);

  const resForeign = plannedRoster(h, periodId);
  assert.equal(resForeign.ok, false);
  assert.equal(resForeign.error.code, 'CORRUPT_DATA');
  assert.match(resForeign.error.message, /Foreign snapshot rows/i);

  // Remove foreign row
  h.grids.RosterAssignments.pop();

  // 40b: Duplicate AssignmentId in snapshot
  const validPlannedRows = h.grids.RosterAssignments.filter(r => r[2] === 'PLANNED');
  const duplicateRow = [...validPlannedRows[0]]; // identical AssignmentId
  h.grids.RosterAssignments.push(duplicateRow);

  const resDuplicate = plannedRoster(h, periodId);
  assert.equal(resDuplicate.ok, false);
  assert.equal(resDuplicate.error.code, 'CORRUPT_DATA');
  assert.match(resDuplicate.error.message, /Duplicate or missing AssignmentId/i);
});

test('41. Deterministic response ordering: planned endpoint returns stable canonical sort order across sheet row permutations', () => {
  const { h, periodId } = setupPublished();
  const planned1 = plannedRoster(h, periodId);

  // Permute RosterAssignments rows (reverse the non-header rows)
  const headers = h.grids.RosterAssignments[0];
  const dataRows = h.grids.RosterAssignments.slice(1);
  dataRows.reverse();
  h.grids.RosterAssignments = [headers, ...dataRows];

  const planned2 = plannedRoster(h, periodId);
  assert.deepEqual(planned2.assignments, planned1.assignments, 'Permuted rows must yield byte-identical canonical assignments');
});

test('42. Viewer-safe Planned DTO: strips internal metadata and rejects unenrolled periods', () => {
  const { h, periodId } = setupPublished();

  const res = plannedRoster(h, periodId);
  assert.equal(res.ok, true);

  // Top level fields
  assert.ok(res.periodId);
  assert.ok(res.plannedSnapshotId);
  assert.equal(typeof res.count, 'number');
  assert.ok(Array.isArray(res.assignments));

  // No internal/private metadata leaked
  const json = JSON.stringify(res);
  assert.equal(json.includes('OperationId'), false, 'DTO must not expose OperationId');
  assert.equal(json.includes('CreatedBy'), false, 'DTO must not expose CreatedBy');
  assert.equal(json.includes('_row'), false, 'DTO must not expose _row');
  assert.equal(json.includes('DraftRevision'), false, 'DTO must not expose DraftRevision');
  assert.equal(json.includes('admin@example.invalid'), false, 'DTO must not expose admin email');

  // Assignment items have only display-safe fields
  res.assignments.forEach(a => {
    assert.ok(a.assignmentId);
    assert.ok(a.personId);
    assert.ok(a.personNameSnapshot);
    assert.ok(a.date);
    assert.ok(a.dutyDomain);
    assert.ok(a.shiftCode);
    assert.ok(typeof a.modifiers === 'object');
    assert.equal(a.OperationId, undefined);
    assert.equal(a.CreatedBy, undefined);
    assert.equal(a._row, undefined);
  });

  // Unenrolled period rejects with ENTITY_NOT_FOUND
  const unenrolledRes = plannedRoster(h, '1999-01');
  assert.equal(unenrolledRes.ok, false);
  assert.equal(unenrolledRes.error.code, 'ENTITY_NOT_FOUND');
});
