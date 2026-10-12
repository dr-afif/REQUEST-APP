import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { generateBaselineManifest, computeSha256 } from '../../scripts/phase9-production-baseline.mjs';
import { reconcileBaselines } from '../../scripts/phase9-reconcile-baseline.mjs';
import { generateIdentityPlan, identityPlanToCsv, validateIdentityPlanForRelease } from '../../scripts/phase9-identity-plan.mjs';
import { parseCsvRows, validateOpeningEntitlementRows } from '../../scripts/phase9-entitlement-validator.mjs';
import { validateCutoverPeriod } from '../../scripts/phase9-cutover-validator.mjs';
import { fixture } from '../phase1/apps-script-harness.mjs';

function createMockWorkbook() {
  const base = structuredClone(fixture.tables);
  // Ensure TeamMembers has explicit headers and sample rows with StaffId / Email
  base['TeamMembers'] = [
    ['MemberName', 'FullName', 'Phone', 'Active', 'StaffId', 'Email'],
    ['Dr. Alice', 'Alice Smith', '012-1111111', true, 'MO-101', 'alice@hospital.gov.my'],
    ['Dr. Bob', 'Bob Jones', '012-2222222', true, 'MO-102', 'bob@hospital.gov.my'],
    ['Dr. Charlie', 'Charlie Brown', '012-3333333', false, 'MO-103', 'charlie@hospital.gov.my']
  ];
  base['EmergencyPhysicians'] = [
    ['MemberName', 'FullName', 'Phone', 'Active', 'StaffId', 'Email'],
    ['Dr. EP Chong', 'Chong Wei', '012-4444444', true, 'EP-201', 'chong@hospital.gov.my']
  ];
  base['MasterRoster'] = [
    ['Name', 'Date', 'Shift'],
    ['Dr. Alice', '2030-06-15', 'AM'],
    ['Dr. Alice', '2030-06-16', 'PM'],
    ['Dr. Bob', '2030-07-01', 'AM'],
    ['Dr. Bob', '2030-07-02', 'PM']
  ];
  return base;
}

test('1. baseline manifest deterministic', () => {
  const wb = createMockWorkbook();
  const manifest1 = generateBaselineManifest(wb, { timestamp: '2026-10-12T00:00:00.000Z' });
  const manifest2 = generateBaselineManifest(wb, { timestamp: '2026-10-12T00:00:00.000Z' });

  assert.deepEqual(manifest1, manifest2);
  assert.equal(typeof manifest1.checksums.MasterRoster, 'string');
  assert.equal(manifest1.checksums.MasterRoster.length, 64);
  assert.equal(manifest1.checksums['MasterRoster:2030-06'], manifest2.checksums['MasterRoster:2030-06']);
});

test('2. baseline report contains required sheet counts', () => {
  const wb = createMockWorkbook();
  const manifest = generateBaselineManifest(wb);

  assert.equal(manifest.masterRoster.totalDataRowCount, 4);
  assert.equal(manifest.masterRoster.monthCounts['2030-06'], 2);
  assert.equal(manifest.masterRoster.monthCounts['2030-07'], 2);
  assert.equal(manifest.identityMetrics.teamMembers.total, 3);
  assert.equal(manifest.identityMetrics.teamMembers.active, 2);
  assert.equal(manifest.identityMetrics.teamMembers.inactive, 1);
  assert.equal(manifest.identityMetrics.emergencyPhysicians.total, 1);
  assert.equal(manifest.identityMetrics.staffIds.missingCount, 0);
  assert.equal(manifest.identityMetrics.staffIds.duplicateCount, 0);
  assert.equal(manifest.v2Sheets.RosterPeople, 0);
  assert.ok(manifest.sheetInventory.headers.TeamMembers.includes('StaffId'));
});

test('3. monthly MasterRoster checksum grouping deterministic', () => {
  const wb = createMockWorkbook();
  const manifest = generateBaselineManifest(wb);

  const hashJune = manifest.checksums['MasterRoster:2030-06'];
  const hashJuly = manifest.checksums['MasterRoster:2030-07'];
  assert.ok(hashJune && hashJune.length === 64);
  assert.ok(hashJuly && hashJuly.length === 64);
  assert.notEqual(hashJune, hashJuly);
});

