import RosterCompatibility from '../compatibility.js';

/**
 * Validates and converts a single normalized roster assignment into a calendar-compatible row:
 * { Name, Date, Shift } plus identity/domain metadata.
 *
 * Invariants:
 * 1. Output object contains Name, Date, Shift matching calendar expectations.
 * 2. Identity and dutyDomain metadata are preserved on the projected row.
 * 3. Certified shift semantics (AMX, PMX, ON1, ON2, PN, standby, extended) are preserved.
 * 4. EP records are tagged with dutyDomain: 'EP' and never converted to MO assignments.
 * 5. Fails visibly on unsafe, malformed, or unsupported records.
 * 6. Non-mutating: does not modify input record.
 */
export function projectAssignmentToCalendarRow(assignment, { strict = true } = {}) {
  if (!assignment || typeof assignment !== 'object') {
    throw new TypeError(
      `Invalid assignment record: expected an object, received ${assignment === null ? 'null' : typeof assignment}`
    );
  }

  // 1. Validate Date
  const rawDate = assignment.date || assignment.Date;
  const isoDate = RosterCompatibility.localDate(rawDate);
  if (!isoDate || !/^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/.test(isoDate)) {
    throw new Error(`Invalid assignment date: "${rawDate}". Expected ISO YYYY-MM-DD.`);
  }

  // 2. Validate Identity
  const nameCandidate = assignment.personNameSnapshot || assignment.Name || assignment.name;
  const personIdCandidate = assignment.personId || assignment.PersonId;
  const cleanName = String(nameCandidate || '').trim();
  const cleanPersonId = String(personIdCandidate || '').trim();

  if (!cleanName && !cleanPersonId) {
    throw new Error('Invalid assignment identity: missing both personNameSnapshot and personId.');
  }

  const displayName = cleanName || cleanPersonId;

  // 3. Validate Domain
  const rawDomain = (
    assignment.dutyDomain ||
    assignment.DutyDomain ||
    assignment.role ||
    'MO'
  ).toString().trim().toUpperCase();

  if (rawDomain !== 'MO' && rawDomain !== 'EP') {
    throw new Error(`Invalid dutyDomain "${rawDomain}". Must be "MO" or "EP".`);
  }

  // 4. Validate Shift and Modifiers
  const rawShiftVal = assignment.rawShift !== undefined ? String(assignment.rawShift).trim() : '';
  const shiftCodeVal = assignment.shiftCode !== undefined ? String(assignment.shiftCode).trim() : '';

  if (!rawShiftVal && !shiftCodeVal) {
    throw new Error(`Invalid assignment shift: missing shiftCode and rawShift for ${displayName} on ${isoDate}.`);
  }

  const shiftToResolve = rawShiftVal || shiftCodeVal;
  const semantics = RosterCompatibility.resolveShift(shiftToResolve);

  if (!semantics.known) {
    throw new Error(`Unsupported shift code: "${shiftToResolve}". Certified semantics do not recognize this shift.`);
  }

  // Strict domain enforcement: EP shifts only for EP domain, MO shifts only for MO domain
  if (rawDomain === 'EP' && semantics.directoryType !== 'EP') {
    throw new Error(`Domain mismatch: shift "${shiftToResolve}" is an MO shift but assigned to EP domain.`);
  }
  if (rawDomain === 'MO' && semantics.directoryType === 'EP') {
    throw new Error(`Domain mismatch: shift "${shiftToResolve}" is an EP shift but assigned to MO domain.`);
  }

  const isStandby = Boolean(
    assignment.modifiers?.standby !== undefined
      ? assignment.modifiers.standby
      : semantics.modifiers?.standby
  );
  const isExtended = Boolean(
    assignment.modifiers?.extended !== undefined
      ? assignment.modifiers.extended
      : semantics.modifiers?.extended
  );

  // 5. Construct certified calendar Shift representation
  let calendarShift = '';
  // If rawShift already faithfully matches canonicalCode + modifiers, preserve rawShift exactly (e.g. 'AMX', 'PMX', 'ON1', 'ON2', 'PN', 'AM (S)', 'AM-S')
  const rawSemantics = rawShiftVal ? RosterCompatibility.resolveShift(rawShiftVal, rawDomain) : null;
  if (
    rawSemantics &&
    rawSemantics.known &&
    rawSemantics.canonicalCode === semantics.canonicalCode &&
    Boolean(rawSemantics.modifiers?.standby) === isStandby &&
    Boolean(rawSemantics.modifiers?.extended) === isExtended
  ) {
    calendarShift = rawShiftVal;
  } else {
    // Reconstruct canonical shift with modifiers
    calendarShift = semantics.canonicalCode;
    if (isStandby) calendarShift += ' (S)';
    if (isExtended) calendarShift += ' (X)';
  }

  return {
    Name: displayName,
    Date: isoDate,
    Shift: calendarShift,
    // Preserved metadata
    personId: cleanPersonId || null,
    dutyDomain: rawDomain,
    shiftCode: semantics.canonicalCode,
    modifiers: {
      standby: isStandby,
      extended: isExtended
    },
    rawShift: rawShiftVal || calendarShift,
    assignmentKey:
      assignment.assignmentKey ||
      assignment.assignmentId ||
      `${cleanPersonId || displayName}:${isoDate}:${rawDomain}:${semantics.canonicalCode}`,
    sourceType: assignment.sourceType || 'NORMALIZED_ASSIGNMENT'
  };
}

