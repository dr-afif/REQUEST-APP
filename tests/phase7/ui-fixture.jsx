import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import LifecycleControls from '../../src/features/roster/components/LifecycleControls.jsx';
import Phase5RosterContainer from '../../src/features/roster/components/Phase5RosterContainer.jsx';

// Default mock datasets for Phase 7 UI tests
const DEFAULT_PEOPLE = [
  { personId: 'p-mo-1', name: 'Dr. Ali', dutyDomain: 'MO' },
  { personId: 'p-mo-2', name: 'Dr. Siti', dutyDomain: 'MO' },
  { personId: 'p-ep', name: 'Dr. Dave', dutyDomain: 'EP' }
];

const DEFAULT_PLANNED_ASSIGNMENTS = [
  // Dr. Ali (MO): 2026-05-01 Labour Day AM, 2026-05-02 OFF, 2026-05-03 PM
  { assignmentId: 'asg-ali-1', personId: 'p-mo-1', personNameSnapshot: 'Dr. Ali', date: '2026-05-01', dutyDomain: 'MO', shiftCode: 'AM' },
  { assignmentId: 'asg-ali-2', personId: 'p-mo-1', personNameSnapshot: 'Dr. Ali', date: '2026-05-02', dutyDomain: 'MO', shiftCode: 'OFF' },
  { assignmentId: 'asg-ali-3', personId: 'p-mo-1', personNameSnapshot: 'Dr. Ali', date: '2026-05-03', dutyDomain: 'MO', shiftCode: 'PM' },

  // Dr. Siti (MO): 2026-05-01 OFF, 2026-05-02 PM, 2026-05-03 OFF
  { assignmentId: 'asg-siti-1', personId: 'p-mo-2', personNameSnapshot: 'Dr. Siti', date: '2026-05-01', dutyDomain: 'MO', shiftCode: 'OFF' },
  { assignmentId: 'asg-siti-2', personId: 'p-mo-2', personNameSnapshot: 'Dr. Siti', date: '2026-05-02', dutyDomain: 'MO', shiftCode: 'PM' },
  { assignmentId: 'asg-siti-3', personId: 'p-mo-2', personNameSnapshot: 'Dr. Siti', date: '2026-05-03', dutyDomain: 'MO', shiftCode: 'OFF' },

  // Dr. Dave (EP): 2026-05-01 EP_DUTY
  { assignmentId: 'asg-ep-1', personId: 'p-ep', personNameSnapshot: 'Dr. Dave', date: '2026-05-01', dutyDomain: 'EP', shiftCode: 'EP_DUTY' }
];

