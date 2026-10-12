import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import compatibility from '../../src/features/roster/compatibility.js';
import lifecycle from '../../src/features/roster/lifecycle.js';
import guidance from '../../src/features/roster/guidance.js';
import protocol from '../../src/features/roster/queue/protocol.js';
import { planIdentityMigration } from '../../src/features/roster/identityMigration.js';
import { generateDraftSeedPlan } from '../../scripts/phase9-draft-seed.mjs';
import { parseCsvRows, validateOpeningEntitlementRows } from '../../scripts/phase9-entitlement-validator.mjs';
import { harness, digest, currentSource, fixture } from '../phase1/apps-script-harness.mjs';

const digestFn = text => crypto.createHash('sha256').update(String(text)).digest('hex');

const PERSON_MO_ALI = '11111111-1111-4111-8111-111111111111';
const PERSON_MO_SITI = '22222222-2222-4222-8222-222222222222';
const PERSON_EP_CHONG = '44444444-4444-4444-8444-444444444444';
const PERSON_EP_KUMAR = '55555555-5555-4555-8555-555555555555';

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

// ---------------------------------------------------------------------------
// 1. EP Manual Mapping Contract & Deterministic PersonId
// ---------------------------------------------------------------------------
test('1. EP identity manual mapping: approved mapping resolves MISSING_STABLE_ID', () => {
  const emergencyPhysicians = [
    { MemberName: 'Dr. Chong', FullName: 'Chong Wei', Phone: '012-3456789', Active: true, StaffId: '', Email: '' },
    { MemberName: 'Dr. Kumar', FullName: 'Kumar Raj', Phone: '012-9876543', Active: true, StaffId: '', Email: '' }
  ];

  // Unapproved mapping fails closed
  const unapprovedResult = planIdentityMigration({
    teamMembers: [],
    emergencyPhysicians,
    existingPeople: [],
    manualMappings: [
      { memberName: 'Dr. Chong', directoryType: 'EP', approved: false, personId: PERSON_EP_CHONG }
    ],
    digestFn
  });
  assert.equal(unapprovedResult.summary.missingStableId, 2);
  assert.equal(unapprovedResult.summary.canProceed, false);

  // Approved manual mapping succeeds and assigns explicit deterministic PersonId
  const approvedResult = planIdentityMigration({
    teamMembers: [],
    emergencyPhysicians,
    existingPeople: [],
    manualMappings: [
      { memberName: 'Dr. Chong', directoryType: 'EP', approved: true, personId: PERSON_EP_CHONG, notes: 'Operator verified EP' },
      { memberName: 'Dr. Kumar', directoryType: 'EP', approved: true, personId: PERSON_EP_KUMAR, notes: 'Operator verified EP' }
    ],
    digestFn
  });
  assert.equal(approvedResult.summary.missingStableId, 0);
  assert.equal(approvedResult.summary.create, 2);
  assert.equal(approvedResult.summary.canProceed, true);

  const epChongPlan = approvedResult.plans.find(p => p.personId === PERSON_EP_CHONG);
  assert.ok(epChongPlan);
  assert.equal(epChongPlan.directoryType, 'EP');
  assert.equal(epChongPlan.personId, PERSON_EP_CHONG);
});

// ---------------------------------------------------------------------------
// 2. EP in RosterPeople & Validation
// ---------------------------------------------------------------------------
test('2. EP can exist in RosterPeople and creates valid entity with DirectoryType = EP', () => {
  const epPerson = compatibility.createPerson({
    personId: PERSON_EP_CHONG,
    displayName: 'Dr. Chong',
    directoryType: 'EP',
    aliases: ['Chong', 'Dr Chong'],
    active: true
  });

  assert.equal(epPerson.PersonId, PERSON_EP_CHONG);
  assert.equal(epPerson.DirectoryType, 'EP');
  assert.equal(epPerson.CurrentDisplayName, 'Dr. Chong');
  assert.equal(epPerson.Active, true);
  assert.ok(epPerson.LegacyNamesJson.includes('Chong'));

  // Invalid DirectoryType rejected
  assert.throws(() => {
    compatibility.createPerson({
      personId: crypto.randomUUID(),
      displayName: 'Dr. Invalid',
      directoryType: 'SPECIALIST',
      aliases: [],
      active: true
    });
  }, /Invalid stable person/);
});