test('4. blank/unparseable rows retained in checksum', () => {
  const wbNormal = createMockWorkbook();
  const wbWithBlank = createMockWorkbook();
  wbWithBlank['MasterRoster'].push(['', '', '']); // blank row
  wbWithBlank['MasterRoster'].push(['Dr. Alice', 'INVALID_DATE', 'AM']); // unparseable row

  const mNormal = generateBaselineManifest(wbNormal);
  const mBlank = generateBaselineManifest(wbWithBlank);

  assert.notEqual(mNormal.checksums.MasterRoster, mBlank.checksums.MasterRoster);
  assert.equal(mBlank.masterRoster.blankOrUnparseableCount, 2);
  assert.ok(mBlank.checksums['MasterRoster:unparseable']);
});

test('5. unknown columns affect checksum', () => {
  const wbStandard = createMockWorkbook();
  const wbExtraCol = createMockWorkbook();
  // Append unknown column to Requests
  wbExtraCol['Requests'][0].push('CustomHospitalTrackingId');
  wbExtraCol['Requests'].slice(1).forEach((row, i) => row.push(`TRACK-${i + 1}`));

  const mStd = generateBaselineManifest(wbStandard);
  const mExtra = generateBaselineManifest(wbExtraCol);

  assert.notEqual(mStd.checksums.Requests, mExtra.checksums.Requests);
});

test('6. comparison detects unexpected historical change', () => {
  const wbPre = createMockWorkbook();
  const wbPost = createMockWorkbook();
  // Mutate historical 2030-06 month
  wbPost['MasterRoster'][1] = ['Dr. Alice', '2030-06-15', 'PM']; // Changed AM to PM

  const preManifest = generateBaselineManifest(wbPre);
  const postManifest = generateBaselineManifest(wbPost);

  const reconciliation = reconcileBaselines(preManifest, postManifest, {
    stage: 'STAGE_E_PUBLISH',
    targetPeriod: '2030-07'
  });

  assert.equal(reconciliation.status, 'BLOCKER');
  assert.equal(reconciliation.canProceed, false);
  assert.ok(reconciliation.errors.some(e => e.includes('2030-06 mutated unexpectedly')));
});

test('7. target-month-only expected change passes', () => {
  const wbPre = createMockWorkbook();
  const wbPost = createMockWorkbook();
  // Modify ONLY the target period 2030-07
  wbPost['MasterRoster'][3] = ['Dr. Bob', '2030-07-01', 'PM'];

  const preManifest = generateBaselineManifest(wbPre);
  const postManifest = generateBaselineManifest(wbPost);

  const reconciliation = reconcileBaselines(preManifest, postManifest, {
    stage: 'STAGE_E_PUBLISH',
    targetPeriod: '2030-07'
  });

  assert.equal(reconciliation.status, 'PASS');
  assert.equal(reconciliation.canProceed, true);
  assert.equal(reconciliation.summary.unexpectedChangeCount, 0);
  assert.ok(reconciliation.categories.EXPECTED_CHANGE.some(c => c.item === 'MasterRoster:2030-07'));
});

test('8. identity plan export deterministic', () => {
  const wb = createMockWorkbook();
  const plan1 = generateIdentityPlan({ workbookInput: wb });
  const plan2 = generateIdentityPlan({ workbookInput: wb });

  assert.deepEqual(plan1.summary, plan2.summary);
  assert.equal(plan1.summary.create, 3);
  assert.equal(plan1.summary.inactive, 1);
  assert.equal(plan1.summary.ambiguous, 0);
  assert.equal(plan1.summary.missingStableId, 0);

  const csv = identityPlanToCsv(plan1.plans);
  assert.ok(csv.includes('MO,Dr. Alice,MO-101,alice@hospital.gov.my'));
  assert.ok(csv.includes('EP,Dr. EP Chong,EP-201,chong@hospital.gov.my'));
});

test('9. AMBIGUOUS blocks release', () => {
  const wb = createMockWorkbook();
  // Introduce duplicate StaffId in MO
  wb['TeamMembers'].push(['Dr. Imposter', 'Imposter Smith', '012-9999999', true, 'MO-101', 'imposter@hospital.gov.my']);

  const plan = generateIdentityPlan({ workbookInput: wb });
  const validation = validateIdentityPlanForRelease(plan);

  assert.equal(plan.summary.ambiguous, 2);
  assert.equal(validation.canProceed, false);
  assert.ok(validation.blockers.some(b => b.includes('AMBIGUOUS count is 2')));
});

test('10. MISSING_STABLE_ID blocks release', () => {
  const wb = createMockWorkbook();
  // Introduce staff with neither staffId nor valid email
  wb['TeamMembers'].push(['Dr. Unknown', 'Unknown Staff', '012-9999999', true, '', '']);

  const plan = generateIdentityPlan({ workbookInput: wb });
  const validation = validateIdentityPlanForRelease(plan);

  assert.equal(plan.summary.missingStableId, 1);
  assert.equal(validation.canProceed, false);
  assert.ok(validation.blockers.some(b => b.includes('MISSING_STABLE_ID count is 1')));
});

