import React, { useState, useEffect, useRef, useCallback } from 'react';
import { draftRuntime } from '../queue/runtime.js';
import RosterViewModeSelector from './RosterViewModeSelector.jsx';
import CurrentRosterView from './CurrentRosterView.jsx';
import PlannedRosterView from './PlannedRosterView.jsx';
import AmendmentHistoryPanel from './AmendmentHistoryPanel.jsx';
import AmendmentModal from './AmendmentModal.jsx';
import AbsenceModal from './AbsenceModal.jsx';
import ReplacementModal from './ReplacementModal.jsx';
import EntitlementPanel from './EntitlementPanel.jsx';
import EntitlementCreditModal from './EntitlementCreditModal.jsx';
import EntitlementConsumeModal from './EntitlementConsumeModal.jsx';
import UndoToast from './UndoToast.jsx';

/**
 * Phase 5/6 Roster Container:
 * Exposes Current, Planned, and Changes UI modes.
 * Orchestrates authoritative mutations:
 *   - Phase 5 Amendments (Correction & Swap), 10-second Undo, Reversals
 *   - Phase 6 Operational Absences (MC, EL, AL, COURSE) & Shortage Workflow
 *   - Phase 6 Replacement Coverage & Candidate Guidance
 *   - Dedicated Absence & Replacement Recovery
 * Rejects stale async responses across period switching.
 */