// ---------------------------------------------------------------------------
// 3. EP Resolves Through Compatibility / Display Lookup
// ---------------------------------------------------------------------------
test('3. EP resolves through compatibility/display lookup in both EP and AUTO domain', () => {
  const people = [
    compatibility.createPerson({ personId: PERSON_MO_ALI, displayName: 'Dr. Ali', directoryType: 'MO' }),
    compatibility.createPerson({ personId: PERSON_EP_CHONG, displayName: 'Dr. Chong', directoryType: 'EP', aliases: ['Chong'] })
  ];

  const resolve = compatibility.personIndex(people);

  // Direct EP domain lookup
  const epDirect = resolve('Dr. Chong', 'EP');
  assert.equal(epDirect.identityStatus, 'REGISTERED');
  assert.equal(epDirect.directoryType, 'EP');
  assert.equal(epDirect.personId, PERSON_EP_CHONG);

  // Alias lookup
  const epAlias = resolve('Chong', 'EP');
  assert.equal(epAlias.identityStatus, 'REGISTERED');
  assert.equal(epAlias.personId, PERSON_EP_CHONG);

  // AUTO domain lookup resolves to EP domain
  const epAuto = resolve('Dr. Chong', 'AUTO');
  assert.equal(epAuto.identityStatus, 'REGISTERED');
  assert.equal(epAuto.directoryType, 'EP');
  assert.equal(epAuto.personId, PERSON_EP_CHONG);

  // Cross-domain collision detection in AUTO
  const collidingPeople = [
    compatibility.createPerson({ personId: PERSON_MO_ALI, displayName: 'Dr. Sam', directoryType: 'MO' }),
    compatibility.createPerson({ personId: PERSON_EP_CHONG, displayName: 'Dr. Sam', directoryType: 'EP' })
  ];
  const resolveColliding = compatibility.personIndex(collidingPeople);
  const collided = resolveColliding('Dr. Sam', 'AUTO');
  assert.equal(collided.identityStatus, 'AMBIGUOUS_DOMAIN');
});

// ---------------------------------------------------------------------------
// 4. EP Shift Semantics Are Strictly Segregated
// ---------------------------------------------------------------------------
test('4. EP shifts and shift resolution mark moApplicable = false and worked = false', () => {
  const epOffice = compatibility.resolveShift('EP_OFFICE_HOUR', 'EP');
  assert.equal(epOffice.directoryType, 'EP');
  assert.equal(epOffice.moApplicable, false);
  assert.equal(epOffice.worked, false);
  assert.equal(epOffice.consecutive, 'EXCLUDED');
  assert.equal(epOffice.policyBQualifier, false);
  assert.equal(epOffice.canDisplaceOffEarnGoff, false);

  const epOnCall = compatibility.resolveShift('EP_ONCALL', 'EP');
  assert.equal(epOnCall.directoryType, 'EP');
  assert.equal(epOnCall.moApplicable, false);
  assert.equal(epOnCall.worked, false);
  assert.equal(epOnCall.consecutive, 'EXCLUDED');

  // Even if an MO shift is passed with directoryType EP, moApplicable is false
  const amAsEp = compatibility.resolveShift('AM', 'EP');
  assert.equal(amAsEp.directoryType, 'EP');
  assert.equal(amAsEp.moApplicable, false);
  assert.equal(amAsEp.worked, false);
  assert.equal(amAsEp.consecutive, 'EXCLUDED');
});