/**
 * Projects a collection of normalized assignments or a resolved roster result into
 * an array of calendar-compatible { Name, Date, Shift } rows.
 *
 * Guaranteed non-mutating on inputs.
 */
export function projectNormalizedAssignmentsToCalendarRows(assignmentsOrResolved, options = {}) {
  let list = [];
  if (assignmentsOrResolved && Array.isArray(assignmentsOrResolved.assignments)) {
    list = assignmentsOrResolved.assignments;
  } else if (Array.isArray(assignmentsOrResolved)) {
    list = assignmentsOrResolved;
  } else if (assignmentsOrResolved === null || assignmentsOrResolved === undefined) {
    if (options.strict) {
      throw new TypeError(
        `Invalid assignments input: expected array or resolved roster object, received ${assignmentsOrResolved}`
      );
    }
    return [];
  } else {
    throw new TypeError(
      `Invalid assignments input: expected array or resolved roster object, received ${typeof assignmentsOrResolved}`
    );
  }

  return list.map((item) => projectAssignmentToCalendarRow(item, options));
}

/**
 * Alias matching the integration architecture specification for RosterPage.
 */
export const projectResolvedAssignmentsToLegacyRows = projectNormalizedAssignmentsToCalendarRows;

/**
 * Filters rows for Medical Officer (MO) domain only.
 */
export function isMoCalendarRow(row) {
  return Boolean(row && typeof row === 'object' && row.dutyDomain === 'MO');
}

/**
 * Filters rows for Emergency Physician (EP) domain only.
 */
export function isEpCalendarRow(row) {
  return Boolean(row && typeof row === 'object' && row.dutyDomain === 'EP');
}

/**
 * Returns only MO rows from a list of projected calendar rows.
 */
export function filterMoCalendarRows(rows = []) {
  if (!Array.isArray(rows)) return [];
  return rows.filter(isMoCalendarRow);
}

/**
 * Returns only EP rows from a list of projected calendar rows.
 */
export function filterEpCalendarRows(rows = []) {
  if (!Array.isArray(rows)) return [];
  return rows.filter(isEpCalendarRow);
}

/**
 * Projects normalized assignments or resolved roster source into a structured calendar dataset
 * with separated MO and EP partitions.
 */
export function projectCalendarDataset(assignmentsOrResolved, options = {}) {
  const allRows = projectNormalizedAssignmentsToCalendarRows(assignmentsOrResolved, options);
  const moRows = filterMoCalendarRows(allRows);
  const epRows = filterEpCalendarRows(allRows);

  return {
    allRows,
    moRows,
    epRows
  };
}

export default {
  projectAssignmentToCalendarRow,
  projectNormalizedAssignmentsToCalendarRows,
  projectResolvedAssignmentsToLegacyRows,
  isMoCalendarRow,
  isEpCalendarRow,
  filterMoCalendarRows,
  filterEpCalendarRows,
  projectCalendarDataset
};
