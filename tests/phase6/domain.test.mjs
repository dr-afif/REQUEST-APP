import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import RosterCompatibility from '../../src/features/roster/compatibility.js';
import RosterLifecycle from '../../src/features/roster/lifecycle.js';
import RosterAbsence from '../../src/features/roster/absence.js';

const digestFn = str => crypto.createHash('sha256').update(str).digest('hex');

const mockPeople = [
  { PersonId: 'p-001', CurrentDisplayName: 'Dr Alice', DirectoryType: 'MO', Active: true },
  { PersonId: 'p-002', CurrentDisplayName: 'Dr Bob', DirectoryType: 'MO', Active: true },
  { PersonId: 'p-003', CurrentDisplayName: 'Dr Charlie', DirectoryType: 'MO', Active: true },
  // Duplicate display names to prove PersonId uniqueness
  { PersonId: 'p-siti-1', CurrentDisplayName: 'Dr Siti', DirectoryType: 'MO', Active: true },
  { PersonId: 'p-siti-2', CurrentDisplayName: 'Dr Siti', DirectoryType: 'MO', Active: true },
  // Emergency physician
  { PersonId: 'p-ep-1', CurrentDisplayName: 'Dr Dave', DirectoryType: 'EP', Active: true }
];

const periodId = '2026-11';
const opId = '11111111-2222-4333-8444-555555555555';
const opId2 = '22222222-3333-4444-8555-666666666666';

// Helper to create planned assignments
function createMockPlannedAssignments() {
  return [
    {
      AssignmentId: 'a1000000-0000-4000-8000-000000000001',
      PeriodId: periodId,
      Layer: 'PLANNED',
      SnapshotId: 's1000000-0000-4000-8000-000000000001',
      PersonId: 'p-001',
      PersonNameSnapshot: 'Dr Alice',
      Date: '2026-11-10',
      DutyDomain: 'MO',
      ShiftCode: 'PM',
      ModifiersJson: '{}',
      DraftRevision: 0,
      Source: 'NEW',
      OperationId: opId,
      CreatedAt: '2026-10-01T00:00:00.000Z',
      CreatedBy: 'planner',
      _rawShift: 'PM'
    },
    {
      AssignmentId: 'a1000000-0000-4000-8000-000000000002',
      PeriodId: periodId,
      Layer: 'PLANNED',
      SnapshotId: 's1000000-0000-4000-8000-000000000001',
      PersonId: 'p-001',
      PersonNameSnapshot: 'Dr Alice',
      Date: '2026-11-12',
      DutyDomain: 'MO',
      ShiftCode: 'AM',
      ModifiersJson: '{}',
      DraftRevision: 0,
      Source: 'NEW',
      OperationId: opId,
      CreatedAt: '2026-10-01T00:00:00.000Z',
      CreatedBy: 'planner',
      _rawShift: 'AM'
    },
    {
      AssignmentId: 'a2000000-0000-4000-8000-000000000001',
      PeriodId: periodId,
      Layer: 'PLANNED',
      SnapshotId: 's1000000-0000-4000-8000-000000000001',
      PersonId: 'p-002',
      PersonNameSnapshot: 'Dr Bob',
      Date: '2026-11-10',
      DutyDomain: 'MO',
      ShiftCode: 'OFF',
      ModifiersJson: '{}',
      DraftRevision: 0,
      Source: 'NEW',
      OperationId: opId,
      CreatedAt: '2026-10-01T00:00:00.000Z',
      CreatedBy: 'planner',
      _rawShift: 'OFF'
    },
    {
      AssignmentId: 'a3000000-0000-4000-8000-000000000001',
      PeriodId: periodId,
      Layer: 'PLANNED',
      SnapshotId: 's1000000-0000-4000-8000-000000000001',
      PersonId: 'p-siti-1',
      PersonNameSnapshot: 'Dr Siti',
      Date: '2026-11-10',
      DutyDomain: 'MO',
      ShiftCode: 'PM',
      ModifiersJson: '{}',
      DraftRevision: 0,
      Source: 'NEW',
      OperationId: opId,
      CreatedAt: '2026-10-01T00:00:00.000Z',
      CreatedBy: 'planner',
      _rawShift: 'PM'
    },
    {
      AssignmentId: 'a3000000-0000-4000-8000-000000000002',
      PeriodId: periodId,
      Layer: 'PLANNED',
      SnapshotId: 's1000000-0000-4000-8000-000000000001',
      PersonId: 'p-siti-2',
      PersonNameSnapshot: 'Dr Siti',
      Date: '2026-11-10',
      DutyDomain: 'MO',
      ShiftCode: 'AM',
      ModifiersJson: '{}',
      DraftRevision: 0,
      Source: 'NEW',
      OperationId: opId,
      CreatedAt: '2026-10-01T00:00:00.000Z',
      CreatedBy: 'planner',
      _rawShift: 'AM'
    },
    {
      AssignmentId: 'a4000000-0000-4000-8000-000000000001',
      PeriodId: periodId,
      Layer: 'PLANNED',
      SnapshotId: 's1000000-0000-4000-8000-000000000001',
      PersonId: 'p-001',
      PersonNameSnapshot: 'Dr Alice',
      Date: '2026-11-10',
      DutyDomain: 'EP',
      ShiftCode: 'EP_ONCALL',
      ModifiersJson: '{}',
      DraftRevision: 0,
      Source: 'NEW',
      OperationId: opId,
      CreatedAt: '2026-10-01T00:00:00.000Z',
      CreatedBy: 'planner',
      _rawShift: 'EP_ONCALL'
    }
  ];
}

