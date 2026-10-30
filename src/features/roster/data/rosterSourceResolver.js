import RosterCompatibility from '../compatibility.js';
import { projectMoStaff } from '../staffProjection.js';
import { normalizeForComparison } from '../../../utils/normalise.js';
import { mapName } from '../../../utils/adapters.js';

/**
 * Strips common honorific/title prefixes (e.g., 'Dr.', 'Dr ') for safe normalization.
 */
function stripTitle(str) {
  return String(str || '').trim().replace(/^dr\.?\s+/i, '').trim();
}

/**
 * Parses legacy names / aliases safely from person object.
 */
function getPersonAliases(p) {
  if (Array.isArray(p.legacyNames)) {
    return p.legacyNames;
  }
  if (typeof p.LegacyNamesJson === 'string') {
    try {
      const parsed = JSON.parse(p.LegacyNamesJson);
      if (Array.isArray(parsed)) return parsed;
    } catch (_) {}
  }
  return [];
}

/**
 * Evaluates directory record active flag using canonical compatibility.js semantics:
 * treats undefined, null, or '' as active (default true), and boolean false or
 * string "FALSE", "INACTIVE", "NO", "0" (case-insensitive) as inactive.
 */
function isDirectoryRecordActive(p) {
  const value = p?.active !== undefined ? p.active : p?.Active;
  if (value === undefined || value === null || value === '') return true;
  if (typeof value === 'boolean') return value;
  return !['FALSE', 'INACTIVE', 'NO', '0'].includes(String(value).trim().toUpperCase());
}

/**
 * Builds an index of registered MO and EP staff for fail-closed resolution.
 */
