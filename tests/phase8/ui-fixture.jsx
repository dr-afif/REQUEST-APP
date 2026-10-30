import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import LifecycleControls from '../../src/features/roster/components/LifecycleControls.jsx';
import Phase5RosterContainer from '../../src/features/roster/components/Phase5RosterContainer.jsx';

// Default mock datasets for Phase 8 UI tests
const DEFAULT_PEOPLE = [
  { personId: 'p-mo-1', name: 'Dr. Ali', dutyDomain: 'MO' },
  { personId: 'p-mo-2', name: 'Dr. Siti', dutyDomain: 'MO' },
  { personId: 'p-ep', name: 'Dr. Dave', dutyDomain: 'EP' }
];

const DEFAULT_PLANNED_ASSIGNMENTS = [
  // Dr. Ali (MO): 2026-05-01 Labour Day AM, 2026-05-02 Sat OFF, 2026-05-03 Sun PM, 2026-05-04 Mon AM, 2026-05-05 Tue OFF
  { assignmentId: 'asg-ali-1', personId: 'p-mo-1', personNameSnapshot: 'Dr. Ali', date: '2026-05-01', dutyDomain: 'MO', shiftCode: 'AM' },
  { assignmentId: 'asg-ali-2', personId: 'p-mo-1', personNameSnapshot: 'Dr. Ali', date: '2026-05-02', dutyDomain: 'MO', shiftCode: 'OFF' },
  { assignmentId: 'asg-ali-3', personId: 'p-mo-1', personNameSnapshot: 'Dr. Ali', date: '2026-05-03', dutyDomain: 'MO', shiftCode: 'PM' },
  { assignmentId: 'asg-ali-4', personId: 'p-mo-1', personNameSnapshot: 'Dr. Ali', date: '2026-05-04', dutyDomain: 'MO', shiftCode: 'AM' },
  { assignmentId: 'asg-ali-5', personId: 'p-mo-1', personNameSnapshot: 'Dr. Ali', date: '2026-05-05', dutyDomain: 'MO', shiftCode: 'OFF' },

  // Dr. Siti (MO): 2026-05-01 Labour Day OFF, 2026-05-02 Sat PM, 2026-05-03 Sun OFF, 2026-05-04 Mon PM, 2026-05-05 Tue AM
  { assignmentId: 'asg-siti-1', personId: 'p-mo-2', personNameSnapshot: 'Dr. Siti', date: '2026-05-01', dutyDomain: 'MO', shiftCode: 'OFF' },
  { assignmentId: 'asg-siti-2', personId: 'p-mo-2', personNameSnapshot: 'Dr. Siti', date: '2026-05-02', dutyDomain: 'MO', shiftCode: 'PM' },
  { assignmentId: 'asg-siti-3', personId: 'p-mo-2', personNameSnapshot: 'Dr. Siti', date: '2026-05-03', dutyDomain: 'MO', shiftCode: 'OFF' },
  { assignmentId: 'asg-siti-4', personId: 'p-mo-2', personNameSnapshot: 'Dr. Siti', date: '2026-05-04', dutyDomain: 'MO', shiftCode: 'PM' },
  { assignmentId: 'asg-siti-5', personId: 'p-mo-2', personNameSnapshot: 'Dr. Siti', date: '2026-05-05', dutyDomain: 'MO', shiftCode: 'AM' },

  // Dr. Dave (EP): 2026-05-01 to 2026-05-05 EP
  { assignmentId: 'asg-ep-1', personId: 'p-ep', personNameSnapshot: 'Dr. Dave', date: '2026-05-01', dutyDomain: 'EP', shiftCode: 'EP' },
  { assignmentId: 'asg-ep-2', personId: 'p-ep', personNameSnapshot: 'Dr. Dave', date: '2026-05-02', dutyDomain: 'EP', shiftCode: 'EP' },
  { assignmentId: 'asg-ep-3', personId: 'p-ep', personNameSnapshot: 'Dr. Dave', date: '2026-05-03', dutyDomain: 'EP', shiftCode: 'EP' },
  { assignmentId: 'asg-ep-4', personId: 'p-ep', personNameSnapshot: 'Dr. Dave', date: '2026-05-04', dutyDomain: 'EP', shiftCode: 'EP' },
  { assignmentId: 'asg-ep-5', personId: 'p-ep', personNameSnapshot: 'Dr. Dave', date: '2026-05-05', dutyDomain: 'EP', shiftCode: 'EP' }
];

