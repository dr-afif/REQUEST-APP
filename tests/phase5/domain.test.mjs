import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import RosterLifecycle from '../../src/features/roster/lifecycle.js';
import RosterCompatibility from '../../src/features/roster/compatibility.js';

const digestFn = s => crypto.createHash('sha256').update(s).digest('hex');

const TEST_PEOPLE = [
  { PersonId: 'p-siti', MemberName: 'Dr Siti', CurrentDisplayName: 'Dr Siti', DirectoryType: 'MO' },
  { PersonId: 'p-ahmad', MemberName: 'Dr Ahmad', CurrentDisplayName: 'Dr Ahmad', DirectoryType: 'MO' },
  { PersonId: 'p-tan', MemberName: 'Dr Tan', CurrentDisplayName: 'Dr Tan', DirectoryType: 'MO' },
  { PersonId: 'p-ep', MemberName: 'Dr Specialist', CurrentDisplayName: 'Dr Specialist', DirectoryType: 'EP' }
];

function createBasePlannedSnapshot(periodId = '2026-07') {
  const opId = '11111111-1111-4111-8111-111111111111';
  const draftCells = {
    'p-siti/2026-07-01': ['AM'],
    'p-siti/2026-07-02': ['ON1'],
    'p-siti/2026-07-03': ['PM'],
    'p-ahmad/2026-07-01': ['PM'],
    'p-ahmad/2026-07-02': ['AM'],
    'p-tan/2026-07-01': ['ON1']
  };

  const snap = RosterLifecycle.generatePlannedSnapshot({
    periodId,
    draftCells,
    people: TEST_PEOPLE,
    operationId: opId,
    actor: 'admin',
    digestFn
  });

  return snap;
}

test('1. Planned rows remain unchanged after every resolver operation', () => {
  const baseSnap = createBasePlannedSnapshot();
  const plannedCopy = JSON.parse(JSON.stringify(baseSnap.assignments));

  const { lines } = RosterLifecycle.createAmendmentEvent({
    periodId: '2026-07',
    baseRevision: 1,
    resultRevision: 2,
    operationId: '22222222-2222-4222-8222-222222222222',
    actor: 'admin',
    publicReasonCode: RosterLifecycle.PUBLIC_REASON_CODES.ADMIN_CORRECTION,
    adminNote: 'Shift change',
    personId: 'p-siti',
    date: '2026-07-01',
    dutyDomain: 'MO',
    beforeAssignments: [{ ShiftCode: 'AM' }],
    afterAssignments: [{ ShiftCode: 'PM' }]
  });

  const res = RosterLifecycle.resolveCurrentRoster({
    periodId: '2026-07',
    plannedAssignments: baseSnap.assignments,
    events: lines,
    people: TEST_PEOPLE,
    digestFn
  });

  assert.equal(res.effectiveState, 'AMENDED');
  // Planned assignments array must be completely unaltered
  assert.deepStrictEqual(baseSnap.assignments, plannedCopy);
});

test('2. Current == Planned when no amendment exists', () => {
  const baseSnap = createBasePlannedSnapshot();
  const res = RosterLifecycle.resolveCurrentRoster({
    periodId: '2026-07',
    plannedAssignments: baseSnap.assignments,
    events: [],
    people: TEST_PEOPLE,
    digestFn
  });

  assert.equal(res.effectiveState, 'PUBLISHED');
  assert.equal(res.activeAmendmentCount, 0);
  assert.equal(res.totalEvents, 0);
  assert.equal(res.currentAssignments.length, baseSnap.assignments.length);

  for (let i = 0; i < baseSnap.assignments.length; i++) {
    const cur = res.currentAssignments[i];
    const plan = baseSnap.assignments[i];
    assert.equal(cur.Layer, 'CURRENT');
    assert.equal(cur.PersonId, plan.PersonId);
    assert.equal(cur.Date, plan.Date);
    assert.equal(cur.DutyDomain, plan.DutyDomain);
    assert.equal(cur.ShiftCode, plan.ShiftCode);
  }

  const expectedProjection = RosterLifecycle.generateMasterRosterProjection(baseSnap.assignments);
  assert.deepStrictEqual(res.masterRosterProjection, expectedProjection);
});

test('3. Single shift change (ADMIN_CORRECTION)', () => {
  const baseSnap = createBasePlannedSnapshot();
  const { lines } = RosterLifecycle.createAmendmentEvent({
    periodId: '2026-07',
    baseRevision: 1,
    resultRevision: 2,
    operationId: '33333333-3333-4333-8333-333333333333',
    actor: 'admin',
    publicReasonCode: RosterLifecycle.PUBLIC_REASON_CODES.ADMIN_CORRECTION,
    personId: 'p-siti',
    date: '2026-07-01',
    dutyDomain: 'MO',
    beforeAssignments: [{ ShiftCode: 'AM' }],
    afterAssignments: [{ ShiftCode: 'PM' }]
  });

  const res = RosterLifecycle.resolveCurrentRoster({
    periodId: '2026-07',
    plannedAssignments: baseSnap.assignments,
    events: lines,
    people: TEST_PEOPLE,
    digestFn
  });

  assert.equal(res.effectiveState, 'AMENDED');
  assert.equal(res.activeAmendmentCount, 1);
  const sitiDay1 = res.currentAssignments.find(a => a.PersonId === 'p-siti' && a.Date === '2026-07-01');
  assert.equal(sitiDay1.ShiftCode, 'PM');

  // Other assignments unchanged
  const ahmadDay1 = res.currentAssignments.find(a => a.PersonId === 'p-ahmad' && a.Date === '2026-07-01');
  assert.equal(ahmadDay1.ShiftCode, 'PM');
});