test('11. approved manual mapping resolves blocker', () => {
  const wb = createMockWorkbook();
  wb['TeamMembers'].push(['Dr. Unknown', 'Unknown Staff', '012-9999999', true, '', '']);

  const manualMappings = [
    {
      memberName: 'Dr. Unknown',
      directoryType: 'MO',
      staffId: 'MO-999',
      approved: true,
      notes: 'HR manual verification #54321'
    }
  ];

  const plan = generateIdentityPlan({ workbookInput: wb, manualMappings });
  const validation = validateIdentityPlanForRelease(plan);

  assert.equal(plan.summary.missingStableId, 0);
  assert.equal(plan.summary.ambiguous, 0);
  assert.equal(validation.canProceed, true);
  assert.equal(validation.blockers.length, 0);
});

test('12. EP cannot enter entitlement import', () => {
  const epPersonId = '44444444-4444-4444-8444-444444444444';
  const rows = [
    {
      PersonId: epPersonId,
      DisplayNameForReview: 'Dr. EP Chong',
      EntitlementType: 'GOFF',
      Amount: '1',
      EffectiveDate: '2026-11-01',
      ReasonCode: 'OPENING_BALANCE',
      ReviewedBy: 'Dr. HOD',
      Approved: 'true'
    }
  ];

  const validation = validateOpeningEntitlementRows(rows, {
    epPersonIds: new Set([epPersonId])
  });

  assert.equal(validation.isValid, false);
  assert.ok(validation.errors.some(e => e.includes('EP staff are strictly excluded')));
});

test('13. invalid entitlement type blocked', () => {
  const rows = [
    {
      PersonId: '11111111-1111-4111-8111-111111111111',
      DisplayNameForReview: 'Dr. Alice',
      EntitlementType: 'ANNUAL_LEAVE',
      Amount: '1',
      EffectiveDate: '2026-11-01',
      ReasonCode: 'OPENING_BALANCE',
      ReviewedBy: 'Dr. HOD',
      Approved: 'true'
    }
  ];

  const validation = validateOpeningEntitlementRows(rows);
  assert.equal(validation.isValid, false);
  assert.ok(validation.errors.some(e => e.includes('Invalid EntitlementType')));
});

test('14. unapproved opening balance blocked', () => {
  const rows = [
    {
      PersonId: '11111111-1111-4111-8111-111111111111',
      DisplayNameForReview: 'Dr. Alice',
      EntitlementType: 'GOFF',
      Amount: '1',
      EffectiveDate: '2026-11-01',
      ReasonCode: 'OPENING_BALANCE',
      ReviewedBy: '', // Missing reviewer
      Approved: 'false'
    }
  ];

  const validation = validateOpeningEntitlementRows(rows);
  assert.equal(validation.isValid, false);
  assert.ok(validation.errors.some(e => e.includes('is not approved')));
  assert.ok(validation.errors.some(e => e.includes('Missing ReviewedBy')));
});

test('15. CUTOVER_PERIOD validation', () => {
  const invalid1 = validateCutoverPeriod({ periodId: '2026/11' });
  const invalid2 = validateCutoverPeriod({ periodId: '2026-13' });
  const invalid3 = validateCutoverPeriod({ periodId: 'invalid' });
  assert.equal(invalid1.isValid, false);
  assert.equal(invalid2.isValid, false);
  assert.equal(invalid3.isValid, false);

  const valid = validateCutoverPeriod({
    periodId: '2026-11',
    offPolicies: [{ PolicyCode: 'A', EffectiveMonday: '2026-10-26', Active: true }]
  });
  assert.equal(valid.isValid, true);
});

test('16. duplicate/enrolled period validation', () => {
  const resDuplicate = validateCutoverPeriod({
    periodId: '2026-11',
    enrolledPeriods: ['2026-11'],
    resume: false
  });
  assert.equal(resDuplicate.isValid, false);
  assert.ok(resDuplicate.errors.some(e => e.includes('already enrolled')));

  const resResume = validateCutoverPeriod({
    periodId: '2026-11',
    enrolledPeriods: ['2026-11'],
    offPolicies: [{ PolicyCode: 'A', EffectiveMonday: '2026-10-26', Active: true }],
    resume: true
  });
  assert.equal(resResume.isValid, true);
});