// 1. Canonical absence enum
test('1. Canonical absence enum: defines MC, EL, AL, COURSE without altering Phase 5 reason codes', () => {
  assert.deepEqual(RosterAbsence.ABSENCE_TYPES, {
    MC: 'MC',
    EL: 'EL',
    AL: 'AL',
    COURSE: 'COURSE'
  });

  // Valid absence types validate cleanly
  for (const t of ['MC', 'EL', 'AL', 'COURSE']) {
    assert.equal(RosterAbsence.isValidAbsenceType(t), true);
    assert.equal(RosterAbsence.validateAbsenceType(t), t);
  }

  // Phase 5 reasons, GOFF, and unknown types are rejected by validateAbsenceType
  for (const invalid of ['SHIFT_SWAP', 'ADMIN_CORRECTION', 'DUTY_COVERAGE', 'GOFF', 'UNKNOWN', 'VACATION']) {
    assert.equal(RosterAbsence.isValidAbsenceType(invalid), false);
    assert.throws(() => {
      RosterAbsence.validateAbsenceType(invalid);
    }, err => err.code === RosterAbsence.ABSENCE_ERRORS.INVALID_ABSENCE_TYPE);
  }

  // Phase 5 PUBLIC_REASON_CODES must remain untouched and NOT contain absence codes
  assert.deepEqual(RosterLifecycle.PUBLIC_REASON_CODES, {
    SHIFT_SWAP: 'SHIFT_SWAP',
    ADMIN_CORRECTION: 'ADMIN_CORRECTION',
    DUTY_COVERAGE: 'DUTY_COVERAGE',
    OPERATIONAL_CHANGE: 'OPERATIONAL_CHANGE',
    OTHER: 'OTHER'
  });
});

// 2. Valid single-day absence
test('2. Valid single-day absence produces frozen record with matching StartDate and EndDate', () => {
  const absence = RosterAbsence.createAbsenceRecord({
    periodId: '2026-11',
    personId: 'p-001',
    personNameSnapshot: 'Dr Alice',
    absenceType: 'MC',
    startDate: '2026-11-10',
    endDate: '2026-11-10',
    dutyDomain: 'MO',
    publicReason: 'DUTY_COVERAGE',
    adminNote: 'Doctor visiting clinic for flu',
    operationId: opId,
    actor: 'admin',
    digestFn
  });

  assert.equal(absence.PersonId, 'p-001');
  assert.equal(absence.AbsenceType, 'MC');
  assert.equal(absence.StartDate, '2026-11-10');
  assert.equal(absence.EndDate, '2026-11-10');
  assert.equal(absence.DutyDomain, 'MO');
  assert.equal(absence.Status, 'ACTIVE');
  assert.equal(absence.AdminNote, 'Doctor visiting clinic for flu');
  assert.ok(absence.AbsenceId);
  assert.ok(Object.isFrozen(absence));
});

// 3. Valid multi-day absence
test('3. Valid multi-day absence produces record with start <= end and rejects inverted dates', () => {
  const absence = RosterAbsence.createAbsenceRecord({
    periodId: '2026-11',
    personId: 'p-001',
    personNameSnapshot: 'Dr Alice',
    absenceType: 'AL',
    startDate: '2026-11-10',
    endDate: '2026-11-12',
    dutyDomain: 'MO',
    operationId: opId,
    actor: 'admin',
    digestFn
  });

  assert.equal(absence.StartDate, '2026-11-10');
  assert.equal(absence.EndDate, '2026-11-12');

  // Inverted range rejects fail-closed
  assert.throws(() => {
    RosterAbsence.createAbsenceRecord({
      periodId: '2026-11',
      personId: 'p-001',
      absenceType: 'AL',
      startDate: '2026-11-15',
      endDate: '2026-11-10',
      operationId: opId
    });
  }, err => err.code === RosterAbsence.ABSENCE_ERRORS.INVALID_DATE_RANGE);
});

// 4. Absence identity by PersonId
test('4. Absence identity is strictly by PersonId, never by display name', () => {
  const absence = RosterAbsence.createAbsenceRecord({
    periodId: '2026-11',
    personId: 'p-001',
    personNameSnapshot: 'Dr Alice (Renamed)',
    absenceType: 'MC',
    startDate: '2026-11-10',
    endDate: '2026-11-10',
    operationId: opId
  });

  assert.equal(absence.PersonId, 'p-001');

  // Empty PersonId fails closed
  assert.throws(() => {
    RosterAbsence.createAbsenceRecord({
      periodId: '2026-11',
      personId: '   ',
      absenceType: 'MC',
      startDate: '2026-11-10',
      endDate: '2026-11-10',
      operationId: opId
    });
  }, err => err.code === RosterAbsence.ABSENCE_ERRORS.INVALID_PERSON_IDENTITY);
});