function buildDirectoryLookup({ people = [], teamMembers = [], legacyNames = [] } = {}) {
  // 1. Authoritative MO projection (strict 13-MO sequence matching legacy TeamMembers)
  const moStaff = projectMoStaff({ people, teamMembers, legacyNames });

  const moByNormalizedName = new Map();
  const moById = new Map();
  const moByStaffId = new Map();
  const moCollisionByNormalizedName = new Map();
  const moCollisionByStaffId = new Map();

  const addCandidateToMap = (map, key, entry) => {
    if (!key || !entry?.personId) return;
    if (!map.has(key)) {
      map.set(key, []);
    }
    const existing = map.get(key);
    if (!existing.some((e) => e.personId === entry.personId)) {
      existing.push(entry);
    }
  };

  moStaff.forEach((mo) => {
    moById.set(mo.personId, mo);

    const rawPerson = mo.rawPerson;
    const rawStaffId = String(rawPerson?.StaffId || rawPerson?.staffId || '').trim().toUpperCase();
    if (rawStaffId) {
      addCandidateToMap(moByStaffId, rawStaffId, mo);
      addCandidateToMap(moCollisionByStaffId, rawStaffId, { personId: mo.personId });
    }

    const keys = new Set();
    const primaryName = mo.displayName || mo.personNameSnapshot || '';
    if (primaryName) {
      keys.add(normalizeForComparison(primaryName));
      keys.add(normalizeForComparison(mapName(primaryName)));
      keys.add(normalizeForComparison(stripTitle(primaryName)));
    }

    if (rawPerson) {
      const aliases = getPersonAliases(rawPerson);
      aliases.forEach((a) => {
        if (a) {
          keys.add(normalizeForComparison(a));
          keys.add(normalizeForComparison(mapName(a)));
          keys.add(normalizeForComparison(stripTitle(a)));
        }
      });
      const pName = rawPerson.CurrentDisplayName || rawPerson.currentDisplayName || rawPerson.name || '';
      if (pName) {
        keys.add(normalizeForComparison(pName));
        keys.add(normalizeForComparison(mapName(pName)));
        keys.add(normalizeForComparison(stripTitle(pName)));
      }
    }

    keys.forEach((k) => {
      addCandidateToMap(moByNormalizedName, k, mo);
      addCandidateToMap(moCollisionByNormalizedName, k, { personId: mo.personId });
    });
  });

  // 1b. Collision detection across eligible canonical MO directory records (kept separate from moStaff projection)
  (people || []).forEach((p) => {
    if (!p || typeof p !== 'object') return;
    const pId = String(p.PersonId || p.personId || '').trim();
    if (!pId || moById.has(pId)) return;

    const domain = (
      p.dutyDomain ||
      p.role ||
      p.DirectoryType ||
      p.directoryType ||
      'MO'
    ).toString().trim().toUpperCase();

    if (domain !== 'MO') return;

    if (!isDirectoryRecordActive(p)) return;

    const pStaffId = String(p.StaffId || p.staffId || '').trim().toUpperCase();
    if (pStaffId) {
      addCandidateToMap(moCollisionByStaffId, pStaffId, { personId: pId });
    }

    const keys = new Set();
    const pName = p.CurrentDisplayName || p.currentDisplayName || p.name || p.PersonNameSnapshot || '';
    if (pName) {
      keys.add(normalizeForComparison(pName));
      keys.add(normalizeForComparison(mapName(pName)));
      keys.add(normalizeForComparison(stripTitle(pName)));
    }

    const aliases = getPersonAliases(p);
    aliases.forEach((a) => {
      if (a) {
        keys.add(normalizeForComparison(a));
        keys.add(normalizeForComparison(mapName(a)));
        keys.add(normalizeForComparison(stripTitle(a)));
      }
    });

    keys.forEach((k) => {
      addCandidateToMap(moCollisionByNormalizedName, k, { personId: pId });
    });
  });

  // 2. EP Directory lookup (strictly segregated from MO projection)
  const epByNormalizedName = new Map();
  const epById = new Map();

  (people || []).forEach((p) => {
    const domain = (
      p.dutyDomain ||
      p.role ||
      p.DirectoryType ||
      p.directoryType ||
      ''
    ).toString().trim().toUpperCase();

    if (domain === 'EP') {
      const pId = p.PersonId || p.personId || '';
      const pName = p.CurrentDisplayName || p.currentDisplayName || p.name || pId;
      const epEntry = {
        personId: pId,
        displayName: pName,
        dutyDomain: 'EP',
        rawPerson: p
      };

      if (pId) epById.set(pId, epEntry);

      const keys = new Set();
      if (pName) {
        keys.add(normalizeForComparison(pName));
        keys.add(normalizeForComparison(mapName(pName)));
        keys.add(normalizeForComparison(stripTitle(pName)));
      }
      const aliases = getPersonAliases(p);
      aliases.forEach((a) => {
        if (a) {
          keys.add(normalizeForComparison(a));
          keys.add(normalizeForComparison(mapName(a)));
          keys.add(normalizeForComparison(stripTitle(a)));
        }
      });

      keys.forEach((k) => {
        if (k) {
          if (!epByNormalizedName.has(k)) {
            epByNormalizedName.set(k, []);
          }
          const existing = epByNormalizedName.get(k);
          if (!existing.some((e) => e.personId === pId)) {
            existing.push(epEntry);
          }
        }
      });
    }
  });

  return {
    moStaff,
    moByNormalizedName,
    moById,
    moByStaffId,
    moCollisionByNormalizedName,
    moCollisionByStaffId,
    epByNormalizedName,
    epById
  };
}

/**
 * Normalizes legacy MasterRoster rows into the common normalized assignment contract.
 *
 * Enforces fail-closed identity resolution:
 * - Unresolved MO rows are not emitted as assignments with personId = null.
 * - Ambiguous mappings fail closed and are captured in diagnostics.
 * - EP rows are tagged dutyDomain = 'EP' and segregated from MO rows.
 * - Unsupported shift codes are flagged in diagnostics while preserving rawShift.
 * - Source input array is never mutated.
 */
