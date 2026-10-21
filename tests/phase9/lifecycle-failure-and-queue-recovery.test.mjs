import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import React from 'react';
import ReactDOMServer from 'react-dom/server';

import * as adminAuthModule from '../../src/features/roster/auth/adminAuth.js';

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
      '../auth/adminAuth.js',
      './auth/adminAuth.js'
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
      schema: async () => ({
        ok: true,
        draftWritesEnabled: true,
        people: [{ PersonId: 'doc_1', CurrentDisplayName: 'Doctor 1', DirectoryType: 'MO' }]
      })
    },
    entities: new Map(),
    ...restOverrides
  };
  return queue;
}

const build98Cells = () => {
  const people98 = Array.from({ length: 7 }, (_, i) => ({
    personId: `doc_${i + 1}`,
    name: `Doctor ${i + 1}`,
    dutyDomain: 'MO',
    role: 'MO',
    active: true
  }));
  const cells98 = {};
  for (let pIdx = 0; pIdx < 7; pIdx++) {
    for (let day = 1; day <= 14; day++) {
      const dd = String(day).padStart(2, '0');
      const shiftCode = day % 2 === 0 ? 'PM' : 'AM';
      cells98[`doc_${pIdx + 1}/2026-11-${dd}`] = [
        {
          assignmentId: `doc_${pIdx + 1}:2026-11-${dd}:MO:${shiftCode}`,
          shiftCode,
          rawShift: shiftCode,
          dutyDomain: 'MO'
        }
      ];
    }
  }
  return { people98, cells98 };
};

