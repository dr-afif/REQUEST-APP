import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { generateBaselineManifest, computeSha256, canonicalizeCell, canonicalizeRow } from '../../scripts/phase9-production-baseline.mjs';
import { reconcileBaselines, ALL_LEGACY_TABLES } from '../../scripts/phase9-reconcile-baseline.mjs';
import { generateIdentityPlan, identityPlanToCsv, validateIdentityPlanForRelease } from '../../scripts/phase9-identity-plan.mjs';
import { parseCsvRows, validateOpeningEntitlementRows } from '../../scripts/phase9-entitlement-validator.mjs';
import { validateCutoverPeriod } from '../../scripts/phase9-cutover-validator.mjs';
import { harness, digest, currentSource, fixture } from '../phase1/apps-script-harness.mjs';
import guidance from '../../src/features/roster/guidance.js';
import protocol from '../../src/features/roster/queue/protocol.js';

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

function makePublishOp({ periodId = '2026-11', draftCells = null } = {}) {
  const opId = crypto.randomUUID();
  const cId = crypto.randomUUID();
  const tId = crypto.randomUUID();
  const cells = draftCells || {
    ['11111111-1111-4111-8111-111111111111/' + periodId + '-01']: [{ rawShift: 'AM' }]
  };
  const meaning = {
    operationId: opId,
    clientId: cId,
    tabId: tId,
    operationType: 'PERIOD_PUBLISH',
    entityKey: `period:${periodId}`,
    expectedRevision: 0,
    payload: { periodId, draftCells: cells, adminNote: 'Publish test' }
  };
  return {
    action: 'rosterv2publish',
    operationId: opId,
    clientId: cId,
    tabId: tId,
    periodId,
    expectedRevision: 0,
    draftCells: cells,
    adminNote: 'Publish test',
    payloadHash: digest(protocol.canonical(meaning))
  };
}

function makeCreditManualOp({ periodId = '2026-11' } = {}) {
  const opId = crypto.randomUUID();
  const cId = crypto.randomUUID();
  const tId = crypto.randomUUID();
  const meaning = {
    operationId: opId,
    clientId: cId,
    tabId: tId,
    operationType: 'ENTITLEMENT_CREDIT_MANUAL',
    entityKey: `period:${periodId}`,
    expectedRevision: 0,
    payload: {
      periodId,
      personId: '11111111-1111-4111-8111-111111111111',
      entitlementType: 'GOFF',
      amount: 1,
      effectiveDate: `${periodId}-01`,
      reasonCode: 'OPENING_BALANCE',
      adminNote: 'Opening credit'
    }
  };
  return {
    action: 'rosterv2entitlementcreditmanual',
    operationId: opId,
    clientId: cId,
    tabId: tId,
    periodId,
    personId: '11111111-1111-4111-8111-111111111111',
    entitlementType: 'GOFF',
    amount: 1,
    effectiveDate: `${periodId}-01`,
    reasonCode: 'OPENING_BALANCE',
    adminNote: 'Opening credit',
    expectedRevision: 0,
    payloadHash: digest(protocol.canonical(meaning))
  };
}

// ---------------------------------------------------------------------------
// 1. Checksum Canonicalization Sensitivity Tests
// ---------------------------------------------------------------------------

test('1. baseline manifest deterministic across repeated runs', () => {
  const wb = createMockWorkbook();
  const manifest1 = generateBaselineManifest(wb, { timestamp: '2026-10-12T00:00:00.000Z' });
  const manifest2 = generateBaselineManifest(wb, { timestamp: '2026-10-12T00:00:00.000Z' });

  assert.deepEqual(manifest1, manifest2);
  assert.equal(typeof manifest1.checksums.MasterRoster, 'string');
  assert.equal(manifest1.checksums.MasterRoster.length, 64);
  assert.equal(manifest1.checksums['MasterRoster:2030-06'], manifest2.checksums['MasterRoster:2030-06']);
});

test('2. checksum sensitivity: trailing whitespace changes checksum', () => {
  const wb1 = createMockWorkbook();
  const wb2 = createMockWorkbook();
  // "Dr. Alice" vs "Dr. Alice "
  wb2['MasterRoster'][1] = ['Dr. Alice ', '2030-06-15', 'AM'];

  const m1 = generateBaselineManifest(wb1);
  const m2 = generateBaselineManifest(wb2);

  assert.notEqual(
    m1.checksums.MasterRoster,
    m2.checksums.MasterRoster,
    'Trailing whitespace must produce a different checksum'
  );
  assert.notEqual(
    m1.checksums['MasterRoster:2030-06'],
    m2.checksums['MasterRoster:2030-06'],
    'Monthly checksum must differ on trailing whitespace'
  );
});

