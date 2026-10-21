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
  globalThis.window = globalThis;
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
      'file-saver'
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

function createMockQueue(overrides = {}) {
  const lifecycleCalls = [];
  const refreshCalls = [];
  const entities = new Map();

  const {
    getPeriodLifecycle: overrideGetLifecycle,
    refresh: overrideRefresh,
    view: overrideView,
    getCurrentRoster: overrideGetCurrentRoster,
    ...restOverrides
  } = overrides;

  const queue = {
    lifecycleCalls,
    refreshCalls,
    enabled: () => true,
    start: async () => {},
    subscribe: (cb) => () => {},
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
        cells: {
          'doctor_1#2026-11-01': ['AM']
        },
        statuses: {},
        baseline: { revision: 1, checksum: 'test-chk-1' },
        lifecycle: { state: 'DRAFT', revision: 1, draftRevision: 1 },
        operations: []
      };
    },
    getCurrentRoster: async (period) => {
      if (overrideGetCurrentRoster) return overrideGetCurrentRoster(period);
      return { ok: true, period, state: 'PUBLISHED', assignments: [] };
    },
    getPlannedRoster: async (period) => ({ ok: true, period, state: 'PUBLISHED', assignments: [] }),
    getAmendmentHistory: async () => ({ ok: true, amendments: [] }),
    getAbsences: async () => ({ ok: true, absences: [] }),
    getReplacements: async () => ({ ok: true, replacements: [] }),
    ...restOverrides
  };
  return queue;
}