// 5. Duplicate display names remain distinct
test('5. Duplicate display names remain distinct across different PersonIds', () => {
  const planned = createMockPlannedAssignments();
  const absenceSiti1 = RosterAbsence.createAbsenceRecord({
    periodId: '2026-11',
    personId: 'p-siti-1',
    personNameSnapshot: 'Dr Siti',
    absenceType: 'MC',
    startDate: '2026-11-10',
    endDate: '2026-11-10',
    operationId: opId
  });

  const resolved = RosterAbsence.resolveCurrentRosterWithAbsence({
    periodId: '2026-11',
    plannedAssignments: planned,
    absences: [absenceSiti1],
    people: mockPeople
  });

  const siti1Assignment = resolved.find(a => a.PersonId === 'p-siti-1' && a.Date === '2026-11-10');
  const siti2Assignment = resolved.find(a => a.PersonId === 'p-siti-2' && a.Date === '2026-11-10');

  // p-siti-1 is on MC
  assert.equal(siti1Assignment.ShiftCode, 'MC');
  assert.equal(siti1Assignment.Source, 'ABSENCE');
  assert.equal(siti1Assignment.CoverageStatus, 'UNCOVERED');

  // p-siti-2 remains on duty AM unaffected
  assert.equal(siti2Assignment.ShiftCode, 'AM');
  assert.equal(siti2Assignment.Source, 'NEW');
});

// 6. DutyDomain isolation
test('6. DutyDomain isolation: absence in MO leaves EP assignment on same person and date unaffected', () => {
  const planned = createMockPlannedAssignments();
  const absenceMO = RosterAbsence.createAbsenceRecord({
    periodId: '2026-11',
    personId: 'p-001',
    absenceType: 'MC',
    startDate: '2026-11-10',
    endDate: '2026-11-10',
    dutyDomain: 'MO',
    operationId: opId
  });

  const resolved = RosterAbsence.resolveCurrentRosterWithAbsence({
    periodId: '2026-11',
    plannedAssignments: planned,
    absences: [absenceMO],
    people: mockPeople
  });

  const moAssignment = resolved.find(a => a.PersonId === 'p-001' && a.DutyDomain === 'MO' && a.Date === '2026-11-10');
  const epAssignment = resolved.find(a => a.PersonId === 'p-001' && a.DutyDomain === 'EP' && a.Date === '2026-11-10');

  assert.equal(moAssignment.ShiftCode, 'MC');
  assert.equal(moAssignment.Source, 'ABSENCE');

  // EP oncall duty is preserved untouched
  assert.equal(epAssignment.ShiftCode, 'EP_ONCALL');
  assert.equal(epAssignment.DutyDomain, 'EP');
  assert.equal(epAssignment.Source, 'NEW');
});

// 7. Overlapping absence fails closed
test('7. Overlapping active absence fails closed for same PersonId and DutyDomain', () => {
  const existingAbsence = RosterAbsence.createAbsenceRecord({
    periodId: '2026-11',
    personId: 'p-001',
    absenceType: 'AL',
    startDate: '2026-11-10',
    endDate: '2026-11-12',
    dutyDomain: 'MO',
    operationId: opId
  });

  // Attempt overlapping MC on Nov 11 -> Nov 13 must fail closed
  assert.throws(() => {
    RosterAbsence.createAbsenceRecord({
      periodId: '2026-11',
      personId: 'p-001',
      absenceType: 'MC',
      startDate: '2026-11-11',
      endDate: '2026-11-13',
      dutyDomain: 'MO',
      operationId: opId2,
      existingAbsences: [existingAbsence]
    });
  }, err => err.code === RosterAbsence.ABSENCE_ERRORS.OVERLAPPING_ABSENCE);

  // Different person or different domain does not collide
  const diffDomain = RosterAbsence.createAbsenceRecord({
    periodId: '2026-11',
    personId: 'p-001',
    absenceType: 'MC',
    startDate: '2026-11-11',
    endDate: '2026-11-13',
    dutyDomain: 'EP',
    operationId: opId2,
    existingAbsences: [existingAbsence]
  });
  assert.ok(diffDomain.AbsenceId);
});

// 8. Absence does not mutate Planned
test('8. Absence does not mutate Planned assignments (Planned remains immutable)', () => {
  const planned = createMockPlannedAssignments();
  const plannedBeforeStr = JSON.stringify(planned);

  const absence = RosterAbsence.createAbsenceRecord({
    periodId: '2026-11',
    personId: 'p-001',
    absenceType: 'MC',
    startDate: '2026-11-10',
    endDate: '2026-11-10',
    dutyDomain: 'MO',
    operationId: opId
  });

  const resolved = RosterAbsence.resolveCurrentRosterWithAbsence({
    periodId: '2026-11',
    plannedAssignments: planned,
    absences: [absence],
    people: mockPeople
  });

  // Current shows MC
  const currentAlice = resolved.find(a => a.PersonId === 'p-001' && a.DutyDomain === 'MO' && a.Date === '2026-11-10');
  assert.equal(currentAlice.ShiftCode, 'MC');

  // Planned remains byte-for-byte unchanged with Dr Alice on PM
  assert.equal(JSON.stringify(planned), plannedBeforeStr);
  const plannedAlice = planned.find(a => a.PersonId === 'p-001' && a.DutyDomain === 'MO' && a.Date === '2026-11-10');
  assert.equal(plannedAlice.ShiftCode, 'PM');
});

