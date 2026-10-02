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
  publicReasonCode = 'ADMIN_CORRECTION',
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
    targetEventId,
    publicReasonCode,
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
  const amendOp = makeAmendOp({ periodId, expectedRevision: 1 });
  const amendRes = amend(h, amendOp);

  const revOp1 = makeReversalOp({ periodId, expectedRevision: 2, targetEventId: amendRes.eventId });
  const revRes1 = amendReversal(h, revOp1);
  assert.equal(revRes1.ok, true);

  // Attempt to reverse the same target event again
  const revOp2 = makeReversalOp({ periodId, expectedRevision: 3, targetEventId: amendRes.eventId });
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
    ev.lines.forEach(line => {
      assert.equal(line.AdminNote, undefined, 'Viewer must never receive AdminNote on line');
      assert.equal(line.CreatedBy, undefined, 'Viewer must never receive CreatedBy on line');
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
