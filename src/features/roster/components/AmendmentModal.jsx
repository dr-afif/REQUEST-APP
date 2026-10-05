import React, { useState, useEffect, useMemo } from 'react';

export const PHASE5_PUBLIC_REASONS = [
  { code: 'SHIFT_SWAP', label: 'Shift Swap' },
  { code: 'ADMIN_CORRECTION', label: 'Admin Correction' },
  { code: 'DUTY_COVERAGE', label: 'Duty Coverage' },
  { code: 'OPERATIONAL_CHANGE', label: 'Operational Change' },
  { code: 'OTHER', label: 'Other' },
];

export default function AmendmentModal({
  isOpen,
  onClose,
  onSubmit,
  targetCell,
  availableParticipants = [],
  isSubmitting = false,
  error = null
}) {
  const [activeTab, setActiveTab] = useState('ADMIN_CORRECTION');

  // Correction state
  const [newShiftCode, setNewShiftCode] = useState('');
  const [correctionReason, setCorrectionReason] = useState('ADMIN_CORRECTION');
  const [correctionAdminNote, setCorrectionAdminNote] = useState('');

  // Swap state
  const [participant2Key, setParticipant2Key] = useState('');
  const [swapReason, setSwapReason] = useState('SHIFT_SWAP');
  const [swapAdminNote, setSwapAdminNote] = useState('');

  const [validationError, setValidationError] = useState('');

  // Reset form when targetCell or isOpen changes
  useEffect(() => {
    if (isOpen && targetCell) {
      setActiveTab('ADMIN_CORRECTION');
      setNewShiftCode(targetCell.currentShiftCode || '');
      setCorrectionReason('ADMIN_CORRECTION');
      setCorrectionAdminNote('');
      setParticipant2Key('');
      setSwapReason('SHIFT_SWAP');
      setSwapAdminNote('');
      setValidationError('');
    }
  }, [isOpen, targetCell]);

  // Candidates for swap must strictly share the same DutyDomain
  const swapCandidates = useMemo(() => {
    if (!targetCell) return [];
    return availableParticipants
      .filter((p) => {
        // Enforce DutyDomain isolation
        if (p.dutyDomain !== targetCell.dutyDomain) return false;
        // Don't swap with exact same cell
        if (p.personId === targetCell.personId && p.date === targetCell.date) return false;
        return true;
      })
      .sort((a, b) => {
        return (a.date || '').localeCompare(b.date || '') ||
          (a.personNameSnapshot || '').localeCompare(b.personNameSnapshot || '');
      });
  }, [targetCell, availableParticipants]);

  const selectedParticipant2 = useMemo(() => {
    if (!participant2Key) return null;
    return swapCandidates.find(
      (c) => `${c.personId}::${c.date}::${c.dutyDomain}` === participant2Key
    ) || null;
  }, [participant2Key, swapCandidates]);

  if (!isOpen || !targetCell) return null;

  const handleSubmitCorrection = async () => {
    setValidationError('');
    if (!correctionReason) {
      setValidationError('PublicReasonCode is strictly required.');
      return;
    }
    const payload = {
      eventType: 'ADMIN_CORRECTION',
      personId: targetCell.personId,
      date: targetCell.date,
      dutyDomain: targetCell.dutyDomain,
      afterAssignments: newShiftCode.trim() ? [{ shiftCode: newShiftCode.trim() }] : [],
      publicReasonCode: correctionReason,
      adminNote: correctionAdminNote.trim()
    };
    await onSubmit(payload);
  };

  const handleSubmitSwap = async () => {
    setValidationError('');
    if (!selectedParticipant2) {
      setValidationError('Please select Participant 2 to complete the swap.');
      return;
    }
    if (!swapReason) {
      setValidationError('PublicReasonCode is strictly required.');
      return;
    }
    const payload = {
      eventType: 'SWAP',
      person1: {
        personId: targetCell.personId,
        date: targetCell.date,
        dutyDomain: targetCell.dutyDomain
      },
      person2: {
        personId: selectedParticipant2.personId,
        date: selectedParticipant2.date,
        dutyDomain: selectedParticipant2.dutyDomain
      },
      publicReasonCode: swapReason,
      adminNote: swapAdminNote.trim()
    };
    await onSubmit(payload);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="amendment-modal-title"
    >
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl border border-slate-100 animate-fadeIn">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 mb-4 border-b border-slate-100">
          <div>
            <h3 id="amendment-modal-title" className="text-lg font-bold text-slate-800">
              Amend Roster Assignment
            </h3>
            <p className="text-xs text-slate-500">
              Authoritative V2 Amendment Workflow — {targetCell.date} ({targetCell.dutyDomain})
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100"
          >
            ✕
          </button>
        </div>

        {/* Tab Switcher: Correction vs Swap */}
        <div className="flex rounded-xl bg-slate-100 p-1 mb-4" role="tablist">
          <button
            type="button"
            role="tab"
            id="tab-admin-correction"
            aria-selected={activeTab === 'ADMIN_CORRECTION'}
            onClick={() => setActiveTab('ADMIN_CORRECTION')}
            className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition ${
              activeTab === 'ADMIN_CORRECTION'
                ? 'bg-white text-indigo-700 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            ✏️ Admin Correction
          </button>
          <button
            type="button"
            role="tab"
            id="tab-swap-assignments"
            aria-selected={activeTab === 'SWAP'}
            onClick={() => setActiveTab('SWAP')}
            className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition ${
              activeTab === 'SWAP'
                ? 'bg-white text-indigo-700 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            🔄 Shift Swap
          </button>
        </div>

        {/* Target Details Header */}
        <div className="mb-4 p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs">
          <div className="flex items-center justify-between font-semibold text-slate-800 mb-1">
            <span>Target: {targetCell.personNameSnapshot}</span>
            <span className="px-2 py-0.5 rounded-full bg-slate-200 text-slate-700 font-mono text-[10px]">
              {targetCell.dutyDomain}
            </span>
          </div>
          <div className="flex items-center justify-between text-slate-600">
            <span>Date: {targetCell.date}</span>
            <span>Current: <strong className="text-slate-900">{targetCell.currentShiftCode || 'None'}</strong></span>
          </div>
        </div>

        {/* Form Body */}
        {activeTab === 'ADMIN_CORRECTION' ? (
          <div className="space-y-4">
            <div>
              <label htmlFor="correction-new-shift" className="block text-xs font-semibold text-slate-700 mb-1">
                New Assignment / Shift Code
              </label>
              <input
                id="correction-new-shift"
                type="text"
                value={newShiftCode}
                onChange={(e) => setNewShiftCode(e.target.value)}
                placeholder="e.g. M, AM, PM, ON1, ON2, OFF (leave blank to clear)"
                disabled={isSubmitting}
                className="w-full rounded-lg border border-slate-300 p-2 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 disabled:opacity-50"
              />
            </div>

            <div>
              <label htmlFor="correction-public-reason" className="block text-xs font-semibold text-slate-700 mb-1">
                Public Reason <span className="text-rose-500">*</span>
              </label>
              <select
                id="correction-public-reason"
                value={correctionReason}
                onChange={(e) => setCorrectionReason(e.target.value)}
                disabled={isSubmitting}
                className="w-full rounded-lg border border-slate-300 p-2 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 disabled:opacity-50"
              >
                {PHASE5_PUBLIC_REASONS.map((r) => (
                  <option key={r.code} value={r.code}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label htmlFor="correction-admin-note" className="block text-xs font-semibold text-slate-700">
                  Administrator Note (optional)
                </label>
                <span className="text-[10px] font-semibold text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">
                  🔒 Private / Admin-only
                </span>
              </div>
              <textarea
                id="correction-admin-note"
                rows={2}
                value={correctionAdminNote}
                onChange={(e) => setCorrectionAdminNote(e.target.value)}
                placeholder="Internal audit note; visible to administrators only"
                disabled={isSubmitting}
                className="w-full rounded-lg border border-slate-300 p-2 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 disabled:opacity-50"
              />
            </div>

            {/* Confirmation Preview */}
            <div className="p-3 rounded-xl bg-indigo-50/70 border border-indigo-100 text-xs space-y-1">
              <p className="font-bold text-indigo-900 mb-1">Confirmation Summary:</p>
              <div className="flex justify-between text-slate-700">
                <span>Before:</span>
                <span className="font-semibold">{targetCell.currentShiftCode || 'None'}</span>
              </div>
              <div className="flex justify-between text-slate-700">
                <span>After:</span>
                <span className="font-bold text-indigo-800">{newShiftCode.trim() || '(Clear)'}</span>
              </div>
              <div className="flex justify-between text-slate-700">
                <span>Public reason:</span>
                <span>{PHASE5_PUBLIC_REASONS.find(r => r.code === correctionReason)?.label}</span>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label htmlFor="swap-participant2-select" className="block text-xs font-semibold text-slate-700 mb-1">
                Select Participant 2 to Swap With ({targetCell.dutyDomain} domain) <span className="text-rose-500">*</span>
              </label>
              <select
                id="swap-participant2-select"
                value={participant2Key}
                onChange={(e) => setParticipant2Key(e.target.value)}
                disabled={isSubmitting}
                className="w-full rounded-lg border border-slate-300 p-2 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 disabled:opacity-50"
              >
                <option value="">-- Choose doctor / date --</option>
                {swapCandidates.map((c) => {
                  const key = `${c.personId}::${c.date}::${c.dutyDomain}`;
                  return (
                    <option key={key} value={key}>
                      {c.date} — {c.personNameSnapshot} ({c.currentShiftCode || 'OFF'})
                    </option>
                  );
                })}
              </select>
            </div>

            <div>
              <label htmlFor="swap-public-reason" className="block text-xs font-semibold text-slate-700 mb-1">
                Public Reason <span className="text-rose-500">*</span>
              </label>
              <select
                id="swap-public-reason"
                value={swapReason}
                onChange={(e) => setSwapReason(e.target.value)}
                disabled={isSubmitting}
                className="w-full rounded-lg border border-slate-300 p-2 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 disabled:opacity-50"
              >
                {PHASE5_PUBLIC_REASONS.map((r) => (
                  <option key={r.code} value={r.code}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label htmlFor="swap-admin-note" className="block text-xs font-semibold text-slate-700">
                  Administrator Note (optional)
                </label>
                <span className="text-[10px] font-semibold text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">
                  🔒 Private / Admin-only
                </span>
              </div>
              <textarea
                id="swap-admin-note"
                rows={2}
                value={swapAdminNote}
                onChange={(e) => setSwapAdminNote(e.target.value)}
                placeholder="Internal audit note for swap; visible to administrators only"
                disabled={isSubmitting}
                className="w-full rounded-lg border border-slate-300 p-2 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 disabled:opacity-50"
              />
            </div>

            {/* Confirmation Preview */}
            {selectedParticipant2 && (
              <div className="p-3 rounded-xl bg-indigo-50/70 border border-indigo-100 text-xs space-y-1.5">
                <p className="font-bold text-indigo-900 mb-1">Swap Confirmation Summary:</p>
                <div className="text-slate-700">
                  <p className="font-semibold text-slate-800">Before:</p>
                  <ul className="list-disc pl-4 text-[11px] text-slate-600">
                    <li>{targetCell.personNameSnapshot} on {targetCell.date}: <strong>{targetCell.currentShiftCode || 'OFF'}</strong></li>
                    <li>{selectedParticipant2.personNameSnapshot} on {selectedParticipant2.date}: <strong>{selectedParticipant2.currentShiftCode || 'OFF'}</strong></li>
                  </ul>
                </div>
                <div className="text-slate-700">
                  <p className="font-semibold text-indigo-900">After Swap:</p>
                  <ul className="list-disc pl-4 text-[11px] text-indigo-800 font-medium">
                    <li>{targetCell.personNameSnapshot}: gets <strong>{selectedParticipant2.currentShiftCode || 'OFF'}</strong> (from {selectedParticipant2.date})</li>
                    <li>{selectedParticipant2.personNameSnapshot}: gets <strong>{targetCell.currentShiftCode || 'OFF'}</strong> (from {targetCell.date})</li>
                  </ul>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Validation or Submission Errors */}
        {(validationError || error) && (
          <div className="mt-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700" role="alert">
            <p className="font-bold">Cannot proceed</p>
            <p id="amendment-error-message">{validationError || error}</p>
          </div>
        )}

        {/* Action Footer */}
        <div className="mt-6 flex justify-end gap-3 pt-3 border-t border-slate-100">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="px-4 py-2 rounded-lg text-sm font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-50"
          >
            Cancel
          </button>

          {activeTab === 'ADMIN_CORRECTION' ? (
            <button
              type="button"
              id="btn-confirm-amendment"
              onClick={handleSubmitCorrection}
              disabled={isSubmitting}
              className="flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-bold bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-60 shadow-md shadow-indigo-100"
            >
              {isSubmitting ? (
                <>
                  <span className="h-4 w-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
                  Saving…
                </>
              ) : (
                'Confirm Amendment'
              )}
            </button>
          ) : (
            <button
              type="button"
              id="btn-confirm-swap"
              onClick={handleSubmitSwap}
              disabled={isSubmitting || !selectedParticipant2}
              className="flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-bold bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-60 shadow-md shadow-indigo-100"
            >
              {isSubmitting ? (
                <>
                  <span className="h-4 w-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
                  Saving Swap…
                </>
              ) : (
                'Confirm Swap'
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