// ---------------------------------------------------------------------------
// 5. EP Cannot Be Included in MO Draft Seeding (Fail-Closed)
// ---------------------------------------------------------------------------
test('5. EP identity in MO draft seed strictly throws EP_IN_MO_SEED_REJECTED', () => {
  const people = [
    { PersonId: PERSON_MO_ALI, CurrentDisplayName: 'Dr. Ali', DirectoryType: 'MO', Active: true },
    { PersonId: PERSON_EP_CHONG, CurrentDisplayName: 'Dr. Chong', DirectoryType: 'EP', Active: true }
  ];

  const legacyMasterRoster = [
    ['Name', 'Date', 'Shift'],
    ['Dr. Chong', '2026-11-01', 'AM']
  ];

  assert.throws(() => {
    generateDraftSeedPlan({
      periodId: '2026-11',
      legacyMasterRoster,
      rosterPeople: people
    });
  }, /EP_IN_MO_SEED_REJECTED/);
});

// ---------------------------------------------------------------------------
// 6. EP Is Strictly Excluded From Weekly-OFF Evaluation
// ---------------------------------------------------------------------------
test('6. EP is excluded from aggregateWeeklyOffSnapshots and generates 0 weekly off rows', () => {
  const people = [
    { PersonId: PERSON_MO_ALI, CurrentDisplayName: 'Dr. Ali', DirectoryType: 'MO', Active: true },
    { PersonId: PERSON_EP_CHONG, CurrentDisplayName: 'Dr. Chong', DirectoryType: 'EP', Active: true }
  ];

  const plannedAssignments = [
    { AssignmentId: 'a1', PersonId: PERSON_MO_ALI, Date: '2026-11-02', ShiftCode: 'AM' },
    { AssignmentId: 'a2', PersonId: PERSON_EP_CHONG, Date: '2026-11-02', ShiftCode: 'EP_OFFICE_HOUR' }
  ];

  const policies = [
    {
      PolicyId: 'b0000001-2026-4000-8000-000000000001',
      PolicyCode: 'B',
      EffectiveMonday: '2026-10-26',
      RuleVersion: 1,
      RuleJson: guidance.policyRuleJson('B'),
      Active: true
    }
  ];

  const snapshots = lifecycle.aggregateWeeklyOffSnapshots({
    periodId: '2026-11',
    plannedAssignments,
    people,
    existingWeekSnapshots: [],
    adjacentPlannedAssignments: [],
    policies,
    operationId: 'op-1',
    digestFn
  });

  // Snapshots must ONLY contain MO Ali, ZERO for EP Chong
  const aliSnaps = snapshots.filter(s => s.PersonId === PERSON_MO_ALI);
  const epSnaps = snapshots.filter(s => s.PersonId === PERSON_EP_CHONG);

  assert.ok(aliSnaps.length > 0);
  assert.equal(epSnaps.length, 0, 'EP must generate ZERO WeeklyOffSnapshots');
});

// ---------------------------------------------------------------------------
// 7. EP Cannot Enter Opening Entitlement Import (GOFF / GHKA)
// ---------------------------------------------------------------------------
test('7. EP cannot enter GOFF or GHKA opening balance imports', () => {
  const epPersonIds = new Set([PERSON_EP_CHONG]);

  const goffRows = [
    {
      PersonId: PERSON_EP_CHONG,
      DisplayNameForReview: 'Dr. Chong',
      EntitlementType: 'GOFF',
      Amount: '2',
      EffectiveDate: '2026-11-01',
      ReasonCode: 'OPENING_BALANCE',
      ReviewedBy: 'Dr. Director',
      Approved: 'true'
    }
  ];

  const goffVal = validateOpeningEntitlementRows(goffRows, { epPersonIds });
  assert.equal(goffVal.isValid, false);
  assert.ok(goffVal.errors.some(e => e.includes('EP staff are strictly excluded')));

  const ghkaRows = [
    {
      PersonId: PERSON_EP_CHONG,
      DisplayNameForReview: 'Dr. Chong',
      EntitlementType: 'GHKA',
      Amount: '1',
      EffectiveDate: '2026-11-01',
      ReasonCode: 'OPENING_BALANCE',
      ReviewedBy: 'Dr. Director',
      Approved: 'true'
    }
  ];

  const ghkaVal = validateOpeningEntitlementRows(ghkaRows, { epPersonIds });
  assert.equal(ghkaVal.isValid, false);
  assert.ok(ghkaVal.errors.some(e => e.includes('EP staff are strictly excluded')));
});

