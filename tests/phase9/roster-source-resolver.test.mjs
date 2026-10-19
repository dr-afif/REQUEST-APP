import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeLegacyMasterRoster,
  normalizeV2Assignments,
  resolveRosterSource
} from '../../src/features/roster/data/rosterSourceResolver.js';

// Authoritative legacy team members fixture (13 MO doctors in exact sequence)
const legacyTeamMembers = [
  { name: 'Adi', staffId: 'A05157' },
  { name: 'Azrul', staffId: 'A05201' },
  { name: 'Afiq', staffId: 'A05563' },
  { name: 'Muaz', staffId: 'A05832' },
  { name: 'Syuhada', staffId: 'A05836' },
  { name: 'Najmi', staffId: 'A05887' },
  { name: 'Aiman', staffId: 'KA5239' },
  { name: 'Shafa', staffId: 'A06145' },
  { name: 'Asyraaf', staffId: 'A05959' },
  { name: 'Adli', staffId: 'A05962' },
  { name: 'Iema', staffId: 'A05960' },
  { name: 'Syifa', staffId: 'KA5335' },
  { name: 'Afif', staffId: 'A05148' }
];

const legacyNames = legacyTeamMembers.map(m => m.name);

// Full directory fixture: 13 MO doctors + 6 EP doctors
const directoryPeople = [
  { PersonId: 'd89cf180-37c8-448c-8ebc-927724e4b79c', CurrentDisplayName: 'Adi', DirectoryType: 'MO', StaffId: 'A05157', LegacyNamesJson: '[]', Active: true },
  { PersonId: 'a9bc3a8e-c60f-4990-8fb3-ab91321c9e44', CurrentDisplayName: 'Azrul', DirectoryType: 'MO', StaffId: 'A05201', LegacyNamesJson: '[]', Active: true },
  { PersonId: 'ed25daed-3b7a-4eb5-8048-ecc4540f790e', CurrentDisplayName: 'Afiq', DirectoryType: 'MO', StaffId: 'A05563', LegacyNamesJson: '[]', Active: true },
  { PersonId: '359bd69b-e293-47f1-8c74-63d0c5f820c6', CurrentDisplayName: 'Muaz', DirectoryType: 'MO', StaffId: 'A05832', LegacyNamesJson: '[]', Active: true },
  { PersonId: 'def02516-d2b5-4d0e-87fa-f45133e08f2f', CurrentDisplayName: 'Syuhada', DirectoryType: 'MO', StaffId: 'A05836', LegacyNamesJson: '["SYU", "Syu", "Syuhada"]', Active: true },
  { PersonId: '9f911524-d26d-42ea-81f3-c907e7b14350', CurrentDisplayName: 'Najmi', DirectoryType: 'MO', StaffId: 'A05887', LegacyNamesJson: '[]', Active: true },
  { PersonId: 'ac810062-23b1-4d8d-8ea1-b7618386218a', CurrentDisplayName: 'Aiman', DirectoryType: 'MO', StaffId: 'KA5239', LegacyNamesJson: '[]', Active: true },
  { PersonId: '21a9cd36-8d8b-40cb-80bc-d0dce573370b', CurrentDisplayName: 'Shafa', DirectoryType: 'MO', StaffId: 'A06145', LegacyNamesJson: '[]', Active: true },
  { PersonId: 'd3e38a0e-5a84-49b1-8995-3fa26f39d490', CurrentDisplayName: 'Asyraaf', DirectoryType: 'MO', StaffId: 'A05959', LegacyNamesJson: '[]', Active: true },
  { PersonId: '4ee34fd6-d0c9-45ae-8171-188fd9f49a72', CurrentDisplayName: 'Adli', DirectoryType: 'MO', StaffId: 'A05962', LegacyNamesJson: '[]', Active: true },
  { PersonId: '50553e9b-9a24-4548-8f34-d9e222d44064', CurrentDisplayName: 'Iema', DirectoryType: 'MO', StaffId: 'A05960', LegacyNamesJson: '[]', Active: true },
  { PersonId: 'b4024790-57f4-40c1-8e4e-a853ffe1f0ae', CurrentDisplayName: 'Syifa', DirectoryType: 'MO', StaffId: 'KA5335', LegacyNamesJson: '[]', Active: true },
  { PersonId: '287b9cd6-8bc9-4153-8f42-ae10ba2b58a7', CurrentDisplayName: 'Afif', DirectoryType: 'MO', StaffId: 'A05148', LegacyNamesJson: '[]', Active: false },
  // EP doctors
  { PersonId: 'f5b6ce73-8565-4332-8000-25025933e796', CurrentDisplayName: 'Iskasymar', DirectoryType: 'EP', StaffId: 'EP01', LegacyNamesJson: '[]', Active: true },
  { PersonId: 'ee4c5d90-c624-4db0-8e56-0babec51881c', CurrentDisplayName: 'Luqman', DirectoryType: 'EP', StaffId: 'EP02', LegacyNamesJson: '[]', Active: true },
  { PersonId: '1b7f4173-4232-42d2-878c-b849bd69a8f6', CurrentDisplayName: 'Hafizah', DirectoryType: 'EP', StaffId: 'EP03', LegacyNamesJson: '[]', Active: true },
  { PersonId: '1adb438e-187c-434d-84f0-56bd1ec8ac0a', CurrentDisplayName: 'Hayati', DirectoryType: 'EP', StaffId: 'EP04', LegacyNamesJson: '[]', Active: true },
  { PersonId: '8260d34a-fc6d-4342-8e32-faa983872dfb', CurrentDisplayName: 'Syakirah', DirectoryType: 'EP', StaffId: 'EP05', LegacyNamesJson: '[]', Active: true },
  { PersonId: '94ae3bc1-8508-46a4-8e56-f4d112dc8211', CurrentDisplayName: 'Suhaimi', DirectoryType: 'EP', StaffId: 'EP06', LegacyNamesJson: '[]', Active: true }
];

