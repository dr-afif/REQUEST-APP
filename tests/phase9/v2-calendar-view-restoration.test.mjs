import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import React from 'react';
import ReactDOMServer from 'react-dom/server';

import {
  projectNormalizedAssignmentsToCalendarRows,
  filterMoCalendarRows
} from '../../src/features/roster/data/calendarProjection.js';
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
      'lucide-react'
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

function findAllNodes(node, predicate, acc = []) {
  if (!node || typeof node !== 'object') return acc;
  if (predicate(node)) acc.push(node);
  if (Array.isArray(node)) {
    for (const item of node) {
      findAllNodes(item, predicate, acc);
    }
  } else if (node.props?.children) {
    findAllNodes(node.props.children, predicate, acc);
  }
  return acc;
}

test('V2 Unified Roster — Slice B2b Calendar/Table View Restoration Suite', async (t) => {
  let RosterPage;
  let Phase5RosterContainer;
  let CurrentRosterView;

  t.before(async () => {
    RosterPage = await loadRosterPageComponent();
    Phase5RosterContainer = await loadJsxComponent('src/features/roster/components/Phase5RosterContainer.jsx');
    CurrentRosterView = await loadJsxComponent('src/features/roster/components/CurrentRosterView.jsx');
  });

  // Harness simulating React dispatcher for RosterPage execution
  const createRosterPageHarness = ({
    initialRosterMonth = '2026-11',
    isEnrolled = true,
    lifecycleState = 'DRAFT',
    masterRoster = [],
    selectedName = 'Admin',
    settings = {
      roster_workspace_v2_enabled: true,
      roster_v2_read_enabled: true,
      roster_v2_write_enabled: true
    },
    requestsRosterMap = null,
    isUpcomingMonth = false,
    onSnapshotSpy = null
  } = {}) => {
    const origDispatcher = React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentDispatcher.current;
    const stateMap = new Map();
    let stateCallIndex = 0;
    const refMap = new Map();
    let refCallIndex = 0;
    const effectDepsMap = new Map();
    let effects = [];

    const render = (overrides = {}) => {
      stateCallIndex = 0;
      refCallIndex = 0;
      let effectCallIndex = 0;
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
              // Intercept lifecycle state to simulate enrolled DRAFT or unenrolled
              if (
                typeof initial === 'object' &&
                initial !== null &&
                'isEnrolled' in initial &&
                'state' in initial
              ) {
                val = {
                  period: overrides.rosterMonth || initialRosterMonth,
                  isEnrolled: overrides.isEnrolled !== undefined ? overrides.isEnrolled : isEnrolled,
                  state: overrides.lifecycleState !== undefined ? overrides.lifecycleState : lifecycleState,
                  revision: 1
                };
              }
              stateMap.set(idx, val);
            }
            if (overrides.activeTab !== undefined && idx === 13) {
              stateMap.set(idx, overrides.activeTab);
            }
            const currentVal = stateMap.get(idx);
            const setter = (next) => {
              let nextVal = typeof next === 'function' ? next(stateMap.get(idx)) : next;
              if (idx === 19 && (overrides.isEnrolled !== undefined ? overrides.isEnrolled : isEnrolled)) {
                nextVal = {
                  period: overrides.rosterMonth || initialRosterMonth,
                  isEnrolled: overrides.isEnrolled !== undefined ? overrides.isEnrolled : isEnrolled,
                  state: overrides.lifecycleState !== undefined ? overrides.lifecycleState : lifecycleState,
                  revision: 1
                };
              }
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
          useEffect: (cb, deps) => {
            const idx = effectCallIndex++;
            const prevDeps = effectDepsMap.get(idx);
            let shouldRun = false;
            if (!deps || !prevDeps || deps.length !== prevDeps.length) {
              shouldRun = true;
            } else {
              shouldRun = deps.some((dep, i) => !Object.is(dep, prevDeps[i]));
            }
            effectDepsMap.set(idx, deps);
            if (shouldRun) {
              effects.push(cb);
            }
          },
          useMemo: (cb) => cb()
        };

        const tree = RosterPage({
          rosterMonth: overrides.rosterMonth || initialRosterMonth,
          settings: overrides.settings || settings,
          selectedName: overrides.selectedName !== undefined ? overrides.selectedName : selectedName,
          masterRoster: overrides.masterRoster || masterRoster,
          requestsRosterMap: overrides.requestsRosterMap || requestsRosterMap,
          isUpcomingMonth: overrides.isUpcomingMonth !== undefined ? overrides.isUpcomingMonth : isUpcomingMonth,
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
      stateMap,
      findPhase5: (t = null) => findNode(t || initialTree, (n) => typeof n?.props?.onLiveSnapshotChange === 'function'),
      findTabButtons: (t = null) => findAllNodes(t || initialTree, (n) => n?.props?.id === 'tab-btn-calendar' || n?.props?.id === 'tab-btn-table')
    };
  };

  await t.test('1. November V2 renders Calendar View and Table View toggle tabs', () => {
    const harness = createRosterPageHarness({
      initialRosterMonth: '2026-11',
      isEnrolled: true,
      lifecycleState: 'DRAFT'
    });

    const buttons = harness.findTabButtons();
    assert.equal(buttons.length, 2, 'Both Calendar and Table tab buttons must be present in November');
    assert.ok(buttons[0].props.children.includes('Calendar View'), 'First tab is Calendar View');
    assert.ok(buttons[1].props.children.includes('Table View'), 'Second tab is Table View');
  });

  await t.test('2. Switching between Calendar and Table views preserves Phase5RosterContainer mounted in tree', () => {
    const harness = createRosterPageHarness({
      initialRosterMonth: '2026-11',
      isEnrolled: true,
      lifecycleState: 'DRAFT'
    });

    // 1. Initial render defaults to calendar tab
    let p5Node = harness.findPhase5();
    assert.ok(p5Node, 'Phase5RosterContainer must be mounted even when activeTab is calendar');

    // Find wrapper div around Phase5RosterContainer
    const calendarTree = harness.tree;
    const hiddenWrapper = findNode(calendarTree, (n) => n?.props?.className === 'hidden' && findNode(n, (c) => c === p5Node));
    assert.ok(hiddenWrapper, 'Phase5RosterContainer must be wrapped in hidden div when activeTab is calendar');
    assert.equal(p5Node.props.isActiveView, false, 'isActiveView must be false when table is hidden');

    // 2. Switch to table tab
    // Find activeTab state setter in stateMap (activeTab is at index 3 in stateMap)
    let activeTabSetter = null;
    // Call render with activeTab override to simulate clicking Table View tab
    const tableTree = harness.render({ activeTab: 'table' });
    const p5NodeTable = harness.findPhase5(tableTree);
    assert.ok(p5NodeTable, 'Phase5RosterContainer must remain mounted when activeTab is table');

    const visibleWrapper = findNode(tableTree, (n) => n?.props?.className === 'block mb-6' && findNode(n, (c) => c === p5NodeTable));
    assert.ok(visibleWrapper, 'Phase5RosterContainer must be wrapped in block mb-6 div when activeTab is table');
    assert.equal(p5NodeTable.props.isActiveView, true, 'isActiveView must be true when table is active view');
  });

  await t.test('3. Calendar View consumes live V2 draft assignments from snapshot receiver', () => {
    let captured = null;
    const harness = createRosterPageHarness({
      initialRosterMonth: '2026-11',
      isEnrolled: true,
      lifecycleState: 'DRAFT',
      onSnapshotSpy: (data) => {
        captured = data;
      }
    });

    const p5Node = harness.findPhase5();
    assert.ok(p5Node);

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
      },
      {
        assignmentId: 'asg-syu-night',
        personId: 'f0c6b12a-3c58-4ec7-91a5-8167f082e668',
        personNameSnapshot: 'Syuhada',
        date: '2026-11-02',
        shiftCode: 'NIGHT',
        rawShift: 'ON1',
        dutyDomain: 'MO'
      }
    ];

    // Emit live snapshot from Phase5RosterContainer
    p5Node.props.onLiveSnapshotChange({
      period: '2026-11',
      state: 'DRAFT',
      revision: 1,
      assignments: novAssignments,
      isLoaded: true,
      isSaving: false,
      draftSaveStatus: 'saved'
    });

    // Re-render
    const updatedTree = harness.render();

    assert.ok(captured, 'onV2LiveSnapshotChange must have received snapshot');
    assert.equal(captured.derivedV2CalendarRows.length, 3, 'Must derive exactly 3 calendar rows');

    // Verify Calendar view table contains the assigned doctor names
    const renderedHtml = ReactDOMServer.renderToStaticMarkup(updatedTree);
    assert.ok(renderedHtml.includes('Adi'), 'Calendar table must display Adi on Nov 1 AM');
    assert.ok(renderedHtml.includes('Azrul'), 'Calendar table must display Azrul on Nov 1 PM');
    assert.ok(renderedHtml.includes('Syuhada'), 'Calendar table must display Syuhada on Nov 2 NIGHT');
  });

  await t.test('4. Optimistic edits in Table View immediately reflect in Calendar View', () => {
    let captured = null;
    const harness = createRosterPageHarness({
      initialRosterMonth: '2026-11',
      isEnrolled: true,
      lifecycleState: 'DRAFT',
      onSnapshotSpy: (data) => {
        captured = data;
      }
    });

    const p5Node = harness.findPhase5();

    // 1. Initial snapshot with Adi AM on Nov 1
    p5Node.props.onLiveSnapshotChange({
      period: '2026-11',
      state: 'DRAFT',
      revision: 1,
      assignments: [
        {
          assignmentId: 'asg-adi-am',
          personId: 'd89cf180-37c8-448c-8ebc-927724e4b79c',
          personNameSnapshot: 'Adi',
          date: '2026-11-01',
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

    // 2. User performs optimistic edit: Adi changed to PM, Haziq assigned AM
    p5Node.props.onLiveSnapshotChange({
      period: '2026-11',
      state: 'DRAFT',
      revision: 2,
      assignments: [
        {
          assignmentId: 'asg-adi-pm',
          personId: 'd89cf180-37c8-448c-8ebc-927724e4b79c',
          personNameSnapshot: 'Adi',
          date: '2026-11-01',
          shiftCode: 'PM',
          rawShift: 'PM',
          dutyDomain: 'MO'
        },
        {
          assignmentId: 'asg-haziq-am',
          personId: 'b75c8734-f89a-4e2b-bbd5-a3597d5eb456',
          personNameSnapshot: 'Haziq',
          date: '2026-11-01',
          shiftCode: 'AM',
          rawShift: 'AM',
          dutyDomain: 'MO'
        }
      ],
      isLoaded: true,
      isSaving: true,
      draftSaveStatus: 'saving'
    });

    const optimisticTree = harness.render();
    const renderedHtml = ReactDOMServer.renderToStaticMarkup(optimisticTree);

    // Verify optimistic changes appear in Calendar markup immediately
    assert.ok(renderedHtml.includes('Haziq'), 'Optimistic assignment for Haziq must be in Calendar');
    assert.ok(renderedHtml.includes('Adi'), 'Adi must be in Calendar with PM assignment');
    assert.equal(captured.v2LiveSnapshot.isSaving, true, 'isSaving status tracked');
  });

  await t.test('5. Calendar View is strictly READ-ONLY for V2 periods (legacy edit controls suppressed)', () => {
    const harness = createRosterPageHarness({
      initialRosterMonth: '2026-11',
      isEnrolled: true,
      lifecycleState: 'DRAFT',
      isAdmin: true
    });

    const renderedHtml = ReactDOMServer.renderToStaticMarkup(harness.tree);

    // Assert that legacy edit buttons are NOT rendered
    assert.equal(renderedHtml.includes('✏️ Edit Roster'), false, 'Legacy Edit Roster button must be suppressed for V2 periods');
    assert.equal(renderedHtml.includes('📋 Edit (Copy/Paste)'), false, 'Legacy Copy/Paste edit button must be suppressed for V2 periods');
    assert.equal(renderedHtml.includes('⭐ Edit Standby'), false, 'Legacy Standby edit button must be suppressed for V2 periods');
    assert.equal(renderedHtml.includes('✨ Edit Extended'), false, 'Legacy Extended edit button must be suppressed for V2 periods');
    assert.equal(renderedHtml.includes('💾 Save Changes'), false, 'Legacy Save Changes button must be suppressed for V2 periods');
    assert.equal(renderedHtml.includes('Upload Master Roster'), false, 'Upload Master Roster must be suppressed for V2 periods');

    // Assert that Calendar view does NOT render editable textareas
    assert.equal(renderedHtml.includes('<textarea'), false, 'Calendar View must not render editable textarea inputs for V2 periods');
  });

  await t.test('6. EP columns preserved as read-only from masterRoster, but legacy MO rows NEVER merge into V2', () => {
    const legacyMasterRoster = [
      // Stray / legacy MO assignment that must NEVER appear in November V2
      {
        Name: 'StrayLegacyDoctor',
        Date: '2026-11-01',
        Shift: 'AM'
      },
      // EP duties that MUST appear in EP columns
      {
        Name: 'Dr. EP Specialist 1',
        Date: '2026-11-01',
        Shift: 'EP_OFFICE_HOUR'
      },
      {
        Name: 'Dr. EP Oncall 1',
        Date: '2026-11-01',
        Shift: 'EP_ONCALL'
      }
    ];

    const harness = createRosterPageHarness({
      initialRosterMonth: '2026-11',
      isEnrolled: true,
      lifecycleState: 'DRAFT',
      masterRoster: legacyMasterRoster
    });

    const p5Node = harness.findPhase5();
    p5Node.props.onLiveSnapshotChange({
      period: '2026-11',
      state: 'DRAFT',
      revision: 1,
      assignments: [
        {
          assignmentId: 'asg-adi-am',
          personId: 'd89cf180-37c8-448c-8ebc-927724e4b79c',
          personNameSnapshot: 'Adi',
          date: '2026-11-01',
          shiftCode: 'AM',
          rawShift: 'AM',
          dutyDomain: 'MO'
        }
      ],
      isLoaded: true,
      isSaving: false,
      draftSaveStatus: 'saved'
    });

    const renderedTree = harness.render();
    const renderedHtml = ReactDOMServer.renderToStaticMarkup(renderedTree);

    // 1. Adi from V2 draft MUST appear in AM column
    assert.ok(renderedHtml.includes('Adi'), 'V2 MO Adi must appear in AM column');

    // 2. StrayLegacyDoctor from masterRoster MUST NOT appear anywhere in the calendar table
    assert.equal(
      renderedHtml.includes('StrayLegacyDoctor'),
      false,
      'Legacy MO row from masterRoster must NEVER merge into November V2 calendar'
    );

    // 3. EP rows MUST appear in their dedicated EP columns
    assert.ok(renderedHtml.includes('Dr. EP Specialist 1'), 'EP Office Hour must appear in EP column');
    assert.ok(renderedHtml.includes('Dr. EP Oncall 1'), 'EP On Call must appear in EP column');
  });

  await t.test('7. Unassigned requests auto-population is disabled for V2 periods (empty cells stay empty)', () => {
    // Simulate requestsRosterMap with an active request for AM on Nov 3 for a doctor
    const requestsRosterMap = new Map();
    const docRequests = new Map();
    docRequests.set('2026-11-03', { shift: 'AM' });
    requestsRosterMap.set('afif', docRequests);

    const harness = createRosterPageHarness({
      initialRosterMonth: '2026-11',
      isEnrolled: true,
      lifecycleState: 'DRAFT',
      isUpcomingMonth: true,
      requestsRosterMap
    });

    const p5Node = harness.findPhase5();
    // Emit empty draft assignments
    p5Node.props.onLiveSnapshotChange({
      period: '2026-11',
      state: 'DRAFT',
      revision: 1,
      assignments: [],
      isLoaded: true,
      isSaving: false,
      draftSaveStatus: 'saved'
    });

    const renderedTree = harness.render();
    const renderedHtml = ReactDOMServer.renderToStaticMarkup(renderedTree);

    // Doctor Afif must NOT be auto-populated on Nov 3 because auto-population is disabled for V2 periods
    assert.equal(
      renderedHtml.includes('Afif'),
      false,
      'Requests auto-population must be disabled for V2 periods; empty cells must remain empty'
    );
  });

  await t.test('8. isActiveView=false deactivates keyboard listener in CurrentRosterView', () => {
    let addListenerCount = 0;
    let removeListenerCount = 0;
    let registeredHandler = null;

    const origAdd = globalThis.addEventListener;
    const origRemove = globalThis.removeEventListener;

    globalThis.addEventListener = (type, handler) => {
      if (type === 'keydown') {
        addListenerCount++;
        registeredHandler = handler;
      }
    };
    globalThis.removeEventListener = (type, handler) => {
      if (type === 'keydown') {
        removeListenerCount++;
        if (registeredHandler === handler) {
          registeredHandler = null;
        }
      }
    };

    try {
      // 1. Mount CurrentRosterView with isActiveView=false (hidden state)
      const inactiveElement = React.createElement(CurrentRosterView, {
        isActiveView: false,
        period: '2026-11',
        currentAssignments: [],
        lifecycleState: 'DRAFT'
      });

      // Dispatcher simulating single render
      const origDispatcher = React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentDispatcher.current;
      let effectCb = null;
      try {
        React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentDispatcher.current = {
          useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
          useRef: (init) => ({ current: init }),
          useCallback: (cb) => cb,
          useEffect: (cb) => { effectCb = cb; },
          useMemo: (cb) => cb()
        };

        CurrentRosterView({
          isActiveView: false,
          period: '2026-11',
          currentAssignments: [],
          lifecycleState: 'DRAFT'
        });

        // Run effect
        if (effectCb) {
          effectCb();
        }

        assert.equal(addListenerCount, 0, 'No keydown listener should be added when isActiveView=false');
        assert.equal(registeredHandler, null, 'No registered keydown handler when isActiveView=false');

        // 2. Render CurrentRosterView with isActiveView=true (active state)
        let cleanup = null;
        CurrentRosterView({
          isActiveView: true,
          period: '2026-11',
          currentAssignments: [],
          lifecycleState: 'DRAFT'
        });

        if (effectCb) {
          cleanup = effectCb();
        }

        assert.equal(addListenerCount, 1, 'Keydown listener must be added when isActiveView=true');
        assert.notEqual(registeredHandler, null, 'Keydown handler must be registered when isActiveView=true');

        // 3. Test cleanup
        if (typeof cleanup === 'function') {
          cleanup();
        }
        assert.equal(removeListenerCount, 1, 'Keydown listener must be cleaned up on deactivate/unmount');
      } finally {
        React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentDispatcher.current = origDispatcher;
      }
    } finally {
      globalThis.addEventListener = origAdd;
      globalThis.removeEventListener = origRemove;
    }
  });

  await t.test('9. Historical October remains 100% legacy UI with functional edit controls and legacy table', () => {
    const octoberMasterRoster = [
      {
        Name: 'LegacyOctDoctor',
        Date: '2026-10-01',
        Shift: 'AM'
      }
    ];

    const harness = createRosterPageHarness({
      initialRosterMonth: '2026-10',
      isEnrolled: false,
      lifecycleState: null,
      isAdmin: true,
      masterRoster: octoberMasterRoster
    });

    const renderedHtml = ReactDOMServer.renderToStaticMarkup(harness.tree);

    // 1. In October Calendar View: Legacy doctor appears
    assert.ok(renderedHtml.includes('LegacyOctDoctor'), 'October calendar must render legacy doctor from masterRoster');

    // 2. Legacy admin edit controls ARE rendered for unenrolled October
    assert.ok(renderedHtml.includes('Edit Roster'), 'Legacy Edit Roster button must be present in October for admin');
    assert.ok(renderedHtml.includes('Edit Standby'), 'Legacy Edit Standby button must be present in October for admin');
    assert.ok(renderedHtml.includes('Edit Extended'), 'Legacy Edit Extended button must be present in October for admin');

    // 3. Phase5RosterContainer must NOT be rendered for October
    const p5Node = harness.findPhase5();
    assert.equal(p5Node, null, 'Phase5RosterContainer must NOT render for unenrolled October');
  });

  await t.test('10. December period remains completely unenrolled and unaltered', () => {
    const harness = createRosterPageHarness({
      initialRosterMonth: '2026-12',
      isEnrolled: false,
      lifecycleState: null
    });

    const p5Node = harness.findPhase5();
    assert.equal(p5Node, null, 'December is unenrolled and must not mount Phase5RosterContainer');
  });

  await t.test('11. November during lifecycle LOADING suppresses legacy edit controls and never falls back to legacy MO rows', () => {
    const legacyMasterRoster = [
      {
        Name: 'LegacyLoadingDoctor',
        Date: '2026-11-01',
        Shift: 'AM'
      },
      {
        Name: 'Dr. EP Specialist Loading',
        Date: '2026-11-01',
        Shift: 'EP_OFFICE_HOUR'
      }
    ];

    const harness = createRosterPageHarness({
      initialRosterMonth: '2026-11',
      isEnrolled: false,
      lifecycleState: 'LOADING',
      isAdmin: true,
      masterRoster: legacyMasterRoster
    });

    const renderedHtml = ReactDOMServer.renderToStaticMarkup(harness.tree);

    // 1. Legacy edit controls must be completely suppressed even while V2 is loading
    assert.equal(renderedHtml.includes('Edit Roster'), false, 'Edit Roster button must be suppressed during LOADING');
    assert.equal(renderedHtml.includes('Edit Standby'), false, 'Edit Standby button must be suppressed during LOADING');
    assert.equal(renderedHtml.includes('Edit Extended'), false, 'Edit Extended button must be suppressed during LOADING');
    assert.equal(renderedHtml.includes('Edit (Copy/Paste)'), false, 'Copy/Paste edit button must be suppressed during LOADING');
    assert.equal(renderedHtml.includes('Save Changes'), false, 'Save Changes button must be suppressed during LOADING');
    assert.equal(renderedHtml.includes('Planned Snapshot Locked'), false, 'Period locked banner must not be exposed');

    // 2. Legacy MO rows from masterRoster must NEVER appear as temporary fallback
    assert.equal(
      renderedHtml.includes('LegacyLoadingDoctor'),
      false,
      'Legacy MO row from masterRoster must NEVER fall back during November loading'
    );

    // 3. EP rows for November are safely displayed in dedicated EP column
    assert.ok(
      renderedHtml.includes('Dr. EP Specialist Loading'),
      'EP duties for November are displayed in EP columns'
    );
  });

  await t.test('12. December UNENROLLED suppresses legacy edit controls and never auto-populates requests as confirmed shifts', () => {
    const requestsRosterMap = new Map();
    const docRequests = new Map();
    docRequests.set('2026-12-05', { shift: 'PM' });
    requestsRosterMap.set('afif', docRequests);

    const legacyMasterRoster = [
      {
        Name: 'LegacyDecDoctor',
        Date: '2026-12-01',
        Shift: 'AM'
      }
    ];

    const harness = createRosterPageHarness({
      initialRosterMonth: '2026-12',
      isEnrolled: false,
      lifecycleState: null,
      isAdmin: true,
      isUpcomingMonth: true,
      requestsRosterMap,
      masterRoster: legacyMasterRoster
    });

    const renderedHtml = ReactDOMServer.renderToStaticMarkup(harness.tree);

    // 1. Legacy edit controls suppressed for December (post-cutover)
    assert.equal(renderedHtml.includes('Edit Roster'), false, 'Edit Roster button must be suppressed for December');
    assert.equal(renderedHtml.includes('Edit Standby'), false, 'Edit Standby button must be suppressed for December');
    assert.equal(renderedHtml.includes('Edit Extended'), false, 'Edit Extended button must be suppressed for December');

    // 2. Legacy MO rows from masterRoster must NEVER fall back for December
    assert.equal(
      renderedHtml.includes('LegacyDecDoctor'),
      false,
      'December must never fall back to legacy masterRoster MO rows'
    );

    // 3. Requests must NEVER be auto-populated as confirmed shifts in December
    assert.equal(
      renderedHtml.includes('Afif'),
      false,
      'December requests must remain requests and never auto-populate as confirmed shifts'
    );
  });

  await t.test('13. EP rows in masterRoster are strictly filtered to the viewed post-cutover month', () => {
    const multiMonthMasterRoster = [
      {
        Name: 'Dr. EP November',
        Date: '2026-11-03',
        Shift: 'EP_OFFICE_HOUR'
      },
      {
        Name: 'Dr. EP December',
        Date: '2026-12-03',
        Shift: 'EP_OFFICE_HOUR'
      },
      {
        Name: 'Dr. EP October',
        Date: '2026-10-03',
        Shift: 'EP_OFFICE_HOUR'
      }
    ];

    const harness = createRosterPageHarness({
      initialRosterMonth: '2026-11',
      isEnrolled: true,
      lifecycleState: 'DRAFT',
      masterRoster: multiMonthMasterRoster
    });

    const renderedHtml = ReactDOMServer.renderToStaticMarkup(harness.tree);

    // November EP duty must appear
    assert.ok(renderedHtml.includes('Dr. EP November'), 'November EP duty must be rendered in November');

    // December and October EP duties must NOT bleed into November
    assert.equal(renderedHtml.includes('Dr. EP December'), false, 'December EP duty must not bleed into November');
    assert.equal(renderedHtml.includes('Dr. EP October'), false, 'October EP duty must not bleed into November');
  });

  await t.test('14. October legacy edit controls remain fully functional and allow toggling edit mode', () => {
    const harness = createRosterPageHarness({
      initialRosterMonth: '2026-10',
      isEnrolled: false,
      lifecycleState: null,
      isAdmin: true,
      masterRoster: [
        { Name: 'OctDoctor', Date: '2026-10-01', Shift: 'AM' }
      ]
    });

    const initialHtml = ReactDOMServer.renderToStaticMarkup(harness.tree);
    assert.ok(initialHtml.includes('Edit Roster'), 'Edit Roster button must be present in October');

    // Find the Edit Roster button and click it to toggle edit mode
    const editBtn = findNode(harness.tree, (n) => n?.props?.children?.includes?.('Edit Roster'));
    assert.ok(editBtn, 'Edit button node found');
    assert.equal(typeof editBtn.props.onClick, 'function');

    editBtn.props.onClick();

    const editingTree = harness.render();
    const editingHtml = ReactDOMServer.renderToStaticMarkup(editingTree);

    // In October, edit mode renders textareas for editing
    assert.ok(editingHtml.includes('<textarea'), 'October successfully transitions to editable textarea cells');
    assert.ok(editingHtml.includes('Cancel Edit'), 'Cancel Edit button appears in October edit mode');
  });
});