export default function Phase5RosterContainer({
  period,
  settings = {},
  isAdmin = false,
  queue: externalQueue = null,
  runtimeFactory = draftRuntime,
  onLifecycleStateChange = null,
  undoDurationMs = 10000,
  people = []
}) {
  const [queue, setQueue] = useState(externalQueue);
  const [viewMode, setViewMode] = useState('CURRENT');
  const [loading, setLoading] = useState(true);
  const [lifecycle, setLifecycle] = useState(null);
  const [currentRoster, setCurrentRoster] = useState(null);
  const [plannedRoster, setPlannedRoster] = useState(null);
  const [amendmentHistory, setAmendmentHistory] = useState(null);
  const [absences, setAbsences] = useState([]);
  const [replacements, setReplacements] = useState([]);

  // Error and conflict banners
  const [actionError, setActionError] = useState(null);
  const [revisionConflictMsg, setRevisionConflictMsg] = useState(null);

  // Recovery required state
  const [recoveryOp, setRecoveryOp] = useState(null);
  const [isRecovering, setIsRecovering] = useState(false);

  // Phase 5 Amendment modal
  const [selectedCellForAmend, setSelectedCellForAmend] = useState(null);
  const [isSubmittingAmend, setIsSubmittingAmend] = useState(false);

  // Phase 6 Absence modal
  const [isAbsenceModalOpen, setIsAbsenceModalOpen] = useState(false);
  const [selectedDutyForAbsence, setSelectedDutyForAbsence] = useState(null);
  const [isSubmittingAbsence, setIsSubmittingAbsence] = useState(false);

  // Phase 6 Replacement modal
  const [selectedDutyForReplacement, setSelectedDutyForReplacement] = useState(null);
  const [isSubmittingReplacement, setIsSubmittingReplacement] = useState(false);

  // Phase 6 Reversals
  const [isReversingPhase6, setIsReversingPhase6] = useState(false);

  // Phase 7 Entitlements state
  const [selectedPersonForEntitlement, setSelectedPersonForEntitlement] = useState(
    people.find(p => p.dutyDomain !== 'EP' && p.role !== 'EP')?.personId || people[0]?.personId || null
  );
  const [entitlementBalances, setEntitlementBalances] = useState({ GOFF: 0, GHKA: 0 });
  const [entitlementTransactions, setEntitlementTransactions] = useState([]);
  const [isCreditModalOpen, setIsCreditModalOpen] = useState(false);
  const [creditModalConfig, setCreditModalConfig] = useState(null);
  const [selectedDutyForEntitlement, setSelectedDutyForEntitlement] = useState(null);
  const [consumeEntitlementType, setConsumeEntitlementType] = useState('GOFF');
  const [isSubmittingCredit, setIsSubmittingCredit] = useState(false);
  const [isSubmittingConsume, setIsSubmittingConsume] = useState(false);
  const [isReversingEntitlement, setIsReversingEntitlement] = useState(false);

  // 10-second Undo for amendments
  const [undoEvent, setUndoEvent] = useState(null);

  // Desktop lightweight focus mode
  const [isFocusMode, setIsFocusMode] = useState(false);

  // Monotonic generation counter to prevent stale async responses across month switching
  const requestGenRef = useRef(0);

  const mutationsEnabled = Boolean(
    settings?.roster_v2_write_enabled && settings?.write_queue_v2_enabled
  );
  const readEnabled = Boolean(settings?.roster_v2_read_enabled !== false);

  // Check for any unresolved operations needing recovery
  const syncRecoveryState = useCallback((q, p) => {
    if (!q || !p) return;
    try {
      const qView = q.view?.();
      const ops = qView?.operations || [];
      const rec = ops.find(o => o.status === 'RECOVERY_REQUIRED' && !o.everConfirmed);
      setRecoveryOp(rec || null);
    } catch (_) {}
  }, []);

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
        setAbsences([]);
        setReplacements([]);
        onLifecycleStateChange?.({ period: targetPeriod, isEnrolled: false, state: null, revision: null });
        return;
      }

      const periodRecord = lcRes.period;
      const state = String(periodRecord.State || 'DRAFT').toUpperCase();
      const revision = Number(periodRecord.Revision || 0);
      setLifecycle({ state, revision });
      onLifecycleStateChange?.({ period: targetPeriod, isEnrolled: true, state, revision });

      // If DRAFT, Phase 5/6 view modes and mutation controls are not active
      if (state === 'DRAFT') {
        setCurrentRoster(null);
        setPlannedRoster(null);
        setAmendmentHistory(null);
        setAbsences([]);
        setReplacements([]);
        return;
      }

      // 2. Concurrently fetch Current, Planned, Changes, Absences, Replacements, and Entitlements
      const personForEntitlements = selectedPersonForEntitlement || people.find(p => p.dutyDomain !== 'EP' && p.role !== 'EP')?.personId || people[0]?.personId;
      const shouldFetchEntitlements = isAdmin && Boolean(personForEntitlements);
      const [currRes, planRes, histRes, absRes, replRes, balRes, txRes] = await Promise.all([
        targetQueue.getCurrentRoster(targetPeriod).catch((e) => ({ ok: false, error: e })),
        targetQueue.getPlannedRoster(targetPeriod).catch((e) => ({ ok: false, error: e })),
        targetQueue.getAmendmentHistory(targetPeriod).catch((e) => ({ ok: false, error: e })),
        targetQueue.getAbsences?.(targetPeriod).catch((e) => ({ ok: false, error: e })) || Promise.resolve({ ok: true, absences: [] }),
        targetQueue.getReplacements?.(targetPeriod).catch((e) => ({ ok: false, error: e })) || Promise.resolve({ ok: true, replacements: [] }),
        shouldFetchEntitlements && targetQueue.getEntitlementBalances
          ? targetQueue.getEntitlementBalances({ personId: personForEntitlements }).catch((e) => ({ ok: false, error: e }))
          : Promise.resolve({ ok: true, balances: { GOFF: 0, GHKA: 0 } }),
        shouldFetchEntitlements && targetQueue.getEntitlementTransactions
          ? targetQueue.getEntitlementTransactions({ periodId: targetPeriod, ...(personForEntitlements ? { personId: personForEntitlements } : {}) }).catch((e) => ({ ok: false, error: e }))
          : Promise.resolve({ ok: true, transactions: [] })
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
      if (absRes?.ok) {
        setAbsences(absRes.absences || []);
      }
      if (replRes?.ok) {
        setReplacements(replRes.replacements || []);
      }
      if (balRes?.ok && balRes.balances) {
        setEntitlementBalances(balRes.balances);
      }
      if (txRes?.ok && txRes.transactions) {
        setEntitlementTransactions(txRes.transactions);
      }

      syncRecoveryState(targetQueue, targetPeriod);
    } catch (err) {
      if (gen === requestGenRef.current) {
        setActionError(err.message || 'Failed to load authoritative roster data');
      }
    }
  }, [onLifecycleStateChange, syncRecoveryState]);

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
    setIsAbsenceModalOpen(false);
    setSelectedDutyForAbsence(null);
    setSelectedDutyForReplacement(null);
    setSelectedDutyForEntitlement(null);
    setIsCreditModalOpen(false);
    setCreditModalConfig(null);
    setUndoEvent(null);
    setViewMode((prev) => (prev === 'ENTITLEMENTS' ? 'ENTITLEMENTS' : 'CURRENT'));
    setCurrentRoster(null);
    setPlannedRoster(null);
    setAmendmentHistory(null);
    setAbsences([]);
    setReplacements([]);
    setLifecycle(null);
    setRecoveryOp(null);

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

  // Handle Phase 5 amendment submission (ADMIN_CORRECTION or SWAP)
  const handleAmendmentSubmit = useCallback(async (payload) => {
    if (!queue || isSubmittingAmend) return;
    setIsSubmittingAmend(true);
    setActionError(null);
    setRevisionConflictMsg(null);

    try {
      const res = await queue.amend(period, payload);
      setSelectedCellForAmend(null);

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

      await loadAuthoritativeData(queue, period, requestGenRef.current);
    } catch (err) {
      const code = err.code || err.message;
      if (code === 'REVISION_CONFLICT') {
        setRevisionConflictMsg('Roster changed since you opened it. Refreshing the latest version.');
        await loadAuthoritativeData(queue, period, requestGenRef.current);
      } else {
        setActionError(err.message || code);
      }
    } finally {
      setIsSubmittingAmend(false);
    }
  }, [queue, isSubmittingAmend, period, loadAuthoritativeData]);

  // Handle Phase 5 event reversal
  const handleReverseEvent = useCallback(async (eventId, adminNote = '') => {
    if (!queue || !eventId) return;
    setActionError(null);
    setRevisionConflictMsg(null);

    try {
      await queue.reverseAmendment(period, eventId, { adminNote });
      if (undoEvent && undoEvent.eventId === eventId) {
        setUndoEvent(null);
      }
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

  // Handle Phase 6 Absence Submission
  const handleAbsenceSubmit = useCallback(async (payload) => {
    if (!queue || isSubmittingAbsence) return;
    setIsSubmittingAbsence(true);
    setActionError(null);
    setRevisionConflictMsg(null);

    try {
      await queue.createAbsence(period, payload);
      setIsAbsenceModalOpen(false);
      setSelectedDutyForAbsence(null);
      await loadAuthoritativeData(queue, period, requestGenRef.current);
    } catch (err) {
      const code = err.code || err.message;
      if (code === 'REVISION_CONFLICT') {
        setRevisionConflictMsg('Roster changed since you opened it. Refreshing the latest version.');
        await loadAuthoritativeData(queue, period, requestGenRef.current);
      } else {
        setActionError(err.message || code);
      }
    } finally {
      setIsSubmittingAbsence(false);
    }
  }, [queue, isSubmittingAbsence, period, loadAuthoritativeData]);

  // Handle Phase 6 Replacement Submission
  const handleReplacementSubmit = useCallback(async (payload) => {
    if (!queue || isSubmittingReplacement) return;
    setIsSubmittingReplacement(true);
    setActionError(null);
    setRevisionConflictMsg(null);

    try {
      await queue.createReplacement(period, payload);
      setSelectedDutyForReplacement(null);
      await loadAuthoritativeData(queue, period, requestGenRef.current);
    } catch (err) {
      const code = err.code || err.message;
      if (code === 'REVISION_CONFLICT') {
        setRevisionConflictMsg('Roster changed since you opened it. Refreshing the latest version.');
        await loadAuthoritativeData(queue, period, requestGenRef.current);
      } else {
        setActionError(err.message || code);
      }
    } finally {
      setIsSubmittingReplacement(false);
    }
  }, [queue, isSubmittingReplacement, period, loadAuthoritativeData]);

  // Handle Phase 6 Absence Reversal
  const handleReverseAbsence = useCallback(async (absenceId, adminNote = '') => {
    if (!queue || !absenceId || isReversingPhase6) return;
    setIsReversingPhase6(true);
    setActionError(null);
    setRevisionConflictMsg(null);

    try {
      await queue.reverseAbsence(period, absenceId, { adminNote });
      await loadAuthoritativeData(queue, period, requestGenRef.current);
    } catch (err) {
      const code = err.code || err.message;
      if (code === 'REVISION_CONFLICT') {
        setRevisionConflictMsg('Roster changed since you opened it. Refreshing the latest version.');
        await loadAuthoritativeData(queue, period, requestGenRef.current);
      } else {
        setActionError(err.message || code);
      }
      throw err;
    } finally {
      setIsReversingPhase6(false);
    }
  }, [queue, period, isReversingPhase6, loadAuthoritativeData]);

  // Handle Phase 6 Replacement Reversal
  const handleReverseReplacement = useCallback(async (replacementId, options = {}) => {
    if (!queue || !replacementId || isReversingPhase6) return;
    setIsReversingPhase6(true);
    setActionError(null);
    setRevisionConflictMsg(null);

    try {
      await queue.reverseReplacement(period, replacementId, options);
      await loadAuthoritativeData(queue, period, requestGenRef.current);
    } catch (err) {
      const code = err.code || err.message;
      if (code === 'REVISION_CONFLICT') {
        setRevisionConflictMsg('Roster changed since you opened it. Refreshing the latest version.');
        await loadAuthoritativeData(queue, period, requestGenRef.current);
      } else {
        setActionError(err.message || code);
      }
      throw err;
    } finally {
      setIsReversingPhase6(false);
    }
  }, [queue, period, isReversingPhase6, loadAuthoritativeData]);

  // Handle Dedicated Recovery
  const handleRetryRecovery = useCallback(async (opId, opType) => {
    if (!queue || !opId || isRecovering) return;
    setIsRecovering(true);
    setActionError(null);
    try {
      if (opType === 'ABSENCE_CREATE' || opType === 'ABSENCE_REVERSE') {
        await queue.recoverAbsence(opId);
      } else if (opType === 'REPLACEMENT_CREATE' || opType === 'REPLACEMENT_REVERSE') {
        await queue.recoverReplacement(opId);
      } else if (['ENTITLEMENT_EARN_GOFF', 'ENTITLEMENT_EARN_GHKA', 'ENTITLEMENT_CREDIT_MANUAL', 'ENTITLEMENT_CONSUME', 'ENTITLEMENT_CREDIT_REVERSAL', 'ENTITLEMENT_CONSUMPTION_REVERSAL'].includes(opType)) {
        await queue.recoverEntitlement(opId);
      } else {
        await queue.retry(`draft:${period}`, opId);
      }
      await loadAuthoritativeData(queue, period, requestGenRef.current);
      setRecoveryOp(null);
    } catch (err) {
      setActionError(err.message || 'Recovery attempt failed');
    } finally {
      setIsRecovering(false);
    }
  }, [queue, period, isRecovering, loadAuthoritativeData]);

  // Handle selecting another person in EntitlementPanel
  const handleSelectPersonForEntitlement = useCallback(async (pId) => {
    setSelectedPersonForEntitlement(pId);
    if (!isAdmin || !queue || !pId) return;
    try {
      const [bRes, tRes] = await Promise.all([
        queue.getEntitlementBalances?.({ personId: pId }).catch(() => null),
        queue.getEntitlementTransactions?.({ personId: pId, periodId: period }).catch(() => null)
      ]);
      if (bRes?.ok && bRes.balances) setEntitlementBalances(bRes.balances);
      if (tRes?.ok && tRes.transactions) setEntitlementTransactions(tRes.transactions);
    } catch (_) {}
  }, [isAdmin, queue, period]);

  // Handle opening consume modal from Current duty cell
  const handleOpenConsumeModal = useCallback(async (cellData, type) => {
    setConsumeEntitlementType(type);
    setSelectedDutyForEntitlement(cellData);
    if (cellData.personId) {
      setSelectedPersonForEntitlement(cellData.personId);
      if (queue && queue.getEntitlementBalances) {
        try {
          const balRes = await queue.getEntitlementBalances({ personId: cellData.personId });
          if (balRes?.ok && balRes.balances) {
            setEntitlementBalances(balRes.balances);
          }
        } catch (_) {}
      }
    }
  }, [queue]);

  // Handle Phase 7 Earn GOFF Submission
  const handleEarnGoff = useCallback(async ({ personId: targetPId, date, adminNote }) => {
    if (!queue || isSubmittingCredit) return;
    setIsSubmittingCredit(true);
    setActionError(null);
    try {
      await queue.earnGoff(period, { personId: targetPId, date, adminNote });
      setIsCreditModalOpen(false);
      setCreditModalConfig(null);
      await loadAuthoritativeData(queue, period, requestGenRef.current);
    } catch (err) {
      setActionError(err.message || err.code);
    } finally {
      setIsSubmittingCredit(false);
    }
  }, [queue, isSubmittingCredit, period, loadAuthoritativeData]);

  // Handle Phase 7 Earn GHKA Submission
  const handleEarnGhka = useCallback(async ({ personId: targetPId, date, adminNote }) => {
    if (!queue || isSubmittingCredit) return;
    setIsSubmittingCredit(true);
    setActionError(null);
    try {
      await queue.earnGhka(period, { personId: targetPId, date, adminNote });
      setIsCreditModalOpen(false);
      setCreditModalConfig(null);
      await loadAuthoritativeData(queue, period, requestGenRef.current);
    } catch (err) {
      setActionError(err.message || err.code);
    } finally {
      setIsSubmittingCredit(false);
    }
  }, [queue, isSubmittingCredit, period, loadAuthoritativeData]);

  // Handle Phase 7 Manual Credit Submission
  const handleCreditManual = useCallback(async ({ personId: targetPId, entitlementType, amount, effectiveDate, reasonCode, adminNote }) => {
    if (!queue || isSubmittingCredit) return;
    setIsSubmittingCredit(true);
    setActionError(null);
    try {
      await queue.creditManual(period, { personId: targetPId, entitlementType, amount: 1, effectiveDate, reasonCode, adminNote });
      setIsCreditModalOpen(false);
      setCreditModalConfig(null);
      await loadAuthoritativeData(queue, period, requestGenRef.current);
    } catch (err) {
      setActionError(err.message || err.code);
    } finally {
      setIsSubmittingCredit(false);
    }
  }, [queue, isSubmittingCredit, period, loadAuthoritativeData]);

  // Handle Phase 7 Entitlement Consumption
  const handleConsumeEntitlement = useCallback(async ({ personId: targetPId, entitlementType, date, expectedRevision: expRev, adminNote }) => {
    if (!queue || isSubmittingConsume) return;
    const currentState = String(lifecycle?.state || '').toUpperCase();
    if (currentState === 'CLOSED') {
      setActionError('Period is CLOSED and read-only');
      return;
    }
    setIsSubmittingConsume(true);
    setActionError(null);
    setRevisionConflictMsg(null);
    try {
      await queue.consumeEntitlement(period, { personId: targetPId, entitlementType, date, expectedRevision: expRev, adminNote });
      setSelectedDutyForEntitlement(null);
      await loadAuthoritativeData(queue, period, requestGenRef.current);
    } catch (err) {
      const code = err.code || err.message;
      if (code === 'REVISION_CONFLICT') {
        setRevisionConflictMsg('Roster changed since you opened it. Refreshing the latest version.');
        await loadAuthoritativeData(queue, period, requestGenRef.current);
      } else {
        setActionError(err.message || code);
      }
    } finally {
      setIsSubmittingConsume(false);
    }
  }, [queue, isSubmittingConsume, period, lifecycle, loadAuthoritativeData]);

  // Handle Phase 7 Consumption Reversal
  const handleReverseConsumption = useCallback(async (tx) => {
    if (!queue || isReversingEntitlement) return;
    setIsReversingEntitlement(true);
    setActionError(null);
    setRevisionConflictMsg(null);
    try {
      const txId = tx.TransactionId || tx.transactionId;
      await queue.reverseConsumption(period, txId, { expectedRevision: lifecycle?.revision });
      await loadAuthoritativeData(queue, period, requestGenRef.current);
    } catch (err) {
      const code = err.code || err.message;
      if (code === 'REVISION_CONFLICT') {
        setRevisionConflictMsg('Roster changed since you opened it. Refreshing the latest version.');
        await loadAuthoritativeData(queue, period, requestGenRef.current);
      } else {
        setActionError(err.message || code);
      }
    } finally {
      setIsReversingEntitlement(false);
    }
  }, [queue, period, lifecycle, isReversingEntitlement, loadAuthoritativeData]);

  // Handle Phase 7 Credit Reversal
  const handleReverseCredit = useCallback(async (tx) => {
    if (!queue || isReversingEntitlement) return;
    setIsReversingEntitlement(true);
    setActionError(null);
    setRevisionConflictMsg(null);
    try {
      const txId = tx.TransactionId || tx.transactionId;
      await queue.reverseCredit(period, txId);
      await loadAuthoritativeData(queue, period, requestGenRef.current);
    } catch (err) {
      const code = err.code || err.message;
      if (code === 'REVISION_CONFLICT') {
        setRevisionConflictMsg('Roster changed since you opened it. Refreshing the latest version.');
        await loadAuthoritativeData(queue, period, requestGenRef.current);
      } else {
        setActionError(err.message || code);
      }
    } finally {
      setIsReversingEntitlement(false);
    }
  }, [queue, period, isReversingEntitlement, loadAuthoritativeData]);

  // If not enrolled or in DRAFT state or V2 read is disabled: container does not render Phase 5/6 modes
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
    return null;
  }

  const activeAmendmentCount = (currentRoster?.activeAmendmentCount || amendmentHistory?.count || 0) +
    (absences.filter(a => a.Status === 'ACTIVE').length);

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
            className="text-amber-700 hover:text-amber-900 font-bold text-xs cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {/* Recovery Required Banner */}
      {recoveryOp && (
        <div
          id="recovery-required-banner"
          data-testid="recovery-required-banner"
          className="p-3.5 rounded-xl bg-rose-50 border border-rose-300 text-xs text-rose-900 flex flex-wrap items-center justify-between gap-3 shadow-xs"
          role="alert"
        >
          <div className="flex items-center gap-2">
            <span className="text-rose-600 font-bold text-sm">🚨</span>
            <div>
              <p className="font-bold flex items-center gap-2">
                <span>Recovery Required:</span>
                <span className="px-2 py-0.2 rounded-full bg-rose-200 text-rose-900 text-[10px] font-mono">
                  {recoveryOp.operationType}
                </span>
                <span className="font-mono text-[10px] text-rose-700">
                  (ID: {recoveryOp.operationId})
                </span>
              </p>
              <p className="text-[11px] text-rose-800 mt-0.5">
                The last operation encountered an ambiguous backend outcome and requires reconciliation.
              </p>
            </div>
          </div>
          <button
            type="button"
            id="btn-retry-recovery"
            data-testid="btn-retry-recovery"
            disabled={isRecovering}
            onClick={() => handleRetryRecovery(recoveryOp.operationId, recoveryOp.operationType)}
            className="px-3 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 active:scale-95 text-white font-bold transition shadow-2xs disabled:opacity-50 flex items-center gap-1 cursor-pointer"
          >
            {isRecovering ? 'Reconciling…' : 'Retry / Reconcile'}
          </button>
        </div>
      )}

      {/* Action Error Banner */}
      {actionError && (
        <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700 font-medium" role="alert">
          <p className="font-bold">Notice</p>
          <p>{actionError}</p>
        </div>
      )}

      {/* Header Bar: View Mode Selector & Desktop Toolbar */}
      <div
        className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-2 border-b border-slate-200 roster-toolbar-header"
        id="roster-toolbar-header"
        data-testid="roster-toolbar-header"
      >
        <div className="flex items-center gap-2 flex-wrap">
          <RosterViewModeSelector
            mode={viewMode}
            onChange={setViewMode}
            amendmentCount={activeAmendmentCount}
          />
        </div>

        <div className="flex items-center gap-3 text-xs text-slate-500 font-medium self-end sm:self-auto">
          <button
            type="button"
            id="btn-toggle-focus-mode"
            data-testid="btn-toggle-focus-mode"
            onClick={() => setIsFocusMode(prev => !prev)}
            className="hidden lg:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 transition shadow-2xs cursor-pointer"
            title={isFocusMode ? 'Exit high-density focus mode' : 'Expand roster workspace focus'}
          >
            <span>{isFocusMode ? '🗗 Exit Focus' : '🗖 Focus Mode'}</span>
          </button>

          <div>
            Period: <strong className="text-slate-700">{period}</strong>
            {state && (
              <span className="ml-2 font-mono text-[11px] text-slate-400">
                (rev {lifecycle?.revision || 1})
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Main View Mode Rendering */}
      {viewMode === 'CURRENT' && (
        <CurrentRosterView
          currentAssignments={currentRoster?.assignments || []}
          plannedAssignments={plannedRoster?.assignments || []}
          people={people}
          period={period}
          isAdmin={isAdmin}
          lifecycleState={state}
          mutationsEnabled={mutationsEnabled}
          onSelectCellForAmend={(cell) => setSelectedCellForAmend(cell)}
          onSelectDutyForAbsence={(duty) => {
            setSelectedDutyForAbsence(duty);
            setIsAbsenceModalOpen(true);
          }}
          onSelectDutyForReplacement={(duty) => setSelectedDutyForReplacement(duty)}
          onOpenAbsenceModal={() => {
            setSelectedDutyForAbsence(null);
            setIsAbsenceModalOpen(true);
          }}
          onSelectDutyForEntitlement={handleOpenConsumeModal}
          onSelectPersonForEntitlement={isAdmin ? (pId) => {
            handleSelectPersonForEntitlement(pId);
            setViewMode('ENTITLEMENTS');
          } : undefined}
          onOpenEntitlementsPanel={isAdmin ? () => setViewMode('ENTITLEMENTS') : undefined}
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
          absences={absences}
          replacements={replacements}
          currentAssignments={currentRoster?.assignments || []}
          people={people}
          isAdmin={isAdmin}
          onReverse={(eventId, adminNote) => handleReverseEvent(eventId, adminNote)}
          onReverseAbsence={(absenceId, adminNote) => handleReverseAbsence(absenceId, adminNote)}
          onReverseReplacement={(replacementId, options) => handleReverseReplacement(replacementId, options)}
          isReversing={isReversingPhase6}
          reversalError={actionError}
        />
      )}

      {viewMode === 'ENTITLEMENTS' && (
        <EntitlementPanel
          people={people}
          selectedPersonId={selectedPersonForEntitlement || people.find(p => p.dutyDomain !== 'EP' && p.role !== 'EP')?.personId || people[0]?.personId}
          onSelectPersonId={handleSelectPersonForEntitlement}
          balances={entitlementBalances}
          transactions={entitlementTransactions}
          isAdmin={isAdmin}
          period={period}
          onOpenCreditModal={(cfg) => {
            setCreditModalConfig(cfg);
            setIsCreditModalOpen(true);
          }}
          onReverseConsumption={handleReverseConsumption}
          onReverseCredit={handleReverseCredit}
          isReversing={isReversingEntitlement}
          error={actionError}
        />
      )}

      {/* Phase 5 Amendment Modal (Correction & Swap) */}
      <AmendmentModal
        isOpen={Boolean(selectedCellForAmend)}
        onClose={() => setSelectedCellForAmend(null)}
        onSubmit={handleAmendmentSubmit}
        targetCell={selectedCellForAmend}
        availableParticipants={currentRoster?.assignments || []}
        isSubmitting={isSubmittingAmend}
        error={actionError}
      />

      {/* Phase 6 Absence Modal */}
      <AbsenceModal
        isOpen={isAbsenceModalOpen}
        onClose={() => {
          setIsAbsenceModalOpen(false);
          setSelectedDutyForAbsence(null);
        }}
        onSubmit={handleAbsenceSubmit}
        currentAssignments={currentRoster?.assignments || []}
        people={people}
        preselectedDuty={selectedDutyForAbsence}
        isSubmitting={isSubmittingAbsence}
        error={actionError}
        period={period}
      />

      {/* Phase 6 Replacement Modal */}
      <ReplacementModal
        isOpen={Boolean(selectedDutyForReplacement)}
        onClose={() => setSelectedDutyForReplacement(null)}
        onSubmit={handleReplacementSubmit}
        targetDuty={selectedDutyForReplacement}
        currentAssignments={currentRoster?.assignments || []}
        people={people}
        absences={absences}
        isSubmitting={isSubmittingReplacement}
        error={actionError}
      />

      {/* Phase 7 Entitlement Credit Modal */}
      <EntitlementCreditModal
        key={`credit-${creditModalConfig?.mode}-${creditModalConfig?.personId || selectedPersonForEntitlement || people.find(p => p.dutyDomain !== 'EP' && p.role !== 'EP')?.personId}-${isCreditModalOpen}`}
        isOpen={isCreditModalOpen}
        onClose={() => {
          setIsCreditModalOpen(false);
          setCreditModalConfig(null);
        }}
        initialMode={creditModalConfig?.mode || 'EARN_GOFF'}
        personId={creditModalConfig?.personId || selectedPersonForEntitlement || people.find(p => p.dutyDomain !== 'EP' && p.role !== 'EP')?.personId || people[0]?.personId}
        period={period}
        people={people}
        currentAssignments={currentRoster?.assignments || []}
        plannedAssignments={plannedRoster?.assignments || []}
        existingTransactions={entitlementTransactions}
        onEarnGoff={handleEarnGoff}
        onEarnGhka={handleEarnGhka}
        onCreditManual={handleCreditManual}
        isSubmitting={isSubmittingCredit}
        error={actionError}
      />

      {/* Phase 7 Entitlement Consume Modal */}
      <EntitlementConsumeModal
        key={`consume-${selectedDutyForEntitlement?.personId}-${selectedDutyForEntitlement?.date}-${consumeEntitlementType}-${Boolean(selectedDutyForEntitlement)}`}
        isOpen={Boolean(selectedDutyForEntitlement)}
        onClose={() => setSelectedDutyForEntitlement(null)}
        targetDuty={selectedDutyForEntitlement}
        balances={entitlementBalances}
        initialType={consumeEntitlementType}
        absences={absences}
        expectedRevision={lifecycle?.revision || 0}
        onConsume={handleConsumeEntitlement}
        isSubmitting={isSubmittingConsume}
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