export function normalizeLegacyMasterRoster(legacyRows = [], period, { people = [], teamMembers = [], legacyNames = [] } = {}) {
  RosterCompatibility.validatePeriod(period);

  const lookup = buildDirectoryLookup({ people, teamMembers, legacyNames });

  const assignments = [];
  const diagnostics = {
    unresolvedIdentities: [],
    ambiguousIdentities: [],
    unsupportedShifts: [],
    unplacedRows: [],
    duplicateMappings: [],
    unknownDomains: []
  };

  (legacyRows || []).forEach((row, idx) => {
    if (!row || typeof row !== 'object') return;

    const sourceRow = idx + 2; // Google Sheets 1-indexed row, header is row 1
    const rawDate = row.Date !== undefined ? row.Date : row.date;
    const dateStr = RosterCompatibility.localDate(rawDate);

    if (!dateStr) {
      diagnostics.unplacedRows.push({
        sourceRow,
        raw: { ...row },
        issue: 'INVALID_DATE'
      });
      return;
    }

    // Filter strictly for the target period
    if (!dateStr.startsWith(period)) {
      return;
    }

    const rawName = String(row.Name !== undefined ? row.Name : (row.name !== undefined ? row.name : '')).trim();
    const rawShift = String(row.Shift !== undefined ? row.Shift : (row.shift !== undefined ? row.shift : '')).trim();

    if (!rawName && !rawShift) return;

    // Resolve shift semantics via certified compatibility rules
    const semantics = RosterCompatibility.resolveShift(rawShift);
    if (!semantics.known) {
      diagnostics.unsupportedShifts.push({
        sourceRow,
        rawName,
        date: dateStr,
        rawShift,
        baseCode: semantics.baseCode
      });
    }

    const normName = normalizeForComparison(rawName);
    const normMapName = normalizeForComparison(mapName(rawName));
    const normStripped = normalizeForComparison(stripTitle(rawName));

    // 1. Check EP match first
    const epCandidates = lookup.epByNormalizedName.get(normName) ||
      lookup.epByNormalizedName.get(normMapName) ||
      lookup.epByNormalizedName.get(normStripped) ||
      [];

    const isExplicitEpShift = semantics.directoryType === 'EP';

    if (epCandidates.length === 1 || (epCandidates.length > 0 && isExplicitEpShift)) {
      const epMatch = epCandidates[0];
      assignments.push({
        assignmentKey: `MasterRoster:${sourceRow}`,
        personId: epMatch.personId || null,
        personNameSnapshot: epMatch.displayName || rawName,
        date: dateStr,
        shiftCode: semantics.canonicalCode,
        modifiers: {
          standby: Boolean(semantics.modifiers?.standby),
          extended: Boolean(semantics.modifiers?.extended)
        },
        dutyDomain: 'EP',
        rawShift,
        sourceType: 'LEGACY_MASTER_ROSTER'
      });
      return;
    }

    // 2. Resolve MO candidate
    const rowPersonId = String(row.PersonId || row.personId || '').trim();
    if (rowPersonId && lookup.moById.has(rowPersonId)) {
      const moMatch = lookup.moById.get(rowPersonId);
      assignments.push({
        assignmentKey: `MasterRoster:${sourceRow}`,
        personId: moMatch.personId,
        personNameSnapshot: moMatch.displayName || rawName,
        date: dateStr,
        shiftCode: semantics.canonicalCode,
        modifiers: {
          standby: Boolean(semantics.modifiers?.standby),
          extended: Boolean(semantics.modifiers?.extended)
        },
        dutyDomain: 'MO',
        rawShift,
        sourceType: 'LEGACY_MASTER_ROSTER'
      });
      return;
    }

    const rowStaffId = String(row.StaffId || row.staffId || row.StaffID || '').trim().toUpperCase();
    if (rowStaffId) {
      const staffIdMatches = lookup.moByStaffId.get(rowStaffId) || [];
      const staffIdCollisions = lookup.moCollisionByStaffId.get(rowStaffId) || [];
      if (staffIdCollisions.length > 1) {
        diagnostics.ambiguousIdentities.push({
          sourceRow,
          rawName,
          date: dateStr,
          rawShift,
          candidatePersonIds: staffIdCollisions.map((c) => c.personId)
        });
        return;
      }
      if (staffIdMatches.length === 1) {
        const moMatch = staffIdMatches[0];
        assignments.push({
          assignmentKey: `MasterRoster:${sourceRow}`,
          personId: moMatch.personId,
          personNameSnapshot: moMatch.displayName || rawName,
          date: dateStr,
          shiftCode: semantics.canonicalCode,
          modifiers: {
            standby: Boolean(semantics.modifiers?.standby),
            extended: Boolean(semantics.modifiers?.extended)
          },
          dutyDomain: 'MO',
          rawShift,
          sourceType: 'LEGACY_MASTER_ROSTER'
        });
        return;
      }
    }

    const moCandidates = lookup.moByNormalizedName.get(normName) ||
      lookup.moByNormalizedName.get(normMapName) ||
      lookup.moByNormalizedName.get(normStripped) ||
      [];

    const collisionCandidates = lookup.moCollisionByNormalizedName.get(normName) ||
      lookup.moCollisionByNormalizedName.get(normMapName) ||
      lookup.moCollisionByNormalizedName.get(normStripped) ||
      [];

    if (collisionCandidates.length > 1 || moCandidates.length > 1) {
      const ambiguousList = collisionCandidates.length > 1 ? collisionCandidates : moCandidates;
      diagnostics.ambiguousIdentities.push({
        sourceRow,
        rawName,
        date: dateStr,
        rawShift,
        candidatePersonIds: ambiguousList.map((c) => c.personId)
      });
      // Fail closed: do not emit row with personId = null or guessed personId
      return;
    }

    if (moCandidates.length === 1) {
      const moMatch = moCandidates[0];
      assignments.push({
        assignmentKey: `MasterRoster:${sourceRow}`,
        personId: moMatch.personId,
        personNameSnapshot: moMatch.displayName || rawName,
        date: dateStr,
        shiftCode: semantics.canonicalCode,
        modifiers: {
          standby: Boolean(semantics.modifiers?.standby),
          extended: Boolean(semantics.modifiers?.extended)
        },
        dutyDomain: 'MO',
        rawShift,
        sourceType: 'LEGACY_MASTER_ROSTER'
      });
      return;
    }

    // Unresolved identity
    diagnostics.unresolvedIdentities.push({
      sourceRow,
      rawName,
      date: dateStr,
      rawShift
    });
    // Fail closed: do not emit row with personId = null
  });

  const ok = diagnostics.unresolvedIdentities.length === 0 &&
    diagnostics.ambiguousIdentities.length === 0 &&
    diagnostics.unsupportedShifts.length === 0 &&
    diagnostics.unplacedRows.length === 0;

  return {
    assignments,
    diagnostics: {
      ok,
      ...diagnostics,
      projectedStaffDiagnostics: lookup.moStaff.diagnostics || null
    }
  };
}

