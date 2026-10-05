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
    publicReasonCode: RosterLifecycle.PUBLIC_REASON_CODES.ADMIN_CORRECTION
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

test('25. PublicReasonCode narrow scope verification (Section A)', () => {
  // Exact 5 Phase 5 public reason codes
  assert.deepStrictEqual(Object.keys(RosterLifecycle.PUBLIC_REASON_CODES).sort(), [
    'ADMIN_CORRECTION',
    'DUTY_COVERAGE',
    'OPERATIONAL_CHANGE',
    'OTHER',
    'SHIFT_SWAP'
  ]);

  // Phase 6 absence codes (MC, EL, AL, COURSE) and REVERSAL are not authorized Phase 5 reason codes
  for (const prohibited of ['MC', 'EL', 'AL', 'COURSE', 'REVERSAL']) {
    assert.equal(RosterLifecycle.isValidPublicReasonCode(prohibited), false);
    assert.throws(() => {
      RosterLifecycle.validatePublicReasonCode(prohibited);
    }, err => err.code === 'UNKNOWN_REASON_CODE');
  }

  // Reversal events default to target event public reason or ADMIN_CORRECTION, not 'REVERSAL'
  const amend = RosterLifecycle.createAmendmentEvent({
    periodId: '2026-07',
    baseRevision: 1,
    resultRevision: 2,
    operationId: 'a1000000-0000-4000-8000-000000000001',
    actor: 'admin',
    publicReasonCode: RosterLifecycle.PUBLIC_REASON_CODES.DUTY_COVERAGE,
    personId: 'p-siti',
    date: '2026-07-01',
    dutyDomain: 'MO',
    beforeAssignments: [{ ShiftCode: 'AM' }],
    afterAssignments: [{ ShiftCode: 'PM' }]
  });
  const groupedAmend = RosterLifecycle.groupEventLines(amend.lines);
  const rev = RosterLifecycle.createReversalEvent({
    targetEvent: groupedAmend[0],
    baseRevision: 2,
    resultRevision: 3,
    operationId: 'a1000000-0000-4000-8000-000000000002',
    actor: 'admin'
  });
  assert.equal(rev.lines[0].PublicReasonCode, RosterLifecycle.PUBLIC_REASON_CODES.DUTY_COVERAGE);
  assert.equal(rev.lines[0].EventType, 'REVERSAL');
  assert.equal(rev.lines[0].ReversesEventId, groupedAmend[0].EventId);
});

