import React, { useState, useEffect, useRef, useCallback } from 'react';
import { draftRuntime } from '../queue/runtime.js';
import RosterViewModeSelector from './RosterViewModeSelector.jsx';
import CurrentRosterView from './CurrentRosterView.jsx';
import PlannedRosterView from './PlannedRosterView.jsx';
import AmendmentHistoryPanel from './AmendmentHistoryPanel.jsx';
import AmendmentModal from './AmendmentModal.jsx';
import UndoToast from './UndoToast.jsx';

/**
 * Phase 5 Slice 4 Main Container:
 * Exposes Current, Planned, and Changes UI modes.
 * Orchestrates authoritative mutations, 10-second Undo, and dependency-safe reversals.
 */
export default function Phase5RosterContainer({
  period,
  settings = {},
  isAdmin = false,
  queue: externalQueue = null,
  runtimeFactory = draftRuntime,
  onLifecycleStateChange = null,
  undoDurationMs = 10000
}) {
  const [queue, setQueue] = useState(externalQueue);
  const [viewMode, setViewMode] = useState('CURRENT');
  const [loading, setLoading] = useState(true);
  const [lifecycle, setLifecycle] = useState(null);
  const [currentRoster, setCurrentRoster] = useState(null);
  const [plannedRoster, setPlannedRoster] = useState(null);
  const [amendmentHistory, setAmendmentHistory] = useState(null);

  // Error banners
  const [actionError, setActionError] = useState(null);
  const [revisionConflictMsg, setRevisionConflictMsg] = useState(null);

  // Amendment modal
  const [selectedCellForAmend, setSelectedCellForAmend] = useState(null);
  const [isSubmittingAmend, setIsSubmittingAmend] = useState(false);

  // 10-second Undo
  const [undoEvent, setUndoEvent] = useState(null);

  // Monotonic generation counter to prevent stale async responses across month switching
  const requestGenRef = useRef(0);

  const mutationsEnabled = Boolean(
    settings?.roster_v2_write_enabled && settings?.write_queue_v2_enabled
  );
  const readEnabled = Boolean(settings?.roster_v2_read_enabled !== false);

  // Unified reload function
  const loadAuthoritativeData = useCallback(async (targetQueue, targetPeriod, gen) => {
    if (!targetQueue || !targetPeriod) return;
    try {
      // 1. Fetch lifecycle state
      const lcRes = await targetQueue.getPeriodLifecycle(targetPeriod).catch(() => ({ ok: false }));
      if (gen !== requestGenRef.current) return;

      if (!lcRes?.ok || !lcRes?.period) {
        setLifecycle(null);
        setCurrentRoster(null);
        setPlannedRoster(null);
        setAmendmentHistory(null);
        onLifecycleStateChange?.({ period: targetPeriod, isEnrolled: false, state: null, revision: null });
        return;
      }

      const periodRecord = lcRes.period;
      const state = String(periodRecord.State || 'DRAFT').toUpperCase();
      const revision = Number(periodRecord.Revision || 0);
      setLifecycle({ state, revision });
      onLifecycleStateChange?.({ period: targetPeriod, isEnrolled: true, state, revision });

      // If DRAFT, Phase 5 view modes and amendment controls are not active
      if (state === 'DRAFT') {
        setCurrentRoster(null);
        setPlannedRoster(null);
        setAmendmentHistory(null);
        return;
      }

      // 2. Concurrently fetch Current, Planned, and Changes using canonical repository methods
      const [currRes, planRes, histRes] = await Promise.all([
        targetQueue.getCurrentRoster(targetPeriod).catch((e) => ({ ok: false, error: e })),
        targetQueue.getPlannedRoster(targetPeriod).catch((e) => ({ ok: false, error: e })),
        targetQueue.getAmendmentHistory(targetPeriod).catch((e) => ({ ok: false, error: e }))
      ]);

      if (gen !== requestGenRef.current) return;

      if (currRes?.ok) {
        setCurrentRoster(currRes);
      }
      if (planRes?.ok) {
        setPlannedRoster(planRes);
      }
      if (histRes?.ok) {
        setAmendmentHistory(histRes);
      }
    } catch (err) {
      if (gen === requestGenRef.current) {
        setActionError(err.message || 'Failed to load authoritative roster data');
      }
    }
  }, [onLifecycleStateChange]);

  // Initial and period change effect
  useEffect(() => {
    let live = true;
    requestGenRef.current += 1;
    const currentGen = requestGenRef.current;

    // Reset month-scoped state immediately on month switch
    setLoading(true);
    setActionError(null);
    setRevisionConflictMsg(null);
    setSelectedCellForAmend(null);
    setUndoEvent(null);
    setViewMode('CURRENT'); // Default view mode is Current
    setCurrentRoster(null);
    setPlannedRoster(null);
    setAmendmentHistory(null);
    setLifecycle(null);

    (async () => {
      try {
        const q = externalQueue || await runtimeFactory(settings);
        if (!live || currentGen !== requestGenRef.current) return;
        setQueue(q);
        await q.start?.();
        if (!live || currentGen !== requestGenRef.current) return;

        await loadAuthoritativeData(q, period, currentGen);
      } catch (err) {
        if (live && currentGen === requestGenRef.current) {
          setActionError(err.message || 'Queue initialization failed');
        }
      } finally {
        if (live && currentGen === requestGenRef.current) {
          setLoading(false);
        }
      }
    })();

    return () => {
      live = false;
    };
  }, [period, settings, externalQueue, runtimeFactory, loadAuthoritativeData]);

  // Handle amendment submission (ADMIN_CORRECTION or SWAP)
  const handleAmendmentSubmit = useCallback(async (payload) => {
    if (!queue || isSubmittingAmend) return;
    setIsSubmittingAmend(true);
    setActionError(null);
    setRevisionConflictMsg(null);

    try {
      // Execute through Phase 5 queue
      const res = await queue.amend(period, payload);

      // Successfully confirmed
      setSelectedCellForAmend(null);

      // Trigger 10-second Undo
      const confirmedEventId = res?.eventId || res?.EventId;
      if (confirmedEventId) {
        const desc = payload.eventType === 'SWAP'
          ? 'Change confirmed: atomic shift swap'
          : `Change confirmed: assignment changed to ${payload.afterAssignments?.[0]?.shiftCode || 'OFF'}`;

        setUndoEvent({
          eventId: confirmedEventId,
          periodId: period,
          description: desc
        });
      }

      // Reload authoritative data
      await loadAuthoritativeData(queue, period, requestGenRef.current);
    } catch (err) {
      const code = err.code || err.message;
      if (code === 'REVISION_CONFLICT') {
        setRevisionConflictMsg('Roster changed since you opened it. Refreshing the latest version.');
        // Refresh authoritative data upon revision conflict
        await loadAuthoritativeData(queue, period, requestGenRef.current);
      } else {
        setActionError(err.message || code);
      }
    } finally {
      setIsSubmittingAmend(false);
    }
  }, [queue, isSubmittingAmend, period, loadAuthoritativeData]);

  // Handle authoritative reversal (invoked by Undo or Changes history panel)
  const handleReverseEvent = useCallback(async (eventId, adminNote = '') => {
    if (!queue || !eventId) return;
    setActionError(null);
    setRevisionConflictMsg(null);

    try {
      await queue.reverseAmendment(period, eventId, { adminNote });

      // Clear undo toast if this was the undoEvent being reversed
      if (undoEvent && undoEvent.eventId === eventId) {
        setUndoEvent(null);
      }

      // Refresh authoritative data
      await loadAuthoritativeData(queue, period, requestGenRef.current);
    } catch (err) {
      const code = err.code || err.message;
      if (code === 'REVISION_CONFLICT') {
        setRevisionConflictMsg('Roster changed since you opened it. Refreshing the latest version.');
        await loadAuthoritativeData(queue, period, requestGenRef.current);
      }
      throw err;
    }
  }, [queue, period, undoEvent, loadAuthoritativeData]);

  // If not enrolled or in DRAFT state or V2 read is disabled: container does not render Phase 5 modes
  const state = lifecycle?.state;
  const isEnrolledAndActive = Boolean(
    readEnabled &&
    lifecycle &&
    ['PUBLISHED', 'AMENDED', 'CLOSED'].includes(state)
  );

  if (loading) {
    return (
      <div className="p-6 rounded-2xl bg-white border border-slate-200 text-center text-xs text-slate-500 animate-pulse">
        Checking authoritative roster…
      </div>
    );
  }

  if (!isEnrolledAndActive) {
    // Legacy or Draft mode: Phase 5 controls are not exposed
    return null;
  }

  const activeAmendmentCount = currentRoster?.activeAmendmentCount || amendmentHistory?.count || 0;

  return (
    <div className="space-y-4" id="phase-5-roster-container" data-testid="phase-5-roster-container">
      {/* Revision Conflict Warning Banner */}
      {revisionConflictMsg && (
        <div
          id="revision-conflict-banner"
          className="p-3 rounded-xl bg-amber-50 border border-amber-300 text-xs text-amber-800 flex items-center justify-between gap-3 shadow-xs"
          role="alert"
        >
          <div className="flex items-center gap-2">
            <span className="text-amber-600 font-bold text-sm">⚠️</span>
            <span>{revisionConflictMsg}</span>
          </div>
          <button
            type="button"
            onClick={() => setRevisionConflictMsg(null)}
            className="text-amber-700 hover:text-amber-900 font-bold text-xs"
          >
            ✕
          </button>
        </div>
      )}

      {/* Action Error Banner */}
      {actionError && (
        <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700 font-medium" role="alert">
          <p className="font-bold">Error</p>
          <p>{actionError}</p>
        </div>
      )}

      {/* Header Bar: View Mode Selector */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-2 border-b border-slate-200">
        <RosterViewModeSelector
          mode={viewMode}
          onChange={setViewMode}
          amendmentCount={activeAmendmentCount}
        />

        <div className="text-xs text-slate-500 font-medium">
          Period: <strong className="text-slate-700">{period}</strong>
          {state && (
            <span className="ml-2 font-mono text-[11px] text-slate-400">
              (rev {lifecycle?.revision || 1})
            </span>
          )}
        </div>
      </div>

      {/* Main View Mode Rendering */}
      {viewMode === 'CURRENT' && (
        <CurrentRosterView
          currentAssignments={currentRoster?.assignments || []}
          plannedAssignments={plannedRoster?.assignments || []}
          period={period}
          isAdmin={isAdmin}
          lifecycleState={state}
          mutationsEnabled={mutationsEnabled}
          onSelectCellForAmend={(cell) => setSelectedCellForAmend(cell)}
        />
      )}

      {viewMode === 'PLANNED' && (
        <PlannedRosterView
          assignments={plannedRoster?.assignments || []}
          period={period}
        />
      )}

      {viewMode === 'CHANGES' && (
        <AmendmentHistoryPanel
          events={amendmentHistory?.events || []}
          isAdmin={isAdmin}
          onReverse={(eventId, adminNote) => handleReverseEvent(eventId, adminNote)}
        />
      )}

      {/* Amendment Modal (Admin Correction & Swap) */}
      <AmendmentModal
        isOpen={Boolean(selectedCellForAmend)}
        onClose={() => setSelectedCellForAmend(null)}
        onSubmit={handleAmendmentSubmit}
        targetCell={selectedCellForAmend}
        availableParticipants={currentRoster?.assignments || []}
        isSubmitting={isSubmittingAmend}
        error={actionError}
      />

      {/* 10-Second Undo Toast */}
      {undoEvent && (
        <UndoToast
          undoEvent={undoEvent}
          durationMs={undoDurationMs}
          onUndo={async (ue) => {
            await handleReverseEvent(ue.eventId);
          }}
          onExpire={() => setUndoEvent(null)}
        />
      )}
    </div>
  );
}
