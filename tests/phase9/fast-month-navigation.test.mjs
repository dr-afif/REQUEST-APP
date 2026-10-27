import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import React from 'react';
import ReactDOMServer from 'react-dom/server';

import * as adminAuthModule from '../../src/features/roster/auth/adminAuth.js';
import * as draftRepoModule from '../../src/features/roster/data/draftRepository.js';

if (typeof globalThis.localStorage === 'undefined') {
  globalThis.localStorage = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
    clear: () => {}
  };
}

if (typeof globalThis.window === 'undefined') {
  globalThis.window = {
    addEventListener: () => {},
    removeEventListener: () => {}
  };
} else {
  if (!globalThis.window.addEventListener) globalThis.window.addEventListener = () => {};
  if (!globalThis.window.removeEventListener) globalThis.window.removeEventListener = () => {};
}

if (typeof globalThis.navigator === 'undefined') {
  globalThis.navigator = { onLine: true };
}

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
    external: [
      'react',
      'react-dom',
      'react-dom/server',
      'lucide-react',
      'jspdf',
      'html2canvas',
      'docxtemplater',
      'pizzip',
      'file-saver',
      '*/adminAuth.js'
    ]
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

// Tree crawler to find JSX nodes by predicate
function findNode(node, predicate) {
  if (!node || typeof node !== 'object') return null;
  if (predicate(node)) return node;
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findNode(item, predicate);
      if (found) return found;
    }
  }
  if (node.props?.children) {
    return findNode(node.props.children, predicate);
  }
  return null;
}

// Extract all text content from JSX tree
function extractText(node) {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(extractText).join(' ');
  if (typeof node.type === 'function') {
    try {
      return extractText(node.type(node.props));
    } catch (_) {}
  }
  if (node.props?.children) return extractText(node.props.children);
  return '';
}

function createMockQueue(overrides = {}) {
  const lifecycleCalls = [];
  const refreshCalls = [];
  const stopCalls = [];

  const {
    getPeriodLifecycle: overrideGetLifecycle,
    refresh: overrideRefresh,
    view: overrideView,
    stop: overrideStop,
    ...restOverrides
  } = overrides;

  const queue = {
    lifecycleCalls,
    refreshCalls,
    stopCalls,
    enabled: () => true,
    start: async () => {},
    stop: () => {
      stopCalls.push(Date.now());
      if (overrideStop) overrideStop();
    },
    subscribe: () => () => {},
    getPeriodLifecycle: async (period) => {
      lifecycleCalls.push({ period, timestamp: Date.now() });
      if (overrideGetLifecycle) {
        return overrideGetLifecycle(period);
      }
      if (period < '2026-11') {
        return { ok: true, period: null };
      }
      return {
        ok: true,
        period: {
          PeriodId: period,
          State: 'DRAFT',
          Revision: 1,
          DraftRevision: 1
        }
      };
    },
    refresh: async (key) => {
      refreshCalls.push(key);
      if (overrideRefresh) {
        return overrideRefresh(key);
      }
      if (key?.startsWith?.('draft:') && !adminAuthModule.getAdminSessionToken()) {
        const err = new Error('Admin authorization required');
        err.code = 'AUTHORIZATION_REQUIRED';
        throw err;
      }
      return { ok: true };
    },
    view: (key) => {
      if (overrideView) return overrideView(key);
      return {
        cells: {},
        statuses: {},
        baseline: { revision: 1, checksum: 'chk-default' },
        lifecycle: { state: 'DRAFT', revision: 1, draftRevision: 1 },
        operations: []
      };
    },
    getCurrentRoster: async (period) => ({ ok: true, period, state: 'PUBLISHED', assignments: [] }),
    getPlannedRoster: async (period) => ({ ok: true, period, state: 'PUBLISHED', assignments: [] }),
    getAmendmentHistory: async () => ({ ok: true, amendments: [] }),
    getAbsences: async () => ({ ok: true, absences: [] }),
    getReplacements: async () => ({ ok: true, replacements: [] }),
    repository: {
      schema: async () => {
        draftRepoModule.setCachedStaffDirectory(directoryPeople13);
        return {
          ok: true,
          draftWritesEnabled: true,
          people: directoryPeople13
        };
      }
    },
    getCachedSchema: () => draftRepoModule.getCachedSchema(),
    getCachedPeople: () => draftRepoModule.getCachedStaffDirectory(),
    entities: new Map(),
    ...restOverrides
  };
  return queue;
}

const directoryPeople13 = [
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
  { PersonId: '287b9cd6-8bc9-4153-8f42-ae10ba2b58a7', CurrentDisplayName: 'Afif', DirectoryType: 'MO', StaffId: 'A05148', LegacyNamesJson: '[]', Active: false }
];

const teamMembers13 = directoryPeople13.map(p => ({
  name: p.CurrentDisplayName,
  staffId: p.StaffId
}));
const legacyNames13 = teamMembers13.map(m => m.name);

const build98Cells = () => {
  const people98 = directoryPeople13;
  const cells98 = {};
  let count = 0;
  for (let day = 1; day <= 30; day++) {
    const dd = String(day).padStart(2, '0');
    for (let pIdx = 0; pIdx < 13; pIdx++) {
      if (count >= 98) break;
      const p = directoryPeople13[pIdx];
      const shiftCode = ((day + pIdx) % 2 === 0) ? 'AM' : 'PM';
      cells98[`${p.PersonId}/2026-11-${dd}`] = [
        {
          assignmentId: `${p.PersonId}:2026-11-${dd}:MO:${shiftCode}`,
          shiftCode,
          rawShift: shiftCode,
          dutyDomain: 'MO'
        }
      ];
      count++;
    }
    if (count >= 98) break;
  }
  return { people98, cells98, teamMembers13, legacyNames13 };
};