test('Slice B3a.3: Lifecycle Failure and Shared Queue Correction Suite', async (t) => {
  let Phase5RosterContainer;
  let LifecycleControls;
  let DraftQueuePanel;
  let RosterPage;

  t.before(async () => {
    Phase5RosterContainer = await loadJsxComponent('src/features/roster/components/Phase5RosterContainer.jsx');
    LifecycleControls = await loadJsxComponent('src/features/roster/components/LifecycleControls.jsx');
    DraftQueuePanel = await loadJsxComponent('src/features/roster/components/DraftQueuePanel.jsx');
    RosterPage = await loadJsxComponent('src/components/RosterPage.jsx');
  });

  t.afterEach(() => {
    adminAuthModule.clearAdminSessionToken();
  });

  // Harness for running components with React hooks
  const createSlotHarness = () => ({
    states: new Map(),
    refs: new Map(),
    callbacks: new Map(),
    prevDeps: new Map(),
    cleanups: new Map()
  });

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

  const unmountSlot = (slot) => {
    for (const cleanup of slot.cleanups.values()) {
      if (typeof cleanup === 'function') cleanup();
    }
    slot.cleanups.clear();
  };

  // Test 1: November initial lifecycle and 98-assignment draft load succeeds
  await t.test('1. November initial lifecycle and 98-assignment draft load succeeds', async () => {
    adminAuthModule.setAdminSessionToken('admin-tok-test-1', 3600);
    const { cells98 } = build98Cells();

    const sharedQueue = createMockQueue({
      getPeriodLifecycle: async (p) => ({
        ok: true,
        period: { PeriodId: p, State: 'DRAFT', Revision: 1, DraftRevision: 1 }
      }),
      view: () => ({
        cells: cells98,
        statuses: {},
        baseline: { revision: 1, checksum: 'chk-test-1' },
        lifecycle: { state: 'DRAFT', revision: 1, draftRevision: 1 },
        operations: []
      })
    });
    const stableRuntimeFactory = async () => sharedQueue;

    const pageSlot = createSlotHarness();
    const lcSlot = createSlotHarness();
    const phase5Slot = createSlotHarness();

    const settings = {
      roster_workspace_v2_enabled: true,
      roster_v2_read_enabled: true,
      roster_v2_edit_enabled: true
    };

    let latestSnapshot = null;
    const handleSnapshotChange = (snap) => {
      latestSnapshot = snap;
    };

    const flush = async (period = '2026-11') => {
      for (let pass = 0; pass < 4; pass++) {
        const pagePass = runWithSlot(pageSlot, () =>
          RosterPage({
            rosterMonth: period,
            settings,
            isAdmin: true,
            selectedName: 'Admin',
            initialActiveTab: 'table',
            onV2LiveSnapshotChange: handleSnapshotChange
          })
        );

        const lcNode = findNode(pagePass.tree, (n) => typeof n?.type === 'function' && n.type.name === 'LifecycleControls');
        const p5Node = findNode(pagePass.tree, (n) => typeof n?.type === 'function' && n.type.name === 'Phase5RosterContainer');

        let lcPass = null;
        if (lcNode) {
          lcPass = runWithSlot(lcSlot, () =>
            lcNode.type({ ...lcNode.props, queue: sharedQueue, runtimeFactory: stableRuntimeFactory })
          );
        }

        let p5Pass = null;
        if (p5Node) {
          p5Pass = runWithSlot(phase5Slot, () =>
            p5Node.type({ ...p5Node.props, queue: sharedQueue, runtimeFactory: stableRuntimeFactory })
          );
        }

        lcPass?.flushEffects();
        p5Pass?.flushEffects();
        pagePass.flushEffects();

        await new Promise((r) => setTimeout(r, 20));
      }
    };

    await flush('2026-11');

    assert.equal(sharedQueue.lifecycleCalls.length, 1, 'getPeriodLifecycle called once by LifecycleControls');
    assert.equal(sharedQueue.refreshCalls.length, 1, 'refresh called once for draft:2026-11');
    assert.ok(latestSnapshot?.v2LiveSnapshot?.isLoaded, 'v2LiveSnapshot is marked loaded');
    assert.equal(latestSnapshot.v2LiveSnapshot.assignments.length, 98, 'All 98 assignments loaded');

    unmountSlot(pageSlot);
    unmountSlot(lcSlot);
    unmountSlot(phase5Slot);
  });

  // Test 2: November -> October -> November reloads correctly
  await t.test('2. November -> October -> November reloads correctly', async () => {
    adminAuthModule.setAdminSessionToken('admin-tok-test-2', 3600);
    const { cells98 } = build98Cells();

    const sharedQueue = createMockQueue({
      getPeriodLifecycle: async (p) => {
        if (p === '2026-10') return { ok: true, period: null }; // unenrolled pre-cutover
        return {
          ok: true,
          period: { PeriodId: p, State: 'DRAFT', Revision: 1, DraftRevision: 1 }
        };
      },
      view: () => ({
        cells: cells98,
        statuses: {},
        baseline: { revision: 1, checksum: 'chk-test-2' },
        lifecycle: { state: 'DRAFT', revision: 1, draftRevision: 1 },
        operations: []
      })
    });
    const stableRuntimeFactory = async () => sharedQueue;

    const pageSlot = createSlotHarness();
    const lcSlot = createSlotHarness();
    let phase5Slot = createSlotHarness();
    let phase5Mounted = false;

    const settings = {
      roster_workspace_v2_enabled: true,
      roster_v2_read_enabled: true,
      roster_v2_edit_enabled: true
    };

    let latestSnapshot = null;
    const handleSnapshotChange = (snap) => {
      latestSnapshot = snap;
    };

    const flushTree = async (period, passes = 6) => {
      for (let pass = 0; pass < passes; pass++) {
        const pagePass = runWithSlot(pageSlot, () =>
          RosterPage({
            rosterMonth: period,
            settings,
            isAdmin: true,
            selectedName: 'Admin',
            initialActiveTab: 'table',
            onV2LiveSnapshotChange: handleSnapshotChange
          })
        );

        const lcNode = findNode(pagePass.tree, (n) => typeof n?.type === 'function' && n.type.name === 'LifecycleControls');
        const p5Node = findNode(pagePass.tree, (n) => typeof n?.type === 'function' && n.type.name === 'Phase5RosterContainer');

        let lcPass = null;
        if (lcNode) {
          lcPass = runWithSlot(lcSlot, () =>
            lcNode.type({ ...lcNode.props, queue: sharedQueue, runtimeFactory: stableRuntimeFactory })
          );
        }

        let p5Pass = null;
        if (p5Node) {
          if (!phase5Mounted) {
            phase5Slot = createSlotHarness();
            phase5Mounted = true;
          }
          p5Pass = runWithSlot(phase5Slot, () =>
            p5Node.type({ ...p5Node.props, queue: sharedQueue, runtimeFactory: stableRuntimeFactory })
          );
        } else if (phase5Mounted) {
          unmountSlot(phase5Slot);
          phase5Mounted = false;
        }

        lcPass?.flushEffects();
        p5Pass?.flushEffects();
        pagePass.flushEffects();

        await new Promise((r) => setTimeout(r, 20));
      }
    };

    // Nov 2026
    await flushTree('2026-11');
    assert.equal(phase5Mounted, true, 'Phase 5 mounted for November');
    assert.equal(latestSnapshot?.v2LiveSnapshot?.assignments?.length, 98);

    // Switch to Oct 2026
    await flushTree('2026-10');
    assert.equal(phase5Mounted, false, 'Phase 5 unmounted for October');
    assert.equal(latestSnapshot?.v2LiveSnapshot?.isLoaded, false);

    // Switch back to Nov 2026
    await flushTree('2026-11');
    assert.equal(phase5Mounted, true, 'Phase 5 remounted for November');
    assert.equal(latestSnapshot?.v2LiveSnapshot?.isLoaded, true);
    assert.equal(latestSnapshot?.v2LiveSnapshot?.assignments?.length, 98, '98 assignments restored on return');

    unmountSlot(pageSlot);
    unmountSlot(lcSlot);
    if (phase5Mounted) unmountSlot(phase5Slot);
  });

  // Test 3: Repeated navigation does not stop the singleton queue
  await t.test('3. Repeated navigation does not stop the singleton queue', async () => {
    adminAuthModule.setAdminSessionToken('admin-tok-test-3', 3600);

    let stopCount = 0;
    const mockQueue = createMockQueue({
      stop: () => {
        stopCount++;
      }
    });

    const panelSlot = createSlotHarness();
    const settings = {
      roster_workspace_v2_enabled: true,
      roster_v2_read_enabled: true,
      roster_v2_edit_enabled: true
    };

    // Mount DraftQueuePanel
    const mountPass = runWithSlot(panelSlot, () =>
      DraftQueuePanel({
        period: '2026-11',
        settings,
        runtimeFactory: async () => mockQueue
      })
    );
    mountPass.flushEffects();
    await new Promise((r) => setTimeout(r, 20));

    // Unmount DraftQueuePanel (navigating to another month or unmounting)
    unmountSlot(panelSlot);

    assert.equal(
      stopCount,
      0,
      'DraftQueuePanel unmount MUST NOT call queue.stop() on shared singleton queue'
    );
    mockQueue.bus?.close?.();
  });

  // Test 4: Post-cutover lifecycle transport failure results in explicit error card, not endless Checking
  await t.test('4. Post-cutover lifecycle transport failure results in explicit error card, not endless Checking', async () => {
    adminAuthModule.setAdminSessionToken('admin-tok-test-4', 3600);

    const failingQueue = createMockQueue({
      getPeriodLifecycle: async () => ({
        ok: false,
        error: { code: 'NETWORK_TIMEOUT', message: 'Connection to Apps Script timed out' }
      })
    });
    const stableRuntimeFactory = async () => failingQueue;

    const pageSlot = createSlotHarness();
    const lcSlot = createSlotHarness();

    const settings = {
      roster_workspace_v2_enabled: true,
      roster_v2_read_enabled: true
    };

    let pageTree = null;
    for (let pass = 0; pass < 4; pass++) {
      const pagePass = runWithSlot(pageSlot, () =>
        RosterPage({
          rosterMonth: '2026-11',
          settings,
          isAdmin: true,
          selectedName: 'Admin',
          initialActiveTab: 'table'
        })
      );
      pageTree = pagePass.tree;

      const lcNode = findNode(pageTree, (n) => typeof n?.type === 'function' && n.type.name === 'LifecycleControls');
      let lcPass = null;
      if (lcNode) {
        lcPass = runWithSlot(lcSlot, () =>
          lcNode.type({ ...lcNode.props, queue: failingQueue, runtimeFactory: stableRuntimeFactory })
        );
      }

      lcPass?.flushEffects();
      pagePass.flushEffects();
      await new Promise((r) => setTimeout(r, 20));
    }

    const allText = extractText(pageTree);

    // Verify error card is displayed with Retry Connection button
    assert.ok(
      allText.includes('Authoritative Roster Connection Failed'),
      'Must display "Authoritative Roster Connection Failed" instead of hanging'
    );
    assert.ok(
      !allText.includes('Checking Authoritative Roster Workspace…'),
      'Must NOT remain on "Checking Authoritative Roster Workspace…"'
    );

    const retryBtn = findNode(pageTree, (n) => n?.props?.id === 'btn-retry-lifecycle');
    assert.ok(retryBtn, 'Must render #btn-retry-lifecycle retry button in error card');

    unmountSlot(pageSlot);
    unmountSlot(lcSlot);
  });

  // Test 5: Retry action recovers after a transient failed request
  await t.test('5. Retry action recovers after a transient failed request', async () => {
    adminAuthModule.setAdminSessionToken('admin-tok-test-5', 3600);
    const { cells98 } = build98Cells();

    let shouldFail = true;
    const recoveringQueue = createMockQueue({
      getPeriodLifecycle: async (p) => {
        if (shouldFail) {
          return { ok: false, error: 'TEMPORARY_GATEWAY_ERROR' };
        }
        return {
          ok: true,
          period: { PeriodId: p, State: 'DRAFT', Revision: 1, DraftRevision: 1 }
        };
      },
      view: () => ({
        cells: cells98,
        statuses: {},
        baseline: { revision: 1, checksum: 'chk-5' },
        lifecycle: { state: 'DRAFT', revision: 1, draftRevision: 1 },
        operations: []
      })
    });
    const stableRuntimeFactory = async () => recoveringQueue;

    const pageSlot = createSlotHarness();
    const lcSlot = createSlotHarness();
    let phase5Slot = createSlotHarness();
    let phase5Mounted = false;

    const settings = {
      roster_workspace_v2_enabled: true,
      roster_v2_read_enabled: true
    };

    let latestTree = null;
    const flushPasses = async () => {
      for (let p = 0; p < 4; p++) {
        const pagePass = runWithSlot(pageSlot, () =>
          RosterPage({
            rosterMonth: '2026-11',
            settings,
            isAdmin: true,
            selectedName: 'Admin',
            initialActiveTab: 'table'
          })
        );
        latestTree = pagePass.tree;

        const lcNode = findNode(latestTree, (n) => typeof n?.type === 'function' && n.type.name === 'LifecycleControls');
        const p5Node = findNode(latestTree, (n) => typeof n?.type === 'function' && n.type.name === 'Phase5RosterContainer');

        let lcPass = null;
        if (lcNode) {
          lcPass = runWithSlot(lcSlot, () =>
            lcNode.type({ ...lcNode.props, queue: recoveringQueue, runtimeFactory: stableRuntimeFactory })
          );
        }

        let p5Pass = null;
        if (p5Node) {
          if (!phase5Mounted) {
            phase5Slot = createSlotHarness();
            phase5Mounted = true;
          }
          p5Pass = runWithSlot(phase5Slot, () =>
            p5Node.type({ ...p5Node.props, queue: recoveringQueue, runtimeFactory: stableRuntimeFactory })
          );
        }

        lcPass?.flushEffects();
        p5Pass?.flushEffects();
        pagePass.flushEffects();
        await new Promise((r) => setTimeout(r, 20));
      }
    };

    // Step 1: Initial failure
    await flushPasses();
    let text = extractText(latestTree);
    assert.ok(text.includes('Authoritative Roster Connection Failed'));

    // Step 2: Backend recovers, user clicks retry
    shouldFail = false;
    const retryBtn = findNode(latestTree, (n) => n?.props?.id === 'btn-retry-lifecycle');
    assert.ok(retryBtn, 'Retry button found');
    retryBtn.props.onClick();

    await flushPasses();

    // Step 3: Error card is gone, V2 active
    text = extractText(latestTree);
    assert.ok(!text.includes('Authoritative Roster Connection Failed'), 'Connection error resolved');
    assert.equal(phase5Mounted, true, 'Phase5RosterContainer mounted successfully after retry');

    unmountSlot(pageSlot);
    unmountSlot(lcSlot);
    if (phase5Mounted) unmountSlot(phase5Slot);
  });

  // Test 6: Genuinely unenrolled December remains distinct from transport failure
  await t.test('6. Genuinely unenrolled December remains distinct from transport failure', async () => {
    adminAuthModule.setAdminSessionToken('admin-tok-test-6', 3600);

    const normalQueue = createMockQueue({
      getPeriodLifecycle: async (p) => {
        if (p === '2026-12') return { ok: true, period: null }; // genuinely unenrolled
        return { ok: true, period: { PeriodId: p, State: 'DRAFT', Revision: 1, DraftRevision: 1 } };
      }
    });
    const stableRuntimeFactory = async () => normalQueue;

    const pageSlot = createSlotHarness();
    const lcSlot = createSlotHarness();

    const settings = {
      roster_workspace_v2_enabled: true,
      roster_v2_read_enabled: true
    };

    let pageTree = null;
    for (let pass = 0; pass < 4; pass++) {
      const pagePass = runWithSlot(pageSlot, () =>
        RosterPage({
          rosterMonth: '2026-12',
          settings,
          isAdmin: true,
          selectedName: 'Admin',
          initialActiveTab: 'table'
        })
      );
      pageTree = pagePass.tree;

      const lcNode = findNode(pageTree, (n) => typeof n?.type === 'function' && n.type.name === 'LifecycleControls');
      let lcPass = null;
      if (lcNode) {
        lcPass = runWithSlot(lcSlot, () =>
          lcNode.type({ ...lcNode.props, queue: normalQueue, runtimeFactory: stableRuntimeFactory })
        );
      }

      lcPass?.flushEffects();
      pagePass.flushEffects();
      await new Promise((r) => setTimeout(r, 20));
    }

    const text = extractText(pageTree);
    assert.ok(
      text.includes('Roster Workspace Unavailable'),
      'Must display "Roster Workspace Unavailable" for genuinely unenrolled month'
    );
    assert.ok(
      !text.includes('Authoritative Roster Connection Failed'),
      'Must NOT display "Authoritative Roster Connection Failed" for genuinely unenrolled month'
    );
    assert.ok(
      !text.includes('Checking Authoritative Roster Workspace…'),
      'Must NOT display "Checking Authoritative Roster Workspace…"'
    );
    const retryBtn = findNode(pageTree, (n) => n?.props?.id === 'btn-retry-lifecycle');
    assert.equal(retryBtn, null, 'No retry button for genuinely unenrolled month');

    unmountSlot(pageSlot);
    unmountSlot(lcSlot);
  });

  // Test 7: Late October responses cannot overwrite November's lifecycle
  await t.test('7. Late October responses cannot overwrite November\'s lifecycle', async () => {
    let emittedChanges = [];
    const handleStateChange = (info) => emittedChanges.push(info);

    let resolveOct = null;
    const delayedOctPromise = new Promise((resolve) => {
      resolveOct = resolve;
    });

    const mockQueue = createMockQueue({
      getPeriodLifecycle: async (p) => {
        if (p === '2026-10') {
          return delayedOctPromise;
        }
        return {
          ok: true,
          period: { PeriodId: p, State: 'DRAFT', Revision: 1, DraftRevision: 1 }
        };
      }
    });

    const lcSlot = createSlotHarness();

    // 1. Mount LifecycleControls for 2026-10
    const pass1 = runWithSlot(lcSlot, () =>
      LifecycleControls({
        period: '2026-10',
        settings: { roster_workspace_v2_enabled: true },
        isAdmin: true,
        onLifecycleStateChange: handleStateChange,
        queue: mockQueue,
        runtimeFactory: async () => mockQueue
      })
    );
    pass1.flushEffects();

    // 2. Switch period to 2026-11 before October resolves
    const pass2 = runWithSlot(lcSlot, () =>
      LifecycleControls({
        period: '2026-11',
        settings: { roster_workspace_v2_enabled: true },
        isAdmin: true,
        onLifecycleStateChange: handleStateChange,
        queue: mockQueue,
        runtimeFactory: async () => mockQueue
      })
    );
    pass2.flushEffects();
    await new Promise((r) => setTimeout(r, 20));

    // November completes and emits state
    const novEmission = emittedChanges.find((e) => e.period === '2026-11');
    assert.ok(novEmission, 'November emitted state');
    assert.equal(novEmission.state, 'DRAFT');

    const emissionsBeforeLateOct = emittedChanges.length;

    // 3. Late October response finally resolves
    resolveOct({ ok: true, period: null });
    await new Promise((r) => setTimeout(r, 20));

    // Because requestGenRef / live checks protect against stale responses, no stale emission should occur for the current period
    const staleOverwrites = emittedChanges.slice(emissionsBeforeLateOct).filter((e) => e.period === '2026-11');
    assert.equal(staleOverwrites.length, 0, 'Late October response must not emit or overwrite 2026-11 state');

    unmountSlot(lcSlot);
  });

  // Test 8: No duplicate queue workers or signal buses created
  await t.test('8. No duplicate queue workers or signal buses created', async () => {
    adminAuthModule.setAdminSessionToken('admin-tok-test-8', 3600);

    const existingBus = {
      broadcast: () => {},
      subscribe: () => () => {},
      id: 'existing-bus-singleton'
    };

    const mockQueue = createMockQueue();
    mockQueue.bus = existingBus;

    const panelSlot = createSlotHarness();
    const settings = {
      roster_workspace_v2_enabled: true,
      roster_v2_read_enabled: true,
      roster_v2_edit_enabled: true
    };

    // Mount DraftQueuePanel
    const mountPass = runWithSlot(panelSlot, () =>
      DraftQueuePanel({
        period: '2026-11',
        settings,
        runtimeFactory: async () => mockQueue
      })
    );
    mountPass.flushEffects();
    await new Promise((r) => setTimeout(r, 20));

    // Verify existingBus was NOT replaced
    assert.equal(
      mockQueue.bus,
      existingBus,
      'DraftQueuePanel must NOT overwrite an already existing q.bus'
    );
    assert.equal(mockQueue.bus.id, 'existing-bus-singleton');

    unmountSlot(panelSlot);
  });

  // Test 9: Google admin session remains valid across month switches while unexpired
  await t.test('9. Google admin session remains valid across month switches while unexpired', async () => {
    adminAuthModule.setAdminSessionToken('google-admin-token-valid', 3600);

    assert.equal(adminAuthModule.getAdminSessionToken(), 'google-admin-token-valid');
    assert.equal(adminAuthModule.isSessionTokenActive(), true);

    const pageSlot = createSlotHarness();
    const settings = {
      roster_workspace_v2_enabled: true,
      roster_v2_read_enabled: true
    };

    // Simulate navigation: Nov -> Oct -> Nov -> Dec -> Nov
    for (const m of ['2026-11', '2026-10', '2026-11', '2026-12', '2026-11']) {
      const pass = runWithSlot(pageSlot, () =>
        RosterPage({
          rosterMonth: m,
          settings,
          isAdmin: true,
          selectedName: 'Admin',
          initialActiveTab: 'table'
        })
      );
      pass.flushEffects();
      assert.equal(
        adminAuthModule.getAdminSessionToken(),
        'google-admin-token-valid',
        `Admin token must remain active and preserved during visit to ${m}`
      );
      assert.equal(adminAuthModule.isSessionTokenActive(), true);
    }

    unmountSlot(pageSlot);
  });

  // Test 10: November Calendar/Table consistency and legacy-write protections remain intact
  await t.test('10. November Calendar/Table consistency and legacy-write protections remain intact', async () => {
    adminAuthModule.setAdminSessionToken('admin-tok-test-10', 3600);
    const { cells98 } = build98Cells();

    let masterRosterUploaded = false;
    const mockOnUpload = () => {
      masterRosterUploaded = true;
    };

    const sharedQueue = createMockQueue({
      getPeriodLifecycle: async (p) => ({
        ok: true,
        period: { PeriodId: p, State: 'DRAFT', Revision: 1, DraftRevision: 1 }
      }),
      view: () => ({
        cells: cells98,
        statuses: {},
        baseline: { revision: 1, checksum: 'chk-10' },
        lifecycle: { state: 'DRAFT', revision: 1, draftRevision: 1 },
        operations: []
      })
    });
    const stableRuntimeFactory = async () => sharedQueue;

    const pageSlot = createSlotHarness();
    const lcSlot = createSlotHarness();
    const phase5Slot = createSlotHarness();

    const settings = {
      roster_workspace_v2_enabled: true,
      roster_v2_read_enabled: true,
      roster_v2_edit_enabled: true
    };

    let latestSnapshot = null;
    let renderedPageTree = null;

    const flush = async () => {
      for (let p = 0; p < 4; p++) {
        const pagePass = runWithSlot(pageSlot, () =>
          RosterPage({
            rosterMonth: '2026-11',
            settings,
            isAdmin: true,
            selectedName: 'Admin',
            initialActiveTab: 'calendar',
            onUploadMasterRoster: mockOnUpload,
            onV2LiveSnapshotChange: (snap) => {
              latestSnapshot = snap;
            }
          })
        );
        renderedPageTree = pagePass.tree;

        const lcNode = findNode(renderedPageTree, (n) => typeof n?.type === 'function' && n.type.name === 'LifecycleControls');
        const p5Node = findNode(renderedPageTree, (n) => typeof n?.type === 'function' && n.type.name === 'Phase5RosterContainer');

        let lcPass = null;
        if (lcNode) {
          lcPass = runWithSlot(lcSlot, () =>
            lcNode.type({ ...lcNode.props, queue: sharedQueue, runtimeFactory: stableRuntimeFactory })
          );
        }

        let p5Pass = null;
        if (p5Node) {
          p5Pass = runWithSlot(phase5Slot, () =>
            p5Node.type({ ...p5Node.props, queue: sharedQueue, runtimeFactory: stableRuntimeFactory })
          );
        }

        lcPass?.flushEffects();
        p5Pass?.flushEffects();
        pagePass.flushEffects();
        await new Promise((r) => setTimeout(r, 20));
      }
    };

    await flush();

    // 1. Verify snapshot is loaded with 98 assignments
    assert.ok(latestSnapshot?.v2LiveSnapshot?.isLoaded);
    assert.equal(latestSnapshot.v2LiveSnapshot.assignments.length, 98);

    // 2. Verify legacy upload cannot be triggered for post-cutover period
    assert.equal(masterRosterUploaded, false, 'Legacy onUploadMasterRoster was not called');

    // 3. Header displays working roster for November, never finalized schedule
    const text = extractText(renderedPageTree);
    assert.ok(!text.includes('Displaying the official finalized schedule for November 2026.'));

    unmountSlot(pageSlot);
    unmountSlot(lcSlot);
    unmountSlot(phase5Slot);
  });
});