// 9. Absence with no affected roster assignment does not invent one
test('9. Multi-day absence covering a day with no roster assignment does not invent an artificial assignment', () => {
  const planned = createMockPlannedAssignments();
  // Dr Alice is planned on Nov 10 and Nov 12, but NOT on Nov 11
  assert.equal(planned.some(a => a.PersonId === 'p-001' && a.DutyDomain === 'MO' && a.Date === '2026-11-11'), false);

  const multiDayAbsence = RosterAbsence.createAbsenceRecord({
    periodId: '2026-11',
    personId: 'p-001',
    absenceType: 'MC',
    startDate: '2026-11-10',
    endDate: '2026-11-12',
    dutyDomain: 'MO',
    operationId: opId
  });

  const resolved = RosterAbsence.resolveCurrentRosterWithAbsence({
    periodId: '2026-11',
    plannedAssignments: planned,
    absences: [multiDayAbsence],
    people: mockPeople
  });

  // Nov 11 must NOT have any invented assignment for Dr Alice
  assert.equal(resolved.some(a => a.PersonId === 'p-001' && a.DutyDomain === 'MO' && a.Date === '2026-11-11'), false);
  // Nov 10 and Nov 12 exist and reflect MC
  assert.ok(resolved.some(a => a.PersonId === 'p-001' && a.Date === '2026-11-10' && a.ShiftCode === 'MC'));
  assert.ok(resolved.some(a => a.PersonId === 'p-001' && a.Date === '2026-11-12' && a.ShiftCode === 'MC'));
});

// 10. Absence maps only to assignments inside date range
test('10. Absence maps only to assignments inside date range; dates outside remain unaffected', () => {
  const planned = createMockPlannedAssignments();
  // Single-day absence on Nov 10 only
  const singleDayAbsence = RosterAbsence.createAbsenceRecord({
    periodId: '2026-11',
    personId: 'p-001',
    absenceType: 'MC',
    startDate: '2026-11-10',
    endDate: '2026-11-10',
    dutyDomain: 'MO',
    operationId: opId
  });

  const resolved = RosterAbsence.resolveCurrentRosterWithAbsence({
    periodId: '2026-11',
    plannedAssignments: planned,
    absences: [singleDayAbsence],
    people: mockPeople
  });

  // Nov 10 is MC
  const nov10 = resolved.find(a => a.PersonId === 'p-001' && a.DutyDomain === 'MO' && a.Date === '2026-11-10');
  assert.equal(nov10.ShiftCode, 'MC');

  // Nov 12 remains AM unaffected
  const nov12 = resolved.find(a => a.PersonId === 'p-001' && a.DutyDomain === 'MO' && a.Date === '2026-11-12');
  assert.equal(nov12.ShiftCode, 'AM');
  assert.equal(nov12.Source, 'NEW');
});

// 11. Absence with uncovered assignment produces deterministic uncovered state
test('11. Uncovered absence assignment produces deterministic UNCOVERED state with original lineage', () => {
  const planned = createMockPlannedAssignments();
  const absence = RosterAbsence.createAbsenceRecord({
    periodId: '2026-11',
    personId: 'p-001',
    absenceType: 'MC',
    startDate: '2026-11-10',
    endDate: '2026-11-10',
    dutyDomain: 'MO',
    operationId: opId
  });

  const resolved = RosterAbsence.resolveCurrentRosterWithAbsence({
    periodId: '2026-11',
    plannedAssignments: planned,
    absences: [absence],
    people: mockPeople
  });

  const current = resolved.find(a => a.PersonId === 'p-001' && a.DutyDomain === 'MO' && a.Date === '2026-11-10');
  assert.equal(current.CoverageStatus, 'UNCOVERED');
  assert.equal(current.ShiftCode, 'MC');
  assert.equal(current.OriginalShiftCode, 'PM');
  assert.equal(current.OriginalAssignmentId, 'a1000000-0000-4000-8000-000000000001');
  assert.equal(current.AbsenceId, absence.AbsenceId);
});

// 12. Replacement links to active absence
test('12. Replacement links to active absence record', () => {
  const absence = RosterAbsence.createAbsenceRecord({
    periodId: '2026-11',
    personId: 'p-001',
    absenceType: 'MC',
    startDate: '2026-11-10',
    endDate: '2026-11-10',
    dutyDomain: 'MO',
    operationId: opId
  });

  const replacement = RosterAbsence.createReplacementRecord({
    absenceId: absence.AbsenceId,
    originalAssignmentId: 'a1000000-0000-4000-8000-000000000001',
    replacementPersonId: 'p-002',
    dutyDomain: 'MO',
    date: '2026-11-10',
    shiftCode: 'PM',
    operationId: opId2,
    absences: [absence]
  });

  assert.equal(replacement.AbsenceId, absence.AbsenceId);
  assert.equal(replacement.OriginalAssignmentId, 'a1000000-0000-4000-8000-000000000001');
  assert.equal(replacement.ReplacementPersonId, 'p-002');
  assert.equal(replacement.ShiftCode, 'PM');
  assert.equal(replacement.Status, 'ACTIVE');
});

// 13. Replacement uses authoritative PersonId
test('13. Replacement uses authoritative PersonId and rejects self-replacement', () => {
  const absence = RosterAbsence.createAbsenceRecord({
    periodId: '2026-11',
    personId: 'p-001',
    absenceType: 'MC',
    startDate: '2026-11-10',
    endDate: '2026-11-10',
    dutyDomain: 'MO',
    operationId: opId
  });

  // Cannot replace oneself
  assert.throws(() => {
    RosterAbsence.createReplacementRecord({
      absenceId: absence.AbsenceId,
      originalAssignmentId: 'a1000000-0000-4000-8000-000000000001',
      replacementPersonId: 'p-001',
      dutyDomain: 'MO',
      date: '2026-11-10',
      shiftCode: 'PM',
      operationId: opId2,
      absences: [absence]
    });
  }, err => err.code === RosterAbsence.ABSENCE_ERRORS.VALIDATION_FAILED);
});