test('4. Assignment addition', () => {
  const baseSnap = createBasePlannedSnapshot();
  // Initially Ahmad has no shift on 2026-07-03
  assert.equal(baseSnap.assignments.some(a => a.PersonId === 'p-ahmad' && a.Date === '2026-07-03'), false);

  const { lines } = RosterLifecycle.createAmendmentEvent({
    periodId: '2026-07',
    baseRevision: 1,
    resultRevision: 2,
    operationId: '44444444-4444-4444-8444-444444444444',
    actor: 'admin',
    publicReasonCode: RosterLifecycle.PUBLIC_REASON_CODES.DUTY_COVERAGE,
    personId: 'p-ahmad',
    date: '2026-07-03',
    dutyDomain: 'MO',
    beforeAssignments: [],
    afterAssignments: [{ ShiftCode: 'AM' }]
  });

  const res = RosterLifecycle.resolveCurrentRoster({
    periodId: '2026-07',
    plannedAssignments: baseSnap.assignments,
    events: lines,
    people: TEST_PEOPLE,
    digestFn
  });

  assert.equal(res.currentAssignments.length, baseSnap.assignments.length + 1);
  const added = res.currentAssignments.find(a => a.PersonId === 'p-ahmad' && a.Date === '2026-07-03');
  assert.ok(added);
  assert.equal(added.ShiftCode, 'AM');
  assert.equal(added.PersonNameSnapshot, 'Dr Ahmad');
});

test('5. Assignment removal', () => {
  const baseSnap = createBasePlannedSnapshot();
  // Siti has PM on 2026-07-03
  assert.ok(baseSnap.assignments.some(a => a.PersonId === 'p-siti' && a.Date === '2026-07-03'));

  const { lines } = RosterLifecycle.createAmendmentEvent({
    periodId: '2026-07',
    baseRevision: 1,
    resultRevision: 2,
    operationId: '55555555-5555-4555-8555-555555555555',
    actor: 'admin',
    publicReasonCode: RosterLifecycle.PUBLIC_REASON_CODES.OPERATIONAL_CHANGE,
    personId: 'p-siti',
    date: '2026-07-03',
    dutyDomain: 'MO',
    beforeAssignments: [{ ShiftCode: 'PM' }],
    afterAssignments: []
  });

  const res = RosterLifecycle.resolveCurrentRoster({
    periodId: '2026-07',
    plannedAssignments: baseSnap.assignments,
    events: lines,
    people: TEST_PEOPLE,
    digestFn
  });

  assert.equal(res.currentAssignments.length, baseSnap.assignments.length - 1);
  assert.equal(res.currentAssignments.some(a => a.PersonId === 'p-siti' && a.Date === '2026-07-03'), false);
});

test('6. Multiple assignments for the same person/date without cross-domain corruption', () => {
  // Dr Siti has both an MO duty and an EP on-call assignment on the same date
  const basePlanned = [
    {
      AssignmentId: 'a1111111-1111-4111-8111-111111111111',
      PeriodId: '2026-07',
      Layer: 'PLANNED',
      SnapshotId: 'snap-1',
      PersonId: 'p-siti',
      PersonNameSnapshot: 'Dr Siti',
      Date: '2026-07-05',
      DutyDomain: 'MO',
      ShiftCode: 'AM',
      ModifiersJson: '{}'
    },
    {
      AssignmentId: 'a2222222-2222-4222-8222-222222222222',
      PeriodId: '2026-07',
      Layer: 'PLANNED',
      SnapshotId: 'snap-1',
      PersonId: 'p-siti',
      PersonNameSnapshot: 'Dr Siti',
      Date: '2026-07-05',
      DutyDomain: 'EP',
      ShiftCode: 'EP_ONCALL',
      ModifiersJson: '{}'
    }
  ];

  // Amend ONLY the MO duty domain to 'ON1'
  const { lines: lines1 } = RosterLifecycle.createAmendmentEvent({
    periodId: '2026-07',
    baseRevision: 1,
    resultRevision: 2,
    operationId: '66666666-6666-4666-8666-666666666661',
    actor: 'admin',
    publicReasonCode: RosterLifecycle.PUBLIC_REASON_CODES.ADMIN_CORRECTION,
    personId: 'p-siti',
    date: '2026-07-05',
    dutyDomain: 'MO',
    beforeAssignments: [{ ShiftCode: 'AM' }],
    afterAssignments: [{ ShiftCode: 'ON1' }]
  });

  const res1 = RosterLifecycle.resolveCurrentRoster({
    periodId: '2026-07',
    plannedAssignments: basePlanned,
    events: lines1,
    people: TEST_PEOPLE
  });

  const moAssignment = res1.currentAssignments.find(a => a.DutyDomain === 'MO');
  const epAssignment = res1.currentAssignments.find(a => a.DutyDomain === 'EP');

  assert.equal(moAssignment.ShiftCode, 'ON1');
  assert.equal(epAssignment.ShiftCode, 'EP_ONCALL'); // EP assignment completely untouched!

  // Now amend the EP domain
  const { lines: lines2 } = RosterLifecycle.createAmendmentEvent({
    periodId: '2026-07',
    baseRevision: 2,
    resultRevision: 3,
    operationId: '66666666-6666-4666-8666-666666666662',
    actor: 'admin',
    publicReasonCode: RosterLifecycle.PUBLIC_REASON_CODES.DUTY_COVERAGE,
    personId: 'p-siti',
    date: '2026-07-05',
    dutyDomain: 'EP',
    beforeAssignments: [{ ShiftCode: 'EP_ONCALL' }],
    afterAssignments: [{ ShiftCode: 'EP_OFFICE_HOUR' }]
  });

  const res2 = RosterLifecycle.resolveCurrentRoster({
    periodId: '2026-07',
    plannedAssignments: basePlanned,
    events: [...lines1, ...lines2],
    people: TEST_PEOPLE
  });

  const moAssignment2 = res2.currentAssignments.find(a => a.DutyDomain === 'MO');
  const epAssignment2 = res2.currentAssignments.find(a => a.DutyDomain === 'EP');
  assert.equal(moAssignment2.ShiftCode, 'ON1');
  assert.equal(epAssignment2.ShiftCode, 'EP_OFFICE_HOUR');
});

