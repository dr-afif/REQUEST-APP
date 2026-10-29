import { toIsoDate } from '../../../utils/normalise.js';
import {
  composeEffectiveRoster,
  isEpSlotShift,
  normalizeShiftComparison,
  resolveStaffIdentity,
} from './rosterComposition.js';

/**
 * Pure, strictly read-only reconciliation audit between existing MasterRoster rows
 * and V2 Draft assignments (e.g. November 2026 98 MO assignments across 13 MOs).
 *
 * IMPORTANT:
 * - Never writes, mutates, or auto-migrates any data.
 * - Used to determine whether a one-time controlled copy from V2 Draft to MasterRoster
 *   is needed before retiring V2 draft tables.
 */
export function auditV2DraftVsMasterRoster({
  rosterMonth = '2026-11',
  masterRosterRows = [],
  v2DraftAssignments = [],
  teamMembers = [],
} = {}) {
  const mainComposed = composeEffectiveRoster({
    mainRows: masterRosterRows,
    amendments: [],
    rosterMonth,
    teamMembers,
  });

  // Convert V2 draft assignments into MasterRoster-like rows for apples-to-apples MO comparison
  const v2AsMainRows = [];
  for (const asg of Array.isArray(v2DraftAssignments) ? v2DraftAssignments : []) {
    if (!asg || typeof asg !== 'object') continue;
    const rawDate = asg.date ?? asg.Date ?? '';
    const isoDate = toIsoDate(rawDate) || String(rawDate || '').trim();
    if (!isoDate || !isoDate.startsWith(rosterMonth)) continue;

    const dutyDomain = String(asg.dutyDomain ?? asg.DutyDomain ?? 'MO').trim().toUpperCase();
    if (dutyDomain === 'EP') continue;

    const rawShift = String(asg.rawShift ?? asg.shiftCode ?? asg.ShiftCode ?? asg.Shift ?? '').trim();
    if (!rawShift || isEpSlotShift(rawShift)) continue;

    const rawName = String(
      asg.personNameSnapshot ??
      asg.PersonNameSnapshot ??
      asg.staffName ??
      asg.name ??
      asg.Name ??
      ''
    ).trim();
    const rawStaffId = String(asg.staffId ?? asg.StaffId ?? '').trim();
    const identity = resolveStaffIdentity(rawStaffId || rawName, rawName, teamMembers);
    const displayName = identity.staffName || rawName;
    if (!displayName) continue;

    v2AsMainRows.push({
      Name: displayName,
      Date: isoDate,
      Shift: rawShift,
    });
  }

  const v2Composed = composeEffectiveRoster({
    mainRows: v2AsMainRows,
    amendments: [],
    rosterMonth,
    teamMembers,
  });

  const onlyInV2Draft = [];
  const onlyInMasterRoster = [];
  const valueMismatches = [];
  let matchingMoCells = 0;
  let epCellsInMasterRoster = 0;

  for (const [key, entry] of mainComposed.cellsMap.entries()) {
    if (entry.targetType === 'EP') {
      epCellsInMasterRoster++;
      continue;
    }
    const v2Entry = v2Composed.cellsMap.get(key);
    if (!v2Entry) {
      onlyInMasterRoster.push({
        cellKey: key,
        date: entry.date,
        staffKey: entry.staffKey,
        staffName: entry.staffName,
        masterValue: entry.effectiveValue,
      });
    } else if (
      normalizeShiftComparison(entry.effectiveValue) !==
      normalizeShiftComparison(v2Entry.effectiveValue)
    ) {
      valueMismatches.push({
        cellKey: key,
        date: entry.date,
        staffKey: entry.staffKey,
        staffName: entry.staffName,
        masterValue: entry.effectiveValue,
        v2DraftValue: v2Entry.effectiveValue,
      });
    } else {
      matchingMoCells++;
    }
  }

  for (const [key, v2Entry] of v2Composed.cellsMap.entries()) {
    if (v2Entry.targetType === 'EP') continue;
    if (!mainComposed.cellsMap.has(key)) {
      onlyInV2Draft.push({
        cellKey: key,
        date: v2Entry.date,
        staffKey: v2Entry.staffKey,
        staffName: v2Entry.staffName,
        v2DraftValue: v2Entry.effectiveValue,
      });
    }
  }

  const requiresOneTimeCopy =
    onlyInV2Draft.length > 0 ||
    onlyInMasterRoster.length > 0 ||
    valueMismatches.length > 0;

  return {
    rosterMonth,
    v2MoAssignmentCount: v2AsMainRows.length,
    masterMoCellCount: Array.from(mainComposed.cellsMap.values()).filter((c) => c.targetType === 'MO').length,
    epCellsInMasterRoster,
    matchingMoCells,
    onlyInV2Draft,
    onlyInMasterRoster,
    valueMismatches,
    requiresOneTimeCopy,
    proposedMasterRosterRowsForCopy: v2AsMainRows,
  };
}