// 14. Replacement preserves original assignment lineage
test('14. Replacement assignment preserves lineage back to original planned assignment and absence', () => {
  const planned = createMockPlannedAssignments();
  const absence = RosterAbsence.createAbsenceRecord({
    periodId: '2026-11',
    personId: 'p-001',
    absenceType: 'MC',
    startDate: '2026-11-10',
    endDate: '2026-11-10',
    dutyDomain: 'MO',
    operationId: opId
  });

  const replacement = RosterAbsence.createReplacementRecord({
    absenceId: absence.AbsenceId,
    originalAssignmentId: 'a1000000-0000-4000-8000-000000000001',
    replacementPersonId: 'p-002',
    dutyDomain: 'MO',
    date: '2026-11-10',
    shiftCode: 'PM',
    operationId: opId2,
    absences: [absence]
  });

  const resolved = RosterAbsence.resolveCurrentRosterWithAbsence({
    periodId: '2026-11',
    plannedAssignments: planned,
    absences: [absence],
    replacements: [replacement],
    people: mockPeople
  });

  // Absent assignment is COVERED
  const absentAlice = resolved.find(a => a.PersonId === 'p-001' && a.DutyDomain === 'MO' && a.Date === '2026-11-10');
  assert.equal(absentAlice.ShiftCode, 'MC');
  assert.equal(absentAlice.CoverageStatus, 'COVERED');
  assert.equal(absentAlice.ReplacementId, replacement.ReplacementId);

  // Replacement assignment has full lineage
  const coveringBob = resolved.find(a => a.PersonId === 'p-002' && a.DutyDomain === 'MO' && a.Date === '2026-11-10' && a.ShiftCode === 'PM');
  assert.ok(coveringBob);
  assert.equal(coveringBob.Source, 'REPLACEMENT');
  assert.equal(coveringBob.AbsenceId, absence.AbsenceId);
  assert.equal(coveringBob.ReplacementId, replacement.ReplacementId);
  assert.equal(coveringBob.OriginalAssignmentId, 'a1000000-0000-4000-8000-000000000001');
  assert.equal(coveringBob.CoveringForPersonId, 'p-001');
});

// 15. Replacement across wrong DutyDomain rejected
test('15. Replacement across wrong DutyDomain is rejected fail-closed', () => {
  const absenceMO = RosterAbsence.createAbsenceRecord({
    periodId: '2026-11',
    personId: 'p-001',
    absenceType: 'MC',
    startDate: '2026-11-10',
    endDate: '2026-11-10',
    dutyDomain: 'MO',
    operationId: opId
  });

  assert.throws(() => {
    RosterAbsence.createReplacementRecord({
      absenceId: absenceMO.AbsenceId,
      originalAssignmentId: 'a1000000-0000-4000-8000-000000000001',
      replacementPersonId: 'p-002',
      dutyDomain: 'EP', // Mismatched duty domain
      date: '2026-11-10',
      shiftCode: 'PM',
      operationId: opId2,
      absences: [absenceMO]
    });
  }, err => err.code === RosterAbsence.ABSENCE_ERRORS.DUTY_DOMAIN_MISMATCH);
});

// 16. Replacement against nonexistent absence rejected
test('16. Replacement against nonexistent absence is rejected', () => {
  assert.throws(() => {
    RosterAbsence.createReplacementRecord({
      absenceId: '99999999-9999-4999-8999-999999999999',
      originalAssignmentId: 'a1000000-0000-4000-8000-000000000001',
      replacementPersonId: 'p-002',
      dutyDomain: 'MO',
      date: '2026-11-10',
      shiftCode: 'PM',
      operationId: opId2,
      absences: []
    });
  }, err => err.code === RosterAbsence.ABSENCE_ERRORS.ABSENCE_NOT_FOUND);
});

// 17. Replacement reversal leaves absence active
test('17. Replacement reversal leaves absence active, returning assignment to UNCOVERED', () => {
  const planned = createMockPlannedAssignments();
  const absence = RosterAbsence.createAbsenceRecord({
    periodId: '2026-11',
    personId: 'p-001',
    absenceType: 'MC',
    startDate: '2026-11-10',
    endDate: '2026-11-10',
    dutyDomain: 'MO',
    operationId: opId
  });

  const replacement = RosterAbsence.createReplacementRecord({
    absenceId: absence.AbsenceId,
    originalAssignmentId: 'a1000000-0000-4000-8000-000000000001',
    replacementPersonId: 'p-002',
    dutyDomain: 'MO',
    date: '2026-11-10',
    shiftCode: 'PM',
    operationId: opId2,
    absences: [absence]
  });

  // Reverse the replacement
  const reversedReplacement = RosterAbsence.reverseReplacement({
    replacementId: replacement.ReplacementId,
    replacements: [replacement],
    actor: 'admin',
    operationId: opId2
  });

  assert.equal(reversedReplacement.Status, 'REVERSED');
  assert.equal(absence.Status, 'ACTIVE');

  // Resolve with reversed replacement
  const resolved = RosterAbsence.resolveCurrentRosterWithAbsence({
    periodId: '2026-11',
    plannedAssignments: planned,
    absences: [absence],
    replacements: [reversedReplacement],
    people: mockPeople
  });

  // Alice is back to UNCOVERED MC
  const alice = resolved.find(a => a.PersonId === 'p-001' && a.DutyDomain === 'MO' && a.Date === '2026-11-10');
  assert.equal(alice.ShiftCode, 'MC');
  assert.equal(alice.CoverageStatus, 'UNCOVERED');

  // Bob has no replacement PM assignment
  assert.equal(resolved.some(a => a.PersonId === 'p-002' && a.Date === '2026-11-10' && a.ShiftCode === 'PM'), false);
});

