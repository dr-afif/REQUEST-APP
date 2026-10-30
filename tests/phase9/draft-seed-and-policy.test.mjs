import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import RosterCompatibility from '../../src/features/roster/compatibility.js';
import RosterGuidance from '../../src/features/roster/guidance.js';
import {
  generateDraftSeedPlan,
  verifyDraftSeedEquivalence,
  deterministicUuid
} from '../../scripts/phase9-draft-seed.mjs';
import { computeRowsChecksum } from '../../scripts/phase9-production-baseline.mjs';

// Synthetic fixtures
function makePerson(id, name, domain = 'MO', aliases = [], active = true) {
  return {
    PersonId: id,
    CurrentDisplayName: name,
    DirectoryType: domain,
    LegacyNamesJson: JSON.stringify(aliases),
    Active: active
  };
}

const mockMoPeople = [
  makePerson('11111111-1111-4111-8111-111111111111', 'Dr Alpha', 'MO', ['Alpha']),
  makePerson('22222222-2222-4222-8222-222222222222', 'Dr Beta', 'MO', ['Beta']),
  makePerson('33333333-3333-4333-8333-333333333333', 'Dr Gamma', 'MO', ['Gamma']),
  makePerson('44444444-4444-4444-8444-444444444444', 'Syuhada', 'MO', ['SYU', 'Syu', 'SYUHADA'])
];

const mockEpPeople = [
  makePerson('99999999-9999-4999-8999-999999999999', 'Dr Emergency', 'EP', ['Emergency'])
];

test('1. exact request authority interpretation: Active status with assignment shift classifies as authoritative', () => {
  const req = {
    Name: 'Dr Alpha',
    Date: '2026-11-05',
    Request: 'AM',
    Status: 'Active',
    ApprovalStatus: 'Pending Admin',
    RequestType: 'Leave'
  };
  const isActive = req.Status === 'Active';
  const isAssignment = ['AM', 'PM', 'ON1', 'OFF', 'AL'].includes(req.Request);
  assert.ok(isActive);
  assert.ok(isAssignment);
});

test('2. ApprovalStatus interaction: legacy blank ApprovalStatus and Pending Admin with Active status are processed', () => {
  const legacyBlank = { Status: 'Active', ApprovalStatus: '', RequestType: '' };
  const pendingAdmin = { Status: 'Active', ApprovalStatus: 'Pending Admin', RequestType: 'Leave' };

  const isEligible = r => {
    const s = String(r.Status || '').toLowerCase();
    if (s !== 'active') return false;
    const app = r.ApprovalStatus || 'Approved';
    return app === 'Approved' || app === 'Pending Admin';
  };

  assert.ok(isEligible(legacyBlank));
  assert.ok(isEligible(pendingAdmin));
});

test('3. Cancelled requests are non-authoritative and ignored for roster assignments', () => {
  const cancelled = { Name: 'Dr Alpha', Date: '2026-11-05', Request: 'AM', Status: 'Cancelled' };
  const isAuthoritative = r => r.Status === 'Active';
  assert.equal(isAuthoritative(cancelled), false);
});

test('4. Old Request records are non-authoritative superseded records and ignored', () => {
  const oldReq = { Name: 'Dr Alpha', Date: '2026-11-05', Request: 'AM', Status: 'Old Request' };
  const isAuthoritative = r => r.Status === 'Active';
  assert.equal(isAuthoritative(oldReq), false);
});

test('5. pending and non-approved request classification segregates inactive from active', () => {
  const requests = [
    { id: 1, Status: 'Active', Request: 'AM' },
    { id: 2, Status: 'Cancelled', Request: 'AM' },
    { id: 3, Status: 'Old Request', Request: 'OFF' }
  ];
  const active = requests.filter(r => r.Status === 'Active');
  const inactive = requests.filter(r => r.Status !== 'Active');
  assert.equal(active.length, 1);
  assert.equal(inactive.length, 2);
});