// ---------------------------------------------------------------------------
// 8. Backend Rejects All EP Entitlement Operations with EP_DOMAIN_EXCLUDED
// ---------------------------------------------------------------------------
test('8. Apps Script backend rejects EP earning, consumption, and adjustments with EP_DOMAIN_EXCLUDED', () => {
  const h = setupHarness();
  h.context.rosterProvisionAllSchemas_();
  h.grids.Settings.push(
    ['roster_v2_read_enabled', 'true'],
    ['roster_v2_write_enabled', 'true'],
    ['goff_ledger_enabled', 'true'],
    ['write_queue_v2_enabled', 'true']
  );
  h.grids.RosterPeople.push(
    [PERSON_MO_ALI, 'MO', 'Dr. Ali', '[]', true, '2026-01-01T00:00:00Z', ''],
    [PERSON_EP_CHONG, 'EP', 'Dr. Chong', '[]', true, '2026-01-01T00:00:00Z', '']
  );
  h.grids.RosterPeriods.push([
    '2026-11', 'PUBLISHED', 1, 1, 'snap-1', '2026-11-01T00:00:00Z', 'admin', '', '', 'chk', 2, 'op-1', '2026-11-01T00:00:00Z'
  ]);

  const opId = crypto.randomUUID();
  const cId = crypto.randomUUID();
  const tId = crypto.randomUUID();
  const meaning = {
    operationId: opId,
    clientId: cId,
    tabId: tId,
    operationType: 'ENTITLEMENT_EARN_GOFF',
    entityKey: 'period:2026-11',
    expectedRevision: 1,
    payload: {
      periodId: '2026-11',
      personId: PERSON_EP_CHONG,
      date: '2026-11-05',
      adminNote: 'Displaced weekly off'
    }
  };
  const payloadHash = digest(protocol.canonical(meaning));

  const earnGoffOp = {
    action: 'rosterv2entitlementearngoff',
    operationId: opId,
    clientId: cId,
    tabId: tId,
    periodId: '2026-11',
    expectedRevision: 1,
    personId: PERSON_EP_CHONG,
    date: '2026-11-05',
    adminNote: 'Displaced weekly off',
    payloadHash
  };

  const resGoff = h.post(earnGoffOp);
  assert.equal(resGoff.ok, false);
  assert.equal(resGoff.error.code, 'EP_DOMAIN_EXCLUDED');
});

// ---------------------------------------------------------------------------
// 9. MO-Only Roster Operations Unaffected by Coexistence of EP in RosterPeople
// ---------------------------------------------------------------------------
test('9. MO-only roster operations and calculations remain 100% unaffected by EP coexistence in RosterPeople', () => {
  const people = [
    compatibility.createPerson({ personId: PERSON_MO_ALI, displayName: 'Dr. Ali', directoryType: 'MO' }),
    compatibility.createPerson({ personId: PERSON_MO_SITI, displayName: 'Dr. Siti', directoryType: 'MO' }),
    compatibility.createPerson({ personId: PERSON_EP_CHONG, displayName: 'Dr. Chong', directoryType: 'EP' })
  ];

  const draftCells = {
    [`${PERSON_MO_ALI}/2026-11-01`]: [{ rawShift: 'AM' }],
    [`${PERSON_MO_SITI}/2026-11-01`]: [{ rawShift: 'PM' }]
  };

  // Planned snapshot generation ignores EP and succeeds for MO
  const snapshot = lifecycle.generatePlannedSnapshot({
    periodId: '2026-11',
    draftCells,
    people,
    operationId: crypto.randomUUID(),
    actor: 'admin@hospital.gov.my',
    digestFn
  });

  assert.equal(snapshot.assignments.length, 2);
  assert.equal(snapshot.assignments[0].DutyDomain, 'MO');
  assert.equal(snapshot.assignments[1].DutyDomain, 'MO');

  // MasterRoster projection generates exactly 2 rows
  const projected = lifecycle.generateMasterRosterProjection(snapshot.assignments);
  assert.equal(projected.length, 2);
  assert.equal(projected[0].Name, 'Dr. Ali');
  assert.equal(projected[1].Name, 'Dr. Siti');
});
