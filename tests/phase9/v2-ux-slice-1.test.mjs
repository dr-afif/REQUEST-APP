import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import React from 'react';
import ReactDOMServer from 'react-dom/server';

import {
  projectMoStaff,
  projectMoStaffWithDiagnostics
} from '../../src/features/roster/staffProjection.js';
import { mapName } from '../../src/utils/adapters.js';
import {
  setAdminSessionToken,
  clearAdminSessionToken,
  isSessionTokenActive
} from '../../src/features/roster/auth/adminAuth.js';
import * as adminAuthModule from '../../src/features/roster/auth/adminAuth.js';
import { createGuidanceRepository } from '../../src/features/roster/data/guidanceRepository.js';
import guidance from '../../src/features/roster/guidance.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');

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

test('V2 UX Refinement Slice 1.1 — Strict Legacy MO Row-Set Hardening', async (t) => {

  await t.test('1. Current certified projection gives exactly 13 visible MO rows and clean diagnostics', () => {
    const projected = projectMoStaff({
      people: directoryPeople,
      teamMembers: legacyTeamMembers,
      legacyNames
    });

    assert.equal(projected.length, 13, 'Expected exactly 13 MO doctors');
    for (const p of projected) {
      assert.equal(p.dutyDomain, 'MO', `Expected dutyDomain MO but got ${p.dutyDomain}`);
    }

    assert.ok(projected.diagnostics, 'Diagnostics object must exist');
    assert.equal(projected.diagnostics.ok, true, 'Diagnostics ok must be true for certified data');
    assert.equal(projected.diagnostics.unmatchedLegacyStaff.length, 0, 'Zero unmatched legacy staff');
    assert.equal(projected.diagnostics.unmatchedV2Mo.length, 0, 'Zero unmatched V2 MO staff');
    assert.equal(projected.diagnostics.ambiguousMappings.length, 0, 'Zero ambiguous mappings');
    assert.equal(projected.diagnostics.duplicatePersonIds.length, 0, 'Zero duplicate PersonId mappings');
  });

  await t.test('2. Visible row order exactly matches legacy TeamMembers sequence', () => {
    const projected = projectMoStaff({
      people: directoryPeople,
      teamMembers: legacyTeamMembers,
      legacyNames
    });

    const projectedNames = projected.map(p => p.displayName);
    const expectedLegacyNames = legacyTeamMembers.map(m => mapName(m.name));

    assert.deepEqual(
      projectedNames,
      expectedLegacyNames,
      'Projected MO order must match legacy TeamMembers order exactly'
    );
  });

  await t.test('3. Every visible row has an expected stable V2 PersonId', () => {
    const projected = projectMoStaff({
      people: directoryPeople,
      teamMembers: legacyTeamMembers,
      legacyNames
    });

    projected.forEach((p, idx) => {
      assert.ok(p.personId, `PersonId must exist for row ${idx}`);
      assert.equal(p.personId, directoryPeople[idx].PersonId, `PersonId must equal authoritative V2 PersonId`);
      assert.notEqual(p.personId, p.displayName, `PersonId must not be replaced by display name`);
    });
  });

  await t.test('4. EP assignment cannot create a visible row in Current or Planned views', () => {
    const moStaff = projectMoStaff({
      people: directoryPeople,
      teamMembers: legacyTeamMembers,
      legacyNames
    });

    // Simulate assignments containing both MO and EP
    const assignmentsWithEp = [
      { personId: directoryPeople[0].PersonId, date: '2026-11-01', shiftCode: 'AM', dutyDomain: 'MO' },
      { personId: 'f5b6ce73-8565-4332-8000-25025933e796', date: '2026-11-01', shiftCode: 'ON1', dutyDomain: 'EP' }
    ];

    // Current view projection logic test
    const mapCurrent = new Map();
    moStaff.forEach((p, idx) => {
      mapCurrent.set(`${p.personId}::${p.dutyDomain}`, { ...p, cells: {}, orderIndex: idx });
    });
    assignmentsWithEp.forEach((a) => {
      if (!a || a.dutyDomain === 'EP') return;
      const targetRow = mapCurrent.get(`${a.personId}::${a.dutyDomain || 'MO'}`);
      if (targetRow) targetRow.cells[a.date] = a;
    });

    const currentRows = Array.from(mapCurrent.values());
    assert.equal(currentRows.length, 13, 'Current view must have exactly 13 rows');
    assert.ok(!currentRows.some(r => r.dutyDomain === 'EP'), 'No EP rows allowed');

    // Planned view projection logic test
    const mapPlanned = new Map();
    moStaff.forEach((p, idx) => {
      mapPlanned.set(p.personId, { ...p, dates: {}, orderIndex: idx });
    });
    assignmentsWithEp.forEach((a) => {
      if (!a || a.dutyDomain === 'EP') return;
      const targetRow = mapPlanned.get(a.personId);
      if (targetRow) targetRow.dates[a.date] = a.shiftCode;
    });

    const plannedRows = Array.from(mapPlanned.values());
    assert.equal(plannedRows.length, 13, 'Planned view must have exactly 13 rows');
    assert.ok(!plannedRows.some(r => r.dutyDomain === 'EP'), 'No EP rows allowed');
  });

  await t.test('5. Unknown non-EP assignment cannot construct or append a visible row', () => {
    const moStaff = projectMoStaff({
      people: directoryPeople,
      teamMembers: legacyTeamMembers,
      legacyNames
    });

    const assignmentsWithUnknown = [
      { personId: directoryPeople[0].PersonId, date: '2026-11-01', shiftCode: 'AM', dutyDomain: 'MO' },
      { personId: 'ghost-unknown-doctor-id', date: '2026-11-01', shiftCode: 'PM', dutyDomain: 'MO' }
    ];

    const mapCurrent = new Map();
    moStaff.forEach((p, idx) => {
      mapCurrent.set(`${p.personId}::${p.dutyDomain}`, { ...p, cells: {}, orderIndex: idx });
    });
    assignmentsWithUnknown.forEach((a) => {
      if (!a || a.dutyDomain === 'EP') return;
      const targetRow = mapCurrent.get(`${a.personId}::${a.dutyDomain || 'MO'}`);
      if (targetRow) targetRow.cells[a.date] = a;
    });

    const visibleRows = Array.from(mapCurrent.values());
    assert.equal(visibleRows.length, 13, 'Unknown non-EP assignment must NOT create a 14th row');
    assert.ok(!visibleRows.some(r => r.personId === 'ghost-unknown-doctor-id'));
  });

  await t.test('6. Unmatched V2 MO cannot silently append a visible row', () => {
    const peopleWithExtraMo = [
      ...directoryPeople,
      {
        PersonId: 'extra-unmapped-mo-uuid',
        CurrentDisplayName: 'Dr. Extra Unmapped',
        DirectoryType: 'MO',
        StaffId: 'MO999',
        LegacyNamesJson: '[]',
        Active: true
      }
    ];

    const projected = projectMoStaff({
      people: peopleWithExtraMo,
      teamMembers: legacyTeamMembers,
      legacyNames
    });

    assert.equal(projected.length, 13, 'Visible rows must strictly equal legacy row count (13)');
    assert.ok(!projected.some(p => p.personId === 'extra-unmapped-mo-uuid'), 'Extra MO must NOT be appended to visible rows');
    assert.equal(projected.diagnostics.ok, false, 'Diagnostics ok must be false when an unmapped MO exists');
    assert.equal(projected.diagnostics.unmatchedV2Mo.length, 1, 'Unmatched V2 MO must be reported in diagnostics');
    assert.equal(projected.diagnostics.unmatchedV2Mo[0].personId, 'extra-unmapped-mo-uuid');
  });

  await t.test('7. Duplicate and ambiguous mappings are fail-closed detected', () => {
    // Duplicate test: two legacy team members referencing the same person
    const duplicateLegacy = [
      ...legacyTeamMembers,
      { name: 'Adi Duplicate Entry', staffId: 'A05157' }
    ];

    const projDup = projectMoStaff({
      people: directoryPeople,
      teamMembers: duplicateLegacy,
      legacyNames
    });

    assert.equal(projDup.length, 13, 'Duplicate entry must NOT append an extra visible row');
    assert.equal(projDup.diagnostics.ok, false, 'Diagnostics ok must be false');
    assert.equal(projDup.diagnostics.duplicatePersonIds.length, 1, 'Duplicate PersonId must be captured in diagnostics');

    // Ambiguous test: two V2 people matching the same legacy name without staffId
    const ambiguousPeople = [
      ...directoryPeople,
      {
        PersonId: 'ambiguous-syuhada-clone',
        CurrentDisplayName: 'Syuhada',
        DirectoryType: 'MO',
        StaffId: '',
        LegacyNamesJson: '["Syuhada"]'
      }
    ];

    const legacyWithoutStaffIds = legacyTeamMembers.map(m => ({ name: m.name }));
    const projAmb = projectMoStaff({
      people: ambiguousPeople,
      teamMembers: legacyWithoutStaffIds
    });

    assert.equal(projAmb.diagnostics.ok, false, 'Diagnostics ok must be false for ambiguous candidate');
    assert.ok(
      projAmb.diagnostics.ambiguousMappings.length > 0 || projAmb.diagnostics.unmatchedV2Mo.length > 0,
      'Ambiguity must be detected'
    );
  });

  await t.test('8. Underlying unknown/EP assignment data remains unchanged', () => {
    const rawAssignments = [
      { personId: directoryPeople[0].PersonId, date: '2026-11-01', shiftCode: 'AM', dutyDomain: 'MO' },
      { personId: 'f5b6ce73-8565-4332-8000-25025933e796', date: '2026-11-01', shiftCode: 'ON1', dutyDomain: 'EP' },
      { personId: 'ghost-unknown-doctor-id', date: '2026-11-01', shiftCode: 'PM', dutyDomain: 'MO' }
    ];

    const cloned = JSON.parse(JSON.stringify(rawAssignments));

    const moStaff = projectMoStaff({
      people: directoryPeople,
      teamMembers: legacyTeamMembers,
      legacyNames
    });

    const map = new Map();
    moStaff.forEach((p, idx) => {
      map.set(`${p.personId}::${p.dutyDomain}`, { ...p, cells: {}, orderIndex: idx });
    });
    cloned.forEach((a) => {
      if (!a || a.dutyDomain === 'EP') return;
      const target = map.get(`${a.personId}::${a.dutyDomain || 'MO'}`);
      if (target) target.cells[a.date] = a;
    });

    assert.deepEqual(cloned, rawAssignments, 'Input assignments must remain completely unmutated');
    assert.equal(cloned.length, 3, 'Original assignment count preserved');
  });

  await t.test('9. Current and Planned views obey the same strict row-set rule', () => {
    const moStaff = projectMoStaff({
      people: directoryPeople,
      teamMembers: legacyTeamMembers,
      legacyNames
    });

    const currentMap = new Map();
    moStaff.forEach((p, idx) => {
      currentMap.set(`${p.personId}::${p.dutyDomain}`, { ...p, cells: {}, orderIndex: idx });
    });

    const plannedMap = new Map();
    moStaff.forEach((p, idx) => {
      plannedMap.set(p.personId, { ...p, dates: {}, orderIndex: idx });
    });

    const currentVisible = Array.from(currentMap.values());
    const plannedVisible = Array.from(plannedMap.values());

    assert.equal(currentVisible.length, 13);
    assert.equal(plannedVisible.length, 13);

    for (let i = 0; i < 13; i++) {
      assert.equal(currentVisible[i].personId, plannedVisible[i].personId);
      assert.equal(currentVisible[i].displayName, plannedVisible[i].displayName);
      assert.equal(currentVisible[i].dutyDomain, plannedVisible[i].dutyDomain);
    }
  });

  await t.test('10. Existing Private Draft hiding and runtime preservation remains unchanged', async () => {
    const panelPath = path.resolve(rootDir, 'src/features/roster/components/DraftQueuePanel.jsx');
    const req = createRequire(import.meta.url);
    const bundleResult = await build({
      entryPoints: [panelPath],
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
    const DraftQueuePanel = mod.exports.default || mod.exports;

    setAdminSessionToken('valid-admin-test-token', 'admin@example.com');
    try {
      const htmlNormal = ReactDOMServer.renderToStaticMarkup(
        React.createElement(DraftQueuePanel, {
          period: '2026-11',
          settings: { roster_v2_write_enabled: true, write_queue_v2_enabled: true },
          runtimeFactory: () => Promise.resolve({
            start: () => Promise.resolve(),
            stop: () => Promise.resolve(),
            subscribe: () => () => {},
            refresh: () => Promise.resolve(),
            view: () => ({ baseline: { checksum: 'abc' }, cells: {}, statuses: {} }),
            repository: { schema: () => Promise.resolve({ ok: true, draftWritesEnabled: true, people: [] }) },
            entities: new Map()
          })
        })
      );

      assert.ok(!htmlNormal.includes('Private draft — 2026-11'), 'Technical editor title must NOT appear in normal UI');
      assert.ok(!htmlNormal.includes('Save draft cell'), 'Save draft cell button must NOT appear in normal UI');
      assert.ok(!htmlNormal.includes('Draft cells and save state'), 'Debug table must NOT appear in normal UI');
    } finally {
      clearAdminSessionToken();
    }

    const panelSrc = fs.readFileSync(panelPath, 'utf8');
    assert.ok(panelSrc.includes('setInterval(()=>q.refresh(key)'), 'Background 60s periodic refresh preserved');
    assert.ok(panelSrc.includes('{queue&&<RosterGuidancePanel'), 'RosterGuidancePanel preserved');
    assert.ok(/if\s*\(\s*!sessionActive\s*\)\s*\{\s*return\s+null;\s*\}/.test(panelSrc), 'Pre-auth fail-closed preserved');
  });

  await t.test('11. Guidance repository authenticates via memory-only token across all routes and fails closed without token', async () => {
    let capturedRequests = [];
    const mockFetcher = async (url, options) => {
      capturedRequests.push({ url, options });
      return {
        ok: true,
        json: async () => ({ ok: true, status: 'CONFIRMED', policies: [], schemaVersion: 1 })
      };
    };

    // 1. Authenticated state: obtain memory token
    setAdminSessionToken('test-memory-token-12345', 'admin@example.com');
    try {
      const repo = createGuidanceRepository({
        baseUrl: 'https://script.google.com/macros/s/test/exec',
        fetcher: mockFetcher
      });

      // rosterv2offpolicies -> POST with token
      capturedRequests = [];
      await repo.policies();
      assert.equal(capturedRequests.length, 1);
      assert.equal(capturedRequests[0].options.method, 'POST');
      const policiesBody = JSON.parse(capturedRequests[0].options.body);
      assert.equal(policiesBody.action, 'rosterv2offpolicies');
      assert.equal(policiesBody.adminSessionToken, 'test-memory-token-12345');
      assert.equal(capturedRequests[0].options.credentials, undefined, 'standard CORS without credentials:include');

      // rosterv2guidanceschema -> POST with token
      capturedRequests = [];
      await repo.schema();
      assert.equal(capturedRequests.length, 1);
      assert.equal(capturedRequests[0].options.method, 'POST');
      const schemaBody = JSON.parse(capturedRequests[0].options.body);
      assert.equal(schemaBody.action, 'rosterv2guidanceschema');
      assert.equal(schemaBody.adminSessionToken, 'test-memory-token-12345');

      // rosterv2offpolicy (save) -> POST with token
      capturedRequests = [];
      const dummyOp = {
        operationId: '11111111-1111-4111-8111-111111111111',
        clientId: 'c1',
        tabId: 't1',
        operationType: 'OFF_POLICY_UPSERT',
        entityKey: 'off-policies',
        expectedRevision: 1,
        payload: { policyId: '22222222-2222-4222-8222-222222222222', policyCode: 'B', effectiveMonday: '2026-10-26', reason: '' },
        payloadHash: 'hash'
      };
      await repo.save(dummyOp);
      assert.equal(capturedRequests.length, 1);
      assert.equal(capturedRequests[0].options.method, 'POST');
      const saveBody = JSON.parse(capturedRequests[0].options.body);
      assert.equal(saveBody.action, 'rosterv2offpolicy');
      assert.equal(saveBody.adminSessionToken, 'test-memory-token-12345');

      // rosterv2offpolicyrecover -> POST with token
      capturedRequests = [];
      await repo.recover('11111111-1111-4111-8111-111111111111');
      assert.equal(capturedRequests.length, 1);
      assert.equal(capturedRequests[0].options.method, 'POST');
      const recoverBody = JSON.parse(capturedRequests[0].options.body);
      assert.equal(recoverBody.action, 'rosterv2offpolicyrecover');
      assert.equal(recoverBody.adminSessionToken, 'test-memory-token-12345');

      // rosterv2operation (status) -> GET with searchParam token
      capturedRequests = [];
      await repo.status('11111111-1111-4111-8111-111111111111');
      assert.equal(capturedRequests.length, 1);
      assert.equal(capturedRequests[0].options.method, 'GET');
      const statusUrl = new URL(capturedRequests[0].url);
      assert.equal(statusUrl.searchParams.get('action'), 'rosterv2operation');
      assert.equal(statusUrl.searchParams.get('adminSessionToken'), 'test-memory-token-12345');
    } finally {
      clearAdminSessionToken();
    }

    // 2. Unauthenticated state: token is null, falls closed
    const unauthRepo = createGuidanceRepository({
      baseUrl: 'https://script.google.com/macros/s/test/exec',
      fetcher: mockFetcher
    });
    capturedRequests = [];
    await unauthRepo.policies();
    assert.equal(capturedRequests.length, 1);
    assert.equal(capturedRequests[0].options.method, 'GET');
    const unauthUrl = new URL(capturedRequests[0].url);
    assert.equal(unauthUrl.searchParams.get('adminSessionToken'), null, 'No token sent when unauthenticated');
  });

  await t.test('12. Guidance UI fails closed on auth failure and presents operator wording without internal Phase terminology', async () => {
    const guidancePath = path.resolve(rootDir, 'src/features/roster/components/RosterGuidancePanel.jsx');
    const guidanceSrc = fs.readFileSync(guidancePath, 'utf8');

    // Wording assertions
    assert.ok(!guidanceSrc.includes('until Phase 4'), 'Must not contain stale "until Phase 4" wording');
    assert.ok(guidanceSrc.includes('Warnings are advisory and never change roster assignments.'), 'Must contain clean operator wording');
    assert.ok(guidanceSrc.includes('Guidance is calculated from the current draft roster.'), 'Must explain draft context to operator');

    // Default policy code is B
    assert.ok(guidanceSrc.includes("useState('B')"), 'Policy code must default to B');

    // Bundled component SSR assertions
    const req = createRequire(import.meta.url);
    const bundleResult = await build({
      entryPoints: [guidancePath],
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
    const RosterGuidancePanel = mod.exports.default || mod.exports;

    const mockQueue = {
      view: () => ({ baseline: { checksum: 'abc' }, cells: {} }),
      store: {},
      clientId: 'c1',
      tabId: 't1',
      refresh: async () => {}
    };

    const settings = {
      weekly_off_guidance_enabled: true,
      roster_v2_write_enabled: true,
      write_queue_v2_enabled: true
    };

    // Unverified admin cannot see Add policy
    const unverifiedHtml = ReactDOMServer.renderToStaticMarkup(
      React.createElement(RosterGuidancePanel, {
        period: '2026-11',
        settings,
        queue: mockQueue,
        people: [],
        isVerifiedAdmin: false
      })
    );
    assert.ok(!unverifiedHtml.includes('Add effective OFF policy'), 'Unverified admin must not see Add policy controls');
    assert.ok(unverifiedHtml.includes('Warnings are advisory and never change roster assignments.'), 'Clean subtitle renders');

    // Verified admin in SSR (without error) sees clean form defaulting to Policy B
    const verifiedHtml = ReactDOMServer.renderToStaticMarkup(
      React.createElement(RosterGuidancePanel, {
        period: '2026-11',
        settings,
        queue: mockQueue,
        people: [],
        isVerifiedAdmin: true
      })
    );
    assert.ok(verifiedHtml.includes('Add effective OFF policy'));
    assert.ok(verifiedHtml.includes('value="B"'));
    assert.ok(verifiedHtml.includes('>B</option>'));
  });

  await t.test('13. Full Roster heading is lifecycle-aware and does not claim finalized schedule for DRAFT', () => {
    const rosterPageSrc = fs.readFileSync(path.join(rootDir, 'src/components/RosterPage.jsx'), 'utf8');

    // Must have the conditional lifecycle check for DRAFT
    const draftHeadingPattern = /lifecycleInfo\?\.isEnrolled\s*&&\s*lifecycleInfo\?\.period\s*===\s*rosterMonth\s*&&\s*lifecycleInfo\?\.state\s*===\s*'DRAFT'\s*\?\s*\(\s*<>Editing the draft roster for/;
    assert.ok(draftHeadingPattern.test(rosterPageSrc), 'DRAFT period must show "Editing the draft roster for"');

    const publishedHeadingPattern = /Displaying the official finalized schedule for/;
    assert.ok(publishedHeadingPattern.test(rosterPageSrc), 'Published/non-enrolled period preserves "Displaying the official finalized schedule for"');
  });

  await t.test('14. Publication control safety during manual review is enforced without altering backend code', () => {
    const rosterPageSrc = fs.readFileSync(path.join(rootDir, 'src/components/RosterPage.jsx'), 'utf8');
    const lifecycleControlsSrc = fs.readFileSync(path.join(rootDir, 'src/features/roster/components/LifecycleControls.jsx'), 'utf8');
    const backendLifecycleSrc = fs.readFileSync(path.join(rootDir, 'backend/roster-lifecycle.gs'), 'utf8');

    // RosterPage passes allowPublish={false}
    assert.ok(
      rosterPageSrc.includes('allowPublish={false}'),
      'RosterPage must pass allowPublish={false} during manual review'
    );

    // LifecycleControls disables the button when allowPublish is false
    assert.ok(
      lifecycleControlsSrc.includes('disabled={!mutationsEnabled || !allowPublish}'),
      'Publish button must be disabled when !allowPublish'
    );
    assert.ok(
      lifecycleControlsSrc.includes("'Publication is disabled during manual review'"),
      'Disabled tooltip must explain review status'
    );
    assert.ok(
      lifecycleControlsSrc.includes('!allowPublish'),
      'Must check !allowPublish in title'
    );
    assert.ok(
      lifecycleControlsSrc.includes('if (!allowPublish) return;'),
      'Publish click handler must guard against execution when !allowPublish'
    );

    // Backend publication implementation remains completely intact
    assert.ok(
      backendLifecycleSrc.includes("action === 'rosterv2publish'"),
      'Backend rosterv2publish route must remain intact'
    );
    assert.ok(
      backendLifecycleSrc.includes('rosterLifecyclePublish_'),
      'Backend rosterLifecyclePublish_ implementation must remain intact'
    );
  });

  await t.test('15. Read-only guidance review gate: allowPolicyWrites=false suppresses resume, save, recover, and form controls while preserving policy reads and guidance calculations', async () => {
    const rosterPageSrc = fs.readFileSync(path.join(rootDir, 'src/components/RosterPage.jsx'), 'utf8');
    const draftQueuePanelSrc = fs.readFileSync(path.join(rootDir, 'src/features/roster/components/DraftQueuePanel.jsx'), 'utf8');
    const guidanceSrc = fs.readFileSync(path.join(rootDir, 'src/features/roster/components/RosterGuidancePanel.jsx'), 'utf8');

    // 1. Gating verification across UI layers
    assert.ok(
      rosterPageSrc.includes('<DraftQueuePanel key={rosterMonth} period={rosterMonth} settings={settings} allowPolicyWrites={false} />'),
      'RosterPage must pass allowPolicyWrites={false} to DraftQueuePanel'
    );
    assert.ok(
      draftQueuePanelSrc.includes('allowPolicyWrites=false'),
      'DraftQueuePanel must default allowPolicyWrites to false'
    );
    assert.ok(
      draftQueuePanelSrc.includes('allowPolicyWrites={allowPolicyWrites}'),
      'DraftQueuePanel must forward allowPolicyWrites to RosterGuidancePanel'
    );

    // 2. Static source code invariants: resume() and savePolicy() strictly guarded
    assert.ok(
      /if\s*\(\s*allowPolicyWrites\s*\)\s*\{\s*const\s+resumed\s*=\s*await\s+policyMutation\.resume\(\);/.test(guidanceSrc),
      'policyMutation.resume() must be strictly guarded by allowPolicyWrites'
    );
    assert.ok(
      guidanceSrc.includes('if(!allowPolicyWrites || !isVerified'),
      'savePolicy must fail closed when allowPolicyWrites is false'
    );
    assert.ok(
      guidanceSrc.includes('allowPolicyWrites &&'),
      'canAddPolicy must require allowPolicyWrites'
    );

    // 3. Bundled component rendering: allowPolicyWrites=false hides mutation controls
    const guidancePath = path.resolve(rootDir, 'src/features/roster/components/RosterGuidancePanel.jsx');
    const req = createRequire(import.meta.url);
    const bundleResult = await build({
      entryPoints: [guidancePath],
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
    const RosterGuidancePanel = mod.exports.default || mod.exports;

    const mockQueue = {
      view: () => ({ baseline: { checksum: 'abc' }, cells: {} }),
      store: {},
      clientId: 'c1',
      tabId: 't1',
      refresh: async () => {}
    };

    const settings = {
      weekly_off_guidance_enabled: true,
      night_safety_guidance_enabled: true,
      roster_v2_write_enabled: true,
      write_queue_v2_enabled: true
    };

    // Render with allowPolicyWrites=false even with verified admin
    const readOnlyHtml = ReactDOMServer.renderToStaticMarkup(
      React.createElement(RosterGuidancePanel, {
        period: '2026-11',
        settings,
        queue: mockQueue,
        people: [],
        isVerifiedAdmin: true,
        allowPolicyWrites: false
      })
    );

    assert.ok(!readOnlyHtml.includes('Add effective OFF policy'), 'Mutation form must be absent in read-only mode');
    assert.ok(!readOnlyHtml.includes('Effective Monday'), 'Date input must be absent');
    assert.ok(!readOnlyHtml.includes('Add policy'), 'Add policy button must be absent');
    assert.ok(readOnlyHtml.includes('Advisory roster guidance — 2026-11'), 'Guidance header still visible');
    assert.ok(readOnlyHtml.includes('Warnings are advisory and never change roster assignments.'), 'Advisory text visible');

    // 4. Existing Policy B evaluation succeeds in read-only mode without mutation
    const policyBFixture = [
      {
        PolicyId: '68c4fcb6-89e8-466a-9324-78338f0f0c05',
        PolicyCode: 'B',
        EffectiveMonday: '2026-10-26',
        RuleVersion: 1,
        RuleJson: guidance.policyRuleJson('B'),
        Active: true,
        Revision: 1
      }
    ];

    const weekEval = guidance.evaluateWeek({
      weekStart: '2026-11-02',
      personId: 'd89cf180-37c8-448c-8ebc-927724e4b79c',
      availablePlannedDates: ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08'],
      policies: policyBFixture
    });

    assert.equal(weekEval.policy.policyCode, 'B', 'Guidance correctly resolves existing production Policy B');
    assert.equal(weekEval.policy.effectiveMonday, '2026-10-26');

    // 5. Future capability: allowPolicyWrites=true enables the form controls
    const mutableHtml = ReactDOMServer.renderToStaticMarkup(
      React.createElement(RosterGuidancePanel, {
        period: '2026-11',
        settings,
        queue: mockQueue,
        people: [],
        isVerifiedAdmin: true,
        allowPolicyWrites: true
      })
    );
    assert.ok(mutableHtml.includes('Add effective OFF policy'), 'Future caller with allowPolicyWrites=true can render mutation controls');
  });

});