test('26. DutyDomain validation and cross-domain mutation isolation (Section B)', () => {
  const baseSnap = createBasePlannedSnapshot();

  // 1. Valid explicit MO event works
  const moEv = RosterLifecycle.createAmendmentEvent({
    periodId: '2026-07',
    baseRevision: 1,
    resultRevision: 2,
    operationId: 'b1000000-0000-4000-8000-000000000001',
    actor: 'admin',
    publicReasonCode: RosterLifecycle.PUBLIC_REASON_CODES.ADMIN_CORRECTION,
    personId: 'p-siti',
    date: '2026-07-01',
    dutyDomain: 'MO',
    beforeAssignments: [{ ShiftCode: 'AM' }],
    afterAssignments: [{ ShiftCode: 'PM' }]
  });
  assert.equal(moEv.lines[0].DutyDomain, 'MO');

  // 2. Valid explicit EP event works
  const epEv = RosterLifecycle.createAmendmentEvent({
    periodId: '2026-07',
    baseRevision: 1,
    resultRevision: 2,
    operationId: 'b1000000-0000-4000-8000-000000000002',
    actor: 'admin',
    publicReasonCode: RosterLifecycle.PUBLIC_REASON_CODES.ADMIN_CORRECTION,
    personId: 'p-ep',
    date: '2026-07-01',
    dutyDomain: 'EP',
    beforeAssignments: [],
    afterAssignments: [{ ShiftCode: 'EP_CONSULTANT' }]
  });
  assert.equal(epEv.lines[0].DutyDomain, 'EP');

  // 3. Missing / empty DutyDomain on newly created amendment is rejected (does NOT silently default to MO)
  assert.throws(() => {
    RosterLifecycle.createAmendmentEvent({
      periodId: '2026-07',
      baseRevision: 1,
      resultRevision: 2,
      operationId: 'b1000000-0000-4000-8000-000000000003',
      actor: 'admin',
      publicReasonCode: RosterLifecycle.PUBLIC_REASON_CODES.ADMIN_CORRECTION,
      personId: 'p-siti',
      date: '2026-07-01',
      dutyDomain: '', // empty
      beforeAssignments: [],
      afterAssignments: [{ ShiftCode: 'PM' }]
    });
  }, err => err.code === 'VALIDATION_FAILED');

  assert.throws(() => {
    RosterLifecycle.createAmendmentEvent({
      periodId: '2026-07',
      baseRevision: 1,
      resultRevision: 2,
      operationId: 'b1000000-0000-4000-8000-000000000004',
      actor: 'admin',
      publicReasonCode: RosterLifecycle.PUBLIC_REASON_CODES.ADMIN_CORRECTION,
      personId: 'p-siti',
      date: '2026-07-01',
      // omitted dutyDomain
      beforeAssignments: [],
      afterAssignments: [{ ShiftCode: 'PM' }]
    });
  }, err => err.code === 'VALIDATION_FAILED');

  // 4. Missing DutyDomain on swap event participants is rejected
  assert.throws(() => {
    RosterLifecycle.createSwapEvent({
      periodId: '2026-07',
      baseRevision: 1,
      resultRevision: 2,
      operationId: 'b1000000-0000-4000-8000-000000000005',
      actor: 'admin',
      publicReasonCode: RosterLifecycle.PUBLIC_REASON_CODES.SHIFT_SWAP,
      person1: { personId: 'p-siti', date: '2026-07-01', dutyDomain: 'MO' },
      person2: { personId: 'p-ahmad', date: '2026-07-01' } // missing dutyDomain
    });
  }, err => err.code === 'VALIDATION_FAILED');

  // 5. Missing DutyDomain on raw event line in groupEventLines is rejected
  assert.throws(() => {
    RosterLifecycle.groupEventLines([
      {
        EventId: 'b1000000-0000-4000-8000-000000000006',
        LineId: 'line-bad-domain',
        EventType: 'ADMIN_CORRECTION',
        OperationId: 'b1000000-0000-4000-8000-000000000007',
        PeriodId: '2026-07',
        BaseRevision: 1,
        ResultRevision: 2,
        PersonId: 'p-siti',
        Date: '2026-07-01',
        DutyDomain: '', // missing
        PublicReasonCode: 'ADMIN_CORRECTION'
      }
    ]);
  }, err => err.code === 'MALFORMED_EVENT');

  // 6. One domain cannot mutate another domain:
  // Siti has both an MO assignment and an EP assignment on 2026-07-01
  const multiDomainPlanned = [
    ...baseSnap.assignments,
    {
      AssignmentId: 'snap-ep-siti-01',
      PeriodId: '2026-07',
      Layer: 'PLANNED',
      SnapshotId: 'snap-1',
      PersonId: 'p-siti',
      PersonNameSnapshot: 'Dr Siti',
      Date: '2026-07-01',
      DutyDomain: 'EP',
      ShiftCode: 'EP_DUTY',
      ModifiersJson: '{}',
      DraftRevision: 1,
      Source: 'NEW',
      OperationId: 'b1000000-0000-4000-8000-000000000008',
      CreatedAt: new Date().toISOString(),
      CreatedBy: 'admin',
      _rawShift: 'EP_DUTY'
    }
  ];

  // Amend Siti's MO assignment only
  const amendMO = RosterLifecycle.createAmendmentEvent({
    periodId: '2026-07',
    baseRevision: 1,
    resultRevision: 2,
    operationId: 'b1000000-0000-4000-8000-000000000009',
    actor: 'admin',
    publicReasonCode: RosterLifecycle.PUBLIC_REASON_CODES.ADMIN_CORRECTION,
    personId: 'p-siti',
    date: '2026-07-01',
    dutyDomain: 'MO',
    beforeAssignments: [{ ShiftCode: 'AM' }],
    afterAssignments: [{ ShiftCode: 'PM' }]
  });

  const resMulti = RosterLifecycle.resolveCurrentRoster({
    periodId: '2026-07',
    plannedAssignments: multiDomainPlanned,
    events: amendMO.lines,
    people: TEST_PEOPLE,
    digestFn
  });

  const sitiMO = resMulti.currentAssignments.find(a => a.PersonId === 'p-siti' && a.Date === '2026-07-01' && a.DutyDomain === 'MO');
  const sitiEP = resMulti.currentAssignments.find(a => a.PersonId === 'p-siti' && a.Date === '2026-07-01' && a.DutyDomain === 'EP');

  assert.equal(sitiMO.ShiftCode, 'PM'); // MO updated
  assert.equal(sitiEP.ShiftCode, 'EP_DUTY'); // EP completely untouched!
  assert.equal(sitiEP.AssignmentId, 'snap-ep-siti-01'); // Original ID preserved
});

