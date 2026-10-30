import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import LifecycleControls from '../../src/features/roster/components/LifecycleControls.jsx';
import Phase5RosterContainer from '../../src/features/roster/components/Phase5RosterContainer.jsx';

// Default mock datasets for tests
const DEFAULT_PLANNED_ASSIGNMENTS = [
  { assignmentId: 'asg-1', personId: 'p-1', personNameSnapshot: 'Dr. Sarah Lee', date: '2026-03-01', dutyDomain: 'MO', shiftCode: 'AM' },
  { assignmentId: 'asg-2', personId: 'p-1', personNameSnapshot: 'Dr. Sarah Lee', date: '2026-03-02', dutyDomain: 'MO', shiftCode: 'PM' },
  { assignmentId: 'asg-3', personId: 'p-1', personNameSnapshot: 'Dr. Sarah Lee', date: '2026-03-01', dutyDomain: 'EP', shiftCode: 'EP_ONCALL' },
  { assignmentId: 'asg-4', personId: 'p-2', personNameSnapshot: 'Dr. Sarah Lee', date: '2026-03-01', dutyDomain: 'MO', shiftCode: 'PM' }, // Duplicate name, different PersonId
  { assignmentId: 'asg-5', personId: 'p-3', personNameSnapshot: 'Dr. John Doe', date: '2026-03-01', dutyDomain: 'MO', shiftCode: 'OFF' },
  { assignmentId: 'asg-6', personId: 'p-3', personNameSnapshot: 'Dr. John Doe', date: '2026-03-02', dutyDomain: 'MO', shiftCode: 'AM' }
];