test('V2 Unified Roster — Slice A Pure Roster Source Resolver Suite', async (t) => {

  await t.test('1. October with MasterRoster rows -> LEGACY_MASTER_ROSTER authority', () => {
    const octRows = [
      { Name: 'Adi', Date: '2026-10-01', Shift: 'AM' },
      { Name: 'Azrul', Date: '2026-10-01', Shift: 'PM' }
    ];
    const result = resolveRosterSource({
      period: '2026-10',
      masterRoster: octRows,
      people: directoryPeople,
      teamMembers: legacyTeamMembers,
      legacyNames
    });

    assert.equal(result.period, '2026-10');
    assert.equal(result.authority, 'LEGACY_MASTER_ROSTER');
    assert.equal(result.status, 'RESOLVED');
    assert.equal(result.assignments.length, 2);
    assert.equal(result.assignments[0].personId, 'd89cf180-37c8-448c-8ebc-927724e4b79c');
    assert.equal(result.assignments[0].shiftCode, 'AM');
  });

  await t.test('2. October historical result is strictly read-only', () => {
    const octRows = [
      { Name: 'Adi', Date: '2026-10-05', Shift: 'ON1' }
    ];
    const result = resolveRosterSource({
      period: '2026-10',
      masterRoster: octRows,
      people: directoryPeople,
      teamMembers: legacyTeamMembers
    });

    assert.equal(result.isReadOnly, true);
    assert.equal(result.authority, 'LEGACY_MASTER_ROSTER');
  });

  await t.test('3. November DRAFT with assignments -> V2_DRAFT', () => {
    const novDraft = [
      { personId: 'd89cf180-37c8-448c-8ebc-927724e4b79c', date: '2026-11-01', shiftCode: 'AM', dutyDomain: 'MO' }
    ];
    const result = resolveRosterSource({
      period: '2026-11',
      lifecycleState: 'DRAFT',
      v2DraftAssignments: novDraft,
      masterRoster: [{ Name: 'Adi', Date: '2026-11-01', Shift: 'PM' }],
      people: directoryPeople,
      teamMembers: legacyTeamMembers
    });

    assert.equal(result.authority, 'V2_DRAFT');
    assert.equal(result.isReadOnly, false);
    assert.equal(result.status, 'RESOLVED');
    assert.equal(result.assignments.length, 1);
    assert.equal(result.assignments[0].shiftCode, 'AM');
  });

  await t.test('4. November DRAFT with ZERO assignments -> V2_DRAFT with empty array', () => {
    const result = resolveRosterSource({
      period: '2026-11',
      lifecycleState: 'DRAFT',
      v2DraftAssignments: [],
      people: directoryPeople,
      teamMembers: legacyTeamMembers
    });

    assert.equal(result.authority, 'V2_DRAFT');
    assert.equal(result.isReadOnly, false);
    assert.equal(result.status, 'RESOLVED');
    assert.deepEqual(result.assignments, []);
  });

  await t.test('5. November DRAFT with zero assignments AND MasterRoster rows present -> still V2_DRAFT; MasterRoster ignored', () => {
    const strayMasterRoster = [
      { Name: 'Adi', Date: '2026-11-01', Shift: 'NIGHT' },
      { Name: 'Azrul', Date: '2026-11-01', Shift: 'OFF' }
    ];
    const result = resolveRosterSource({
      period: '2026-11',
      lifecycleState: 'DRAFT',
      v2DraftAssignments: [],
      masterRoster: strayMasterRoster,
      people: directoryPeople,
      teamMembers: legacyTeamMembers
    });

    assert.equal(result.authority, 'V2_DRAFT');
    assert.equal(result.isReadOnly, false);
    assert.equal(result.assignments.length, 0, 'Must NOT fall back to MasterRoster');
  });

  await t.test('6. December UNENROLLED with no V2 assignments -> V2_EMPTY_DRAFT', () => {
    const result = resolveRosterSource({
      period: '2026-12',
      lifecycleState: null,
      v2DraftAssignments: [],
      people: directoryPeople,
      teamMembers: legacyTeamMembers
    });

    assert.equal(result.authority, 'V2_EMPTY_DRAFT');
    assert.equal(result.status, 'RESOLVED');
    assert.equal(result.isReadOnly, false);
    assert.deepEqual(result.assignments, []);
  });

  await t.test('7. December UNENROLLED with stray/legacy MasterRoster rows -> still V2_EMPTY_DRAFT', () => {
    const strayDecember = [
      { Name: 'Muaz', Date: '2026-12-05', Shift: 'AM' }
    ];
    const result = resolveRosterSource({
      period: '2026-12',
      lifecycleState: 'UNENROLLED',
      masterRoster: strayDecember,
      people: directoryPeople,
      teamMembers: legacyTeamMembers
    });

    assert.equal(result.authority, 'V2_EMPTY_DRAFT');
    assert.equal(result.isReadOnly, false);
    assert.equal(result.assignments.length, 0, 'MasterRoster must be completely excluded post-cutover');
  });

  await t.test('8. Post-cutover lifecycle LOADING -> explicit resolving state, never legacy fallback', () => {
    const masterRosterRows = [
      { Name: 'Adi', Date: '2026-11-01', Shift: 'AM' }
    ];
    const result = resolveRosterSource({
      period: '2026-11',
      lifecycleState: 'LOADING',
      masterRoster: masterRosterRows,
      people: directoryPeople,
      teamMembers: legacyTeamMembers
    });

    assert.equal(result.authority, 'RESOLVING');
    assert.equal(result.status, 'LOADING');
    assert.equal(result.isReadOnly, true);
    assert.deepEqual(result.assignments, [], 'Never emit MasterRoster rows during post-cutover resolution');
  });

  await t.test('9. PUBLISHED/AMENDED use V2_CURRENT authority and editable operational state', () => {
    const currentAssignments = [
      { personId: 'd89cf180-37c8-448c-8ebc-927724e4b79c', date: '2026-11-10', shiftCode: 'PM', dutyDomain: 'MO' }
    ];
    const pubResult = resolveRosterSource({
      period: '2026-11',
      lifecycleState: 'PUBLISHED',
      v2CurrentAssignments: currentAssignments,
      people: directoryPeople,
      teamMembers: legacyTeamMembers
    });

    assert.equal(pubResult.authority, 'V2_CURRENT');
    assert.equal(pubResult.lifecycleState, 'PUBLISHED');
    assert.equal(pubResult.isReadOnly, false);
    assert.equal(pubResult.assignments[0].shiftCode, 'PM');

    const amendResult = resolveRosterSource({
      period: '2026-11',
      lifecycleState: { lifecycle: { state: 'AMENDED' } },
      v2CurrentAssignments: currentAssignments,
      people: directoryPeople,
      teamMembers: legacyTeamMembers
    });

    assert.equal(amendResult.authority, 'V2_CURRENT');
    assert.equal(amendResult.lifecycleState, 'AMENDED');
    assert.equal(amendResult.isReadOnly, false);
  });

  await t.test('10. CLOSED is strictly read-only', () => {
    const currentAssignments = [
      { personId: 'd89cf180-37c8-448c-8ebc-927724e4b79c', date: '2026-11-10', shiftCode: 'PM', dutyDomain: 'MO' }
    ];
    const closedResult = resolveRosterSource({
      period: '2026-11',
      lifecycleState: 'CLOSED',
      v2CurrentAssignments: currentAssignments,
      people: directoryPeople,
      teamMembers: legacyTeamMembers
    });

    assert.equal(closedResult.authority, 'V2_CURRENT');
    assert.equal(closedResult.lifecycleState, 'CLOSED');
    assert.equal(closedResult.isReadOnly, true);
  });

  await t.test('11. Identity mapping preserves exact 13-MO sequence and resolves aliases (Syu -> Syuhada)', () => {
    const historicalOct = [
      { Name: 'Adi', Date: '2026-10-01', Shift: 'AM' },
      { Name: 'Azrul', Date: '2026-10-01', Shift: 'AM' },
      { Name: 'Afiq', Date: '2026-10-01', Shift: 'AM' },
      { Name: 'Muaz', Date: '2026-10-01', Shift: 'AM' },
      { Name: 'Syu', Date: '2026-10-01', Shift: 'AM' }, // Alias for Syuhada
      { Name: 'Najmi', Date: '2026-10-01', Shift: 'AM' },
      { Name: 'Aiman', Date: '2026-10-01', Shift: 'AM' },
      { Name: 'Shafa', Date: '2026-10-01', Shift: 'AM' },
      { Name: 'Asyraaf', Date: '2026-10-01', Shift: 'AM' },
      { Name: 'Adli', Date: '2026-10-01', Shift: 'AM' },
      { Name: 'Iema', Date: '2026-10-01', Shift: 'AM' },
      { Name: 'Syifa', Date: '2026-10-01', Shift: 'AM' },
      { Name: 'Afif', Date: '2026-10-01', Shift: 'AM' }
    ];

    const result = normalizeLegacyMasterRoster(historicalOct, '2026-10', {
      people: directoryPeople,
      teamMembers: legacyTeamMembers,
      legacyNames
    });

    assert.equal(result.assignments.length, 13);
    assert.equal(result.diagnostics.ok, true);

    const syuAssignment = result.assignments.find(a => a.personId === 'def02516-d2b5-4d0e-87fa-f45133e08f2f');
    assert.ok(syuAssignment, 'Syuhada resolved by alias');
    assert.equal(syuAssignment.personNameSnapshot, 'Syuhada');
  });

  await t.test('12. EP is excluded from MO projection and segregated with dutyDomain: EP', () => {
    const rows = [
      { Name: 'Adi', Date: '2026-10-01', Shift: 'AM' },
      { Name: 'Dr. Iskasymar', Date: '2026-10-01', Shift: 'EP_OFFICE_HOUR' },
      { Name: 'Hafizah', Date: '2026-10-01', Shift: 'EP_ONCALL' }
    ];

    const result = normalizeLegacyMasterRoster(rows, '2026-10', {
      people: directoryPeople,
      teamMembers: legacyTeamMembers,
      legacyNames
    });

    const moRows = result.assignments.filter(a => a.dutyDomain === 'MO');
    const epRows = result.assignments.filter(a => a.dutyDomain === 'EP');

    assert.equal(moRows.length, 1);
    assert.equal(moRows[0].personNameSnapshot, 'Adi');
    assert.equal(epRows.length, 2);
    assert.equal(epRows[0].dutyDomain, 'EP');
    assert.equal(epRows[1].dutyDomain, 'EP');
  });

  await t.test('13. Ambiguous identity fails closed and records diagnostics without emitting personId=null', () => {
    const duplicatePeople = [
      ...directoryPeople,
      { PersonId: '99999999-9999-4999-8999-999999999999', CurrentDisplayName: 'Adi Conflicting', DirectoryType: 'MO', StaffId: 'A99999', LegacyNamesJson: '["Adi"]', Active: true }
    ];

    const rows = [
      { Name: 'Adi', Date: '2026-10-01', Shift: 'AM' }
    ];

    const result = normalizeLegacyMasterRoster(rows, '2026-10', {
      people: duplicatePeople,
      teamMembers: legacyTeamMembers,
      legacyNames
    });

    assert.equal(result.diagnostics.ok, false);
    assert.ok(result.diagnostics.ambiguousIdentities.length > 0);
    assert.deepEqual(
      result.diagnostics.ambiguousIdentities[0].candidatePersonIds,
      ['d89cf180-37c8-448c-8ebc-927724e4b79c', '99999999-9999-4999-8999-999999999999']
    );
    assert.equal(result.assignments.length, 0, 'Ambiguous identity must not emit an assignment row');

    // Regression: an inactive additional MO with string Active: "FALSE" must NOT cause a false ambiguity,
    // while preserving the original 13-MO projection (including Afif with Active: false).
    const peopleWithStringInactiveDuplicate = [
      ...directoryPeople,
      { PersonId: '88888888-8888-4888-8888-888888888888', CurrentDisplayName: 'Adi Historical', DirectoryType: 'MO', StaffId: 'A88888', LegacyNamesJson: '["Adi"]', Active: 'FALSE' }
    ];

    const full13Rows = legacyTeamMembers.map((m) => ({
      Name: m.name,
      Date: '2026-10-01',
      Shift: 'AM'
    }));

    const nonAmbiguousResult = normalizeLegacyMasterRoster(full13Rows, '2026-10', {
      people: peopleWithStringInactiveDuplicate,
      teamMembers: legacyTeamMembers,
      legacyNames
    });

    assert.equal(nonAmbiguousResult.diagnostics.ambiguousIdentities.length, 0, 'Inactive string Active="FALSE" must not trigger false ambiguity');
    assert.equal(nonAmbiguousResult.diagnostics.unresolvedIdentities.length, 0);
    assert.equal(nonAmbiguousResult.assignments.length, 13, 'Original 13-MO projection including Afif remains intact');
    assert.deepEqual(
      nonAmbiguousResult.assignments.map((a) => a.personNameSnapshot),
      legacyNames
    );
  });

  await t.test('14. Unsupported shift fails closed and diagnoses while preserving rawShift', () => {
    const rows = [
      { Name: 'Adi', Date: '2026-10-01', Shift: 'XYZ_INVALID_SHIFT' }
    ];

    const result = normalizeLegacyMasterRoster(rows, '2026-10', {
      people: directoryPeople,
      teamMembers: legacyTeamMembers,
      legacyNames
    });

    assert.equal(result.diagnostics.ok, false);
    assert.equal(result.diagnostics.unsupportedShifts.length, 1);
    assert.equal(result.diagnostics.unsupportedShifts[0].rawShift, 'XYZ_INVALID_SHIFT');
  });

  await t.test('15. Representative shift codes and modifiers parity', () => {
    const representativeCodes = [
      { shift: 'AM', expectedCode: 'AM', standby: false, extended: false },
      { shift: 'AMX', expectedCode: 'AM', standby: false, extended: true },
      { shift: 'PM', expectedCode: 'PM', standby: false, extended: false },
      { shift: 'PMX', expectedCode: 'PM', standby: false, extended: true },
      { shift: 'ON1', expectedCode: 'ON1', standby: false, extended: false },
      { shift: 'ON2', expectedCode: 'ON2', standby: false, extended: false },
      { shift: 'ON1-S', expectedCode: 'ON1', standby: true, extended: false },
      { shift: 'PN', expectedCode: 'PN', standby: false, extended: false },
      { shift: 'OFF', expectedCode: 'OFF', standby: false, extended: false },
      { shift: 'AL', expectedCode: 'AL', standby: false, extended: false },
      { shift: 'HKA', expectedCode: 'HKA', standby: false, extended: false },
      { shift: 'GHKA', expectedCode: 'GHKA', standby: false, extended: false },
      { shift: 'COURSE', expectedCode: 'COURSE', standby: false, extended: false }
    ];

    const rows = representativeCodes.map((item, idx) => ({
      Name: 'Adi',
      Date: `2026-10-${String(idx + 1).padStart(2, '0')}`,
      Shift: item.shift
    }));

    const result = normalizeLegacyMasterRoster(rows, '2026-10', {
      people: directoryPeople,
      teamMembers: legacyTeamMembers,
      legacyNames
    });

    assert.equal(result.assignments.length, representativeCodes.length);
    assert.equal(result.diagnostics.unsupportedShifts.length, 0);

    representativeCodes.forEach((expected, idx) => {
      const a = result.assignments[idx];
      assert.equal(a.shiftCode, expected.expectedCode, `ShiftCode mismatch for ${expected.shift}`);
      assert.equal(a.modifiers.standby, expected.standby, `Standby mismatch for ${expected.shift}`);
      assert.equal(a.modifiers.extended, expected.extended, `Extended mismatch for ${expected.shift}`);
      assert.equal(a.rawShift, expected.shift, `rawShift mismatch for ${expected.shift}`);
    });
  });

  await t.test('16. Source input arrays and objects remain completely non-mutated', () => {
    const originalRow = { Name: 'Adi', Date: '2026-10-01', Shift: 'AM' };
    const frozenRows = [Object.freeze({ ...originalRow })];
    Object.freeze(frozenRows);

    const result = normalizeLegacyMasterRoster(frozenRows, '2026-10', {
      people: directoryPeople,
      teamMembers: legacyTeamMembers,
      legacyNames
    });

    assert.equal(result.assignments.length, 1);
    assert.equal(frozenRows.length, 1);
    assert.equal(frozenRows[0].Shift, 'AM');
  });

});