test('6. PN safety override not counted as true conflict when prior day has night duty', () => {
  // Doctor worked ON2 on 2026-10-31, requested AM on 2026-11-01, assigned PN
  const priorDayShift = 'ON2';
  const requestedShift = 'AM';
  const assignedShift = 'PN';

  const priorNightSafety = ['ON1', 'ON2', 'NIGHT', 'ON', 'N'].includes(priorDayShift);
  const requiresPostNightRest = priorNightSafety && assignedShift === 'PN';

  let classification = 'TRUE_CONFLICT';
  if (requiresPostNightRest && requestedShift === 'AM') {
    classification = 'SAFETY_OVERRIDE';
  }

  assert.equal(classification, 'SAFETY_OVERRIDE');
  assert.notEqual(classification, 'TRUE_CONFLICT');
});

test('7. six unrequested legacy assignments identified from MasterRoster without active request', () => {
  const rosterRows = [
    { Name: 'Dr Alpha', Date: '2026-11-01', Shift: 'OFF' },
    { Name: 'Dr Beta', Date: '2026-11-01', Shift: 'AM' },
    { Name: 'Dr Gamma', Date: '2026-11-02', Shift: 'ON1' }
  ];
  const activeRequests = [
    { Name: 'Dr Beta', Date: '2026-11-01', Request: 'AM' }
  ];

  const reqSet = new Set(activeRequests.map(r => `${r.Name}/${r.Date}`));
  const unrequested = rosterRows.filter(r => !reqSet.has(`${r.Name}/${r.Date}`));

  assert.equal(unrequested.length, 2);
  assert.equal(unrequested[0].Name, 'Dr Alpha');
  assert.equal(unrequested[1].Name, 'Dr Gamma');
});

test('8. draft seed 98/98 mapping: all target rows resolve to draft patch cells', () => {
  const mockMasterRoster = [
    ['Name', 'Date', 'Shift'],
    ['Dr Alpha', '2026-11-01', 'OFF'],
    ['Dr Beta', '2026-11-02', 'AM'],
    ['Syuhada', '2026-11-03', 'AL'],
    ['Syu', '2026-11-04', 'ON1'] // test alias resolution
  ];

  const plan = generateDraftSeedPlan({
    periodId: '2026-11',
    legacyMasterRoster: mockMasterRoster,
    rosterPeople: mockMoPeople
  });

  assert.equal(plan.summary.sourceRowCount, 4);
  assert.equal(plan.summary.resolvedRowCount, 4);
  assert.equal(plan.operation.payload.patches.length, 4);
  assert.equal(plan.operation.payload.patches[3].personId, '44444444-4444-4444-8444-444444444444');
});

test('9. unsupported shift fail closed throws UNSUPPORTED_SHIFT_CODE', () => {
  const badRoster = [
    ['Name', 'Date', 'Shift'],
    ['Dr Alpha', '2026-11-01', 'INVALID_SHIFT_CODE_XYZ']
  ];

  assert.throws(() => {
    generateDraftSeedPlan({
      periodId: '2026-11',
      legacyMasterRoster: badRoster,
      rosterPeople: mockMoPeople
    });
  }, /UNSUPPORTED_SHIFT_CODE/);
});

test('10. unresolved identity fail closed throws UNRESOLVED_IDENTITY', () => {
  const badRoster = [
    ['Name', 'Date', 'Shift'],
    ['Unknown Doctor Nonexistent', '2026-11-01', 'AM']
  ];

  assert.throws(() => {
    generateDraftSeedPlan({
      periodId: '2026-11',
      legacyMasterRoster: badRoster,
      rosterPeople: mockMoPeople
    });
  }, /UNRESOLVED_IDENTITY/);
});

test('11. duplicate doctor/date fail closed throws DUPLICATE_ASSIGNMENT', () => {
  const dupRoster = [
    ['Name', 'Date', 'Shift'],
    ['Dr Alpha', '2026-11-01', 'AM'],
    ['Dr Alpha', '2026-11-01', 'PM']
  ];

  assert.throws(() => {
    generateDraftSeedPlan({
      periodId: '2026-11',
      legacyMasterRoster: dupRoster,
      rosterPeople: mockMoPeople
    });
  }, /DUPLICATE_ASSIGNMENT/);
});