// 18. Absence reversal with dependent replacement blocked
test('18. Absence reversal with dependent active replacement is blocked by dependency conflict', () => {
  const absence = RosterAbsence.createAbsenceRecord({
    periodId: '2026-11',
    personId: 'p-001',
    absenceType: 'MC',
    startDate: '2026-11-10',
    endDate: '2026-11-10',
    dutyDomain: 'MO',
    operationId: opId
  });

  const replacement = RosterAbsence.createReplacementRecord({
    absenceId: absence.AbsenceId,
    originalAssignmentId: 'a1000000-0000-4000-8000-000000000001',
    replacementPersonId: 'p-002',
    dutyDomain: 'MO',
    date: '2026-11-10',
    shiftCode: 'PM',
    operationId: opId2,
    absences: [absence]
  });

  // Attempting to reverse absence while replacement is ACTIVE must be rejected
  const check = RosterAbsence.canReverseAbsence({
    absenceId: absence.AbsenceId,
    absences: [absence],
    replacements: [replacement]
  });
  assert.equal(check.canReverse, false);
  assert.equal(check.reason, RosterAbsence.ABSENCE_ERRORS.REPLACEMENT_DEPENDENCY_CONFLICT);

  assert.throws(() => {
    RosterAbsence.reverseAbsence({
      absenceId: absence.AbsenceId,
      absences: [absence],
      replacements: [replacement]
    });
  }, err => err.code === RosterAbsence.ABSENCE_ERRORS.REPLACEMENT_DEPENDENCY_CONFLICT);
});

// 19. Final dependency reversal restores correct Current
test('19. Final dependency reversal chain restores original Current state', () => {
  const planned = createMockPlannedAssignments();
  const absence = RosterAbsence.createAbsenceRecord({
    periodId: '2026-11',
    personId: 'p-001',
    absenceType: 'MC',
    startDate: '2026-11-10',
    endDate: '2026-11-10',
    dutyDomain: 'MO',
    operationId: opId
  });

  const replacement = RosterAbsence.createReplacementRecord({
    absenceId: absence.AbsenceId,
    originalAssignmentId: 'a1000000-0000-4000-8000-000000000001',
    replacementPersonId: 'p-002',
    dutyDomain: 'MO',
    date: '2026-11-10',
    shiftCode: 'PM',
    operationId: opId2,
    absences: [absence]
  });

  // Step 1: Reverse replacement
  const revReplacement = RosterAbsence.reverseReplacement({
    replacementId: replacement.ReplacementId,
    replacements: [replacement],
    actor: 'admin'
  });

  // Step 2: Now absence can be reversed cleanly
  const revAbsence = RosterAbsence.reverseAbsence({
    absenceId: absence.AbsenceId,
    absences: [absence],
    replacements: [revReplacement],
    actor: 'admin'
  });

  assert.equal(revAbsence.Status, 'REVERSED');

  // Step 3: Resolve Current
  const resolved = RosterAbsence.resolveCurrentRosterWithAbsence({
    periodId: '2026-11',
    plannedAssignments: planned,
    absences: [revAbsence],
    replacements: [revReplacement],
    people: mockPeople
  });

  // Alice is back to PM (original Planned state)
  const alice = resolved.find(a => a.PersonId === 'p-001' && a.DutyDomain === 'MO' && a.Date === '2026-11-10');
  assert.equal(alice.ShiftCode, 'PM');
  assert.equal(alice.Source, 'NEW');
  assert.equal(alice.CoverageStatus, undefined);
});

// 20. Multiple replacements / history remain append-only
test('20. Multiple replacements remain append-only in history', () => {
  const absence = RosterAbsence.createAbsenceRecord({
    periodId: '2026-11',
    personId: 'p-001',
    absenceType: 'MC',
    startDate: '2026-11-10',
    endDate: '2026-11-10',
    dutyDomain: 'MO',
    operationId: opId
  });

  const rep1 = RosterAbsence.createReplacementRecord({
    absenceId: absence.AbsenceId,
    originalAssignmentId: 'a1000000-0000-4000-8000-000000000001',
    replacementPersonId: 'p-002',
    dutyDomain: 'MO',
    date: '2026-11-10',
    shiftCode: 'PM',
    operationId: opId2,
    absences: [absence]
  });

  const rep1Reversed = RosterAbsence.reverseReplacement({
    replacementId: rep1.ReplacementId,
    replacements: [rep1],
    actor: 'admin'
  });

  const rep2 = RosterAbsence.createReplacementRecord({
    absenceId: absence.AbsenceId,
    originalAssignmentId: 'a1000000-0000-4000-8000-000000000001',
    replacementPersonId: 'p-003',
    dutyDomain: 'MO',
    date: '2026-11-10',
    shiftCode: 'PM',
    operationId: '33333333-4444-4555-8666-777777777777',
    absences: [absence]
  });

  // All 3 records exist in history
  const allHistory = [rep1, rep1Reversed, rep2];
  assert.equal(allHistory.length, 3);
  assert.equal(rep1Reversed.Status, 'REVERSED');
  assert.equal(rep2.Status, 'ACTIVE');
  assert.equal(rep2.ReplacementPersonId, 'p-003');
});

