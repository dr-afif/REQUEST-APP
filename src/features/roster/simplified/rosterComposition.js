import { normalizeForComparison, toIsoDate } from '../../../utils/normalise.js';
import { mapName } from '../../../utils/adapters.js';

export const CLEAR_MARKER = '__CLEAR__';
export const FIELD_MO_SHIFT = 'MO_SHIFT';
export const FIELD_EP_OFFICE_HOUR = 'EP_OFFICE_HOUR';
export const FIELD_EP_ONCALL = 'EP_ONCALL';
export const EP_SLOT_STAFF_KEY = '__EP__';

/**
 * Checks whether a shift token represents an Emergency Physician (EP) daily slot.
 */
export function isEpSlotShift(shift) {
  const up = String(shift || '').trim().toUpperCase();
  return up === FIELD_EP_OFFICE_HOUR || up === FIELD_EP_ONCALL;
}

/**
 * Resolves a staff member's stable identifier (`staffKey`) and canonical display name
 * using `teamMembers` / directory records (`staffId` preferred over display name alone)
 * plus legacy alias normalization (`SYU` -> `SYUHADA`).
 */
export function resolveStaffIdentity(rawIdentifier, rawFallbackName = '', teamMembers = []) {
  const cleanId = String(rawIdentifier || '').trim();
  const cleanFallback = String(rawFallbackName || '').trim();
  const mappedId = mapName(cleanId);
  const mappedFallback = mapName(cleanFallback);

  const normId = normalizeForComparison(mappedId);
  const normRawId = normalizeForComparison(cleanId);
  const normFallback = normalizeForComparison(mappedFallback);

  if (Array.isArray(teamMembers) && teamMembers.length > 0) {
    for (const member of teamMembers) {
      if (!member) continue;
      if (typeof member === 'string') {
        const mName = mapName(member);
        const mNorm = normalizeForComparison(mName);
        if (mNorm && (mNorm === normId || mNorm === normFallback)) {
          return {
            staffKey: mNorm,
            staffName: member.trim(),
            staffId: '',
          };
        }
        continue;
      }

      const rawStaffId = String(member.staffId ?? member.StaffId ?? member.personId ?? member.PersonId ?? '').trim();
      const rawName = String(member.name ?? member.MemberName ?? member.CurrentDisplayName ?? '').trim();
      const rawFullName = String(member.fullName ?? member.FullName ?? '').trim();

      const normStaffId = normalizeForComparison(rawStaffId);
      const normMemberName = normalizeForComparison(mapName(rawName));
      const normFullName = normalizeForComparison(rawFullName);

      const matchesById = Boolean(normStaffId && (normStaffId === normRawId || normStaffId === normId));
      const matchesByName = Boolean(
        normMemberName && (
          normMemberName === normId ||
          normMemberName === normFallback
        )
      );
      const matchesByFullName = Boolean(
        normFullName && (
          normFullName === normId ||
          normFullName === normFallback
        )
      );

      if (matchesById || matchesByName || matchesByFullName) {
        return {
          staffKey: normStaffId || normMemberName || normId || normFallback,
          staffName: rawName || mappedFallback || mappedId || cleanId,
          staffId: rawStaffId,
        };
      }
    }
  }

  const effectiveKey = normRawId || normId || normFallback;
  const effectiveName = cleanFallback || mappedId || cleanId;
  return {
    staffKey: effectiveKey,
    staffName: effectiveName,
    staffId: '',
  };
}

/**
 * Normalizes canonical cell key for (date, field, staffKey).
 */
export function buildRosterCellKey({ date, field = FIELD_MO_SHIFT, staffKey = '', teamMembers = [] }) {
  const isoDate = toIsoDate(date) || String(date || '').trim();
  const upField = String(field || FIELD_MO_SHIFT).trim().toUpperCase();
  if (upField === FIELD_EP_OFFICE_HOUR || upField === FIELD_EP_ONCALL) {
    const normStaff = normalizeForComparison(staffKey);
    if (!normStaff || normStaff === normalizeForComparison(EP_SLOT_STAFF_KEY) || normStaff === normalizeForComparison(upField)) {
      return `EP|${isoDate}|${upField}`;
    }
    return `EP|${isoDate}|${upField}|${normStaff}`;
  }
  const resolved = teamMembers && teamMembers.length > 0
    ? resolveStaffIdentity(staffKey, staffKey, teamMembers).staffKey
    : normalizeForComparison(mapName(staffKey));
  return `MO|${isoDate}|${resolved}`;
}