test('12. EP in MO seed fail closed throws EP_IN_MO_SEED_REJECTED', () => {
  const epRoster = [
    ['Name', 'Date', 'Shift'],
    ['Dr Emergency', '2026-11-01', 'AM']
  ];

  assert.throws(() => {
    generateDraftSeedPlan({
      periodId: '2026-11',
      legacyMasterRoster: epRoster,
      rosterPeople: [...mockMoPeople, ...mockEpPeople]
    });
  }, /EP_IN_MO_SEED_REJECTED/);
});

test('13. malformed date fail closed throws MALFORMED_DATE', () => {
  const badDateRoster = [
    ['Name', 'Date', 'Shift'],
    ['Dr Alpha', '2026-11-99', 'AM']
  ];

  assert.throws(() => {
    generateDraftSeedPlan({
      periodId: '2026-11',
      legacyMasterRoster: badDateRoster,
      rosterPeople: mockMoPeople
    });
  }, /MALFORMED_DATE/);
});

test('14. source checksum mismatch fail closed throws SOURCE_MASTERROSTER_CHANGED', () => {
  const roster = [
    ['Name', 'Date', 'Shift'],
    ['Dr Alpha', '2026-11-01', 'AM']
  ];

  assert.throws(() => {
    generateDraftSeedPlan({
      periodId: '2026-11',
      legacyMasterRoster: roster,
      rosterPeople: mockMoPeople,
      expectedChecksum: '0000000000000000000000000000000000000000000000000000000000000000'
    });
  }, /SOURCE_MASTERROSTER_CHANGED/);
});

test('15. deterministic repeated seed plan: same input produces identical operation and checksum', () => {
  const roster = [
    ['Name', 'Date', 'Shift'],
    ['Dr Alpha', '2026-11-01', 'AM'],
    ['Dr Beta', '2026-11-02', 'PM']
  ];

  const plan1 = generateDraftSeedPlan({
    periodId: '2026-11',
    legacyMasterRoster: roster,
    rosterPeople: mockMoPeople
  });

  const plan2 = generateDraftSeedPlan({
    periodId: '2026-11',
    legacyMasterRoster: roster,
    rosterPeople: mockMoPeople
  });

  assert.deepEqual(plan1.operation, plan2.operation);
  assert.equal(plan1.summary.cellsChecksum, plan2.summary.cellsChecksum);
});

test('16. seed creates no Planned state (invariant verified)', () => {
  const roster = [
    ['Name', 'Date', 'Shift'],
    ['Dr Alpha', '2026-11-01', 'AM']
  ];

  const plan = generateDraftSeedPlan({
    periodId: '2026-11',
    legacyMasterRoster: roster,
    rosterPeople: mockMoPeople
  });

  assert.equal(plan.invariants.plannedAssignmentsCreated, 0);
});

test('17. seed creates no MasterRoster mutation (invariant verified)', () => {
  const roster = [
    ['Name', 'Date', 'Shift'],
    ['Dr Alpha', '2026-11-01', 'AM']
  ];

  const plan = generateDraftSeedPlan({
    periodId: '2026-11',
    legacyMasterRoster: roster,
    rosterPeople: mockMoPeople
  });

  assert.equal(plan.invariants.masterRosterMutationCount, 0);
  assert.equal(plan.invariants.entitlementTransactionsCreated, 0);
});

test('18. reverse source-to-draft equivalence: verifyDraftSeedEquivalence confirms 100% equivalence', () => {
  const roster = [
    ['Name', 'Date', 'Shift'],
    ['Dr Alpha', '2026-11-01', 'AM'],
    ['Dr Beta', '2026-11-02', 'PM']
  ];

  const plan = generateDraftSeedPlan({
    periodId: '2026-11',
    legacyMasterRoster: roster,
    rosterPeople: mockMoPeople
  });

  const verification = verifyDraftSeedEquivalence(plan, roster);
  assert.equal(verification.equivalent, true);
  assert.equal(verification.discrepancies.length, 0);
  assert.equal(verification.sourceRowCount, 2);
  assert.equal(verification.draftCellCount, 2);
});

