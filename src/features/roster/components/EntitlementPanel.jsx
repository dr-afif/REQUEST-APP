import React, { useMemo } from 'react';
import RosterEntitlement from '../goff.js';

/**
 * Entitlement Panel (Phase 7 Slice 3):
 * Contained entitlement ledger panel for Medical Officers (MO).
 * Strictly separates GOFF and GHKA balances (never pooled).
 * Excludes EP staff (displays non-participating status, no balance or mutation controls).
 * Exposes authoritative ledger transactions and provenance.
 * Private admin notes are scrubbed for viewers.
 */
export default function EntitlementPanel({
  people = [],
  selectedPersonId,
  onSelectPersonId,
  balances = { GOFF: 0, GHKA: 0 },
  transactions = [],
  isAdmin = false,
  period,
  onOpenCreditModal,
  onReverseConsumption,
  onReverseCredit,
  isReversing = false,
  error = null
}) {
  const activePersonId = selectedPersonId || people.find(p => p.dutyDomain !== 'EP' && p.role !== 'EP')?.personId || people[0]?.personId;

  // Lookup selected person record
  const selectedPerson = useMemo(() => {
    return people.find(p => (p.personId || p.PersonId) === activePersonId) || null;
  }, [people, activePersonId]);

  const personName = selectedPerson?.name || selectedPerson?.PersonNameSnapshot || activePersonId;
  const isEp = selectedPerson?.dutyDomain === 'EP' || selectedPerson?.domain === 'EP' || selectedPerson?.role === 'EP';

  // Format date helper
  const formatDate = (dateStr) => {
    if (!dateStr) return '';
    const parts = dateStr.split('-');
    if (parts.length === 3) {
      const d = new Date(dateStr);
      if (!isNaN(d.getTime())) {
        return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
      }
    }
    return dateStr;
  };

  // Check if credit has been consumed (prevent dependent credit reversal)
  const canReverseCredit = (tx) => {
    const type = tx.EntitlementType;
    const available = Number(balances?.[type] || 0);
    // If available balance is less than 1, this credit or part of balance has been used
    return available >= 1;
  };

  if (!isAdmin) {
    return (
      <div
        id="entitlement-panel"
        data-testid="entitlement-panel"
        className="p-6 rounded-2xl bg-white border border-slate-200 shadow-2xs space-y-3 text-center"
      >
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-slate-100 text-slate-500 text-xl mx-auto">
          🔒
        </div>
        <h3 className="text-sm font-bold text-slate-800">
          Entitlement Ledger Restricted
        </h3>
        <p className="text-xs text-slate-600 max-w-md mx-auto">
          Administrator authorization is required to browse staff entitlement balances and transaction history.
          Duty status (GOFF, GHKA, HKA) is displayed on the working roster.
        </p>
      </div>
    );
  }

  return (
    <div
      id="entitlement-panel"
      data-testid="entitlement-panel"
      className="space-y-4 p-4 rounded-2xl bg-white border border-slate-200 shadow-2xs"
    >
      {/* Header and MO / EP Selector */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-3 border-b border-slate-100">
        <div>
          <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <span>⚖️</span>
            <span>Entitlement Accounting Ledger</span>
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Authoritative GOFF & GHKA balances and transaction history for Medical Officers.
          </p>
        </div>

        {/* Doctor Selector */}
        <div className="flex items-center gap-2">
          <label htmlFor="entitlement-person-select" className="text-xs font-semibold text-slate-600">
            Staff:
          </label>
          <select
            id="entitlement-person-select"
            data-testid="entitlement-person-select"
            value={selectedPersonId || ''}
            onChange={(e) => onSelectPersonId?.(e.target.value)}
            className="text-xs font-bold py-1.5 px-2.5 rounded-xl border border-slate-300 bg-white text-slate-800 shadow-2xs focus:ring-2 focus:ring-indigo-500 focus:outline-none"
          >
            {people.map(p => {
              const id = p.personId || p.PersonId;
              const name = p.name || p.PersonNameSnapshot || id;
              const domain = p.dutyDomain || p.domain || (p.role === 'EP' ? 'EP' : 'MO');
              return (
                <option key={id} value={id}>
                  {name} ({domain})
                </option>
              );
            })}
          </select>
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700 font-medium" role="alert">
          <p className="font-bold">Notice</p>
          <p>{error}</p>
        </div>
      )}

      {/* EP Exclusion Notice: Non-participating state */}
      {isEp ? (
        <div
          id="ep-non-participating-notice"
          data-testid="ep-non-participating-notice"
          className="p-6 rounded-xl bg-slate-50 border border-dashed border-slate-300 text-center space-y-2"
        >
          <div className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-slate-200 text-slate-600 text-lg">
            🚫
          </div>
          <h4 className="text-sm font-bold text-slate-800">
            EP Staff (Non-participating)
          </h4>
          <p className="text-xs text-slate-600 max-w-md mx-auto">
            EP staff do not participate in entitlement accounting. GOFF and GHKA entitlements apply exclusively to Medical Officers (MO).
          </p>
        </div>
      ) : (
        <>
          {/* Balance Cards: Fundamental Separation (Never Pooled) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* GOFF Balance Card */}
            <div
              id="card-balance-goff"
              data-testid="card-balance-goff"
              className="p-4 rounded-xl bg-gradient-to-br from-teal-50/80 to-emerald-50/40 border border-teal-200 shadow-2xs space-y-2"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-teal-900 uppercase tracking-wider">
                  GOFF Entitlement
                </span>
                <span className="text-[10px] font-semibold text-teal-700 bg-teal-100/80 px-2 py-0.5 rounded-full border border-teal-200">
                  Weekly OFF Replacement
                </span>
              </div>
              <div className="flex items-baseline justify-between">
                <div>
                  <div
                    id="goff-balance-value"
                    className="text-2xl font-black text-teal-950 font-mono"
                    data-testid="goff-balance-value"
                  >
                    GOFF balance: {balances?.GOFF ?? 0}
                  </div>
                  <p className="text-[11px] text-teal-800/80 mt-0.5">
                    {balances?.GOFF ?? 0} available
                  </p>
                </div>
                <span className="text-xs font-semibold text-teal-700">
                  No expiry
                </span>
              </div>
            </div>

            {/* GHKA Balance Card */}
            <div
              id="card-balance-ghka"
              data-testid="card-balance-ghka"
              className="p-4 rounded-xl bg-gradient-to-br from-amber-50/80 to-yellow-50/40 border border-amber-200 shadow-2xs space-y-2"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-amber-900 uppercase tracking-wider">
                  GHKA Entitlement
                </span>
                <span className="text-[10px] font-semibold text-amber-700 bg-amber-100/80 px-2 py-0.5 rounded-full border border-amber-200">
                  Public Holiday Replacement
                </span>
              </div>
              <div className="flex items-baseline justify-between">
                <div>
                  <div
                    id="ghka-balance-value"
                    className="text-2xl font-black text-amber-950 font-mono"
                    data-testid="ghka-balance-value"
                  >
                    GHKA balance: {balances?.GHKA ?? 0}
                  </div>
                  <p className="text-[11px] text-amber-800/80 mt-0.5">
                    {balances?.GHKA ?? 0} available
                  </p>
                </div>
                <span className="text-xs font-semibold text-amber-700">
                  No expiry
                </span>
              </div>
            </div>
          </div>

          {/* Admin Mutation Actions */}
          {isAdmin && (
            <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100">
              <span className="text-xs font-bold text-slate-500 mr-1">Actions:</span>
              <button
                type="button"
                id="btn-credit-goff"
                data-testid="btn-credit-goff"
                onClick={() => onOpenCreditModal?.({ mode: 'EARN_GOFF', personId: activePersonId })}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-teal-600 text-white hover:bg-teal-700 active:scale-95 transition shadow-2xs cursor-pointer"
              >
                <span>➕</span>
                <span>Credit GOFF</span>
              </button>

              <button
                type="button"
                id="btn-credit-ghka"
                data-testid="btn-credit-ghka"
                onClick={() => onOpenCreditModal?.({ mode: 'EARN_GHKA', personId: activePersonId })}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-amber-600 text-white hover:bg-amber-700 active:scale-95 transition shadow-2xs cursor-pointer"
              >
                <span>➕</span>
                <span>Credit GHKA</span>
              </button>

              <button
                type="button"
                id="btn-manual-credit"
                data-testid="btn-manual-credit"
                onClick={() => onOpenCreditModal?.({ mode: 'MANUAL_CREDIT', personId: activePersonId })}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-white text-indigo-700 border border-indigo-200 hover:bg-indigo-50 active:scale-95 transition shadow-2xs cursor-pointer ml-auto"
              >
                <span>⚙️</span>
                <span>Manual Adjustment</span>
              </button>
            </div>
          )}

          {/* Transaction History Section */}
          <div className="space-y-3 pt-3 border-t border-slate-100">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                Transaction History
              </h4>
              <span className="text-[11px] text-slate-500 font-medium">
                {transactions.length} record{transactions.length === 1 ? '' : 's'}
              </span>
            </div>

            {transactions.length === 0 ? (
              <div
                id="empty-transactions-message"
                data-testid="empty-transactions-message"
                className="text-center py-8 rounded-xl border border-dashed border-slate-200 bg-slate-50/50"
              >
                <p className="text-xs text-slate-500">No entitlement transactions recorded for {personName}.</p>
              </div>
            ) : (
              <div
                id="transactions-list"
                data-testid="transactions-list"
                className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden bg-white"
              >
                {transactions.map((tx) => {
                  const txId = tx.TransactionId || tx.transactionId;
                  const type = tx.EntitlementType || tx.entitlementType;
                  const txType = tx.TransactionType || tx.transactionType;
                  const sourceType = tx.SourceType || tx.sourceType;
                  const date = tx.EffectiveDate || tx.effectiveDate || tx.date;
                  const amount = Number(tx.Amount ?? tx.amount ?? 1);
                  const reasonCode = tx.ReasonCode || tx.reasonCode;
                  const adminNote = tx.AdminNote || tx.adminNote;
                  const holidayName = tx.HolidayName || tx.holidayName;
                  const holidayDate = tx.HolidayDate || tx.holidayDate;

                  const isCredit = txType === 'CREDIT';
                  const isConsumption = txType === 'CONSUMPTION';
                  const isCreditReversal = txType === 'CREDIT_REVERSAL';
                  const isConsumptionReversal = txType === 'CONSUMPTION_REVERSAL';

                  // Title and provenance
                  let badgeColor = type === 'GOFF' ? 'bg-teal-100 text-teal-800 border-teal-300' : 'bg-amber-100 text-amber-900 border-amber-300';
                  let displayAmount = isCredit || isConsumptionReversal ? `+${amount}` : `-${amount}`;
                  let amountColor = isCredit || isConsumptionReversal ? 'text-emerald-700' : 'text-slate-700';

                  let title = '';
                  let description = '';

                  if (isCredit) {
                    if (sourceType === 'DISPLACED_OFF') {
                      title = 'Earned — displaced weekly OFF';
                      description = `Displaced weekly rest day on ${formatDate(date)}`;
                    } else if (sourceType === 'PUBLIC_HOLIDAY') {
                      title = 'Earned — worked public holiday';
                      description = `Worked on ${holidayName || 'Public Holiday'}${holidayDate ? ` (${formatDate(holidayDate)})` : ''}`;
                    } else if (sourceType === 'MANUAL') {
                      title = 'Manual entitlement adjustment';
                      description = `Reason: ${reasonCode || 'Administrative Adjustment'}`;
                    } else {
                      title = `Credit ${type}`;
                    }
                  } else if (isConsumption) {
                    title = `${type} taken`;
                    description = `Entitlement duty on ${formatDate(date)}`;
                  } else if (isConsumptionReversal) {
                    title = 'Consumption reversal';
                    description = `Returned 1 ${type} to balance`;
                  } else if (isCreditReversal) {
                    title = 'Credit reversal';
                    description = `Deducted 1 ${type} from balance`;
                  }

                  const creditHasDependent = isCredit && !canReverseCredit(tx);

                  return (
                    <div
                      key={txId}
                      id={`tx-row-${txId}`}
                      data-testid={`tx-row-${txId}`}
                      className="p-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 hover:bg-slate-50/60 transition"
                    >
                      <div className="flex items-start gap-2.5">
                        <span
                          id={`tx-type-${txId}`}
                          className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-extrabold border font-mono ${badgeColor}`}
                          data-testid={`tx-type-${txId}`}
                        >
                          {type}
                        </span>
                        <div>
                          <div className="flex items-center gap-2">
                            <span id={`tx-title-${txId}`} className="text-xs font-bold text-slate-800" data-testid={`tx-title-${txId}`}>
                              {title}
                            </span>
                            <span id={`tx-amount-${txId}`} className={`text-xs font-black font-mono ${amountColor}`} data-testid={`tx-amount-${txId}`}>
                              {displayAmount} {type}
                            </span>
                          </div>
                          {description && (
                            <p id={`tx-desc-${txId}`} className="text-[11px] text-slate-600 mt-0.5" data-testid={`tx-desc-${txId}`}>
                              {description}
                            </p>
                          )}
                          <div className="flex items-center gap-3 mt-1 text-[10px] text-slate-400">
                            <span>Date: {formatDate(date)}</span>
                            {/* Privacy: AdminNote visible to authorized admin ONLY */}
                            {isAdmin && adminNote && (
                              <span id={`tx-admin-note-${txId}`} className="text-slate-500 font-mono italic" data-testid={`tx-admin-note-${txId}`}>
                                Note: {adminNote}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Reversal Actions for Admin */}
                      {isAdmin && (
                        <div className="self-end sm:self-center flex items-center gap-1.5">
                          {isConsumption && onReverseConsumption && (
                            <button
                              type="button"
                              id={`btn-reverse-consumption-${txId}`}
                              data-testid={`btn-reverse-consumption-${txId}`}
                              disabled={isReversing}
                              onClick={() => onReverseConsumption(tx)}
                              className="px-2 py-1 text-[11px] font-bold text-rose-700 bg-white hover:bg-rose-50 border border-rose-200 rounded-lg shadow-2xs transition active:scale-95 disabled:opacity-50 cursor-pointer"
                            >
                              Reverse usage
                            </button>
                          )}

                          {isCredit && onReverseCredit && (
                            <div>
                              <button
                                type="button"
                                id={`btn-reverse-credit-${txId}`}
                                data-testid={`btn-reverse-credit-${txId}`}
                                disabled={isReversing || creditHasDependent}
                                onClick={() => onReverseCredit(tx)}
                                title={creditHasDependent ? 'This credit has already been used. Reverse the dependent consumption first.' : `Reverse this ${type} credit`}
                                className="px-2 py-1 text-[11px] font-bold text-slate-700 bg-white hover:bg-slate-100 border border-slate-300 rounded-lg shadow-2xs transition active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                              >
                                Reverse credit
                              </button>
                              {creditHasDependent && (
                                <p
                                  id={`credit-dependent-warning-${txId}`}
                                  data-testid={`credit-dependent-warning-${txId}`}
                                  className="text-[10px] text-amber-700 mt-0.5 text-right font-medium"
                                >
                                  This credit has already been used. Reverse the dependent consumption first.
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