test('7. SWAP applies both lines atomically', () => {
  const baseSnap = createBasePlannedSnapshot();
  // Siti: AM on 2026-07-01
  // Ahmad: PM on 2026-07-01
  const swapEvent = RosterLifecycle.createSwapEvent({
    periodId: '2026-07',
    baseRevision: 1,
    resultRevision: 2,
    operationId: '77777777-7777-4777-8777-777777777777',
    actor: 'admin',
    publicReasonCode: RosterLifecycle.PUBLIC_REASON_CODES.SHIFT_SWAP,
    adminNote: 'Peer requested swap',
    person1: {
      personId: 'p-siti',
      date: '2026-07-01',
      dutyDomain: 'MO',
      beforeAssignments: [{ ShiftCode: 'AM' }],
      afterAssignments: [{ ShiftCode: 'PM' }]
    },
    person2: {
      personId: 'p-ahmad',
      date: '2026-07-01',
      dutyDomain: 'MO',
      beforeAssignments: [{ ShiftCode: 'PM' }],
      afterAssignments: [{ ShiftCode: 'AM' }]
    }
  });

  assert.equal(swapEvent.lines.length, 2);
  assert.equal(swapEvent.lines[0].EventId, swapEvent.lines[1].EventId);

  const res = RosterLifecycle.resolveCurrentRoster({
    periodId: '2026-07',
    plannedAssignments: baseSnap.assignments,
    events: swapEvent.lines,
    people: TEST_PEOPLE
  });

  assert.equal(res.effectiveState, 'AMENDED');
  assert.equal(res.activeAmendmentCount, 1);
  const curSiti = res.currentAssignments.find(a => a.PersonId === 'p-siti' && a.Date === '2026-07-01');
  const curAhmad = res.currentAssignments.find(a => a.PersonId === 'p-ahmad' && a.Date === '2026-07-01');
  assert.equal(curSiti.ShiftCode, 'PM');
  assert.equal(curAhmad.ShiftCode, 'AM');
});

test('8. Malformed / partial SWAP rejected', () => {
  const baseSnap = createBasePlannedSnapshot();
  const swapEvent = RosterLifecycle.createSwapEvent({
    periodId: '2026-07',
    baseRevision: 1,
    resultRevision: 2,
    operationId: '88888888-8888-4888-8888-888888888888',
    actor: 'admin',
    person1: {
      personId: 'p-siti',
      date: '2026-07-01',
      dutyDomain: 'MO',
      beforeAssignments: [{ ShiftCode: 'AM' }],
      afterAssignments: [{ ShiftCode: 'PM' }]
    },
    person2: {
      personId: 'p-ahmad',
      date: '2026-07-01',
      dutyDomain: 'MO',
      beforeAssignments: [{ ShiftCode: 'PM' }],
      afterAssignments: [{ ShiftCode: 'AM' }]
    }
  });

  // Only pass 1 line of the swap
  const partialLines = [swapEvent.lines[0]];
  assert.throws(() => {
    RosterLifecycle.resolveCurrentRoster({
      periodId: '2026-07',
      plannedAssignments: baseSnap.assignments,
      events: partialLines,
      people: TEST_PEOPLE
    });
  }, err => err.code === 'INCOMPLETE_SWAP');

  // Multi-line event with inconsistent ResultRevision
  const malformedLines = [
    { ...swapEvent.lines[0], ResultRevision: 2 },
    { ...swapEvent.lines[1], ResultRevision: 3 }
  ];
  assert.throws(() => {
    RosterLifecycle.resolveCurrentRoster({
      periodId: '2026-07',
      plannedAssignments: baseSnap.assignments,
      events: malformedLines,
      people: TEST_PEOPLE
    });
  }, err => err.code === 'MALFORMED_EVENT');
});