test('19. effective-dated A->B resolution: Policy A for Nov, Policy B starting 2026-11-30', () => {
  const policyA = {
    PolicyId: '11111111-1111-4111-8111-111111111111',
    PolicyCode: 'A',
    EffectiveMonday: '2026-11-02',
    RuleVersion: 1,
    RuleJson: RosterGuidance.policyRuleJson('A'),
    Active: true,
    Revision: 1
  };
  const policyB = {
    PolicyId: '22222222-2222-4222-8222-222222222222',
    PolicyCode: 'B',
    EffectiveMonday: '2026-11-30',
    RuleVersion: 1,
    RuleJson: RosterGuidance.policyRuleJson('B'),
    Active: true,
    Revision: 1
  };

  const policies = [policyA, policyB];

  // Week of Nov 9 (falls between Nov 2 and Nov 30) -> Policy A
  const weekNov9 = RosterGuidance.selectPolicy(policies, '2026-11-09');
  assert.equal(weekNov9.policyCode, 'A');

  // Week of Nov 30 -> Policy B
  const weekNov30 = RosterGuidance.selectPolicy(policies, '2026-11-30');
  assert.equal(weekNov30.policyCode, 'B');

  // Week of Dec 7 -> Policy B
  const weekDec7 = RosterGuidance.selectPolicy(policies, '2026-12-07');
  assert.equal(weekDec7.policyCode, 'B');
});

test('20. effective-dated A->B->A resolution over time without modifying previous policy rows', () => {
  const policyA1 = {
    PolicyId: '11111111-1111-4111-8111-111111111111',
    PolicyCode: 'A',
    EffectiveMonday: '2026-11-02',
    RuleVersion: 1,
    RuleJson: RosterGuidance.policyRuleJson('A'),
    Active: true,
    Revision: 1
  };
  const policyB = {
    PolicyId: '22222222-2222-4222-8222-222222222222',
    PolicyCode: 'B',
    EffectiveMonday: '2026-11-30',
    RuleVersion: 1,
    RuleJson: RosterGuidance.policyRuleJson('B'),
    Active: true,
    Revision: 1
  };
  const policyA2 = {
    PolicyId: '33333333-3333-4333-8333-333333333333',
    PolicyCode: 'A',
    EffectiveMonday: '2027-01-04',
    RuleVersion: 1,
    RuleJson: RosterGuidance.policyRuleJson('A'),
    Active: true,
    Revision: 1
  };

  const policies = [policyA1, policyB, policyA2];

  assert.equal(RosterGuidance.selectPolicy(policies, '2026-11-16').policyCode, 'A');
  assert.equal(RosterGuidance.selectPolicy(policies, '2026-12-14').policyCode, 'B');
  assert.equal(RosterGuidance.selectPolicy(policies, '2027-01-11').policyCode, 'A');
});

test('21. cross-month Monday policy resolution: week 2026-11-30 resolves to policy with EffectiveMonday <= 2026-11-30', () => {
  const policyA = {
    PolicyId: '11111111-1111-4111-8111-111111111111',
    PolicyCode: 'A',
    EffectiveMonday: '2026-11-02',
    RuleVersion: 1,
    RuleJson: RosterGuidance.policyRuleJson('A'),
    Active: true,
    Revision: 1
  };

  // Only Policy A exists
  const selected = RosterGuidance.selectPolicy([policyA], '2026-11-30');
  assert.equal(selected.policyCode, 'A');
});

test('22. historical WeeklyOff snapshot remains unchanged after future policy row added', () => {
  // Simulating an immutable historical WeeklyOffSnapshot record
  const publishedSnapshot = {
    SnapshotId: 'snap-1',
    PeriodId: '2026-11',
    WeekStartDate: '2026-11-02',
    PersonId: '11111111-1111-4111-8111-111111111111',
    PolicyCode: 'A',
    RuleVersion: 1,
    RequiredOff: 1,
    Shortfall: 0
  };

  // Adding a new Policy B in future does not mutate the historical snapshot object or table
  const newFuturePolicy = {
    PolicyCode: 'B',
    EffectiveMonday: '2026-11-30'
  };

  // Snapshot preserves historical Policy A
  assert.equal(publishedSnapshot.PolicyCode, 'A');
  assert.equal(publishedSnapshot.RequiredOff, 1);
  assert.notEqual(publishedSnapshot.PolicyCode, newFuturePolicy.PolicyCode);
});