window.mountPhase5Test = (options = {}) => {
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
    undoDurationMs = 10000,
    amendError = null,
    reverseError = null,
    delayedPeriod = null,
    delayMs = 0
  } = options;

  let currentPeriod = initialPeriod;
  let currentState = initialState;
  let currentRev = initialRevision;
  let currentAdmin = isAdmin;

  // Working data copies
  let storePlanned = structuredClone(plannedAssignments);
  let storeCurrent = currentAssignments ? structuredClone(currentAssignments) : structuredClone(plannedAssignments);
  let storeEvents = structuredClone(events);

  const callLog = {
    getPeriodLifecycle: [],
    getCurrentRoster: [],
    getPlannedRoster: [],
    getAmendmentHistory: [],
    amend: [],
    reverseAmendment: [],
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

  let triggerUndoExpireCallback = null;

  const mockQueue = {
    enabled: () => Boolean(settings.roster_v2_write_enabled && settings.write_queue_v2_enabled),
    subscribe: (fn) => {
      subscribers.push(fn);
      return () => { subscribers = subscribers.filter(s => s !== fn); };
    },
    start: async () => {},
    view: () => ({
      lifecycle: { state: currentState, revision: currentRev },
      operations: []
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
      return {
        ok: true,
        periodId: p,
        effectiveState: currentState,
        activeAmendmentCount: storeEvents.filter(e => !e.isReversed && e.EventType !== 'REVERSAL').length,
        count: storeCurrent.length,
        assignments: structuredClone(storeCurrent)
      };
    },
    getPlannedRoster: async (p) => {
      callLog.getPlannedRoster.push(p);
      if (delayedPeriod === p && delayMs > 0) {
        await new Promise(r => setTimeout(r, delayMs));
      }
      return {
        ok: true,
        periodId: p,
        plannedSnapshotId: 'SNAP-MOCK-1',
        count: storePlanned.length,
        assignments: structuredClone(storePlanned)
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
    amend: async (p, payload, opts = {}) => {
      callLog.amend.push({ period: p, payload, opts });
      if (amendError) {
        const err = new Error(amendError);
        err.code = amendError;
        throw err;
      }

      currentRev += 1;
      currentState = 'AMENDED';
      if (periodLifecycleMap.has(p)) {
        const rec = periodLifecycleMap.get(p);
        rec.State = 'AMENDED';
        rec.Revision = currentRev;
      }

      const eventId = `EV-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

      if (payload.eventType === 'ADMIN_CORRECTION') {
        const target = storeCurrent.find(
          a => a.personId === payload.personId && a.date === payload.date && a.dutyDomain === payload.dutyDomain
        );
        const beforeShift = target ? target.shiftCode : 'OFF';
        const afterShift = payload.afterAssignments?.[0]?.shiftCode || 'OFF';

        if (target) {
          target.shiftCode = afterShift;
        } else {
          storeCurrent.push({
            assignmentId: `asg-dyn-${Date.now()}`,
            personId: payload.personId,
            personNameSnapshot: payload.personId,
            date: payload.date,
            dutyDomain: payload.dutyDomain,
            shiftCode: afterShift
          });
        }

        storeEvents.unshift({
          EventId: eventId,
          EventType: 'ADMIN_CORRECTION',
          PublicReasonCode: payload.publicReasonCode,
          AdminNote: payload.adminNote || '',
          CreatedAt: new Date().toISOString(),
          CreatedBy: 'admin@example.com',
          canReverse: true,
          isReversed: false,
          lines: [
            {
              LineId: `${eventId}-1`,
              PersonId: payload.personId,
              PersonNameSnapshot: target ? target.personNameSnapshot : payload.personId,
              Date: payload.date,
              DutyDomain: payload.dutyDomain,
              BeforeShiftCode: beforeShift,
              AfterShiftCode: afterShift
            }
          ]
        });
      } else if (payload.eventType === 'SWAP') {
        const p1 = payload.person1;
        const p2 = payload.person2;

        const cell1 = storeCurrent.find(
          a => a.personId === p1.personId && a.date === p1.date && a.dutyDomain === p1.dutyDomain
        );
        const cell2 = storeCurrent.find(
          a => a.personId === p2.personId && a.date === p2.date && a.dutyDomain === p2.dutyDomain
        );

        const shift1 = cell1?.shiftCode || 'OFF';
        const shift2 = cell2?.shiftCode || 'OFF';

        if (cell1) cell1.shiftCode = shift2;
        if (cell2) cell2.shiftCode = shift1;

        storeEvents.unshift({
          EventId: eventId,
          EventType: 'SWAP',
          PublicReasonCode: payload.publicReasonCode || 'SHIFT_SWAP',
          AdminNote: payload.adminNote || '',
          CreatedAt: new Date().toISOString(),
          CreatedBy: 'admin@example.com',
          canReverse: true,
          isReversed: false,
          lines: [
            {
              LineId: `${eventId}-1`,
              PersonId: p1.personId,
              PersonNameSnapshot: cell1?.personNameSnapshot || p1.personId,
              Date: p1.date,
              DutyDomain: p1.dutyDomain,
              BeforeShiftCode: shift1,
              AfterShiftCode: shift2
            },
            {
              LineId: `${eventId}-2`,
              PersonId: p2.personId,
              PersonNameSnapshot: cell2?.personNameSnapshot || p2.personId,
              Date: p2.date,
              DutyDomain: p2.dutyDomain,
              BeforeShiftCode: shift2,
              AfterShiftCode: shift1
            }
          ]
        });
      }

      notify();
      return { ok: true, state: 'AMENDED', revision: currentRev, eventId };
    },
    reverseAmendment: async (p, eventId, opts = {}) => {
      callLog.reverseAmendment.push({ period: p, eventId, opts });
      if (reverseError) {
        const err = new Error(reverseError);
        err.code = reverseError;
        throw err;
      }

      const targetEv = storeEvents.find(e => e.EventId === eventId);
      if (!targetEv) {
        throw new Error('EVENT_NOT_FOUND');
      }
      if (targetEv.isReversed) {
        const err = new Error('EVENT_ALREADY_REVERSED');
        err.code = 'EVENT_ALREADY_REVERSED';
        throw err;
      }

      targetEv.isReversed = true;
      targetEv.canReverse = false;

      // Revert lines
      targetEv.lines.forEach(l => {
        const c = storeCurrent.find(
          a => a.personId === l.PersonId && a.date === l.Date && a.dutyDomain === l.DutyDomain
        );
        if (c) c.shiftCode = l.BeforeShiftCode;
      });

      currentRev += 1;
      const revEventId = `REV-${Date.now()}`;
      storeEvents.unshift({
        EventId: revEventId,
        EventType: 'REVERSAL',
        ReversesEventId: eventId,
        PublicReasonCode: 'ADMIN_CORRECTION',
        AdminNote: opts.adminNote || '',
        CreatedAt: new Date().toISOString(),
        CreatedBy: 'admin@example.com',
        lines: targetEv.lines.map((l, i) => ({
          LineId: `${revEventId}-${i + 1}`,
          PersonId: l.PersonId,
          PersonNameSnapshot: l.PersonNameSnapshot,
          Date: l.Date,
          DutyDomain: l.DutyDomain,
          BeforeShiftCode: l.AfterShiftCode,
          AfterShiftCode: l.BeforeShiftCode
        }))
      });

      const hasRemainingActive = storeEvents.some(e => !e.isReversed && e.EventType !== 'REVERSAL');
      currentState = hasRemainingActive ? 'AMENDED' : 'PUBLISHED';
      if (periodLifecycleMap.has(p)) {
        const rec = periodLifecycleMap.get(p);
        rec.State = currentState;
        rec.Revision = currentRev;
      }

      notify();
      return { ok: true, state: currentState, revision: currentRev, eventId: revEventId };
    },
    close: async (p, opts) => {
      callLog.close.push({ period: p, opts });
      currentState = 'CLOSED';
      currentRev += 1;
      if (periodLifecycleMap.has(p)) {
        const rec = periodLifecycleMap.get(p);
        rec.State = 'CLOSED';
        rec.Revision = currentRev;
      }
      notify();
      return { ok: true, state: 'CLOSED', revision: currentRev };
    },
    reopen: async (p, reason) => {
      callLog.reopen.push({ period: p, reason });
      const hasRemainingActive = storeEvents.some(e => !e.isReversed && e.EventType !== 'REVERSAL');
      currentState = hasRemainingActive ? 'AMENDED' : 'PUBLISHED';
      currentRev += 1;
      if (periodLifecycleMap.has(p)) {
        const rec = periodLifecycleMap.get(p);
        rec.State = currentState;
        rec.Revision = currentRev;
      }
      notify();
      return { ok: true, state: currentState, revision: currentRev };
    }
  };

  const container = document.createElement('div');
  container.id = 'test-phase5-container';
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
          undoDurationMs={undoDurationMs}
        />
      </div>
    );
  }

  root.render(<Wrapper />);

  window.phase5Test = {
    mockQueue,
    callLog,
    periodLifecycleMap,
    setPeriod: (p) => window.__setPeriod?.(p),
    setAdmin: (a) => window.__setAdmin?.(a),
    enrollPeriod: (p, state = 'PUBLISHED', rev = 1) => {
      periodLifecycleMap.set(p, { PeriodId: p, State: state, Revision: rev, SchemaVersion: 1 });
    },
    triggerUndoExpire: () => {
      const dismissBtn = document.querySelector('[data-testid="undo-toast"] button[title="Dismiss notification"]');
      if (dismissBtn) dismissBtn.click();
    },
    close: () => {
      if (container.isConnected) {
        root.unmount();
        container.remove();
      }
      window.phase5Test = null;
    }
  };
};