test('3. checksum sensitivity: leading whitespace changes checksum', () => {
  const wb1 = createMockWorkbook();
  const wb2 = createMockWorkbook();
  // "AM" vs " AM"
  wb2['MasterRoster'][1] = ['Dr. Alice', '2030-06-15', ' AM'];

  const m1 = generateBaselineManifest(wb1);
  const m2 = generateBaselineManifest(wb2);

  assert.notEqual(
    m1.checksums.MasterRoster,
    m2.checksums.MasterRoster,
    'Leading whitespace must produce a different checksum'
  );
});

test('4. checksum sensitivity: row reordering changes checksum', () => {
  const wb1 = createMockWorkbook();
  const wb2 = createMockWorkbook();
  // Swap row 1 and row 2
  const temp = wb2['MasterRoster'][1];
  wb2['MasterRoster'][1] = wb2['MasterRoster'][2];
  wb2['MasterRoster'][2] = temp;

  const m1 = generateBaselineManifest(wb1);
  const m2 = generateBaselineManifest(wb2);

  assert.notEqual(
    m1.checksums.MasterRoster,
    m2.checksums.MasterRoster,
    'Row reordering must produce a different checksum'
  );
});

test('5. checksum sensitivity: blank-row removal changes checksum', () => {
  const wbWithBlank = createMockWorkbook();
  wbWithBlank['MasterRoster'].push(['', '', '']);
  const wbWithoutBlank = createMockWorkbook();

  const mBlank = generateBaselineManifest(wbWithBlank);
  const mNormal = generateBaselineManifest(wbWithoutBlank);

  assert.notEqual(
    mBlank.checksums.MasterRoster,
    mNormal.checksums.MasterRoster,
    'Blank row presence/removal must change checksum'
  );
  assert.equal(mBlank.masterRoster.blankOrUnparseableCount, 1);
  assert.equal(mNormal.masterRoster.blankOrUnparseableCount, 0);
});

test('6. checksum sensitivity: unknown columns affect checksum', () => {
  const wbStandard = createMockWorkbook();
  const wbExtraCol = createMockWorkbook();
  wbExtraCol['Requests'][0].push('CustomHospitalTrackingId');
  wbExtraCol['Requests'].slice(1).forEach((row, i) => row.push(`TRACK-${i + 1}`));

  const mStd = generateBaselineManifest(wbStandard);
  const mExtra = generateBaselineManifest(wbExtraCol);

  assert.notEqual(mStd.checksums.Requests, mExtra.checksums.Requests);
});