test('9. Deterministic result regardless of input row order', () => {
  const baseSnap = createBasePlannedSnapshot();

  const ev1 = RosterLifecycle.createAmendmentEvent({
    periodId: '2026-07',
    baseRevision: 1,
    resultRevision: 2,
    operationId: '99999999-9999-4999-8999-999999999991',
    actor: 'admin',
    publicReasonCode: RosterLifecycle.PUBLIC_REASON_CODES.ADMIN_CORRECTION,
    personId: 'p-siti',
    date: '2026-07-01',
    dutyDomain: 'MO',
    beforeAssignments: [{ ShiftCode: 'AM' }],
    afterAssignments: [{ ShiftCode: 'PM' }]
  });

  const ev2 = RosterLifecycle.createSwapEvent({
    periodId: '2026-07',
    baseRevision: 2,
    resultRevision: 3,
    operationId: '99999999-9999-4999-8999-999999999992',
    actor: 'admin',
    person1: {
      personId: 'p-siti',
      date: '2026-07-02',
      dutyDomain: 'MO',
      beforeAssignments: [{ ShiftCode: 'ON1' }],
      afterAssignments: [{ ShiftCode: 'AM' }]
    },
    person2: {
      personId: 'p-ahmad',
      date: '2026-07-02',
      dutyDomain: 'MO',
      beforeAssignments: [{ ShiftCode: 'AM' }],
      afterAssignments: [{ ShiftCode: 'ON1' }]
    }
  });

  const allLinesOrderA = [...ev1.lines, ...ev2.lines];
  const allLinesOrderB = [...ev2.lines, ...ev1.lines]; // reversed event order
  const allLinesOrderC = [ev2.lines[1], ev1.lines[0], ev2.lines[0]]; // interleaved scrambled lines

  const resA = RosterLifecycle.resolveCurrentRoster({
    periodId: '2026-07',
    plannedAssignments: baseSnap.assignments,
    events: allLinesOrderA,
    people: TEST_PEOPLE,
    digestFn
  });

  const resB = RosterLifecycle.resolveCurrentRoster({
    periodId: '2026-07',
    plannedAssignments: baseSnap.assignments,
    events: allLinesOrderB,
    people: TEST_PEOPLE,
    digestFn
  });

  const resC = RosterLifecycle.resolveCurrentRoster({
    periodId: '2026-07',
    plannedAssignments: baseSnap.assignments,
    events: allLinesOrderC,
    people: TEST_PEOPLE,
    digestFn
  });

  assert.deepStrictEqual(resA.currentAssignments, resB.currentAssignments);
  assert.deepStrictEqual(resA.currentAssignments, resC.currentAssignments);
  assert.equal(resA.projectionChecksum, resB.projectionChecksum);
  assert.equal(resA.projectionChecksum, resC.projectionChecksum);
});

test('10. Sequential amendments to same target', () => {
  const baseSnap = createBasePlannedSnapshot();
  // Siti on 2026-07-01: Planned AM
  const ev1 = RosterLifecycle.createAmendmentEvent({
    periodId: '2026-07',
    baseRevision: 1,
    resultRevision: 2,
    operationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    actor: 'admin',
    publicReasonCode: RosterLifecycle.PUBLIC_REASON_CODES.ADMIN_CORRECTION,
    personId: 'p-siti',
    date: '2026-07-01',
    dutyDomain: 'MO',
    beforeAssignments: [{ ShiftCode: 'AM' }],
    afterAssignments: [{ ShiftCode: 'PM' }]
  });

  const ev2 = RosterLifecycle.createAmendmentEvent({
    periodId: '2026-07',
    baseRevision: 2,
    resultRevision: 3,
    operationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    actor: 'admin',
    publicReasonCode: RosterLifecycle.PUBLIC_REASON_CODES.ADMIN_CORRECTION,
    personId: 'p-siti',
    date: '2026-07-01',
    dutyDomain: 'MO',
    beforeAssignments: [{ ShiftCode: 'PM' }],
    afterAssignments: [{ ShiftCode: 'ON1' }]
  });

  const res = RosterLifecycle.resolveCurrentRoster({
    periodId: '2026-07',
    plannedAssignments: baseSnap.assignments,
    events: [...ev1.lines, ...ev2.lines],
    people: TEST_PEOPLE
  });

  const sitiCur = res.currentAssignments.find(a => a.PersonId === 'p-siti' && a.Date === '2026-07-01');
  assert.equal(sitiCur.ShiftCode, 'ON1');
  assert.equal(res.activeAmendmentCount, 2);
});

test('11. Amendment to different independent targets', () => {
  const baseSnap = createBasePlannedSnapshot();
  const ev1 = RosterLifecycle.createAmendmentEvent({
    periodId: '2026-07',
    baseRevision: 1,
    resultRevision: 2,
    operationId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    actor: 'admin',
    publicReasonCode: RosterLifecycle.PUBLIC_REASON_CODES.ADMIN_CORRECTION,
    personId: 'p-siti',
    date: '2026-07-01',
    dutyDomain: 'MO',
    beforeAssignments: [{ ShiftCode: 'AM' }],
    afterAssignments: [{ ShiftCode: 'PM' }]
  });

  const ev2 = RosterLifecycle.createAmendmentEvent({
    periodId: '2026-07',
    baseRevision: 2,
    resultRevision: 3,
    operationId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    actor: 'admin',
    publicReasonCode: RosterLifecycle.PUBLIC_REASON_CODES.ADMIN_CORRECTION,
    personId: 'p-ahmad',
    date: '2026-07-02',
    dutyDomain: 'MO',
    beforeAssignments: [{ ShiftCode: 'AM' }],
    afterAssignments: [{ ShiftCode: 'ON1' }]
  });

  const res = RosterLifecycle.resolveCurrentRoster({
    periodId: '2026-07',
    plannedAssignments: baseSnap.assignments,
    events: [...ev1.lines, ...ev2.lines],
    people: TEST_PEOPLE
  });

  const sitiCur = res.currentAssignments.find(a => a.PersonId === 'p-siti' && a.Date === '2026-07-01');
  const ahmadCur = res.currentAssignments.find(a => a.PersonId === 'p-ahmad' && a.Date === '2026-07-02');
  assert.equal(sitiCur.ShiftCode, 'PM');
  assert.equal(ahmadCur.ShiftCode, 'ON1');
  assert.equal(res.activeAmendmentCount, 2);
});

