import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import React from 'react';
import ReactDOMServer from 'react-dom/server';

import { projectNormalizedAssignmentsToCalendarRows } from '../../src/features/roster/data/calendarProjection.js';
import * as adminAuthModule from '../../src/features/roster/auth/adminAuth.js';

// Polyfill minimal browser globals for SSR / Node environment
if (typeof globalThis.localStorage === 'undefined') {
  globalThis.localStorage = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
    clear: () => {}
  };
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');
const req = createRequire(import.meta.url);

async function loadRosterPageComponent() {
  const bundleResult = await build({
    entryPoints: [path.resolve(rootDir, 'src/components/RosterPage.jsx')],
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

test('V2 Unified Roster — Slice B2a Parent Live Snapshot Receiver Suite', async (t) => {
  let RosterPage;

  t.before(async () => {
    RosterPage = await loadRosterPageComponent();
  });

  // Harness simulating React dispatcher for RosterPage execution
  const createRosterPageHarness = ({
    initialRosterMonth = '2026-11',
    isEnrolled = true,
    lifecycleState = 'DRAFT',
    onSnapshotSpy = null
  } = {}) => {
    const origDispatcher = React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentDispatcher.current;
    const stateMap = new Map();
    let stateCallIndex = 0;
    const refMap = new Map();
    let refCallIndex = 0;
    let effects = [];

    const render = (monthOverride = null) => {
      stateCallIndex = 0;
      refCallIndex = 0;
      effects = [];

      try {
        React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentDispatcher.current = {
          useState: (initial) => {
            const idx = stateCallIndex++;
            if (!stateMap.has(idx)) {
              let val = initial;
              if (typeof initial === 'function') {
                val = initial();
              }
              // Intercept lifecycle state to simulate enrolled DRAFT
              if (
                typeof initial === 'object' &&
                initial !== null &&
                'isEnrolled' in initial &&
                'state' in initial
              ) {
                val = {
                  period: monthOverride || initialRosterMonth,
                  isEnrolled,
                  state: lifecycleState,
                  revision: 1
                };
              }
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
            const idx = refCallIndex++;
            if (!refMap.has(idx)) {
              refMap.set(idx, { current: initial });
            }
            return refMap.get(idx);
          },
          useCallback: (cb) => cb,
          useEffect: (cb) => {
            effects.push(cb);
          },
          useMemo: (cb) => cb()
        };

        const tree = RosterPage({
          rosterMonth: monthOverride || initialRosterMonth,
          settings: {
            roster_workspace_v2_enabled: true,
            roster_v2_read_enabled: true
          },
          onV2LiveSnapshotChange: onSnapshotSpy
        });

        // Run effects
        for (const eff of effects) {
          if (typeof eff === 'function') {
            eff();
          }
        }

        return tree;
      } finally {
        React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentDispatcher.current = origDispatcher;
      }
    };

    const initialTree = render();
    return {
      tree: initialTree,
      render,
      findPhase5: () => findNode(initialTree, (n) => typeof n?.props?.onLiveSnapshotChange === 'function')
    };
  };

  await t.test('1. November live snapshot received correctly and derives calendar rows', () => {
    let captured = null;
    const harness = createRosterPageHarness({
      initialRosterMonth: '2026-11',
      onSnapshotSpy: (data) => {
        captured = data;
      }
    });

    const p5Node = harness.findPhase5();
    assert.ok(p5Node, 'Phase5RosterContainer node must be found in tree');
    assert.equal(typeof p5Node.props.onLiveSnapshotChange, 'function');

    const novAssignments = [
      {
        assignmentId: 'asg-adi-am',
        personId: 'd89cf180-37c8-448c-8ebc-927724e4b79c',
        personNameSnapshot: 'Adi',
        date: '2026-11-01',
        shiftCode: 'AM',
        rawShift: 'AM',
        dutyDomain: 'MO'
      },
      {
        assignmentId: 'asg-azrul-pm',
        personId: 'a9bc3a8e-c60f-4990-8fb3-ab91321c9e44',
        personNameSnapshot: 'Azrul',
        date: '2026-11-01',
        shiftCode: 'PM',
        rawShift: 'PM (S)',
        modifiers: { standby: true, extended: false },
        dutyDomain: 'MO'
      }
    ];

    // Emit live snapshot from Phase5RosterContainer to RosterPage
    p5Node.props.onLiveSnapshotChange({
      period: '2026-11',
      state: 'DRAFT',
      revision: 1,
      assignments: novAssignments,
      isLoaded: true,
      isSaving: false,
      draftSaveStatus: 'saved'
    });

    // Re-render to flush state & effects
    harness.render();

    assert.ok(captured, 'onV2LiveSnapshotChange must have been notified');
    assert.equal(captured.v2LiveSnapshot.period, '2026-11');
    assert.equal(captured.v2LiveSnapshot.isLoaded, true);
    assert.equal(captured.v2LiveSnapshot.state, 'DRAFT');
    assert.equal(captured.v2LiveSnapshot.revision, 1);
    assert.equal(captured.v2LiveSnapshot.assignments.length, 2);

    // Derived calendar rows must match
    assert.equal(captured.derivedV2CalendarRows.length, 2);
    assert.equal(captured.derivedV2CalendarRows[0].Name, 'Adi');
    assert.equal(captured.derivedV2CalendarRows[0].Shift, 'AM');
    assert.equal(captured.derivedV2CalendarRows[1].Name, 'Azrul');
    assert.equal(captured.derivedV2CalendarRows[1].Shift, 'PM (S)');
    assert.equal(captured.derivedV2CalendarRows[1].modifiers.standby, true);
  });

  await t.test('2. Optimistic changes are reflected in derived calendar rows immediately', () => {
    let captured = null;
    const harness = createRosterPageHarness({
      initialRosterMonth: '2026-11',
      onSnapshotSpy: (data) => {
        captured = data;
      }
    });

    const p5Node = harness.findPhase5();

    // Initial state: AM
    p5Node.props.onLiveSnapshotChange({
      period: '2026-11',
      state: 'DRAFT',
      revision: 1,
      assignments: [
        {
          assignmentId: 'asg-adi',
          personId: 'd89cf180-37c8-448c-8ebc-927724e4b79c',
          personNameSnapshot: 'Adi',
          date: '2026-11-02',
          shiftCode: 'AM',
          rawShift: 'AM',
          dutyDomain: 'MO'
        }
      ],
      isLoaded: true,
      isSaving: false,
      draftSaveStatus: 'saved'
    });
    harness.render();
    assert.equal(captured.derivedV2CalendarRows[0].Shift, 'AM');
    assert.equal(captured.v2LiveSnapshot.isSaving, false);

    // Optimistic edit: user selects extended shift AMX
    p5Node.props.onLiveSnapshotChange({
      period: '2026-11',
      state: 'DRAFT',
      revision: 1,
      assignments: [
        {
          assignmentId: 'asg-adi',
          personId: 'd89cf180-37c8-448c-8ebc-927724e4b79c',
          personNameSnapshot: 'Adi',
          date: '2026-11-02',
          shiftCode: 'AM',
          rawShift: 'AMX',
          modifiers: { standby: false, extended: true },
          dutyDomain: 'MO'
        }
      ],
      isLoaded: true,
      isSaving: true, // in-flight autosave!
      draftSaveStatus: 'saving'
    });
    harness.render();

    assert.equal(captured.derivedV2CalendarRows[0].Shift, 'AMX');
    assert.equal(captured.derivedV2CalendarRows[0].modifiers.extended, true);
    assert.equal(captured.v2LiveSnapshot.isSaving, true);
    assert.equal(captured.v2LiveSnapshot.draftSaveStatus, 'saving');
  });

  await t.test('3. November snapshot cannot populate December', () => {
    let captured = null;
    const harness = createRosterPageHarness({
      initialRosterMonth: '2026-12', // Selected month is December
      onSnapshotSpy: (data) => {
        captured = data;
      }
    });

    const p5Node = harness.findPhase5();
    assert.ok(p5Node);

    // Stale or cross-month November snapshot arrives
    p5Node.props.onLiveSnapshotChange({
      period: '2026-11', // Mismatched period!
      state: 'DRAFT',
      revision: 1,
      assignments: [
        {
          assignmentId: 'asg-stale-nov',
          personId: 'd89cf180-37c8-448c-8ebc-927724e4b79c',
          personNameSnapshot: 'Adi',
          date: '2026-11-01',
          shiftCode: 'AM',
          dutyDomain: 'MO'
        }
      ],
      isLoaded: true
    });

    harness.render();

    // Must remain December with empty assignments
    assert.equal(captured.v2LiveSnapshot.period, '2026-12');
    assert.equal(captured.v2LiveSnapshot.isLoaded, false);
    assert.deepEqual(captured.v2LiveSnapshot.assignments, []);
    assert.deepEqual(captured.derivedV2CalendarRows, []);
  });

  await t.test('4. Unloaded/auth-failure snapshots cannot expose stale roster assignments', () => {
    let captured = null;
    const harness = createRosterPageHarness({
      initialRosterMonth: '2026-11',
      onSnapshotSpy: (data) => {
        captured = data;
      }
    });

    const p5Node = harness.findPhase5();

    // 4a. Initial loaded state
    p5Node.props.onLiveSnapshotChange({
      period: '2026-11',
      state: 'DRAFT',
      revision: 1,
      assignments: [
        {
          assignmentId: 'asg-adi',
          personId: 'd89cf180-37c8-448c-8ebc-927724e4b79c',
          personNameSnapshot: 'Adi',
          date: '2026-11-01',
          shiftCode: 'AM',
          dutyDomain: 'MO'
        }
      ],
      isLoaded: true
    });
    harness.render();
    assert.equal(captured.v2LiveSnapshot.isLoaded, true);
    assert.equal(captured.derivedV2CalendarRows.length, 1);

    // 4b. Auth failure / unloaded event occurs
    p5Node.props.onLiveSnapshotChange({
      period: '2026-11',
      state: null,
      revision: null,
      assignments: [],
      isLoaded: false,
      draftSaveStatus: null
    });
    harness.render();

    assert.equal(captured.v2LiveSnapshot.isLoaded, false);
    assert.deepEqual(captured.v2LiveSnapshot.assignments, []);
    assert.deepEqual(captured.derivedV2CalendarRows, []);
  });

  await t.test('5. Calendar projection does not mutate the snapshot', () => {
    const rawAssignment = Object.freeze({
      assignmentId: 'asg-adi-1',
      personId: 'd89cf180-37c8-448c-8ebc-927724e4b79c',
      personNameSnapshot: 'Adi',
      date: '2026-11-01',
      shiftCode: 'AM',
      rawShift: 'AM',
      modifiers: Object.freeze({ standby: false, extended: false }),
      dutyDomain: 'MO'
    });

    const frozenSnapshotAssignments = Object.freeze([rawAssignment]);

    // Project to calendar rows
    const derivedRows = projectNormalizedAssignmentsToCalendarRows(frozenSnapshotAssignments);
    assert.equal(derivedRows.length, 1);
    assert.notEqual(derivedRows[0], rawAssignment, 'Projected row must be a new object');

    // Mutating derived row must not affect rawAssignment
    derivedRows[0].Shift = 'MUTATED';
    derivedRows[0].Name = 'MutatedName';
    assert.equal(rawAssignment.shiftCode, 'AM');
    assert.equal(rawAssignment.personNameSnapshot, 'Adi');
  });

  await t.test('6. Phase5RosterContainer receives onLiveSnapshotChange prop in RosterPage tree', () => {
    const harness = createRosterPageHarness({
      initialRosterMonth: '2026-11',
      isEnrolled: true,
      lifecycleState: 'DRAFT'
    });

    const p5Node = harness.findPhase5();
    assert.ok(p5Node, 'Phase5RosterContainer must be present for enrolled DRAFT period');
    assert.equal(
      typeof p5Node.props.onLiveSnapshotChange,
      'function',
      'Phase5RosterContainer must receive onLiveSnapshotChange callback prop'
    );
  });

  await t.test('7. No new backend calls are introduced by live snapshot receiver', () => {
    let fetchCount = 0;
    const origFetch = globalThis.fetch;
    globalThis.fetch = async (...args) => {
      fetchCount++;
      return origFetch(...args);
    };

    try {
      const harness = createRosterPageHarness({
        initialRosterMonth: '2026-11'
      });

      const p5Node = harness.findPhase5();
      p5Node.props.onLiveSnapshotChange({
        period: '2026-11',
        state: 'DRAFT',
        revision: 1,
        assignments: [],
        isLoaded: true
      });
      harness.render();

      assert.equal(fetchCount, 0, 'No backend fetch calls should be initiated by snapshot receiver');
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});