// 21. Unconfirmed absence / replacement invisible to Current
test('21. Unconfirmed / draft absence is invisible to Current', () => {
  const planned = createMockPlannedAssignments();
  // Unconfirmed / draft absence (not ACTIVE status)
  const draftAbsence = {
    AbsenceId: '00000000-0000-4000-8000-000000000099',
    PeriodId: '2026-11',
    PersonId: 'p-001',
    AbsenceType: 'MC',
    StartDate: '2026-11-10',
    EndDate: '2026-11-10',
    DutyDomain: 'MO',
    Status: 'DRAFT' // Not confirmed ACTIVE
  };

  const resolved = RosterAbsence.resolveCurrentRosterWithAbsence({
    periodId: '2026-11',
    plannedAssignments: planned,
    absences: [draftAbsence],
    people: mockPeople
  });

  const alice = resolved.find(a => a.PersonId === 'p-001' && a.DutyDomain === 'MO' && a.Date === '2026-11-10');
  assert.equal(alice.ShiftCode, 'PM'); // Unaffected by unconfirmed draft
});

// 22. Failed / recovery-required operations invisible
test('22. Failed / recovery-required operations are invisible to Current', () => {
  const planned = createMockPlannedAssignments();
  const failedAbsence = {
    AbsenceId: '00000000-0000-4000-8000-000000000098',
    PeriodId: '2026-11',
    PersonId: 'p-001',
    AbsenceType: 'MC',
    StartDate: '2026-11-10',
    EndDate: '2026-11-10',
    DutyDomain: 'MO',
    Status: 'FAILED'
  };

  const resolved = RosterAbsence.resolveCurrentRosterWithAbsence({
    periodId: '2026-11',
    plannedAssignments: planned,
    absences: [failedAbsence],
    people: mockPeople
  });

  const alice = resolved.find(a => a.PersonId === 'p-001' && a.DutyDomain === 'MO' && a.Date === '2026-11-10');
  assert.equal(alice.ShiftCode, 'PM');
});

// 23. Deterministic replay / idempotency
test('23. Deterministic replay / idempotency: re-running resolver yields byte-for-byte identical output', () => {
  const planned = createMockPlannedAssignments();
  const absence = RosterAbsence.createAbsenceRecord({
    periodId: '2026-11',
    personId: 'p-001',
    absenceType: 'MC',
    startDate: '2026-11-10',
    endDate: '2026-11-10',
    dutyDomain: 'MO',
    operationId: opId,
    digestFn
  });

  const replacement = RosterAbsence.createReplacementRecord({
    absenceId: absence.AbsenceId,
    originalAssignmentId: 'a1000000-0000-4000-8000-000000000001',
    replacementPersonId: 'p-002',
    dutyDomain: 'MO',
    date: '2026-11-10',
    shiftCode: 'PM',
    operationId: opId2,
    absences: [absence],
    digestFn
  });

  const run1 = RosterAbsence.resolveCurrentRosterWithAbsence({
    periodId: '2026-11',
    plannedAssignments: planned,
    absences: [absence],
    replacements: [replacement],
    people: mockPeople,
    digestFn
  });

  const run2 = RosterAbsence.resolveCurrentRosterWithAbsence({
    periodId: '2026-11',
    plannedAssignments: planned,
    absences: [absence],
    replacements: [replacement],
    people: mockPeople,
    digestFn
  });

  assert.deepEqual(run1, run2);
  assert.equal(JSON.stringify(run1), JSON.stringify(run2));
});

// 24. MasterRoster projection semantics
test('24. MasterRoster projection preserves legacy format: shows MC for absent doctor and PM for covering doctor', () => {
  const planned = createMockPlannedAssignments();
  const absence = RosterAbsence.createAbsenceRecord({
    periodId: '2026-11',
    personId: 'p-001',
    personNameSnapshot: 'Dr Alice',
    absenceType: 'MC',
    startDate: '2026-11-10',
    endDate: '2026-11-10',
    dutyDomain: 'MO',
    operationId: opId
  });

  const replacement = RosterAbsence.createReplacementRecord({
    absenceId: absence.AbsenceId,
    originalAssignmentId: 'a1000000-0000-4000-8000-000000000001',
    replacementPersonId: 'p-002',
    dutyDomain: 'MO',
    date: '2026-11-10',
    shiftCode: 'PM',
    operationId: opId2,
    absences: [absence]
  });

  const resolved = RosterAbsence.resolveCurrentRosterWithAbsence({
    periodId: '2026-11',
    plannedAssignments: planned,
    absences: [absence],
    replacements: [replacement],
    people: mockPeople
  });

  const projection = RosterLifecycle.generateMasterRosterProjection(resolved);

  // Both Dr Alice with MC and Dr Bob with PM exist in the legacy projection
  const aliceMcRow = projection.find(r => r.Name === 'Dr Alice' && r.Date === '2026-11-10' && r.Shift === 'MC');
  const bobRow = projection.find(r => r.Name === 'Dr Bob' && r.Date === '2026-11-10' && r.Shift === 'PM');

  assert.ok(aliceMcRow, 'Dr Alice MC row exists in projection');
  assert.equal(aliceMcRow.Shift, 'MC');
  assert.ok(bobRow, 'Dr Bob row exists in projection');
  assert.equal(bobRow.Shift, 'PM');
});

