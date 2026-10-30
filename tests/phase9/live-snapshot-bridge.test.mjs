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

test('V2 Unified Roster — Slice B1c Read-Only Live Snapshot Bridge Suite', async (t) => {
  let Phase5RosterContainer;

  t.before(async () => {
    Phase5RosterContainer = await loadJsxComponent('src/features/roster/components/Phase5RosterContainer.jsx');
  });

  // Helper to run component with controlled state and execute useEffect
  const runWithMockStates = (mockStates, props) => {
    const origDispatcher = React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentDispatcher.current;
    let stateIndex = 0;
    const refStore = new Map();
    let refIndex = 0;
    const effects = [];

    try {
      React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentDispatcher.current = {
        useState: (initial) => {
          const val = stateIndex < mockStates.length ? mockStates[stateIndex] : initial;
          stateIndex++;
          return [val, () => {}];
        },
        useRef: (initial) => {
          const key = refIndex++;
          if (!refStore.has(key)) {
            refStore.set(key, { current: initial });
          }
          return refStore.get(key);
        },
        useCallback: (cb) => cb,
        useEffect: (cb) => {
          effects.push(cb);
        },
        useMemo: (cb) => cb()
      };

      const element = Phase5RosterContainer(props);

      // Execute registered effects
      for (const eff of effects) {
        if (typeof eff === 'function') {
          eff();
        }
      }

      return element;
    } finally {
      React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentDispatcher.current = origDispatcher;
    }
  };

  // Base state array matching the useState declarations in Phase5RosterContainer:
  // 0: queue
  // 1: viewMode
  // 2: loading
  // 3: lifecycle
  // 4: currentRoster
  // 5: plannedRoster
  // 6: amendmentHistory
  // 7: absences
  // 8: replacements
  // 9: internalPeople
  // 10: draftReadError
  // 11: actionError
  // 12: revisionConflictMsg
  // 13: recoveryOp
  // 14: isRecovering
  // 15: selectedCellForAmend
  // 16: isSubmittingAmend
  // 17: isAbsenceModalOpen
  // 18: selectedDutyForAbsence
  // 19: isSubmittingAbsence
  // 20: selectedDutyForReplacement
  // 21: isSubmittingReplacement
  // 22: isReversingPhase6
  // 23: selectedPersonForEntitlement
  // 24: entitlementBalances
  // 25: entitlementTransactions
  // 26: isCreditModalOpen
  // 27: creditModalConfig
  // 28: selectedDutyForEntitlement
  // 29: consumeEntitlementType
  // 30: isSubmittingCredit
  // 31: isSubmittingConsume
  // 32: isReversingEntitlement
  // 33: undoEvent
  // 34: isFocusMode
  // 35: draftUndoStack
  // 36: draftRedoStack
  // 37: isSavingDraft
  // 38: draftSaveStatus
  // 39: adminAuthTriggerTick
  const createBaseMockStates = (overrides = {}) => {
    const states = [
      null, // 0: queue
      'CURRENT', // 1: viewMode
      true, // 2: loading
      null, // 3: lifecycle
      null, // 4: currentRoster
      null, // 5: plannedRoster
      null, // 6: amendmentHistory
      [], // 7: absences
      [], // 8: replacements
      [], // 9: internalPeople
      null, // 10: draftReadError
      null, // 11: actionError
      null, // 12: revisionConflictMsg
      null, // 13: recoveryOp
      false, // 14: isRecovering
      null, // 15: selectedCellForAmend
      false, // 16: isSubmittingAmend
      false, // 17: isAbsenceModalOpen
      null, // 18: selectedDutyForAbsence
      false, // 19: isSubmittingAbsence
      null, // 20: selectedDutyForReplacement
      false, // 21: isSubmittingReplacement
      false, // 22: isReversingPhase6
      null, // 23: selectedPersonForEntitlement
      { GOFF: 0, GHKA: 0 }, // 24: entitlementBalances
      [], // 25: entitlementTransactions
      false, // 26: isCreditModalOpen
      null, // 27: creditModalConfig
      null, // 28: selectedDutyForEntitlement
      'GOFF', // 29: consumeEntitlementType
      false, // 30: isSubmittingCredit
      false, // 31: isSubmittingConsume
      false, // 32: isReversingEntitlement
      null, // 33: undoEvent
      false, // 34: isFocusMode
      [], // 35: draftUndoStack
      [], // 36: draftRedoStack
      false, // 37: isSavingDraft
      null, // 38: draftSaveStatus
      0 // 39: adminAuthTriggerTick
    ];

    Object.entries(overrides).forEach(([idx, val]) => {
      states[Number(idx)] = val;
    });

    return states;
  };

  await t.test('1. Initial November hydration emits correct period and assignments', () => {
    const testAssignments = [
      {
        assignmentId: 'asg-1',
        personId: 'd89cf180-37c8-448c-8ebc-927724e4b79c',
        personNameSnapshot: 'Adi',
        date: '2026-11-01',
        shiftCode: 'AM',
        dutyDomain: 'MO'
      },
      {
        assignmentId: 'asg-2',
        personId: 'a9bc3a8e-c60f-4990-8fb3-ab91321c9e44',
        personNameSnapshot: 'Azrul',
        date: '2026-11-01',
        shiftCode: 'PM',
        dutyDomain: 'MO'
      }
    ];

    let emittedSnapshot = null;
    const states = createBaseMockStates({
      2: false, // loading = false
      3: { state: 'DRAFT', revision: 1, draftRevision: 1 }, // lifecycle
      4: { ok: true, period: '2026-11', state: 'DRAFT', revision: 1, assignments: testAssignments }, // currentRoster
      38: 'saved' // draftSaveStatus
    });

    runWithMockStates(states, {
      period: '2026-11',
      allowDraft: true,
      onLiveSnapshotChange: (s) => {
        emittedSnapshot = s;
      }
    });

    assert.ok(emittedSnapshot !== null, 'Snapshot must be emitted on hydration');
    assert.equal(emittedSnapshot.period, '2026-11');
    assert.equal(emittedSnapshot.state, 'DRAFT');
    assert.equal(emittedSnapshot.revision, 1);
    assert.equal(emittedSnapshot.isLoaded, true);
    assert.equal(emittedSnapshot.isSaving, false);
    assert.equal(emittedSnapshot.draftSaveStatus, 'saved');
    assert.equal(emittedSnapshot.assignments.length, 2);
    assert.equal(emittedSnapshot.assignments[0].personNameSnapshot, 'Adi');
  });

  await t.test('2. Optimistic cell changes become visible in emitted snapshot immediately', () => {
    const optimisticAssignments = [
      {
        assignmentId: 'asg-1',
        personId: 'd89cf180-37c8-448c-8ebc-927724e4b79c',
        personNameSnapshot: 'Adi',
        date: '2026-11-01',
        shiftCode: 'PM', // changed from AM to PM
        dutyDomain: 'MO'
      }
    ];

    let emittedSnapshot = null;
    const states = createBaseMockStates({
      2: false,
      3: { state: 'DRAFT', revision: 1 },
      4: { ok: true, period: '2026-11', state: 'DRAFT', revision: 1, assignments: optimisticAssignments },
      37: true, // isSavingDraft: true (save in progress!)
      38: 'saving' // draftSaveStatus: saving
    });

    runWithMockStates(states, {
      period: '2026-11',
      allowDraft: true,
      onLiveSnapshotChange: (s) => {
        emittedSnapshot = s;
      }
    });

    assert.ok(emittedSnapshot);
    assert.equal(emittedSnapshot.isLoaded, true);
    assert.equal(emittedSnapshot.isSaving, true);
    assert.equal(emittedSnapshot.draftSaveStatus, 'saving');
    assert.equal(emittedSnapshot.assignments[0].shiftCode, 'PM');
  });

  await t.test('3. Bulk edits update the snapshot', () => {
    const bulkAssignments = [
      {
        assignmentId: 'asg-1',
        personId: 'd89cf180-37c8-448c-8ebc-927724e4b79c',
        personNameSnapshot: 'Adi',
        date: '2026-11-01',
        shiftCode: 'ON1',
        dutyDomain: 'MO'
      },
      {
        assignmentId: 'asg-2',
        personId: 'a9bc3a8e-c60f-4990-8fb3-ab91321c9e44',
        personNameSnapshot: 'Azrul',
        date: '2026-11-01',
        shiftCode: 'ON2',
        dutyDomain: 'MO'
      }
    ];

    let emittedSnapshot = null;
    const states = createBaseMockStates({
      2: false,
      3: { state: 'DRAFT', revision: 2 },
      4: { ok: true, period: '2026-11', state: 'DRAFT', revision: 2, assignments: bulkAssignments },
      37: true,
      38: 'saving'
    });

    runWithMockStates(states, {
      period: '2026-11',
      allowDraft: true,
      onLiveSnapshotChange: (s) => {
        emittedSnapshot = s;
      }
    });

    assert.equal(emittedSnapshot.assignments.length, 2);
    assert.equal(emittedSnapshot.assignments[0].shiftCode, 'ON1');
    assert.equal(emittedSnapshot.assignments[1].shiftCode, 'ON2');
  });

  await t.test('4. Undo/redo update the snapshot correctly', () => {
    const revertedAssignments = [
      {
        assignmentId: 'asg-1',
        personId: 'd89cf180-37c8-448c-8ebc-927724e4b79c',
        personNameSnapshot: 'Adi',
        date: '2026-11-01',
        shiftCode: 'AM', // Reverted back to AM
        dutyDomain: 'MO'
      }
    ];

    let emittedSnapshot = null;
    const states = createBaseMockStates({
      2: false,
      3: { state: 'DRAFT', revision: 1 },
      4: { ok: true, period: '2026-11', state: 'DRAFT', revision: 1, assignments: revertedAssignments },
      35: [], // Undo stack emptied
      36: [{ type: 'SINGLE' }], // Redo stack populated
      37: false,
      38: 'saved'
    });

    runWithMockStates(states, {
      period: '2026-11',
      allowDraft: true,
      onLiveSnapshotChange: (s) => {
        emittedSnapshot = s;
      }
    });

    assert.equal(emittedSnapshot.assignments[0].shiftCode, 'AM');
    assert.equal(emittedSnapshot.isLoaded, true);
  });

  await t.test('5. Save status changes are reflected without losing assignments', () => {
    const assignments = [
      {
        assignmentId: 'asg-1',
        personId: 'd89cf180-37c8-448c-8ebc-927724e4b79c',
        personNameSnapshot: 'Adi',
        date: '2026-11-01',
        shiftCode: 'AM',
        dutyDomain: 'MO'
      }
    ];

    let emittedSnapshot = null;
    const states = createBaseMockStates({
      2: false,
      3: { state: 'DRAFT', revision: 2 },
      4: { ok: true, period: '2026-11', state: 'DRAFT', revision: 2, assignments },
      37: false, // isSavingDraft is false now
      38: 'saved' // draftSaveStatus is confirmed saved
    });

    runWithMockStates(states, {
      period: '2026-11',
      allowDraft: true,
      onLiveSnapshotChange: (s) => {
        emittedSnapshot = s;
      }
    });

    assert.equal(emittedSnapshot.isSaving, false);
    assert.equal(emittedSnapshot.draftSaveStatus, 'saved');
    assert.equal(emittedSnapshot.assignments.length, 1);
  });

  await t.test('6. Switching months does not emit stale assignments under the new period', () => {
    let emittedSnapshot = null;

    // Simulate switching month to 2026-12 while currentRoster has old 2026-11 data and loading is true
    const states = createBaseMockStates({
      2: true, // loading is true for new month
      3: null, // lifecycle reset
      4: { ok: true, period: '2026-11', assignments: [{ date: '2026-11-01' }] } // stale November roster!
    });

    runWithMockStates(states, {
      period: '2026-12', // Requesting December
      allowDraft: true,
      onLiveSnapshotChange: (s) => {
        emittedSnapshot = s;
      }
    });

    assert.ok(emittedSnapshot);
    assert.equal(emittedSnapshot.period, '2026-12');
    assert.equal(emittedSnapshot.isLoaded, false);
    assert.deepEqual(emittedSnapshot.assignments, [], 'Stale November assignments must NOT leak into December');
  });

  await t.test('7. Authentication failure does not emit isLoaded: true', () => {
    let emittedSnapshot = null;

    const states = createBaseMockStates({
      2: false,
      3: { state: 'DRAFT', revision: 0 },
      4: null,
      10: 'AUTHORIZATION_REQUIRED' // draftReadError
    });

    runWithMockStates(states, {
      period: '2026-11',
      allowDraft: true,
      onLiveSnapshotChange: (s) => {
        emittedSnapshot = s;
      }
    });

    assert.ok(emittedSnapshot);
    assert.equal(emittedSnapshot.period, '2026-11');
    assert.equal(emittedSnapshot.isLoaded, false, 'Auth failure must not emit isLoaded: true');
    assert.deepEqual(emittedSnapshot.assignments, []);
  });

  await t.test('8. Existing functionality remains unchanged when callback prop is omitted', () => {
    const states = createBaseMockStates({
      2: false,
      3: { state: 'DRAFT', revision: 1 },
      4: { ok: true, period: '2026-11', assignments: [] }
    });

    assert.doesNotThrow(() => {
      runWithMockStates(states, {
        period: '2026-11',
        allowDraft: true
        // onLiveSnapshotChange omitted
      });
    });
  });

  await t.test('9. Calendar projection adapter accepts the emitted assignment shape without semantic loss', () => {
    const emittedAssignments = [
      {
        assignmentId: 'asg-adi-am',
        personId: 'd89cf180-37c8-448c-8ebc-927724e4b79c',
        personNameSnapshot: 'Adi',
        date: '2026-11-01',
        shiftCode: 'AM',
        rawShift: 'AMX',
        dutyDomain: 'MO'
      },
      {
        assignmentId: 'asg-azrul-on1',
        personId: 'a9bc3a8e-c60f-4990-8fb3-ab91321c9e44',
        personNameSnapshot: 'Azrul',
        date: '2026-11-01',
        shiftCode: 'ON1',
        dutyDomain: 'MO'
      }
    ];

    const calendarRows = projectNormalizedAssignmentsToCalendarRows(emittedAssignments);
    assert.equal(calendarRows.length, 2);

    const adiRow = calendarRows.find((r) => r.Name === 'Adi');
    assert.equal(adiRow.Shift, 'AMX');
    assert.equal(adiRow.Date, '2026-11-01');
    assert.equal(adiRow.modifiers.extended, true);
    assert.equal(adiRow.dutyDomain, 'MO');

    const azrulRow = calendarRows.find((r) => r.Name === 'Azrul');
    assert.equal(azrulRow.Shift, 'ON1');
    assert.equal(azrulRow.Date, '2026-11-01');
    assert.equal(azrulRow.dutyDomain, 'MO');
  });
});