window.mountPhase8Test = (options = {}) => {
  const {
    initialPeriod = '2026-05',
    initialState = 'PUBLISHED',
    initialRevision = 1,
    isAdmin = true,
    isEnrolled = true,
    settings = { roster_v2_read_enabled: true, roster_v2_write_enabled: true, write_queue_v2_enabled: true },
    plannedAssignments = DEFAULT_PLANNED_ASSIGNMENTS,
    currentAssignments = null,
    events = [],
    initialAbsences = [],
    initialReplacements = [],
    initialBalances = { 'p-mo-1': { GOFF: 2, GHKA: 1 }, 'p-mo-2': { GOFF: 0, GHKA: 0 } },
    initialTransactions = [],
    people = DEFAULT_PEOPLE,
    simulateRecoveryRequired = false,
    simulateRevisionConflict = false
  } = options;

  let currentPeriod = initialPeriod;
  let currentState = initialState;
  let currentRev = initialRevision;
  let currentAdmin = isAdmin;

  // Working data copies
  let storePlanned = structuredClone(plannedAssignments);
  let storeCurrent = currentAssignments ? structuredClone(currentAssignments) : structuredClone(plannedAssignments);
  let storeEvents = structuredClone(events);
  let storeAbsences = structuredClone(initialAbsences);
  let storeReplacements = structuredClone(initialReplacements);
  let storeBalances = new Map();
  Object.entries(initialBalances).forEach(([pId, bal]) => {
    storeBalances.set(pId, { GOFF: Number(bal.GOFF || 0), GHKA: Number(bal.GHKA || 0) });
  });
  let storeTransactions = structuredClone(initialTransactions);

  const callLog = {
    getPeriodLifecycle: [],
    getCurrentRoster: [],
    getPlannedRoster: [],
    getAmendmentHistory: [],
    getAbsences: [],
    getReplacements: [],
    getEntitlementBalances: [],
    getEntitlementTransactions: [],
    earnGoff: [],
    earnGhka: [],
    creditManual: [],
    consumeEntitlement: [],
    reverseCredit: [],
    reverseConsumption: [],
    recoverEntitlement: [],
    publish: [],
    close: [],
    reopen: []
  };

  const periodLifecycleMap = new Map();
  if (isEnrolled) {
    periodLifecycleMap.set(initialPeriod, {
      PeriodId: initialPeriod,
      State: initialState,
      Revision: initialRevision,
      SchemaVersion: 1
    });
    ['2026-04', '2026-06', '2026-09', '2026-10'].forEach(p => {
      periodLifecycleMap.set(p, {
        PeriodId: p,
        State: initialState,
        Revision: 1,
        SchemaVersion: 1
      });
    });
  }

  let subscribers = [];
  const notify = () => subscribers.forEach(fn => fn());

  const mockQueue = {
    enabled: () => Boolean(settings.roster_v2_write_enabled && settings.write_queue_v2_enabled),
    subscribe: (fn) => {
      subscribers.push(fn);
      return () => {
        subscribers = subscribers.filter(s => s !== fn);
      };
    },
    start: async () => {},
    view: () => {
      const ops = [];
      if (simulateRecoveryRequired) {
        ops.push({
          operationId: 'op-rec-sim-8',
          operationClass: 'ENTITLEMENT',
          operationType: 'ENTITLEMENT_CONSUME',
          status: 'RECOVERY_REQUIRED',
          everConfirmed: false
        });
      }
      return {
        operations: ops,
        lifecycle: {
          state: currentState,
          revision: currentRev
        }
      };
    },
    getPeriodLifecycle: async (period) => {
      callLog.getPeriodLifecycle.push(period);
      const rec = periodLifecycleMap.get(period);
      if (!rec) return { ok: false, error: 'NOT_FOUND' };
      return { ok: true, period: rec };
    },
    getCurrentRoster: async (period) => {
      callLog.getCurrentRoster.push(period);
      return {
        ok: true,
        period,
        revision: currentRev,
        assignments: storeCurrent,
        activeAmendmentCount: storeEvents.length
      };
    },
    getPlannedRoster: async (period) => {
      callLog.getPlannedRoster.push(period);
      return {
        ok: true,
        period,
        revision: currentRev,
        assignments: storePlanned
      };
    },
    getAmendmentHistory: async (period) => {
      callLog.getAmendmentHistory.push(period);
      return {
        ok: true,
        period,
        count: storeEvents.length,
        events: storeEvents
      };
    },
    getAbsences: async (period) => {
      callLog.getAbsences.push(period);
      return { ok: true, absences: storeAbsences };
    },
    getReplacements: async (period) => {
      callLog.getReplacements.push(period);
      return { ok: true, replacements: storeReplacements };
    },
    getEntitlementBalances: async ({ personId }) => {
      callLog.getEntitlementBalances.push(personId);
      const b = storeBalances.get(personId) || { GOFF: 0, GHKA: 0 };
      return { ok: true, personId, balances: { ...b } };
    },
    getEntitlementTransactions: async (params) => {
      callLog.getEntitlementTransactions.push(params);
      let txs = storeTransactions;
      if (params.personId) {
        txs = txs.filter(t => t.PersonId === params.personId || t.personId === params.personId);
      }
      return { ok: true, transactions: txs };
    },
    amend: async (period, payload) => {
      if (simulateRevisionConflict) {
        throw { code: 'REVISION_CONFLICT', message: 'Revision conflict simulated' };
      }
      currentRev += 1;
      currentState = 'AMENDED';
      const targetShift = payload.targetShiftCode || payload.afterAssignments?.[0]?.shiftCode || 'OFF';
      const cellIdx = storeCurrent.findIndex(a => a.personId === payload.personId && a.date === payload.date);
      if (cellIdx !== -1) {
        storeCurrent[cellIdx] = { ...storeCurrent[cellIdx], shiftCode: targetShift };
      }
      const ev = { eventId: `ev-${Date.now()}`, type: payload.eventType || 'CORRECTION', date: payload.date };
      storeEvents.push(ev);
      const rec = periodLifecycleMap.get(period);
      if (rec) {
        rec.State = 'AMENDED';
        rec.Revision = currentRev;
      }
      notify();
      return { ok: true, revision: currentRev, eventId: ev.eventId, undoExpiresAt: Date.now() + 10000 };
    },
    amendCell: async (period, payload) => {
      if (simulateRevisionConflict) {
        throw { code: 'REVISION_CONFLICT', message: 'Revision conflict simulated' };
      }
      currentRev += 1;
      currentState = 'AMENDED';
      const cellIdx = storeCurrent.findIndex(a => a.personId === payload.personId && a.date === payload.date);
      if (cellIdx !== -1) {
        storeCurrent[cellIdx] = { ...storeCurrent[cellIdx], shiftCode: payload.targetShiftCode };
      }
      const ev = { eventId: `ev-${Date.now()}`, type: 'CORRECTION', date: payload.date };
      storeEvents.push(ev);
      const rec = periodLifecycleMap.get(period);
      if (rec) {
        rec.State = 'AMENDED';
        rec.Revision = currentRev;
      }
      notify();
      return { ok: true, revision: currentRev, eventId: ev.eventId, undoExpiresAt: Date.now() + 10000 };
    },
    recordAbsence: async (period, payload) => {
      currentRev += 1;
      currentState = 'AMENDED';
      const absId = `abs-${Date.now()}`;
      const absenceRecord = {
        AbsenceId: absId,
        PeriodId: period,
        PersonId: payload.personId,
        Date: payload.date,
        DutyDomain: payload.dutyDomain,
        OriginalShiftCode: payload.originalShiftCode,
        AbsenceType: payload.absenceType,
        Status: 'ACTIVE',
        CoverageStatus: 'UNCOVERED'
      };
      storeAbsences.push(absenceRecord);
      const cellIdx = storeCurrent.findIndex(a => a.personId === payload.personId && a.date === payload.date);
      if (cellIdx !== -1) {
        storeCurrent[cellIdx] = {
          ...storeCurrent[cellIdx],
          shiftCode: payload.absenceType,
          source: 'ABSENCE',
          absenceId: absId,
          coverageStatus: 'UNCOVERED'
        };
      }
      notify();
      return { ok: true, absenceId: absId };
    },
    assignReplacement: async (period, payload) => {
      currentRev += 1;
      currentState = 'AMENDED';
      const replId = `repl-${Date.now()}`;
      storeReplacements.push({
        ReplacementId: replId,
        PeriodId: period,
        AbsenceId: payload.targetDuty.absenceId,
        TargetDutyPersonId: payload.targetDuty.personId,
        ReplacementPersonId: payload.replacementPersonId,
        Status: 'ACTIVE'
      });
      const absIdx = storeAbsences.findIndex(a => a.AbsenceId === payload.targetDuty.absenceId);
      if (absIdx !== -1) {
        storeAbsences[absIdx].CoverageStatus = 'COVERED';
        storeAbsences[absIdx].ReplacementId = replId;
      }
      const absCellIdx = storeCurrent.findIndex(a => a.personId === payload.targetDuty.personId && a.date === payload.targetDuty.date);
      if (absCellIdx !== -1) {
        storeCurrent[absCellIdx].coverageStatus = 'COVERED';
        storeCurrent[absCellIdx].replacementId = replId;
      }
      storeCurrent.push({
        assignmentId: `asg-repl-${Date.now()}`,
        personId: payload.replacementPersonId,
        personNameSnapshot: people.find(p => p.personId === payload.replacementPersonId)?.name || 'Dr. Replacement',
        date: payload.targetDuty.date,
        dutyDomain: payload.targetDuty.dutyDomain,
        shiftCode: payload.targetDuty.originalShiftCode,
        source: 'REPLACEMENT',
        replacementId: replId,
        coveringForPersonId: payload.targetDuty.personId
      });
      notify();
      return { ok: true, replacementId: replId };
    },
    publish: async (period) => {
      callLog.publish.push(period);
      currentState = 'PUBLISHED';
      currentRev += 1;
      const rec = periodLifecycleMap.get(period);
      if (rec) { rec.State = 'PUBLISHED'; rec.Revision = currentRev; }
      notify();
      return { ok: true, state: 'PUBLISHED', revision: currentRev };
    },
    close: async (period) => {
      callLog.close.push(period);
      currentState = 'CLOSED';
      currentRev += 1;
      const rec = periodLifecycleMap.get(period);
      if (rec) { rec.State = 'CLOSED'; rec.Revision = currentRev; }
      notify();
      return { ok: true, state: 'CLOSED', revision: currentRev };
    },
    reopen: async (period) => {
      callLog.reopen.push(period);
      currentState = 'AMENDED';
      currentRev += 1;
      const rec = periodLifecycleMap.get(period);
      if (rec) { rec.State = 'AMENDED'; rec.Revision = currentRev; }
      notify();
      return { ok: true, state: 'AMENDED', revision: currentRev };
    },
    enqueue: async (key, patches) => {
      callLog.enqueue = callLog.enqueue || [];
      callLog.enqueue.push({ key, patches });
      if (simulateRevisionConflict) {
        throw { code: 'REVISION_CONFLICT', message: 'Revision conflict simulated' };
      }
      if (window.phase8Test?.simulateGenericQueueFailure || options.simulateGenericQueueFailure) {
        throw new Error('Simulated network/queue persistence failure');
      }
      (patches || []).forEach(p => {
        const targetShift = p.assignments?.[0]?.shiftCode || 'OFF';
        const cellIdx = storeCurrent.findIndex(a => a.personId === p.personId && a.date === p.date);
        if (cellIdx !== -1) {
          storeCurrent[cellIdx] = { ...storeCurrent[cellIdx], shiftCode: targetShift };
        } else {
          storeCurrent.push({
            assignmentId: `asg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            personId: p.personId,
            date: p.date,
            dutyDomain: p.dutyDomain || 'MO',
            shiftCode: targetShift
          });
        }
      });
      notify();
      return { ok: true };
    }
  };

  const container = document.createElement('div');
  container.id = 'phase8-test-container';
  document.body.appendChild(container);
  const root = createRoot(container);

  function Wrapper() {
    const [period, setPeriod] = useState(currentPeriod);
    const [admin, setAdmin] = useState(currentAdmin);
    const [lifecycleInfo, setLifecycleInfo] = useState({
      period: currentPeriod,
      isEnrolled,
      state: currentState,
      revision: currentRev
    });

    window.__setPeriod = setPeriod;
    window.__setAdmin = setAdmin;

    const isV2Active = Boolean(
      lifecycleInfo.isEnrolled &&
      ['DRAFT', 'PUBLISHED', 'AMENDED', 'CLOSED'].includes(lifecycleInfo.state) &&
      settings?.roster_v2_read_enabled !== false
    );

    return (
      <div
        id="roster-page-workspace"
        data-testid="roster-page-workspace"
        className={`mx-auto px-2 sm:px-4 lg:px-6 py-4 sm:py-6 md:py-8 animate-fadeIn ${
          isV2Active ? 'w-full max-w-none' : 'max-w-5xl'
        }`}
      >
        {/* Navigation & Controls Header */}
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl lg:text-3xl font-extrabold flex items-center gap-2">
                <span>📅</span>
                <span>Full Roster</span>
              </h1>
            </div>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                id="btn-prev-month"
                onClick={() => {
                  if (period === '2026-10') setPeriod('2026-09');
                  else setPeriod('2026-04');
                }}
                className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs sm:text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                ‹ Prev
              </button>
              <button
                type="button"
                id="btn-current-month"
                onClick={() => setPeriod(initialPeriod)}
                className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs sm:text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Current Month
              </button>
              <button
                type="button"
                id="btn-next-month"
                onClick={() => {
                  if (period === '2026-09') setPeriod('2026-10');
                  else setPeriod('2026-06');
                }}
                className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs sm:text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Next ›
              </button>
            </div>
          </div>

          <div className="flex flex-col sm:items-end gap-2 shrink-0">
            <LifecycleControls
              period={period}
              settings={settings}
              isAdmin={admin}
              queue={mockQueue}
              onLifecycleStateChange={setLifecycleInfo}
            />
          </div>
        </div>

        {/* Phase 5/8 V2 Authoritative Roster Workspace */}
        <Phase5RosterContainer
          period={period}
          settings={settings}
          isAdmin={admin}
          queue={mockQueue}
          people={people}
          onLifecycleStateChange={setLifecycleInfo}
          allowDraft={true}
        />
      </div>
    );
  }

  root.render(<Wrapper />);

  window.phase8Test = {
    mockQueue,
    callLog,
    periodLifecycleMap,
    storeBalances,
    storeTransactions,
    storeCurrent,
    storePlanned,
    simulateGenericQueueFailure: Boolean(options.simulateGenericQueueFailure),
    setPeriod: (p) => window.__setPeriod?.(p),
    setAdmin: (a) => window.__setAdmin?.(a),
    enrollPeriod: (p, state = 'PUBLISHED', rev = 1) => {
      periodLifecycleMap.set(p, { PeriodId: p, State: state, Revision: rev, SchemaVersion: 1 });
    },
    close: () => {
      if (container.isConnected) {
        root.unmount();
        container.remove();
      }
      window.phase8Test = null;
    }
  };
};