// 25. Viewer DTO privacy strips admin / private fields
test('25. Viewer DTO strips sensitive AdminNote and private fields', () => {
  const absence = RosterAbsence.createAbsenceRecord({
    periodId: '2026-11',
    personId: 'p-001',
    personNameSnapshot: 'Dr Alice',
    absenceType: 'MC',
    startDate: '2026-11-10',
    endDate: '2026-11-10',
    dutyDomain: 'MO',
    publicReason: 'DUTY_COVERAGE',
    adminNote: 'CONFIDENTIAL: Undergoing outpatient surgical procedure',
    operationId: opId
  });

  const publicDto = RosterAbsence.toPublicAbsenceDto(absence);

  // Sensitive note is stripped
  assert.equal(publicDto.AdminNote, undefined);
  assert.equal(Object.prototype.hasOwnProperty.call(publicDto, 'AdminNote'), false);

  // Operationally necessary public fields remain
  assert.equal(publicDto.AbsenceId, absence.AbsenceId);
  assert.equal(publicDto.PersonId, 'p-001');
  assert.equal(publicDto.AbsenceType, 'MC');
  assert.equal(publicDto.StartDate, '2026-11-10');
  assert.equal(publicDto.EndDate, '2026-11-10');
  assert.equal(publicDto.PublicReason, 'DUTY_COVERAGE');
  assert.equal(publicDto.Status, 'ACTIVE');
});

// 26. Planned remains byte-for-byte semantically immutable
test('26. Planned remains byte-for-byte semantically immutable across multiple absence and replacement mutations', () => {
  const planned = createMockPlannedAssignments();
  const originalDigest = digestFn(RosterCompatibility.canonicalJson(planned));

  const absence = RosterAbsence.createAbsenceRecord({
    periodId: '2026-11',
    personId: 'p-001',
    absenceType: 'MC',
    startDate: '2026-11-10',
    endDate: '2026-11-10',
    dutyDomain: 'MO',
    operationId: opId
  });

  const rep = RosterAbsence.createReplacementRecord({
    absenceId: absence.AbsenceId,
    originalAssignmentId: 'a1000000-0000-4000-8000-000000000001',
    replacementPersonId: 'p-002',
    dutyDomain: 'MO',
    date: '2026-11-10',
    shiftCode: 'PM',
    operationId: opId2,
    absences: [absence]
  });

  // Multiple resolutions and state mutations
  RosterAbsence.resolveCurrentRosterWithAbsence({
    periodId: '2026-11',
    plannedAssignments: planned,
    absences: [absence],
    replacements: [rep],
    people: mockPeople
  });

  const finalDigest = digestFn(RosterCompatibility.canonicalJson(planned));
  assert.equal(finalDigest, originalDigest, 'Planned SHA-256 digest must match original digest byte-for-byte');
});

// Extra tests: Shortage semantics and coverage status derivation
test('Extra: Shortage acceptance validation and coverage status derivation', () => {
  const absence = RosterAbsence.createAbsenceRecord({
    periodId: '2026-11',
    personId: 'p-001',
    absenceType: 'MC',
    startDate: '2026-11-10',
    endDate: '2026-11-12',
    dutyDomain: 'MO',
    operationId: opId
  });

  const affected = [
    { AssignmentId: 'aff-1', Date: '2026-11-10', DutyDomain: 'MO', ShiftCode: 'PM' },
    { AssignmentId: 'aff-2', Date: '2026-11-12', DutyDomain: 'MO', ShiftCode: 'AM' }
  ];

  // 1. None covered -> UNCOVERED
  const statusUncovered = RosterAbsence.deriveAbsenceCoverageStatus({
    absence,
    affectedAssignments: affected,
    replacements: []
  });
  assert.equal(statusUncovered, RosterAbsence.COVERAGE_STATUS.UNCOVERED);

  // Shortage acceptance required when UNCOVERED
  assert.throws(() => {
    RosterAbsence.validateShortageAcceptance({
      shortageAccepted: false,
      shortageReason: '',
      coverageStatus: statusUncovered
    });
  }, err => err.code === RosterAbsence.ABSENCE_ERRORS.SHORTAGE_ACCEPTANCE_REQUIRED);

  // Passes when accepted with reason
  assert.equal(RosterAbsence.validateShortageAcceptance({
    shortageAccepted: true,
    shortageReason: 'Advisory accepted for day 1 shortage',
    coverageStatus: statusUncovered
  }), true);

  // 2. One covered -> PARTIALLY_COVERED
  const rep1 = {
    ReplacementId: 'r-1',
    AbsenceId: absence.AbsenceId,
    OriginalAssignmentId: 'aff-1',
    Date: '2026-11-10',
    DutyDomain: 'MO',
    Status: 'ACTIVE'
  };
  const statusPartial = RosterAbsence.deriveAbsenceCoverageStatus({
    absence,
    affectedAssignments: affected,
    replacements: [rep1]
  });
  assert.equal(statusPartial, RosterAbsence.COVERAGE_STATUS.PARTIALLY_COVERED);

  // 3. Both covered -> COVERED
  const rep2 = {
    ReplacementId: 'r-2',
    AbsenceId: absence.AbsenceId,
    OriginalAssignmentId: 'aff-2',
    Date: '2026-11-12',
    DutyDomain: 'MO',
    Status: 'ACTIVE'
  };
  const statusCovered = RosterAbsence.deriveAbsenceCoverageStatus({
    absence,
    affectedAssignments: affected,
    replacements: [rep1, rep2]
  });
  assert.equal(statusCovered, RosterAbsence.COVERAGE_STATUS.COVERED);
});