window.mountPhase7Test = (options = {}) => {
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
    delayedPeriod = null,
    delayMs = 0,
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
  }

  let subscribers = [];
  const notify = () => subscribers.forEach(fn => fn());

  let mockOperations = [];
  if (simulateRecoveryRequired) {
    const opType = typeof simulateRecoveryRequired === 'string'
      ? simulateRecoveryRequired
      : 'ENTITLEMENT_CONSUME';
    const opId = 'rec-ent-123';
    mockOperations.push({
      operationId: opId,
      operationType: opType,
      status: 'RECOVERY_REQUIRED',
      attemptCount: 1,
      lastError: 'RECOVERY_REQUIRED'
    });
  }

  const mockQueue = {
    enabled: () => Boolean(settings.roster_v2_write_enabled && settings.write_queue_v2_enabled),
    subscribe: (fn) => {
      subscribers.push(fn);
      return () => { subscribers = subscribers.filter(s => s !== fn); };
    },
    start: async () => {},
    view: () => ({
      lifecycle: { state: currentState, revision: currentRev },
      operations: mockOperations
    }),
    getPeriodLifecycle: async (p) => {
      callLog.getPeriodLifecycle.push(p);
      if (delayedPeriod === p && delayMs > 0) {
        await new Promise(r => setTimeout(r, delayMs));
      }
      if (periodLifecycleMap.has(p)) {
        return { ok: true, period: periodLifecycleMap.get(p) };
      }
      return { ok: true, period: null };
    },
    getCurrentRoster: async (p) => {
      callLog.getCurrentRoster.push(p);
      if (delayedPeriod === p && delayMs > 0) {
        await new Promise(r => setTimeout(r, delayMs));
      }
      const periodAssignments = storeCurrent.filter(a => (a.date || '').startsWith(p));
      return {
        ok: true,
        periodId: p,
        effectiveState: currentState,
        activeAmendmentCount: storeEvents.filter(e => !e.isReversed && e.EventType !== 'REVERSAL').length +
          storeAbsences.filter(a => a.Status === 'ACTIVE' && (a.PeriodId === p || (a.StartDate || '').startsWith(p))).length +
          storeTransactions.filter(t => t.TransactionType === 'CONSUMPTION' && !t.isReversed).length,
        count: periodAssignments.length,
        assignments: structuredClone(periodAssignments)
      };
    },
    getPlannedRoster: async (p) => {
      callLog.getPlannedRoster.push(p);
      if (delayedPeriod === p && delayMs > 0) {
        await new Promise(r => setTimeout(r, delayMs));
      }
      const periodAssignments = storePlanned.filter(a => (a.date || '').startsWith(p));
      return {
        ok: true,
        periodId: p,
        plannedSnapshotId: 'SNAP-MOCK-P7',
        count: periodAssignments.length,
        assignments: structuredClone(periodAssignments)
      };
    },
    getAmendmentHistory: async (p) => {
      callLog.getAmendmentHistory.push(p);
      return {
        ok: true,
        periodId: p,
        count: storeEvents.length,
        isAdmin: currentAdmin,
        events: structuredClone(storeEvents)
      };
    },
    getAbsences: async (p) => {
      callLog.getAbsences.push(p);
      const periodAbs = storeAbsences.filter(a => a.PeriodId === p || (a.StartDate || '').startsWith(p));
      return {
        ok: true,
        periodId: p,
        count: periodAbs.length,
        isAdmin: currentAdmin,
        absences: structuredClone(periodAbs)
      };
    },
    getReplacements: async (p) => {
      callLog.getReplacements.push(p);
      const periodRepl = storeReplacements.filter(r => (r.Date || '').startsWith(p));
      return {
        ok: true,
        periodId: p,
        count: periodRepl.length,
        isAdmin: currentAdmin,
        replacements: structuredClone(periodRepl)
      };
    },
    getEntitlementBalances: async (params) => {
      const pId = typeof params === 'object' ? params.personId : params;
      callLog.getEntitlementBalances.push({ personId: pId });
      if (!currentAdmin) {
        throw new Error('AUTHORIZATION_REQUIRED: Administrator authorization required to view entitlement balances');
      }
      const currentBal = storeBalances.get(pId) || { GOFF: 0, GHKA: 0 };
      return {
        ok: true,
        personId: pId,
        balances: { GOFF: currentBal.GOFF, GHKA: currentBal.GHKA }
      };
    },
    getEntitlementTransactions: async (params) => {
      callLog.getEntitlementTransactions.push(params);
      if (!currentAdmin) {
        throw new Error('AUTHORIZATION_REQUIRED: Administrator authorization required to view entitlement transactions');
      }
      const pId = params?.personId;
      const periodId = params?.periodId;
      let txs = structuredClone(storeTransactions);
      if (pId) txs = txs.filter(t => t.PersonId === pId || t.personId === pId);
      if (periodId) txs = txs.filter(t => (t.EffectiveDate || t.date || '').startsWith(periodId));

      return {
        ok: true,
        count: txs.length,
        isAdmin: currentAdmin,
        transactions: txs
      };
    },
    earnGoff: async (p, payload, opts = {}) => {
      callLog.earnGoff.push({ period: p, payload, opts });
      const pId = payload.personId;
      const bal = storeBalances.get(pId) || { GOFF: 0, GHKA: 0 };
      bal.GOFF += 1;
      storeBalances.set(pId, bal);

      const txId = `tx-goff-earn-${Date.now()}`;
      storeTransactions.unshift({
        TransactionId: txId,
        PersonId: pId,
        EntitlementType: 'GOFF',
        TransactionType: 'CREDIT',
        SourceType: 'DISPLACED_OFF',
        Amount: 1,
        EffectiveDate: payload.date,
        AdminNote: payload.adminNote || '',
        Status: 'CONFIRMED'
      });

      // Credit-only operation does NOT alter lifecycle state (remains PUBLISHED)
      notify();
      return { ok: true, status: 'CONFIRMED', transactionId: txId, state: currentState, revision: currentRev };
    },
    earnGhka: async (p, payload, opts = {}) => {
      callLog.earnGhka.push({ period: p, payload, opts });
      const pId = payload.personId;
      const bal = storeBalances.get(pId) || { GOFF: 0, GHKA: 0 };
      bal.GHKA += 1;
      storeBalances.set(pId, bal);

      const txId = `tx-ghka-earn-${Date.now()}`;
      storeTransactions.unshift({
        TransactionId: txId,
        PersonId: pId,
        EntitlementType: 'GHKA',
        TransactionType: 'CREDIT',
        SourceType: 'PUBLIC_HOLIDAY',
        Amount: 1,
        EffectiveDate: payload.date,
        HolidayName: payload.holidayName || 'Public Holiday',
        HolidayDate: payload.date,
        AdminNote: payload.adminNote || '',
        Status: 'CONFIRMED'
      });

      // Credit-only operation does NOT alter lifecycle state
      notify();
      return { ok: true, status: 'CONFIRMED', transactionId: txId, state: currentState, revision: currentRev };
    },
    creditManual: async (p, payload, opts = {}) => {
      callLog.creditManual.push({ period: p, payload, opts });
      const pId = payload.personId;
      const type = payload.entitlementType;
      const bal = storeBalances.get(pId) || { GOFF: 0, GHKA: 0 };
      bal[type] += Number(payload.amount || 1);
      storeBalances.set(pId, bal);

      const txId = `tx-manual-${Date.now()}`;
      storeTransactions.unshift({
        TransactionId: txId,
        PersonId: pId,
        EntitlementType: type,
        TransactionType: 'CREDIT',
        SourceType: 'MANUAL',
        Amount: 1,
        EffectiveDate: payload.effectiveDate || payload.date,
        ReasonCode: payload.reasonCode || 'ADMINISTRATIVE_ADJUSTMENT',
        AdminNote: payload.adminNote || '',
        Status: 'CONFIRMED'
      });

      notify();
      return { ok: true, status: 'CONFIRMED', transactionId: txId, state: currentState, revision: currentRev };
    },
    consumeEntitlement: async (p, payload, opts = {}) => {
      callLog.consumeEntitlement.push({ period: p, payload, opts });
      if (simulateRevisionConflict) {
        const err = new Error('REVISION_CONFLICT');
        err.code = 'REVISION_CONFLICT';
        throw err;
      }
      if (currentState === 'CLOSED') {
        const err = new Error('INVALID_STATE');
        err.code = 'INVALID_STATE';
        throw err;
      }

      const pId = payload.personId;
      const type = payload.entitlementType;
      const bal = storeBalances.get(pId) || { GOFF: 0, GHKA: 0 };
      if (bal[type] <= 0) {
        const err = new Error(`INSUFFICIENT_${type}_BALANCE`);
        err.code = `INSUFFICIENT_${type}_BALANCE`;
        throw err;
      }

      bal[type] -= 1;
      storeBalances.set(pId, bal);

      // Mutate Current roster assignment
      const target = storeCurrent.find(a => a.personId === pId && a.date === payload.date);
      if (target) {
        target.shiftCode = type;
        target.source = type;
      }

      const txId = `tx-consume-${Date.now()}`;
      storeTransactions.unshift({
        TransactionId: txId,
        PersonId: pId,
        EntitlementType: type,
        TransactionType: 'CONSUMPTION',
        Amount: 1,
        EffectiveDate: payload.date,
        AdminNote: payload.adminNote || '',
        Status: 'CONFIRMED'
      });

      // Consumption alters lifecycle to AMENDED and bumps revision!
      currentState = 'AMENDED';
      currentRev += 1;
      if (periodLifecycleMap.has(p)) {
        const rec = periodLifecycleMap.get(p);
        rec.State = 'AMENDED';
        rec.Revision = currentRev;
      }

      notify();
      return { ok: true, state: currentState, revision: currentRev, transactionId: txId };
    },
    reverseConsumption: async (p, txId, opts = {}) => {
      callLog.reverseConsumption.push({ period: p, txId, opts });
      const tx = storeTransactions.find(t => (t.TransactionId || t.transactionId) === txId);
      if (!tx) throw new Error('TRANSACTION_NOT_FOUND');

      const pId = tx.PersonId || tx.personId;
      const type = tx.EntitlementType || tx.entitlementType;
      const date = tx.EffectiveDate || tx.date;

      const bal = storeBalances.get(pId) || { GOFF: 0, GHKA: 0 };
      bal[type] += 1;
      storeBalances.set(pId, bal);
      tx.isReversed = true;

      // Revert Current roster assignment back to Planned
      const cur = storeCurrent.find(a => a.personId === pId && a.date === date);
      const plan = storePlanned.find(a => a.personId === pId && a.date === date);
      if (cur && plan) {
        cur.shiftCode = plan.shiftCode;
        cur.source = 'PLANNED';
      }

      const revTxId = `tx-rev-consume-${Date.now()}`;
      storeTransactions.unshift({
        TransactionId: revTxId,
        PersonId: pId,
        EntitlementType: type,
        TransactionType: 'CONSUMPTION_REVERSAL',
        Amount: 1,
        EffectiveDate: date,
        OriginalTransactionId: txId,
        Status: 'CONFIRMED'
      });

      // Recalculate lifecycle: if no other amendments/absences/consumptions active, restore PUBLISHED!
      const activeConsumptions = storeTransactions.filter(t => t.TransactionType === 'CONSUMPTION' && !t.isReversed);
      const activeAbsences = storeAbsences.filter(a => a.Status === 'ACTIVE');
      const activeAmendments = storeEvents.filter(e => !e.isReversed);

      if (activeConsumptions.length === 0 && activeAbsences.length === 0 && activeAmendments.length === 0) {
        currentState = 'PUBLISHED';
      }
      currentRev += 1;
      if (periodLifecycleMap.has(p)) {
        const rec = periodLifecycleMap.get(p);
        rec.State = currentState;
        rec.Revision = currentRev;
      }

      notify();
      return { ok: true, state: currentState, revision: currentRev, transactionId: revTxId };
    },
    reverseCredit: async (p, txId, opts = {}) => {
      callLog.reverseCredit.push({ period: p, txId, opts });
      const tx = storeTransactions.find(t => (t.TransactionId || t.transactionId) === txId);
      if (!tx) throw new Error('TRANSACTION_NOT_FOUND');

      const pId = tx.PersonId || tx.personId;
      const type = tx.EntitlementType || tx.entitlementType;
      const bal = storeBalances.get(pId) || { GOFF: 0, GHKA: 0 };

      // Dependent consumption check
      if (bal[type] < 1) {
        const err = new Error('DEPENDENT_CONSUMPTION_EXISTS');
        err.code = 'DEPENDENT_CONSUMPTION_EXISTS';
        throw err;
      }

      bal[type] -= 1;
      storeBalances.set(pId, bal);
      tx.isReversed = true;

      const revTxId = `tx-rev-credit-${Date.now()}`;
      storeTransactions.unshift({
        TransactionId: revTxId,
        PersonId: pId,
        EntitlementType: type,
        TransactionType: 'CREDIT_REVERSAL',
        Amount: 1,
        EffectiveDate: tx.EffectiveDate || tx.date,
        OriginalTransactionId: txId,
        Status: 'CONFIRMED'
      });

      notify();
      return { ok: true, state: currentState, revision: currentRev, transactionId: revTxId };
    },
    recoverEntitlement: async (opId) => {
      callLog.recoverEntitlement.push({ operationId: opId });
      mockOperations = mockOperations.filter(o => o.operationId !== opId);
      notify();
      return { ok: true, status: 'CONFIRMED', operationId: opId, state: currentState, revision: currentRev };
    },
    retry: async (key, opId) => {
      return mockQueue.recoverEntitlement(opId);
    }
  };

  const container = document.createElement('div');
  container.id = 'phase7-test-root';
  document.body.appendChild(container);
  const root = createRoot(container);

  function Wrapper() {
    const [period, setPeriod] = useState(initialPeriod);
    const [admin, setAdmin] = useState(isAdmin);
    const [, setLifecycleState] = useState(initialState);

    window.__setPeriod = (p) => {
      currentPeriod = p;
      setPeriod(p);
    };
    window.__setAdmin = (a) => {
      currentAdmin = a;
      setAdmin(a);
    };

    return (
      <div className="p-4 space-y-4 max-w-6xl mx-auto">
        <div className="flex items-center justify-between pb-3 border-b border-slate-200">
          <h2 className="text-xl font-bold">Roster Page V2 — Phase 7</h2>
          <LifecycleControls
            period={period}
            settings={settings}
            isAdmin={admin}
            queue={mockQueue}
            onLifecycleStateChange={(info) => setLifecycleState(info.state)}
          />
        </div>

        <Phase5RosterContainer
          period={period}
          settings={settings}
          isAdmin={admin}
          queue={mockQueue}
          people={people}
        />
      </div>
    );
  }

  root.render(<Wrapper />);

  window.phase7Test = {
    mockQueue,
    callLog,
    periodLifecycleMap,
    storeBalances,
    storeTransactions,
    storeCurrent,
    storePlanned,
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
      window.phase7Test = null;
    }
  };
};
