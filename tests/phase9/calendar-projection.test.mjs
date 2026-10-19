import test from 'node:test';
import assert from 'node:assert/strict';
import {
  projectAssignmentToCalendarRow,
  projectNormalizedAssignmentsToCalendarRows,
  projectResolvedAssignmentsToLegacyRows,
  projectCalendarDataset,
  filterMoCalendarRows,
  filterEpCalendarRows,
  isMoCalendarRow,
  isEpCalendarRow
} from '../../src/features/roster/data/calendarProjection.js';
import { resolveRosterSource } from '../../src/features/roster/data/rosterSourceResolver.js';

// Standard 13-MO doctor fixture
const directoryPeople = [
  { PersonId: 'd89cf180-37c8-448c-8ebc-927724e4b79c', CurrentDisplayName: 'Adi', DirectoryType: 'MO', StaffId: 'A05157', LegacyNamesJson: '[]', Active: true },
  { PersonId: 'a9bc3a8e-c60f-4990-8fb3-ab91321c9e44', CurrentDisplayName: 'Azrul', DirectoryType: 'MO', StaffId: 'A05201', LegacyNamesJson: '[]', Active: true },
  { PersonId: 'ed25daed-3b7a-4eb5-8048-ecc4540f790e', CurrentDisplayName: 'Afiq', DirectoryType: 'MO', StaffId: 'A05563', LegacyNamesJson: '[]', Active: true },
  { PersonId: '359bd69b-e293-47f1-8c74-63d0c5f820c6', CurrentDisplayName: 'Muaz', DirectoryType: 'MO', StaffId: 'A05832', LegacyNamesJson: '[]', Active: true },
  { PersonId: 'def02516-d2b5-4d0e-87fa-f45133e08f2f', CurrentDisplayName: 'Syuhada', DirectoryType: 'MO', StaffId: 'A05836', LegacyNamesJson: '["SYU", "Syu", "Syuhada"]', Active: true },
  { PersonId: '9f911524-d26d-42ea-81f3-c907e7b14350', CurrentDisplayName: 'Najmi', DirectoryType: 'MO', StaffId: 'A05887', LegacyNamesJson: '[]', Active: true },
  { PersonId: 'ac810062-23b1-4d8d-8ea1-b7618386218a', CurrentDisplayName: 'Aiman', DirectoryType: 'MO', StaffId: 'KA5239', LegacyNamesJson: '[]', Active: true },
  { PersonId: '21a9cd36-8d8b-40cb-80bc-d0dce573370b', CurrentDisplayName: 'Shafa', DirectoryType: 'MO', StaffId: 'A06145', LegacyNamesJson: '[]', Active: true },
  { PersonId: 'd3e38a0e-5a84-4990-8995-3fa26f39d490', CurrentDisplayName: 'Asyraaf', DirectoryType: 'MO', StaffId: 'A05959', LegacyNamesJson: '[]', Active: true },
  { PersonId: '4ee34fd6-d0c9-45ae-8171-188fd9f49a72', CurrentDisplayName: 'Adli', DirectoryType: 'MO', StaffId: 'A05962', LegacyNamesJson: '[]', Active: true },
  { PersonId: '50553e9b-9a24-4548-8f34-d9e222d44064', CurrentDisplayName: 'Iema', DirectoryType: 'MO', StaffId: 'A05960', LegacyNamesJson: '[]', Active: true },
  { PersonId: 'b4024790-57f4-40c1-8e4e-a853ffe1f0ae', CurrentDisplayName: 'Syifa', DirectoryType: 'MO', StaffId: 'KA5335', LegacyNamesJson: '[]', Active: true },
  { PersonId: '287b9cd6-8bc9-4153-8f42-ae10ba2b58a7', CurrentDisplayName: 'Afif', DirectoryType: 'MO', StaffId: 'A05148', LegacyNamesJson: '[]', Active: false },
  // EP doctors
  { PersonId: 'f5b6ce73-8565-4332-8000-25025933e796', CurrentDisplayName: 'Iskasymar', DirectoryType: 'EP', StaffId: 'EP01', LegacyNamesJson: '[]', Active: true },
  { PersonId: 'ee4c5d90-c624-4db0-8e56-0babec51881c', CurrentDisplayName: 'Luqman', DirectoryType: 'EP', StaffId: 'EP02', LegacyNamesJson: '[]', Active: true }
];

