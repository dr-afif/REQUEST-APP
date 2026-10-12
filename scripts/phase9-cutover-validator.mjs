import fs from 'node:fs';
import path from 'node:path';

/**
 * Phase 9 Cutover-Period Preparation Contract & Dry-Run Validator
 *
 * Validates that all prerequisites for enrolling and publishing a specific
 * cutover period (YYYY-MM) are met prior to execution.
 *
 * Parameters checked:
 * 1. CUTOVER_PERIOD format: valid YYYY-MM.
 * 2. RosterPeriods enrollment status: not already enrolled unless explicitly resuming.
 * 3. MasterRoster baseline: target month historical baseline recorded.
 * 4. OffPolicies coverage: active policy covers all calendar weeks of the period.
 * 5. Identity registry: all assigned/draft staff exist in RosterPeople.
 * 6. Shift semantics catalog: all shift codes in draft/assignments have active semantics.
 */

export function getMondaysInMonth(year, month) {
  const mondays = [];
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  for (let day = 1; day <= daysInMonth; day++) {
    const d = new Date(Date.UTC(year, month - 1, day));
    if (d.getUTCDay() === 1) { // Monday
      mondays.push(d.toISOString().slice(0, 10));
    }
  }
  return mondays;
}

export function validateCutoverPeriod({
  periodId,
  enrolledPeriods = [],
  masterRosterMonthCounts = {},
  offPolicies = [],
  rosterPeople = [],
  shiftSemantics = [],
  draftCells = {},
  resume = false
}) {
  const errors = [];
  const warnings = [];

  // 1. Format check
  if (!periodId || !/^\d{4}-(0[1-9]|1[0-2])$/.test(periodId)) {
    errors.push(`Invalid CUTOVER_PERIOD: "${periodId}". Must be in YYYY-MM format.`);
    return { isValid: false, errors, warnings };
  }

  const [yearStr, monthStr] = periodId.split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);

  // 2. Existing enrollment check
  const alreadyEnrolled = enrolledPeriods.some(p => {
    const pId = typeof p === 'string' ? p : (p.PeriodId || p.periodId);
    return pId === periodId;
  });

  if (alreadyEnrolled && !resume) {
    errors.push(`Period ${periodId} is already enrolled in RosterPeriods. Cutover requires a fresh period or explicit resume=true.`);
  }

  // 3. MasterRoster Baseline Check
  const hasMasterRosterBaseline = Object.prototype.hasOwnProperty.call(masterRosterMonthCounts, periodId);
  if (!hasMasterRosterBaseline) {
    warnings.push(`Target month ${periodId} has 0 existing rows in MasterRoster baseline (standard for new future month cutover).`);
  }

  // 4. OffPolicies Coverage
  // Find Mondays for the period
  const mondays = getMondaysInMonth(year, month);
  const activePolicies = offPolicies.filter(p => p.Active !== false && String(p.Active).toLowerCase() !== 'false');

  if (activePolicies.length === 0) {
    errors.push(`No active OffPolicies found. aggregateWeeklyOffSnapshots will fail with INVALID_OFF_POLICY.`);
  } else {
    // Verify policy coverage for each Monday
    mondays.forEach(monday => {
      const covers = activePolicies.some(p => {
        const effMon = p.EffectiveMonday || p.effectiveMonday;
        return effMon && effMon <= monday;
      });
      if (!covers) {
        errors.push(`No active OffPolicy with EffectiveMonday <= ${monday} for cutover period week starting ${monday}.`);
      }
    });
  }

  // 5. Identity Registry Coverage
  const knownPersonIds = new Set(
    rosterPeople.map(p => typeof p === 'string' ? p : (p.PersonId || p.personId)).filter(Boolean)
  );

  const referencedPersonIds = new Set();
  const referencedShiftCodes = new Set();

  Object.entries(draftCells).forEach(([cellKey, cellVal]) => {
    // cellKey format: `${personId}/${date}`
    const [pid] = cellKey.split('/');
    if (pid) referencedPersonIds.add(pid);

    const shiftEntries = Array.isArray(cellVal) ? cellVal : [cellVal];
    shiftEntries.forEach(entry => {
      const code = typeof entry === 'string' ? entry : (entry?.rawShift || entry?.shiftCode);
      if (code && code !== 'OFF') referencedShiftCodes.add(code.trim().toUpperCase());
    });
  });

  referencedPersonIds.forEach(pid => {
    if (!knownPersonIds.has(pid)) {
      errors.push(`Assigned person ID "${pid}" is not registered in RosterPeople. generatePlannedSnapshot will fail with VALIDATION_FAILED.`);
    }
  });

  // 6. Shift Semantics Catalog Coverage
  const knownShiftCodes = new Set(
    shiftSemantics.map(s => {
      const code = typeof s === 'string' ? s : (s.ShiftCode || s.shiftCode);
      return String(code || '').trim().toUpperCase();
    }).filter(Boolean)
  );

  referencedShiftCodes.forEach(shiftCode => {
    if (!knownShiftCodes.has(shiftCode)) {
      errors.push(`Shift code "${shiftCode}" has no registered entry in ShiftSemantics.`);
    }
  });

  return {
    periodId,
    isValid: errors.length === 0,
    errors,
    warnings,
    summary: {
      mondaysInPeriod: mondays.length,
      activeOffPolicies: activePolicies.length,
      registeredPeopleCount: knownPersonIds.size,
      registeredShiftCodesCount: knownShiftCodes.size,
      referencedDoctorsInDraft: referencedPersonIds.size,
      referencedShiftCodesInDraft: referencedShiftCodes.size
    }
  };
}