test('12. Compensating reversal restores previous Current state', () => {
  const baseSnap = createBasePlannedSnapshot();

  const evAmend = RosterLifecycle.createAmendmentEvent({
    periodId: '2026-07',
    baseRevision: 1,
    resultRevision: 2,
    operationId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    actor: 'admin',
    publicReasonCode: RosterLifecycle.PUBLIC_REASON_CODES.ADMIN_CORRECTION,
    personId: 'p-siti',
    date: '2026-07-01',
    dutyDomain: 'MO',
    beforeAssignments: [{ ShiftCode: 'AM' }],
    afterAssignments: [{ ShiftCode: 'PM' }]
  });

  const grouped = RosterLifecycle.groupEventLines(evAmend.lines);
  const evRev = RosterLifecycle.createReversalEvent({
    targetEvent: grouped[0],
    baseRevision: 2,
    resultRevision: 3,
    operationId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
    actor: 'admin',
    publicReasonCode: RosterLifecycle.PUBLIC_REASON_CODES.REVERSAL
  });

  const res = RosterLifecycle.resolveCurrentRoster({
    periodId: '2026-07',
    plannedAssignments: baseSnap.assignments,
    events: [...evAmend.lines, ...evRev.lines],
    people: TEST_PEOPLE,
    digestFn
  });

  // State is restored to Planned!
  const sitiCur = res.currentAssignments.find(a => a.PersonId === 'p-siti' && a.Date === '2026-07-01');
  assert.equal(sitiCur.ShiftCode, 'AM');
  assert.equal(res.activeAmendmentCount, 0);
  assert.equal(res.effectiveState, 'PUBLISHED');
  assert.equal(res.reversedEventIds.includes(grouped[0].EventId), true);
});

test('13. Reversing latest of multiple amendments restores preceding amendment state', () => {
  const baseSnap = createBasePlannedSnapshot();

  // Amend A (Siti)
  const evA = RosterLifecycle.createAmendmentEvent({
    periodId: '2026-07',
    baseRevision: 1,
    resultRevision: 2,
    operationId: '10000000-0000-4000-8000-000000000001',
    actor: 'admin',
    publicReasonCode: RosterLifecycle.PUBLIC_REASON_CODES.ADMIN_CORRECTION,
    personId: 'p-siti',
    date: '2026-07-01',
    dutyDomain: 'MO',
    beforeAssignments: [{ ShiftCode: 'AM' }],
    afterAssignments: [{ ShiftCode: 'PM' }]
  });

  // State after A
  const resAfterA = RosterLifecycle.resolveCurrentRoster({
    periodId: '2026-07',
    plannedAssignments: baseSnap.assignments,
    events: evA.lines,
    people: TEST_PEOPLE
  });

  // Amend B (Ahmad)
  const evB = RosterLifecycle.createAmendmentEvent({
    periodId: '2026-07',
    baseRevision: 2,
    resultRevision: 3,
    operationId: '10000000-0000-4000-8000-000000000002',
    actor: 'admin',
    publicReasonCode: RosterLifecycle.PUBLIC_REASON_CODES.DUTY_COVERAGE,
    personId: 'p-ahmad',
    date: '2026-07-02',
    dutyDomain: 'MO',
    beforeAssignments: [{ ShiftCode: 'AM' }],
    afterAssignments: [{ ShiftCode: 'ON1' }]
  });

  // Reversal of B
  const groupedB = RosterLifecycle.groupEventLines(evB.lines);
  const revB = RosterLifecycle.createReversalEvent({
    targetEvent: groupedB[0],
    baseRevision: 3,
    resultRevision: 4,
    operationId: '10000000-0000-4000-8000-000000000003',
    actor: 'admin'
  });

  const resAfterRevB = RosterLifecycle.resolveCurrentRoster({
    periodId: '2026-07',
    plannedAssignments: baseSnap.assignments,
    events: [...evA.lines, ...evB.lines, ...revB.lines],
    people: TEST_PEOPLE
  });

  // Must match exactly the state after A
  assert.equal(resAfterRevB.activeAmendmentCount, 1);
  assert.equal(resAfterRevB.effectiveState, 'AMENDED');
  assert.deepStrictEqual(
    resAfterRevB.currentAssignments.map(a => ({ p: a.PersonId, d: a.Date, s: a.ShiftCode })),
    resAfterA.currentAssignments.map(a => ({ p: a.PersonId, d: a.Date, s: a.ShiftCode }))
  );
});

test('14. Double reversal rejected', () => {
  const baseSnap = createBasePlannedSnapshot();
  const evAmend = RosterLifecycle.createAmendmentEvent({
    periodId: '2026-07',
    baseRevision: 1,
    resultRevision: 2,
    operationId: '20000000-0000-4000-8000-000000000001',
    actor: 'admin',
    publicReasonCode: RosterLifecycle.PUBLIC_REASON_CODES.ADMIN_CORRECTION,
    personId: 'p-siti',
    date: '2026-07-01',
    dutyDomain: 'MO',
    beforeAssignments: [{ ShiftCode: 'AM' }],
    afterAssignments: [{ ShiftCode: 'PM' }]
  });

  const grouped = RosterLifecycle.groupEventLines(evAmend.lines);
  const rev1 = RosterLifecycle.createReversalEvent({
    targetEvent: grouped[0],
    baseRevision: 2,
    resultRevision: 3,
    operationId: '20000000-0000-4000-8000-000000000002',
    actor: 'admin'
  });

  const rev2 = RosterLifecycle.createReversalEvent({
    targetEvent: grouped[0],
    baseRevision: 3,
    resultRevision: 4,
    operationId: '20000000-0000-4000-8000-000000000003',
    actor: 'admin'
  });

  // canReverseEvent reports already reversed
  const check = RosterLifecycle.canReverseEvent(grouped[0].EventId, [...evAmend.lines, ...rev1.lines]);
  assert.equal(check.canReverse, false);
  assert.equal(check.code, 'EVENT_ALREADY_REVERSED');

  // Resolver strictly throws on duplicate reversal
  assert.throws(() => {
    RosterLifecycle.resolveCurrentRoster({
      periodId: '2026-07',
      plannedAssignments: baseSnap.assignments,
      events: [...evAmend.lines, ...rev1.lines, ...rev2.lines],
      people: TEST_PEOPLE
    });
  }, err => err.code === 'EVENT_ALREADY_REVERSED');
});