const legacyTeamMembers = directoryPeople.filter((p) => p.DirectoryType === 'MO').map((p) => ({
  name: p.CurrentDisplayName,
  staffId: p.StaffId
}));
const legacyNames = legacyTeamMembers.map((m) => m.name);

test('V2 Unified Roster — Slice B1a Pure Calendar Compatibility Adapter Suite', async (t) => {
  await t.test('1. Historical MasterRoster assignment projection produces valid calendar rows', () => {
    const octMasterRoster = [
      { Name: 'Adi', Date: '2026-10-01', Shift: 'AM' },
      { Name: 'Azrul', Date: '2026-10-01', Shift: 'PM (S)' },
      { Name: 'Afiq', Date: '2026-10-01', Shift: 'ON1' },
      { Name: 'Muaz', Date: '2026-10-01', Shift: 'PN' },
      { Name: 'Iskasymar', Date: '2026-10-01', Shift: 'EP_OFFICE_HOUR' },
      { Name: 'Luqman', Date: '2026-10-01', Shift: 'EP_ONCALL' }
    ];

    const resolved = resolveRosterSource({
      period: '2026-10',
      masterRoster: octMasterRoster,
      people: directoryPeople,
      teamMembers: legacyTeamMembers,
      legacyNames
    });

    assert.equal(resolved.authority, 'LEGACY_MASTER_ROSTER');
    assert.equal(resolved.status, 'RESOLVED');

    const calendarRows = projectNormalizedAssignmentsToCalendarRows(resolved);
    assert.equal(calendarRows.length, 6);

    // Verify row structure
    calendarRows.forEach((r) => {
      assert.ok(typeof r.Name === 'string' && r.Name.length > 0);
      assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(r.Date));
      assert.ok(typeof r.Shift === 'string' && r.Shift.length > 0);
      assert.ok(['MO', 'EP'].includes(r.dutyDomain));
    });

    const dataset = projectCalendarDataset(resolved);
    assert.equal(dataset.allRows.length, 6);
    assert.equal(dataset.moRows.length, 4);
    assert.equal(dataset.epRows.length, 2);

    // Verify alias
    const aliasRows = projectResolvedAssignmentsToLegacyRows(resolved);
    assert.deepEqual(aliasRows, calendarRows);
  });

  await t.test('2. November V2 draft assignment projection', () => {
    const novDraft = [
      {
        personId: 'd89cf180-37c8-448c-8ebc-927724e4b79c',
        personNameSnapshot: 'Adi',
        date: '2026-11-02',
        shiftCode: 'AM',
        modifiers: { standby: false, extended: true },
        rawShift: 'AMX',
        dutyDomain: 'MO'
      },
      {
        personId: 'a9bc3a8e-c60f-4990-8fb3-ab91321c9e44',
        personNameSnapshot: 'Azrul',
        date: '2026-11-02',
        shiftCode: 'PM',
        modifiers: { standby: true, extended: false },
        dutyDomain: 'MO'
      }
    ];

    const resolved = resolveRosterSource({
      period: '2026-11',
      lifecycleState: 'DRAFT',
      v2DraftAssignments: novDraft,
      people: directoryPeople,
      teamMembers: legacyTeamMembers
    });

    assert.equal(resolved.authority, 'V2_DRAFT');

    const calendarRows = projectNormalizedAssignmentsToCalendarRows(resolved);
    assert.equal(calendarRows.length, 2);

    const adiRow = calendarRows.find((r) => r.Name === 'Adi');
    assert.ok(adiRow);
    assert.equal(adiRow.Date, '2026-11-02');
    assert.equal(adiRow.Shift, 'AMX');
    assert.equal(adiRow.modifiers.extended, true);
    assert.equal(adiRow.dutyDomain, 'MO');

    const azrulRow = calendarRows.find((r) => r.Name === 'Azrul');
    assert.ok(azrulRow);
    assert.equal(azrulRow.Date, '2026-11-02');
    assert.equal(azrulRow.Shift, 'PM (S)');
    assert.equal(azrulRow.modifiers.standby, true);
    assert.equal(azrulRow.dutyDomain, 'MO');
  });

  await t.test('3. Empty future-month assignments remain strictly empty', () => {
    // 3a. Enrolled DRAFT with empty assignments
    const resolvedEmptyDraftNov = resolveRosterSource({
      period: '2026-11',
      lifecycleState: 'DRAFT',
      v2DraftAssignments: [],
      people: directoryPeople,
      teamMembers: legacyTeamMembers
    });

    assert.equal(resolvedEmptyDraftNov.authority, 'V2_DRAFT');
    assert.equal(resolvedEmptyDraftNov.status, 'RESOLVED');
    assert.equal(resolvedEmptyDraftNov.assignments.length, 0);

    const projectedNovDraft = projectNormalizedAssignmentsToCalendarRows(resolvedEmptyDraftNov);
    assert.deepEqual(projectedNovDraft, []);

    // 3b. Unenrolled future month (e.g. unenrolled November or December)
    const resolvedUnenrolledNov = resolveRosterSource({
      period: '2026-11',
      people: directoryPeople,
      teamMembers: legacyTeamMembers
    });
    assert.equal(resolvedUnenrolledNov.authority, 'V2_EMPTY_DRAFT');
    assert.equal(resolvedUnenrolledNov.status, 'RESOLVED');
    assert.equal(resolvedUnenrolledNov.assignments.length, 0);

    const projectedUnenrolledNov = projectNormalizedAssignmentsToCalendarRows(resolvedUnenrolledNov);
    assert.deepEqual(projectedUnenrolledNov, []);

    const resolvedDec = resolveRosterSource({
      period: '2026-12',
      people: directoryPeople,
      teamMembers: legacyTeamMembers
    });
    assert.equal(resolvedDec.authority, 'V2_EMPTY_DRAFT');
    assert.equal(resolvedDec.status, 'RESOLVED');
    assert.equal(resolvedDec.assignments.length, 0);

    const projectedDec = projectNormalizedAssignmentsToCalendarRows(resolvedDec);
    assert.deepEqual(projectedDec, []);

    // Empty array directly passed
    assert.deepEqual(projectNormalizedAssignmentsToCalendarRows([]), []);
  });

  await t.test('4. Shift and modifier preservation (AMX, PMX, ON1, ON2, PN, standby, extended)', () => {
    const cases = [
      {
        input: { personNameSnapshot: 'Adi', date: '2026-11-01', shiftCode: 'AM', rawShift: 'AMX', dutyDomain: 'MO' },
        expectedShift: 'AMX',
        expectedModifiers: { standby: false, extended: true }
      },
      {
        input: { personNameSnapshot: 'Azrul', date: '2026-11-01', shiftCode: 'PM', rawShift: 'PMX', dutyDomain: 'MO' },
        expectedShift: 'PMX',
        expectedModifiers: { standby: false, extended: true }
      },
      {
        input: { personNameSnapshot: 'Afiq', date: '2026-11-01', shiftCode: 'ON1', dutyDomain: 'MO' },
        expectedShift: 'ON1',
        expectedModifiers: { standby: false, extended: false }
      },
      {
        input: { personNameSnapshot: 'Muaz', date: '2026-11-01', shiftCode: 'ON2', dutyDomain: 'MO' },
        expectedShift: 'ON2',
        expectedModifiers: { standby: false, extended: false }
      },
      {
        input: { personNameSnapshot: 'Syuhada', date: '2026-11-01', shiftCode: 'PN', dutyDomain: 'MO' },
        expectedShift: 'PN',
        expectedModifiers: { standby: false, extended: false }
      },
      {
        input: { personNameSnapshot: 'Najmi', date: '2026-11-01', shiftCode: 'AM', rawShift: 'AM (S)', dutyDomain: 'MO' },
        expectedShift: 'AM (S)',
        expectedModifiers: { standby: true, extended: false }
      },
      {
        input: { personNameSnapshot: 'Aiman', date: '2026-11-01', shiftCode: 'AM', rawShift: 'AM-S', dutyDomain: 'MO' },
        expectedShift: 'AM-S',
        expectedModifiers: { standby: true, extended: false }
      },
      {
        input: {
          personNameSnapshot: 'Shafa',
          date: '2026-11-01',
          shiftCode: 'PM',
          modifiers: { standby: true, extended: true },
          dutyDomain: 'MO'
        },
        expectedShift: 'PM (S) (X)',
        expectedModifiers: { standby: true, extended: true }
      },
      {
        input: { personNameSnapshot: 'Asyraaf', date: '2026-11-01', shiftCode: 'OFF', dutyDomain: 'MO' },
        expectedShift: 'OFF',
        expectedModifiers: { standby: false, extended: false }
      },
      {
        input: { personNameSnapshot: 'Adli', date: '2026-11-01', shiftCode: 'AL', dutyDomain: 'MO' },
        expectedShift: 'AL',
        expectedModifiers: { standby: false, extended: false }
      }
    ];

    cases.forEach(({ input, expectedShift, expectedModifiers }) => {
      const row = projectAssignmentToCalendarRow(input);
      assert.equal(row.Shift, expectedShift, `Failed shift check for ${input.personNameSnapshot}`);
      assert.deepEqual(row.modifiers, expectedModifiers, `Failed modifiers check for ${input.personNameSnapshot}`);
      assert.equal(row.Name, input.personNameSnapshot);
      assert.equal(row.Date, input.date);
    });
  });

  await t.test('5. EP segregation: EP records are never converted to MO assignments', () => {
    const epOfficeRow = projectAssignmentToCalendarRow({
      personNameSnapshot: 'Iskasymar',
      date: '2026-10-01',
      shiftCode: 'EP_OFFICE_HOUR',
      dutyDomain: 'EP'
    });
    assert.equal(epOfficeRow.dutyDomain, 'EP');
    assert.equal(epOfficeRow.Shift, 'EP_OFFICE_HOUR');
    assert.ok(isEpCalendarRow(epOfficeRow));
    assert.ok(!isMoCalendarRow(epOfficeRow));

    const epOncallRow = projectAssignmentToCalendarRow({
      personNameSnapshot: 'Luqman',
      date: '2026-10-01',
      shiftCode: 'EP_ONCALL',
      dutyDomain: 'EP'
    });
    assert.equal(epOncallRow.dutyDomain, 'EP');
    assert.equal(epOncallRow.Shift, 'EP_ONCALL');
    assert.ok(isEpCalendarRow(epOncallRow));

    const moRow = projectAssignmentToCalendarRow({
      personNameSnapshot: 'Adi',
      date: '2026-10-01',
      shiftCode: 'AM',
      dutyDomain: 'MO'
    });
    assert.ok(isMoCalendarRow(moRow));
    assert.ok(!isEpCalendarRow(moRow));

    const dataset = projectCalendarDataset([epOfficeRow, epOncallRow, moRow]);
    assert.equal(dataset.moRows.length, 1);
    assert.equal(dataset.moRows[0].Name, 'Adi');
    assert.equal(dataset.epRows.length, 2);
    assert.ok(!dataset.moRows.some((r) => r.dutyDomain === 'EP'));
    assert.ok(!dataset.epRows.some((r) => r.dutyDomain === 'MO'));

    // Filter helpers
    assert.equal(filterMoCalendarRows([epOfficeRow, moRow]).length, 1);
    assert.equal(filterEpCalendarRows([epOfficeRow, moRow]).length, 1);

    // Fail visibly on domain mismatch
    assert.throws(
      () =>
        projectAssignmentToCalendarRow({
          personNameSnapshot: 'Adi',
          date: '2026-10-01',
          shiftCode: 'EP_OFFICE_HOUR',
          dutyDomain: 'MO'
        }),
      /Domain mismatch/i
    );

    assert.throws(
      () =>
        projectAssignmentToCalendarRow({
          personNameSnapshot: 'Iskasymar',
          date: '2026-10-01',
          shiftCode: 'AM',
          dutyDomain: 'EP'
        }),
      /Domain mismatch/i
    );
  });

  await t.test('6. Unknown shifts and invalid records fail visibly', () => {
    // 6a. Null or non-object record
    assert.throws(() => projectAssignmentToCalendarRow(null), /Invalid assignment record/i);
    assert.throws(() => projectAssignmentToCalendarRow('invalid-string'), /Invalid assignment record/i);

    // 6b. Invalid or missing date
    assert.throws(
      () => projectAssignmentToCalendarRow({ personNameSnapshot: 'Adi', shiftCode: 'AM' }),
      /Invalid assignment date/i
    );
    assert.throws(
      () => projectAssignmentToCalendarRow({ personNameSnapshot: 'Adi', date: 'not-a-date', shiftCode: 'AM' }),
      /Invalid assignment date/i
    );
    assert.throws(
      () => projectAssignmentToCalendarRow({ personNameSnapshot: 'Adi', date: '2026-99-99', shiftCode: 'AM' }),
      /Invalid assignment date/i
    );

    // 6c. Missing identity
    assert.throws(
      () => projectAssignmentToCalendarRow({ date: '2026-11-01', shiftCode: 'AM' }),
      /Invalid assignment identity/i
    );

    // 6d. Missing shift
    assert.throws(
      () => projectAssignmentToCalendarRow({ personNameSnapshot: 'Adi', date: '2026-11-01' }),
      /Invalid assignment shift/i
    );

    // 6e. Unknown/unsupported shift code
    assert.throws(
      () =>
        projectAssignmentToCalendarRow({
          personNameSnapshot: 'Adi',
          date: '2026-11-01',
          shiftCode: 'SUPER_NIGHT',
          dutyDomain: 'MO'
        }),
      /Unsupported shift code: "SUPER_NIGHT"/i
    );

    // 6f. Invalid dutyDomain
    assert.throws(
      () =>
        projectAssignmentToCalendarRow({
          personNameSnapshot: 'Adi',
          date: '2026-11-01',
          shiftCode: 'AM',
          dutyDomain: 'NURSE'
        }),
      /Invalid dutyDomain/i
    );
  });

  await t.test('7. Input immutability is strictly preserved', () => {
    const rawAssignment1 = Object.freeze({
      personId: 'd89cf180-37c8-448c-8ebc-927724e4b79c',
      personNameSnapshot: 'Adi',
      date: '2026-11-01',
      shiftCode: 'AM',
      modifiers: Object.freeze({ standby: false, extended: true }),
      dutyDomain: 'MO',
      rawShift: 'AMX'
    });

    const rawAssignment2 = Object.freeze({
      personId: 'a9bc3a8e-c60f-4990-8fb3-ab91321c9e44',
      personNameSnapshot: 'Azrul',
      date: '2026-11-01',
      shiftCode: 'PM',
      modifiers: Object.freeze({ standby: true, extended: false }),
      dutyDomain: 'MO'
    });

    const rawList = Object.freeze([rawAssignment1, rawAssignment2]);

    // Should execute without trying to mutate frozen inputs
    const projected = projectNormalizedAssignmentsToCalendarRows(rawList);
    assert.equal(projected.length, 2);

    // Assert that returned rows are new objects independent of input
    assert.notEqual(projected[0], rawAssignment1);
    assert.notEqual(projected[1], rawAssignment2);

    // Mutation of output row does not affect input
    projected[0].Shift = 'MUTATED';
    assert.equal(rawAssignment1.shiftCode, 'AM');
    assert.equal(rawAssignment1.rawShift, 'AMX');
  });
});
