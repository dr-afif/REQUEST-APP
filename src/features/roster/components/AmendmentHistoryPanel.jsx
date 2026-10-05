import React, { useState } from 'react';

/**
 * Changes History Panel:
 * Shows chronological confirmed amendment/reversal history.
 * Groups SWAP lines into 1 logical entry.
 * Protects admin privacy boundary (no AdminNote for viewers).
 * Provides dependency-safe Reversal for authorized admins.
 */
export default function AmendmentHistoryPanel({
  events = [],
  isAdmin = false,
  onReverse,
  isReversing = false,
  reversalError = null
}) {
  const [selectedEventToReverse, setSelectedEventToReverse] = useState(null);
  const [reversalAdminNote, setReversalAdminNote] = useState('');
  const [actionError, setActionError] = useState(reversalError);

  const handleOpenReverseDialog = (ev) => {
    setSelectedEventToReverse(ev);
    setReversalAdminNote('');
    setActionError(null);
  };

  const handleConfirmReverse = async () => {
    if (!selectedEventToReverse) return;
    setActionError(null);
    try {
      await onReverse(selectedEventToReverse.EventId, reversalAdminNote);
      setSelectedEventToReverse(null);
    } catch (err) {
      const code = err.code || err.message;
      let userMsg = 'Failed to reverse event.';
      if (code === 'REVERSAL_DEPENDENCY_CONFLICT') {
        userMsg = 'Cannot reverse: a newer amendment depends on this assignment.';
      } else if (code === 'EVENT_ALREADY_REVERSED') {
        userMsg = 'This amendment has already been reversed.';
      } else if (code === 'CANNOT_REVERSE_REVERSAL') {
        userMsg = 'A reversal event cannot itself be reversed.';
      } else if (code === 'INVALID_STATE') {
        userMsg = 'Cannot reverse: period is closed or in an invalid state.';
      } else {
        userMsg = err.message || code;
      }
      setActionError(userMsg);
    }
  };

  return (
    <div className="space-y-4" aria-label="Amendment and Reversal History">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between p-4 rounded-2xl bg-purple-50/70 border border-purple-200 gap-2">
        <div>
          <h4 className="text-sm font-bold text-purple-900 flex items-center gap-2">
            <span>📜</span>
            <span>Confirmed Changes History</span>
          </h4>
          <p className="text-xs text-purple-700 mt-0.5">
            Append-only audit log of all confirmed amendments, swaps, and reversals.
          </p>
        </div>
        <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-purple-100 text-purple-800 self-start sm:self-auto">
          {events.length} {events.length === 1 ? 'event' : 'events'}
        </span>
      </div>

      {actionError && (
        <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700 font-medium" role="alert">
          <p className="font-bold">Reversal Blocked</p>
          <p id="reversal-error-banner">{actionError}</p>
        </div>
      )}

      {events.length === 0 ? (
        <div className="text-center py-12 rounded-2xl border border-dashed border-slate-300 bg-white">
          <p className="text-2xl mb-2">✨</p>
          <p className="text-sm font-semibold text-slate-700">No amendments recorded</p>
          <p className="text-xs text-slate-500 mt-1">
            This roster is identical to the originally published Planned Snapshot.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {events.map((ev) => {
            const isSwap = ev.EventType === 'SWAP';
            const isReversal = ev.EventType === 'REVERSAL';
            const isCorrection = ev.EventType === 'ADMIN_CORRECTION';
            const isReversed = Boolean(ev.isReversed);
            const canReverse = Boolean(isAdmin && !isReversed && !isReversal && ev.canReverse !== false);

            return (
              <div
                key={ev.EventId}
                id={`history-event-${ev.EventId}`}
                data-testid={`history-event-${ev.EventId}`}
                className={`p-4 rounded-2xl bg-white border transition shadow-2xs ${
                  isReversal
                    ? 'border-amber-200 bg-amber-50/30'
                    : isReversed
                    ? 'border-slate-200 opacity-80 bg-slate-50/50'
                    : 'border-slate-200'
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3 mb-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    {/* Event Type Badge */}
                    {isCorrection && (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-blue-100 text-blue-800">
                        <span>✏️</span> Correction
                      </span>
                    )}
                    {isSwap && (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-indigo-100 text-indigo-800">
                        <span>🔄</span> Swap
                      </span>
                    )}
                    {isReversal && (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-800">
                        <span>↩️</span> Reversal
                      </span>
                    )}

                    {isReversed && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-200 text-slate-700">
                        (Reversed)
                      </span>
                    )}

                    {/* Timestamp */}
                    <span className="text-xs text-slate-500">
                      {ev.CreatedAt ? new Date(ev.CreatedAt).toLocaleString() : 'Confirmed'}
                    </span>

                    {/* Actor (Admin only) */}
                    {isAdmin && ev.CreatedBy && (
                      <span className="text-[11px] text-slate-500 font-mono">
                        by {ev.CreatedBy}
                      </span>
                    )}
                  </div>

                  {/* Reverse Button for Admin */}
                  {isAdmin && !isReversal && (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        id={`btn-reverse-${ev.EventId}`}
                        data-testid={`btn-reverse-${ev.EventId}`}
                        disabled={!canReverse || isReversing}
                        onClick={() => handleOpenReverseDialog(ev)}
                        title={
                          isReversed
                            ? 'Event has already been reversed'
                            : ev.canReverse === false
                            ? (ev.reversalIneligibilityReason || 'Cannot reverse: newer dependency exists')
                            : 'Reverse this amendment'
                        }
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed transition shadow-2xs"
                      >
                        <span>↩️</span>
                        <span>Reverse</span>
                      </button>
                    </div>
                  )}
                </div>

                {/* Event Details */}
                {isReversal ? (
                  <div className="text-xs text-amber-900 bg-amber-100/60 p-2.5 rounded-xl border border-amber-200">
                    <p className="font-semibold">
                      Reverted change from Event #{ev.ReversesEventId || 'unknown'}.
                    </p>
                    {Array.isArray(ev.lines) && ev.lines.length > 0 && (
                      <ul className="mt-1 list-disc pl-4 space-y-0.5 text-[11px] text-amber-800">
                        {ev.lines.map((l, idx) => (
                          <li key={l.LineId || idx}>
                            {l.PersonNameSnapshot || l.PersonId} on {l.Date}: restored from <strong>{l.BeforeShiftCode || 'OFF'}</strong> → <strong>{l.AfterShiftCode || 'OFF'}</strong>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ) : isSwap ? (
                  <div className="text-xs text-slate-700 bg-slate-50 p-3 rounded-xl border border-slate-200 space-y-2">
                    <p className="font-semibold text-slate-800">Atomic Shift Swap:</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
                      {Array.isArray(ev.lines) && ev.lines.map((l, idx) => (
                        <div key={l.LineId || idx} className="p-2 rounded-lg bg-white border border-slate-200">
                          <p className="font-bold text-slate-800">{l.PersonNameSnapshot || l.PersonId}</p>
                          <p className="text-slate-500">Date: {l.Date} ({l.DutyDomain})</p>
                          <p className="mt-1 text-slate-700">
                            Shift: <span className="line-through text-slate-400">{l.BeforeShiftCode || 'OFF'}</span> → <strong className="text-indigo-700">{l.AfterShiftCode || 'OFF'}</strong>
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="text-xs text-slate-700 bg-slate-50 p-2.5 rounded-xl border border-slate-200">
                    {Array.isArray(ev.lines) && ev.lines.map((l, idx) => (
                      <div key={l.LineId || idx} className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <strong className="text-slate-900">{l.PersonNameSnapshot || l.PersonId}</strong>
                          <span className="text-slate-500 ml-2">on {l.Date} ({l.DutyDomain})</span>
                        </div>
                        <div className="text-xs">
                          <span className="line-through text-slate-400 mr-1.5">{l.BeforeShiftCode || 'OFF'}</span>
                          <span>→</span>
                          <strong className="text-indigo-700 ml-1.5">{l.AfterShiftCode || 'OFF'}</strong>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Public Reason & Admin Note */}
                <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-1.5 text-slate-600">
                    <span className="font-semibold">Reason:</span>
                    <span className="px-2 py-0.5 rounded-md bg-slate-100 border border-slate-200 text-slate-700 text-[11px]">
                      {ev.PublicReasonCode || 'ADMIN_CORRECTION'}
                    </span>
                  </div>

                  {/* Admin Note: NEVER render if non-admin viewer */}
                  {isAdmin && ev.AdminNote && (
                    <div className="flex items-center gap-1.5 text-slate-600 bg-amber-50/80 px-2 py-1 rounded-md border border-amber-200 text-[11px]">
                      <span className="text-amber-800 font-semibold">🔒 Admin Note:</span>
                      <span className="text-slate-800">{ev.AdminNote}</span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Reversal Confirmation Modal */}
      {selectedEventToReverse && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="reverse-modal-title"
        >
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl border border-slate-100 animate-fadeIn">
            <h3 id="reverse-modal-title" className="text-lg font-bold text-slate-800 mb-2">
              Reverse Amendment
            </h3>
            <p className="text-xs text-slate-600 mb-4">
              This will submit an authoritative append-only <strong>REVERSAL</strong> event that restores the affected assignment(s) to their state prior to Event #{selectedEventToReverse.EventId}.
            </p>

            <div className="mb-4">
              <label htmlFor="reversal-admin-note" className="block text-xs font-semibold text-slate-700 mb-1">
                Administrator Note (optional)
              </label>
              <input
                id="reversal-admin-note"
                type="text"
                value={reversalAdminNote}
                onChange={(e) => setReversalAdminNote(e.target.value)}
                placeholder="Reason for administrative reversal"
                disabled={isReversing}
                className="w-full rounded-lg border border-slate-300 p-2 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 disabled:opacity-50"
              />
            </div>

            <div className="flex justify-end gap-3 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setSelectedEventToReverse(null)}
                disabled={isReversing}
                className="px-4 py-2 rounded-lg text-sm font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                id="btn-confirm-reversal"
                onClick={handleConfirmReverse}
                disabled={isReversing}
                className="flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-bold bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-60 shadow-md shadow-amber-100"
              >
                {isReversing ? (
                  <>
                    <span className="h-4 w-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
                    Reversing…
                  </>
                ) : (
                  'Confirm Reversal'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