test('15. Reversal dependency conflict when newer active amendment changed the same target', () => {
  const evA = RosterLifecycle.createAmendmentEvent({
    periodId: '2026-07',
    baseRevision: 1,
    resultRevision: 2,
    operationId: '30000000-0000-4000-8000-000000000001',
    actor: 'admin',
    publicReasonCode: RosterLifecycle.PUBLIC_REASON_CODES.ADMIN_CORRECTION,
    personId: 'p-siti',
    date: '2026-07-01',
    dutyDomain: 'MO',
    beforeAssignments: [{ ShiftCode: 'AM' }],
    afterAssignments: [{ ShiftCode: 'PM' }]
  });

  const evB = RosterLifecycle.createAmendmentEvent({
    periodId: '2026-07',
    baseRevision: 2,
    resultRevision: 3,
    operationId: '30000000-0000-4000-8000-000000000002',
    actor: 'admin',
    publicReasonCode: RosterLifecycle.PUBLIC_REASON_CODES.ADMIN_CORRECTION,
    personId: 'p-siti',
    date: '2026-07-01',
    dutyDomain: 'MO',
    beforeAssignments: [{ ShiftCode: 'PM' }],
    afterAssignments: [{ ShiftCode: 'ON1' }]
  });

  const allEvents = [...evA.lines, ...evB.lines];
  const checkA = RosterLifecycle.canReverseEvent(evA.eventId, allEvents);
  assert.equal(checkA.canReverse, false);
  assert.equal(checkA.code, 'REVERSAL_DEPENDENCY_CONFLICT');
  assert.equal(checkA.conflictingEventId, evB.eventId);
});

test('16. Reversal allowed when later amendments affect unrelated targets', () => {
  const evA = RosterLifecycle.createAmendmentEvent({
    periodId: '2026-07',
    baseRevision: 1,
    resultRevision: 2,
    operationId: '40000000-0000-4000-8000-000000000001',
    actor: 'admin',
    publicReasonCode: RosterLifecycle.PUBLIC_REASON_CODES.ADMIN_CORRECTION,
    personId: 'p-siti',
    date: '2026-07-01',
    dutyDomain: 'MO',
    beforeAssignments: [{ ShiftCode: 'AM' }],
    afterAssignments: [{ ShiftCode: 'PM' }]
  });

  const evB = RosterLifecycle.createAmendmentEvent({
    periodId: '2026-07',
    baseRevision: 2,
    resultRevision: 3,
    operationId: '40000000-0000-4000-8000-000000000002',
    actor: 'admin',
    publicReasonCode: RosterLifecycle.PUBLIC_REASON_CODES.ADMIN_CORRECTION,
    personId: 'p-ahmad',
    date: '2026-07-02',
    dutyDomain: 'MO',
    beforeAssignments: [{ ShiftCode: 'AM' }],
    afterAssignments: [{ ShiftCode: 'ON1' }]
  });

  const allEvents = [...evA.lines, ...evB.lines];
  const checkA = RosterLifecycle.canReverseEvent(evA.eventId, allEvents);
  assert.equal(checkA.canReverse, true);
});

test('17. Active amendment count', () => {
  const ev1 = RosterLifecycle.createAmendmentEvent({
    periodId: '2026-07',
    baseRevision: 1,
    resultRevision: 2,
    operationId: '50000000-0000-4000-8000-000000000001',
    actor: 'admin',
    publicReasonCode: RosterLifecycle.PUBLIC_REASON_CODES.ADMIN_CORRECTION,
    personId: 'p-siti',
    date: '2026-07-01',
    dutyDomain: 'MO',
    afterAssignments: [{ ShiftCode: 'PM' }]
  });

  const ev2 = RosterLifecycle.createAmendmentEvent({
    periodId: '2026-07',
    baseRevision: 2,
    resultRevision: 3,
    operationId: '50000000-0000-4000-8000-000000000002',
    actor: 'admin',
    publicReasonCode: RosterLifecycle.PUBLIC_REASON_CODES.DUTY_COVERAGE,
    personId: 'p-ahmad',
    date: '2026-07-02',
    dutyDomain: 'MO',
    afterAssignments: [{ ShiftCode: 'ON1' }]
  });

  assert.equal(RosterLifecycle.countActiveAmendments([...ev1.lines, ...ev2.lines]), 2);

  const grouped1 = RosterLifecycle.groupEventLines(ev1.lines);
  const rev1 = RosterLifecycle.createReversalEvent({
    targetEvent: grouped1[0],
    baseRevision: 3,
    resultRevision: 4,
    operationId: '50000000-0000-4000-8000-000000000003',
    actor: 'admin'
  });

  assert.equal(RosterLifecycle.countActiveAmendments([...ev1.lines, ...ev2.lines, ...rev1.lines]), 1);

  const grouped2 = RosterLifecycle.groupEventLines(ev2.lines);
  const rev2 = RosterLifecycle.createReversalEvent({
    targetEvent: grouped2[0],
    baseRevision: 4,
    resultRevision: 5,
    operationId: '50000000-0000-4000-8000-000000000004',
    actor: 'admin'
  });

  assert.equal(RosterLifecycle.countActiveAmendments([...ev1.lines, ...ev2.lines, ...rev1.lines, ...rev2.lines]), 0);
});

