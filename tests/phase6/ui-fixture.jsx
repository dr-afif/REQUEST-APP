import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import LifecycleControls from '../../src/features/roster/components/LifecycleControls.jsx';
import Phase5RosterContainer from '../../src/features/roster/components/Phase5RosterContainer.jsx';

// Default mock datasets for Phase 6 UI tests
const DEFAULT_PEOPLE = [
  { personId: 'p-1', name: 'Dr. Sarah Lee' },
  { personId: 'p-2', name: 'Dr. Sarah Lee' }, // Duplicate display name
  { personId: 'p-3', name: 'Dr. John Doe' },
  { personId: 'p-ep', name: 'Dr. Alex Cross' },
  { personId: 'p-absent', name: 'Dr. Bob Vance' },
  { personId: 'p-noduty', name: 'Dr. Alice Smith' }
];

const DEFAULT_PLANNED_ASSIGNMENTS = [
  { assignmentId: 'asg-1', personId: 'p-1', personNameSnapshot: 'Dr. Sarah Lee', date: '2026-03-10', dutyDomain: 'MO', shiftCode: 'PM' },
  { assignmentId: 'asg-2', personId: 'p-1', personNameSnapshot: 'Dr. Sarah Lee', date: '2026-03-12', dutyDomain: 'MO', shiftCode: 'AM' },
  { assignmentId: 'asg-3', personId: 'p-2', personNameSnapshot: 'Dr. Sarah Lee', date: '2026-03-10', dutyDomain: 'MO', shiftCode: 'OFF' },
  { assignmentId: 'asg-4', personId: 'p-3', personNameSnapshot: 'Dr. John Doe', date: '2026-03-10', dutyDomain: 'MO', shiftCode: 'OFF' },
  { assignmentId: 'asg-5', personId: 'p-3', personNameSnapshot: 'Dr. John Doe', date: '2026-03-12', dutyDomain: 'MO', shiftCode: 'PM' },
  { assignmentId: 'asg-6', personId: 'p-ep', personNameSnapshot: 'Dr. Alex Cross', date: '2026-03-10', dutyDomain: 'EP', shiftCode: 'EP_ONCALL' },
  { assignmentId: 'asg-7', personId: 'p-absent', personNameSnapshot: 'Dr. Bob Vance', date: '2026-03-10', dutyDomain: 'MO', shiftCode: 'AM' }
];

