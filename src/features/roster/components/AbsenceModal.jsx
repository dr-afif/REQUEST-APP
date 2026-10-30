import React, { useState, useEffect, useMemo } from 'react';
import RosterAbsence from '../absence.js';

/**
 * Phase 6 Absence Entry Modal:
 * Allows authorized admins to record operational absences: MC, EL, AL, COURSE.
 * Context-aware: shows affected Current working duties.
 * Shortage workflow: requires explicit acceptance & reason if duties become uncovered.
 * Strictly uses authoritative PersonId.
 */
export default function AbsenceModal({
  isOpen = false,
  onClose,
  onSubmit,
  currentAssignments = [],
  people = [],
  preselectedDuty = null,
  isSubmitting = false,
  error = null,
  period = ''
}) {
  const [selectedPersonId, setSelectedPersonId] = useState('');
  const [absenceType, setAbsenceType] = useState('MC');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [dutyDomain, setDutyDomain] = useState('MO');
  const [adminNote, setAdminNote] = useState('');
  const [shortageAccepted, setShortageAccepted] = useState(false);
  const [shortageReason, setShortageReason] = useState('');
  const [localError, setLocalError] = useState(null);

  // Extract distinct people list from assignments and people lookup
  const distinctPeople = useMemo(() => {
    const map = new Map();
    // From people array
    (people || []).forEach(p => {
      const id = p.personId || p.PersonId;
      const name = p.name || p.PersonNameSnapshot || p.personNameSnapshot || id;
      if (id) map.set(id, name);
    });
    // From current assignments
    (currentAssignments || []).forEach(a => {
      if (a.personId && !map.has(a.personId)) {
        map.set(a.personId, a.personNameSnapshot || a.personId);
      }
    });
    return Array.from(map.entries()).map(([id, name]) => ({ personId: id, name }));
  }, [people, currentAssignments]);

  // Preselect duty if opened from a specific cell
  useEffect(() => {
    if (isOpen) {
      setLocalError(null);
      if (preselectedDuty) {
        setSelectedPersonId(preselectedDuty.personId || '');
        setDutyDomain(preselectedDuty.dutyDomain || 'MO');
        setStartDate(preselectedDuty.date || '');
        setEndDate(preselectedDuty.date || '');
      } else {
        if (!selectedPersonId && distinctPeople.length > 0) {
          setSelectedPersonId(distinctPeople[0].personId);
        }
        if (!startDate && period) {
          setStartDate(`${period}-01`);
          setEndDate(`${period}-01`);
        }
      }
      setAbsenceType('MC');
      setAdminNote('');
      setShortageAccepted(false);
      setShortageReason('');
    }
  }, [isOpen, preselectedDuty, period, distinctPeople]);

  // Dynamically compute affected working assignments in Current roster
  const affectedAssignments = useMemo(() => {
    if (!selectedPersonId || !startDate || !endDate) return [];
    if (startDate > endDate) return [];

    return (currentAssignments || []).filter(a => {
      if (a.personId !== selectedPersonId) return false;
      if (a.dutyDomain !== dutyDomain) return false;
      if (a.date < startDate || a.date > endDate) return false;
      // Only working duties are affected
      const code = a.shiftCode || '';
      return code && code !== 'OFF' && a.source !== 'ABSENCE';
    }).sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  }, [selectedPersonId, dutyDomain, startDate, endDate, currentAssignments]);

  const hasShortage = affectedAssignments.length > 0;

  if (!isOpen) return null;

  const handleSubmit = (e) => {
    e.preventDefault();
    setLocalError(null);

    if (!selectedPersonId) {
      setLocalError('Please select a staff member.');
      return;
    }
    if (!startDate || !endDate) {
      setLocalError('Start and end dates are required.');
      return;
    }
    if (startDate > endDate) {
      setLocalError('Start date must be before or equal to end date.');
      return;
    }
    if (hasShortage) {
      if (!shortageAccepted) {
        setLocalError('Shortage acceptance is required for uncovered duties.');
        return;
      }
      if (!shortageReason.trim()) {
        setLocalError('Please provide a shortage reason.');
        return;
      }
    }

    const payload = {
      personId: selectedPersonId,
      absenceType: absenceType,
      startDate: startDate,
      endDate: endDate,
      dutyDomain: dutyDomain,
      adminNote: adminNote.trim(),
      shortageAccepted: hasShortage ? Boolean(shortageAccepted) : false,
      shortageReason: hasShortage ? shortageReason.trim() : ''
    };

    onSubmit(payload);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="absence-modal-title"
      id="absence-modal"
    >
      <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full p-6 space-y-5 border border-slate-200 animate-in fade-in zoom-in-95 duration-150 my-8">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div>
            <h3 id="absence-modal-title" className="text-base font-bold text-slate-900 flex items-center gap-2">
              <span>🩺</span>
              <span>Record Operational Absence</span>
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Record staff absence for duty coverage and operational planning.
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
            <p className="font-bold">Cannot Record Absence</p>
            <p id="absence-error-banner">{localError || error}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          {/* Person Selection */}
          <div>
            <label htmlFor="absence-person-select" className="block font-bold text-slate-700 mb-1">
              Staff Member (Person) <span className="text-rose-500">*</span>
            </label>
            <select
              id="absence-person-select"
              data-testid="absence-person-select"
              value={selectedPersonId}
              onChange={(e) => setSelectedPersonId(e.target.value)}
              disabled={isSubmitting}
              className="w-full p-2.5 rounded-xl border border-slate-300 bg-white text-slate-800 font-medium focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none"
            >
              <option value="">-- Select Staff Member --</option>
              {distinctPeople.map((p) => (
                <option key={p.personId} value={p.personId}>
                  {p.name} ({p.personId.slice(0, 8)})
                </option>
              ))}
            </select>
          </div>

          {/* Absence Type & Domain */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="absence-type-select" className="block font-bold text-slate-700 mb-1">
                Absence Type <span className="text-rose-500">*</span>
              </label>
              <select
                id="absence-type-select"
                data-testid="absence-type-select"
                value={absenceType}
                onChange={(e) => setAbsenceType(e.target.value)}
                disabled={isSubmitting}
                className="w-full p-2.5 rounded-xl border border-slate-300 bg-white text-slate-800 font-bold focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none"
              >
                <option value="MC">MC — Medical Certificate / Sick Leave</option>
                <option value="EL">EL — Emergency Leave</option>
                <option value="AL">AL — Annual Leave</option>
                <option value="COURSE">COURSE — Course / Training</option>
              </select>
            </div>

            <div>
              <label htmlFor="absence-domain-select" className="block font-bold text-slate-700 mb-1">
                Duty Domain <span className="text-rose-500">*</span>
              </label>
              <select
                id="absence-domain-select"
                data-testid="absence-domain-select"
                value={dutyDomain}
                onChange={(e) => setDutyDomain(e.target.value)}
                disabled={isSubmitting}
                className="w-full p-2.5 rounded-xl border border-slate-300 bg-white text-slate-800 font-medium focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none"
              >
                <option value="MO">MO — Medical Officer</option>
                <option value="EP">EP — Emergency Physician</option>
              </select>
            </div>
          </div>

          {/* Date Range */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="absence-start-date" className="block font-bold text-slate-700 mb-1">
                Start Date <span className="text-rose-500">*</span>
              </label>
              <input
                type="date"
                id="absence-start-date"
                data-testid="absence-start-date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                disabled={isSubmitting}
                className="w-full p-2.5 rounded-xl border border-slate-300 bg-white text-slate-800 font-mono font-medium focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none"
              />
            </div>

            <div>
              <label htmlFor="absence-end-date" className="block font-bold text-slate-700 mb-1">
                End Date <span className="text-rose-500">*</span>
              </label>
              <input
                type="date"
                id="absence-end-date"
                data-testid="absence-end-date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                disabled={isSubmitting}
                className="w-full p-2.5 rounded-xl border border-slate-300 bg-white text-slate-800 font-mono font-medium focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none"
              />
            </div>
          </div>

          {/* Context-aware Affected Duties Display */}
          <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-bold text-slate-700">Affected Current Duties:</span>
              <span className="font-mono text-xs font-semibold px-2 py-0.5 rounded-full bg-slate-200 text-slate-800">
                {affectedAssignments.length} {affectedAssignments.length === 1 ? 'duty' : 'duties'}
              </span>
            </div>

            {hasShortage ? (
              <div className="space-y-1.5 pt-1">
                <p className="text-[11px] text-amber-800 font-medium">
                  The following scheduled shifts will become <strong className="text-rose-700">UNCOVERED</strong>:
                </p>
                <ul className="space-y-1 pl-2" id="affected-duties-list" data-testid="affected-duties-list">
                  {affectedAssignments.map((a) => (
                    <li
                      key={a.assignmentId || `${a.date}-${a.shiftCode}`}
                      className="flex items-center justify-between p-1.5 rounded-lg bg-white border border-slate-200 text-xs"
                    >
                      <span className="font-medium text-slate-800">{a.date}</span>
                      <span className="font-mono font-bold px-2 py-0.5 rounded bg-amber-100 text-amber-900 text-[11px]">
                        {a.shiftCode}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className="p-2.5 rounded-lg bg-white border border-slate-200 text-slate-600 text-[11px]" id="no-duties-affected-info" data-testid="no-duties-affected-info">
                ℹ️ No rostered duties are affected by this absence.
                <p className="text-slate-400 mt-0.5">
                  An administrative absence will be recorded without amending the operational roster.
                </p>
              </div>
            )}
          </div>

          {/* Shortage Workflow (Required when duties are affected) */}
          {hasShortage && (
            <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-300 space-y-3" id="shortage-warning-box">
              <div className="flex items-start gap-2">
                <span className="text-amber-600 text-base leading-none">⚠️</span>
                <div>
                  <p className="font-bold text-amber-900" id="shortage-warning-message" data-testid="shortage-warning-message">
                    This absence leaves {affectedAssignments.length} {affectedAssignments.length === 1 ? 'duty' : 'duties'} uncovered.
                  </p>
                  <p className="text-[11px] text-amber-800 mt-0.5">
                    Operational shortage acknowledgement is required by hospital roster policy.
                  </p>
                </div>
              </div>

              <div className="space-y-2 pt-1 border-t border-amber-200">
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    id="shortage-accept-checkbox"
                    data-testid="shortage-accept-checkbox"
                    checked={shortageAccepted}
                    onChange={(e) => setShortageAccepted(e.target.checked)}
                    disabled={isSubmitting}
                    className="mt-0.5 rounded border-amber-400 text-indigo-600 focus:ring-indigo-500"
                  />
                  <span className="font-bold text-amber-950 text-xs">
                    I acknowledge and accept this duty shortage
                  </span>
                </label>

                <div>
                  <label htmlFor="shortage-reason-input" className="block font-bold text-amber-900 mb-1">
                    Shortage Reason <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    id="shortage-reason-input"
                    data-testid="shortage-reason-input"
                    value={shortageReason}
                    onChange={(e) => setShortageReason(e.target.value)}
                    placeholder="e.g. Sudden medical emergency / short notice coverage"
                    disabled={isSubmitting}
                    className="w-full p-2 rounded-xl border border-amber-300 bg-white text-slate-800 text-xs focus:border-amber-500 focus:ring-1 focus:ring-amber-500 outline-none"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Admin Note (Optional, Admin Only) */}
          <div>
            <label htmlFor="absence-admin-note" className="block font-bold text-slate-700 mb-1">
              Admin Note <span className="text-slate-400 font-normal">(Private — visible to admins only)</span>
            </label>
            <textarea
              id="absence-admin-note"
              data-testid="absence-admin-note"
              rows={2}
              value={adminNote}
              onChange={(e) => setAdminNote(e.target.value)}
              placeholder="Optional administrative context or tracking notes..."
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
              id="btn-submit-absence"
              data-testid="btn-submit-absence"
              disabled={isSubmitting}
              className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 active:scale-95 text-white font-bold transition shadow-xs disabled:opacity-50 flex items-center gap-1.5"
            >
              {isSubmitting ? (
                <>
                  <span className="animate-spin text-sm">⏳</span>
                  <span>Recording absence…</span>
                </>
              ) : (
                <span>Confirm Absence</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