test('18. Final reversal returns effective lifecycle target to PUBLISHED', () => {
  const baseSnap = createBasePlannedSnapshot();
  const ev1 = RosterLifecycle.createAmendmentEvent({
    periodId: '2026-07',
    baseRevision: 1,
    resultRevision: 2,
    operationId: '60000000-0000-4000-8000-000000000001',
    actor: 'admin',
    publicReasonCode: RosterLifecycle.PUBLIC_REASON_CODES.ADMIN_CORRECTION,
    personId: 'p-siti',
    date: '2026-07-01',
    dutyDomain: 'MO',
    afterAssignments: [{ ShiftCode: 'PM' }]
  });

  const res1 = RosterLifecycle.resolveCurrentRoster({
    periodId: '2026-07',
    plannedAssignments: baseSnap.assignments,
    events: ev1.lines,
    people: TEST_PEOPLE
  });
  assert.equal(res1.effectiveState, 'AMENDED');
  assert.equal(res1.activeAmendmentCount, 1);

  const grouped = RosterLifecycle.groupEventLines(ev1.lines);
  const rev1 = RosterLifecycle.createReversalEvent({
    targetEvent: grouped[0],
    baseRevision: 2,
    resultRevision: 3,
    operationId: '60000000-0000-4000-8000-000000000002',
    actor: 'admin'
  });

  const res2 = RosterLifecycle.resolveCurrentRoster({
    periodId: '2026-07',
    plannedAssignments: baseSnap.assignments,
    events: [...ev1.lines, ...rev1.lines],
    people: TEST_PEOPLE
  });
  assert.equal(res2.effectiveState, 'PUBLISHED');
  assert.equal(res2.activeAmendmentCount, 0);

  // validateTransition allows AMENDED -> PUBLISHED when activeAmendmentCount === 0
  const tr = RosterLifecycle.validateTransition('AMENDED', 'PUBLISHED', {
    actor: 'admin',
    phase: 5,
    activeAmendmentCount: 0
  });
  assert.equal(tr.valid, true);
  assert.equal(tr.nextState, 'PUBLISHED');

  // Rejects return to PUBLISHED if active amendments remain
  assert.throws(() => {
    RosterLifecycle.validateTransition('AMENDED', 'PUBLISHED', {
      actor: 'admin',
      phase: 5,
      activeAmendmentCount: 1
    });
  }, err => err.code === 'INVALID_LIFECYCLE_TRANSITION');
});

test('19. Remaining active amendment keeps target AMENDED', () => {
  assert.equal(RosterLifecycle.determineReopenTarget(1), 'AMENDED');
  assert.equal(RosterLifecycle.determineReopenTarget(5), 'AMENDED');
  assert.equal(RosterLifecycle.determineReopenTarget(0), 'PUBLISHED');
});

test('20. AMENDED can close', () => {
  const tr = RosterLifecycle.validateTransition('AMENDED', 'CLOSED', {
    actor: 'admin',
    phase: 5,
    isManual: true,
    currentRevision: 4
  });
  assert.equal(tr.valid, true);
  assert.equal(tr.nextState, 'CLOSED');
  assert.equal(tr.nextRevision, 5);

  // Automatic close is prohibited
  assert.throws(() => {
    RosterLifecycle.validateTransition('AMENDED', 'CLOSED', {
      actor: 'admin',
      phase: 5,
      isManual: false
    });
  }, err => err.code === 'INVALID_LIFECYCLE_TRANSITION');

  // Pending operations block close
  assert.throws(() => {
    RosterLifecycle.validateTransition('AMENDED', 'CLOSED', {
      actor: 'admin',
      phase: 5,
      isManual: true,
      reconciliation: { pendingOperationsCount: 2 }
    });
  }, err => err.code === 'RECONCILIATION_FAILED');
});

test('21. CLOSED reopen target resolves dynamically', () => {
  // Active amendments = 0 -> Reopens to PUBLISHED
  const trZero = RosterLifecycle.validateTransition('CLOSED', 'PUBLISHED', {
    actor: 'admin',
    phase: 5,
    isManual: true,
    reason: 'Reviewing after zero amendments',
    activeAmendmentCount: 0,
    currentRevision: 5
  });
  assert.equal(trZero.valid, true);
  assert.equal(trZero.nextState, 'PUBLISHED');

  // Mismatch throws error: trying to reopen to AMENDED with 0 active amendments
  assert.throws(() => {
    RosterLifecycle.validateTransition('CLOSED', 'AMENDED', {
      actor: 'admin',
      phase: 5,
      isManual: true,
      reason: 'Reviewing',
      activeAmendmentCount: 0
    });
  }, err => err.code === 'INVALID_LIFECYCLE_TRANSITION');

  // Active amendments > 0 -> Reopens to AMENDED
  const trActive = RosterLifecycle.validateTransition('CLOSED', 'AMENDED', {
    actor: 'admin',
    phase: 5,
    isManual: true,
    reason: 'Reviewing after amendments',
    activeAmendmentCount: 2,
    currentRevision: 5
  });
  assert.equal(trActive.valid, true);
  assert.equal(trActive.nextState, 'AMENDED');

  // Mismatch throws error: trying to reopen to PUBLISHED with active amendments
  assert.throws(() => {
    RosterLifecycle.validateTransition('CLOSED', 'PUBLISHED', {
      actor: 'admin',
      phase: 5,
      isManual: true,
      reason: 'Reviewing',
      activeAmendmentCount: 2
    });
  }, err => err.code === 'INVALID_LIFECYCLE_TRANSITION');
});