window.mountPhase6Test = (options = {}) => {
  const {
    initialPeriod = '2026-03',
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
    people = DEFAULT_PEOPLE,
    absenceError = null,
    replacementError = null,
    reverseAbsenceError = null,
    reverseReplacementError = null,
    delayedPeriod = null,
    delayMs = 0,
    simulateRecoveryRequired = false
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

  const callLog = {
    getPeriodLifecycle: [],
    getCurrentRoster: [],
    getPlannedRoster: [],
    getAmendmentHistory: [],
    getAbsences: [],
    getReplacements: [],
    createAbsence: [],
    createReplacement: [],
    reverseAbsence: [],
    reverseReplacement: [],
    recoverAbsence: [],
    recoverReplacement: [],
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
      : 'ABSENCE_CREATE';
    const opId = opType === 'REPLACEMENT_CREATE' ? 'rec-repl-456' : 'rec-op-123';
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
          storeAbsences.filter(a => a.Status === 'ACTIVE' && (a.PeriodId === p || (a.StartDate || '').startsWith(p))).length,
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
        plannedSnapshotId: 'SNAP-MOCK-1',
        count: periodAssignments.length,
        assignments: structuredClone(periodAssignments)
      };
    },
    getAmendmentHistory: async (p) => {
      callLog.getAmendmentHistory.push(p);
      if (delayedPeriod === p && delayMs > 0) {
        await new Promise(r => setTimeout(r, delayMs));
      }
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
      if (delayedPeriod === p && delayMs > 0) {
        await new Promise(r => setTimeout(r, delayMs));
      }
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
      if (delayedPeriod === p && delayMs > 0) {
        await new Promise(r => setTimeout(r, delayMs));
      }
      const periodRepl = storeReplacements.filter(r => (r.Date || '').startsWith(p));
      return {
        ok: true,
        periodId: p,
        count: periodRepl.length,
        isAdmin: currentAdmin,
        replacements: structuredClone(periodRepl)
      };
    },
    createAbsence: async (p, payload, opts = {}) => {
      callLog.createAbsence.push({ period: p, payload, opts });
      if (absenceError) {
        const err = new Error(absenceError);
        err.code = absenceError;
        throw err;
      }

      const absenceId = `abs-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      const person = people.find(x => x.personId === payload.personId);

      const absenceRecord = {
        AbsenceId: absenceId,
        PeriodId: p,
        PersonId: payload.personId,
        PersonNameSnapshot: person ? person.name : payload.personId,
        AbsenceType: payload.absenceType,
        StartDate: payload.startDate,
        EndDate: payload.endDate,
        DutyDomain: payload.dutyDomain,
        PublicReason: payload.absenceType,
        AdminNote: currentAdmin ? (payload.adminNote || '') : '',
        Status: 'ACTIVE',
        CreatedAt: new Date().toISOString(),
        CreatedBy: 'admin@example.com'
      };
      storeAbsences.unshift(absenceRecord);

      // Mutate matching working assignments in Current
      let affectedCount = 0;
      storeCurrent.forEach(a => {
        if (a.personId === payload.personId &&
            a.dutyDomain === payload.dutyDomain &&
            a.date >= payload.startDate &&
            a.date <= payload.endDate &&
            a.shiftCode !== 'OFF' &&
            a.source !== 'ABSENCE') {
          affectedCount++;
          a.source = 'ABSENCE';
          a.originalShiftCode = a.shiftCode;
          a.shiftCode = payload.absenceType;
          a.coverageStatus = 'UNCOVERED';
          a.absenceId = absenceId;
        }
      });

      // Update state and revision: only working-duty absence causes AMENDED and revision bump!
      if (affectedCount > 0) {
        currentState = 'AMENDED';
        currentRev += 1;
        if (periodLifecycleMap.has(p)) {
          const rec = periodLifecycleMap.get(p);
          rec.State = 'AMENDED';
          rec.Revision = currentRev;
        }
      }

      notify();
      return { ok: true, state: currentState, revision: currentRev, absenceId };
    },
    createReplacement: async (p, payload, opts = {}) => {
      callLog.createReplacement.push({ period: p, payload, opts });
      if (replacementError) {
        const err = new Error(replacementError);
        err.code = replacementError;
        throw err;
      }

      const replacementId = `repl-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      const absentPerson = storeAbsences.find(a => a.AbsenceId === payload.absenceId);
      const replPerson = people.find(x => x.personId === payload.replacementPersonId);

      const replRecord = {
        ReplacementId: replacementId,
        AbsenceId: payload.absenceId,
        OriginalAssignmentId: payload.originalAssignmentId,
        ReplacementPersonId: payload.replacementPersonId,
        ReplacementAssignmentId: `asg-repl-${Date.now()}`,
        DutyDomain: payload.dutyDomain,
        Date: payload.date,
        ShiftCode: payload.shiftCode,
        Status: 'ACTIVE',
        CreatedAt: new Date().toISOString(),
        CreatedBy: 'admin@example.com'
      };
      storeReplacements.unshift(replRecord);

      // Update absent duty in Current to COVERED
      storeCurrent.forEach(a => {
        if (a.absenceId === payload.absenceId && a.date === payload.date) {
          a.coverageStatus = 'COVERED';
          a.replacementId = replacementId;
        }
      });

      // Add covering assignment to Current (or update existing OFF)
      const existingDuty = storeCurrent.find(
        a => a.personId === payload.replacementPersonId && a.date === payload.date && a.dutyDomain === payload.dutyDomain
      );
      if (existingDuty) {
        existingDuty.source = 'REPLACEMENT';
        existingDuty.shiftCode = payload.shiftCode;
        existingDuty.coverageStatus = 'COVERED';
        existingDuty.coveringForPersonId = absentPerson ? absentPerson.PersonId : '';
        existingDuty.replacementId = replacementId;
      } else {
        storeCurrent.push({
          assignmentId: replRecord.ReplacementAssignmentId,
          personId: payload.replacementPersonId,
          personNameSnapshot: replPerson ? replPerson.name : payload.replacementPersonId,
          date: payload.date,
          dutyDomain: payload.dutyDomain,
          shiftCode: payload.shiftCode,
          source: 'REPLACEMENT',
          coverageStatus: 'COVERED',
          coveringForPersonId: absentPerson ? absentPerson.PersonId : '',
          replacementId: replacementId
        });
      }

      currentState = 'AMENDED';
      currentRev += 1;
      if (periodLifecycleMap.has(p)) {
        const rec = periodLifecycleMap.get(p);
        rec.State = 'AMENDED';
        rec.Revision = currentRev;
      }

      notify();
      return { ok: true, state: currentState, revision: currentRev, replacementId };
    },
    reverseAbsence: async (p, absenceId, opts = {}) => {
      callLog.reverseAbsence.push({ period: p, absenceId, opts });
      if (reverseAbsenceError) {
        const err = new Error(reverseAbsenceError);
        err.code = reverseAbsenceError;
        throw err;
      }

      // Check for active dependent replacements
      const activeRepl = storeReplacements.find(r => r.AbsenceId === absenceId && r.Status === 'ACTIVE');
      if (activeRepl) {
        const err = new Error('REPLACEMENT_DEPENDENCY_CONFLICT');
        err.code = 'REPLACEMENT_DEPENDENCY_CONFLICT';
        throw err;
      }

      const ab = storeAbsences.find(a => a.AbsenceId === absenceId);
      if (ab) {
        ab.Status = 'REVERSED';
      }

      // Restore assignments in Current
      storeCurrent.forEach(a => {
        if (a.absenceId === absenceId) {
          a.shiftCode = a.originalShiftCode || 'AM';
          delete a.source;
          delete a.coverageStatus;
          delete a.absenceId;
          delete a.originalShiftCode;
        }
      });

      // Effective state calculation
      const hasActiveAbsences = storeCurrent.some(a => a.source === 'ABSENCE');
      const hasActiveAmendments = storeEvents.some(e => !e.isReversed && e.EventType !== 'REVERSAL');
      currentState = (hasActiveAbsences || hasActiveAmendments) ? 'AMENDED' : 'PUBLISHED';
      currentRev += 1;
      if (periodLifecycleMap.has(p)) {
        const rec = periodLifecycleMap.get(p);
        rec.State = currentState;
        rec.Revision = currentRev;
      }

      notify();
      return { ok: true, state: currentState, revision: currentRev };
    },
    reverseReplacement: async (p, replacementId, opts = {}) => {
      callLog.reverseReplacement.push({ period: p, replacementId, opts });
      if (reverseReplacementError) {
        const err = new Error(reverseReplacementError);
        err.code = reverseReplacementError;
        throw err;
      }

      const r = storeReplacements.find(x => x.ReplacementId === replacementId);
      if (r) {
        r.Status = 'REVERSED';
      }

      // Return absent duty to UNCOVERED
      storeCurrent.forEach(a => {
        if (a.replacementId === replacementId && a.source === 'ABSENCE') {
          a.coverageStatus = 'UNCOVERED';
          delete a.replacementId;
        }
      });

      // Remove covering duty or revert to OFF
      storeCurrent = storeCurrent.filter(a => !(a.replacementId === replacementId && a.source === 'REPLACEMENT'));

      currentState = 'AMENDED';
      currentRev += 1;
      if (periodLifecycleMap.has(p)) {
        const rec = periodLifecycleMap.get(p);
        rec.State = 'AMENDED';
        rec.Revision = currentRev;
      }

      notify();
      return { ok: true, state: currentState, revision: currentRev };
    },
    recoverAbsence: async (operationId) => {
      callLog.recoverAbsence.push(operationId);
      mockOperations = mockOperations.filter(o => o.operationId !== operationId);
      notify();
      return { ok: true, status: 'CONFIRMED' };
    },
    recoverReplacement: async (operationId) => {
      callLog.recoverReplacement.push(operationId);
      mockOperations = mockOperations.filter(o => o.operationId !== operationId);
      notify();
      return { ok: true, status: 'CONFIRMED' };
    },
    amend: async (p, payload, opts = {}) => {
      currentRev += 1;
      currentState = 'AMENDED';
      const eventId = `EV-${Date.now()}`;
      storeEvents.unshift({
        EventId: eventId,
        EventType: 'ADMIN_CORRECTION',
        PublicReasonCode: payload.publicReasonCode || 'DUTY_COVERAGE',
        AdminNote: payload.adminNote || '',
        CreatedAt: new Date().toISOString(),
        CreatedBy: 'admin@example.com',
        canReverse: true,
        isReversed: false,
        lines: []
      });
      notify();
      return { ok: true, eventId };
    },
    reverseAmendment: async (p, eventId) => {
      const ev = storeEvents.find(e => e.EventId === eventId);
      if (ev) ev.isReversed = true;
      const hasActiveAbsences = storeCurrent.some(a => a.source === 'ABSENCE');
      const hasActiveAmendments = storeEvents.some(e => !e.isReversed && e.EventType !== 'REVERSAL');
      currentState = (hasActiveAbsences || hasActiveAmendments) ? 'AMENDED' : 'PUBLISHED';
      currentRev += 1;
      notify();
      return { ok: true };
    },
    close: async (p) => {
      currentState = 'CLOSED';
      currentRev += 1;
      if (periodLifecycleMap.has(p)) {
        periodLifecycleMap.get(p).State = 'CLOSED';
        periodLifecycleMap.get(p).Revision = currentRev;
      }
      notify();
      return { ok: true, state: 'CLOSED' };
    },
    reopen: async (p) => {
      const hasActive = storeCurrent.some(a => a.source === 'ABSENCE') || storeEvents.some(e => !e.isReversed);
      currentState = hasActive ? 'AMENDED' : 'PUBLISHED';
      currentRev += 1;
      if (periodLifecycleMap.has(p)) {
        periodLifecycleMap.get(p).State = currentState;
        periodLifecycleMap.get(p).Revision = currentRev;
      }
      notify();
      return { ok: true, state: currentState };
    }
  };

  const container = document.createElement('div');
  container.id = 'test-phase6-container';
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
          <h2 className="text-xl font-bold">Roster Page V2</h2>
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

  window.phase6Test = {
    mockQueue,
    callLog,
    periodLifecycleMap,
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
      window.phase6Test = null;
    }
  };
};