/**
 * Normalizes V2 working draft or current assignments into the common normalized contract.
 *
 * Supports array of assignment objects, patch payloads, or draft cells objects.
 * Source input arrays and objects are never mutated.
 */
export function normalizeV2Assignments(v2Assignments = [], period, { people = [], sourceType = 'V2_DRAFT' } = {}) {
  if (period) {
    RosterCompatibility.validatePeriod(period);
  }

  const peopleMap = new Map();
  (people || []).forEach((p) => {
    const id = p.PersonId || p.personId;
    if (id) {
      peopleMap.set(id, {
        displayName: p.CurrentDisplayName || p.currentDisplayName || p.name || id,
        domain: (p.DirectoryType || p.directoryType || p.dutyDomain || p.role || 'MO').toString().trim().toUpperCase()
      });
    }
  });

  const assignments = [];
  const diagnostics = {
    unsupportedShifts: [],
    unplacedRows: []
  };

  // Case 1: Draft cells object: { 'personId/YYYY-MM-DD': [{ shiftCode, ... }] }
  if (v2Assignments && typeof v2Assignments === 'object' && !Array.isArray(v2Assignments)) {
    const sortedKeys = Object.keys(v2Assignments).sort();
    for (const cellKey of sortedKeys) {
      const slashIdx = cellKey.indexOf('/');
      if (slashIdx === -1) continue;
      const personId = cellKey.slice(0, slashIdx);
      const dateStr = cellKey.slice(slashIdx + 1);

      if (period && !dateStr.startsWith(period)) continue;

      const cellItems = Array.isArray(v2Assignments[cellKey]) ? v2Assignments[cellKey] : [];
      const personInfo = peopleMap.get(personId);
      const personName = personInfo?.displayName || personId;
      const dutyDomain = personInfo?.domain || 'MO';

      for (const item of cellItems) {
        if (!item) continue;
        const rawShift = String(item.rawShift !== undefined ? item.rawShift : (item.shiftCode !== undefined ? item.shiftCode : '')).trim();
        if (!rawShift) continue;

        const semantics = RosterCompatibility.resolveShift(rawShift, dutyDomain);
        if (!semantics.known) {
          diagnostics.unsupportedShifts.push({ personId, date: dateStr, rawShift, baseCode: semantics.baseCode });
        }

        const modifiers = item.modifiers || semantics.modifiers || { standby: false, extended: false };

        assignments.push({
          assignmentKey: item.assignmentKey || item.assignmentId || `${personId}:${dateStr}:${dutyDomain}:${semantics.canonicalCode}`,
          personId,
          personNameSnapshot: personName,
          date: dateStr,
          shiftCode: semantics.canonicalCode,
          modifiers: {
            standby: Boolean(modifiers.standby),
            extended: Boolean(modifiers.extended)
          },
          dutyDomain: item.dutyDomain || dutyDomain,
          rawShift,
          sourceType
        });
      }
    }

    return {
      assignments,
      diagnostics: {
        ok: diagnostics.unsupportedShifts.length === 0,
        ...diagnostics
      }
    };
  }

  // Case 2: Array of assignment objects or patches
  const rawList = Array.isArray(v2Assignments) ? v2Assignments : [];

  rawList.forEach((item, idx) => {
    if (!item || typeof item !== 'object') return;

    const rawDate = item.date || item.Date;
    const dateStr = RosterCompatibility.localDate(rawDate);

    if (!dateStr) {
      diagnostics.unplacedRows.push({ index: idx, item: { ...item }, issue: 'INVALID_DATE' });
      return;
    }

    if (period && !dateStr.startsWith(period)) {
      return;
    }

    const personId = item.personId || item.PersonId || null;
    const personInfo = personId ? peopleMap.get(personId) : null;
    const personName = item.personNameSnapshot || item.PersonNameSnapshot || personInfo?.displayName || personId || '';
    const dutyDomain = (item.dutyDomain || item.DutyDomain || personInfo?.domain || 'MO').toString().trim().toUpperCase();

    const rawShift = String(
      item.rawShift !== undefined
        ? item.rawShift
        : item.shiftCode !== undefined
        ? item.shiftCode
        : item.Shift !== undefined
        ? item.Shift
        : ''
    ).trim();

    const semantics = RosterCompatibility.resolveShift(rawShift, dutyDomain);
    if (!semantics.known && rawShift) {
      diagnostics.unsupportedShifts.push({ index: idx, personId, date: dateStr, rawShift, baseCode: semantics.baseCode });
    }

    const modifiers = item.modifiers || semantics.modifiers || { standby: false, extended: false };

    assignments.push({
      assignmentKey: item.assignmentKey || item.assignmentId || item.AssignmentId || `${personId}:${dateStr}:${dutyDomain}:${semantics.canonicalCode || rawShift}`,
      personId,
      personNameSnapshot: personName,
      date: dateStr,
      shiftCode: semantics.canonicalCode,
      modifiers: {
        standby: Boolean(modifiers.standby),
        extended: Boolean(modifiers.extended)
      },
      dutyDomain: dutyDomain === 'EP' ? 'EP' : 'MO',
      rawShift,
      sourceType
    });
  });

  return {
    assignments,
    diagnostics: {
      ok: diagnostics.unsupportedShifts.length === 0 && diagnostics.unplacedRows.length === 0,
      ...diagnostics
    }
  };
}

