import RosterCompatibility from './compatibility.js';
import RosterLifecycle from './lifecycle.js';

/**
 * Phase 6 Absence & Replacement Domain Foundation.
 * Pure deterministic contracts, schemas, validations, and resolver extensions.
 * No UI, no direct I/O, no network calls.
 */
const RosterAbsence = (() => {
  const freeze = value => {
    if (value && typeof value === 'object') {
      Object.values(value).forEach(freeze);
      Object.freeze(value);
    }
    return value;
  };

  /**
   * 1. Canonical Absence Types
   * Strictly operational absence codes.
   * DO NOT conflate with Phase 5 PublicReasonCode (e.g. DUTY_COVERAGE).
   */
  const ABSENCE_TYPES = freeze({
    MC: 'MC',         // Medical Certificate / Sick Leave
    EL: 'EL',         // Emergency Leave
    AL: 'AL',         // Annual Leave
    COURSE: 'COURSE'  // Course / Training
  });

  /**
   * 2. Canonical Coverage Statuses
   */
  const COVERAGE_STATUS = freeze({
    UNCOVERED: 'UNCOVERED',
    COVERED: 'COVERED',
    PARTIALLY_COVERED: 'PARTIALLY_COVERED'
  });

  /**
   * 3. Record Lifecycle Statuses
   */
  const ABSENCE_RECORD_STATUS = freeze({
    ACTIVE: 'ACTIVE',
    REVERSED: 'REVERSED'
  });

  const REPLACEMENT_RECORD_STATUS = freeze({
    ACTIVE: 'ACTIVE',
    REVERSED: 'REVERSED'
  });

  /**
   * 4. Canonical Error Codes
   */
  const ABSENCE_ERRORS = freeze({
    INVALID_ABSENCE_TYPE: 'INVALID_ABSENCE_TYPE',
    INVALID_DATE_RANGE: 'INVALID_DATE_RANGE',
    OVERLAPPING_ABSENCE: 'OVERLAPPING_ABSENCE',
    ABSENCE_NOT_FOUND: 'ABSENCE_NOT_FOUND',
    ABSENCE_ALREADY_REVERSED: 'ABSENCE_ALREADY_REVERSED',
    REPLACEMENT_DEPENDENCY_CONFLICT: 'REPLACEMENT_DEPENDENCY_CONFLICT',
    REPLACEMENT_NOT_FOUND: 'REPLACEMENT_NOT_FOUND',
    REPLACEMENT_ALREADY_REVERSED: 'REPLACEMENT_ALREADY_REVERSED',
    DUTY_DOMAIN_MISMATCH: 'DUTY_DOMAIN_MISMATCH',
    INVALID_PERSON_IDENTITY: 'INVALID_PERSON_IDENTITY',
    INVALID_ASSIGNMENT: 'INVALID_ASSIGNMENT',
    VALIDATION_FAILED: 'VALIDATION_FAILED',
    SHORTAGE_ACCEPTANCE_REQUIRED: 'SHORTAGE_ACCEPTANCE_REQUIRED'
  });

  /**
   * 5. Phase 6 Additive Schemas
   */
  const ABSENCE_SCHEMAS = freeze({
    RosterAbsences: [
      'AbsenceId',
      'PeriodId',
      'PersonId',
      'PersonNameSnapshot',
      'AbsenceType',
      'StartDate',
      'EndDate',
      'DutyDomain',
      'PublicReason',
      'AdminNote',
      'Status',
      'OperationId',
      'CreatedAt',
      'CreatedBy'
    ],
    RosterReplacements: [
      'ReplacementId',
      'AbsenceId',
      'OriginalAssignmentId',
      'ReplacementPersonId',
      'ReplacementAssignmentId',
      'DutyDomain',
      'Date',
      'ShiftCode',
      'Status',
      'OperationId',
      'CreatedAt',
      'CreatedBy'
    ]
  });

  const fail = (code, message) => {
    const err = new Error(message || code);
    err.code = code;
    return err;
  };

  const isUuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
  const genUuid = () => typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : (typeof Utilities !== 'undefined' && Utilities.getUuid ? Utilities.getUuid() : '00000000-0000-4000-8000-000000000000');

  function isValidAbsenceType(code) {
    if (!code || typeof code !== 'string') return false;
    const clean = code.trim().toUpperCase();
    return Object.values(ABSENCE_TYPES).includes(clean);
  }

  function validateAbsenceType(code) {
    if (!isValidAbsenceType(code)) {
      throw fail(ABSENCE_ERRORS.INVALID_ABSENCE_TYPE, `Invalid absence type '${code}'. Authorized canonical types: ${Object.values(ABSENCE_TYPES).join(', ')}`);
    }
    return code.trim().toUpperCase();
  }

  function validateDutyDomain(domain) {
    const clean = String(domain || '').trim().toUpperCase();
    if (!['MO', 'EP'].includes(clean)) {
      throw fail(ABSENCE_ERRORS.DUTY_DOMAIN_MISMATCH, `Invalid duty domain '${domain}'. Must be 'MO' or 'EP'`);
    }
    return clean;
  }

  function validateDate(dateStr, fieldName = 'Date') {
    const valid = RosterCompatibility.localDate(dateStr);
    if (!valid) {
      throw fail(ABSENCE_ERRORS.INVALID_DATE_RANGE, `${fieldName} '${dateStr}' is not a valid ISO date (YYYY-MM-DD)`);
    }
    return valid;
  }

  /**
   * Deterministic UUID generation for absence entities
   */
  function deterministicAbsenceId(operationId, personId, startDate, endDate, dutyDomain, digestFn) {
    const seed = `absence:${operationId}:${personId}:${startDate}:${endDate}:${dutyDomain}`;
    return RosterLifecycle.deterministicUuid(seed, digestFn);
  }

  function deterministicReplacementId(operationId, absenceId, originalAssignmentId, replacementPersonId, digestFn) {
    const seed = `replacement:${operationId}:${absenceId}:${originalAssignmentId}:${replacementPersonId}`;
    return RosterLifecycle.deterministicUuid(seed, digestFn);
  }

  /**
   * Check for overlapping active absences for the same PersonId + DutyDomain.
   * Fail-closed: overlapping date ranges for the same person and duty domain are strictly rejected.
   */
  function checkAbsenceOverlap({ candidateAbsence, existingAbsences = [] }) {
    const personId = String(candidateAbsence.PersonId || '').trim();
    const dutyDomain = validateDutyDomain(candidateAbsence.DutyDomain);
    const start = validateDate(candidateAbsence.StartDate, 'StartDate');
    const end = validateDate(candidateAbsence.EndDate, 'EndDate');

    if (start > end) {
      throw fail(ABSENCE_ERRORS.INVALID_DATE_RANGE, `StartDate '${start}' cannot be after EndDate '${end}'`);
    }

    for (const existing of existingAbsences) {
      if (existing.Status !== ABSENCE_RECORD_STATUS.ACTIVE) continue;
      if (candidateAbsence.AbsenceId && existing.AbsenceId === candidateAbsence.AbsenceId) continue;
      if (existing.PersonId !== personId) continue;
      if (existing.DutyDomain !== dutyDomain) continue;

      const eStart = existing.StartDate;
      const eEnd = existing.EndDate;

      // Range overlap check: start <= eEnd && end >= eStart
      if (start <= eEnd && end >= eStart) {
        throw fail(
          ABSENCE_ERRORS.OVERLAPPING_ABSENCE,
          `Absence for PersonId '${personId}' on domain '${dutyDomain}' [${start} -> ${end}] overlaps with existing active absence '${existing.AbsenceId}' [${eStart} -> ${eEnd}] (${existing.AbsenceType})`
        );
      }
    }
    return true;
  }

  /**
   * Create and validate an authoritative RosterAbsence record.
   */
  function createAbsenceRecord({
    absenceId,
    periodId,
    personId,
    personNameSnapshot = '',
    absenceType,
    startDate,
    endDate,
    dutyDomain = 'MO',
    publicReason = 'DUTY_COVERAGE',
    adminNote = '',
    status = ABSENCE_RECORD_STATUS.ACTIVE,
    operationId,
    actor = 'admin',
    timestamp = new Date().toISOString(),
    existingAbsences = [],
    digestFn
  }) {
    RosterCompatibility.validatePeriod(periodId);
    const cleanPersonId = String(personId || '').trim();
    if (!cleanPersonId) {
      throw fail(ABSENCE_ERRORS.INVALID_PERSON_IDENTITY, 'PersonId is required for absence record');
    }

    const cleanType = validateAbsenceType(absenceType);
    const cleanDomain = validateDutyDomain(dutyDomain);
    const cleanStart = validateDate(startDate, 'StartDate');
    const cleanEnd = validateDate(endDate, 'EndDate');

    if (cleanStart > cleanEnd) {
      throw fail(ABSENCE_ERRORS.INVALID_DATE_RANGE, `StartDate '${cleanStart}' cannot be after EndDate '${cleanEnd}'`);
    }

    // Verify StartDate and EndDate fall reasonably within or relate to the PeriodId
    const startPeriod = cleanStart.slice(0, 7);
    const endPeriod = cleanEnd.slice(0, 7);
    if (startPeriod !== periodId && endPeriod !== periodId) {
      throw fail(ABSENCE_ERRORS.INVALID_DATE_RANGE, `Absence range [${cleanStart} -> ${cleanEnd}] does not intersect period '${periodId}'`);
    }

    const cleanOpId = String(operationId || '').trim();
    if (!cleanOpId || !isUuid(cleanOpId)) {
      throw fail(ABSENCE_ERRORS.VALIDATION_FAILED, `OperationId '${operationId}' must be a valid UUID`);
    }

    const finalAbsenceId = absenceId && isUuid(absenceId)
      ? absenceId
      : deterministicAbsenceId(cleanOpId, cleanPersonId, cleanStart, cleanEnd, cleanDomain, digestFn);

    const record = {
      AbsenceId: finalAbsenceId,
      PeriodId: periodId,
      PersonId: cleanPersonId,
      PersonNameSnapshot: String(personNameSnapshot || '').trim(),
      AbsenceType: cleanType,
      StartDate: cleanStart,
      EndDate: cleanEnd,
      DutyDomain: cleanDomain,
      PublicReason: String(publicReason || 'DUTY_COVERAGE').trim(),
      AdminNote: String(adminNote || '').trim(),
      Status: status === ABSENCE_RECORD_STATUS.REVERSED ? ABSENCE_RECORD_STATUS.REVERSED : ABSENCE_RECORD_STATUS.ACTIVE,
      OperationId: cleanOpId,
      CreatedAt: timestamp,
      CreatedBy: String(actor || 'admin').trim()
    };

    // If active, validate no overlap with existing active absences
    if (record.Status === ABSENCE_RECORD_STATUS.ACTIVE) {
      checkAbsenceOverlap({ candidateAbsence: record, existingAbsences });
    }

    return freeze(record);
  }

  /**
   * Create and validate an authoritative RosterReplacement record.
   */
  function createReplacementRecord({
    replacementId,
    absenceId,
    originalAssignmentId,
    replacementPersonId,
    replacementAssignmentId,
    dutyDomain = 'MO',
    date,
    shiftCode,
    status = REPLACEMENT_RECORD_STATUS.ACTIVE,
    operationId,
    actor = 'admin',
    timestamp = new Date().toISOString(),
    absences = [],
    digestFn
  }) {
    const cleanAbsenceId = String(absenceId || '').trim();
    if (!cleanAbsenceId || !isUuid(cleanAbsenceId)) {
      throw fail(ABSENCE_ERRORS.ABSENCE_NOT_FOUND, `Invalid absenceId '${absenceId}'`);
    }

    // Must link to a registered, active absence
    const targetAbsence = absences.find(a => a.AbsenceId === cleanAbsenceId);
    if (!targetAbsence) {
      throw fail(ABSENCE_ERRORS.ABSENCE_NOT_FOUND, `Target absence '${cleanAbsenceId}' not found`);
    }
    if (targetAbsence.Status !== ABSENCE_RECORD_STATUS.ACTIVE) {
      throw fail(ABSENCE_ERRORS.ABSENCE_ALREADY_REVERSED, `Target absence '${cleanAbsenceId}' is not active (Status: ${targetAbsence.Status})`);
    }

    const cleanDate = validateDate(date, 'Date');
    if (cleanDate < targetAbsence.StartDate || cleanDate > targetAbsence.EndDate) {
      throw fail(
        ABSENCE_ERRORS.INVALID_DATE_RANGE,
        `Replacement date '${cleanDate}' is outside target absence date range [${targetAbsence.StartDate} -> ${targetAbsence.EndDate}]`
      );
    }

    const cleanDomain = validateDutyDomain(dutyDomain);
    if (cleanDomain !== targetAbsence.DutyDomain) {
      throw fail(
        ABSENCE_ERRORS.DUTY_DOMAIN_MISMATCH,
        `Replacement DutyDomain '${cleanDomain}' does not match target absence DutyDomain '${targetAbsence.DutyDomain}'`
      );
    }

    const cleanOrigAssignId = String(originalAssignmentId || '').trim();
    if (!cleanOrigAssignId) {
      throw fail(ABSENCE_ERRORS.INVALID_ASSIGNMENT, 'OriginalAssignmentId is required for replacement');
    }

    const cleanReplPersonId = String(replacementPersonId || '').trim();
    if (!cleanReplPersonId) {
      throw fail(ABSENCE_ERRORS.INVALID_PERSON_IDENTITY, 'ReplacementPersonId is required');
    }
    if (cleanReplPersonId === targetAbsence.PersonId) {
      throw fail(ABSENCE_ERRORS.VALIDATION_FAILED, `ReplacementPersonId '${cleanReplPersonId}' cannot be identical to absent PersonId`);
    }

    const cleanShiftCode = String(shiftCode || '').trim().toUpperCase();
    if (!cleanShiftCode) {
      throw fail(ABSENCE_ERRORS.VALIDATION_FAILED, 'ShiftCode is required for replacement');
    }

    const cleanOpId = String(operationId || '').trim();
    if (!cleanOpId || !isUuid(cleanOpId)) {
      throw fail(ABSENCE_ERRORS.VALIDATION_FAILED, `OperationId '${operationId}' must be a valid UUID`);
    }

    const finalReplacementId = replacementId && isUuid(replacementId)
      ? replacementId
      : deterministicReplacementId(cleanOpId, cleanAbsenceId, cleanOrigAssignId, cleanReplPersonId, digestFn);

    const finalReplAssignmentId = replacementAssignmentId && isUuid(replacementAssignmentId)
      ? replacementAssignmentId
      : RosterLifecycle.deterministicAssignmentId(cleanOpId, cleanReplPersonId, cleanDate, cleanDomain, cleanShiftCode, 0, digestFn);

    const record = {
      ReplacementId: finalReplacementId,
      AbsenceId: cleanAbsenceId,
      OriginalAssignmentId: cleanOrigAssignId,
      ReplacementPersonId: cleanReplPersonId,
      ReplacementAssignmentId: finalReplAssignmentId,
      DutyDomain: cleanDomain,
      Date: cleanDate,
      ShiftCode: cleanShiftCode,
      Status: status === REPLACEMENT_RECORD_STATUS.REVERSED ? REPLACEMENT_RECORD_STATUS.REVERSED : REPLACEMENT_RECORD_STATUS.ACTIVE,
      OperationId: cleanOpId,
      CreatedAt: timestamp,
      CreatedBy: String(actor || 'admin').trim()
    };

    return freeze(record);
  }

  /**
   * Find roster assignments affected by a given absence.
   * Only matches assignments within [StartDate, EndDate] for the same PersonId & DutyDomain.
   * Does NOT invent assignments for unassigned or non-working days.
   */
  function findAffectedAssignments({ absence, assignments = [] }) {
    if (!absence || !absence.PersonId || !absence.StartDate || !absence.EndDate) {
      return [];
    }
    const domain = absence.DutyDomain || 'MO';
    return assignments.filter(a => {
      if (a.PersonId !== absence.PersonId) return false;
      if (a.DutyDomain !== domain) return false;
      if (a.Date < absence.StartDate || a.Date > absence.EndDate) return false;
      // Only working duties are affected assignments requiring operational coverage
      const code = a.ShiftCode || '';
      return code && code !== 'OFF';
    });
  }

  /**
   * Derive coverage status of an absence based on affected assignments and active replacements.
   */
  function deriveAbsenceCoverageStatus({ absence, affectedAssignments = [], replacements = [] }) {
    if (!affectedAssignments || affectedAssignments.length === 0) {
      return COVERAGE_STATUS.COVERED; // No duties affected, no shortage
    }

    const activeReplacements = replacements.filter(r =>
      r.AbsenceId === absence.AbsenceId &&
      r.Status === REPLACEMENT_RECORD_STATUS.ACTIVE
    );

    let coveredCount = 0;
    for (const a of affectedAssignments) {
      const isCovered = activeReplacements.some(r =>
        (r.OriginalAssignmentId === a.AssignmentId || r.Date === a.Date) &&
        r.DutyDomain === a.DutyDomain
      );
      if (isCovered) {
        coveredCount++;
      }
    }

    if (coveredCount === 0) return COVERAGE_STATUS.UNCOVERED;
    if (coveredCount === affectedAssignments.length) return COVERAGE_STATUS.COVERED;
    return COVERAGE_STATUS.PARTIALLY_COVERED;
  }

  /**
   * Validate shortage acceptance.
   * Uncovered or partially covered absences require explicit shortage acceptance.
   */
  function validateShortageAcceptance({ shortageAccepted, shortageReason, coverageStatus }) {
    if (coverageStatus === COVERAGE_STATUS.UNCOVERED || coverageStatus === COVERAGE_STATUS.PARTIALLY_COVERED) {
      const accepted = shortageAccepted === true || String(shortageAccepted).trim().toUpperCase() === 'TRUE';
      const reason = String(shortageReason || '').trim();
      if (!accepted || !reason) {
        throw fail(
          ABSENCE_ERRORS.SHORTAGE_ACCEPTANCE_REQUIRED,
          `Coverage status is ${coverageStatus}. Explicit ShortageAccepted: true and non-empty ShortageReason are required.`
        );
      }
    }
    return true;
  }

  /**
   * Dependency Protection & Reversal:
   * 1. Can reverse an absence?
   *    Blocked if active replacements depend on it.
   */
  function canReverseAbsence({ absenceId, absences = [], replacements = [] }) {
    const targetAbsence = absences.find(a => a.AbsenceId === absenceId);
    if (!targetAbsence) {
      throw fail(ABSENCE_ERRORS.ABSENCE_NOT_FOUND, `Absence '${absenceId}' not found`);
    }
    if (targetAbsence.Status === ABSENCE_RECORD_STATUS.REVERSED) {
      throw fail(ABSENCE_ERRORS.ABSENCE_ALREADY_REVERSED, `Absence '${absenceId}' is already reversed`);
    }

    const activeDependentReplacements = replacements.filter(r =>
      r.AbsenceId === absenceId &&
      r.Status === REPLACEMENT_RECORD_STATUS.ACTIVE
    );

    if (activeDependentReplacements.length > 0) {
      return {
        canReverse: false,
        reason: ABSENCE_ERRORS.REPLACEMENT_DEPENDENCY_CONFLICT,
        activeDependentReplacements,
        targetAbsence
      };
    }

    return {
      canReverse: true,
      targetAbsence
    };
  }

  /**
   * Reverse an absence (append-only / compensating update).
   * Throws REPLACEMENT_DEPENDENCY_CONFLICT if active replacements depend on it.
   */
  function reverseAbsence({
    absenceId,
    absences = [],
    replacements = [],
    actor = 'admin',
    operationId,
    timestamp = new Date().toISOString()
  }) {
    const check = canReverseAbsence({ absenceId, absences, replacements });
    if (!check.canReverse) {
      throw fail(
        ABSENCE_ERRORS.REPLACEMENT_DEPENDENCY_CONFLICT,
        `Cannot reverse absence '${absenceId}': ${check.activeDependentReplacements.length} active replacement(s) depend on it. Reverse dependent replacement(s) first.`
      );
    }

    const reversed = {
      ...check.targetAbsence,
      Status: ABSENCE_RECORD_STATUS.REVERSED,
      OperationId: operationId || check.targetAbsence.OperationId,
      UpdatedAt: timestamp,
      ReversedBy: actor,
      ReversedAt: timestamp
    };

    return freeze(reversed);
  }

  /**
   * 2. Can reverse a replacement?
   */
  function canReverseReplacement({ replacementId, replacements = [] }) {
    const target = replacements.find(r => r.ReplacementId === replacementId);
    if (!target) {
      throw fail(ABSENCE_ERRORS.REPLACEMENT_NOT_FOUND, `Replacement '${replacementId}' not found`);
    }
    if (target.Status === REPLACEMENT_RECORD_STATUS.REVERSED) {
      throw fail(ABSENCE_ERRORS.REPLACEMENT_ALREADY_REVERSED, `Replacement '${replacementId}' is already reversed`);
    }

    return {
      canReverse: true,
      targetReplacement: target
    };
  }

  /**
   * Reverse a replacement (append-only / compensating update).
   * Leaves the absence active, returning the affected assignment to UNCOVERED.
   */
  function reverseReplacement({
    replacementId,
    replacements = [],
    actor = 'admin',
    operationId,
    timestamp = new Date().toISOString()
  }) {
    const check = canReverseReplacement({ replacementId, replacements });
    const reversed = {
      ...check.targetReplacement,
      Status: REPLACEMENT_RECORD_STATUS.REVERSED,
      OperationId: operationId || check.targetReplacement.OperationId,
      UpdatedAt: timestamp,
      ReversedBy: actor,
      ReversedAt: timestamp
    };
    return freeze(reversed);
  }

  /**
   * Privacy / Viewer DTO.
   * Strips sensitive AdminNote and private fields.
   */
  function toPublicAbsenceDto(absence) {
    if (!absence) return null;
    return freeze({
      AbsenceId: absence.AbsenceId,
      PeriodId: absence.PeriodId,
      PersonId: absence.PersonId,
      PersonNameSnapshot: absence.PersonNameSnapshot || '',
      AbsenceType: absence.AbsenceType,
      StartDate: absence.StartDate,
      EndDate: absence.EndDate,
      DutyDomain: absence.DutyDomain,
      PublicReason: absence.PublicReason || 'DUTY_COVERAGE',
      Status: absence.Status,
      CreatedAt: absence.CreatedAt
    });
  }

  /**
   * Extended Current Roster Resolver with Absence & Replacement Support.
   *
   * Canonical Resolution Pipeline Order:
   * 1. Baseline Planned assignments (immutable)
   * 2. Confirmed Phase 5 amendment event lines (ADMIN_CORRECTION, SWAP, REVERSAL)
   * 3. Confirmed active absences (marks affected working duties UNCOVERED with AbsenceType)
   * 4. Confirmed active replacements (marks absent assignment COVERED, places replacement person on duty)
   */
  function resolveCurrentRosterWithAbsence({
    periodId,
    plannedAssignments = [],
    events = [],
    absences = [],
    replacements = [],
    people = [],
    digestFn
  }) {
    RosterCompatibility.validatePeriod(periodId);

    const result = RosterLifecycle.resolveCurrentRoster({
      periodId,
      plannedAssignments,
      events,
      absences,
      replacements,
      people,
      digestFn
    });

    const currentAssignments = result.currentAssignments;
    // Attach metadata properties for convenience
    currentAssignments.periodId = result.periodId;
    currentAssignments.effectiveState = result.effectiveState;
    currentAssignments.activeAmendmentCount = result.activeAmendmentCount;
    currentAssignments.activeAbsences = result.activeAbsences;
    currentAssignments.activeReplacements = result.activeReplacements;
    currentAssignments.masterRosterProjection = result.masterRosterProjection;
    currentAssignments.projectionChecksum = result.projectionChecksum;
    currentAssignments.currentCells = result.currentCells;
    currentAssignments.events = result.events;

    return currentAssignments;
  }

  return freeze({
    ABSENCE_TYPES,
    COVERAGE_STATUS,
    ABSENCE_RECORD_STATUS,
    REPLACEMENT_RECORD_STATUS,
    ABSENCE_ERRORS,
    ABSENCE_SCHEMAS,
    isValidAbsenceType,
    validateAbsenceType,
    validateDutyDomain,
    createAbsenceRecord,
    createReplacementRecord,
    checkAbsenceOverlap,
    findAffectedAssignments,
    deriveAbsenceCoverageStatus,
    validateShortageAcceptance,
    canReverseAbsence,
    reverseAbsence,
    canReverseReplacement,
    reverseReplacement,
    toPublicAbsenceDto,
    resolveCurrentRosterWithAbsence,
    deterministicAbsenceId,
    deterministicReplacementId
  });
})();

export default RosterAbsence;