/**
 * Normalizes an amendment record from backend / Google Sheets or local object.
 */
export function normalizeAmendmentRecord(raw, index = 0) {
  if (!raw || typeof raw !== 'object') return null;

  // Guard against accidental Request rows that lack amendment fields
  const hasAmendmentSignature =
    'AmendmentId' in raw ||
    'amendmentId' in raw ||
    'NewValue' in raw ||
    'newValue' in raw ||
    'IsCleared' in raw ||
    'isCleared' in raw ||
    'RosterMonth' in raw ||
    'rosterMonth' in raw ||
    'TargetType' in raw ||
    'targetType' in raw ||
    'Field' in raw ||
    'field' in raw;
  if (!hasAmendmentSignature) return null;

  const rawDate = raw.Date ?? raw.date ?? '';
  const date = toIsoDate(rawDate) || String(rawDate || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;

  const rosterMonth = String(raw.RosterMonth ?? raw.rosterMonth ?? date.slice(0, 7)).trim() || date.slice(0, 7);
  const rawField = String(raw.Field ?? raw.field ?? FIELD_MO_SHIFT).trim().toUpperCase();
  const rawTargetType = String(raw.TargetType ?? raw.targetType ?? (isEpSlotShift(rawField) ? 'EP' : 'MO')).trim().toUpperCase();
  const field = isEpSlotShift(rawField) ? rawField : FIELD_MO_SHIFT;
  const targetType = isEpSlotShift(field) ? 'EP' : (rawTargetType === 'EP' ? 'EP' : 'MO');

  const rawStaffName = String(raw.StaffName ?? raw.staffName ?? raw.Name ?? raw.name ?? '').trim();
  const rawStaffKey = String(raw.StaffKey ?? raw.staffKey ?? (isEpSlotShift(field) ? EP_SLOT_STAFF_KEY : rawStaffName)).trim();
  const staffKey = isEpSlotShift(field) && (!rawStaffKey || normalizeForComparison(rawStaffKey) === normalizeForComparison(EP_SLOT_STAFF_KEY) || normalizeForComparison(rawStaffKey) === normalizeForComparison(field))
    ? EP_SLOT_STAFF_KEY
    : normalizeForComparison(rawStaffKey || rawStaffName);

  if (!isEpSlotShift(field) && !staffKey) return null;

  const rawNewValue = String(raw.NewValue ?? raw.newValue ?? raw.Shift ?? raw.shift ?? '').trim();
  const rawIsCleared = raw.IsCleared ?? raw.isCleared;
  const isCleared = Boolean(
    rawIsCleared === true ||
    String(rawIsCleared).trim().toUpperCase() === 'TRUE' ||
    rawNewValue === CLEAR_MARKER
  );

  const effectiveNewValue = isCleared ? '' : rawNewValue;
  const previousValue = String(raw.PreviousValue ?? raw.previousValue ?? raw.OldValue ?? raw.oldValue ?? '').trim();
  const savedAt = String(raw.SavedAt ?? raw.savedAt ?? '').trim();
  const rawSeq = raw.Sequence ?? raw.sequence;
  const sequence = rawSeq !== undefined && rawSeq !== null && rawSeq !== '' && Number.isFinite(Number(rawSeq))
    ? Number(rawSeq)
    : null;

  const amendmentId = String(raw.AmendmentId ?? raw.amendmentId ?? `amd_${index}`).trim();
  const operationId = String(raw.OperationId ?? raw.operationId ?? '').trim();

  return {
    amendmentId,
    operationId,
    rosterMonth,
    date,
    targetType,
    field,
    staffKey,
    staffName: rawStaffName || (isEpSlotShift(field) ? field : staffKey),
    previousValue: previousValue === CLEAR_MARKER ? '' : previousValue,
    newValue: effectiveNewValue,
    isCleared,
    savedAt,
    sequence,
    _rowIndex: index,
  };
}

/**
 * Deterministic comparator for amendment records.
 * Sorts by:
 * 1. Sequence ascending (when both have numeric sequence)
 * 2. SavedAt timestamp ascending (when both have SavedAt)
 * 3. Sheet/array row index ascending
 */
export function compareAmendmentsDeterministically(a, b) {
  if (a.sequence !== null && b.sequence !== null && a.sequence !== b.sequence) {
    return a.sequence - b.sequence;
  }
  if (a.savedAt && b.savedAt && a.savedAt !== b.savedAt) {
    const tA = Date.parse(a.savedAt);
    const tB = Date.parse(b.savedAt);
    if (Number.isFinite(tA) && Number.isFinite(tB) && tA !== tB) {
      return tA - tB;
    }
    return a.savedAt.localeCompare(b.savedAt);
  }
  if (a.sequence !== null && b.sequence === null) return 1;
  if (a.sequence === null && b.sequence !== null) return -1;
  return (a._rowIndex ?? 0) - (b._rowIndex ?? 0);
}

/**
 * Computes a deterministic string checksum for a cellsMap or rows array.
 */
export function computeCellsChecksum(cellsMap) {
  const entries = [];
  for (const [key, cell] of cellsMap.entries()) {
    const val = typeof cell === 'string' ? cell : (cell?.effectiveValue ?? '');
    if (val) {
      entries.push(`${key}=${val}`);
    }
  }
  entries.sort();
  const canonical = entries.join('\n');
  let hash = 2166136261;
  for (let i = 0; i < canonical.length; i++) {
    hash ^= canonical.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a_${(hash >>> 0).toString(16).padStart(8, '0')}_${entries.length}`;
}

/**
 * Shared pure composition function:
 * DISPLAYED ROSTER = MAIN + LATEST APPLICABLE AMENDMENTS
 *
 * Rules:
 * 1. Start from Main roster assignments (for target rosterMonth or all months).
 * 2. Apply Amendments in deterministic save order.
 * 3. For each (date, staff, assignmentField):
 *    - if no amendment exists, use Main
 *    - if latest amendment sets a shift value, use that value
 *    - if latest amendment explicitly clears the assignment, show cleared/blank and do NOT fall back to Main
 * 4. Keep Main and Amend separately inspectable so amended cells can be identified.
 *
 * @param {object} params
 * @param {Array} [params.mainRows=[]] MasterRoster rows ({ Name, Date, Shift })
 * @param {Array} [params.amendments=[]] RosterAmendments rows
 * @param {string|null} [params.rosterMonth=null] Optional YYYY-MM filter
 */
export function composeEffectiveRoster({
  mainRows = [],
  amendments = [],
  rosterMonth = null,
  teamMembers = [],
} = {}) {
  const targetMonth = rosterMonth ? String(rosterMonth).trim() : null;
  const cellsMap = new Map();
  const mainCellsMap = new Map();
  const amendedCellsMap = new Map();
  const passthroughRows = [];

  // 1. Ingest Main roster rows
  if (Array.isArray(mainRows)) {
    for (let i = 0; i < mainRows.length; i++) {
      const row = mainRows[i];
      if (!row || typeof row !== 'object') continue;
      const rawName = String(row.Name ?? row.name ?? '').trim();
      const rawDate = row.Date ?? row.date ?? '';
      const rawShift = String(row.Shift ?? row.shift ?? '').trim();
      const isoDate = toIsoDate(rawDate) || String(rawDate || '').trim();

      if (!isoDate || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate) || !rawName || !rawShift) {
        continue;
      }

      const rowMonth = isoDate.slice(0, 7);
      if (targetMonth && rowMonth !== targetMonth) {
        continue;
      }

      const upShift = rawShift.toUpperCase();
      if (isEpSlotShift(upShift)) {
        const cellKey = buildRosterCellKey({ date: isoDate, field: upShift, staffKey: EP_SLOT_STAFF_KEY });
        const existing = cellsMap.get(cellKey);
        if (existing) {
          const currentNames = existing.mainValue
            ? existing.mainValue.split(/[,\n]+/).map((n) => n.trim()).filter(Boolean)
            : [];
          if (!currentNames.some((n) => normalizeForComparison(n) === normalizeForComparison(rawName))) {
            currentNames.push(rawName);
          }
          const combined = currentNames.join(', ');
          existing.mainValue = combined;
          existing.effectiveValue = combined;
        } else {
          cellsMap.set(cellKey, {
            cellKey,
            rosterMonth: rowMonth,
            date: isoDate,
            targetType: 'EP',
            field: upShift,
            staffKey: EP_SLOT_STAFF_KEY,
            staffName: upShift === FIELD_EP_OFFICE_HOUR ? 'EP Office Hour' : 'EP On Call',
            mainValue: rawName,
            effectiveValue: rawName,
            isAmended: false,
            isCleared: false,
            hasChangedFromMain: false,
            latestAmendment: null,
            amendmentHistory: [],
          });
        }
      } else {
        const identity = resolveStaffIdentity(rawName, rawName, teamMembers);
        const staffKey = identity.staffKey;
        if (!staffKey) continue;
        const displayStaffName = identity.staffName || mapName(rawName);
        const cellKey = buildRosterCellKey({ date: isoDate, field: FIELD_MO_SHIFT, staffKey });
        const existing = cellsMap.get(cellKey);
        if (existing) {
          const existingTokens = existing.mainValue
            ? existing.mainValue.split(',').map((s) => s.trim()).filter(Boolean)
            : [];
          const incomingTokens = rawShift.split(',').map((s) => s.trim()).filter(Boolean);
          for (const tok of incomingTokens) {
            if (!existingTokens.some((e) => e.toUpperCase() === tok.toUpperCase())) {
              existingTokens.push(tok);
            }
          }
          const combined = existingTokens.join(', ');
          existing.mainValue = combined;
          existing.effectiveValue = combined;
        } else {
          cellsMap.set(cellKey, {
            cellKey,
            rosterMonth: rowMonth,
            date: isoDate,
            targetType: 'MO',
            field: FIELD_MO_SHIFT,
            staffKey,
            staffName: displayStaffName,
            mainValue: rawShift,
            effectiveValue: rawShift,
            isAmended: false,
            isCleared: false,
            hasChangedFromMain: false,
            latestAmendment: null,
            amendmentHistory: [],
          });
        }
      }
    }
  }

  // Record snapshot of Main values before amendments
  for (const [cellKey, entry] of cellsMap.entries()) {
    mainCellsMap.set(cellKey, entry.mainValue);
  }

  // 2. Normalize, filter, and deterministically sort Amendments
  const normalizedAmendments = [];
  if (Array.isArray(amendments)) {
    for (let i = 0; i < amendments.length; i++) {
      const norm = normalizeAmendmentRecord(amendments[i], i);
      if (!norm) continue;
      if (targetMonth && norm.rosterMonth !== targetMonth) continue;
      normalizedAmendments.push(norm);
    }
  }
  normalizedAmendments.sort(compareAmendmentsDeterministically);

  // 3. Apply Amendments in deterministic save order
  for (const amd of normalizedAmendments) {
    // Handle both EP slot-level amendments (staffKey === '__EP__') and person-specific EP amendments
    if (isEpSlotShift(amd.field) && amd.staffKey !== EP_SLOT_STAFF_KEY) {
      const slotKey = buildRosterCellKey({ date: amd.date, field: amd.field, staffKey: EP_SLOT_STAFF_KEY });
      const existingSlot = cellsMap.get(slotKey);
      const currentList = existingSlot?.effectiveValue
        ? existingSlot.effectiveValue.split(/[,\n]+/).map((n) => n.trim()).filter(Boolean)
        : [];
      let nextList;
      if (amd.isCleared || !amd.newValue) {
        nextList = currentList.filter((n) => normalizeForComparison(n) !== amd.staffKey);
      } else {
        const displayEpName = amd.staffName || amd.newValue;
        nextList = [...currentList];
        if (!nextList.some((n) => normalizeForComparison(n) === amd.staffKey)) {
          nextList.push(displayEpName);
        }
      }
      const nextVal = nextList.join(', ');
      const mainVal = existingSlot?.mainValue ?? '';
      const updatedEntry = {
        cellKey: slotKey,
        rosterMonth: amd.rosterMonth,
        date: amd.date,
        targetType: 'EP',
        field: amd.field,
        staffKey: EP_SLOT_STAFF_KEY,
        staffName: amd.field === FIELD_EP_OFFICE_HOUR ? 'EP Office Hour' : 'EP On Call',
        mainValue: mainVal,
        effectiveValue: nextVal,
        isAmended: true,
        isCleared: nextVal === '',
        hasChangedFromMain: normalizeShiftComparison(mainVal) !== normalizeShiftComparison(nextVal),
        latestAmendment: amd,
        amendmentHistory: [...(existingSlot?.amendmentHistory || []), amd],
      };
      cellsMap.set(slotKey, updatedEntry);
      amendedCellsMap.set(slotKey, updatedEntry);
      continue;
    }

    const identity = isEpSlotShift(amd.field)
      ? { staffKey: EP_SLOT_STAFF_KEY, staffName: amd.staffName }
      : resolveStaffIdentity(amd.staffKey, amd.staffName, teamMembers);
    let resolvedStaffKey = identity.staffKey || amd.staffKey;

    let cellKey = buildRosterCellKey({
      date: amd.date,
      field: amd.field,
      staffKey: resolvedStaffKey,
    });

    // Fallback match by staffName if teamMembers was not supplied and Main used display name while amendment used StaffId
    if (!cellsMap.has(cellKey) && !isEpSlotShift(amd.field) && amd.staffName) {
      const fallbackKey = buildRosterCellKey({
        date: amd.date,
        field: amd.field,
        staffKey: normalizeForComparison(mapName(amd.staffName)),
      });
      if (cellsMap.has(fallbackKey)) {
        cellKey = fallbackKey;
        resolvedStaffKey = normalizeForComparison(mapName(amd.staffName));
      }
    }

    const existing = cellsMap.get(cellKey);
    const mainVal = existing?.mainValue ?? '';
    const effectiveVal = amd.isCleared ? '' : amd.newValue;
    const displayStaffName = existing?.staffName || identity.staffName || amd.staffName || resolvedStaffKey;

    const updatedEntry = {
      cellKey,
      rosterMonth: amd.rosterMonth,
      date: amd.date,
      targetType: amd.targetType,
      field: amd.field,
      staffKey: resolvedStaffKey,
      staffName: displayStaffName,
      mainValue: mainVal,
      effectiveValue: effectiveVal,
      isAmended: true,
      isCleared: amd.isCleared || effectiveVal === '',
      hasChangedFromMain: normalizeShiftComparison(mainVal) !== normalizeShiftComparison(effectiveVal),
      latestAmendment: amd,
      amendmentHistory: [...(existing?.amendmentHistory || []), amd],
    };

    cellsMap.set(cellKey, updatedEntry);
    amendedCellsMap.set(cellKey, updatedEntry);
  }

  // 4. Project effective cells into MasterRoster-compatible rows
  // Deleted/cleared shifts (effectiveValue === '') do NOT emit rows and NEVER fall back to Main.
  const effectiveRows = [...passthroughRows];

  for (const entry of cellsMap.values()) {
    if (!entry.effectiveValue || entry.isCleared) {
      continue;
    }

    if (entry.field === FIELD_EP_OFFICE_HOUR || entry.field === FIELD_EP_ONCALL) {
      const epNames = entry.effectiveValue
        .split(/[,\n]+/)
        .map((n) => n.trim())
        .filter(Boolean);
      for (const epName of epNames) {
        effectiveRows.push({
          Name: epName,
          name: epName,
          Date: entry.date,
          date: entry.date,
          Shift: entry.field,
          shift: entry.field,
          isAmended: entry.isAmended,
          hasChangedFromMain: entry.hasChangedFromMain,
          mainValue: entry.mainValue,
        });
      }
    } else {
      const shifts = entry.effectiveValue
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      for (const singleShift of shifts) {
        effectiveRows.push({
          Name: entry.staffName,
          name: entry.staffName,
          Date: entry.date,
          date: entry.date,
          Shift: singleShift,
          shift: singleShift,
          isAmended: entry.isAmended,
          hasChangedFromMain: entry.hasChangedFromMain,
          mainValue: entry.mainValue,
        });
      }
    }
  }

  const checksum = computeCellsChecksum(cellsMap);

  return {
    effectiveRows,
    cellsMap,
    mainCellsMap,
    amendedCellsMap,
    normalizedAmendments,
    checksum,
  };
}

export function normalizeShiftComparison(val) {
  return String(val || '')
    .split(/[,\n]+/)
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
    .join(', ');
}

/**
 * Look up amendment metadata for a specific cell in Calendar or Table View.
 */
export function getCellAmendmentInfo(amendedCellsMap, { date, doctorName, staffKey, field, epField = null, teamMembers = [] }) {
  if (!amendedCellsMap || !(amendedCellsMap instanceof Map)) return null;
  const resolvedEpField = epField || ((field === FIELD_EP_OFFICE_HOUR || field === FIELD_EP_ONCALL) ? field : null);
  if (resolvedEpField) {
    const key = buildRosterCellKey({ date, field: resolvedEpField, staffKey: EP_SLOT_STAFF_KEY });
    return amendedCellsMap.get(key) || null;
  }
  const targetIdentifier = doctorName || staffKey || '';
  const key = buildRosterCellKey({ date, field: FIELD_MO_SHIFT, staffKey: targetIdentifier, teamMembers });
  if (amendedCellsMap.has(key)) return amendedCellsMap.get(key);
  const fallbackKey = buildRosterCellKey({ date, field: FIELD_MO_SHIFT, staffKey: targetIdentifier });
  return amendedCellsMap.get(fallbackKey) || null;
}

/**
 * Extracts a canonical Map<cellKey, { cellKey, date, targetType, field, staffKey, staffName, value }>
 * fromRosterPage's editedGrid structure for a given month.
 */
export function buildCellsMapFromEditedGrid({
  editedGrid = {},
  rosterMonth,
  names = [],
  teamMembers = [],
  baseCellsMap = new Map(),
}) {
  const result = new Map();
  const monthPrefix = String(rosterMonth || '').trim();

  // Seed all known keys from baseCellsMap for this month as empty so cleared cells are tracked,
  // and index known staffName -> { staffKey, staffName } so staffId keys stay consistent even if teamMembers is omitted.
  const baseIdentityByNormName = new Map();
  for (const [cellKey, baseEntry] of baseCellsMap.entries()) {
    if (baseEntry?.targetType === 'MO' && baseEntry?.staffName && baseEntry?.staffKey) {
      baseIdentityByNormName.set(normalizeForComparison(mapName(baseEntry.staffName)), {
        staffKey: baseEntry.staffKey,
        staffName: baseEntry.staffName,
      });
    }
    const baseDate = baseEntry.date || cellKey.split('|')[1] || '';
    if (monthPrefix && !baseDate.startsWith(monthPrefix)) continue;
    result.set(cellKey, {
      cellKey,
      rosterMonth: monthPrefix || baseDate.slice(0, 7),
      date: baseDate,
      targetType: baseEntry.targetType || (cellKey.startsWith('EP|') ? 'EP' : 'MO'),
      field: baseEntry.field || FIELD_MO_SHIFT,
      staffKey: baseEntry.staffKey,
      staffName: baseEntry.staffName,
      value: '',
    });
  }

  // Walk editedGrid dates
  const dates = Object.keys(editedGrid).sort();
  for (const dateStr of dates) {
    if (monthPrefix && !dateStr.startsWith(monthPrefix)) continue;
    const dayObj = editedGrid[dateStr];
    if (!dayObj || typeof dayObj !== 'object') continue;

    // 1. EP slots
    for (const epField of [FIELD_EP_OFFICE_HOUR, FIELD_EP_ONCALL]) {
      if (dayObj[epField] !== undefined) {
        const cleanEp = String(dayObj[epField] || '')
          .split(/[,\n]+/)
          .map((n) => n.trim())
          .filter(Boolean)
          .join(', ');
        const cellKey = buildRosterCellKey({ date: dateStr, field: epField, staffKey: EP_SLOT_STAFF_KEY });
        if (cleanEp || result.has(cellKey)) {
          result.set(cellKey, {
            cellKey,
            rosterMonth: dateStr.slice(0, 7),
            date: dateStr,
            targetType: 'EP',
            field: epField,
            staffKey: EP_SLOT_STAFF_KEY,
            staffName: epField === FIELD_EP_OFFICE_HOUR ? 'EP Office Hour' : 'EP On Call',
            value: cleanEp,
          });
        }
      }
    }

    // 2. MO shifts per doctor on this date
    const doctorShiftsOnDay = new Map(); // staffKey -> { staffName, shifts: [] }
    for (const [shiftKey, namesStr] of Object.entries(dayObj)) {
      if (isEpSlotShift(shiftKey)) continue;
      if (!namesStr) continue;
      const shiftCode = String(shiftKey).trim().toUpperCase();
      if (!shiftCode) continue;

      const assignedNames = String(namesStr)
        .split(/[,\n]+/)
        .map((n) => n.trim())
        .filter(Boolean);

      for (const rawDocName of assignedNames) {
        const normDoc = normalizeForComparison(mapName(rawDocName));
        const baseMatch = (!teamMembers || teamMembers.length === 0) ? baseIdentityByNormName.get(normDoc) : null;
        const identity = baseMatch || resolveStaffIdentity(rawDocName, rawDocName, teamMembers);
        const staffKey = identity.staffKey;
        if (!staffKey) continue;
        const canonicalDocName = identity.staffName || names.find((n) => normalizeForComparison(mapName(n)) === normDoc) || rawDocName;
        if (!doctorShiftsOnDay.has(staffKey)) {
          doctorShiftsOnDay.set(staffKey, { staffName: canonicalDocName, shifts: [] });
        }
        const entry = doctorShiftsOnDay.get(staffKey);
        if (!entry.shifts.includes(shiftCode)) {
          entry.shifts.push(shiftCode);
        }
      }
    }

    for (const [staffKey, info] of doctorShiftsOnDay.entries()) {
      const cellKey = buildRosterCellKey({ date: dateStr, field: FIELD_MO_SHIFT, staffKey });
      result.set(cellKey, {
        cellKey,
        rosterMonth: dateStr.slice(0, 7),
        date: dateStr,
        targetType: 'MO',
        field: FIELD_MO_SHIFT,
        staffKey,
        staffName: info.staffName,
        value: info.shifts.join(', '),
      });
    }
  }

  return result;
}

/**
 * Computes the consolidated list of changed cell assignments between baseline and edited cells.
 * Explicitly marks cleared shifts (newValue === '' && baseValue !== '') with isCleared: true.
 */
export function diffBaselineAndEditedCells({
  baseCellsMap = new Map(),
  editedCellsMap = new Map(),
  rosterMonth,
}) {
  const allKeys = new Set([...baseCellsMap.keys(), ...editedCellsMap.keys()]);
  const changedCells = [];

  for (const cellKey of Array.from(allKeys).sort()) {
    const baseEntry = baseCellsMap.get(cellKey);
    const editEntry = editedCellsMap.get(cellKey);

    const baseVal = String(baseEntry?.effectiveValue ?? baseEntry?.value ?? '').trim();
    const newVal = String(editEntry?.effectiveValue ?? editEntry?.value ?? '').trim();

    if (normalizeShiftComparison(baseVal) === normalizeShiftComparison(newVal)) {
      continue;
    }

    const meta = editEntry || baseEntry;
    if (!meta) continue;
    const date = meta.date || cellKey.split('|')[1] || '';
    if (rosterMonth && !date.startsWith(rosterMonth)) continue;

    const isCleared = newVal === '';

    changedCells.push({
      cellKey,
      rosterMonth: rosterMonth || date.slice(0, 7),
      date,
      targetType: meta.targetType || (cellKey.startsWith('EP|') ? 'EP' : 'MO'),
      field: meta.field || FIELD_MO_SHIFT,
      staffKey: meta.staffKey,
      staffName: meta.staffName,
      previousValue: baseVal,
      newValue: isCleared ? '' : newVal,
      isCleared,
    });
  }

  return changedCells;
}