/**
 * Resolves the authoritative roster dataset for any period adhering to the locked product model:
 *
 * 1. Periods BEFORE 2026-11:
 *    MasterRoster is the sole authority -> returns authority: 'LEGACY_MASTER_ROSTER', isReadOnly: true.
 *    No RosterPeriods enrollment is required.
 *
 * 2. Periods FROM 2026-11 ONWARD:
 *    V2 is the sole authority!
 *    MasterRoster is NEVER silently used, even if V2 assignments are empty or loading.
 *    - DRAFT -> authority: 'V2_DRAFT', isReadOnly: false (even if assignments are empty).
 *    - PUBLISHED / AMENDED / CLOSED -> authority: 'V2_CURRENT' (CLOSED is read-only).
 *    - UNENROLLED future month -> authority: 'V2_EMPTY_DRAFT', isReadOnly: false.
 *    - LOADING / UNRESOLVED -> authority: 'RESOLVING', isReadOnly: true, assignments: [].
 */
export function resolveRosterSource({
  period,
  lifecycleState = null,
  v2DraftAssignments = [],
  v2CurrentAssignments = [],
  masterRoster = [],
  people = [],
  teamMembers = [],
  legacyNames = []
} = {}) {
  RosterCompatibility.validatePeriod(period);

  // 1. Periods BEFORE 2026-11: MasterRoster is Authoritative
  if (period < '2026-11') {
    const normalized = normalizeLegacyMasterRoster(masterRoster || [], period, {
      people,
      teamMembers,
      legacyNames
    });

    return {
      period,
      authority: 'LEGACY_MASTER_ROSTER',
      status: 'RESOLVED',
      isReadOnly: true,
      assignments: normalized.assignments,
      diagnostics: normalized.diagnostics
    };
  }

  // 2. Periods FROM 2026-11 ONWARD: V2 is Authoritative
  // Check if lifecycle query is in-flight / loading
  const isLoading =
    lifecycleState === 'LOADING' ||
    (lifecycleState && typeof lifecycleState === 'object' && lifecycleState.status === 'LOADING');

  if (isLoading) {
    return {
      period,
      authority: 'RESOLVING',
      status: 'LOADING',
      isReadOnly: true,
      assignments: [],
      diagnostics: {
        ok: true,
        resolving: true
      }
    };
  }

  // Determine lifecycle state string
  let stateStr = null;
  if (typeof lifecycleState === 'string') {
    stateStr = lifecycleState.trim().toUpperCase();
  } else if (lifecycleState && typeof lifecycleState === 'object') {
    const candidate = lifecycleState.lifecycle?.state || lifecycleState.state || lifecycleState.status;
    if (candidate) {
      stateStr = String(candidate).trim().toUpperCase();
    }
  }

  // 2a. DRAFT State (Authoritative V2 Draft, even if empty array)
  if (stateStr === 'DRAFT') {
    const normalized = normalizeV2Assignments(v2DraftAssignments || [], period, {
      people,
      teamMembers,
      legacyNames,
      sourceType: 'V2_DRAFT'
    });

    return {
      period,
      authority: 'V2_DRAFT',
      status: 'RESOLVED',
      isReadOnly: false,
      assignments: normalized.assignments,
      diagnostics: normalized.diagnostics
    };
  }

  // 2b. Published / Amended / Closed States
  if (stateStr === 'PUBLISHED' || stateStr === 'AMENDED' || stateStr === 'CLOSED') {
    const curList = Array.isArray(v2CurrentAssignments)
      ? v2CurrentAssignments
      : Array.isArray(v2CurrentAssignments?.assignments)
      ? v2CurrentAssignments.assignments
      : [];

    const isClosed = stateStr === 'CLOSED';
    const normalized = normalizeV2Assignments(curList, period, {
      people,
      teamMembers,
      legacyNames,
      sourceType: 'V2_CURRENT'
    });

    return {
      period,
      authority: 'V2_CURRENT',
      lifecycleState: stateStr,
      status: 'RESOLVED',
      isReadOnly: isClosed,
      assignments: normalized.assignments,
      diagnostics: normalized.diagnostics
    };
  }

  // 2c. Unenrolled Future Period (e.g. 2026-12 without RosterPeriods row)
  return {
    period,
    authority: 'V2_EMPTY_DRAFT',
    status: 'RESOLVED',
    isReadOnly: false,
    assignments: [],
    diagnostics: {
      ok: true,
      emptyDraft: true
    }
  };
}