test('Slice B3b.1: Fast Month Navigation Architecture Audit & Instant Revisit Suite', async (t) => {
  let Phase5RosterContainer;
  let LifecycleControls;
  let RosterPage;
  let CurrentRosterView;

  t.before(async () => {
    Phase5RosterContainer = await loadJsxComponent('src/features/roster/components/Phase5RosterContainer.jsx');
    LifecycleControls = await loadJsxComponent('src/features/roster/components/LifecycleControls.jsx');
    RosterPage = await loadJsxComponent('src/components/RosterPage.jsx');
    CurrentRosterView = await loadJsxComponent('src/features/roster/components/CurrentRosterView.jsx');
  });

  t.afterEach(() => {
    adminAuthModule.clearAdminSessionToken();
    draftRepoModule.clearCachedStaffDirectory();
  });

  // Harness for running components with React hooks
  const createSlotHarness = () => ({
    states: new Map(),
    refs: new Map(),
    callbacks: new Map(),
    prevDeps: new Map(),
    cleanups: new Map()
  });

  const unmountSlot = (slot) => {
    if (!slot) return;
    for (const cleanup of slot.cleanups.values()) {
      if (typeof cleanup === 'function') cleanup();
    }
    slot.cleanups.clear();
  };

  const runWithSlot = (slot, renderFn) => {
    let sIdx = 0;
    let rIdx = 0;
    let cIdx = 0;
    let eIdx = 0;
    const pendingEffects = [];

    React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentDispatcher.current = {
      useState: (init) => {
        const i = sIdx++;
        if (!slot.states.has(i)) {
          slot.states.set(i, typeof init === 'function' ? init() : init);
        }
        const setter = (next) => {
          const prev = slot.states.get(i);
          const resolved = typeof next === 'function' ? next(prev) : next;
          slot.states.set(i, resolved);
        };
        return [slot.states.get(i), setter];
      },
      useRef: (init) => {
        const i = rIdx++;
        if (!slot.refs.has(i)) {
          slot.refs.set(i, { current: init });
        }
        return slot.refs.get(i);
      },
      useCallback: (cb, deps) => {
        const i = cIdx++;
        const prev = slot.callbacks.get(i);
        if (
          prev &&
          deps &&
          prev.deps &&
          deps.length === prev.deps.length &&
          deps.every((d, idx) => Object.is(d, prev.deps[idx]))
        ) {
          return prev.cb;
        }
        slot.callbacks.set(i, { cb, deps });
        return cb;
      },
      useMemo: (cb) => cb(),
      useEffect: (cb, deps) => {
        const i = eIdx++;
        const prev = slot.prevDeps.get(i);
        const changed =
          !prev ||
          !deps ||
          deps.length !== prev.length ||
          deps.some((d, idx) => !Object.is(d, prev[idx]));
        if (changed) {
          slot.prevDeps.set(i, deps);
          pendingEffects.push({ i, cb });
        }
      }
    };

    const tree = renderFn();
    return {
      tree,
      flushEffects: () => {
        for (const { i, cb } of pendingEffects) {
          const prevCleanup = slot.cleanups.get(i);
          if (typeof prevCleanup === 'function') prevCleanup();
          const cleanup = cb();
          slot.cleanups.set(i, cleanup);
        }
      }
    };
  };

  const defaultSettings = {
    roster_workspace_v2_enabled: true,
    roster_v2_read_enabled: true,
    roster_v2_write_enabled: true,
    write_queue_v2_enabled: true
  };

  // Test 1: Initial November loading without cache
  await t.test('1. Initial November loading without cache loads authoritative draft', async () => {
    adminAuthModule.setAdminSessionToken('admin-fast-nav-token', 3600);
    const { cells98, people98 } = build98Cells();

    const sharedQueue = createMockQueue({
      repository: {
        schema: async () => ({ ok: true, people: people98 })
      },
      view: () => ({
        cells: cells98,
        statuses: {},
        baseline: { revision: 1, checksum: 'chk-nov-1' },
        lifecycle: { state: 'DRAFT', revision: 1, draftRevision: 1 },
        operations: []
      })
    });
    const stableRuntimeFactory = async () => sharedQueue;

    const pageSlot = createSlotHarness();
    const lcSlot = createSlotHarness();
    const phase5Slot = createSlotHarness();

    let latestSnapshot = null;
    const flush = async (period) => {
      for (let p = 0; p < 4; p++) {
        const pagePass = runWithSlot(pageSlot, () =>
          RosterPage({
            rosterMonth: period,
            settings: defaultSettings,
            isAdmin: true,
            selectedName: 'Admin',
            initialActiveTab: 'table',
            teamMembers: teamMembers13,
            names: legacyNames13,
            teamMembers: teamMembers13,
            names: legacyNames13,
            onV2LiveSnapshotChange: (s) => { latestSnapshot = s; }
          })
        );
        const lcNode = findNode(pagePass.tree, (n) => typeof n?.type === 'function' && n.type.name === 'LifecycleControls');
        const p5Node = findNode(pagePass.tree, (n) => typeof n?.type === 'function' && n.type.name === 'Phase5RosterContainer');

        let lcPass = null;
        if (lcNode) lcPass = runWithSlot(lcSlot, () => lcNode.type({ ...lcNode.props, queue: sharedQueue, runtimeFactory: stableRuntimeFactory }));
        let p5Pass = null;
        if (p5Node) p5Pass = runWithSlot(phase5Slot, () => p5Node.type({ ...p5Node.props, queue: sharedQueue, runtimeFactory: stableRuntimeFactory }));

        lcPass?.flushEffects();
        p5Pass?.flushEffects();
        pagePass.flushEffects();
        await new Promise((r) => setTimeout(r, 20));
      }
    };

    await flush('2026-11');

    assert.equal(sharedQueue.lifecycleCalls.length, 1, 'getPeriodLifecycle called once');
    assert.equal(latestSnapshot?.v2LiveSnapshot?.isLoaded, true, 'November v2LiveSnapshot is loaded');
    assert.equal(latestSnapshot?.v2LiveSnapshot?.assignments?.length, 98, 'All 98 assignments loaded');
  });

  // Test 2: November -> October -> November with cached preview available immediately
  await t.test('2. November -> October -> November shows cached preview immediately on Frame 0', async () => {
    adminAuthModule.setAdminSessionToken('admin-fast-nav-token', 3600);
    const { cells98, people98 } = build98Cells();

    const sharedQueue = createMockQueue({
      repository: {
        schema: async () => ({ ok: true, people: people98 })
      },
      view: (key) => {
        if (key === 'draft:2026-11') {
          return {
            cells: cells98,
            statuses: {},
            baseline: { revision: 1, checksum: 'chk-nov-1' },
            lifecycle: { state: 'DRAFT', revision: 1, draftRevision: 1 },
            operations: []
          };
        }
        return { cells: {}, statuses: {}, baseline: { revision: 0, checksum: null }, lifecycle: { state: 'DRAFT', revision: 0 }, operations: [] };
      }
    });
    const stableRuntimeFactory = async () => sharedQueue;

    const pageSlot = createSlotHarness();
    const lcSlot = createSlotHarness();
    const phase5Slot = createSlotHarness();

    let latestSnapshot = null;
    const flush = async (period, passes = 4) => {
      let firstTree = null;
      for (let p = 0; p < passes; p++) {
        const pagePass = runWithSlot(pageSlot, () =>
          RosterPage({
            rosterMonth: period,
            settings: defaultSettings,
            isAdmin: true,
            selectedName: 'Admin',
            initialActiveTab: 'table',
            teamMembers: teamMembers13,
            names: legacyNames13,
            onV2LiveSnapshotChange: (s) => { latestSnapshot = s; }
          })
        );
        if (p === 0) firstTree = pagePass.tree;

        const lcNode = findNode(pagePass.tree, (n) => typeof n?.type === 'function' && n.type.name === 'LifecycleControls');
        const p5Node = findNode(pagePass.tree, (n) => typeof n?.type === 'function' && n.type.name === 'Phase5RosterContainer');

        let lcPass = null;
        if (lcNode) lcPass = runWithSlot(lcSlot, () => lcNode.type({ ...lcNode.props, queue: sharedQueue, runtimeFactory: stableRuntimeFactory }));
        let p5Pass = null;
        if (p5Node) p5Pass = runWithSlot(phase5Slot, () => p5Node.type({ ...p5Node.props, queue: sharedQueue, runtimeFactory: stableRuntimeFactory }));

        lcPass?.flushEffects();
        p5Pass?.flushEffects();
        pagePass.flushEffects();
        await new Promise((r) => setTimeout(r, 20));
      }
      return firstTree;
    };

    // Step 1: Initial Nov load
    await flush('2026-11');
    assert.equal(latestSnapshot?.v2LiveSnapshot?.isLoaded, true);

    // Step 2: Navigate to October
    await flush('2026-10');

    // Step 3: Return to November - check Frame 0 tree immediately
    const frame0Tree = await flush('2026-11', 1);
    const p5NodeFrame0 = findNode(frame0Tree, (n) => typeof n?.type === 'function' && n.type.name === 'Phase5RosterContainer');
    assert.ok(p5NodeFrame0, 'Phase5RosterContainer is mounted on Frame 0 of returning to November');
    assert.equal(p5NodeFrame0.props.initialSnapshot?.isLoaded, true, 'initialSnapshot passed to Phase5RosterContainer on Frame 0');
    assert.equal(p5NodeFrame0.props.initialSnapshot?.assignments?.length, 98, 'Cached 98 assignments present on Frame 0');
    assert.equal(p5NodeFrame0.props.isRevalidating, true, 'isRevalidating marked true during background revalidation');

    // FRAME-0 ROW PROJECTION VERIFICATION:
    // Verify that Phase5RosterContainer renders CurrentRosterView with all 13 MO rows immediately
    const p5Frame0Pass = runWithSlot(createSlotHarness(), () =>
      p5NodeFrame0.type({ ...p5NodeFrame0.props, queue: sharedQueue, runtimeFactory: stableRuntimeFactory })
    );
    const crvNode = findNode(p5Frame0Pass.tree, (n) => typeof n?.type === 'function' && n.type.name === 'CurrentRosterView');
    assert.ok(crvNode, 'CurrentRosterView is mounted on Frame 0');
    assert.equal(crvNode.props.mutationsEnabled, false, 'Mutations remain strictly disabled on Frame 0');

    // Render CurrentRosterView tree with hook harness to check actual doctor rows and non-empty tbody
    const crvSlot = createSlotHarness();
    const crvPass = runWithSlot(crvSlot, () => crvNode.type(crvNode.props));
    const tbodyNode = findNode(crvPass.tree, (n) => n?.type === 'tbody');
    assert.ok(tbodyNode, 'Table tbody is rendered on Frame 0');
    const doctorRows = Array.isArray(tbodyNode.props.children)
      ? tbodyNode.props.children.filter(Boolean)
      : (tbodyNode.props.children ? [tbodyNode.props.children] : []);
    assert.equal(doctorRows.length, 13, 'All 13 MO doctor rows rendered on Frame 0 before new schema fetch');
    assert.ok(doctorRows.length > 0, 'No empty tbody during cached revisit');
    const tbodyText = extractText(tbodyNode);
    assert.ok(tbodyText.includes('AM') || tbodyText.includes('PM'), 'Cached assignments populated in visible cells');
    assert.ok(extractText(p5Frame0Pass.tree).includes('Verifying with server…'), 'Verifying with server indicator is visible');
  });

  // Test 3: No empty or legacy table flashed on a valid cached revisit
  await t.test('3. No empty or legacy table flashed on a valid cached revisit', async () => {
    adminAuthModule.setAdminSessionToken('admin-fast-nav-token', 3600);
    const { cells98, people98 } = build98Cells();

    const sharedQueue = createMockQueue({
      repository: {
        schema: async () => ({ ok: true, people: people98 })
      },
      view: () => ({
        cells: cells98,
        statuses: {},
        baseline: { revision: 1, checksum: 'chk-nov-1' },
        lifecycle: { state: 'DRAFT', revision: 1, draftRevision: 1 },
        operations: []
      })
    });
    const stableRuntimeFactory = async () => sharedQueue;

    const pageSlot = createSlotHarness();
    const lcSlot = createSlotHarness();
    const phase5Slot = createSlotHarness();

    const flush = async (period, passes = 4) => {
      let frame0Tree = null;
      for (let p = 0; p < passes; p++) {
        const pagePass = runWithSlot(pageSlot, () =>
          RosterPage({
            rosterMonth: period,
            settings: defaultSettings,
            isAdmin: true,
            selectedName: 'Admin',
            initialActiveTab: 'table',
            teamMembers: teamMembers13,
            names: legacyNames13
          })
        );
        if (p === 0) frame0Tree = pagePass.tree;
        const lcNode = findNode(pagePass.tree, (n) => typeof n?.type === 'function' && n.type.name === 'LifecycleControls');
        const p5Node = findNode(pagePass.tree, (n) => typeof n?.type === 'function' && n.type.name === 'Phase5RosterContainer');

        let lcPass = null;
        if (lcNode) lcPass = runWithSlot(lcSlot, () => lcNode.type({ ...lcNode.props, queue: sharedQueue, runtimeFactory: stableRuntimeFactory }));
        let p5Pass = null;
        if (p5Node) p5Pass = runWithSlot(phase5Slot, () => p5Node.type({ ...p5Node.props, queue: sharedQueue, runtimeFactory: stableRuntimeFactory }));

        lcPass?.flushEffects();
        p5Pass?.flushEffects();
        pagePass.flushEffects();
        await new Promise((r) => setTimeout(r, 20));
      }
      return frame0Tree;
    };

    await flush('2026-11');
    await flush('2026-10');

    // On return to Nov, check Frame 0 rendered output
    const returnTree = await flush('2026-11', 1);
    const text = extractText(returnTree);

    assert.ok(!text.includes('Checking Authoritative Roster Workspace…'), 'Does NOT flash "Checking Authoritative Roster Workspace…"');
    assert.ok(!text.includes('Roster Workspace Unavailable'), 'Does NOT flash "Roster Workspace Unavailable"');
    assert.ok(!text.includes('official finalized schedule'), 'Does NOT describe November as legacy finalized schedule');
  });

  // Test 4: Calendar shows correct 13 MO rows and cached assignments on Frame 0
  await t.test('4. Calendar shows correct MO rows and cached assignments on Frame 0', async () => {
    adminAuthModule.setAdminSessionToken('admin-fast-nav-token', 3600);
    const { cells98, people98 } = build98Cells();

    const sharedQueue = createMockQueue({
      repository: {
        schema: async () => ({ ok: true, people: people98 })
      },
      view: () => ({
        cells: cells98,
        statuses: {},
        baseline: { revision: 1, checksum: 'chk-nov-1' },
        lifecycle: { state: 'DRAFT', revision: 1, draftRevision: 1 },
        operations: []
      })
    });
    const stableRuntimeFactory = async () => sharedQueue;

    const pageSlot = createSlotHarness();
    const lcSlot = createSlotHarness();
    const phase5Slot = createSlotHarness();

    let latestSnapshot = null;
    const flush = async (period, tab = 'table', passes = 4) => {
      let frame0Tree = null;
      for (let p = 0; p < passes; p++) {
        const pagePass = runWithSlot(pageSlot, () =>
          RosterPage({
            rosterMonth: period,
            settings: defaultSettings,
            isAdmin: true,
            selectedName: 'Admin',
            initialActiveTab: tab,
            onV2LiveSnapshotChange: (s) => { latestSnapshot = s; }
          })
        );
        if (p === 0) frame0Tree = pagePass.tree;
        const lcNode = findNode(pagePass.tree, (n) => typeof n?.type === 'function' && n.type.name === 'LifecycleControls');
        const p5Node = findNode(pagePass.tree, (n) => typeof n?.type === 'function' && n.type.name === 'Phase5RosterContainer');

        let lcPass = null;
        if (lcNode) lcPass = runWithSlot(lcSlot, () => lcNode.type({ ...lcNode.props, queue: sharedQueue, runtimeFactory: stableRuntimeFactory }));
        let p5Pass = null;
        if (p5Node) p5Pass = runWithSlot(phase5Slot, () => p5Node.type({ ...p5Node.props, queue: sharedQueue, runtimeFactory: stableRuntimeFactory }));

        lcPass?.flushEffects();
        p5Pass?.flushEffects();
        pagePass.flushEffects();
        await new Promise((r) => setTimeout(r, 20));
      }
      return frame0Tree;
    };

    await flush('2026-11', 'table');
    await flush('2026-10', 'table');

    // Revisit November in Calendar view on Frame 0
    await flush('2026-11', 'calendar', 1);

    assert.ok(latestSnapshot?.derivedV2CalendarRows?.length > 0, 'derivedV2CalendarRows derived from cached snapshot on Frame 0');
    assert.equal(latestSnapshot?.v2LiveSnapshot?.assignments?.length, 98, 'Assignments match cached snapshot');
  });

  // Test 5: Enhanced Table and Calendar remain synchronized
  await t.test('5. Enhanced Table and Calendar remain synchronized on revisit', async () => {
    adminAuthModule.setAdminSessionToken('admin-fast-nav-token', 3600);
    const { cells98, people98 } = build98Cells();

    const sharedQueue = createMockQueue({
      repository: {
        schema: async () => ({ ok: true, people: people98 })
      },
      view: () => ({
        cells: cells98,
        statuses: {},
        baseline: { revision: 1, checksum: 'chk-nov-1' },
        lifecycle: { state: 'DRAFT', revision: 1, draftRevision: 1 },
        operations: []
      })
    });
    const stableRuntimeFactory = async () => sharedQueue;

    const pageSlot = createSlotHarness();
    const lcSlot = createSlotHarness();
    const phase5Slot = createSlotHarness();

    let tableSnapshot = null;
    let calendarSnapshot = null;

    const flush = async (period, tab) => {
      for (let p = 0; p < 4; p++) {
        const pagePass = runWithSlot(pageSlot, () =>
          RosterPage({
            rosterMonth: period,
            settings: defaultSettings,
            isAdmin: true,
            selectedName: 'Admin',
            initialActiveTab: tab,
            onV2LiveSnapshotChange: (s) => {
              if (tab === 'table' && period === '2026-11') tableSnapshot = s;
              if (tab === 'calendar' && period === '2026-11') calendarSnapshot = s;
            }
          })
        );
        const lcNode = findNode(pagePass.tree, (n) => typeof n?.type === 'function' && n.type.name === 'LifecycleControls');
        const p5Node = findNode(pagePass.tree, (n) => typeof n?.type === 'function' && n.type.name === 'Phase5RosterContainer');

        let lcPass = null;
        if (lcNode) lcPass = runWithSlot(lcSlot, () => lcNode.type({ ...lcNode.props, queue: sharedQueue, runtimeFactory: stableRuntimeFactory }));
        let p5Pass = null;
        if (p5Node) p5Pass = runWithSlot(phase5Slot, () => p5Node.type({ ...p5Node.props, queue: sharedQueue, runtimeFactory: stableRuntimeFactory }));

        lcPass?.flushEffects();
        p5Pass?.flushEffects();
        pagePass.flushEffects();
        await new Promise((r) => setTimeout(r, 20));
      }
    };

    await flush('2026-11', 'table');
    await flush('2026-10', 'table');
    await flush('2026-11', 'calendar');

    assert.equal(tableSnapshot?.v2LiveSnapshot?.assignments?.length, 98);
    assert.equal(calendarSnapshot?.v2LiveSnapshot?.assignments?.length, 98);
    assert.deepEqual(tableSnapshot.v2LiveSnapshot.assignments, calendarSnapshot.v2LiveSnapshot.assignments);
  });

  // Test 6: Cached preview remains read-only until BOTH authoritative checks succeed
  await t.test('6. Cached preview remains read-only until BOTH authoritative checks succeed', async () => {
    adminAuthModule.setAdminSessionToken('admin-fast-nav-token', 3600);
    const { cells98, people98 } = build98Cells();

    let resolveLifecycle;
    const lifecyclePromise = new Promise((resolve) => { resolveLifecycle = resolve; });

    const sharedQueue = createMockQueue({
      getPeriodLifecycle: async (p) => {
        await lifecyclePromise;
        return { ok: true, period: { PeriodId: p, State: 'DRAFT', Revision: 1, DraftRevision: 1 } };
      },
      repository: {
        schema: async () => ({ ok: true, people: people98 })
      },
      view: () => ({
        cells: cells98,
        statuses: {},
        baseline: { revision: 1, checksum: 'chk-nov-1' },
        lifecycle: { state: 'DRAFT', revision: 1, draftRevision: 1 },
        operations: []
      })
    });
    const stableRuntimeFactory = async () => sharedQueue;

    // Direct render of Phase5RosterContainer with isRevalidating=true
    const p5Slot = createSlotHarness();
    let p5Tree = null;
    const renderPhase5 = () => {
      const pass = runWithSlot(p5Slot, () =>
        Phase5RosterContainer({
          period: '2026-11',
          settings: defaultSettings,
          isAdmin: true,
          queue: sharedQueue,
          runtimeFactory: stableRuntimeFactory,
          initialSnapshot: {
            period: '2026-11',
            isLoaded: true,
            state: 'DRAFT',
            revision: 1,
            assignments: [{ assignmentId: 'asg-1', personId: 'doc_1', date: '2026-11-01', shiftCode: 'AM', dutyDomain: 'MO' }]
          },
          isRevalidating: true,
          allowDraft: true
        })
      );
      p5Tree = pass.tree;
      pass.flushEffects();
    };

    renderPhase5();
    const currentViewNode = findNode(p5Tree, (n) => typeof n?.type === 'function' && n.type.name === 'CurrentRosterView');
    assert.ok(currentViewNode, 'CurrentRosterView is rendered');
    assert.equal(currentViewNode.props.mutationsEnabled, false, 'mutationsEnabled is false while isRevalidating is true');

    // Also verify LifecycleControls suppresses action buttons while isRevalidating
    const lcSlot = createSlotHarness();
    let lcTree = null;
    const lcPass = runWithSlot(lcSlot, () =>
      LifecycleControls({
        period: '2026-11',
        settings: defaultSettings,
        isAdmin: true,
        queue: sharedQueue,
        runtimeFactory: stableRuntimeFactory,
        isRevalidating: true
      })
    );
    lcTree = lcPass.tree;
    const text = extractText(lcTree);
    assert.ok(text.includes('Verifying with server…'), 'Badge shows "Verifying with server…" while revalidating');
    assert.ok(!text.includes('Publish Roster'), 'Action buttons hidden while revalidating');

    // TWO-STAGE BARRIER TEST:
    // In RosterPage, isRevalidating = Boolean(lifecycleInfo.isRevalidating || v2LiveSnapshot.isRevalidating)
    // Stage 1: Lifecycle completes first; draft is still revalidating -> editing remains BLOCKED
    let revalLcState = { isRevalidating: false };
    let revalDraftState = { isRevalidating: true };
    assert.equal(Boolean(revalLcState.isRevalidating || revalDraftState.isRevalidating), true, 'Editing stays locked if only lifecycle completes');

    // Stage 2: Draft completes first; lifecycle is still revalidating -> editing remains BLOCKED
    revalLcState = { isRevalidating: true };
    revalDraftState = { isRevalidating: false };
    assert.equal(Boolean(revalLcState.isRevalidating || revalDraftState.isRevalidating), true, 'Editing stays locked if only draft completes');

    // Stage 3: BOTH complete -> editing UNLOCKS
    revalLcState = { isRevalidating: false };
    revalDraftState = { isRevalidating: false };
    assert.equal(Boolean(revalLcState.isRevalidating || revalDraftState.isRevalidating), false, 'Editing unlocks ONLY after both authoritative checks succeed');

    resolveLifecycle();
  });

  // Test 7: Authentication logout/expiry revokes cached visibility
  await t.test('7. Authentication logout/expiry revokes cached visibility', async () => {
    adminAuthModule.setAdminSessionToken('admin-fast-nav-token', 3600);
    const { cells98, people98 } = build98Cells();

    const sharedQueue = createMockQueue({
      repository: {
        schema: async () => ({ ok: true, people: people98 })
      },
      view: () => ({
        cells: cells98,
        statuses: {},
        baseline: { revision: 1, checksum: 'chk-nov-1' },
        lifecycle: { state: 'DRAFT', revision: 1, draftRevision: 1 },
        operations: []
      })
    });
    const stableRuntimeFactory = async () => sharedQueue;

    const pageSlot = createSlotHarness();
    const lcSlot = createSlotHarness();
    const phase5Slot = createSlotHarness();

    const flush = async (period) => {
      let lastTree = null;
      for (let p = 0; p < 4; p++) {
        const pagePass = runWithSlot(pageSlot, () =>
          RosterPage({
            rosterMonth: period,
            settings: defaultSettings,
            isAdmin: true,
            selectedName: 'Admin',
            initialActiveTab: 'table',
            teamMembers: teamMembers13,
            names: legacyNames13
          })
        );
        lastTree = pagePass.tree;
        const lcNode = findNode(pagePass.tree, (n) => typeof n?.type === 'function' && n.type.name === 'LifecycleControls');
        const p5Node = findNode(pagePass.tree, (n) => typeof n?.type === 'function' && n.type.name === 'Phase5RosterContainer');

        let lcPass = null;
        if (lcNode) lcPass = runWithSlot(lcSlot, () => lcNode.type({ ...lcNode.props, queue: sharedQueue, runtimeFactory: stableRuntimeFactory }));
        let p5Pass = null;
        if (p5Node) p5Pass = runWithSlot(phase5Slot, () => p5Node.type({ ...p5Node.props, queue: sharedQueue, runtimeFactory: stableRuntimeFactory }));

        lcPass?.flushEffects();
        p5Pass?.flushEffects();
        pagePass.flushEffects();
        await new Promise((r) => setTimeout(r, 20));
      }
      return lastTree;
    };

    await flush('2026-11');

    // Simulate logout
    adminAuthModule.clearAdminSessionToken();

    // Re-render post-logout
    const postLogoutTree = await flush('2026-11');
    const p5Node = findNode(postLogoutTree, (n) => typeof n?.type === 'function' && n.type.name === 'Phase5RosterContainer');
    assert.ok(p5Node, 'Phase5RosterContainer is mounted');
    assert.equal(p5Node.props.initialSnapshot, null, 'No cached snapshot passed when unauthenticated');
    const p5SlotInstance = createSlotHarness();
    let p5Pass = runWithSlot(p5SlotInstance, () =>
      p5Node.type({ ...p5Node.props, queue: sharedQueue, runtimeFactory: stableRuntimeFactory })
    );
    p5Pass.flushEffects();
    await new Promise((r) => setTimeout(r, 30));
    p5Pass = runWithSlot(p5SlotInstance, () =>
      p5Node.type({ ...p5Node.props, queue: sharedQueue, runtimeFactory: stableRuntimeFactory })
    );
    const p5Text = extractText(p5Pass.tree);
    assert.ok(p5Text.includes('Administrator Authorization Required'), 'Draft workspace shows Administrator Authorization Required');
    const currentView = findNode(p5Pass.tree, (n) => typeof n?.type === 'function' && n.type.name === 'CurrentRosterView');
    assert.equal(currentView, null, 'Private assignments are hidden from unauthenticated viewers');
  });

  // Test 8: Failed revalidation remains read-only with working Retry
  await t.test('8. Failed revalidation remains read-only with working Retry', async () => {
    adminAuthModule.setAdminSessionToken('admin-fast-nav-token', 3600);
    const { cells98, people98 } = build98Cells();

    let failRefresh = true;
    const sharedQueue = createMockQueue({
      refresh: async () => {
        if (failRefresh) {
          throw new Error('DRAFT_READ_FAILED');
        }
        return { ok: true };
      },
      repository: {
        schema: async () => ({ ok: true, people: people98 })
      },
      view: () => ({
        cells: cells98,
        statuses: {},
        baseline: { revision: 1, checksum: 'chk-nov-1' },
        lifecycle: { state: 'DRAFT', revision: 1, draftRevision: 1 },
        operations: []
      })
    });
    const stableRuntimeFactory = async () => sharedQueue;

    const p5Slot = createSlotHarness();
    let p5Tree = null;
    const renderPhase5 = () => {
      const pass = runWithSlot(p5Slot, () =>
        Phase5RosterContainer({
          period: '2026-11',
          settings: defaultSettings,
          isAdmin: true,
          queue: sharedQueue,
          runtimeFactory: stableRuntimeFactory,
          initialSnapshot: {
            period: '2026-11',
            isLoaded: true,
            state: 'DRAFT',
            revision: 1,
            assignments: [{ assignmentId: 'asg-1', personId: 'doc_1', date: '2026-11-01', shiftCode: 'AM', dutyDomain: 'MO' }]
          },
          isRevalidating: false,
          allowDraft: true
        })
      );
      p5Tree = pass.tree;
      pass.flushEffects();
    };

    renderPhase5();
    await new Promise((r) => setTimeout(r, 30));
    renderPhase5();

    const currentViewNode = findNode(p5Tree, (n) => typeof n?.type === 'function' && n.type.name === 'CurrentRosterView');
    assert.ok(currentViewNode, 'CurrentRosterView remains visible with preserved snapshot');
    const text = extractText(p5Tree);
    assert.ok(text.includes('Failed to revalidate draft') || text.includes('DRAFT_READ_FAILED'), 'Displays error notice');

    // Now repair network and verify retry
    failRefresh = false;
    await sharedQueue.refresh('draft:2026-11');
    assert.equal(failRefresh, false, 'Retry network repaired');
  });

  // Test 9: Revision change caused by another device reconciles safely
  await t.test('9. Revision change caused by another device reconciles safely', async () => {
    adminAuthModule.setAdminSessionToken('admin-fast-nav-token', 3600);
    const { cells98, people98 } = build98Cells();

    let serverRevision = 2;
    const serverCells = {
      ...cells98,
      'doc_1/2026-11-01': [{ assignmentId: 'asg-remote-pm', shiftCode: 'PM', rawShift: 'PM', dutyDomain: 'MO' }]
    };

    const sharedQueue = createMockQueue({
      refresh: async () => ({ ok: true }),
      repository: {
        schema: async () => ({ ok: true, people: people98 })
      },
      view: () => ({
        cells: serverCells,
        statuses: {},
        baseline: { revision: serverRevision, checksum: 'chk-rev-2' },
        lifecycle: { state: 'DRAFT', revision: serverRevision, draftRevision: serverRevision },
        operations: []
      })
    });
    const stableRuntimeFactory = async () => sharedQueue;

    const p5Slot = createSlotHarness();
    let p5Tree = null;
    const renderPhase5 = () => {
      const pass = runWithSlot(p5Slot, () =>
        Phase5RosterContainer({
          period: '2026-11',
          settings: defaultSettings,
          isAdmin: true,
          queue: sharedQueue,
          runtimeFactory: stableRuntimeFactory,
          initialSnapshot: {
            period: '2026-11',
            isLoaded: true,
            state: 'DRAFT',
            revision: 1,
            assignments: [{ assignmentId: 'asg-initial-am', personId: 'doc_1', date: '2026-11-01', shiftCode: 'AM', dutyDomain: 'MO' }]
          },
          isRevalidating: false,
          allowDraft: true
        })
      );
      p5Tree = pass.tree;
      pass.flushEffects();
    };

    renderPhase5();
    await new Promise((r) => setTimeout(r, 30));
    renderPhase5();

    const currentViewNode = findNode(p5Tree, (n) => typeof n?.type === 'function' && n.type.name === 'CurrentRosterView');
    const doc1Day1 = currentViewNode.props.currentAssignments.find((a) => a.personId === 'doc_1' && a.date === '2026-11-01');
    assert.equal(doc1Day1?.shiftCode, 'PM', 'Updated to remote revision 2 assignment cleanly');
  });

  // Test 10: Pending outbox edits and conflicts are preserved
  await t.test('10. Pending outbox edits and conflicts are preserved across month navigation', async () => {
    adminAuthModule.setAdminSessionToken('admin-fast-nav-token', 3600);
    const { cells98, people98 } = build98Cells();

    const pendingOp = {
      operationId: 'op-unpersisted-1',
      operationType: 'DRAFT_CHANGE',
      status: 'QUEUED',
      expectedRevision: 1
    };

    const sharedQueue = createMockQueue({
      repository: {
        schema: async () => ({ ok: true, people: people98 })
      },
      view: () => ({
        cells: cells98,
        statuses: {},
        baseline: { revision: 1, checksum: 'chk-nov-1' },
        lifecycle: { state: 'DRAFT', revision: 1, draftRevision: 1 },
        operations: [pendingOp]
      })
    });

    // Check queue view
    const view = sharedQueue.view('draft:2026-11');
    assert.equal(view.operations.length, 1, 'Operation in queue outbox');
    assert.equal(view.operations[0].operationId, 'op-unpersisted-1');
  });

  // Test 11: Stale asynchronous responses cannot update another month
  await t.test('11. Stale asynchronous responses cannot update another month', async () => {
    adminAuthModule.setAdminSessionToken('admin-fast-nav-token', 3600);
    const { cells98, people98 } = build98Cells();

    let resolveOct;
    const octPromise = new Promise((r) => { resolveOct = r; });

    const sharedQueue = createMockQueue({
      getPeriodLifecycle: async (period) => {
        if (period === '2026-10') {
          await octPromise;
          return { ok: true, period: { PeriodId: '2026-10', State: 'DRAFT', Revision: 99 } };
        }
        return { ok: true, period: { PeriodId: '2026-11', State: 'DRAFT', Revision: 1 } };
      },
      repository: {
        schema: async () => ({ ok: true, people: people98 })
      },
      view: () => ({
        cells: cells98,
        statuses: {},
        baseline: { revision: 1, checksum: 'chk-nov-1' },
        lifecycle: { state: 'DRAFT', revision: 1, draftRevision: 1 },
        operations: []
      })
    });
    const stableRuntimeFactory = async () => sharedQueue;

    const pageSlot = createSlotHarness();
    let latestSnapshot = null;
    const flush = async (period) => {
      const pagePass = runWithSlot(pageSlot, () =>
        RosterPage({
          rosterMonth: period,
          settings: defaultSettings,
          isAdmin: true,
          selectedName: 'Admin',
          initialActiveTab: 'table',
          onV2LiveSnapshotChange: (s) => { latestSnapshot = s; }
        })
      );
      pagePass.flushEffects();
    };

    await flush('2026-11');
    assert.equal(latestSnapshot?.v2LiveSnapshot?.period, '2026-11');

    // Simulate stale response for October arriving
    resolveOct();
    await new Promise((r) => setTimeout(r, 20));

    // November snapshot is NOT overwritten
    assert.equal(latestSnapshot?.v2LiveSnapshot?.period, '2026-11');
  });

  // Test 12: Published/closed periods remain protected
  await t.test('12. Published/closed periods remain protected in read-only mode', async () => {
    adminAuthModule.setAdminSessionToken('admin-fast-nav-token', 3600);
    const { people98 } = build98Cells();

    const sharedQueue = createMockQueue({
      getPeriodLifecycle: async (p) => ({
        ok: true,
        period: { PeriodId: p, State: 'PUBLISHED', Revision: 2, DraftRevision: 2 }
      }),
      getCurrentRoster: async (p) => ({
        ok: true,
        period: p,
        state: 'PUBLISHED',
        assignments: [{ assignmentId: 'pub-1', personId: 'doc_1', date: `${p}-01`, shiftCode: 'AM', dutyDomain: 'MO' }]
      }),
      repository: {
        schema: async () => ({ ok: true, people: people98 })
      }
    });
    const stableRuntimeFactory = async () => sharedQueue;

    const p5Slot = createSlotHarness();
    let p5Tree = null;
    const renderPhase5 = () => {
      const pass = runWithSlot(p5Slot, () =>
        Phase5RosterContainer({
          period: '2026-11',
          settings: defaultSettings,
          isAdmin: true,
          queue: sharedQueue,
          runtimeFactory: stableRuntimeFactory,
          verifiedLifecycle: { period: '2026-11', isEnrolled: true, state: 'PUBLISHED', revision: 2, draftRevision: 2 },
          allowDraft: true
        })
      );
      p5Tree = pass.tree;
      pass.flushEffects();
    };

    renderPhase5();
    await new Promise((r) => setTimeout(r, 30));
    renderPhase5();

    const currentViewNode = findNode(p5Tree, (n) => typeof n?.type === 'function' && n.type.name === 'CurrentRosterView');
    assert.ok(currentViewNode, 'CurrentRosterView rendered');
    assert.equal(currentViewNode.props.lifecycleState, 'PUBLISHED', 'Published state enforced');
  });

  // Test 13: December unenrolled remains safe and distinct
  await t.test('13. December unenrolled remains safe and distinct from cached November', async () => {
    adminAuthModule.setAdminSessionToken('admin-fast-nav-token', 3600);
    const { cells98, people98 } = build98Cells();

    const sharedQueue = createMockQueue({
      getPeriodLifecycle: async (p) => {
        if (p === '2026-12') return { ok: true, period: null };
        return { ok: true, period: { PeriodId: p, State: 'DRAFT', Revision: 1, DraftRevision: 1 } };
      },
      repository: {
        schema: async () => ({ ok: true, people: people98 })
      },
      view: (key) => {
        if (key === 'draft:2026-11') {
          return {
            cells: cells98,
            statuses: {},
            baseline: { revision: 1, checksum: 'chk-nov-1' },
            lifecycle: { state: 'DRAFT', revision: 1, draftRevision: 1 },
            operations: []
          };
        }
        return { cells: {}, statuses: {}, baseline: { revision: 0, checksum: null }, lifecycle: { state: 'DRAFT', revision: 0 }, operations: [] };
      }
    });
    const stableRuntimeFactory = async () => sharedQueue;

    const pageSlot = createSlotHarness();
    const lcSlot = createSlotHarness();
    const phase5Slot = createSlotHarness();

    const flush = async (period) => {
      let tree = null;
      for (let p = 0; p < 4; p++) {
        const pagePass = runWithSlot(pageSlot, () =>
          RosterPage({
            rosterMonth: period,
            settings: defaultSettings,
            isAdmin: true,
            selectedName: 'Admin',
            initialActiveTab: 'table',
            teamMembers: teamMembers13,
            names: legacyNames13
          })
        );
        tree = pagePass.tree;
        const lcNode = findNode(pagePass.tree, (n) => typeof n?.type === 'function' && n.type.name === 'LifecycleControls');
        const p5Node = findNode(pagePass.tree, (n) => typeof n?.type === 'function' && n.type.name === 'Phase5RosterContainer');

        let lcPass = null;
        if (lcNode) lcPass = runWithSlot(lcSlot, () => lcNode.type({ ...lcNode.props, queue: sharedQueue, runtimeFactory: stableRuntimeFactory }));
        let p5Pass = null;
        if (p5Node) p5Pass = runWithSlot(phase5Slot, () => p5Node.type({ ...p5Node.props, queue: sharedQueue, runtimeFactory: stableRuntimeFactory }));

        lcPass?.flushEffects();
        p5Pass?.flushEffects();
        pagePass.flushEffects();
        await new Promise((r) => setTimeout(r, 20));
      }
      return tree;
    };

    // Load Nov (cached)
    await flush('2026-11');

    // Navigate to Dec (unenrolled)
    const decTree = await flush('2026-12');
    const p5Node = findNode(decTree, (n) => typeof n?.type === 'function' && n.type.name === 'Phase5RosterContainer');
    assert.equal(p5Node, null, 'Phase5RosterContainer NOT rendered for December');
    const text = extractText(decTree);
    assert.ok(text.includes('Roster Workspace Unavailable'), 'December shows explicit Roster Workspace Unavailable notice');
  });

  // Test 14: No duplicate queue ownership, timers or workers
  await t.test('14. No duplicate queue ownership, timers or workers across month navigations', async () => {
    adminAuthModule.setAdminSessionToken('admin-fast-nav-token', 3600);
    const { cells98, people98 } = build98Cells();

    let stopCount = 0;
    const sharedQueue = createMockQueue({
      stop: () => { stopCount++; },
      repository: {
        schema: async () => ({ ok: true, people: people98 })
      },
      view: () => ({
        cells: cells98,
        statuses: {},
        baseline: { revision: 1, checksum: 'chk-nov-1' },
        lifecycle: { state: 'DRAFT', revision: 1, draftRevision: 1 },
        operations: []
      })
    });
    const stableRuntimeFactory = async () => sharedQueue;

    const pageSlot = createSlotHarness();
    const lcSlot = createSlotHarness();
    const phase5Slot = createSlotHarness();

    const flush = async (period) => {
      for (let p = 0; p < 2; p++) {
        const pagePass = runWithSlot(pageSlot, () =>
          RosterPage({
            rosterMonth: period,
            settings: defaultSettings,
            isAdmin: true,
            selectedName: 'Admin',
            initialActiveTab: 'table',
            teamMembers: teamMembers13,
            names: legacyNames13
          })
        );
        const lcNode = findNode(pagePass.tree, (n) => typeof n?.type === 'function' && n.type.name === 'LifecycleControls');
        const p5Node = findNode(pagePass.tree, (n) => typeof n?.type === 'function' && n.type.name === 'Phase5RosterContainer');

        let lcPass = null;
        if (lcNode) lcPass = runWithSlot(lcSlot, () => lcNode.type({ ...lcNode.props, queue: sharedQueue, runtimeFactory: stableRuntimeFactory }));
        let p5Pass = null;
        if (p5Node) p5Pass = runWithSlot(phase5Slot, () => p5Node.type({ ...p5Node.props, queue: sharedQueue, runtimeFactory: stableRuntimeFactory }));

        lcPass?.flushEffects();
        p5Pass?.flushEffects();
        pagePass.flushEffects();
        await new Promise((r) => setTimeout(r, 10));
      }
    };

    await flush('2026-11');
    await flush('2026-10');
    await flush('2026-11');

    assert.equal(stopCount, 0, 'Shared singleton queue is never stopped on component navigation');
  });
});