test('22. Public reason validation', () => {
  // Valid codes pass
  for (const code of Object.values(RosterLifecycle.PUBLIC_REASON_CODES)) {
    assert.equal(RosterLifecycle.isValidPublicReasonCode(code), true);
    assert.equal(RosterLifecycle.validatePublicReasonCode(code), code);
  }

  // Lifecycle codes pass
  assert.equal(RosterLifecycle.isValidPublicReasonCode('PUBLISH'), true);
  assert.equal(RosterLifecycle.isValidPublicReasonCode('CLOSE'), true);
  assert.equal(RosterLifecycle.isValidPublicReasonCode('REOPEN'), true);

  // Invalid codes fail
  assert.equal(RosterLifecycle.isValidPublicReasonCode('PERSONAL_FAVOR'), false);
  assert.equal(RosterLifecycle.isValidPublicReasonCode(''), false);
  assert.equal(RosterLifecycle.isValidPublicReasonCode(null), false);

  assert.throws(() => {
    RosterLifecycle.validatePublicReasonCode('UNKNOWN_CODE_XYZ');
  }, err => err.code === 'UNKNOWN_REASON_CODE');
});

test('23. Private AdminNote never leaks into viewer / projection structures', () => {
  const baseSnap = createBasePlannedSnapshot();
  const secretNote = 'TOP_SECRET_MEDICAL_BOARD_INQUIRY_DO_NOT_DISCLOSE';

  const ev = RosterLifecycle.createAmendmentEvent({
    periodId: '2026-07',
    baseRevision: 1,
    resultRevision: 2,
    operationId: '70000000-0000-4000-8000-000000000001',
    actor: 'admin',
    publicReasonCode: RosterLifecycle.PUBLIC_REASON_CODES.ADMIN_CORRECTION,
    adminNote: secretNote,
    personId: 'p-siti',
    date: '2026-07-01',
    dutyDomain: 'MO',
    beforeAssignments: [{ ShiftCode: 'AM' }],
    afterAssignments: [{ ShiftCode: 'PM' }]
  });

  // Verify builder did not leak note into public code or lines
  assert.notEqual(ev.lines[0].PublicReasonCode, secretNote);
  assert.equal(ev.lines[0].PublicReasonCode, 'ADMIN_CORRECTION');
  assert.equal(ev.lines[0].AdminNote, secretNote);

  const res = RosterLifecycle.resolveCurrentRoster({
    periodId: '2026-07',
    plannedAssignments: baseSnap.assignments,
    events: ev.lines,
    people: TEST_PEOPLE,
    digestFn
  });

  // Check master roster projection rows
  const jsonProjection = JSON.stringify(res.masterRosterProjection);
  assert.equal(jsonProjection.includes(secretNote), false);

  // Check current assignments
  for (const a of res.currentAssignments) {
    assert.equal(String(a.ShiftCode).includes(secretNote), false);
    assert.equal(String(a.ModifiersJson).includes(secretNote), false);
    assert.equal(String(a._rawShift).includes(secretNote), false);
  }
});

test('24. Multi-line events using shared EventId and deterministic LineId ordering', () => {
  const eventId = '80000000-0000-4000-8000-000000000001';
  const rawRows = [
    {
      EventId: eventId,
      LineId: 'line-z-second',
      EventType: 'SWAP',
      OperationId: '80000000-0000-4000-8000-000000000002',
      PeriodId: '2026-07',
      BaseRevision: 1,
      ResultRevision: 2,
      PersonId: 'p-ahmad',
      LinkedPersonIdsJson: '["p-siti"]',
      Date: '2026-07-01',
      DutyDomain: 'MO',
      BeforeCurrentJson: '[]',
      AfterCurrentJson: '[]',
      PublicReasonCode: 'SHIFT_SWAP'
    },
    {
      EventId: eventId,
      LineId: 'line-a-first',
      EventType: 'SWAP',
      OperationId: '80000000-0000-4000-8000-000000000002',
      PeriodId: '2026-07',
      BaseRevision: 1,
      ResultRevision: 2,
      PersonId: 'p-siti',
      LinkedPersonIdsJson: '["p-ahmad"]',
      Date: '2026-07-01',
      DutyDomain: 'MO',
      BeforeCurrentJson: '[]',
      AfterCurrentJson: '[]',
      PublicReasonCode: 'SHIFT_SWAP'
    }
  ];

  const grouped = RosterLifecycle.groupEventLines(rawRows);
  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].EventId, eventId);
  assert.equal(grouped[0].lines.length, 2);
  // LineId order must be sorted deterministically: 'line-a-first' then 'line-z-second'
  assert.equal(grouped[0].lines[0].LineId, 'line-a-first');
  assert.equal(grouped[0].lines[1].LineId, 'line-z-second');

  // Duplicate LineId in same event throws error
  const duplicateRows = [
    { ...rawRows[0], LineId: 'duplicate-line' },
    { ...rawRows[1], LineId: 'duplicate-line' }
  ];
  assert.throws(() => {
    RosterLifecycle.groupEventLines(duplicateRows);
  }, err => err.code === 'MALFORMED_EVENT');
});
