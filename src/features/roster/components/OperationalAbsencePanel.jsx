import React, { useState } from 'react';

/**
 * Phase 6 Operational Absence & Coverage Panel:
 * Contained operational history view for absences and replacements.
 * Multi-day absence UI: shows 1 absence record with date range and individual affected duties.
 * Admin actions: Reverse absence (dependency-checked), Reverse replacement (with shortage acceptance).
 * Privacy: AdminNote and mutation controls are strictly admin-only; viewers see only operational status.
 */
export default function OperationalAbsencePanel({
  absences = [],
  replacements = [],
  currentAssignments = [],
  people = [],
  isAdmin = false,
  onReverseAbsence,
  onReverseReplacement,
  isReversing = false,
  reversalError = null
}) {
  const [selectedAbsenceToReverse, setSelectedAbsenceToReverse] = useState(null);
  const [selectedReplacementToReverse, setSelectedReplacementToReverse] = useState(null);
  const [adminNote, setAdminNote] = useState('');
  const [shortageAccepted, setShortageAccepted] = useState(false);
  const [shortageReason, setShortageReason] = useState('');
  const [localError, setLocalError] = useState(reversalError);

  // People map for looking up names from PersonId
  const peopleMap = new Map();
  (people || []).forEach(p => {
    const id = p.personId || p.PersonId;
    const name = p.name || p.PersonNameSnapshot || p.personNameSnapshot || id;
    if (id) peopleMap.set(id, name);
  });
  (currentAssignments || []).forEach(a => {
    if (a.personId && !peopleMap.has(a.personId)) {
      peopleMap.set(a.personId, a.personNameSnapshot || a.personId);
    }
  });

  const getPersonName = (id, fallback) => peopleMap.get(id) || fallback || id;

  const handleOpenReverseAbsence = (absence) => {
    setLocalError(null);
    setAdminNote('');
    // Dependency check: does this absence have active replacements?
    const hasActiveReplacements = (replacements || []).some(
      r => r.AbsenceId === absence.AbsenceId && (r.Status || 'ACTIVE') === 'ACTIVE'
    );
    if (hasActiveReplacements) {
      setLocalError('Reverse the active replacement first before reversing this absence.');
      return;
    }
    setSelectedAbsenceToReverse(absence);
  };

  const handleConfirmReverseAbsence = async () => {
    if (!selectedAbsenceToReverse) return;
    setLocalError(null);
    try {
      await onReverseAbsence(selectedAbsenceToReverse.AbsenceId, adminNote);
      setSelectedAbsenceToReverse(null);
    } catch (err) {
      const code = err.code || err.message;
      if (code === 'REPLACEMENT_DEPENDENCY_CONFLICT') {
        setLocalError('Reverse the active replacement first before reversing this absence.');
      } else {
        setLocalError(err.message || code);
      }
    }
  };

  const handleOpenReverseReplacement = (replacement) => {
    setLocalError(null);
    setAdminNote('');
    setShortageAccepted(false);
    setShortageReason('');
    setSelectedReplacementToReverse(replacement);
  };

  const handleConfirmReverseReplacement = async () => {
    if (!selectedReplacementToReverse) return;
    setLocalError(null);
    if (!shortageAccepted || !shortageReason.trim()) {
      setLocalError('Shortage acceptance and reason are required to reverse a replacement.');
      return;
    }
    try {
      await onReverseReplacement(selectedReplacementToReverse.ReplacementId, {
        adminNote,
        shortageAccepted: true,
        shortageReason: shortageReason.trim()
      });
      setSelectedReplacementToReverse(null);
    } catch (err) {
      setLocalError(err.message || err.code || 'Failed to reverse replacement');
    }
  };

  return (
    <div className="space-y-4" aria-label="Operational Absences and Replacements" id="operational-absence-panel">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between p-4 rounded-2xl bg-amber-50/70 border border-amber-200 gap-2">
        <div>
          <h4 className="text-sm font-bold text-amber-950 flex items-center gap-2">
            <span>🩺</span>
            <span>Operational Absences & Duty Replacements</span>
          </h4>
          <p className="text-xs text-amber-800/80 mt-0.5">
            Operational record of staff absences, uncovered duties, and replacement assignments.
          </p>
        </div>
        <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-amber-100 text-amber-800 self-start sm:self-auto">
          {absences.length} {absences.length === 1 ? 'record' : 'records'}
        </span>
      </div>

      {localError && (
        <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700 font-medium" role="alert">
          <p className="font-bold">Notice</p>
          <p id="operational-error-banner">{localError}</p>
        </div>
      )}

      {absences.length === 0 ? (
        <div className="text-center py-12 rounded-2xl border border-dashed border-slate-300 bg-white">
          <p className="text-2xl mb-2">📋</p>
          <p className="text-sm font-semibold text-slate-700">No operational absences recorded</p>
          <p className="text-xs text-slate-500 mt-1">
            All planned duties are active or governed by standard schedule.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {absences.map((ab) => {
            const isReversed = ab.Status === 'REVERSED';
            const personName = getPersonName(ab.PersonId, ab.PersonNameSnapshot);
            const activeRepls = (replacements || []).filter(
              r => r.AbsenceId === ab.AbsenceId && (r.Status || 'ACTIVE') === 'ACTIVE'
            );
            const hasActiveRepl = activeRepls.length > 0;

            // Find all affected duties in current roster for this absence
            const affectedDuties = (currentAssignments || []).filter(a => {
              if (a.personId !== ab.PersonId && a.coveringForPersonId !== ab.PersonId) return false;
              if (a.dutyDomain !== (ab.DutyDomain || 'MO')) return false;
              if (a.date < ab.StartDate || a.date > ab.EndDate) return false;
              // Check if duty corresponds to this absence
              return a.absenceId === ab.AbsenceId || (a.source === 'ABSENCE' && a.personId === ab.PersonId);
            });

            // Derive coverage state
            let coverageBadge = 'Uncovered';
            let coverageColor = 'bg-rose-100 text-rose-800 border-rose-200';
            if (isReversed) {
              coverageBadge = 'Reversed';
              coverageColor = 'bg-slate-100 text-slate-600 border-slate-200';
            } else if (affectedDuties.length === 0) {
              coverageBadge = 'Administrative (No Duties)';
              coverageColor = 'bg-blue-50 text-blue-700 border-blue-200';
            } else if (activeRepls.length >= affectedDuties.length && affectedDuties.length > 0) {
              coverageBadge = 'Fully Covered';
              coverageColor = 'bg-emerald-100 text-emerald-800 border-emerald-200';
            } else if (activeRepls.length > 0) {
              coverageBadge = 'Partially Covered';
              coverageColor = 'bg-amber-100 text-amber-800 border-amber-200';
            }

            return (
              <div
                key={ab.AbsenceId}
                id={`absence-record-${ab.AbsenceId}`}
                data-testid={`absence-record-${ab.AbsenceId}`}
                className={`p-4 rounded-2xl bg-white border transition shadow-2xs ${
                  isReversed
                    ? 'border-slate-200 opacity-75 bg-slate-50/50'
                    : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                {/* Header row */}
                <div className="flex flex-wrap items-start justify-between gap-3 mb-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-bold text-slate-900 text-sm">
                      {personName}
                    </span>

                    {/* Absence Type Badge */}
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-purple-100 text-purple-800">
                      {ab.AbsenceType}
                    </span>

                    {/* Date Range */}
                    <span className="text-xs text-slate-600 font-medium">
                      {ab.StartDate === ab.EndDate ? ab.StartDate : `${ab.StartDate} → ${ab.EndDate}`}
                    </span>

                    {/* Domain */}
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-600">
                      {ab.DutyDomain}
                    </span>

                    {/* Coverage Status Badge */}
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${coverageColor}`}>
                      {coverageBadge}
                    </span>
                  </div>

                  {/* Admin Reversal Action */}
                  {isAdmin && !isReversed && (
                    <button
                      type="button"
                      id={`btn-reverse-absence-${ab.AbsenceId}`}
                      data-testid={`btn-reverse-absence-${ab.AbsenceId}`}
                      onClick={() => handleOpenReverseAbsence(ab)}
                      disabled={isReversing}
                      title={hasActiveRepl ? 'Reverse active replacement first before reversing this absence' : 'Reverse this absence'}
                      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold border transition shadow-2xs active:scale-95 ${
                        hasActiveRepl
                          ? 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed'
                          : 'bg-white text-slate-700 border-slate-300 hover:bg-rose-50 hover:text-rose-700 hover:border-rose-200'
                      }`}
                    >
                      <span>↩️</span>
                      <span>Reverse Absence</span>
                    </button>
                  )}
                </div>

                {/* Multi-day breakdown of affected duties */}
                <div className="mt-3 pt-3 border-t border-slate-100 space-y-2">
                  <p className="text-xs font-bold text-slate-700 flex items-center gap-1">
                    <span>📅</span>
                    <span>Affected Roster Duties ({affectedDuties.length}):</span>
                  </p>

                  {affectedDuties.length === 0 ? (
                    <p className="text-[11px] text-slate-500 italic pl-5">
                      No working duties were scheduled for this date range. Record is administrative only.
                    </p>
                  ) : (
                    <div className="space-y-1.5 pl-5">
                      {affectedDuties.map((duty) => {
                        const repl = (replacements || []).find(
                          r => r.AbsenceId === ab.AbsenceId &&
                            r.Date === duty.date &&
                            (r.Status || 'ACTIVE') === 'ACTIVE'
                        );
                        const coveringName = repl ? getPersonName(repl.ReplacementPersonId) : null;

                        return (
                          <div
                            key={duty.assignmentId || `${duty.date}-${duty.shiftCode}`}
                            className="flex flex-wrap items-center justify-between p-2 rounded-xl bg-slate-50 border border-slate-200 text-xs gap-2"
                          >
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-slate-800">{duty.date}</span>
                              <span className="font-mono font-bold px-2 py-0.5 rounded bg-indigo-100 text-indigo-800 text-[11px]">
                                {duty.originalShiftCode || duty.shiftCode}
                              </span>
                              {repl ? (
                                <span className="text-[11px] font-bold text-emerald-700 flex items-center gap-1">
                                  <span>🛡️</span>
                                  <span>Covered by Dr {coveringName}</span>
                                </span>
                              ) : (
                                <span className="text-[11px] font-bold text-rose-600 flex items-center gap-1">
                                  <span>⚠️</span>
                                  <span>Uncovered</span>
                                </span>
                              )}
                            </div>

                            {/* Reverse Replacement button if covered and user is admin */}
                            {isAdmin && repl && !isReversed && (
                              <button
                                type="button"
                                id={`btn-reverse-replacement-${repl.ReplacementId}`}
                                data-testid={`btn-reverse-replacement-${repl.ReplacementId}`}
                                onClick={() => handleOpenReverseReplacement(repl)}
                                disabled={isReversing}
                                className="px-2 py-0.5 rounded-lg text-[11px] font-bold bg-white text-amber-800 border border-amber-300 hover:bg-amber-50 active:scale-95 transition"
                              >
                                ↩️ Reverse Replacement
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Admin Note (Strictly Admin Only) */}
                {isAdmin && ab.AdminNote && (
                  <div className="mt-3 p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-[11px] text-slate-600">
                    <strong className="text-slate-800">Admin Note:</strong> {ab.AdminNote}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Confirmation Dialog: Reverse Absence */}
      {selectedAbsenceToReverse && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 space-y-4 border border-slate-200 animate-in fade-in zoom-in-95 duration-150">
            <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <span>↩️</span>
              <span>Confirm Absence Reversal</span>
            </h3>
            <p className="text-xs text-slate-600">
              Are you sure you want to reverse the absence for{' '}
              <strong>{getPersonName(selectedAbsenceToReverse.PersonId, selectedAbsenceToReverse.PersonNameSnapshot)}</strong>?
              This will restore their scheduled roster duties.
            </p>
            <div>
              <label htmlFor="reverse-absence-note" className="block text-xs font-bold text-slate-700 mb-1">
                Admin Note (Optional)
              </label>
              <textarea
                id="reverse-absence-note"
                rows={2}
                value={adminNote}
                onChange={(e) => setAdminNote(e.target.value)}
                placeholder="Reason for absence reversal..."
                className="w-full p-2.5 rounded-xl border border-slate-300 text-xs focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none resize-none"
              />
            </div>
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setSelectedAbsenceToReverse(null)}
                disabled={isReversing}
                className="px-4 py-2 rounded-xl border border-slate-300 text-xs font-bold text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                id="btn-confirm-reverse-absence"
                data-testid="btn-confirm-reverse-absence"
                onClick={handleConfirmReverseAbsence}
                disabled={isReversing}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold transition shadow-xs disabled:opacity-50"
              >
                {isReversing ? 'Reversing absence…' : 'Confirm Reversal'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Dialog: Reverse Replacement (with Shortage Acceptance) */}
      {selectedReplacementToReverse && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 space-y-4 border border-slate-200 animate-in fade-in zoom-in-95 duration-150">
            <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <span>↩️</span>
              <span>Confirm Replacement Reversal</span>
            </h3>
            <div className="p-3 rounded-xl bg-amber-50 border border-amber-300 text-xs text-amber-900 space-y-1">
              <p className="font-bold">⚠️ Warning: Duty will return to UNCOVERED</p>
              <p className="text-[11px]">
                Reversing this replacement leaves the original absent duty on{' '}
                <strong>{selectedReplacementToReverse.Date}</strong> uncovered.
              </p>
            </div>
            <div className="space-y-3 text-xs">
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  id="replacement-reversal-shortage-checkbox"
                  data-testid="replacement-reversal-shortage-checkbox"
                  checked={shortageAccepted}
                  onChange={(e) => setShortageAccepted(e.target.checked)}
                  className="mt-0.5 rounded border-amber-400 text-indigo-600"
                />
                <span className="font-bold text-slate-800">
                  I acknowledge that reversing this replacement creates an uncovered duty shortage
                </span>
              </label>
              <div>
                <label htmlFor="replacement-reversal-reason" className="block font-bold text-slate-700 mb-1">
                  Shortage Reason <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  id="replacement-reversal-reason"
                  data-testid="replacement-reversal-reason"
                  value={shortageReason}
                  onChange={(e) => setShortageReason(e.target.value)}
                  placeholder="Reason for shortage upon reversal..."
                  className="w-full p-2 rounded-xl border border-slate-300 text-xs focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none"
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setSelectedReplacementToReverse(null)}
                disabled={isReversing}
                className="px-4 py-2 rounded-xl border border-slate-300 text-xs font-bold text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                id="btn-confirm-reverse-replacement"
                data-testid="btn-confirm-reverse-replacement"
                onClick={handleConfirmReverseReplacement}
                disabled={isReversing || !shortageAccepted || !shortageReason.trim()}
                className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold transition shadow-xs disabled:opacity-50"
              >
                {isReversing ? 'Reversing replacement…' : 'Confirm Reversal'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
