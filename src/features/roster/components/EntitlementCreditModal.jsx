import React, { useState, useMemo, useEffect } from 'react';
import RosterEntitlement from '../goff.js';

/**
 * Entitlement Credit Modal (Phase 7 Slice 3):
 * Modal for authorized admins to:
 * 1. Credit GOFF based strictly on eligible displaced weekly OFF source.
 * 2. Credit GHKA based strictly on eligible public-holiday work (actual Current worker, max 1 per holiday).
 * 3. Add manual administrative adjustments (MO only, amount = 1, typed, reason code & admin note required).
 */
export default function EntitlementCreditModal({
  isOpen,
  onClose,
  initialMode = 'EARN_GOFF',
  personId,
  period,
  people = [],
  currentAssignments = [],
  plannedAssignments = [],
  existingTransactions = [],
  onEarnGoff,
  onEarnGhka,
  onCreditManual,
  isSubmitting = false,
  error = null
}) {
  const [mode, setMode] = useState(initialMode);
  const [prevInitialMode, setPrevInitialMode] = useState(initialMode);
  const [selectedDate, setSelectedDate] = useState('');
  const [manualType, setManualType] = useState('GOFF');
  const [manualDate, setManualDate] = useState('');
  const [manualReason, setManualReason] = useState('OPENING_BALANCE');
  const [adminNote, setAdminNote] = useState('');
  const [formError, setFormError] = useState(null);

  if (initialMode !== prevInitialMode) {
    setPrevInitialMode(initialMode);
    setMode(initialMode);
  }

  // Sync mode on modal open
  useEffect(() => {
    if (isOpen) {
      setMode(initialMode);
      setSelectedDate('');
      setManualType('GOFF');
      setManualDate(period ? `${period}-01` : new Date().toISOString().slice(0, 10));
      setManualReason('OPENING_BALANCE');
      setAdminNote('');
      setFormError(null);
    }
  }, [isOpen, initialMode, period]);

  // Lookup doctor
  const person = useMemo(() => {
    return people.find(p => (p.personId || p.PersonId) === personId) || null;
  }, [people, personId]);

  const personName = person?.name || person?.PersonNameSnapshot || personId;
  const isEp = person?.dutyDomain === 'EP' || person?.domain === 'EP' || person?.role === 'EP';

  // Confirmed credit dates for this person to prevent obvious duplicate UI creation
  const confirmedGoffDates = useMemo(() => {
    const dates = new Set();
    existingTransactions.forEach(tx => {
      const pId = tx.PersonId || tx.personId;
      const type = tx.EntitlementType || tx.entitlementType;
      const txType = tx.TransactionType || tx.transactionType;
      const date = tx.EffectiveDate || tx.effectiveDate || tx.date;
      if (pId === personId && type === 'GOFF' && txType === 'CREDIT' && date) {
        dates.add(date);
      }
    });
    return dates;
  }, [existingTransactions, personId]);

  const confirmedGhkaDates = useMemo(() => {
    const dates = new Set();
    existingTransactions.forEach(tx => {
      const pId = tx.PersonId || tx.personId;
      const type = tx.EntitlementType || tx.entitlementType;
      const txType = tx.TransactionType || tx.transactionType;
      const date = tx.EffectiveDate || tx.effectiveDate || tx.date || tx.HolidayDate || tx.holidayDate;
      if (pId === personId && type === 'GHKA' && txType === 'CREDIT' && date) {
        dates.add(date);
      }
    });
    return dates;
  }, [existingTransactions, personId]);

  // 1. Identify eligible displaced weekly OFFs
  const eligibleGoffSources = useMemo(() => {
    if (isEp || !personId) return [];

    const list = [];
    const plannedForPerson = plannedAssignments.filter(a => a.personId === personId);
    const currentForPerson = currentAssignments.filter(a => a.personId === personId);

    // Look for dates where Planned was OFF
    plannedForPerson.forEach(planned => {
      if (planned.shiftCode === 'OFF') {
        const cur = currentForPerson.find(c => c.date === planned.date);
        // Current must be a working assignment (not OFF, not absence)
        const isWorking = cur && cur.shiftCode && cur.shiftCode !== 'OFF' && cur.source !== 'ABSENCE' && cur.coverageStatus !== 'UNCOVERED';
        if (isWorking && !confirmedGoffDates.has(planned.date)) {
          list.push({
            date: planned.date,
            plannedShift: 'OFF',
            actualShift: cur.shiftCode,
            dutyDomain: cur.dutyDomain || 'MO',
            reason: 'Weekly OFF displaced'
          });
        }
      }
    });

    return list.sort((a, b) => a.date.localeCompare(b.date));
  }, [isEp, personId, plannedAssignments, currentAssignments, confirmedGoffDates]);

  // 2. Identify eligible public holiday duties
  const eligibleGhkaSources = useMemo(() => {
    if (isEp || !personId) return [];

    const map = new Map();
    // Actual current worker must be used (Requirement 6)
    const currentForPerson = currentAssignments.filter(a => a.personId === personId);

    currentForPerson.forEach(cur => {
      const holidayName = RosterEntitlement.getPublicHoliday(cur.date);
      const isWorking = cur.shiftCode && cur.shiftCode !== 'OFF' && cur.source !== 'ABSENCE' && cur.coverageStatus !== 'UNCOVERED';

      if (holidayName && isWorking && !confirmedGhkaDates.has(cur.date)) {
        // Max one GHKA per holiday date even if multiple shifts worked (AM + PM) (Requirement 7)
        if (!map.has(cur.date)) {
          map.set(cur.date, {
            date: cur.date,
            holidayName,
            actualShift: cur.shiftCode,
            dutyDomain: cur.dutyDomain || 'MO',
            personId,
            personName
          });
        }
      }
    });

    return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
  }, [isEp, personId, personName, currentAssignments, confirmedGhkaDates]);

  // Default selection when eligible sources change
  useEffect(() => {
    if (mode === 'EARN_GOFF' && eligibleGoffSources.length > 0 && !selectedDate) {
      setSelectedDate(eligibleGoffSources[0].date);
    } else if (mode === 'EARN_GHKA' && eligibleGhkaSources.length > 0 && !selectedDate) {
      setSelectedDate(eligibleGhkaSources[0].date);
    }
  }, [mode, eligibleGoffSources, eligibleGhkaSources, selectedDate]);

  if (!isOpen) return null;

  const handleSubmit = (e) => {
    e.preventDefault();
    setFormError(null);

    if (isEp) {
      setFormError('EP staff do not participate in entitlement accounting.');
      return;
    }

    if (mode === 'EARN_GOFF') {
      if (!selectedDate) {
        setFormError('Please select an eligible displaced weekly OFF.');
        return;
      }
      onEarnGoff?.({
        personId,
        date: selectedDate,
        adminNote: adminNote.trim()
      });
    } else if (mode === 'EARN_GHKA') {
      if (!selectedDate) {
        setFormError('Please select an eligible public holiday duty.');
        return;
      }
      onEarnGhka?.({
        personId,
        date: selectedDate,
        adminNote: adminNote.trim()
      });
    } else if (mode === 'MANUAL_CREDIT') {
      if (!manualDate) {
        setFormError('Please provide an effective date.');
        return;
      }
      if (!adminNote.trim()) {
        setFormError('Admin note is required for manual adjustments.');
        return;
      }
      onCreditManual?.({
        personId,
        entitlementType: manualType,
        amount: 1,
        effectiveDate: manualDate,
        reasonCode: manualReason,
        adminNote: adminNote.trim()
      });
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150"
      id="entitlement-credit-modal"
      data-testid="entitlement-credit-modal"
      role="dialog"
      aria-modal="true"
    >
      <div className="bg-white rounded-2xl shadow-xl border border-slate-200 max-w-lg w-full overflow-hidden flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
          <div>
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <span>{mode === 'MANUAL_CREDIT' ? '⚙️' : '➕'}</span>
              <span>
                {mode === 'MANUAL_CREDIT'
                  ? 'Manual Entitlement Adjustment'
                  : mode === 'EARN_GOFF'
                  ? 'Credit GOFF (Displaced Weekly OFF)'
                  : 'Credit GHKA (Public Holiday Work)'}
              </span>
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Staff: <strong className="text-slate-800">{personName}</strong>
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

        {/* Mode Selector Tabs */}
        <div className="px-4 pt-3 flex gap-2 border-b border-slate-100 bg-white">
          <button
            type="button"
            id="tab-mode-earn-goff"
            data-testid="tab-mode-earn-goff"
            onClick={() => { setMode('EARN_GOFF'); setSelectedDate(''); setFormError(null); }}
            className={`pb-2 text-xs font-bold border-b-2 transition ${
              mode === 'EARN_GOFF'
                ? 'border-teal-600 text-teal-800'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            Credit GOFF
          </button>
          <button
            type="button"
            id="tab-mode-earn-ghka"
            data-testid="tab-mode-earn-ghka"
            onClick={() => { setMode('EARN_GHKA'); setSelectedDate(''); setFormError(null); }}
            className={`pb-2 text-xs font-bold border-b-2 transition ${
              mode === 'EARN_GHKA'
                ? 'border-amber-600 text-amber-800'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            Credit GHKA
          </button>
          <button
            type="button"
            id="tab-mode-manual-credit"
            data-testid="tab-mode-manual-credit"
            onClick={() => { setMode('MANUAL_CREDIT'); setFormError(null); }}
            className={`pb-2 text-xs font-bold border-b-2 transition ${
              mode === 'MANUAL_CREDIT'
                ? 'border-indigo-600 text-indigo-800'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            Manual Adjustment
          </button>
        </div>

        {/* Modal Form */}
        <form onSubmit={handleSubmit} className="p-4 space-y-4 overflow-y-auto">
          {(formError || error) && (
            <div
              id="credit-modal-error"
              data-testid="credit-modal-error"
              className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700 font-medium"
              role="alert"
            >
              {formError || error}
            </div>
          )}

          {isEp ? (
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-center">
              <p className="text-xs font-bold text-slate-700">EP staff do not participate in entitlement accounting.</p>
            </div>
          ) : (
            <>
              {/* Mode 1: Credit GOFF (Displaced Weekly OFF) */}
              {mode === 'EARN_GOFF' && (
                <div className="space-y-3">
                  <div className="p-3 rounded-xl bg-teal-50/70 border border-teal-200 text-xs text-teal-900">
                    <p className="font-bold">Authoritative Displaced Weekly OFF Source</p>
                    <p className="text-[11px] text-teal-800 mt-0.5">
                      GOFF can only be credited when an MO's planned weekly rest day was displaced by actual working duty.
                    </p>
                  </div>

                  {eligibleGoffSources.length === 0 ? (
                    <div
                      id="no-eligible-goff-msg"
                      data-testid="no-eligible-goff-msg"
                      className="p-6 rounded-xl border border-dashed border-slate-200 text-center text-xs text-slate-500 bg-slate-50"
                    >
                      No eligible displaced weekly OFF found.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-slate-700">
                        Select Displaced Weekly OFF Event:
                      </label>
                      <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                        {eligibleGoffSources.map((item) => (
                          <label
                            key={item.date}
                            id={`option-goff-${item.date}`}
                            data-testid={`option-goff-${item.date}`}
                            className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition ${
                              selectedDate === item.date
                                ? 'bg-teal-50 border-teal-400 text-teal-950 shadow-2xs'
                                : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                            }`}
                          >
                            <input
                              type="radio"
                              name="eligible-goff-date"
                              value={item.date}
                              checked={selectedDate === item.date}
                              onChange={() => setSelectedDate(item.date)}
                              className="mt-0.5 text-teal-600 focus:ring-teal-500"
                            />
                            <div className="text-xs">
                              <div className="font-bold">Original OFF: {item.date}</div>
                              <div className="text-[11px] text-slate-600 mt-0.5">
                                Actual duty: <strong className="font-mono text-teal-800">{item.actualShift}</strong> ({item.dutyDomain})
                              </div>
                              <div className="text-[10px] text-slate-400 mt-0.5">
                                Reason: {item.reason}
                              </div>
                            </div>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Mode 2: Credit GHKA (Public Holiday Work) */}
              {mode === 'EARN_GHKA' && (
                <div className="space-y-3">
                  <div className="p-3 rounded-xl bg-amber-50/70 border border-amber-200 text-xs text-amber-900">
                    <p className="font-bold">Authoritative Public Holiday Work Source</p>
                    <p className="text-[11px] text-amber-800 mt-0.5">
                      GHKA can only be credited from actual working shifts performed on gazetted public holidays (max 1 GHKA per holiday).
                    </p>
                  </div>

                  {eligibleGhkaSources.length === 0 ? (
                    <div
                      id="no-eligible-ghka-msg"
                      data-testid="no-eligible-ghka-msg"
                      className="p-6 rounded-xl border border-dashed border-slate-200 text-center text-xs text-slate-500 bg-slate-50"
                    >
                      No eligible public holiday work found.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-slate-700">
                        Select Public Holiday Event:
                      </label>
                      <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                        {eligibleGhkaSources.map((item) => (
                          <label
                            key={item.date}
                            id={`option-ghka-${item.date}`}
                            data-testid={`option-ghka-${item.date}`}
                            className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition ${
                              selectedDate === item.date
                                ? 'bg-amber-50 border-amber-400 text-amber-950 shadow-2xs'
                                : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                            }`}
                          >
                            <input
                              type="radio"
                              name="eligible-ghka-date"
                              value={item.date}
                              checked={selectedDate === item.date}
                              onChange={() => setSelectedDate(item.date)}
                              className="mt-0.5 text-amber-600 focus:ring-amber-500"
                            />
                            <div className="text-xs">
                              <div className="font-bold">{item.holidayName}</div>
                              <div className="text-[11px] text-slate-600 mt-0.5">
                                Date: {item.date} | Actual duty: <strong className="font-mono text-amber-800">{item.actualShift}</strong> ({item.dutyDomain})
                              </div>
                              <div className="text-[10px] text-amber-700 font-semibold mt-0.5">
                                Eligible for 1 GHKA
                              </div>
                            </div>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Mode 3: Manual Credit */}
              {mode === 'MANUAL_CREDIT' && (
                <div className="space-y-3">
                  <div className="p-3 rounded-xl bg-indigo-50/70 border border-indigo-200 text-xs text-indigo-950">
                    <p className="font-bold">Manual entitlement adjustment</p>
                    <p className="text-[11px] text-indigo-800 mt-0.5">
                      Create an administrative credit for verified opening balances or special adjustments. Requires reason code and note.
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        Entitlement Type:
                      </label>
                      <select
                        id="select-manual-type"
                        data-testid="select-manual-type"
                        value={manualType}
                        onChange={(e) => setManualType(e.target.value)}
                        className="w-full text-xs font-bold py-1.5 px-2.5 rounded-xl border border-slate-300 bg-white"
                      >
                        <option value="GOFF">GOFF (Weekly OFF)</option>
                        <option value="GHKA">GHKA (Public Holiday)</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        Amount:
                      </label>
                      <input
                        type="number"
                        id="input-manual-amount"
                        data-testid="input-manual-amount"
                        value={1}
                        disabled
                        className="w-full text-xs font-bold py-1.5 px-2.5 rounded-xl border border-slate-200 bg-slate-100 text-slate-500 cursor-not-allowed"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Effective Date:
                    </label>
                    <input
                      type="date"
                      id="input-manual-date"
                      data-testid="input-manual-date"
                      value={manualDate}
                      onChange={(e) => setManualDate(e.target.value)}
                      className="w-full text-xs py-1.5 px-2.5 rounded-xl border border-slate-300 bg-white"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Reason Code:
                    </label>
                    <select
                      id="select-manual-reason"
                      data-testid="select-manual-reason"
                      value={manualReason}
                      onChange={(e) => setManualReason(e.target.value)}
                      className="w-full text-xs py-1.5 px-2.5 rounded-xl border border-slate-300 bg-white"
                    >
                      <option value="OPENING_BALANCE">Opening Balance Migration</option>
                      <option value="ADMINISTRATIVE_ADJUSTMENT">Administrative Adjustment</option>
                      <option value="SERVICE_COMPENSATION">Service Compensation</option>
                      <option value="OTHER">Other Certified Reason</option>
                    </select>
                  </div>
                </div>
              )}

              {/* Admin Note Input */}
              <div className="pt-2 border-t border-slate-100">
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Admin Note {mode === 'MANUAL_CREDIT' && <span className="text-rose-500">*</span>}:
                </label>
                <input
                  type="text"
                  id="input-credit-admin-note"
                  data-testid="input-credit-admin-note"
                  value={adminNote}
                  onChange={(e) => setAdminNote(e.target.value)}
                  placeholder={mode === 'MANUAL_CREDIT' ? 'Required justification for audit...' : 'Optional administrative context...'}
                  className="w-full text-xs py-1.5 px-2.5 rounded-xl border border-slate-300 bg-white focus:ring-2 focus:ring-indigo-500"
                  required={mode === 'MANUAL_CREDIT'}
                />
              </div>
            </>
          )}

          {/* Modal Actions */}
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
              id="btn-submit-credit"
              data-testid="btn-submit-credit"
              disabled={
                isSubmitting ||
                isEp ||
                (mode === 'EARN_GOFF' && eligibleGoffSources.length === 0) ||
                (mode === 'EARN_GHKA' && eligibleGhkaSources.length === 0) ||
                (mode === 'MANUAL_CREDIT' && !adminNote.trim())
              }
              className={`px-4 py-1.5 rounded-xl text-xs font-bold text-white transition shadow-2xs active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer ${
                mode === 'EARN_GOFF'
                  ? 'bg-teal-600 hover:bg-teal-700'
                  : mode === 'EARN_GHKA'
                  ? 'bg-amber-600 hover:bg-amber-700'
                  : 'bg-indigo-600 hover:bg-indigo-700'
              }`}
            >
              {isSubmitting
                ? 'Processing…'
                : mode === 'EARN_GOFF'
                ? 'Credit 1 GOFF'
                : mode === 'EARN_GHKA'
                ? 'Credit 1 GHKA'
                : 'Apply Manual Credit'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