test('27. Formalized event-level vs line-level field validation (Section C)', () => {
  const baseEventId = 'c1000000-0000-4000-8000-000000000001';
  const baseOpId = 'c1000000-0000-4000-8000-000000000002';
  const createValidSwapLines = () => [
    {
      EventId: baseEventId,
      LineId: 'line-swap-1',
      EventType: 'SWAP',
      OperationId: baseOpId,
      PeriodId: '2026-07',
      BaseRevision: 1,
      ResultRevision: 2,
      PersonId: 'p-siti',
      LinkedPersonIdsJson: '["p-ahmad"]',
      Date: '2026-07-01',
      DutyDomain: 'MO',
      PlannedAssignmentJson: '[]',
      BeforeCurrentJson: '[{"ShiftCode":"AM"}]',
      AfterCurrentJson: '[{"ShiftCode":"PM"}]',
      PublicReasonCode: 'SHIFT_SWAP',
      AdminNote: 'Approved swap',
      ShortageAccepted: false,
      ShortageReason: '',
      GoffTransactionIdsJson: '[]',
      ReversesEventId: '',
      CreatedAt: '2026-07-01T10:00:00.000Z',
      CreatedBy: 'admin@hospital.org'
    },
    {
      EventId: baseEventId,
      LineId: 'line-swap-2',
      EventType: 'SWAP',
      OperationId: baseOpId,
      PeriodId: '2026-07',
      BaseRevision: 1,
      ResultRevision: 2,
      PersonId: 'p-ahmad',
      LinkedPersonIdsJson: '["p-siti"]',
      Date: '2026-07-02',
      DutyDomain: 'MO',
      PlannedAssignmentJson: '[]',
      BeforeCurrentJson: '[{"ShiftCode":"PM"}]',
      AfterCurrentJson: '[{"ShiftCode":"AM"}]',
      PublicReasonCode: 'SHIFT_SWAP',
      AdminNote: 'Approved swap',
      ShortageAccepted: false,
      ShortageReason: '',
      GoffTransactionIdsJson: '[]',
      ReversesEventId: '',
      CreatedAt: '2026-07-01T10:00:00.000Z',
      CreatedBy: 'admin@hospital.org'
    }
  ];

  // 1. Valid lines with legitimate differences in line-level fields succeed
  const validGroup = RosterLifecycle.groupEventLines(createValidSwapLines());
  assert.equal(validGroup.length, 1);
  assert.equal(validGroup[0].lines.length, 2);

  // 2. Reject multi-line event if any EVENT-LEVEL metadata differs between lines:
  const eventLevelFields = [
    { field: 'CreatedBy', val1: 'admin-1@hospital.org', val2: 'admin-2@hospital.org' },
    { field: 'AdminNote', val1: 'Note 1', val2: 'Note 2' },
    { field: 'OperationId', val1: baseOpId, val2: 'c1000000-0000-4000-8000-000000000099' },
    { field: 'BaseRevision', val1: 1, val2: 2 },
    { field: 'ResultRevision', val1: 2, val2: 3 },
    { field: 'PublicReasonCode', val1: 'SHIFT_SWAP', val2: 'OTHER' },
    { field: 'CreatedAt', val1: '2026-07-01T10:00:00.000Z', val2: '2026-07-01T11:00:00.000Z' },
    { field: 'EventType', val1: 'SWAP', val2: 'ADMIN_CORRECTION' },
    { field: 'PeriodId', val1: '2026-07', val2: '2026-08' },
    { field: 'ReversesEventId', val1: '', val2: 'rev-id' },
    { field: 'ShortageAccepted', val1: false, val2: true },
    { field: 'ShortageReason', val1: '', val2: 'Approved shortage' }
  ];

  for (const { field, val1, val2 } of eventLevelFields) {
    const lines = createValidSwapLines();
    lines[0][field] = val1;
    lines[1][field] = val2;
    assert.throws(() => {
      RosterLifecycle.groupEventLines(lines);
    }, err => err.code === 'MALFORMED_EVENT', `Expected groupEventLines to reject differing ${field}`);
  }
});