test('7. baseline report contains required sheet counts', () => {
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

// ---------------------------------------------------------------------------
// 2. Reconciliation & TeamMembers Protection Tests
// ---------------------------------------------------------------------------

test('8. reconciliation: TeamMembers mutation causes UNEXPECTED_CHANGE and blocks progression', () => {
  const wbPre = createMockWorkbook();
  const wbPost = createMockWorkbook();
  // Mutate doctor record in TeamMembers
  wbPost['TeamMembers'][1] = ['Dr. Alice', 'Alice Modified', '012-9999999', true, 'MO-101', 'alice@hospital.gov.my'];

  const preManifest = generateBaselineManifest(wbPre);
  const postManifest = generateBaselineManifest(wbPost);

  const result = reconcileBaselines(preManifest, postManifest, { stage: 'STAGE_C_SCHEMA' });

  assert.equal(result.status, 'BLOCKER');
  assert.equal(result.canProceed, false);
  assert.ok(result.categories.UNEXPECTED_CHANGE.some(c => c.item === 'TeamMembers'));
  assert.ok(result.errors.some(e => e.includes('TeamMembers mutated unexpectedly')));
});

test('9. reconciliation: all 9 core legacy tables are classified in reconciliation', () => {
  const wb = createMockWorkbook();
  const pre = generateBaselineManifest(wb);
  const post = generateBaselineManifest(wb);

  const result = reconcileBaselines(pre, post, { stage: 'STAGE_C_SCHEMA' });
  assert.equal(result.status, 'PASS');

  const checkedSheets = [
    ...result.categories.MUST_BE_IDENTICAL.map(c => c.item),
    ...result.categories.NOT_APPLICABLE.map(c => c.item)
  ];

  ALL_LEGACY_TABLES.forEach(sheet => {
    assert.ok(checkedSheets.includes(sheet), `Expected legacy table ${sheet} to be classified in reconciliation`);
  });
});

test('10. reconciliation: historical month unexpected mutation blocks progression', () => {
  const wbPre = createMockWorkbook();
  const wbPost = createMockWorkbook();
  // Mutate historical 2030-06 month
  wbPost['MasterRoster'][1] = ['Dr. Alice', '2030-06-15', 'PM'];

  const preManifest = generateBaselineManifest(wbPre);
  const postManifest = generateBaselineManifest(wbPost);

  const result = reconcileBaselines(preManifest, postManifest, {
    stage: 'STAGE_E_PUBLISH',
    targetPeriod: '2030-07'
  });

  assert.equal(result.status, 'BLOCKER');
  assert.equal(result.canProceed, false);
  assert.ok(result.errors.some(e => e.includes('2030-06 mutated unexpectedly')));
});

test('11. reconciliation: target-month-only expected change passes', () => {
  const wbPre = createMockWorkbook();
  const wbPost = createMockWorkbook();
  // Modify ONLY the target period 2030-07
  wbPost['MasterRoster'][3] = ['Dr. Bob', '2030-07-01', 'PM'];

  const preManifest = generateBaselineManifest(wbPre);
  const postManifest = generateBaselineManifest(wbPost);

  const result = reconcileBaselines(preManifest, postManifest, {
    stage: 'STAGE_E_PUBLISH',
    targetPeriod: '2030-07'
  });

  assert.equal(result.status, 'PASS');
  assert.equal(result.canProceed, true);
  assert.equal(result.summary.unexpectedChangeCount, 0);
  assert.ok(result.categories.EXPECTED_CHANGE.some(c => c.item === 'MasterRoster:2030-07'));
});

// ---------------------------------------------------------------------------
// 3. Identity Planning & Blocker Tests
// ---------------------------------------------------------------------------

test('12. identity plan export deterministic', () => {
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

test('13. identity: AMBIGUOUS blocks release', () => {
  const wb = createMockWorkbook();
  wb['TeamMembers'].push(['Dr. Imposter', 'Imposter Smith', '012-9999999', true, 'MO-101', 'imposter@hospital.gov.my']);

  const plan = generateIdentityPlan({ workbookInput: wb });
  const validation = validateIdentityPlanForRelease(plan);

  assert.equal(plan.summary.ambiguous, 2);
  assert.equal(validation.canProceed, false);
  assert.ok(validation.blockers.some(b => b.includes('AMBIGUOUS count is 2')));
});

test('14. identity: MISSING_STABLE_ID blocks release', () => {
  const wb = createMockWorkbook();
  wb['TeamMembers'].push(['Dr. Unknown', 'Unknown Staff', '012-9999999', true, '', '']);

  const plan = generateIdentityPlan({ workbookInput: wb });
  const validation = validateIdentityPlanForRelease(plan);

  assert.equal(plan.summary.missingStableId, 1);
  assert.equal(validation.canProceed, false);
  assert.ok(validation.blockers.some(b => b.includes('MISSING_STABLE_ID count is 1')));
});

test('15. identity: approved manual mapping resolves blocker', () => {
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

// ---------------------------------------------------------------------------
// 4. Entitlement Import Tests
// ---------------------------------------------------------------------------

test('16. entitlement: EP cannot enter entitlement import', () => {
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

test('17. entitlement: invalid entitlement type blocked', () => {
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

test('18. entitlement: unapproved opening balance blocked', () => {
  const rows = [
    {
      PersonId: '11111111-1111-4111-8111-111111111111',
      DisplayNameForReview: 'Dr. Alice',
      EntitlementType: 'GOFF',
      Amount: '1',
      EffectiveDate: '2026-11-01',
      ReasonCode: 'OPENING_BALANCE',
      ReviewedBy: '',
      Approved: 'false'
    }
  ];

  const validation = validateOpeningEntitlementRows(rows);
  assert.equal(validation.isValid, false);
  assert.ok(validation.errors.some(e => e.includes('is not approved')));
  assert.ok(validation.errors.some(e => e.includes('Missing ReviewedBy')));
});

// ---------------------------------------------------------------------------
// 5. Cutover Validator & OffPolicy Safeguard Tests
// ---------------------------------------------------------------------------

test('19. CUTOVER_PERIOD format validation', () => {
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

test('20. duplicate/enrolled period validation', () => {
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

test('21. missing shift semantics blocks cutover', () => {
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

test('22. production safeguard: example OffPolicy fixture cannot pass cutover validation by itself', () => {
  const refSeed = JSON.parse(fs.readFileSync('config/phase9-reference-seed.json', 'utf8'));
  const examplePolicy = refSeed.offPolicies.testExample;
  assert.equal(examplePolicy.exampleOnly, true);

  const res = validateCutoverPeriod({
    periodId: '2026-11',
    offPolicies: [examplePolicy]
  });

  assert.equal(res.isValid, false);
  assert.ok(res.errors.some(e => e.includes('exampleOnly/doNotUseInProduction')));
});

test('23. missing OffPolicy coverage blocks cutover', () => {
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
  assert.ok(resLatePolicy.errors.some(e => e.includes('No approved production OffPolicy with EffectiveMonday <=')));
});

// ---------------------------------------------------------------------------
// 6. Feature-Flag Matrix & Tier 1 Rollback Safety Tests
// ---------------------------------------------------------------------------

test('24. Stage B feature flags: all 8 V2 switches disabled and legacy upload enabled', () => {
  const refSeed = JSON.parse(fs.readFileSync('config/phase9-reference-seed.json', 'utf8'));
  const flags = refSeed.settings.flags;

  assert.equal(flags.roster_workspace_v2_enabled.stageB_initial, 'false');
  assert.equal(flags.roster_v2_read_enabled.stageB_initial, 'false');
  assert.equal(flags.roster_v2_write_enabled.stageB_initial, 'false');
  assert.equal(flags.shift_semantics_v2_enabled.stageB_initial, 'false');
  assert.equal(flags.weekly_off_guidance_enabled.stageB_initial, 'false');
  assert.equal(flags.night_safety_guidance_enabled.stageB_initial, 'false');
  assert.equal(flags.goff_ledger_enabled.stageB_initial, 'false');
  assert.equal(flags.write_queue_v2_enabled.stageB_initial, 'false');
  assert.equal(flags.legacy_upload_enabled.stageB_initial, 'true');
});

test('25. Tier 1 rollback matrix: restores safest baseline state with all V2 switches false', () => {
  const refSeed = JSON.parse(fs.readFileSync('config/phase9-reference-seed.json', 'utf8'));
  const flags = refSeed.settings.flags;

  assert.equal(flags.roster_workspace_v2_enabled.tier1_rollback, 'false');
  assert.equal(flags.roster_v2_read_enabled.tier1_rollback, 'false');
  assert.equal(flags.roster_v2_write_enabled.tier1_rollback, 'false');
  assert.equal(flags.shift_semantics_v2_enabled.tier1_rollback, 'false');
  assert.equal(flags.weekly_off_guidance_enabled.tier1_rollback, 'false');
  assert.equal(flags.night_safety_guidance_enabled.tier1_rollback, 'false');
  assert.equal(flags.goff_ledger_enabled.tier1_rollback, 'false');
  assert.equal(flags.write_queue_v2_enabled.tier1_rollback, 'false');
  assert.equal(flags.legacy_upload_enabled.tier1_rollback, 'true');
});

test('26. Tier 1 rollback: preserves existing V2 audit and lifecycle rows while disabling endpoints', () => {
  const h = setupHarness();
  h.context.rosterProvisionAllSchemas_();

  // Enable temporary init flags
  h.grids.Settings.push(
    ['roster_workspace_v2_enabled', 'false'],
    ['roster_v2_write_enabled', 'true'],
    ['roster_v2_read_enabled', 'true'],
    ['shift_semantics_v2_enabled', 'true'],
    ['weekly_off_guidance_enabled', 'true'],
    ['night_safety_guidance_enabled', 'true'],
    ['goff_ledger_enabled', 'true'],
    ['write_queue_v2_enabled', 'false'],
    ['legacy_upload_enabled', 'true']
  );

  // Seed reference data and publish
  h.grids.ShiftSemantics.push(['AM', 1, 'MO', true, 'INCREMENT', 'AM', false, false, true, '[]', '[]']);
  h.grids.OffPolicies.push([
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'A', '2026-10-26', 1,
    guidance.policyRuleJson('A'), true, 'Policy A', 1, 'op-1', '2026-10-01T00:00:00Z', 'admin@example.invalid'
  ]);
  h.grids.RosterPeople.push([
    '11111111-1111-4111-8111-111111111111', 'MO', 'Dr. Alice', '[]', true, '2026-10-01T00:00:00Z', '2026-10-01T00:00:00Z'
  ]);
  h.grids.RosterPeriods.push([
    '2026-11', 'DRAFT', 0, 0, '', '', '', '', '', '', 2, '', '2026-10-01T00:00:00Z'
  ]);

  const pubOp = makePublishOp({ periodId: '2026-11' });
  const pubRes = h.post(pubOp);
  assert.equal(pubRes.ok, true);

  // Record table sizes before rollback
  const periodsCountBefore = h.grids.RosterPeriods.length;
  const assignmentsCountBefore = h.grids.RosterAssignments.length;
  const offSnapshotsCountBefore = h.grids.WeeklyOffSnapshots.length;
  const opLogCountBefore = h.grids.OperationLog.length;

  // Apply Tier 1 rollback flags (all 8 V2 flags false, legacy upload true)
  h.grids.Settings.push(
    ['roster_workspace_v2_enabled', 'false'],
    ['roster_v2_read_enabled', 'false'],
    ['roster_v2_write_enabled', 'false'],
    ['shift_semantics_v2_enabled', 'false'],
    ['weekly_off_guidance_enabled', 'false'],
    ['night_safety_guidance_enabled', 'false'],
    ['goff_ledger_enabled', 'false'],
    ['write_queue_v2_enabled', 'false'],
    ['legacy_upload_enabled', 'true']
  );

  // 1. Legacy endpoints remain functional
  const reqs = h.get('getRequests');
  assert.ok(Array.isArray(reqs));
  const leave = h.get('getLeaveApplications');
  assert.ok(Array.isArray(leave));

  // 2. V2 mutations fail closed
  const blockedPub = h.post(makePublishOp({ periodId: '2026-12' }));
  assert.equal(blockedPub.ok, false);
  assert.equal(blockedPub.error.code, 'FEATURE_DISABLED');

  const blockedCredit = h.post(makeCreditManualOp({ periodId: '2026-11' }));
  assert.equal(blockedCredit.ok, false);
  assert.equal(blockedCredit.error.code, 'FEATURE_DISABLED');

  // 3. Existing V2 rows remain physically preserved and untouched
  assert.equal(h.grids.RosterPeriods.length, periodsCountBefore);
  assert.equal(h.grids.RosterAssignments.length, assignmentsCountBefore);
  assert.equal(h.grids.WeeklyOffSnapshots.length, offSnapshotsCountBefore);
  assert.equal(h.grids.OperationLog.length, opLogCountBefore);
});

// ---------------------------------------------------------------------------
// 7. Release Manifest References & Non-Mutation Tests
// ---------------------------------------------------------------------------

test('27. release manifest distinguishes certified checkpoint from release package checkpoint', () => {
  const manifestContent = fs.readFileSync('docs/MAJOR_UPDATE_PHASE_9_RELEASE_MANIFEST.md', 'utf8');

  assert.ok(manifestContent.includes('feature/phase-9-cutover'));
  assert.ok(manifestContent.includes('e6970ad6dd7d2afef0130cc9bb1de65be33f2205'), 'Contains certified runtime checkpoint');
  assert.ok(manifestContent.includes('5ba7441a0cc1c6a2248834d164bcac56efbe34f7'), 'Contains release package source checkpoint');
  assert.ok(manifestContent.includes('17712a4f7e177771ff3cf44d02d7ba570f567d21'), 'Contains production main baseline SHA');
  assert.ok(manifestContent.includes('4ec7843f992fa0e05540274085a83464470f262e'), 'Contains production gh-pages baseline SHA');
  assert.ok(manifestContent.includes('b97f903155ef69bb72f9fcfbb38d57050c5fbe7b02c57424a9d5605669a98b47'), 'Contains appscript bundle SHA-256');
  assert.ok(manifestContent.includes('RosterPeople'));
  assert.ok(manifestContent.includes('RosterEntitlementTransactions'));
  assert.ok(manifestContent.includes('Tier 1'));
  assert.ok(manifestContent.includes('Tier 2'));
  assert.ok(manifestContent.includes('Tier 3'));
});

test('28. baseline tools perform no mutation of input fixtures', () => {
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