test('17. missing shift semantics blocks cutover', () => {
  const res = validateCutoverPeriod({
    periodId: '2026-11',
    offPolicies: [{ PolicyCode: 'A', EffectiveMonday: '2026-10-26', Active: true }],
    rosterPeople: ['11111111-1111-4111-8111-111111111111'],
    shiftSemantics: ['AM', 'PM'],
    draftCells: {
      '11111111-1111-4111-8111-111111111111/2026-11-01': [{ rawShift: 'UNKNOWN_SHIFT' }]
    }
  });

  assert.equal(res.isValid, false);
  assert.ok(res.errors.some(e => e.includes('Shift code "UNKNOWN_SHIFT" has no registered entry')));
});

test('18. missing OffPolicy coverage blocks cutover', () => {
  const resNoPolicy = validateCutoverPeriod({
    periodId: '2026-11',
    offPolicies: []
  });
  assert.equal(resNoPolicy.isValid, false);
  assert.ok(resNoPolicy.errors.some(e => e.includes('No active OffPolicies found')));

  // Ineffective policy date: policy begins after cutover period mondays
  const resLatePolicy = validateCutoverPeriod({
    periodId: '2026-11',
    offPolicies: [{ PolicyCode: 'A', EffectiveMonday: '2026-12-01', Active: true }]
  });
  assert.equal(resLatePolicy.isValid, false);
  assert.ok(resLatePolicy.errors.some(e => e.includes('No active OffPolicy with EffectiveMonday <=')));
});

test('19. feature-flag transition matrix valid', () => {
  const refSeed = JSON.parse(fs.readFileSync('config/phase9-reference-seed.json', 'utf8'));
  const flags = refSeed.settings.flags;

  const expectedFlags = [
    'roster_workspace_v2_enabled',
    'roster_v2_read_enabled',
    'roster_v2_write_enabled',
    'shift_semantics_v2_enabled',
    'weekly_off_guidance_enabled',
    'night_safety_guidance_enabled',
    'goff_ledger_enabled',
    'write_queue_v2_enabled',
    'legacy_upload_enabled'
  ];

  expectedFlags.forEach(f => {
    assert.ok(flags[f], `Missing flag ${f} in config/phase9-reference-seed.json`);
    assert.ok('stageB_initial' in flags[f]);
    assert.ok('stageE_hidden_init' in flags[f]);
    assert.ok('stageI_activation' in flags[f]);
    assert.ok('tier1_rollback' in flags[f]);
  });
});

test('20. Tier 1 rollback matrix restores legacy-compatible state', () => {
  const refSeed = JSON.parse(fs.readFileSync('config/phase9-reference-seed.json', 'utf8'));
  const flags = refSeed.settings.flags;

  assert.equal(flags.roster_workspace_v2_enabled.tier1_rollback, 'false');
  assert.equal(flags.roster_v2_write_enabled.tier1_rollback, 'false');
  assert.equal(flags.roster_v2_read_enabled.tier1_rollback, 'false');
  assert.equal(flags.legacy_upload_enabled.tier1_rollback, 'true');
});

test('21. release manifest contains required references', () => {
  const manifestContent = fs.readFileSync('docs/MAJOR_UPDATE_PHASE_9_RELEASE_MANIFEST.md', 'utf8');

  assert.ok(manifestContent.includes('feature/phase-9-cutover'));
  assert.ok(manifestContent.includes('17712a4f7e177771ff3cf44d02d7ba570f567d21'));
  assert.ok(manifestContent.includes('4ec7843f992fa0e05540274085a83464470f262e'));
  assert.ok(manifestContent.includes('b97f903155ef69bb72f9fcfbb38d57050c5fbe7b02c57424a9d5605669a98b47'));
  assert.ok(manifestContent.includes('RosterPeople'));
  assert.ok(manifestContent.includes('RosterEntitlementTransactions'));
  assert.ok(manifestContent.includes('Tier 1'));
  assert.ok(manifestContent.includes('Tier 2'));
  assert.ok(manifestContent.includes('Tier 3'));
});

test('22. baseline tools perform no mutation of input fixtures', () => {
  const original = createMockWorkbook();
  const cloneBefore = structuredClone(original);

  generateBaselineManifest(original);
  generateIdentityPlan({ workbookInput: original });
  validateCutoverPeriod({
    periodId: '2030-07',
    draftCells: { '11111111-1111-4111-8111-111111111111/2030-07-01': 'AM' }
  });

  assert.deepEqual(original, cloneBefore, 'Input workbook must not be mutated by baseline inspection tools');
});
