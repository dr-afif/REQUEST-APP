import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import React from 'react';
import ReactDOMServer from 'react-dom/server';

import guidance from '../../src/features/roster/guidance.js';
import compatibility from '../../src/features/roster/compatibility.js';
import { harness, currentSource, digest } from '../phase1/apps-script-harness.mjs';
import { projectMoStaff } from '../../src/features/roster/staffProjection.js';
import * as adminAuthModule from '../../src/features/roster/auth/adminAuth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');
const req = createRequire(import.meta.url);

async function loadJsxComponent(relPath) {
  const bundleResult = await build({
    entryPoints: [path.resolve(rootDir, relPath)],
    bundle: true,
    write: false,
    format: 'cjs',
    jsx: 'automatic',
    define: { 'import.meta.env': '{}' },
    external: ['react', 'react-dom', 'react-dom/server', 'lucide-react', '../auth/adminAuth.js']
  });

  const bundledCode = bundleResult.outputFiles[0].text;
  const mod = { exports: {} };
  const customRequire = (id) => {
    if (id.includes('adminAuth')) return adminAuthModule;
    if (id === 'react') return React;
    if (id === 'react-dom/server') return ReactDOMServer;
    return req(id);
  };
  const evalFn = new Function('require', 'module', 'exports', bundledCode);
  evalFn(customRequire, mod, mod.exports);
  return mod.exports.default || mod.exports;
}

const snapshotPath = path.resolve(rootDir, '.phase9/private/snapshot-post-auth-smoke.json');
const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));

// Helper to setup harness with production settings & OffPolicies schema
function setupProductionLikeHarness(options = {}) {
  const h = harness(currentSource, {
    activeEmail: 'admin@example.invalid',
    adminEmail: 'admin@example.invalid',
    ...options
  });
  h.context.SpreadsheetApp.flush = () => {};
  h.grids.Settings.push(
    ['weekly_off_guidance_enabled', 'true'],
    ['roster_v2_write_enabled', 'true'],
    ['write_queue_v2_enabled', 'true']
  );
  const schemas = vm.runInContext('ROSTER_DRAFT_SCHEMAS', h.context);
  for (const [name, headers] of Object.entries(schemas)) {
    h.grids[name] = [[...headers]];
  }
  h.grids.OffPolicies = [[...guidance.OFF_POLICY_HEADERS]];
  return h;
}

// Helper to generate a valid OFF_POLICY_UPSERT operation
function makeOperation({ revision = 1, code = 'A', date = '2026-12-07', ...changes } = {}) {
  const op = {
    operationId: crypto.randomUUID(),
    clientId: crypto.randomUUID(),
    tabId: crypto.randomUUID(),
    operationType: 'OFF_POLICY_UPSERT',
    entityKey: 'off-policies',
    expectedRevision: revision,
    payload: {
      policyId: crypto.randomUUID(),
      policyCode: code,
      effectiveMonday: date,
      reason: 'Approved test mutation'
    },
    ...changes
  };
  op.payloadHash = digest(compatibility.canonicalJson(guidance.policyOperation(op)));
  return op;
}

const readPolicies = h => h.get('rosterv2offpolicies');
const savePolicy = (h, op) => h.post({ action: 'rosterv2offpolicy', ...op });

