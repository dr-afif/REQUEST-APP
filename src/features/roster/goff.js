import RosterCompatibility from './compatibility.js';
import RosterLifecycle from './lifecycle.js';

/**
 * Phase 7 GOFF Entitlement, Credit & Consumption Domain Foundation.
 * Pure deterministic contracts, schemas, validations, and balance derivation.
 * No UI, no direct I/O, no network calls.
 */
const RosterGoff = (() => {
  const freeze = value => {
    if (value && typeof value === 'object') {
      Object.values(value).forEach(freeze);
      Object.freeze(value);
    }
    return value;
  };

  /**
   * 1. Canonical GOFF Transaction Types
   * Distinguishes credits, reservations, consumptions, and their reversals.
   */
  const GOFF_TRANSACTION_TYPES = freeze({
    CREDIT_EARNED: 'CREDIT_EARNED',                         // Automatically earned via qualifying public holiday or displaced OFF
    CREDIT_MANUAL: 'CREDIT_MANUAL',                         // Manually granted by administrator or opening balance
    CREDIT_REVERSAL: 'CREDIT_REVERSAL',                     // Compensating reversal of an earned or manual credit
    GOFF_RESERVED: 'GOFF_RESERVED',                         // Provisional reservation for a published future GOFF assignment
    GOFF_RESERVATION_RELEASED: 'GOFF_RESERVATION_RELEASED', // Released reservation if future GOFF is cancelled/amended
    GOFF_CONSUMED: 'GOFF_CONSUMED',                         // Confirmed consumption of a GOFF entitlement on a roster date
    CONSUMPTION_REVERSAL: 'CONSUMPTION_REVERSAL'            // Compensating reversal of consumed GOFF entitlement
  });

  /**
   * 2. Canonical GOFF Source Types
   * Describes the origin or qualifying event that produced the transaction.
   */
  const GOFF_SOURCE_TYPES = freeze({
    PUBLIC_HOLIDAY_DUTY: 'PUBLIC_HOLIDAY_DUTY',   // Working a qualifying duty on a gazetted public holiday
    DISPLACED_WEEKLY_OFF: 'DISPLACED_WEEKLY_OFF', // Planned normal OFF displaced by a qualifying duty / PN
    OPENING_BALANCE: 'OPENING_BALANCE',           // Pre-commencement confirmed opening balance
    ADMIN_ADJUSTMENT: 'ADMIN_ADJUSTMENT',         // Discretionary administrative credit or debit
    ROSTER_ASSIGNMENT: 'ROSTER_ASSIGNMENT'        // Operational consumption on a roster date
  });

  /**
   * 3. Record Statuses
   */
  const GOFF_TRANSACTION_STATUS = freeze({
    CONFIRMED: 'CONFIRMED',
    PENDING: 'PENDING',
    REVERSED: 'REVERSED',
    REJECTED: 'REJECTED'
  });

  /**
   * 4. Canonical Error Codes
   */
  const GOFF_ERRORS = freeze({
    INSUFFICIENT_GOFF_BALANCE: 'INSUFFICIENT_GOFF_BALANCE',
    INVALID_TRANSACTION_TYPE: 'INVALID_TRANSACTION_TYPE',
    INVALID_SOURCE_TYPE: 'INVALID_SOURCE_TYPE',
    INVALID_PERSON_ID: 'INVALID_PERSON_ID',
    INVALID_DUTY_DOMAIN: 'INVALID_DUTY_DOMAIN',
    INVALID_DATE: 'INVALID_DATE',
    DUPLICATE_CREDIT_SOURCE: 'DUPLICATE_CREDIT_SOURCE',
    TRANSACTION_NOT_FOUND: 'TRANSACTION_NOT_FOUND',
    TRANSACTION_ALREADY_REVERSED: 'TRANSACTION_ALREADY_REVERSED',
    DEPENDENT_CONSUMPTION_EXISTS: 'DEPENDENT_CONSUMPTION_EXISTS',
    INCOMPATIBLE_OPERATIONAL_STATUS: 'INCOMPATIBLE_OPERATIONAL_STATUS',
    EP_DOMAIN_EXCLUDED: 'EP_DOMAIN_EXCLUDED',
    IDEMPOTENCY_MISMATCH: 'IDEMPOTENCY_MISMATCH'
  });

  /**
   * Shifts that qualify to earn a public holiday credit when worked on a gazetted holiday.
   * Matches core clinical worked duties + PN per publicHolidayTracker.js and MAJOR_UPDATE_SPEC.
   */
  const QUALIFYING_HOLIDAY_SHIFTS = freeze([
    'AM', 'PM', 'AMX', 'PMX', 'OH', 'COURT', 'ON1', 'ON2', 'ON', 'N', 'NIGHT', 'PN'
  ]);

  /**
   * Fail-closed helper for domain errors.
   */
  function fail(code, message) {
    const err = new Error(message || code);
    err.code = code;
    return err;
  }

  /**
   * Normalizes date to canonical YYYY-MM-DD string.
   */
  function normalizeDate(dateVal) {
    if (!dateVal) return '';
    if (typeof dateVal === 'string') {
      const match = /^(\d{4}-\d{2}-\d{2})/.exec(dateVal.trim());
      if (match) return match[1];
    }
    if (dateVal instanceof Date && !isNaN(dateVal.getTime())) {
      return dateVal.toISOString().slice(0, 10);
    }
    return '';
  }

  /**
   * 5. Balance Derivation Pure Function
   *
   * Formulates GOFF accounting from confirmed append-only ledger transactions:
   *   Total Credits  = sum(CONFIRMED credits) - sum(CONFIRMED credit reversals)
   *   Total Consumed = sum(CONFIRMED consumptions) - sum(CONFIRMED consumption reversals)
   *   Total Reserved = sum(CONFIRMED reservations) - sum(CONFIRMED reservation releases)
   *
   *   Current Balance   = Total Credits - Total Consumed
   *   Available Balance = Current Balance - Total Reserved
   *
   * Requirements:
   * - Deterministic & order-independent.
   * - Only CONFIRMED ledger transactions are evaluated.
   * - Excludes unconfirmed, PENDING, RECOVERY_REQUIRED, or FAILED records.
   * - Optionally scopes calculation as of a specific date.
   *
   * @param {Array<Object>} transactions - List of transaction records
   * @param {Object} [options] - Scoping options: { personId, asOfDate }
   * @returns {Object} Balance breakdown
   */
  function deriveGoffBalance(transactions = [], options = {}) {
    const targetPersonId = options.personId || null;
    const asOfDate = options.asOfDate ? normalizeDate(options.asOfDate) : null;

    let earnedCredits = 0;
    let creditReversals = 0;
    let consumedGoff = 0;
    let consumptionReversals = 0;
    let reservedGoff = 0;
    let reservationReleases = 0;

    const matchedTransactions = [];

    (transactions || []).forEach(tx => {
      if (!tx) return;
      if (targetPersonId && tx.PersonId !== targetPersonId) return;

      // Only CONFIRMED transactions affect authoritative ledger balances
      if (tx.Status !== GOFF_TRANSACTION_STATUS.CONFIRMED) return;

      // Filter by asOfDate if provided
      if (asOfDate && tx.EffectiveDate && tx.EffectiveDate > asOfDate) return;

      matchedTransactions.push(tx);

      switch (tx.TransactionType) {
        case GOFF_TRANSACTION_TYPES.CREDIT_EARNED:
        case GOFF_TRANSACTION_TYPES.CREDIT_MANUAL:
          earnedCredits += (Math.abs(tx.Amount) || 1);
          break;
        case GOFF_TRANSACTION_TYPES.CREDIT_REVERSAL:
          creditReversals += (Math.abs(tx.Amount) || 1);
          break;
        case GOFF_TRANSACTION_TYPES.GOFF_CONSUMED:
          consumedGoff += (Math.abs(tx.Amount) || 1);
          break;
        case GOFF_TRANSACTION_TYPES.CONSUMPTION_REVERSAL:
          consumptionReversals += (Math.abs(tx.Amount) || 1);
          break;
        case GOFF_TRANSACTION_TYPES.GOFF_RESERVED:
          reservedGoff += (Math.abs(tx.Amount) || 1);
          break;
        case GOFF_TRANSACTION_TYPES.GOFF_RESERVATION_RELEASED:
          reservationReleases += (Math.abs(tx.Amount) || 1);
          break;
        default:
          break;
      }
    });

    const netCredits = Math.max(0, earnedCredits - creditReversals);
    const netConsumed = Math.max(0, consumedGoff - consumptionReversals);
    const netReserved = Math.max(0, reservedGoff - reservationReleases);

    const currentBalance = netCredits - netConsumed;
    const availableBalance = currentBalance - netReserved;

    return {
      personId: targetPersonId,
      asOfDate,
      earnedCredits,
      creditReversals,
      netCredits,
      consumedGoff,
      consumptionReversals,
      netConsumed,
      reservedGoff,
      reservationReleases,
      netReserved,
      currentBalance,
      availableBalance,
      transactionCount: matchedTransactions.length
    };
  }

  /**
   * 6. Public Holiday Qualification Rule
   *
   * Evaluates whether a roster assignment on a public holiday earns a credit.
   * - Only applies to MO directory (EP is explicitly excluded).
   * - Assignment shift must be a qualifying clinical duty or PN.
   * - Working multiple assignments on the same date earns at most 1 credit per doctor per holiday.
   *
   * @param {Object} assignment - Roster assignment { personId, date, dutyDomain, shiftCode }
   * @param {Object|String} holidayInfo - Holiday name or { name, date }
   * @param {Array<Object>} existingTransactions - Ledger history to check idempotency
   * @returns {Object} { qualifies: boolean, reason: string }
   */
  function qualifiesForPublicHolidayCredit(assignment, holidayInfo, existingTransactions = []) {
    if (!assignment || !assignment.personId || !assignment.date) {
      return { qualifies: false, reason: 'MISSING_ASSIGNMENT_DATA' };
    }

    const domain = (assignment.dutyDomain || 'MO').toUpperCase();
    if (domain === 'EP') {
      return { qualifies: false, reason: 'EP_DOMAIN_EXCLUDED' };
    }

    const holidayName = typeof holidayInfo === 'string' ? holidayInfo : (holidayInfo?.name || holidayInfo?.holidayName || null);
    if (!holidayName) {
      return { qualifies: false, reason: 'NOT_A_PUBLIC_HOLIDAY' };
    }

    const rawShift = String(assignment.shiftCode || '').trim().toUpperCase();
    const cleanShift = rawShift.replace(/\(S\)/i, '').replace(/-S/i, '').replace(/\(X\)/i, '').replace(/-X/i, '').trim();

    if (!QUALIFYING_HOLIDAY_SHIFTS.includes(cleanShift)) {
      return { qualifies: false, reason: 'NON_QUALIFYING_SHIFT' };
    }

    // Check idempotency: doctor must not already have an active/confirmed credit for this holiday date
    const dateStr = normalizeDate(assignment.date);
    const hasExistingCredit = (existingTransactions || []).some(tx =>
      tx.PersonId === assignment.personId &&
      (tx.PublicHolidayDate === dateStr || (tx.SourceType === GOFF_SOURCE_TYPES.PUBLIC_HOLIDAY_DUTY && tx.EffectiveDate === dateStr)) &&
      (tx.TransactionType === GOFF_TRANSACTION_TYPES.CREDIT_EARNED || tx.TransactionType === GOFF_TRANSACTION_TYPES.CREDIT_MANUAL) &&
      tx.Status === GOFF_TRANSACTION_STATUS.CONFIRMED
    );

    if (hasExistingCredit) {
      return { qualifies: false, reason: 'DUPLICATE_CREDIT_FOR_HOLIDAY' };
    }

    return {
      qualifies: true,
      holidayName,
      holidayDate: dateStr,
      shiftCode: cleanShift,
      reason: 'QUALIFIED_PUBLIC_HOLIDAY_DUTY'
    };
  }

  /**
   * 7. Displaced Weekly OFF Qualification Rule
   *
   * Per MAJOR_UPDATE_SPEC: A planned normal OFF displaced by a duty-related assignment or required PN
   * earns exactly one GOFF. Changing planned OFF to ordinary leave (MC, EL, AL) does NOT earn GOFF.
   *
   * @param {String} plannedShift - Shift code in immutable Planned layer
   * @param {String} currentShift - Shift code in active Current layer
   * @param {String} dutyDomain - Duty domain ('MO', 'EP')
   * @param {String} date - ISO date
   * @param {String} personId - Authoritative personId
   * @param {Array<Object>} existingTransactions - Ledger history to check idempotency
   * @returns {Object} { qualifies: boolean, reason: string }
   */
  function qualifiesForDisplacedOffCredit(plannedShift, currentShift, dutyDomain = 'MO', date = '', personId = '', existingTransactions = []) {
    const domain = (dutyDomain || 'MO').toUpperCase();
    if (domain === 'EP') {
      return { qualifies: false, reason: 'EP_DOMAIN_EXCLUDED' };
    }

    const p = String(plannedShift || '').trim().toUpperCase();
    const c = String(currentShift || '').trim().toUpperCase();

    // Must have originally been planned as normal weekly OFF
    if (p !== 'OFF') {
      return { qualifies: false, reason: 'PLANNED_SHIFT_NOT_NORMAL_OFF' };
    }

    // Changing planned OFF to absence (MC, EL, AL, COURSE) or remaining OFF earns nothing
    if (['OFF', 'GOFF', 'HKA', 'GHKA', 'AL', 'MC', 'EL', 'COURSE', ''].includes(c)) {
      return { qualifies: false, reason: 'NON_DUTY_DISPLACEMENT' };
    }

    // Must be displaced by a qualifying duty (AM, PM, ON1, ON2, etc.) or required PN
    const semantics = RosterCompatibility.resolveShift(c, 'MO');
    if (!semantics.canDisplaceOffEarnGoff && c !== 'PN') {
      return { qualifies: false, reason: 'SHIFT_CANNOT_DISPLACE_OFF' };
    }

    // Idempotency check for this date
    if (personId && date) {
      const dateStr = normalizeDate(date);
      const hasExistingCredit = (existingTransactions || []).some(tx =>
        tx.PersonId === personId &&
        tx.EffectiveDate === dateStr &&
        tx.SourceType === GOFF_SOURCE_TYPES.DISPLACED_WEEKLY_OFF &&
        (tx.TransactionType === GOFF_TRANSACTION_TYPES.CREDIT_EARNED || tx.TransactionType === GOFF_TRANSACTION_TYPES.CREDIT_MANUAL) &&
        tx.Status === GOFF_TRANSACTION_STATUS.CONFIRMED
      );
      if (hasExistingCredit) {
        return { qualifies: false, reason: 'DUPLICATE_CREDIT_FOR_DISPLACED_OFF' };
      }
    }

    return {
      qualifies: true,
      plannedShift: p,
      currentShift: c,
      reason: 'QUALIFIED_DISPLACED_WEEKLY_OFF'
    };
  }

  /**
   * 8. Validate GOFF Consumption
   *
   * Validates whether a person can consume a GOFF entitlement on a specific date:
   * - Available balance must be >= 1 (unless explicit admin override).
   * - No concurrent active absence (MC, EL, AL, COURSE) on the same date/domain.
   * - Person must belong to MO directory (EP is excluded).
   *
   * @param {Object} params
   * @returns {Object} Validation result
   */
  function validateGoffConsumption({
    personId,
    date,
    dutyDomain = 'MO',
    balance = 0,
    allowNegativeOverride = false,
    existingAssignments = [],
    existingAbsences = []
  }) {
    if (!personId) throw fail(GOFF_ERRORS.INVALID_PERSON_ID, 'PersonId is required for GOFF consumption.');
    if (!date) throw fail(GOFF_ERRORS.INVALID_DATE, 'Date is required for GOFF consumption.');

    const domain = (dutyDomain || 'MO').toUpperCase();
    if (domain === 'EP') {
      throw fail(GOFF_ERRORS.EP_DOMAIN_EXCLUDED, 'EP staff do not participate in GOFF ledger.');
    }

    const dateStr = normalizeDate(date);

    // Balance check
    if (balance < 1 && !allowNegativeOverride) {
      throw fail(GOFF_ERRORS.INSUFFICIENT_GOFF_BALANCE, `Insufficient GOFF balance (available: ${balance}). Consumption requires at least 1 credit.`);
    }

    // Check for incompatible concurrent active absences on the same date and domain
    const hasConflictingAbsence = (existingAbsences || []).some(abs => {
      if (abs.PersonId !== personId || abs.DutyDomain !== domain) return false;
      if (abs.Status !== 'ACTIVE') return false;
      return abs.StartDate <= dateStr && abs.EndDate >= dateStr;
    });

    if (hasConflictingAbsence) {
      throw fail(GOFF_ERRORS.INCOMPATIBLE_OPERATIONAL_STATUS, `Cannot assign GOFF on ${dateStr}: Person has an active absence (MC/EL/AL/COURSE) on this date.`);
    }

    return {
      valid: true,
      personId,
      date: dateStr,
      dutyDomain: domain,
      balanceAfter: balance - 1,
      overrideUsed: balance < 1 && allowNegativeOverride
    };
  }

  /**
   * 9. Create GOFF Credit Transaction Factory
   */
  function createGoffCreditTransaction({
    transactionId = null,
    periodId,
    personId,
    personNameSnapshot = '',
    dutyDomain = 'MO',
    effectiveDate,
    sourceType = GOFF_SOURCE_TYPES.PUBLIC_HOLIDAY_DUTY,
    sourceId = '',
    publicHolidayDate = null,
    publicHolidayName = null,
    rosterAssignmentId = null,
    adminNote = '',
    reasonCode = 'HOLIDAY_DUTY_CREDIT',
    operationId = '',
    createdBy = 'system'
  }) {
    if (!personId) throw fail(GOFF_ERRORS.INVALID_PERSON_ID, 'PersonId is required');
    if (!periodId) throw fail('INVALID_PERIOD_ID', 'PeriodId is required');
    if (!effectiveDate) throw fail(GOFF_ERRORS.INVALID_DATE, 'EffectiveDate is required');

    const domain = (dutyDomain || 'MO').toUpperCase();
    if (domain === 'EP') throw fail(GOFF_ERRORS.EP_DOMAIN_EXCLUDED, 'EP domain cannot earn GOFF credits');

    const tid = transactionId || `gtx-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

    return {
      TransactionId: tid,
      PeriodId: periodId,
      PersonId: personId,
      PersonNameSnapshot: personNameSnapshot || personId,
      DutyDomain: domain,
      TransactionType: sourceType === GOFF_SOURCE_TYPES.OPENING_BALANCE || sourceType === GOFF_SOURCE_TYPES.ADMIN_ADJUSTMENT
        ? GOFF_TRANSACTION_TYPES.CREDIT_MANUAL
        : GOFF_TRANSACTION_TYPES.CREDIT_EARNED,
      Amount: 1,
      EffectiveDate: normalizeDate(effectiveDate),
      SourceType: sourceType,
      SourceId: sourceId || '',
      PublicHolidayDate: publicHolidayDate ? normalizeDate(publicHolidayDate) : null,
      PublicHolidayName: publicHolidayName || null,
      RosterAssignmentId: rosterAssignmentId || null,
      RelatedTransactionId: null,
      ReasonCode: reasonCode,
      AdminNote: adminNote || '',
      Status: GOFF_TRANSACTION_STATUS.CONFIRMED,
      OperationId: operationId || '',
      CreatedAt: new Date().toISOString(),
      CreatedBy: createdBy
    };
  }

  /**
   * 10. Create GOFF Consumption Transaction Factory
   */
  function createGoffConsumptionTransaction({
    transactionId = null,
    periodId,
    personId,
    personNameSnapshot = '',
    dutyDomain = 'MO',
    effectiveDate,
    rosterAssignmentId = null,
    relatedTransactionId = null,
    adminNote = '',
    reasonCode = 'GOFF_DUTY_CONSUMPTION',
    operationId = '',
    createdBy = 'system'
  }) {
    if (!personId) throw fail(GOFF_ERRORS.INVALID_PERSON_ID, 'PersonId is required');
    if (!periodId) throw fail('INVALID_PERIOD_ID', 'PeriodId is required');
    if (!effectiveDate) throw fail(GOFF_ERRORS.INVALID_DATE, 'EffectiveDate is required');

    const domain = (dutyDomain || 'MO').toUpperCase();
    if (domain === 'EP') throw fail(GOFF_ERRORS.EP_DOMAIN_EXCLUDED, 'EP domain cannot consume GOFF credits');

    const tid = transactionId || `gtx-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

    return {
      TransactionId: tid,
      PeriodId: periodId,
      PersonId: personId,
      PersonNameSnapshot: personNameSnapshot || personId,
      DutyDomain: domain,
      TransactionType: GOFF_TRANSACTION_TYPES.GOFF_CONSUMED,
      Amount: -1,
      EffectiveDate: normalizeDate(effectiveDate),
      SourceType: GOFF_SOURCE_TYPES.ROSTER_ASSIGNMENT,
      SourceId: rosterAssignmentId || '',
      PublicHolidayDate: null,
      PublicHolidayName: null,
      RosterAssignmentId: rosterAssignmentId || null,
      RelatedTransactionId: relatedTransactionId || null,
      ReasonCode: reasonCode,
      AdminNote: adminNote || '',
      Status: GOFF_TRANSACTION_STATUS.CONFIRMED,
      OperationId: operationId || '',
      CreatedAt: new Date().toISOString(),
      CreatedBy: createdBy
    };
  }

  /**
   * 11. Create Compensating Reversal Transaction Factory
   *
   * Enforces dependency check:
   * Reversing a credit when an active dependent consumption is attached is BLOCKED.
   */
  function createGoffReversalTransaction({
    targetTransaction,
    allTransactions = [],
    adminNote = '',
    operationId = '',
    reversedBy = 'system'
  }) {
    if (!targetTransaction || !targetTransaction.TransactionId) {
      throw fail(GOFF_ERRORS.TRANSACTION_NOT_FOUND, 'Target transaction to reverse not found');
    }

    if (targetTransaction.Status === GOFF_TRANSACTION_STATUS.REVERSED) {
      throw fail(GOFF_ERRORS.TRANSACTION_ALREADY_REVERSED, `Transaction ${targetTransaction.TransactionId} is already reversed`);
    }

    // Dependency check: If reversing a credit, verify no active consumption references it
    const isCredit = targetTransaction.TransactionType === GOFF_TRANSACTION_TYPES.CREDIT_EARNED ||
                     targetTransaction.TransactionType === GOFF_TRANSACTION_TYPES.CREDIT_MANUAL;

    if (isCredit) {
      const activeDependentConsumption = (allTransactions || []).find(tx =>
        tx.RelatedTransactionId === targetTransaction.TransactionId &&
        tx.TransactionType === GOFF_TRANSACTION_TYPES.GOFF_CONSUMED &&
        tx.Status === GOFF_TRANSACTION_STATUS.CONFIRMED
      );
      if (activeDependentConsumption) {
        throw fail(GOFF_ERRORS.DEPENDENT_CONSUMPTION_EXISTS,
          `Cannot reverse credit ${targetTransaction.TransactionId}: Dependent GOFF consumption ${activeDependentConsumption.TransactionId} must be reversed first.`
        );
      }
    }

    const reversalType = isCredit
      ? GOFF_TRANSACTION_TYPES.CREDIT_REVERSAL
      : GOFF_TRANSACTION_TYPES.CONSUMPTION_REVERSAL;

    const tid = `gtx-rev-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

    return {
      TransactionId: tid,
      PeriodId: targetTransaction.PeriodId,
      PersonId: targetTransaction.PersonId,
      PersonNameSnapshot: targetTransaction.PersonNameSnapshot,
      DutyDomain: targetTransaction.DutyDomain,
      TransactionType: reversalType,
      Amount: isCredit ? -1 : 1, // Compensates the target transaction
      EffectiveDate: targetTransaction.EffectiveDate,
      SourceType: targetTransaction.SourceType,
      SourceId: targetTransaction.TransactionId,
      PublicHolidayDate: targetTransaction.PublicHolidayDate || null,
      PublicHolidayName: targetTransaction.PublicHolidayName || null,
      RosterAssignmentId: targetTransaction.RosterAssignmentId || null,
      RelatedTransactionId: targetTransaction.TransactionId,
      ReasonCode: isCredit ? 'CREDIT_REVERSAL' : 'CONSUMPTION_REVERSAL',
      AdminNote: adminNote || '',
      Status: GOFF_TRANSACTION_STATUS.CONFIRMED,
      OperationId: operationId || '',
      CreatedAt: new Date().toISOString(),
      CreatedBy: reversedBy
    };
  }

  /**
   * 12. Privacy Scrubber for Non-Admin Viewers
   *
   * Removes AdminNote, internal OperationIds, and sensitive administrative metadata.
   */
  function scrubGoffViewerDto(transaction) {
    if (!transaction) return null;
    return {
      TransactionId: transaction.TransactionId,
      PeriodId: transaction.PeriodId,
      PersonId: transaction.PersonId,
      PersonNameSnapshot: transaction.PersonNameSnapshot,
      DutyDomain: transaction.DutyDomain,
      TransactionType: transaction.TransactionType,
      Amount: transaction.Amount,
      EffectiveDate: transaction.EffectiveDate,
      PublicHolidayDate: transaction.PublicHolidayDate || null,
      PublicHolidayName: transaction.PublicHolidayName || null,
      Status: transaction.Status
    };
  }

  return freeze({
    GOFF_TRANSACTION_TYPES,
    GOFF_SOURCE_TYPES,
    GOFF_TRANSACTION_STATUS,
    GOFF_ERRORS,
    QUALIFYING_HOLIDAY_SHIFTS,
    deriveGoffBalance,
    qualifiesForPublicHolidayCredit,
    qualifiesForDisplacedOffCredit,
    validateGoffConsumption,
    createGoffCreditTransaction,
    createGoffConsumptionTransaction,
    createGoffReversalTransaction,
    scrubGoffViewerDto
  });
})();

export default RosterGoff;
