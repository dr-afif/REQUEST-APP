import React, { useState, useEffect, useMemo } from 'react';

/**
 * Phase 6 Replacement Assignment Modal:
 * Exposes authoritative replacement assignment from an uncovered absent duty.
 * Proactively annotates candidate availability based on Current roster:
 *   - Allows OFF in same domain
 *   - Allows duties in another DutyDomain (cross-domain)
 *   - Blocks absent person themselves
 *   - Blocks persons already working in same DutyDomain
 *   - Blocks persons on active absence on target date
 * Strictly submits authoritative PersonId.
 */
export default function ReplacementModal({
  isOpen = false,
  onClose,
  onSubmit,
  targetDuty = null,
  currentAssignments = [],
  people = [],
  absences = [],
  isSubmitting = false,
  error = null
}) {
  const [selectedCandidateId, setSelectedCandidateId] = useState('');
  const [adminNote, setAdminNote] = useState('');
  const [localError, setLocalError] = useState(null);

  // Extract distinct staff members
  const allStaff = useMemo(() => {
    const map = new Map();
    (people || []).forEach(p => {
      const id = p.personId || p.PersonId;
      const name = p.name || p.PersonNameSnapshot || p.personNameSnapshot || id;
      if (id) map.set(id, name);
    });
    (currentAssignments || []).forEach(a => {
      if (a.personId && !map.has(a.personId)) {
        map.set(a.personId, a.personNameSnapshot || a.personId);
      }
    });
    return Array.from(map.entries()).map(([id, name]) => ({ personId: id, name }));
  }, [people, currentAssignments]);

  // Evaluate candidate availability for the target duty's date and domain
  const candidateOptions = useMemo(() => {
    if (!targetDuty) return [];
    const { date, dutyDomain, absentPersonId } = targetDuty;

    return allStaff.map(staff => {
      const pid = staff.personId;

      // 1. Cannot replace self
      if (pid === absentPersonId) {
        return {
          ...staff,
          available: false,
          reason: 'Cannot replace self'
        };
      }

      // 2. Active absence check
      const hasActiveAbsence = (absences || []).some(ab => {
        const abPid = ab.PersonId || ab.personId;
        const abDomain = ab.DutyDomain || ab.dutyDomain;
        const abStart = ab.StartDate || ab.startDate;
        const abEnd = ab.EndDate || ab.endDate;
        const abStatus = ab.Status || ab.status || 'ACTIVE';
        return abPid === pid &&
          abDomain === dutyDomain &&
          abStatus === 'ACTIVE' &&
          abStart <= date &&
          abEnd >= date;
      });
      if (hasActiveAbsence) {
        return {
          ...staff,
          available: false,
          reason: 'On active absence'
        };
      }

      // 3. Same-domain assignment check on target date
      const sameDomainAssignment = (currentAssignments || []).find(a =>
        a.personId === pid &&
        a.dutyDomain === dutyDomain &&
        a.date === date
      );

      if (sameDomainAssignment) {
        const shift = sameDomainAssignment.shiftCode || '';
        if (shift && shift !== 'OFF' && sameDomainAssignment.source !== 'ABSENCE') {
          return {
            ...staff,
            available: false,
            reason: `Already working (${shift})`
          };
        }
        if (shift === 'OFF') {
          return {
            ...staff,
            available: true,
            badge: 'Scheduled OFF (Recommended)'
          };
        }
      }

      // 4. Cross-domain duty check
      const otherDomainAssignment = (currentAssignments || []).find(a =>
        a.personId === pid &&
        a.dutyDomain !== dutyDomain &&
        a.date === date
      );
      if (otherDomainAssignment && otherDomainAssignment.shiftCode && otherDomainAssignment.shiftCode !== 'OFF') {
        return {
          ...staff,
          available: true,
          badge: `Cross-domain (${otherDomainAssignment.dutyDomain}: ${otherDomainAssignment.shiftCode})`
        };
      }

      return {
        ...staff,
        available: true,
        badge: 'Available'
      };
    }).sort((a, b) => {
      // Available first, then name
      if (a.available !== b.available) return a.available ? -1 : 1;
      return (a.name || '').localeCompare(b.name || '');
    });
  }, [targetDuty, allStaff, absences, currentAssignments]);

  useEffect(() => {
    if (isOpen) {
      setLocalError(null);
      setAdminNote('');
      const firstAvailable = candidateOptions.find(c => c.available);
      setSelectedCandidateId(firstAvailable ? firstAvailable.personId : '');
    }
  }, [isOpen, candidateOptions]);

  if (!isOpen || !targetDuty) return null;

  const handleSubmit = (e) => {
    e.preventDefault();
    setLocalError(null);

    if (!selectedCandidateId) {
      setLocalError('Please select a replacement staff member.');
      return;
    }

    const candidate = candidateOptions.find(c => c.personId === selectedCandidateId);
    if (candidate && !candidate.available) {
      setLocalError(`Selected candidate is unavailable: ${candidate.reason}`);
      return;
    }

    const payload = {
      absenceId: targetDuty.absenceId,
      originalAssignmentId: targetDuty.originalAssignmentId,
      replacementPersonId: selectedCandidateId,
      date: targetDuty.date,
      dutyDomain: targetDuty.dutyDomain,
      shiftCode: targetDuty.originalShiftCode,
      adminNote: adminNote.trim()
    };

    onSubmit(payload);
  };

  const selectedCandidate = candidateOptions.find(c => c.personId === selectedCandidateId);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="replacement-modal-title"
      id="replacement-modal"
    >
      <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full p-6 space-y-5 border border-slate-200 animate-in fade-in zoom-in-95 duration-150 my-8">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div>
            <h3 id="replacement-modal-title" className="text-base font-bold text-slate-900 flex items-center gap-2">
              <span>🤝</span>
              <span>Assign Duty Replacement</span>
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Assign an eligible doctor to cover an uncovered absent duty.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="text-slate-400 hover:text-slate-600 p-1 rounded-lg text-lg leading-none"
          >
            ✕
          </button>
        </div>

        {/* Error Banners */}
        {(localError || error) && (
          <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700 font-medium" role="alert">
            <p className="font-bold">Cannot Assign Replacement</p>
            <p id="replacement-error-banner">{localError || error}</p>
          </div>
        )}

        {/* Absent Duty Summary Card */}
        <div className="p-4 rounded-xl bg-amber-50/70 border border-amber-200 space-y-2 text-xs">
          <div className="flex items-center justify-between">
            <span className="font-bold text-amber-950">Absent Staff Member:</span>
            <span className="font-bold text-slate-800" id="absent-person-name" data-testid="absent-person-name">
              {targetDuty.absentPersonName || targetDuty.absentPersonId}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2 text-[11px] text-amber-900">
            <div>
              Date: <strong className="font-mono text-slate-800">{targetDuty.date}</strong>
            </div>
            <div>
              Domain: <strong className="text-slate-800">{targetDuty.dutyDomain}</strong>
            </div>
            <div>
              Absence Type: <strong className="text-rose-700">{targetDuty.absenceType}</strong>
            </div>
            <div>
              Original Duty: <strong className="font-mono text-indigo-700">{targetDuty.originalShiftCode}</strong>
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          {/* Candidate Selection */}
          <div>
            <label htmlFor="replacement-candidate-select" className="block font-bold text-slate-700 mb-1">
              Select Replacement Doctor <span className="text-rose-500">*</span>
            </label>
            <select
              id="replacement-candidate-select"
              data-testid="replacement-candidate-select"
              value={selectedCandidateId}
              onChange={(e) => setSelectedCandidateId(e.target.value)}
              disabled={isSubmitting}
              className="w-full p-2.5 rounded-xl border border-slate-300 bg-white text-slate-800 font-medium focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none"
            >
              <option value="">-- Select Replacement Candidate --</option>
              {candidateOptions.map((c) => (
                <option
                  key={c.personId}
                  value={c.personId}
                  disabled={!c.available}
                >
                  {c.available ? '✓ ' : '✕ '}
                  {c.name} — {c.available ? (c.badge || 'Available') : `Unavailable (${c.reason})`}
                </option>
              ))}
            </select>
          </div>

          {/* Coverage Preview Card */}
          {selectedCandidate && (
            <div className={`p-3.5 rounded-xl border text-xs space-y-1 ${
              selectedCandidate.available
                ? 'bg-emerald-50/70 border-emerald-200 text-emerald-950'
                : 'bg-rose-50 border-rose-200 text-rose-900'
            }`}>
              <p className="font-bold flex items-center gap-1.5">
                <span>{selectedCandidate.available ? '🛡️ Coverage Plan:' : '⚠️ Warning:'}</span>
                <span>
                  {selectedCandidate.available
                    ? `Dr ${selectedCandidate.name} will cover ${targetDuty.originalShiftCode} on ${targetDuty.date}`
                    : `Dr ${selectedCandidate.name} cannot be assigned: ${selectedCandidate.reason}`}
                </span>
              </p>
              <p className="text-[11px] opacity-80">
                {selectedCandidate.available
                  ? `Operational status: Shift ${targetDuty.originalShiftCode} will transition to COVERED.`
                  : 'Backend validation strictly blocks unavailable candidates.'}
              </p>
            </div>
          )}

          {/* Admin Note (Optional) */}
          <div>
            <label htmlFor="replacement-admin-note" className="block font-bold text-slate-700 mb-1">
              Admin Note <span className="text-slate-400 font-normal">(Private — visible to admins only)</span>
            </label>
            <textarea
              id="replacement-admin-note"
              data-testid="replacement-admin-note"
              rows={2}
              value={adminNote}
              onChange={(e) => setAdminNote(e.target.value)}
              placeholder="Optional notes regarding duty coverage or shift arrangement..."
              disabled={isSubmitting}
              className="w-full p-2.5 rounded-xl border border-slate-300 bg-white text-slate-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none resize-none"
            />
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 rounded-xl border border-slate-300 text-slate-700 font-bold hover:bg-slate-50 transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              id="btn-submit-replacement"
              data-testid="btn-submit-replacement"
              disabled={isSubmitting || !selectedCandidate?.available}
              className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white font-bold transition shadow-xs disabled:opacity-50 flex items-center gap-1.5"
            >
              {isSubmitting ? (
                <>
                  <span className="animate-spin text-sm">⏳</span>
                  <span>Assigning replacement…</span>
                </>
              ) : (
                <span>Confirm Replacement</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