test('V2 UX / Phase 9 Compatibility — Slice 1.4: Provisioned OFF Policy Baseline', async (t) => {

  // Exact row from production snapshot
  const prodRow = snapshot.tables.OffPolicies.slice(1).find(r => r.some(c => c !== '' && c !== null));
  const prodHeaders = snapshot.tables.OffPolicies[0];
  const prodPolicyB = {};
  prodHeaders.forEach((h, i) => { prodPolicyB[h] = prodRow[i]; });

  await t.test('1. Production snapshot contains valid baseline Policy B with cutover-seed and no OFF_POLICY_UPSERT in OperationLog', () => {
    assert.equal(prodPolicyB.PolicyId, 'b0000001-2026-4000-8000-000000000001');
    assert.equal(prodPolicyB.PolicyCode, 'B');
    assert.equal(prodPolicyB.EffectiveMonday, '2026-10-26');
    assert.equal(prodPolicyB.RuleVersion, 1);
    assert.equal(prodPolicyB.RuleJson, guidance.policyRuleJson('B'));
    assert.equal(prodPolicyB.Active, true);
    assert.equal(prodPolicyB.Revision, 1);
    assert.equal(prodPolicyB.OperationId, 'cutover-seed');
    assert.equal(typeof prodPolicyB.CreatedAt, 'string');
    assert.equal(typeof prodPolicyB.CreatedBy, 'string');

    // Prove OperationLog has ZERO OFF_POLICY_UPSERT operations
    const opHeaders = snapshot.tables.OperationLog[0];
    const opLogs = snapshot.tables.OperationLog.slice(1)
      .filter(r => r.some(c => c !== '' && c !== null))
      .map(r => {
        const obj = {};
        opHeaders.forEach((h, i) => { obj[h] = r[i]; });
        return obj;
      });
    const policyLogs = opLogs.filter(l => l.OperationType === 'OFF_POLICY_UPSERT');
    assert.equal(policyLogs.length, 0, 'Production snapshot OperationLog has no OFF_POLICY_UPSERT rows');
  });

  await t.test('2. Backend recognizes production baseline policy safely with revision=1', () => {
    const h = setupProductionLikeHarness();
    // Insert exact production Policy B row into harness
    const rowValues = guidance.OFF_POLICY_HEADERS.map(k => prodPolicyB[k]);
    h.grids.OffPolicies.push(rowValues);

    const res = readPolicies(h);
    assert.equal(res.ok, true);
    assert.equal(res.revision, 1);
    assert.equal(res.policies.length, 1);
    assert.equal(res.policies[0].PolicyCode, 'B');
    assert.equal(res.policies[0].EffectiveMonday, '2026-10-26');
    assert.equal(res.policies[0].PolicyId, 'b0000001-2026-4000-8000-000000000001');
    assert.equal(res.policies[0].Revision, 1);
  });

  await t.test('3. Malformed baseline rows fail closed with RECOVERY_REQUIRED', () => {
    // Variations of malformed bootstrap rows:
    const variations = [
      { name: 'Invalid PolicyId (not UUID)', patch: { PolicyId: 'not-a-uuid' } },
      { name: 'Invalid PolicyCode (not A or B)', patch: { PolicyCode: 'C' } },
      { name: 'Midweek EffectiveMonday (Tuesday)', patch: { EffectiveMonday: '2026-10-27' } },
      { name: 'Non-canonical date string', patch: { EffectiveMonday: '2026-13-99' } },
      { name: 'RuleVersion not 1', patch: { RuleVersion: 2 } },
      { name: 'RuleJson mismatch', patch: { RuleJson: '{}' } },
      { name: 'Active is false', patch: { Active: false } },
      { name: 'Revision not 1', patch: { Revision: 2 } },
      { name: 'Missing CreatedAt', patch: { CreatedAt: '' } },
      { name: 'Missing CreatedBy', patch: { CreatedBy: '' } },
      { name: 'Empty Reason', patch: { Reason: '' } }
    ];

    for (const v of variations) {
      const h = setupProductionLikeHarness();
      const corrupted = { ...prodPolicyB, ...v.patch };
      h.grids.OffPolicies.push(guidance.OFF_POLICY_HEADERS.map(k => corrupted[k]));
      const res = readPolicies(h);
      assert.equal(res.ok, false, `${v.name} must fail closed`);
      assert.equal(res.error.code, 'RECOVERY_REQUIRED', `${v.name} must return RECOVERY_REQUIRED`);
    }
  });

  await t.test('4. Duplicate bootstrap rows fail closed with RECOVERY_REQUIRED', () => {
    const h = setupProductionLikeHarness();
    const rowValues = guidance.OFF_POLICY_HEADERS.map(k => prodPolicyB[k]);
    h.grids.OffPolicies.push(rowValues);
    // Duplicate bootstrap row with same OperationId
    h.grids.OffPolicies.push([...rowValues]);

    const res = readPolicies(h);
    assert.equal(res.ok, false);
    assert.equal(res.error.code, 'RECOVERY_REQUIRED');
  });

  await t.test('5. Duplicate PolicyId or EffectiveMonday in subsequent operation fails closed', () => {
    const h = setupProductionLikeHarness();
    h.grids.OffPolicies.push(guidance.OFF_POLICY_HEADERS.map(k => prodPolicyB[k]));

    // Attempt mutation reusing bootstrap EffectiveMonday (2026-10-26)
    const dupDateOp = makeOperation({ revision: 1, date: '2026-10-26' });
    const dupDateRes = savePolicy(h, dupDateOp);
    assert.equal(dupDateRes.ok, false);
    assert.equal(dupDateRes.error.code, 'VALIDATION_FAILED');

    // Attempt mutation reusing bootstrap PolicyId
    const dupIdOp = makeOperation({ revision: 1, date: '2026-12-07' });
    dupIdOp.payload.policyId = 'b0000001-2026-4000-8000-000000000001';
    dupIdOp.payloadHash = digest(compatibility.canonicalJson(guidance.policyOperation(dupIdOp)));
    const dupIdRes = savePolicy(h, dupIdOp);
    assert.equal(dupIdRes.ok, false);
    assert.equal(dupIdRes.error.code, 'VALIDATION_FAILED');
  });

  await t.test('6. Runtime state revision after bootstrap is 1 and stale expectedRevision is rejected', () => {
    const h = setupProductionLikeHarness();
    h.grids.OffPolicies.push(guidance.OFF_POLICY_HEADERS.map(k => prodPolicyB[k]));

    // Stale expectedRevision=0 when currentRevision=1 must fail with REVISION_CONFLICT
    const staleOp = makeOperation({ revision: 0, date: '2026-12-07' });
    const res = savePolicy(h, staleOp);
    assert.equal(res.ok, false);
    assert.equal(res.error.code, 'REVISION_CONFLICT');
  });

  await t.test('7. First subsequent OFF_POLICY_UPSERT chains from bootstrap revision 1 to revision 2', () => {
    const h = setupProductionLikeHarness();
    h.grids.OffPolicies.push(guidance.OFF_POLICY_HEADERS.map(k => prodPolicyB[k]));

    // First subsequent operation with expectedRevision=1
    const op = makeOperation({ revision: 1, code: 'A', date: '2026-12-07' });
    const saveRes = savePolicy(h, op);
    assert.equal(saveRes.status, 'CONFIRMED');
    assert.equal(saveRes.resultRevision, 2);

    // Read back state: revision is 2, policies has 2 rows (Policy B and Policy A)
    const readRes = readPolicies(h);
    assert.equal(readRes.ok, true);
    assert.equal(readRes.revision, 2);
    assert.equal(readRes.policies.length, 2);
    assert.equal(readRes.policies[0].PolicyCode, 'B');
    assert.equal(readRes.policies[0].EffectiveMonday, '2026-10-26');
    assert.equal(readRes.policies[0].Revision, 1);
    assert.equal(readRes.policies[1].PolicyCode, 'A');
    assert.equal(readRes.policies[1].EffectiveMonday, '2026-12-07');
    assert.equal(readRes.policies[1].Revision, 2);
  });

  await t.test('8. Subsequent replay remains strict against forged/tampered operation evidence', () => {
    const h = setupProductionLikeHarness();
    h.grids.OffPolicies.push(guidance.OFF_POLICY_HEADERS.map(k => prodPolicyB[k]));

    const op = makeOperation({ revision: 1, code: 'A', date: '2026-12-07' });
    savePolicy(h, op);

    // Tamper with the operation row's RuleJson in OffPolicies
    h.grids.OffPolicies[2][4] = '{"tampered":true}';

    const res = readPolicies(h);
    assert.equal(res.ok, false);
    assert.equal(res.error.code, 'RECOVERY_REQUIRED');
  });

  await t.test('9. All six November week starts resolve Policy B', () => {
    const novemberWeekStarts = [
      '2026-10-26',
      '2026-11-02',
      '2026-11-09',
      '2026-11-16',
      '2026-11-23',
      '2026-11-30'
    ];

    const policies = [
      {
        PolicyId: prodPolicyB.PolicyId,
        PolicyCode: prodPolicyB.PolicyCode,
        EffectiveMonday: prodPolicyB.EffectiveMonday,
        RuleVersion: 1,
        RuleJson: prodPolicyB.RuleJson,
        Active: true,
        Revision: 1
      }
    ];

    for (const weekStart of novemberWeekStarts) {
      const selected = guidance.selectPolicy(policies, weekStart);
      assert.equal(selected.policyCode, 'B', `Week ${weekStart} must resolve to Policy B`);
      assert.equal(selected.effectiveMonday, '2026-10-26');
      assert.equal(selected.revision, 1);
    }
  });

  await t.test('10. Zero OFF_POLICY_NOT_FOUND issues generated with valid bootstrap', () => {
    const novemberWeekStarts = [
      '2026-10-26',
      '2026-11-02',
      '2026-11-09',
      '2026-11-16',
      '2026-11-23',
      '2026-11-30'
    ];

    const policies = [
      {
        PolicyId: prodPolicyB.PolicyId,
        PolicyCode: prodPolicyB.PolicyCode,
        EffectiveMonday: prodPolicyB.EffectiveMonday,
        RuleVersion: 1,
        RuleJson: prodPolicyB.RuleJson,
        Active: true,
        Revision: 1
      }
    ];

    const personId = 'd89cf180-37c8-448c-8ebc-927724e4b79c';
    for (const weekStart of novemberWeekStarts) {
      const evalResult = guidance.evaluateWeek({
        weekStart,
        personId,
        plannedByDate: {},
        currentByDate: {},
        availablePlannedDates: guidance.weekDates(weekStart),
        policies
      });

      assert.equal(evalResult.state, 'COMPLETE');
      assert.equal(evalResult.policy.policyCode, 'B');
      const issueCodes = evalResult.issues.map(i => i.code);
      assert.ok(!issueCodes.includes('OFF_POLICY_NOT_FOUND'), `Week ${weekStart} must not throw OFF_POLICY_NOT_FOUND`);
      // Genuine safety advisory for 0 off days under Policy B (requires 2 OFF)
      assert.ok(issueCodes.includes('WEEKLY_OFF_SHORTFALL'), `Week ${weekStart} must retain genuine WEEKLY_OFF_SHORTFALL`);
    }
  });

  await t.test('11. Guidance repository authentication remains intact', () => {
    const h = setupProductionLikeHarness({ activeEmail: '' });
    h.grids.OffPolicies.push(guidance.OFF_POLICY_HEADERS.map(k => prodPolicyB[k]));

    // Without active admin email in Apps Script session, read and write fail with AUTHORIZATION_REQUIRED
    const res = readPolicies(h);
    assert.equal(res.ok, false);
    assert.equal(res.error.code, 'AUTHORIZATION_REQUIRED');
  });

  await t.test('12. Read-only review gate allowPolicyWrites=false suppresses mutation controls', async () => {
    const RosterGuidancePanel = await loadJsxComponent('src/features/roster/components/RosterGuidancePanel.jsx');
    const settings = {
      weekly_off_guidance_enabled: 'true',
      roster_v2_write_enabled: 'true',
      write_queue_v2_enabled: 'true'
    };
    const mockQueue = {
      store: {},
      clientId: 'c1',
      tabId: 't1',
      view: () => ({ baseline: { checksum: 'mock' }, cells: {} }),
      refresh: async () => {}
    };

    const html = ReactDOMServer.renderToStaticMarkup(
      React.createElement(RosterGuidancePanel, {
        period: '2026-11',
        settings,
        queue: mockQueue,
        people: [],
        isVerifiedAdmin: true,
        allowPolicyWrites: false
      })
    );

    assert.ok(!html.includes('Add effective OFF policy'), 'Mutation form must be hidden when allowPolicyWrites=false');
    assert.ok(html.includes('Advisory roster guidance — 2026-11'), 'Guidance panel itself is visible');
  });

  await t.test('13. Strict 13-MO projection remains intact', () => {
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

    const people = legacyTeamMembers.map((m, idx) => ({
      PersonId: `00000000-0000-4000-8000-${String(idx + 1).padStart(12, '0')}`,
      CurrentDisplayName: m.name,
      DirectoryType: 'MO',
      StaffId: m.staffId,
      Active: true
    }));

    const projected = projectMoStaff({
      people,
      teamMembers: legacyTeamMembers,
      legacyNames: legacyTeamMembers.map(m => m.name)
    });
    assert.equal(projected.length, 13, 'Strictly 13 MO rows');
    assert.deepEqual(projected.map(p => p.displayName), legacyTeamMembers.map(m => m.name), 'Exact legacy ordering');
  });

  await t.test('14. Publication control remains disabled during manual review', () => {
    const rosterPageSrc = fs.readFileSync(path.join(rootDir, 'src/components/RosterPage.jsx'), 'utf8');
    const lifecycleControlsSrc = fs.readFileSync(path.join(rootDir, 'src/features/roster/components/LifecycleControls.jsx'), 'utf8');

    // 1. RosterPage explicitly passes allowPublish={false} to LifecycleControls
    assert.ok(
      rosterPageSrc.includes('allowPublish={false}'),
      'RosterPage must pass allowPublish={false} during manual review'
    );

    // 2. LifecycleControls disables the button when allowPublish is false
    assert.ok(
      lifecycleControlsSrc.includes('disabled={!mutationsEnabled || !allowPublish}'),
      'Publish button must be disabled when allowPublish is false'
    );

    // 3. LifecycleControls sets the review explanation tooltip
    assert.ok(
      lifecycleControlsSrc.includes("'Publication is disabled during manual review'"),
      'Tooltip must explain publication is disabled during manual review'
    );

    // 4. Click handler aborts when allowPublish is false
    assert.ok(
      lifecycleControlsSrc.includes('if (!allowPublish) return;'),
      'Publish handler must abort when allowPublish is false'
    );
  });

});
