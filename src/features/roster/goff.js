import RosterCompatibility from './compatibility.js';
import RosterLifecycle from './lifecycle.js';

/**
 * Phase 7 Slice 1.1 — GOFF & GHKA Entitlement, Credit & Consumption Domain Foundation.
 *
 * Implements authoritative separation between:
 *   - GOFF: Displaced weekly rest day entitlement (earned when normal OFF is displaced).
 *   - GHKA: Replacement public holiday off (earned by actually working a gazetted holiday).
 *
 * Ledger Sheet / Table: RosterEntitlementTransactions (append-only).
 * Balances are independently derived per PersonId + EntitlementType (+ DutyDomain).
 * No pooled balance; GOFF and GHKA cannot satisfy each other's consumption.
 */
const RosterEntitlement = (() => {
  const freeze = value => {
    if (value && typeof value === 'object') {
      Object.values(value).forEach(freeze);
      Object.freeze(value);
    }
    return value;
  };

  /**
   * 1. Canonical Entitlement Types
   */
  const ENTITLEMENT_TYPES = freeze({
    GOFF: 'GOFF', // Displaced weekly rest day off
    GHKA: 'GHKA'  // Ganti Hari Kelepasan Am (replacement public holiday off)
  });

  /**
   * 2. Canonical Transaction Types
   */
  const ENTITLEMENT_TRANSACTION_TYPES = freeze({
    CREDIT_EARNED: 'CREDIT_EARNED',                         // Automatically earned via qualifying duty
    CREDIT_MANUAL: 'CREDIT_MANUAL',                         // Manually granted by administrator / opening balance
    CREDIT_REVERSAL: 'CREDIT_REVERSAL',                     // Compensating reversal of an earned or manual credit
    ENTITLEMENT_RESERVED: 'ENTITLEMENT_RESERVED',           // In-flight reservation for a published future assignment
    ENTITLEMENT_RESERVATION_RELEASED: 'ENTITLEMENT_RESERVATION_RELEASED', // Released reservation if future assignment amended
    ENTITLEMENT_CONSUMED: 'ENTITLEMENT_CONSUMED',           // Confirmed consumption of an entitlement on a roster date
    CONSUMPTION_REVERSAL: 'CONSUMPTION_REVERSAL',          // Compensating reversal of consumed entitlement

    // Backward-compatible explicit aliases
    GOFF_CONSUMED: 'GOFF_CONSUMED',
    GHKA_CONSUMED: 'GHKA_CONSUMED',
    GOFF_RESERVED: 'ENTITLEMENT_RESERVED',
    GOFF_RESERVATION_RELEASED: 'ENTITLEMENT_RESERVATION_RELEASED'
  });

  /**
   * 3. Canonical Source Types
   */
  const ENTITLEMENT_SOURCE_TYPES = freeze({
    DISPLACED_WEEKLY_OFF: 'DISPLACED_WEEKLY_OFF', // Earning source for GOFF
    PUBLIC_HOLIDAY_DUTY: 'PUBLIC_HOLIDAY_DUTY',   // Earning source for GHKA
    OPENING_BALANCE: 'OPENING_BALANCE',           // Pre-commencement certified opening balance
    ADMIN_ADJUSTMENT: 'ADMIN_ADJUSTMENT',         // Typed administrative adjustment
    ROSTER_ASSIGNMENT: 'ROSTER_ASSIGNMENT'        // Operational consumption on a roster date
  });

  /**
   * 4. Record Statuses
   */
  const ENTITLEMENT_TRANSACTION_STATUS = freeze({
    CONFIRMED: 'CONFIRMED',
    PENDING: 'PENDING',
    REVERSED: 'REVERSED',
    REJECTED: 'REJECTED'
  });

  /**
   * 5. Canonical Error Codes
   */
  const ENTITLEMENT_ERRORS = freeze({
    INSUFFICIENT_GOFF_BALANCE: 'INSUFFICIENT_GOFF_BALANCE',
    INSUFFICIENT_GHKA_BALANCE: 'INSUFFICIENT_GHKA_BALANCE',
    CROSS_ENTITLEMENT_CONSUMPTION_FORBIDDEN: 'CROSS_ENTITLEMENT_CONSUMPTION_FORBIDDEN',
    CROSS_ENTITLEMENT_DEPENDENCY_FORBIDDEN: 'CROSS_ENTITLEMENT_DEPENDENCY_FORBIDDEN',
    INVALID_ENTITLEMENT_TYPE: 'INVALID_ENTITLEMENT_TYPE',
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
   * 6. Canonical Table Schema Definition
   */
  const ROSTER_ENTITLEMENT_SCHEMAS = freeze({
    RosterEntitlementTransactions: [
      'TransactionId',
      'PeriodId',
      'PersonId',
      'PersonNameSnapshot',
      'EntitlementType',
      'DutyDomain',
      'TransactionType',
      'Amount',
      'EffectiveDate',
      'SourceType',
      'SourceId',
      'SourceAssignmentId',
      'SourcePeriodId',
      'PublicHolidayDate',
      'PublicHolidayName',
      'RosterAssignmentId',
      'RelatedTransactionId',
      'ReasonCode',
      'AdminNote',
      'ExpiresAt',
      'ExpiryPolicyCode',
      'Status',
      'OperationId',
      'CreatedAt',
      'CreatedBy'
    ]
  });

  /**
   * Shifts that qualify to earn a public holiday (GHKA) credit when worked on a gazetted holiday.
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
   * 7. Separate Balance Derivation Pure Function
   *
   * Formulates accounting for a specific EntitlementType ('GOFF' | 'GHKA'):
   *   Total Credits  = sum(CONFIRMED non-expired credits) - sum(CONFIRMED credit reversals)
   *   Total Consumed = sum(CONFIRMED consumptions) - sum(CONFIRMED consumption reversals)
   *   Total Reserved = sum(CONFIRMED reservations) - sum(CONFIRMED reservation releases)
   *
   *   Current Balance   = Total Credits - Total Consumed
   *   Available Balance = Current Balance - Total Reserved
   *
   * Expiry Policy Architecture:
   * - Under current policy, newly earned credits have ExpiresAt = null (non-expiring indefinitely).
   * - If an asOfDate is provided, any credit with a non-null, non-empty ExpiresAt <= asOfDate
   *   is treated as EXPIRED and excluded from netCredits.
   * - Credits with ExpiresAt === null never expire.
   *
   * @param {Array<Object>} transactions - Ledger transaction records
   * @param {Object} options - { personId, entitlementType, asOfDate }
   * @returns {Object} Balance breakdown
   */
  function deriveEntitlementBalance(transactions = [], options = {}) {
    const targetPersonId = options.personId || null;
    const entitlementType = options.entitlementType || null;
    const asOfDate = options.asOfDate ? normalizeDate(options.asOfDate) : null;

    if (!entitlementType || !Object.values(ENTITLEMENT_TYPES).includes(entitlementType)) {
      throw fail(ENTITLEMENT_ERRORS.INVALID_ENTITLEMENT_TYPE, `Valid EntitlementType ('GOFF' | 'GHKA') is required. Received: '${entitlementType}'`);
    }

    let earnedCredits = 0;
    let creditReversals = 0;
    let consumed = 0;
    let consumptionReversals = 0;
    let reserved = 0;
    let reservationReleases = 0;
    let expiredCredits = 0;

    const matchedTransactions = [];

    (transactions || []).forEach(tx => {
      if (!tx) return;
      if (targetPersonId && tx.PersonId !== targetPersonId) return;

      // EntitlementType must match strictly (no cross-entitlement pooling)
      const txType = tx.EntitlementType || (
        tx.TransactionType === 'GOFF_CONSUMED' ? ENTITLEMENT_TYPES.GOFF :
        tx.TransactionType === 'GHKA_CONSUMED' ? ENTITLEMENT_TYPES.GHKA : null
      );
      if (txType !== entitlementType) return;

      // Only CONFIRMED transactions affect authoritative ledger balances
      if (tx.Status !== ENTITLEMENT_TRANSACTION_STATUS.CONFIRMED) return;

      // Filter by asOfDate if provided
      if (asOfDate && tx.EffectiveDate && tx.EffectiveDate > asOfDate) return;

      matchedTransactions.push(tx);

      const amount = Math.abs(tx.Amount) || 1;

      switch (tx.TransactionType) {
        case ENTITLEMENT_TRANSACTION_TYPES.CREDIT_EARNED:
        case ENTITLEMENT_TRANSACTION_TYPES.CREDIT_MANUAL: {
          // Check future-proofing expiry policy
          const expDate = tx.ExpiresAt ? normalizeDate(tx.ExpiresAt) : null;
          if (asOfDate && expDate && expDate <= asOfDate) {
            expiredCredits += amount;
          } else {
            earnedCredits += amount;
          }
          break;
        }
        case ENTITLEMENT_TRANSACTION_TYPES.CREDIT_REVERSAL:
          creditReversals += amount;
          break;
        case ENTITLEMENT_TRANSACTION_TYPES.ENTITLEMENT_CONSUMED:
        case ENTITLEMENT_TRANSACTION_TYPES.GOFF_CONSUMED:
        case ENTITLEMENT_TRANSACTION_TYPES.GHKA_CONSUMED:
          consumed += amount;
          break;
        case ENTITLEMENT_TRANSACTION_TYPES.CONSUMPTION_REVERSAL:
          consumptionReversals += amount;
          break;
        case ENTITLEMENT_TRANSACTION_TYPES.ENTITLEMENT_RESERVED:
          reserved += amount;
          break;
        case ENTITLEMENT_TRANSACTION_TYPES.ENTITLEMENT_RESERVATION_RELEASED:
          reservationReleases += amount;
          break;
        default:
          break;
      }
    });

    const netCredits = Math.max(0, earnedCredits - creditReversals);
    const netConsumed = Math.max(0, consumed - consumptionReversals);
    const netReserved = Math.max(0, reserved - reservationReleases);

    const currentBalance = netCredits - netConsumed;
    const availableBalance = currentBalance - netReserved;

    return {
      personId: targetPersonId,
      entitlementType,
      asOfDate,
      earnedCredits,
      creditReversals,
      netCredits,
      consumed,
      consumptionReversals,
      netConsumed,
      reserved,
      reservationReleases,
      netReserved,
      expiredCredits,
      currentBalance,
      availableBalance,
      transactionCount: matchedTransactions.length
    };
  }

  /**
   * Derives all separate entitlement balances for a doctor.
   */
  function deriveAllEntitlementBalances(transactions = [], options = {}) {
    return {
      GOFF: deriveEntitlementBalance(transactions, { ...options, entitlementType: ENTITLEMENT_TYPES.GOFF }),
      GHKA: deriveEntitlementBalance(transactions, { ...options, entitlementType: ENTITLEMENT_TYPES.GHKA })
    };
  }

  /**
   * Convenience backward-compatible delegate for GOFF balance.
   */
  function deriveGoffBalance(transactions = [], options = {}) {
    const bal = deriveEntitlementBalance(transactions, { ...options, entitlementType: ENTITLEMENT_TYPES.GOFF });
    return {
      ...bal,
      consumedGoff: bal.consumed,
      reservedGoff: bal.reserved
    };
  }

  /**
   * 8. Public Holiday Qualification Rule (Earns GHKA)
   *
   * Working a qualifying duty on a gazetted holiday earns GHKA (NOT GOFF).
   * - Only applies to MO directory (EP is excluded).
   * - Non-working status, absence, or HKA earns zero GHKA.
   * - Covering / replacement worker who works the holiday earns GHKA.
   * - Max 1 GHKA per person per qualifying holiday date.
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

    // HKA, OFF, GOFF, GHKA, MC, AL, EL, COURSE do not qualify
    if (!QUALIFYING_HOLIDAY_SHIFTS.includes(cleanShift)) {
      return { qualifies: false, reason: 'NON_QUALIFYING_SHIFT' };
    }

    // Check idempotency: doctor must not already have a confirmed GHKA credit for this holiday date
    const dateStr = normalizeDate(assignment.date);
    const hasExistingCredit = (existingTransactions || []).some(tx =>
      tx.PersonId === assignment.personId &&
      tx.EntitlementType === ENTITLEMENT_TYPES.GHKA &&
      (tx.PublicHolidayDate === dateStr || (tx.SourceType === ENTITLEMENT_SOURCE_TYPES.PUBLIC_HOLIDAY_DUTY && tx.EffectiveDate === dateStr)) &&
      (tx.TransactionType === ENTITLEMENT_TRANSACTION_TYPES.CREDIT_EARNED || tx.TransactionType === ENTITLEMENT_TRANSACTION_TYPES.CREDIT_MANUAL) &&
      tx.Status === ENTITLEMENT_TRANSACTION_STATUS.CONFIRMED
    );

    if (hasExistingCredit) {
      return { qualifies: false, reason: 'DUPLICATE_CREDIT_FOR_HOLIDAY' };
    }

    return {
      qualifies: true,
      entitlementType: ENTITLEMENT_TYPES.GHKA,
      holidayName,
      holidayDate: dateStr,
      shiftCode: cleanShift,
      reason: 'QUALIFIED_PUBLIC_HOLIDAY_DUTY'
    };
  }

  /**
   * 9. Displaced Weekly OFF Qualification Rule (Earns GOFF)
   *
   * A planned normal weekly OFF displaced by an administrative working duty earns GOFF (NOT GHKA).
   * Changing planned OFF to leave (MC, EL, AL) or keeping OFF earns zero GOFF.
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

    // Changing planned OFF to absence (MC, EL, AL, COURSE) or remaining OFF/HKA earns nothing
    if (['OFF', 'GOFF', 'HKA', 'GHKA', 'AL', 'MC', 'EL', 'COURSE', ''].includes(c)) {
      return { qualifies: false, reason: 'NON_DUTY_DISPLACEMENT' };
    }

    // Must be displaced by a qualifying working duty (AM, PM, ON1, ON2, etc.) or required PN
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
        tx.EntitlementType === ENTITLEMENT_TYPES.GOFF &&
        tx.SourceType === ENTITLEMENT_SOURCE_TYPES.DISPLACED_WEEKLY_OFF &&
        (tx.TransactionType === ENTITLEMENT_TRANSACTION_TYPES.CREDIT_EARNED || tx.TransactionType === ENTITLEMENT_TRANSACTION_TYPES.CREDIT_MANUAL) &&
        tx.Status === ENTITLEMENT_TRANSACTION_STATUS.CONFIRMED
      );
      if (hasExistingCredit) {
        return { qualifies: false, reason: 'DUPLICATE_CREDIT_FOR_DISPLACED_OFF' };
      }
    }

    return {
      qualifies: true,
      entitlementType: ENTITLEMENT_TYPES.GOFF,
      plannedShift: p,
      currentShift: c,
      reason: 'QUALIFIED_DISPLACED_WEEKLY_OFF'
    };
  }

  /**
   * 10. Separate Consumption Validation
   *
   * Validates consumption of a specific EntitlementType ('GOFF' | 'GHKA'):
   * - GOFF consumption requires GOFF balance >= 1. Fails with INSUFFICIENT_GOFF_BALANCE.
   * - GHKA consumption requires GHKA balance >= 1. Fails with INSUFFICIENT_GHKA_BALANCE.
   * - Cannot pool or substitute one entitlement for another.
   * - Fails closed on concurrent active absence (MC/EL/AL/COURSE) with INCOMPATIBLE_OPERATIONAL_STATUS.
   */
  function validateEntitlementConsumption({
    personId,
    date,
    dutyDomain = 'MO',
    entitlementType = ENTITLEMENT_TYPES.GOFF,
    balance = 0,
    allowNegativeOverride = false,
    existingAbsences = []
  }) {
    if (!personId) throw fail(ENTITLEMENT_ERRORS.INVALID_PERSON_ID, 'PersonId is required for entitlement consumption.');
    if (!date) throw fail(ENTITLEMENT_ERRORS.INVALID_DATE, 'Date is required for entitlement consumption.');

    const domain = (dutyDomain || 'MO').toUpperCase();
    if (domain === 'EP') {
      throw fail(ENTITLEMENT_ERRORS.EP_DOMAIN_EXCLUDED, 'EP staff do not participate in entitlement ledger.');
    }

    if (!entitlementType || !Object.values(ENTITLEMENT_TYPES).includes(entitlementType)) {
      throw fail(ENTITLEMENT_ERRORS.INVALID_ENTITLEMENT_TYPE, `Valid EntitlementType ('GOFF' | 'GHKA') is required. Received: '${entitlementType}'`);
    }

    const dateStr = normalizeDate(date);

    // Balance check fails closed per entitlement type
    if (balance < 1 && !allowNegativeOverride) {
      if (entitlementType === ENTITLEMENT_TYPES.GOFF) {
        throw fail(ENTITLEMENT_ERRORS.INSUFFICIENT_GOFF_BALANCE, `Insufficient GOFF balance (available: ${balance}). Consumption requires at least 1 GOFF credit.`);
      } else {
        throw fail(ENTITLEMENT_ERRORS.INSUFFICIENT_GHKA_BALANCE, `Insufficient GHKA balance (available: ${balance}). Consumption requires at least 1 GHKA credit.`);
      }
    }

    // Incompatible concurrent active absences on the same date and domain
    const hasConflictingAbsence = (existingAbsences || []).some(abs => {
      if (abs.PersonId !== personId || abs.DutyDomain !== domain) return false;
      if (abs.Status !== 'ACTIVE') return false;
      return abs.StartDate <= dateStr && abs.EndDate >= dateStr;
    });

    if (hasConflictingAbsence) {
      throw fail(ENTITLEMENT_ERRORS.INCOMPATIBLE_OPERATIONAL_STATUS, `Cannot assign ${entitlementType} on ${dateStr}: Person has an active absence (MC/EL/AL/COURSE) on this date.`);
    }

    return {
      valid: true,
      personId,
      date: dateStr,
      dutyDomain: domain,
      entitlementType,
      projectedShiftCode: entitlementType, // Consumed GOFF -> 'GOFF', consumed GHKA -> 'GHKA'
      balanceAfter: balance - 1,
      overrideUsed: balance < 1 && allowNegativeOverride
    };
  }

  function validateGoffConsumption(params) {
    return validateEntitlementConsumption({ ...params, entitlementType: ENTITLEMENT_TYPES.GOFF });
  }

  /**
   * 11. Transaction Factories
   */
  function createEntitlementCreditTransaction({
    transactionId = null,
    periodId,
    personId,
    personNameSnapshot = '',
    entitlementType = ENTITLEMENT_TYPES.GOFF,
    dutyDomain = 'MO',
    effectiveDate,
    sourceType = null,
    sourceId = '',
    sourceAssignmentId = null,
    sourcePeriodId = null,
    publicHolidayDate = null,
    publicHolidayName = null,
    expiresAt = null,
    expiryPolicyCode = null,
    adminNote = '',
    reasonCode = '',
    operationId = '',
    createdBy = 'system'
  }) {
    if (!personId) throw fail(ENTITLEMENT_ERRORS.INVALID_PERSON_ID, 'PersonId is required');
    if (!periodId) throw fail('INVALID_PERIOD_ID', 'PeriodId is required');
    if (!effectiveDate) throw fail(ENTITLEMENT_ERRORS.INVALID_DATE, 'EffectiveDate is required');

    const domain = (dutyDomain || 'MO').toUpperCase();
    if (domain === 'EP') throw fail(ENTITLEMENT_ERRORS.EP_DOMAIN_EXCLUDED, 'EP domain cannot earn entitlement credits');

    if (!entitlementType || !Object.values(ENTITLEMENT_TYPES).includes(entitlementType)) {
      throw fail(ENTITLEMENT_ERRORS.INVALID_ENTITLEMENT_TYPE, `Invalid EntitlementType: ${entitlementType}`);
    }

    const defaultSource = entitlementType === ENTITLEMENT_TYPES.GHKA
      ? ENTITLEMENT_SOURCE_TYPES.PUBLIC_HOLIDAY_DUTY
      : ENTITLEMENT_SOURCE_TYPES.DISPLACED_WEEKLY_OFF;
    const finalSource = sourceType || defaultSource;

    // Cross-source validation
    if (entitlementType === ENTITLEMENT_TYPES.GOFF && finalSource === ENTITLEMENT_SOURCE_TYPES.PUBLIC_HOLIDAY_DUTY) {
      throw fail(ENTITLEMENT_ERRORS.INVALID_SOURCE_TYPE, 'Public holiday duty earns GHKA, not GOFF');
    }
    if (entitlementType === ENTITLEMENT_TYPES.GHKA && finalSource === ENTITLEMENT_SOURCE_TYPES.DISPLACED_WEEKLY_OFF) {
      throw fail(ENTITLEMENT_ERRORS.INVALID_SOURCE_TYPE, 'Displaced weekly off earns GOFF, not GHKA');
    }

    const tid = transactionId || `etx-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

    return {
      TransactionId: tid,
      PeriodId: periodId,
      PersonId: personId,
      PersonNameSnapshot: personNameSnapshot || personId,
      EntitlementType: entitlementType,
      DutyDomain: domain,
      TransactionType: finalSource === ENTITLEMENT_SOURCE_TYPES.OPENING_BALANCE || finalSource === ENTITLEMENT_SOURCE_TYPES.ADMIN_ADJUSTMENT
        ? ENTITLEMENT_TRANSACTION_TYPES.CREDIT_MANUAL
        : ENTITLEMENT_TRANSACTION_TYPES.CREDIT_EARNED,
      Amount: 1,
      EffectiveDate: normalizeDate(effectiveDate),
      SourceType: finalSource,
      SourceId: sourceId || '',
      SourceAssignmentId: sourceAssignmentId || null,
      SourcePeriodId: sourcePeriodId || periodId,
      PublicHolidayDate: publicHolidayDate ? normalizeDate(publicHolidayDate) : null,
      PublicHolidayName: publicHolidayName || null,
      RosterAssignmentId: null,
      RelatedTransactionId: null,
      ReasonCode: reasonCode || (entitlementType === ENTITLEMENT_TYPES.GHKA ? 'HOLIDAY_DUTY_CREDIT' : 'DISPLACED_OFF_CREDIT'),
      AdminNote: adminNote || '',
      ExpiresAt: expiresAt ? normalizeDate(expiresAt) : null, // null = current non-expiring policy
      ExpiryPolicyCode: expiryPolicyCode || null,
      Status: ENTITLEMENT_TRANSACTION_STATUS.CONFIRMED,
      OperationId: operationId || '',
      CreatedAt: new Date().toISOString(),
      CreatedBy: createdBy
    };
  }

  function createEntitlementConsumptionTransaction({
    transactionId = null,
    periodId,
    personId,
    personNameSnapshot = '',
    entitlementType = ENTITLEMENT_TYPES.GOFF,
    dutyDomain = 'MO',
    effectiveDate,
    rosterAssignmentId = null,
    relatedTransactionId = null,
    adminNote = '',
    reasonCode = '',
    operationId = '',
    createdBy = 'system'
  }) {
    if (!personId) throw fail(ENTITLEMENT_ERRORS.INVALID_PERSON_ID, 'PersonId is required');
    if (!periodId) throw fail('INVALID_PERIOD_ID', 'PeriodId is required');
    if (!effectiveDate) throw fail(ENTITLEMENT_ERRORS.INVALID_DATE, 'EffectiveDate is required');

    const domain = (dutyDomain || 'MO').toUpperCase();
    if (domain === 'EP') throw fail(ENTITLEMENT_ERRORS.EP_DOMAIN_EXCLUDED, 'EP domain cannot consume entitlement credits');

    if (!entitlementType || !Object.values(ENTITLEMENT_TYPES).includes(entitlementType)) {
      throw fail(ENTITLEMENT_ERRORS.INVALID_ENTITLEMENT_TYPE, `Invalid EntitlementType: ${entitlementType}`);
    }

    const tid = transactionId || `etx-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

    return {
      TransactionId: tid,
      PeriodId: periodId,
      PersonId: personId,
      PersonNameSnapshot: personNameSnapshot || personId,
      EntitlementType: entitlementType,
      DutyDomain: domain,
      TransactionType: entitlementType === ENTITLEMENT_TYPES.GOFF
        ? ENTITLEMENT_TRANSACTION_TYPES.GOFF_CONSUMED
        : ENTITLEMENT_TRANSACTION_TYPES.GHKA_CONSUMED,
      Amount: -1,
      EffectiveDate: normalizeDate(effectiveDate),
      SourceType: ENTITLEMENT_SOURCE_TYPES.ROSTER_ASSIGNMENT,
      SourceId: rosterAssignmentId || '',
      SourceAssignmentId: rosterAssignmentId || null,
      SourcePeriodId: periodId,
      PublicHolidayDate: null,
      PublicHolidayName: null,
      RosterAssignmentId: rosterAssignmentId || null,
      RelatedTransactionId: relatedTransactionId || null,
      ReasonCode: reasonCode || `${entitlementType}_CONSUMPTION`,
      AdminNote: adminNote || '',
      ExpiresAt: null,
      ExpiryPolicyCode: null,
      Status: ENTITLEMENT_TRANSACTION_STATUS.CONFIRMED,
      OperationId: operationId || '',
      CreatedAt: new Date().toISOString(),
      CreatedBy: createdBy
    };
  }

  function createEntitlementReversalTransaction({
    targetTransaction,
    allTransactions = [],
    adminNote = '',
    operationId = '',
    reversedBy = 'system'
  }) {
    if (!targetTransaction || !targetTransaction.TransactionId) {
      throw fail(ENTITLEMENT_ERRORS.TRANSACTION_NOT_FOUND, 'Target transaction to reverse not found');
    }

    if (targetTransaction.Status === ENTITLEMENT_TRANSACTION_STATUS.REVERSED) {
      throw fail(ENTITLEMENT_ERRORS.TRANSACTION_ALREADY_REVERSED, `Transaction ${targetTransaction.TransactionId} is already reversed`);
    }

    const entitlementType = targetTransaction.EntitlementType;
    const isCredit = targetTransaction.TransactionType === ENTITLEMENT_TRANSACTION_TYPES.CREDIT_EARNED ||
                     targetTransaction.TransactionType === ENTITLEMENT_TRANSACTION_TYPES.CREDIT_MANUAL;

    if (isCredit) {
      // Find dependent active consumptions
      const dependentConsumption = (allTransactions || []).find(tx =>
        tx.RelatedTransactionId === targetTransaction.TransactionId &&
        (tx.TransactionType === ENTITLEMENT_TRANSACTION_TYPES.ENTITLEMENT_CONSUMED ||
         tx.TransactionType === ENTITLEMENT_TRANSACTION_TYPES.GOFF_CONSUMED ||
         tx.TransactionType === ENTITLEMENT_TRANSACTION_TYPES.GHKA_CONSUMED) &&
        tx.Status === ENTITLEMENT_TRANSACTION_STATUS.CONFIRMED
      );

      if (dependentConsumption) {
        if (dependentConsumption.EntitlementType !== entitlementType) {
          throw fail(ENTITLEMENT_ERRORS.CROSS_ENTITLEMENT_DEPENDENCY_FORBIDDEN,
            `Cross-entitlement dependency conflict: ${dependentConsumption.EntitlementType} consumption cannot depend on ${entitlementType} credit.`
          );
        }
        throw fail(ENTITLEMENT_ERRORS.DEPENDENT_CONSUMPTION_EXISTS,
          `Cannot reverse ${entitlementType} credit ${targetTransaction.TransactionId}: Dependent consumption ${dependentConsumption.TransactionId} must be reversed first.`
        );
      }
    }

    const reversalType = isCredit
      ? ENTITLEMENT_TRANSACTION_TYPES.CREDIT_REVERSAL
      : ENTITLEMENT_TRANSACTION_TYPES.CONSUMPTION_REVERSAL;

    const tid = `etx-rev-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

    return {
      TransactionId: tid,
      PeriodId: targetTransaction.PeriodId,
      PersonId: targetTransaction.PersonId,
      PersonNameSnapshot: targetTransaction.PersonNameSnapshot,
      EntitlementType: entitlementType,
      DutyDomain: targetTransaction.DutyDomain,
      TransactionType: reversalType,
      Amount: isCredit ? -1 : 1, // Compensating amount
      EffectiveDate: targetTransaction.EffectiveDate,
      SourceType: targetTransaction.SourceType,
      SourceId: targetTransaction.TransactionId,
      SourceAssignmentId: targetTransaction.SourceAssignmentId || null,
      SourcePeriodId: targetTransaction.SourcePeriodId || targetTransaction.PeriodId,
      PublicHolidayDate: targetTransaction.PublicHolidayDate || null,
      PublicHolidayName: targetTransaction.PublicHolidayName || null,
      RosterAssignmentId: targetTransaction.RosterAssignmentId || null,
      RelatedTransactionId: targetTransaction.TransactionId,
      ReasonCode: isCredit ? 'CREDIT_REVERSAL' : 'CONSUMPTION_REVERSAL',
      AdminNote: adminNote || '',
      ExpiresAt: null,
      ExpiryPolicyCode: null,
      Status: ENTITLEMENT_TRANSACTION_STATUS.CONFIRMED,
      OperationId: operationId || '',
      CreatedAt: new Date().toISOString(),
      CreatedBy: reversedBy
    };
  }

  // Convenience aliases for GOFF-specific transactions
  function createGoffCreditTransaction(params) {
    return createEntitlementCreditTransaction({
      ...params,
      entitlementType: ENTITLEMENT_TYPES.GOFF,
      sourceType: params.sourceType || ENTITLEMENT_SOURCE_TYPES.DISPLACED_WEEKLY_OFF
    });
  }

  function createGhkaCreditTransaction(params) {
    return createEntitlementCreditTransaction({
      ...params,
      entitlementType: ENTITLEMENT_TYPES.GHKA,
      sourceType: params.sourceType || ENTITLEMENT_SOURCE_TYPES.PUBLIC_HOLIDAY_DUTY
    });
  }

  function createGoffConsumptionTransaction(params) {
    return createEntitlementConsumptionTransaction({
      ...params,
      entitlementType: ENTITLEMENT_TYPES.GOFF
    });
  }

  function createGhkaConsumptionTransaction(params) {
    return createEntitlementConsumptionTransaction({
      ...params,
      entitlementType: ENTITLEMENT_TYPES.GHKA
    });
  }

  function createGoffReversalTransaction(params) {
    return createEntitlementReversalTransaction(params);
  }

  /**
   * 12. Privacy Scrubber for Non-Admin Viewers
   *
   * Strips AdminNote, internal OperationIds, CreatedBy, and detailed source identifiers.
   */
  function scrubEntitlementViewerDto(transaction) {
    if (!transaction) return null;
    return {
      TransactionId: transaction.TransactionId,
      PeriodId: transaction.PeriodId,
      PersonId: transaction.PersonId,
      PersonNameSnapshot: transaction.PersonNameSnapshot,
      EntitlementType: transaction.EntitlementType,
      DutyDomain: transaction.DutyDomain,
      TransactionType: transaction.TransactionType,
      Amount: transaction.Amount,
      EffectiveDate: transaction.EffectiveDate,
      PublicHolidayDate: transaction.PublicHolidayDate || null,
      PublicHolidayName: transaction.PublicHolidayName || null,
      ExpiresAt: transaction.ExpiresAt || null,
      Status: transaction.Status
    };
  }

  function scrubGoffViewerDto(transaction) {
    return scrubEntitlementViewerDto(transaction);
  }

  return freeze({
    ENTITLEMENT_TYPES,
    ENTITLEMENT_TRANSACTION_TYPES,
    ENTITLEMENT_SOURCE_TYPES,
    ENTITLEMENT_TRANSACTION_STATUS,
    ENTITLEMENT_ERRORS,
    ROSTER_ENTITLEMENT_SCHEMAS,
    QUALIFYING_HOLIDAY_SHIFTS,

    // Aliases matching earlier naming for backward compatibility
    GOFF_TRANSACTION_TYPES: ENTITLEMENT_TRANSACTION_TYPES,
    GOFF_SOURCE_TYPES: ENTITLEMENT_SOURCE_TYPES,
    GOFF_TRANSACTION_STATUS: ENTITLEMENT_TRANSACTION_STATUS,
    GOFF_ERRORS: ENTITLEMENT_ERRORS,

    deriveEntitlementBalance,
    deriveAllEntitlementBalances,
    deriveGoffBalance,
    qualifiesForPublicHolidayCredit,
    qualifiesForDisplacedOffCredit,
    validateEntitlementConsumption,
    validateGoffConsumption,
    createEntitlementCreditTransaction,
    createEntitlementConsumptionTransaction,
    createEntitlementReversalTransaction,
    createGoffCreditTransaction,
    createGhkaCreditTransaction,
    createGoffConsumptionTransaction,
    createGhkaConsumptionTransaction,
    createGoffReversalTransaction,
    scrubEntitlementViewerDto,
    scrubGoffViewerDto
  });
})();

export default RosterEntitlement;