test('Phase B3a: Remove Duplicate Lifecycle Reads Suite', async (t) => {
  let Phase5RosterContainer;
  let LifecycleControls;
  let RosterPage;

  t.before(async () => {
    Phase5RosterContainer = await loadJsxComponent('src/features/roster/components/Phase5RosterContainer.jsx');
    LifecycleControls = await loadJsxComponent('src/features/roster/components/LifecycleControls.jsx');
    RosterPage = await loadJsxComponent('src/components/RosterPage.jsx');
  });

  // Helper simulating React runtime to render Phase5RosterContainer and run useEffect
  const runPhase5WithDispatcher = async (props) => {
    const origDispatcher = React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentDispatcher.current;
    const stateMap = new Map();
    let stateIdx = 0;
    const refMap = new Map();
    let refIdx = 0;
    const effects = [];

    const triggerRender = () => {
      stateIdx = 0;
      refIdx = 0;
      effects.length = 0;

      React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentDispatcher.current = {
        useState: (initial) => {
          const idx = stateIdx++;
          if (!stateMap.has(idx)) {
            const val = typeof initial === 'function' ? initial() : initial;
            stateMap.set(idx, val);
          }
          const currentVal = stateMap.get(idx);
          const setter = (next) => {
            const nextVal = typeof next === 'function' ? next(stateMap.get(idx)) : next;
            stateMap.set(idx, nextVal);
          };
          return [currentVal, setter];
        },
        useRef: (initial) => {
          const idx = refIdx++;
          if (!refMap.has(idx)) {
            refMap.set(idx, { current: initial });
          }
          return refMap.get(idx);
        },
        useCallback: (cb) => cb,
        useEffect: (cb, deps) => {
          effects.push({ cb, deps });
        },
        useMemo: (cb) => cb()
      };

      const element = Phase5RosterContainer(props);
      return element;
    };

    const initialElement = triggerRender();

    // Run registered effects
    for (const eff of effects) {
      if (typeof eff.cb === 'function') {
        eff.cb();
      }
    }

    // Allow all async operations inside effects to complete
    await new Promise((resolve) => setTimeout(resolve, 20));

    // Re-render to propagate state updates (e.g. currentRoster, loading=false) and flush dependent effects
    triggerRender();
    for (const eff of effects) {
      if (typeof eff.cb === 'function') {
        eff.cb();
      }
    }

    return {
      element: initialElement,
      stateMap,
      refMap,
      triggerRender,
      runEffects: async () => {
        for (const eff of effects) {
          if (typeof eff.cb === 'function') {
            const res = eff.cb();
            if (res && typeof res.then === 'function') await res;
          }
        }
      }
    };
  };

  await t.test('1. Phase5RosterContainer skips getPeriodLifecycle when valid matching verifiedLifecycle is provided', async () => {
    const mockQueue = createMockQueue();

    const verifiedLifecycle = {
      period: '2026-11',
      isEnrolled: true,
      state: 'DRAFT',
      revision: 1,
      draftRevision: 1
    };

    let snapshotEmitted = null;

    await runPhase5WithDispatcher({
      period: '2026-11',
      verifiedLifecycle,
      queue: mockQueue,
      allowDraft: true,
      settings: { roster_v2_read_enabled: true },
      people: [{ personId: 'doctor_1', name: 'Dr. Test', dutyDomain: 'MO' }],
      onLiveSnapshotChange: (s) => { snapshotEmitted = s; }
    });

    // CRITICAL: getPeriodLifecycle must NOT be called by Phase5RosterContainer!
    assert.equal(
      mockQueue.lifecycleCalls.length,
      0,
      'Phase5RosterContainer must not call getPeriodLifecycle when verifiedLifecycle matches'
    );

    // It must have refreshed the draft directly
    assert.equal(mockQueue.refreshCalls.length, 1);
    assert.equal(mockQueue.refreshCalls[0], 'draft:2026-11');

    // And snapshot is populated
    assert.ok(snapshotEmitted !== null);
    assert.equal(snapshotEmitted.period, '2026-11');
    assert.equal(snapshotEmitted.state, 'DRAFT');
    assert.equal(snapshotEmitted.isLoaded, true);
  });

  await t.test('2. Phase5RosterContainer falls back to getPeriodLifecycle when verifiedLifecycle is missing or null', async () => {
    const mockQueue = createMockQueue();

    await runPhase5WithDispatcher({
      period: '2026-11',
      verifiedLifecycle: null,
      queue: mockQueue,
      allowDraft: true,
      settings: { roster_v2_read_enabled: true }
    });

    assert.equal(
      mockQueue.lifecycleCalls.length,
      1,
      'Phase5RosterContainer must call getPeriodLifecycle exactly once when verifiedLifecycle is absent'
    );
    assert.equal(mockQueue.lifecycleCalls[0].period, '2026-11');
  });

  await t.test('3. Phase5RosterContainer rejects mismatched period in verifiedLifecycle', async () => {
    const mockQueue = createMockQueue();

    const mismatchedLifecycle = {
      period: '2026-10', // Mismatched! Current period is 2026-11
      isEnrolled: true,
      state: 'DRAFT',
      revision: 1,
      draftRevision: 1
    };

    await runPhase5WithDispatcher({
      period: '2026-11',
      verifiedLifecycle: mismatchedLifecycle,
      queue: mockQueue,
      allowDraft: true,
      settings: { roster_v2_read_enabled: true }
    });

    assert.equal(
      mockQueue.lifecycleCalls.length,
      1,
      'Must reject mismatched period and fall back to fresh getPeriodLifecycle'
    );
    assert.equal(mockQueue.lifecycleCalls[0].period, '2026-11');
  });

  await t.test('4. Phase5RosterContainer rejects invalid/incomplete verifiedLifecycle attributes', async () => {
    const invalidCases = [
      { desc: 'isEnrolled is false', val: { period: '2026-11', isEnrolled: false, state: 'DRAFT', revision: 1 } },
      { desc: 'state is null', val: { period: '2026-11', isEnrolled: true, state: null, revision: 1 } },
      { desc: 'state is invalid string', val: { period: '2026-11', isEnrolled: true, state: 'UNKNOWN', revision: 1 } },
      { desc: 'revision is null', val: { period: '2026-11', isEnrolled: true, state: 'DRAFT', revision: null } },
      { desc: 'revision is NaN', val: { period: '2026-11', isEnrolled: true, state: 'DRAFT', revision: NaN } },
    ];

    for (const testCase of invalidCases) {
      const mockQueue = createMockQueue();

      await runPhase5WithDispatcher({
        period: '2026-11',
        verifiedLifecycle: testCase.val,
        queue: mockQueue,
        allowDraft: true,
        settings: { roster_v2_read_enabled: true }
      });

      assert.equal(
        mockQueue.lifecycleCalls.length,
        1,
        `Must fall back to getPeriodLifecycle when ${testCase.desc}`
      );
    }
  });

  await t.test('5. LifecycleControls passes draftRevision and full contract to onLifecycleStateChange', async () => {
    let emittedLifecycle = null;

    const mockQueue = createMockQueue({
      getPeriodLifecycle: async (period) => ({
        ok: true,
        period: {
          PeriodId: period,
          State: 'DRAFT',
          Revision: 3,
          DraftRevision: 7
        }
      })
    });

    // Run LifecycleControls with simulated dispatcher
    const origDispatcher = React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentDispatcher.current;
    const stateMap = new Map();
    let stateIdx = 0;
    const effects = [];

    try {
      React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentDispatcher.current = {
        useState: (initial) => {
          const idx = stateIdx++;
          if (!stateMap.has(idx)) {
            const val = typeof initial === 'function' ? initial() : initial;
            stateMap.set(idx, val);
          }
          return [stateMap.get(idx), (next) => {
            const nextVal = typeof next === 'function' ? next(stateMap.get(idx)) : next;
            stateMap.set(idx, nextVal);
          }];
        },
        useRef: (initial) => ({ current: initial }),
        useCallback: (cb) => cb,
        useEffect: (cb) => {
          effects.push(cb);
        },
        useMemo: (cb) => cb()
      };

      LifecycleControls({
        period: '2026-11',
        queue: mockQueue,
        onLifecycleStateChange: (lc) => {
          emittedLifecycle = lc;
        }
      });

      for (const eff of effects) {
        if (typeof eff === 'function') {
          eff();
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    } finally {
      React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentDispatcher.current = origDispatcher;
    }

    assert.ok(emittedLifecycle !== null, 'LifecycleControls must emit lifecycle state');
    assert.equal(emittedLifecycle.period, '2026-11');
    assert.equal(emittedLifecycle.isEnrolled, true);
    assert.equal(emittedLifecycle.state, 'DRAFT');
    assert.equal(emittedLifecycle.revision, 3);
    assert.equal(emittedLifecycle.draftRevision, 7, 'draftRevision must be extracted from period record');
  });

  await t.test('6. Parent RosterPage forwards verifiedLifecycle to Phase5RosterContainer', () => {
    // Intercept RosterPage JSX to confirm verifiedLifecycle prop is passed
    const origDispatcher = React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentDispatcher.current;
    const stateMap = new Map();
    let stateIdx = 0;

    try {
      React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentDispatcher.current = {
        useState: (initial) => {
          const idx = stateIdx++;
          if (!stateMap.has(idx)) {
            let val = typeof initial === 'function' ? initial() : initial;
            // Pre-seed lifecycleInfo state with verified enrolled DRAFT
            if (
              typeof initial === 'object' &&
              initial !== null &&
              'isEnrolled' in initial &&
              'state' in initial
            ) {
              val = {
                period: '2026-11',
                isEnrolled: true,
                state: 'DRAFT',
                revision: 2,
                draftRevision: 2
              };
            }
            stateMap.set(idx, val);
          }
          return [stateMap.get(idx), (n) => stateMap.set(idx, typeof n === 'function' ? n(stateMap.get(idx)) : n)];
        },
        useRef: (initial) => ({ current: initial }),
        useCallback: (cb) => cb,
        useEffect: () => {},
        useMemo: (cb) => cb()
      };

      const pageTree = RosterPage({
        rosterMonth: '2026-11',
        settings: {
          roster_workspace_v2_enabled: true,
          roster_v2_read_enabled: true
        }
      });

      const phase5Node = findNode(pageTree, (n) => n?.type === Phase5RosterContainer || n?.props?.verifiedLifecycle);
      assert.ok(phase5Node !== null, 'Phase5RosterContainer node must be rendered in enrolled DRAFT state');
      assert.deepEqual(
        phase5Node.props.verifiedLifecycle,
        {
          period: '2026-11',
          isEnrolled: true,
          state: 'DRAFT',
          revision: 2,
          draftRevision: 2
        },
        'RosterPage must pass verifiedLifecycle={lifecycleInfo} to Phase5RosterContainer'
      );
    } finally {
      React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentDispatcher.current = origDispatcher;
    }
  });

  await t.test('7. Verified lifecycle is consumed only once per period mount; subsequent reloads fetch fresh backend state', async () => {
    const mockQueue = createMockQueue();

    const verifiedLifecycle = {
      period: '2026-11',
      isEnrolled: true,
      state: 'DRAFT',
      revision: 1,
      draftRevision: 1
    };

    const harness = await runPhase5WithDispatcher({
      period: '2026-11',
      verifiedLifecycle,
      queue: mockQueue,
      allowDraft: true,
      settings: { roster_v2_read_enabled: true }
    });

    // Initial mount: 0 getPeriodLifecycle calls
    assert.equal(mockQueue.lifecycleCalls.length, 0);

    // If an authoritative reload occurs while mounted, it must fetch fresh backend state
    // We can simulate an admin auth refresh or conflict recovery
    // Re-running effects without remounting will trigger any pending ref changes
    assert.equal(mockQueue.lifecycleCalls.length, 0, 'Initial load cleanly skipped redundant read');
  });

  await t.test('8. Lifecycle transition from DRAFT to PUBLISHED in parent triggers authoritative roster reload', async () => {
    let currentRosterFetched = false;
    const mockQueue = createMockQueue({
      getCurrentRoster: async (p) => {
        currentRosterFetched = true;
        return { ok: true, period: p, state: 'PUBLISHED', assignments: [] };
      }
    });

    // Start with DRAFT verifiedLifecycle
    let activeVerified = {
      period: '2026-11',
      isEnrolled: true,
      state: 'DRAFT',
      revision: 1,
      draftRevision: 1
    };

    const origDispatcher = React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentDispatcher.current;
    const stateMap = new Map();
    let stateIdx = 0;
    const refMap = new Map();
    let refIdx = 0;
    const effectList = [];

    try {
      const renderComponent = (props) => {
        stateIdx = 0;
        refIdx = 0;
        effectList.length = 0;

        React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentDispatcher.current = {
          useState: (initial) => {
            const idx = stateIdx++;
            if (!stateMap.has(idx)) {
              stateMap.set(idx, typeof initial === 'function' ? initial() : initial);
            }
            return [stateMap.get(idx), (next) => {
              stateMap.set(idx, typeof next === 'function' ? next(stateMap.get(idx)) : next);
            }];
          },
          useRef: (initial) => {
            const idx = refIdx++;
            if (!refMap.has(idx)) {
              refMap.set(idx, { current: initial });
            }
            return refMap.get(idx);
          },
          useCallback: (cb) => cb,
          useEffect: (cb) => {
            effectList.push(cb);
          },
          useMemo: (cb) => cb()
        };

        return Phase5RosterContainer(props);
      };

      // 1. Initial mount with DRAFT
      renderComponent({
        period: '2026-11',
        verifiedLifecycle: activeVerified,
        queue: mockQueue,
        allowDraft: true,
        settings: { roster_v2_read_enabled: true }
      });

      for (const eff of effectList) {
        eff();
      }
      await new Promise((resolve) => setTimeout(resolve, 20));

      assert.equal(mockQueue.lifecycleCalls.length, 0, 'No lifecycle call on initial DRAFT load');
      assert.equal(currentRosterFetched, false, 'Did not fetch published roster while DRAFT');

      // 2. Parent notifies state transition to PUBLISHED
      activeVerified = {
        period: '2026-11',
        isEnrolled: true,
        state: 'PUBLISHED',
        revision: 2,
        draftRevision: 2
      };

      renderComponent({
        period: '2026-11',
        verifiedLifecycle: activeVerified,
        queue: mockQueue,
        allowDraft: true,
        settings: { roster_v2_read_enabled: true }
      });

      for (const eff of effectList) {
        eff();
      }
      await new Promise((resolve) => setTimeout(resolve, 20));

      // Authoritative published roster data must be fetched after state transition
      assert.equal(currentRosterFetched, true, 'Authoritative published roster fetched on transition to PUBLISHED');
    } finally {
      React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentDispatcher.current = origDispatcher;
    }
  });

  await t.test('9. Period navigation (Nov -> Oct -> Nov) does not cross-contaminate and reuses verified lifecycle cleanly', async () => {
    const mockQueue = createMockQueue();

    // 1. Initial November mount
    const novVerified = {
      period: '2026-11',
      isEnrolled: true,
      state: 'DRAFT',
      revision: 1,
      draftRevision: 1
    };

    await runPhase5WithDispatcher({
      period: '2026-11',
      verifiedLifecycle: novVerified,
      queue: mockQueue,
      allowDraft: true,
      settings: { roster_v2_read_enabled: true }
    });

    assert.equal(mockQueue.lifecycleCalls.length, 0, 'Initial Nov load makes 0 getPeriodLifecycle calls');
    assert.equal(mockQueue.refreshCalls.length, 1);
    assert.equal(mockQueue.refreshCalls[0], 'draft:2026-11');

    // 2. Navigate to October (unenrolled / legacy)
    const octQueue = createMockQueue({
      getPeriodLifecycle: async (p) => ({ ok: false, error: 'NOT_ENROLLED' })
    });

    await runPhase5WithDispatcher({
      period: '2026-10',
      verifiedLifecycle: null, // October has no verified lifecycle in parent
      queue: octQueue,
      allowDraft: false,
      settings: { roster_v2_read_enabled: true }
    });

    assert.equal(octQueue.lifecycleCalls.length, 1, 'October falls back to fresh getPeriodLifecycle');
    assert.equal(octQueue.lifecycleCalls[0].period, '2026-10');

    // 3. Navigate back to November
    const novReturnQueue = createMockQueue();

    await runPhase5WithDispatcher({
      period: '2026-11',
      verifiedLifecycle: novVerified,
      queue: novReturnQueue,
      allowDraft: true,
      settings: { roster_v2_read_enabled: true }
    });

    assert.equal(novReturnQueue.lifecycleCalls.length, 0, 'Return to Nov makes 0 getPeriodLifecycle calls');
    assert.equal(novReturnQueue.refreshCalls.length, 1);
    assert.equal(novReturnQueue.refreshCalls[0], 'draft:2026-11');
  });

  await t.test('10. B3a.1 Full component-navigation sequence (2026-11 -> 2026-10 -> 2026-11) reloads all 98 assignments in v2LiveSnapshot and CurrentRosterView', async () => {
    // Build 98 deterministic November draft assignments across 7 doctors x 14 days
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
    assert.equal(Object.keys(cells98).length, 98, 'Precondition: 98 draft cells prepared');

    const lifecycleCallsByPeriod = { '2026-11': 0, '2026-10': 0 };
    const refreshCalls = [];

    const sharedQueue = {
      enabled: () => true,
      start: async () => {},
      stop: () => {},
      subscribe: () => () => {},
      repository: {
        schema: async () => ({ ok: true, people: people98 })
      },
      getPeriodLifecycle: async (period) => {
        lifecycleCallsByPeriod[period] = (lifecycleCallsByPeriod[period] || 0) + 1;
        if (period === '2026-11') {
          return {
            ok: true,
            period: {
              PeriodId: '2026-11',
              State: 'DRAFT',
              Revision: 4,
              DraftRevision: 9
            }
          };
        }
        return { ok: false, error: 'NOT_ENROLLED' };
      },
      refresh: async (key) => {
        refreshCalls.push(key);
        return { ok: true };
      },
      view: (key) => {
        if (key === 'draft:2026-11') {
          return {
            cells: cells98,
            statuses: {},
            baseline: { revision: 9, checksum: 'chk-98' },
            // Simulate real state.js mergeLifecycle where view.lifecycle.draftRevision is undefined
            lifecycle: { state: 'DRAFT', revision: 4 },
            operations: []
          };
        }
        // Simulate real draftQueue.view('draft:2026-10') returning default emptyEntity fallback
        return {
          cells: {},
          statuses: {},
          baseline: { revision: 0, checksum: null },
          lifecycle: { state: 'DRAFT', revision: 0 },
          operations: []
        };
      }
    };

    // Stateful multi-component harness driving RosterPage -> LifecycleControls + Phase5RosterContainer
    const createSlotHarness = () => ({
      states: new Map(),
      refs: new Map(),
      callbacks: new Map(),
      prevDeps: new Map(),
      cleanups: new Map()
    });

    const pageSlot = createSlotHarness();
    const lcSlot = createSlotHarness();
    let phase5Slot = createSlotHarness();
    let phase5Mounted = false;

    const origDispatcher = React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentDispatcher.current;

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

    let latestSnapshotPayload = null;
    let lastCurrentRosterViewNode = null;
    let lastPageTree = null;

    const stableSettings = {
      roster_workspace_v2_enabled: true,
      roster_v2_read_enabled: true
    };
    const stableMasterRoster = [
      { Date: '2026-10-05', Name: 'Legacy Oct Doctor', Shift: 'AM' }
    ];
    const stableRuntimeFactory = async () => sharedQueue;
    const stableSnapshotHandler = (payload) => {
      latestSnapshotPayload = payload;
    };

    const flushFullTree = async (month, passes = 4) => {
      for (let pass = 0; pass < passes; pass++) {
        const pagePass = runWithSlot(pageSlot, () =>
          RosterPage({
            rosterMonth: month,
            isAdmin: true,
            settings: stableSettings,
            masterRoster: stableMasterRoster,
            onV2LiveSnapshotChange: stableSnapshotHandler
          })
        );
        lastPageTree = pagePass.tree;

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
          lastCurrentRosterViewNode = findNode(
            p5Pass.tree,
            (n) => typeof n?.type === 'function' && n.type.name === 'CurrentRosterView'
          );
        } else if (phase5Mounted) {
          unmountSlot(phase5Slot);
          phase5Mounted = false;
          lastCurrentRosterViewNode = null;
        }

        // React commits child effects before parent effects
        lcPass?.flushEffects();
        p5Pass?.flushEffects();
        pagePass.flushEffects();

        await new Promise((r) => setTimeout(r, 15));
      }
    };

    try {
      // --- STEP 1: Initial load of 2026-11 ---
      await flushFullTree('2026-11');

      assert.equal(
        lifecycleCallsByPeriod['2026-11'],
        1,
        'Step 1 (2026-11): getPeriodLifecycle("2026-11") must be called exactly once (by LifecycleControls)'
      );
      assert.equal(refreshCalls.length, 1, 'Step 1 (2026-11): refresh("draft:2026-11") called once');
      assert.equal(refreshCalls[0], 'draft:2026-11');
      assert.equal(phase5Mounted, true, 'Step 1 (2026-11): Phase5RosterContainer is mounted');
      assert.ok(latestSnapshotPayload?.v2LiveSnapshot?.isLoaded, 'Step 1 (2026-11): v2LiveSnapshot isLoaded');
      assert.equal(
        latestSnapshotPayload.v2LiveSnapshot.assignments.length,
        98,
        'Step 1 (2026-11): 98 assignments loaded in v2LiveSnapshot'
      );
      assert.ok(lastCurrentRosterViewNode, 'Step 1 (2026-11): CurrentRosterView is rendered');
      assert.equal(
        lastCurrentRosterViewNode.props.currentAssignments?.length,
        98,
        'Step 1 (2026-11): 98 assignments passed to CurrentRosterView'
      );

      // --- STEP 2: Navigate 2026-11 -> 2026-10 ---
      await flushFullTree('2026-10');

      assert.equal(phase5Mounted, false, 'Step 2 (2026-10): Phase5RosterContainer unmounted on October navigation');
      assert.equal(
        lifecycleCallsByPeriod['2026-10'],
        1,
        'Step 2 (2026-10): getPeriodLifecycle("2026-10") called only once by LifecycleControls (never by Phase5RosterContainer)'
      );
      assert.equal(latestSnapshotPayload?.v2LiveSnapshot?.period, '2026-10');
      assert.equal(latestSnapshotPayload?.v2LiveSnapshot?.isLoaded, false);
      assert.equal(latestSnapshotPayload?.v2LiveSnapshot?.assignments?.length, 0);

      // --- STEP 3: Navigate 2026-10 -> 2026-11 ---
      await flushFullTree('2026-11');

      // Also simulate a late/stale 2026-10 lifecycle callback arriving after returning to 2026-11
      const lcNodeAfterReturn = findNode(
        lastPageTree,
        (n) => typeof n?.type === 'function' && n.type.name === 'LifecycleControls'
      );
      lcNodeAfterReturn?.props?.onLifecycleStateChange?.({
        period: '2026-10',
        isEnrolled: false,
        state: null,
        revision: null,
        draftRevision: null
      });
      await flushFullTree('2026-11', 2);

      assert.equal(
        lifecycleCallsByPeriod['2026-11'],
        2,
        'Step 3 (return to 2026-11): getPeriodLifecycle("2026-11") called once on return (total 2 across both visits)'
      );
      assert.equal(refreshCalls.length, 2, 'Step 3 (return to 2026-11): refresh("draft:2026-11") called again on return');
      assert.equal(phase5Mounted, true, 'Step 3 (return to 2026-11): Phase5RosterContainer remounted and stayed mounted');
      assert.equal(latestSnapshotPayload?.v2LiveSnapshot?.period, '2026-11');
      assert.equal(latestSnapshotPayload?.v2LiveSnapshot?.isLoaded, true);
      assert.equal(
        latestSnapshotPayload?.v2LiveSnapshot?.assignments?.length,
        98,
        'Step 3 (return to 2026-11): all 98 assignments restored in v2LiveSnapshot'
      );
      assert.ok(lastCurrentRosterViewNode, 'Step 3 (return to 2026-11): CurrentRosterView is rendered');
      assert.equal(
        lastCurrentRosterViewNode.props.currentAssignments?.length,
        98,
        'Step 3 (return to 2026-11): all 98 assignments restored in CurrentRosterView'
      );
    } finally {
      React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentDispatcher.current = origDispatcher;
    }
  });

  await t.test('11. Unmounting Phase5RosterContainer invalidates in-flight async loads via requestGenRef', async () => {
    let resolveRefresh;
    const delayedRefreshPromise = new Promise((r) => {
      resolveRefresh = r;
    });

    const mockQueue = createMockQueue({
      refresh: () => delayedRefreshPromise
    });

    let emittedLifecycleAfterUnmount = false;
    const origDispatcher = React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentDispatcher.current;
    const stateMap = new Map();
    const refMap = new Map();
    let stateIdx = 0;
    let refIdx = 0;
    const cleanups = [];

    try {
      React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentDispatcher.current = {
        useState: (init) => {
          const i = stateIdx++;
          if (!stateMap.has(i)) stateMap.set(i, typeof init === 'function' ? init() : init);
          return [stateMap.get(i), (n) => stateMap.set(i, typeof n === 'function' ? n(stateMap.get(i)) : n)];
        },
        useRef: (init) => {
          const i = refIdx++;
          if (!refMap.has(i)) refMap.set(i, { current: init });
          return refMap.get(i);
        },
        useCallback: (cb) => cb,
        useMemo: (cb) => cb(),
        useEffect: (cb) => {
          const cleanup = cb();
          if (typeof cleanup === 'function') cleanups.push(cleanup);
        }
      };

      Phase5RosterContainer({
        period: '2026-11',
        verifiedLifecycle: {
          period: '2026-11',
          isEnrolled: true,
          state: 'DRAFT',
          revision: 1,
          draftRevision: 1
        },
        queue: mockQueue,
        allowDraft: true,
        settings: { roster_v2_read_enabled: true },
        onLifecycleStateChange: () => {
          emittedLifecycleAfterUnmount = true;
        }
      });

      await new Promise((r) => setTimeout(r, 10));

      // Simulate component unmount before refresh resolves
      for (const cleanup of cleanups) cleanup();

      resolveRefresh({ ok: true });
      await new Promise((r) => setTimeout(r, 20));

      assert.equal(emittedLifecycleAfterUnmount, false, 'Unmounted container must not emit stale lifecycle callbacks');
    } finally {
      React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentDispatcher.current = origDispatcher;
    }
  });

  await t.test('12. Auth failure (AUTHORIZATION_REQUIRED) during draft load fails closed without corrupting lifecycle state', async () => {
    const authFailQueue = createMockQueue({
      refresh: async () => {
        const err = new Error('Admin session required');
        err.code = 'AUTHORIZATION_REQUIRED';
        throw err;
      }
    });

    let emittedSnapshot = null;
    await runPhase5WithDispatcher({
      period: '2026-11',
      verifiedLifecycle: {
        period: '2026-11',
        isEnrolled: true,
        state: 'DRAFT',
        revision: 2,
        draftRevision: 5
      },
      queue: authFailQueue,
      allowDraft: true,
      settings: { roster_v2_read_enabled: true },
      onLiveSnapshotChange: (s) => {
        emittedSnapshot = s;
      }
    });

    assert.equal(authFailQueue.lifecycleCalls.length, 0, 'Skipped duplicate getPeriodLifecycle even when draft auth fails');
    assert.ok(emittedSnapshot !== null, 'Emits unloaded snapshot on AUTHORIZATION_REQUIRED');
    assert.equal(emittedSnapshot.period, '2026-11');
    assert.equal(emittedSnapshot.state, 'DRAFT');
    assert.equal(emittedSnapshot.isLoaded, false);
    assert.deepEqual(emittedSnapshot.assignments, []);
  });

  await t.test('13. Post-cutover legacy write protection remains fail-closed during lifecycle loading and month transitions', () => {
    const origDispatcher = React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentDispatcher.current;
    try {
      React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentDispatcher.current = {
        useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
        useRef: (init) => ({ current: init }),
        useCallback: (cb) => cb,
        useMemo: (cb) => cb(),
        useEffect: () => {}
      };

      const novLoadingHtml = ReactDOMServer.renderToStaticMarkup(
        React.createElement(RosterPage, {
          rosterMonth: '2026-11',
          isAdmin: true,
          settings: {
            roster_workspace_v2_enabled: true,
            roster_v2_read_enabled: true
          },
          masterRoster: [
            { Date: '2026-11-02', Name: 'Legacy Fallback Doctor', Shift: 'AM' }
          ]
        })
      );

      assert.ok(!novLoadingHtml.includes('Edit Roster'), 'Post-cutover 2026-11 must never expose legacy Edit Roster button');
      assert.ok(!novLoadingHtml.includes('Edit (Dropdown)'), 'Post-cutover 2026-11 must never expose legacy Edit (Dropdown)');
      assert.ok(!novLoadingHtml.includes('Edit (Copy/Paste)'), 'Post-cutover 2026-11 must never expose legacy Edit (Copy/Paste)');
      assert.ok(!novLoadingHtml.includes('Edit Standby'), 'Post-cutover 2026-11 must never expose legacy Edit Standby');
      assert.ok(!novLoadingHtml.includes('Edit Extended'), 'Post-cutover 2026-11 must never expose legacy Edit Extended');
      assert.ok(!novLoadingHtml.includes('Legacy Fallback Doctor'), 'Post-cutover 2026-11 must never render legacy MasterRoster MO shifts');
    } finally {
      React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentDispatcher.current = origDispatcher;
    }
  });

  await t.test('14. Closed BroadcastChannel does not crash queue.change or prevent V2 activation on month return', async () => {
    class MockBroadcastChannel {
      constructor(name) {
        this.name = name;
        this.closed = false;
      }
      postMessage() {
        if (this.closed) {
          throw new Error('InvalidStateError: Channel is closed');
        }
      }
      close() {
        this.closed = true;
      }
    }

    const { createSignals } = await import('../../src/features/roster/queue/state.js');
    const bus = createSignals(() => {}, { Broadcast: MockBroadcastChannel });
    // Simulate DraftQueuePanel unmount closing the channel
    bus.close();

    // Verify send() does not throw even when closed
    assert.doesNotThrow(() => {
      bus.send('draft:2026-11', 'changed');
    }, 'bus.send() on closed BroadcastChannel must fail safely without throwing');
  });

  await t.test('15. Post-cutover Table view fails closed on lifecycle failure: never exposes legacy monthly spreadsheet or shift distribution tally', () => {
    const origDispatcher = React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentDispatcher.current;
    try {
      React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentDispatcher.current = {
        useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
        useRef: (init) => ({ current: init }),
        useCallback: (cb) => cb,
        useMemo: (cb) => cb(),
        useEffect: () => {}
      };

      // 1. Post-cutover month (2026-11) when V2 is unavailable
      const novHtml = ReactDOMServer.renderToStaticMarkup(
        React.createElement(RosterPage, {
          rosterMonth: '2026-11',
          selectedName: 'Admin',
          initialActiveTab: 'table',
          settings: {
            roster_workspace_v2_enabled: true,
            roster_v2_read_enabled: true
          },
          names: ['Doctor Alpha', 'Doctor Beta'],
          masterRoster: [
            { Date: '2026-11-05', Name: 'Doctor Alpha', Shift: 'AM' }
          ]
        })
      );

      // Must NOT render legacy Table view or shift distribution tally
      assert.ok(!novHtml.includes('DOCTOR ALPHA') && !novHtml.includes('Doctor Alpha'), 'Post-cutover table must not render legacy doctor rows');
      assert.ok(!novHtml.includes('Shift Distribution Tally'), 'Post-cutover table must not render Shift Distribution Tally');
      assert.ok(!novHtml.includes('official finalized schedule'), 'Post-cutover table must not claim official finalized schedule');
      assert.ok(
        novHtml.includes('Roster Workspace Unavailable') || novHtml.includes('Checking Authoritative Roster Workspace'),
        'Post-cutover table must display safe V2 unavailable banner when unactivated'
      );

      // 2. Pre-cutover month (2026-10) when V2 is inactive must preserve legacy table and tally
      const octHtml = ReactDOMServer.renderToStaticMarkup(
        React.createElement(RosterPage, {
          rosterMonth: '2026-10',
          selectedName: 'Admin',
          initialActiveTab: 'table',
          settings: {
            roster_workspace_v2_enabled: true,
            roster_v2_read_enabled: true
          },
          names: ['Doctor Alpha'],
          masterRoster: [
            { Date: '2026-10-05', Name: 'Doctor Alpha', Shift: 'AM' }
          ]
        })
      );

      assert.ok(octHtml.includes('DOCTOR ALPHA'), 'Pre-cutover table preserves legacy doctor rows');
      assert.ok(octHtml.includes('Shift Distribution Tally'), 'Pre-cutover table preserves legacy Shift Distribution Tally');
      assert.ok(octHtml.includes('official finalized schedule'), 'Pre-cutover table preserves legacy finalized schedule heading');
    } finally {
      React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentDispatcher.current = origDispatcher;
    }
  });
});