test('28. Event revision ordering invariants & conflict rejection (Section D)', () => {
  const baseSnap = createBasePlannedSnapshot();

  const ev1 = RosterLifecycle.createAmendmentEvent({
    periodId: '2026-07',
    baseRevision: 1,
    resultRevision: 2,
    operationId: 'd1000000-0000-4000-8000-000000000001',
    actor: 'admin',
    publicReasonCode: RosterLifecycle.PUBLIC_REASON_CODES.ADMIN_CORRECTION,
    personId: 'p-siti',
    date: '2026-07-01',
    dutyDomain: 'MO',
    beforeAssignments: [{ ShiftCode: 'AM' }],
    afterAssignments: [{ ShiftCode: 'PM' }]
  });

  // 1. Reject duplicate ResultRevision (two independent events claiming the same revision)
  const conflictingEv = RosterLifecycle.createAmendmentEvent({
    periodId: '2026-07',
    baseRevision: 1,
    resultRevision: 2, // duplicate ResultRevision 2!
    operationId: 'd1000000-0000-4000-8000-000000000002',
    actor: 'admin',
    publicReasonCode: RosterLifecycle.PUBLIC_REASON_CODES.ADMIN_CORRECTION,
    personId: 'p-ahmad',
    date: '2026-07-02',
    dutyDomain: 'MO',
    beforeAssignments: [{ ShiftCode: 'AM' }],
    afterAssignments: [{ ShiftCode: 'ON1' }]
  });

  assert.throws(() => {
    RosterLifecycle.resolveCurrentRoster({
      periodId: '2026-07',
      plannedAssignments: baseSnap.assignments,
      events: [...ev1.lines, ...conflictingEv.lines],
      people: TEST_PEOPLE
    });
  }, err => err.code === 'REVISION_CONFLICT');

  // 2. Reject branching conflict (second event has BaseRevision < prev.ResultRevision)
  const branchingEv = RosterLifecycle.createAmendmentEvent({
    periodId: '2026-07',
    baseRevision: 1, // Branching from 1 after revision 2 already confirmed!
    resultRevision: 3,
    operationId: 'd1000000-0000-4000-8000-000000000003',
    actor: 'admin',
    publicReasonCode: RosterLifecycle.PUBLIC_REASON_CODES.ADMIN_CORRECTION,
    personId: 'p-tan',
    date: '2026-07-01',
    dutyDomain: 'MO',
    beforeAssignments: [{ ShiftCode: 'ON1' }],
    afterAssignments: [{ ShiftCode: 'AM' }]
  });

  assert.throws(() => {
    RosterLifecycle.resolveCurrentRoster({
      periodId: '2026-07',
      plannedAssignments: baseSnap.assignments,
      events: [...ev1.lines, ...branchingEv.lines],
      people: TEST_PEOPLE
    });
  }, err => err.code === 'REVISION_CONFLICT');

  // 3. Reject invalid revision numbers (non-integer, negative, or Result <= Base)
  assert.throws(() => {
    RosterLifecycle.resolveCurrentRoster({
      periodId: '2026-07',
      plannedAssignments: baseSnap.assignments,
      events: [{ ...ev1.lines[0], BaseRevision: -1 }],
      people: TEST_PEOPLE
    });
  }, err => err.code === 'MALFORMED_EVENT');

  assert.throws(() => {
    RosterLifecycle.resolveCurrentRoster({
      periodId: '2026-07',
      plannedAssignments: baseSnap.assignments,
      events: [{ ...ev1.lines[0], ResultRevision: 1, BaseRevision: 1 }],
      people: TEST_PEOPLE
    });
  }, err => err.code === 'MALFORMED_EVENT');

  // 4. Permissible forward gaps: Phase 4 lifecycle events advance revision without altering cells
  // ev1: Base 1 -> Result 2
  // Intervening lifecycle event (e.g. CLOSE or metadata update): advances period to revision 3
  // ev2: Base 3 -> Result 4
  const gapEv = RosterLifecycle.createAmendmentEvent({
    periodId: '2026-07',
    baseRevision: 3,
    resultRevision: 4,
    operationId: 'd1000000-0000-4000-8000-000000000004',
    actor: 'admin',
    publicReasonCode: RosterLifecycle.PUBLIC_REASON_CODES.ADMIN_CORRECTION,
    personId: 'p-ahmad',
    date: '2026-07-02',
    dutyDomain: 'MO',
    beforeAssignments: [{ ShiftCode: 'AM' }],
    afterAssignments: [{ ShiftCode: 'ON1' }]
  });

  const resGap = RosterLifecycle.resolveCurrentRoster({
    periodId: '2026-07',
    plannedAssignments: baseSnap.assignments,
    events: [...ev1.lines, ...gapEv.lines],
    people: TEST_PEOPLE
  });
  assert.equal(resGap.effectiveState, 'AMENDED');
  assert.equal(resGap.activeAmendmentCount, 2);
});

