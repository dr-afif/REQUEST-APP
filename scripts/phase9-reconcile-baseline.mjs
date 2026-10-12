import fs from 'node:fs';
import path from 'node:path';

/**
 * Phase 9 Post-Step Reconciliation Tool
 *
 * Compares a PRE baseline manifest against a POST baseline manifest across
 * explicit cutover stages to guarantee non-destructive schema evolution and
 * strict preservation invariance.
 *
 * Output Categories:
 * - MUST_BE_IDENTICAL: Legacy historical structures and untouched sheets.
 * - EXPECTED_CHANGE: Intentionally modified or seeded tables for the given stage.
 * - UNEXPECTED_CHANGE: Deviations in structures that must remain frozen (Release Blocker).
 */

function normalizeManifest(input) {
  if (!input) return {};
  if (typeof input === 'string') {
    return JSON.parse(fs.readFileSync(path.resolve(input), 'utf8'));
  }
  return input;
}

export function reconcileBaselines(preInput, postInput, options = {}) {
  const pre = normalizeManifest(preInput);
  const post = normalizeManifest(postInput);
  const stage = String(options.stage || 'GENERAL').toUpperCase();
  const targetPeriod = options.targetPeriod || null;

  const mustBeIdentical = [];
  const expectedChange = [];
  const unexpectedChange = [];
  const errors = [];

  const preChecksums = pre.checksums || {};
  const postChecksums = post.checksums || {};

  // Standard legacy sheets that should NEVER mutate during cutover stages
  const coreLegacyTables = [
    'Requests',
    'LeaveApplications',
    'EmergencyPhysicians',
    'PublicHolidays',
    'ActivityHistory'
  ];

  // 1. Audit core legacy tables
  coreLegacyTables.forEach(sheetName => {
    const preHash = preChecksums[sheetName];
    const postHash = postChecksums[sheetName];
    if (!preHash && !postHash) return; // not present

    if (preHash === postHash) {
      mustBeIdentical.push({
        item: sheetName,
        status: 'MATCH',
        checksum: postHash,
        detail: 'Checksum byte-for-byte identical'
      });
    } else {
      const err = `Core legacy sheet ${sheetName} mutated unexpectedly (pre: ${preHash?.slice(0, 10)}..., post: ${postHash?.slice(0, 10)}...)`;
      unexpectedChange.push({
        item: sheetName,
        status: 'MUTATED',
        preChecksum: preHash,
        postChecksum: postHash,
        error: err
      });
      errors.push(err);
    }
  });

  // 2. TeamMembers audit
  const preTmHash = preChecksums['TeamMembers'];
  const postTmHash = postChecksums['TeamMembers'];
  if (preTmHash === postTmHash) {
    mustBeIdentical.push({
      item: 'TeamMembers',
      status: 'MATCH',
      checksum: postTmHash,
      detail: 'TeamMembers directory preserved byte-for-byte'
    });
  } else {
    // If a stage explicitly permits TeamMembers mutation (none of the cutover stages do, RosterPeople is created instead)
    const err = `TeamMembers directory mutated unexpectedly (pre: ${preTmHash?.slice(0, 10)}..., post: ${postTmHash?.slice(0, 10)}...)`;
    unexpectedChange.push({
      item: 'TeamMembers',
      status: 'MUTATED',
      preChecksum: preTmHash,
      postChecksum: postTmHash,
      error: err
    });
    errors.push(err);
  }

  // 3. MasterRoster Monthly Isolation Audit
  const allMonths = new Set([
    ...Object.keys(pre.masterRoster?.monthCounts || {}),
    ...Object.keys(post.masterRoster?.monthCounts || {})
  ]);

  allMonths.forEach(month => {
    const monthKey = `MasterRoster:${month}`;
    const preMHash = preChecksums[monthKey];
    const postMHash = postChecksums[monthKey];
    const isTargetMonth = Boolean(targetPeriod && month === targetPeriod);

    if (isTargetMonth && (stage === 'STAGE_E_PUBLISH' || stage === 'STAGE_E_V2_PUBLISH' || stage === 'POST_CUTOVER')) {
      // In publish stage, target month projection change is EXPECTED
      expectedChange.push({
        item: monthKey,
        status: 'INTENTIONAL_UPDATE',
        preChecksum: preMHash,
        postChecksum: postMHash,
        detail: `Target cutover month ${month} updated with V2 publish projection`
      });
    } else {
      // All historical / non-target months MUST BE IDENTICAL
      if (preMHash === postMHash) {
        mustBeIdentical.push({
          item: monthKey,
          status: 'MATCH',
          checksum: postMHash,
          detail: `Historical month ${month} preserved byte-for-byte`
        });
      } else {
        const err = `Historical MasterRoster month ${month} mutated unexpectedly (pre: ${preMHash?.slice(0, 10)}..., post: ${postMHash?.slice(0, 10)}...)`;
        unexpectedChange.push({
          item: monthKey,
          status: 'MUTATED',
          preChecksum: preMHash,
          postChecksum: postMHash,
          error: err
        });
        errors.push(err);
      }
    }
  });

  // MasterRoster unparseable rows audit
  const preUnpHash = preChecksums['MasterRoster:unparseable'];
  const postUnpHash = postChecksums['MasterRoster:unparseable'];
  if (preUnpHash || postUnpHash) {
    if (preUnpHash === postUnpHash) {
      mustBeIdentical.push({
        item: 'MasterRoster:unparseable',
        status: 'MATCH',
        checksum: postUnpHash,
        detail: 'Unparseable / blank MasterRoster rows preserved byte-for-byte'
      });
    } else {
      const err = `Unparseable / blank MasterRoster rows mutated unexpectedly`;
      unexpectedChange.push({
        item: 'MasterRoster:unparseable',
        status: 'MUTATED',
        error: err
      });
      errors.push(err);
    }
  }

  // 4. V2 Sheets & Settings according to Stage
  const preV2 = pre.v2Sheets || {};
  const postV2 = post.v2Sheets || {};

  if (stage === 'STAGE_B_BACKEND') {
    // Stage B: no sheets or schemas should have changed
    Object.keys(postV2).forEach(v2Name => {
      if ((postV2[v2Name] || 0) > (preV2[v2Name] || 0)) {
        unexpectedChange.push({
          item: v2Name,
          status: 'UNEXPECTED_TABLE_GROWTH',
          error: `Table ${v2Name} unexpectedly modified during Stage B`
        });
        errors.push(`Table ${v2Name} unexpectedly modified during Stage B`);
      }
    });
  } else if (stage === 'STAGE_C_SCHEMA' || stage === 'STAGE_C_PROVISION') {
    expectedChange.push({
      item: 'Settings',
      status: 'SETTINGS_PROVISIONED',
      detail: 'Standard feature keys added'
    });
    expectedChange.push({
      item: 'V2_SCHEMAS',
      status: 'TABLES_CREATED',
      detail: 'Additive creation of 12 V2 tables with catalog seeds'
    });
  } else if (stage === 'STAGE_E_PUBLISH' || stage === 'STAGE_E_V2_PUBLISH') {
    expectedChange.push({
      item: 'RosterPeriods',
      status: 'PERIOD_ENROLLED_AND_PUBLISHED',
      detail: 'Cutover period transitioned to PUBLISHED'
    });
    expectedChange.push({
      item: 'RosterAssignments',
      status: 'PLANNED_PERSISTED',
      detail: 'Planned assignments snapshot persisted'
    });
    expectedChange.push({
      item: 'WeeklyOffSnapshots',
      status: 'OFF_EVALUATIONS_PERSISTED',
      detail: 'Weekly off evaluation snapshots persisted'
    });
  }

  const passed = unexpectedChange.length === 0 && errors.length === 0;

  return {
    stage,
    targetPeriod,
    status: passed ? 'PASS' : 'BLOCKER',
    canProceed: passed,
    summary: {
      mustBeIdenticalCount: mustBeIdentical.length,
      expectedChangeCount: expectedChange.length,
      unexpectedChangeCount: unexpectedChange.length,
      errorCount: errors.length
    },
    categories: {
      MUST_BE_IDENTICAL: mustBeIdentical,
      EXPECTED_CHANGE: expectedChange,
      UNEXPECTED_CHANGE: unexpectedChange
    },
    errors
  };
}

// CLI entry point
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'))) {
  const prePath = process.argv[2];
  const postPath = process.argv[3];
  const stage = process.argv[4] || 'STAGE_C_SCHEMA';
  const targetPeriod = process.argv[5] || null;

  if (!prePath || !postPath) {
    console.error('Usage: node scripts/phase9-reconcile-baseline.mjs <pre-manifest.json> <post-manifest.json> [stage] [targetPeriod]');
    process.exit(1);
  }

  const report = reconcileBaselines(prePath, postPath, { stage, targetPeriod });
  console.log(JSON.stringify(report, null, 2));
  if (report.status !== 'PASS') {
    process.exit(2);
  }
}
