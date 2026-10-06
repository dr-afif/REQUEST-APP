import React, { useState, useEffect } from 'react';

/**
 * Entitlement Consume Modal (Phase 7 Slice 3):
 * Modal for consuming GOFF or GHKA for an eligible MO working duty.
 * Exposes current balance before confirmation.
 * Strictly separates GOFF and GHKA (no mutual substitution).
 * Validates against Phase 6 active absences (MC, EL, AL, COURSE).
 * Transitions lifecycle to AMENDED upon confirmation.
 */
export default function EntitlementConsumeModal({
  isOpen,
  onClose,
  targetDuty,
  balances = { GOFF: 0, GHKA: 0 },
  initialType = 'GOFF',
  absences = [],
  expectedRevision = 0,
  onConsume,
  isSubmitting = false,
  error = null
}) {
  const [entitlementType, setEntitlementType] = useState(initialType);
  const [prevInitialType, setPrevInitialType] = useState(initialType);
  const [adminNote, setAdminNote] = useState('');
  const [localError, setLocalError] = useState(null);

  if (initialType !== prevInitialType) {
    setPrevInitialType(initialType);
    setEntitlementType(initialType);
  }

  useEffect(() => {
    if (isOpen) {
      setEntitlementType(initialType);
      setAdminNote('');
      setLocalError(null);
    }
  }, [isOpen, initialType]);

  if (!isOpen || !targetDuty) return null;

  const personId = targetDuty.personId;
  const personName = targetDuty.personNameSnapshot || personId;
  const date = targetDuty.date;
  const currentShift = targetDuty.currentShiftCode;

  // Check Phase 6 conflict: active absence on same date for this person (Requirement 13)
  const conflictingAbsence = absences.find(a => {
    const aPersonId = a.PersonId || a.personId;
    const aStatus = a.Status || a.status;
    const aStart = a.StartDate || a.startDate;
    const aEnd = a.EndDate || a.endDate;
    if (aPersonId !== personId || aStatus !== 'ACTIVE') return false;
    return date >= aStart && date <= aEnd;
  }) || (targetDuty.absenceType ? { AbsenceType: targetDuty.absenceType } : null) ||
  (targetDuty.source === 'ABSENCE' ? { AbsenceType: currentShift } : null);

  const hasAbsenceConflict = Boolean(conflictingAbsence);

  // Check balance
  const goffBalance = Number(balances?.GOFF || 0);
  const ghkaBalance = Number(balances?.GHKA || 0);
  const currentTypeBalance = entitlementType === 'GOFF' ? goffBalance : ghkaBalance;
  const hasZeroBalance = currentTypeBalance <= 0;

  const handleSubmit = (e) => {
    e.preventDefault();
    setLocalError(null);

    if (hasAbsenceConflict) {
      setLocalError('This duty currently has an active absence and cannot be changed to GOFF/GHKA.');
      return;
    }

    if (hasZeroBalance) {
      setLocalError(
        entitlementType === 'GOFF'
          ? 'No GOFF entitlement available.'
          : 'No GHKA entitlement available.'
      );
      return;
    }

    onConsume?.({
      personId,
      entitlementType,
      date,
      expectedRevision,
      adminNote: adminNote.trim()
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150"
      id="entitlement-consume-modal"
      data-testid="entitlement-consume-modal"
      role="dialog"
      aria-modal="true"
    >
      <div className="bg-white rounded-2xl shadow-xl border border-slate-200 max-w-md w-full overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
          <div>
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <span>🏖️</span>
              <span>Use Entitlement Day Off</span>
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Apply GOFF or GHKA to replace scheduled working duty.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 font-bold text-sm cursor-pointer p-1 rounded-lg hover:bg-slate-200/50"
          >
            ✕
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {/* Target Duty Summary */}
          <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-1">
            <div className="text-xs text-slate-500">Target Assignment:</div>
            <div className="text-sm font-bold text-slate-900">{personName}</div>
            <div className="text-xs text-slate-700 flex items-center gap-2">
              <span>Date: <strong>{date}</strong></span>
              <span>•</span>
              <span>Current Shift: <strong className="font-mono text-indigo-700">{currentShift}</strong></span>
            </div>
          </div>

          {/* Phase 6 Conflict Error */}
          {hasAbsenceConflict && (
            <div
              id="absence-conflict-error"
              data-testid="absence-conflict-error"
              className="p-3 rounded-xl bg-rose-50 border border-rose-300 text-xs text-rose-800 font-medium"
              role="alert"
            >
              <p className="font-bold">Operational Conflict</p>
              <p>This duty currently has an active absence and cannot be changed to GOFF/GHKA.</p>
            </div>
          )}

          {/* Backend / Local Errors */}
          {(localError || error) && !hasAbsenceConflict && (
            <div
              id="consume-modal-error"
              data-testid="consume-modal-error"
              className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700 font-medium"
              role="alert"
            >
              {localError || error}
            </div>
          )}

          {/* Entitlement Type Selector */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5">
              Select Entitlement Type:
            </label>
            <div className="grid grid-cols-2 gap-3">
              {/* GOFF Option */}
              <button
                type="button"
                id="select-consume-goff"
                data-testid="select-consume-goff"
                onClick={() => { setEntitlementType('GOFF'); setLocalError(null); }}
                className={`p-3 rounded-xl border text-left transition cursor-pointer ${
                  entitlementType === 'GOFF'
                    ? 'bg-teal-50 border-teal-400 text-teal-950 ring-2 ring-teal-500/20'
                    : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                }`}
              >
                <div className="text-xs font-bold text-teal-900">GOFF</div>
                <div className="text-[11px] text-teal-700 mt-0.5">Weekly OFF Replacement</div>
                <div
                  id="consume-modal-goff-balance"
                  className="text-xs font-black font-mono mt-1"
                  data-testid="consume-modal-goff-balance"
                >
                  GOFF available: {goffBalance}
                </div>
              </button>

              {/* GHKA Option */}
              <button
                type="button"
                id="select-consume-ghka"
                data-testid="select-consume-ghka"
                onClick={() => { setEntitlementType('GHKA'); setLocalError(null); }}
                className={`p-3 rounded-xl border text-left transition cursor-pointer ${
                  entitlementType === 'GHKA'
                    ? 'bg-amber-50 border-amber-400 text-amber-950 ring-2 ring-amber-500/20'
                    : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                }`}
              >
                <div className="text-xs font-bold text-amber-900">GHKA</div>
                <div className="text-[11px] text-amber-700 mt-0.5">Public Holiday Replacement</div>
                <div
                  id="consume-modal-ghka-balance"
                  className="text-xs font-black font-mono mt-1"
                  data-testid="consume-modal-ghka-balance"
                >
                  GHKA available: {ghkaBalance}
                </div>
              </button>
            </div>
          </div>

          {/* Zero Balance Warning */}
          {hasZeroBalance && !hasAbsenceConflict && (
            <div
              id="zero-balance-warning"
              data-testid="zero-balance-warning"
              className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900"
            >
              <p className="font-bold">
                {entitlementType === 'GOFF'
                  ? 'No GOFF entitlement available.'
                  : 'No GHKA entitlement available.'}
              </p>
              <p className="text-[11px] text-amber-800 mt-0.5">
                GOFF and GHKA are independent entitlements and cannot substitute for each other.
              </p>
            </div>
          )}

          {/* Admin Note Input */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Admin Note (Optional):
            </label>
            <input
              type="text"
              id="input-consume-admin-note"
              data-testid="input-consume-admin-note"
              value={adminNote}
              onChange={(e) => setAdminNote(e.target.value)}
              placeholder="Reason or operational context for taking entitlement day..."
              className="w-full text-xs py-1.5 px-2.5 rounded-xl border border-slate-300 bg-white focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-3 py-1.5 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              id="btn-confirm-consume"
              data-testid="btn-confirm-consume"
              disabled={isSubmitting || hasAbsenceConflict || hasZeroBalance}
              className={`px-4 py-1.5 rounded-xl text-xs font-bold text-white transition shadow-2xs active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer ${
                entitlementType === 'GOFF'
                  ? 'bg-teal-600 hover:bg-teal-700'
                  : 'bg-amber-600 hover:bg-amber-700'
              }`}
            >
              {isSubmitting ? 'Applying…' : `Use 1 ${entitlementType}`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