test('29. Comprehensive active-amendment counting audit (Section E)', () => {
  const baseSnap = createBasePlannedSnapshot();

  // 0. Base published roster has 0 active amendments
  const res0 = RosterLifecycle.resolveCurrentRoster({
    periodId: '2026-07',
    plannedAssignments: baseSnap.assignments,
    events: [],
    people: TEST_PEOPLE
  });
  assert.equal(res0.activeAmendmentCount, 0);
  assert.equal(res0.effectiveState, 'PUBLISHED');

  // 1. Single ADMIN_CORRECTION contributes 1 active amendment
  const ev1 = RosterLifecycle.createAmendmentEvent({
    periodId: '2026-07',
    baseRevision: 1,
    resultRevision: 2,
    operationId: 'e1000000-0000-4000-8000-000000000001',
    actor: 'admin',
    publicReasonCode: RosterLifecycle.PUBLIC_REASON_CODES.ADMIN_CORRECTION,
    personId: 'p-siti',
    date: '2026-07-01',
    dutyDomain: 'MO',
    beforeAssignments: [{ ShiftCode: 'AM' }],
    afterAssignments: [{ ShiftCode: 'PM' }]
  });
  assert.equal(RosterLifecycle.countActiveAmendments(ev1.lines), 1);

  // 2. SWAP (2 lines sharing EventId) contributes 1 active amendment, NOT 2
  const swap = RosterLifecycle.createSwapEvent({
    periodId: '2026-07',
    baseRevision: 2,
    resultRevision: 3,
    operationId: 'e1000000-0000-4000-8000-000000000002',
    actor: 'admin',
    publicReasonCode: RosterLifecycle.PUBLIC_REASON_CODES.SHIFT_SWAP,
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
  assert.equal(swap.lines.length, 2);
  assert.equal(RosterLifecycle.countActiveAmendments(swap.lines), 1); // Exactly 1!

  // 3. Two independent amendments: count = 2
  assert.equal(RosterLifecycle.countActiveAmendments([...ev1.lines, ...swap.lines]), 2);

  // 4. Reversal of swap: does NOT become an additional active amendment, reduces active count by 1
  const groupedSwap = RosterLifecycle.groupEventLines(swap.lines);
  const revSwap = RosterLifecycle.createReversalEvent({
    targetEvent: groupedSwap[0],
    baseRevision: 3,
    resultRevision: 4,
    operationId: 'e1000000-0000-4000-8000-000000000003',
    actor: 'admin'
  });
  // ev1 + swap + revSwap: active count must be 1 (ev1 is still active, swap is reversed, revSwap is reversal)
  assert.equal(RosterLifecycle.countActiveAmendments([...ev1.lines, ...swap.lines, ...revSwap.lines]), 1);

  // 5. Reversal of ev1: leaves active count = 0
  const groupedEv1 = RosterLifecycle.groupEventLines(ev1.lines);
  const revEv1 = RosterLifecycle.createReversalEvent({
    targetEvent: groupedEv1[0],
    baseRevision: 4,
    resultRevision: 5,
    operationId: 'e1000000-0000-4000-8000-000000000004',
    actor: 'admin'
  });
  assert.equal(RosterLifecycle.countActiveAmendments([...ev1.lines, ...swap.lines, ...revSwap.lines, ...revEv1.lines]), 0);

  // 6. Lifecycle events (PUBLISH, CLOSE, REOPEN) do NOT contribute to active amendment count
  const lifecycleEvents = [
    { EventId: 'e-pub', LineId: 'l-pub', EventType: 'PUBLISH', OperationId: 'op-pub', PeriodId: '2026-07', BaseRevision: 0, ResultRevision: 1, DutyDomain: '', PersonId: '', Date: '' },
    { EventId: 'e-cls', LineId: 'l-cls', EventType: 'CLOSE', OperationId: 'op-cls', PeriodId: '2026-07', BaseRevision: 5, ResultRevision: 6, DutyDomain: '', PersonId: '', Date: '' },
    { EventId: 'e-rop', LineId: 'l-rop', EventType: 'REOPEN', OperationId: 'op-rop', PeriodId: '2026-07', BaseRevision: 6, ResultRevision: 7, DutyDomain: '', PersonId: '', Date: '' }
  ];
  assert.equal(RosterLifecycle.countActiveAmendments(lifecycleEvents), 0);
  assert.equal(RosterLifecycle.countActiveAmendments([...lifecycleEvents, ...ev1.lines]), 1);
});

test('30. Current assignment identity behavior & stability (Section F)', () => {
  const baseSnap = createBasePlannedSnapshot();
  const originalPlannedAssignments = baseSnap.assignments;

  // 1. Unchanged Planned assignments preserve their exact original AssignmentId
  const resBase = RosterLifecycle.resolveCurrentRoster({
    periodId: '2026-07',
    plannedAssignments: originalPlannedAssignments,
    events: [],
    people: TEST_PEOPLE,
    digestFn
  });
  for (let i = 0; i < originalPlannedAssignments.length; i++) {
    assert.equal(resBase.currentAssignments[i].AssignmentId, originalPlannedAssignments[i].AssignmentId);
  }

  // 2. Changed existing shift receives deterministic AssignmentId with occurrence index
  const amendOpId = 'f1000000-0000-4000-8000-000000000001';
  const originalPlannedSiti = originalPlannedAssignments.find(a => a.PersonId === 'p-siti' && a.Date === '2026-07-01');
  const evAmend = RosterLifecycle.createAmendmentEvent({
    periodId: '2026-07',
    baseRevision: 1,
    resultRevision: 2,
    operationId: amendOpId,
    actor: 'admin',
    publicReasonCode: RosterLifecycle.PUBLIC_REASON_CODES.ADMIN_CORRECTION,
    personId: 'p-siti',
    date: '2026-07-01',
    dutyDomain: 'MO',
    beforeAssignments: [originalPlannedSiti],
    afterAssignments: [{ ShiftCode: 'PM' }]
  });

  const resAmend = RosterLifecycle.resolveCurrentRoster({
    periodId: '2026-07',
    plannedAssignments: originalPlannedAssignments,
    events: evAmend.lines,
    people: TEST_PEOPLE,
    digestFn
  });

  const changedSiti = resAmend.currentAssignments.find(a => a.PersonId === 'p-siti' && a.Date === '2026-07-01');
  const expectedId = RosterLifecycle.deterministicAssignmentId(amendOpId, 'p-siti', '2026-07-01', 'MO', 'PM', 'PM', 0, digestFn);
  assert.equal(changedSiti.AssignmentId, expectedId);

  // 3. Added new assignment receives deterministic AssignmentId
  const addOpId = 'f1000000-0000-4000-8000-000000000002';
  const evAdd = RosterLifecycle.createAmendmentEvent({
    periodId: '2026-07',
    baseRevision: 2,
    resultRevision: 3,
    operationId: addOpId,
    actor: 'admin',
    publicReasonCode: RosterLifecycle.PUBLIC_REASON_CODES.DUTY_COVERAGE,
    personId: 'p-ahmad',
    date: '2026-07-03',
    dutyDomain: 'MO',
    beforeAssignments: [],
    afterAssignments: [{ ShiftCode: 'AM' }]
  });

  const resAdd = RosterLifecycle.resolveCurrentRoster({
    periodId: '2026-07',
    plannedAssignments: originalPlannedAssignments,
    events: [...evAmend.lines, ...evAdd.lines],
    people: TEST_PEOPLE,
    digestFn
  });
  const addedAhmad = resAdd.currentAssignments.find(a => a.PersonId === 'p-ahmad' && a.Date === '2026-07-03');
  const expectedAddId = RosterLifecycle.deterministicAssignmentId(addOpId, 'p-ahmad', '2026-07-03', 'MO', 'AM', 'AM', 0, digestFn);
  assert.equal(addedAhmad.AssignmentId, expectedAddId);

  // 4. After reversal, assignment identity reverts to original Planned AssignmentId
  const groupedAmend = RosterLifecycle.groupEventLines(evAmend.lines);
  const evRev = RosterLifecycle.createReversalEvent({
    targetEvent: groupedAmend[0],
    baseRevision: 3,
    resultRevision: 4,
    operationId: 'f1000000-0000-4000-8000-000000000003',
    actor: 'admin'
  });

  const resRev = RosterLifecycle.resolveCurrentRoster({
    periodId: '2026-07',
    plannedAssignments: originalPlannedAssignments,
    events: [...evAmend.lines, ...evAdd.lines, ...evRev.lines],
    people: TEST_PEOPLE,
    digestFn
  });
  const revertedSiti = resRev.currentAssignments.find(a => a.PersonId === 'p-siti' && a.Date === '2026-07-01');
  assert.equal(revertedSiti.AssignmentId, originalPlannedSiti.AssignmentId);
  assert.equal(revertedSiti.ShiftCode, 'AM');

  // 5. Repeated reconstruction produces byte-identical stable identifiers
  const run1 = RosterLifecycle.resolveCurrentRoster({
    periodId: '2026-07',
    plannedAssignments: originalPlannedAssignments,
    events: [...evAmend.lines, ...evAdd.lines],
    people: TEST_PEOPLE,
    digestFn
  });
  const run2 = RosterLifecycle.resolveCurrentRoster({
    periodId: '2026-07',
    plannedAssignments: originalPlannedAssignments,
    events: [...evAmend.lines, ...evAdd.lines],
    people: TEST_PEOPLE,
    digestFn
  });
  assert.deepStrictEqual(run1.currentAssignments, run2.currentAssignments);

  // 6. Input row ordering does not affect identifiers or outputs
  const shuffledEvents = [...evAdd.lines, ...evAmend.lines];
  const runShuffled = RosterLifecycle.resolveCurrentRoster({
    periodId: '2026-07',
    plannedAssignments: originalPlannedAssignments,
    events: shuffledEvents,
    people: TEST_PEOPLE,
    digestFn
  });
  assert.deepStrictEqual(run1.currentAssignments, runShuffled.currentAssignments);
});

test('31. Duplicate display names: two different PersonIds with identical personNameSnapshot preserve distinct PersonId identity', () => {
  const peopleWithDuplicates = [
    { PersonId: 'p-lee-1', MemberName: 'Dr Lee', CurrentDisplayName: 'Dr Lee', DirectoryType: 'MO' },
    { PersonId: 'p-lee-2', MemberName: 'Dr Lee', CurrentDisplayName: 'Dr Lee', DirectoryType: 'MO' }
  ];

  const plannedAssignments = [
    {
      AssignmentId: 'a-lee-1-planned',
      PeriodId: '2026-07',
      Layer: 'PLANNED',
      SnapshotId: 'snap-dup-1',
      PersonId: 'p-lee-1',
      PersonNameSnapshot: 'Dr Lee',
      Date: '2026-07-04',
      DutyDomain: 'MO',
      ShiftCode: 'AM',
      ModifiersJson: '{}'
    },
    {
      AssignmentId: 'a-lee-2-planned',
      PeriodId: '2026-07',
      Layer: 'PLANNED',
      SnapshotId: 'snap-dup-1',
      PersonId: 'p-lee-2',
      PersonNameSnapshot: 'Dr Lee',
      Date: '2026-07-04',
      DutyDomain: 'MO',
      ShiftCode: 'PM',
      ModifiersJson: '{}'
    }
  ];

  // Amend ONLY p-lee-1 from AM to ON1
  const amendOpId = 'b1000000-0000-4000-8000-000000000001';
  const ev = RosterLifecycle.createAmendmentEvent({
    periodId: '2026-07',
    baseRevision: 1,
    resultRevision: 2,
    operationId: amendOpId,
    actor: 'admin',
    publicReasonCode: RosterLifecycle.PUBLIC_REASON_CODES.ADMIN_CORRECTION,
    personId: 'p-lee-1',
    date: '2026-07-04',
    dutyDomain: 'MO',
    beforeAssignments: [plannedAssignments[0]],
    afterAssignments: [{ ShiftCode: 'ON1' }]
  });

  const res = RosterLifecycle.resolveCurrentRoster({
    periodId: '2026-07',
    plannedAssignments,
    events: ev.lines,
    people: peopleWithDuplicates,
    digestFn
  });

  assert.equal(res.currentAssignments.length, 2);

  const currentLee1 = res.currentAssignments.find(a => a.PersonId === 'p-lee-1');
  const currentLee2 = res.currentAssignments.find(a => a.PersonId === 'p-lee-2');

  assert.ok(currentLee1, 'p-lee-1 must be found by authoritative PersonId');
  assert.ok(currentLee2, 'p-lee-2 must be found by authoritative PersonId');

  // p-lee-1 was amended to ON1
  assert.equal(currentLee1.ShiftCode, 'ON1');
  assert.equal(currentLee1.PersonNameSnapshot, 'Dr Lee');

  // p-lee-2 remained PM completely unaffected
  assert.equal(currentLee2.ShiftCode, 'PM');
  assert.equal(currentLee2.PersonNameSnapshot, 'Dr Lee');
  assert.equal(currentLee2.AssignmentId, 'a-lee-2-planned');
});

test('32. Multi-domain identity: same PersonId + same Date across different DutyDomains resolves without cross-domain collision', () => {
  const multiDomainPlanned = [
    {
      AssignmentId: 'a-siti-mo',
      PeriodId: '2026-07',
      Layer: 'PLANNED',
      SnapshotId: 'snap-multi-1',
      PersonId: 'p-siti',
      PersonNameSnapshot: 'Dr Siti',
      Date: '2026-07-10',
      DutyDomain: 'MO',
      ShiftCode: 'AM',
      ModifiersJson: '{}'
    },
    {
      AssignmentId: 'a-siti-ep',
      PeriodId: '2026-07',
      Layer: 'PLANNED',
      SnapshotId: 'snap-multi-1',
      PersonId: 'p-siti',
      PersonNameSnapshot: 'Dr Siti',
      Date: '2026-07-10',
      DutyDomain: 'EP',
      ShiftCode: 'EP_ONCALL',
      ModifiersJson: '{}'
    }
  ];

  // Amend ONLY MO domain from AM to PM
  const opId = 'b2000000-0000-4000-8000-000000000001';
  const ev = RosterLifecycle.createAmendmentEvent({
    periodId: '2026-07',
    baseRevision: 1,
    resultRevision: 2,
    operationId: opId,
    actor: 'admin',
    publicReasonCode: RosterLifecycle.PUBLIC_REASON_CODES.ADMIN_CORRECTION,
    personId: 'p-siti',
    date: '2026-07-10',
    dutyDomain: 'MO',
    beforeAssignments: [multiDomainPlanned[0]],
    afterAssignments: [{ ShiftCode: 'PM' }]
  });

  const res = RosterLifecycle.resolveCurrentRoster({
    periodId: '2026-07',
    plannedAssignments: multiDomainPlanned,
    events: ev.lines,
    people: TEST_PEOPLE,
    digestFn
  });

  assert.equal(res.currentAssignments.length, 2);

  // Both domains preserved with correct shifts
  const mo = res.currentAssignments.find(a => a.DutyDomain === 'MO');
  const ep = res.currentAssignments.find(a => a.DutyDomain === 'EP');

  assert.equal(mo.ShiftCode, 'PM');
  assert.equal(ep.ShiftCode, 'EP_ONCALL');
  assert.equal(ep.AssignmentId, 'a-siti-ep', 'EP assignment ID must remain unchanged');

  // Deterministic 5-level sort orders 'EP' before 'MO'
  assert.equal(res.currentAssignments[0].DutyDomain, 'EP');
  assert.equal(res.currentAssignments[1].DutyDomain, 'MO');
});

test('33. Lifecycle events neutrality: Publish, Close, Reopen events do not alter Current assignment resolution', () => {
  const baseSnap = createBasePlannedSnapshot();
  const amendOpId = 'b3000000-0000-4000-8000-000000000001';

  const evAmend = RosterLifecycle.createAmendmentEvent({
    periodId: '2026-07',
    baseRevision: 1,
    resultRevision: 2,
    operationId: amendOpId,
    actor: 'admin',
    publicReasonCode: RosterLifecycle.PUBLIC_REASON_CODES.ADMIN_CORRECTION,
    personId: 'p-siti',
    date: '2026-07-01',
    dutyDomain: 'MO',
    beforeAssignments: [{ ShiftCode: 'AM' }],
    afterAssignments: [{ ShiftCode: 'PM' }]
  });

  const resAmendOnly = RosterLifecycle.resolveCurrentRoster({
    periodId: '2026-07',
    plannedAssignments: baseSnap.assignments,
    events: evAmend.lines,
    people: TEST_PEOPLE,
    digestFn
  });

  // Inject PUBLISH, CLOSE, and REOPEN lifecycle events into the event history
  const lifecycleEvents = [
    { EventId: 'e-pub', LineId: 'l-pub', EventType: 'PUBLISH', OperationId: 'op-pub', PeriodId: '2026-07', BaseRevision: 0, ResultRevision: 1, DutyDomain: '', PersonId: '', Date: '' },
    ...evAmend.lines,
    { EventId: 'e-cls', LineId: 'l-cls', EventType: 'CLOSE', OperationId: 'op-cls', PeriodId: '2026-07', BaseRevision: 2, ResultRevision: 3, DutyDomain: '', PersonId: '', Date: '' },
    { EventId: 'e-rop', LineId: 'l-rop', EventType: 'REOPEN', OperationId: 'op-rop', PeriodId: '2026-07', BaseRevision: 3, ResultRevision: 4, DutyDomain: '', PersonId: '', Date: '' }
  ];

  const resWithLifecycle = RosterLifecycle.resolveCurrentRoster({
    periodId: '2026-07',
    plannedAssignments: baseSnap.assignments,
    events: lifecycleEvents,
    people: TEST_PEOPLE,
    digestFn
  });

  // Assignment resolution must be strictly identical regardless of lifecycle events
  assert.deepStrictEqual(resWithLifecycle.currentAssignments, resAmendOnly.currentAssignments);
  assert.equal(resWithLifecycle.activeAmendmentCount, 1);
});

test('34. Fail-closed corruption behavior: invalid DutyDomain, malformed required identity fields, or broken revision chains throw LIFECYCLE_ERRORS', () => {
  const baseSnap = createBasePlannedSnapshot();

  // 1. Missing DutyDomain on event line throws MALFORMED_EVENT
  assert.throws(() => {
    RosterLifecycle.resolveCurrentRoster({
      periodId: '2026-07',
      plannedAssignments: baseSnap.assignments,
      events: [{
        EventId: 'e-bad-1',
        LineId: 'l-bad-1',
        EventType: 'ADMIN_CORRECTION',
        OperationId: 'op-bad-1',
        PeriodId: '2026-07',
        BaseRevision: 1,
        ResultRevision: 2,
        PersonId: 'p-siti',
        Date: '2026-07-01',
        DutyDomain: '', // MISSING
        AfterCurrentJson: JSON.stringify([{ ShiftCode: 'PM' }])
      }],
      people: TEST_PEOPLE,
      digestFn
    });
  }, err => err.code === 'MALFORMED_EVENT');

  // 2. Missing PersonId on event line throws MALFORMED_EVENT
  assert.throws(() => {
    RosterLifecycle.resolveCurrentRoster({
      periodId: '2026-07',
      plannedAssignments: baseSnap.assignments,
      events: [{
        EventId: 'e-bad-2',
        LineId: 'l-bad-2',
        EventType: 'ADMIN_CORRECTION',
        OperationId: 'op-bad-2',
        PeriodId: '2026-07',
        BaseRevision: 1,
        ResultRevision: 2,
        PersonId: '', // MISSING
        Date: '2026-07-01',
        DutyDomain: 'MO',
        AfterCurrentJson: JSON.stringify([{ ShiftCode: 'PM' }])
      }],
      people: TEST_PEOPLE,
      digestFn
    });
  }, err => err.code === 'MALFORMED_EVENT');

  // 3. Corrupt JSON in AfterCurrentJson throws MALFORMED_EVENT
  assert.throws(() => {
    RosterLifecycle.resolveCurrentRoster({
      periodId: '2026-07',
      plannedAssignments: baseSnap.assignments,
      events: [{
        EventId: 'e-bad-3',
        LineId: 'l-bad-3',
        EventType: 'ADMIN_CORRECTION',
        OperationId: 'op-bad-3',
        PeriodId: '2026-07',
        BaseRevision: 1,
        ResultRevision: 2,
        PersonId: 'p-siti',
        Date: '2026-07-01',
        DutyDomain: 'MO',
        AfterCurrentJson: 'NOT_VALID_JSON{['
      }],
      people: TEST_PEOPLE,
      digestFn
    });
  }, err => err.code === 'MALFORMED_EVENT');
});
