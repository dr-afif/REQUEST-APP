import { normalizeForComparison } from '../../utils/normalise.js';
import { mapName } from '../../utils/adapters.js';

/**
 * Strips common honorific/title prefixes (e.g., 'Dr.', 'Dr ') to enable
 * safe, non-fuzzy normalization across directory display variations.
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
 * Projects staff members for the main MO roster-making timetable.
 *
 * Strict Invariants:
 * 1. VISIBLE TIMETABLE ROW SET = LEGACY MO ROSTER ROW SET.
 * 2. Unmatched V2 MO people are NOT included in visible rows.
 * 3. EP (Emergency Physician) staff are completely excluded.
 * 4. Deterministic diagnostics identify unmatched, ambiguous, or duplicate mappings.
 * 5. Order strictly follows authoritative legacy TeamMembers / names sequence.
 * 6. Non-mutating: does not alter input arrays or objects.
 */
export function projectMoStaff({
  people = [],
  teamMembers = [],
  legacyNames = []
} = {}) {
  // 1. Filter V2 people for MO only (strictly exclude EP)
  const v2MoPeople = (people || []).filter((p) => {
    if (!p) return false;
    const domain = (
      p.dutyDomain ||
      p.role ||
      p.DirectoryType ||
      p.directoryType ||
      'MO'
    ).toString().trim().toUpperCase();
    return domain !== 'EP';
  });

  // 2. Determine authoritative legacy ordering items
  let legacyItems = [];
  if (Array.isArray(teamMembers) && teamMembers.length > 0) {
    legacyItems = teamMembers;
  } else if (Array.isArray(legacyNames) && legacyNames.length > 0) {
    legacyItems = legacyNames;
  }

  const unmatchedLegacyStaff = [];
  const ambiguousMappings = [];
  const duplicatePersonIds = [];
  const matchedLegacyEntries = [];
  const claimedPersonIds = new Map();

  // If no legacy source is provided, fail closed
  if (legacyItems.length === 0) {
    const unmappedAll = v2MoPeople.map((p, idx) => ({
      index: idx,
      personId: p.PersonId || p.personId || '',
      name: p.CurrentDisplayName || p.currentDisplayName || p.name || ''
    }));
    const emptyResult = [];
    emptyResult.diagnostics = {
      ok: false,
      unmatchedLegacyStaff: [],
      unmatchedV2Mo: unmappedAll,
      ambiguousMappings: [],
      duplicatePersonIds: [],
      error: 'NO_LEGACY_STAFF_SOURCE'
    };
    return emptyResult;
  }

  // 3. Match each legacy item to exactly one V2 MO candidate
  legacyItems.forEach((item, idx) => {
    const legacyName = typeof item === 'string' ? item : (item?.name || item?.MemberName || '');
    const legacyStaffId = typeof item === 'object' && item !== null
      ? String(item.staffId || item.StaffID || '').trim().toUpperCase()
      : '';

    const normLegacyMap = normalizeForComparison(mapName(legacyName));
    const normLegacyRaw = normalizeForComparison(legacyName);
    const strippedLegacy = normalizeForComparison(stripTitle(legacyName));

    // Candidate resolution via strict matching tiers
    let candidates = [];

    // Tier 1: Match by StaffId if present on both sides
    if (legacyStaffId) {
      candidates = v2MoPeople.filter((p) => {
        const pStaff = String(p.staffId || p.StaffId || '').trim().toUpperCase();
        return pStaff && pStaff === legacyStaffId;
      });
    }

    // Tier 2: Match by exact normalized name (primary or legacy aliases)
    if (candidates.length === 0 && legacyName) {
      candidates = v2MoPeople.filter((p) => {
        const pName = p.CurrentDisplayName || p.currentDisplayName || p.name || p.PersonNameSnapshot || '';
        const normPMap = normalizeForComparison(mapName(pName));
        const normPRaw = normalizeForComparison(pName);

        if (normPMap === normLegacyMap || normPRaw === normLegacyRaw || normPMap === normLegacyRaw || normPRaw === normLegacyMap) {
          return true;
        }

        const aliases = getPersonAliases(p);
        return aliases.some((a) => {
          const normAMap = normalizeForComparison(mapName(a));
          const normARaw = normalizeForComparison(a);
          return normAMap === normLegacyMap || normARaw === normLegacyRaw || normAMap === normLegacyRaw || normARaw === normLegacyMap;
        });
      });
    }

    // Tier 3: Match by title-stripped normalized name
    if (candidates.length === 0 && strippedLegacy) {
      candidates = v2MoPeople.filter((p) => {
        const pName = p.CurrentDisplayName || p.currentDisplayName || p.name || p.PersonNameSnapshot || '';
        const strippedP = normalizeForComparison(stripTitle(pName));
        const strippedPMap = normalizeForComparison(stripTitle(mapName(pName)));

        if (strippedP === strippedLegacy || strippedPMap === strippedLegacy) {
          return true;
        }

        const aliases = getPersonAliases(p);
        return aliases.some((a) => {
          const strippedA = normalizeForComparison(stripTitle(a));
          return strippedA === strippedLegacy;
        });
      });
    }

    // Evaluate matching outcome
    if (candidates.length === 0) {
      unmatchedLegacyStaff.push({
        index: idx,
        legacyStaff: legacyName,
        staffId: legacyStaffId
      });
    } else if (candidates.length > 1) {
      ambiguousMappings.push({
        index: idx,
        legacyStaff: legacyName,
        candidatePersonIds: candidates.map((c) => c.PersonId || c.personId || '')
      });
    } else {
      const candidate = candidates[0];
      const pId = candidate.PersonId || candidate.personId || '';

      if (claimedPersonIds.has(pId)) {
        duplicatePersonIds.push({
          index: idx,
          legacyStaff: legacyName,
          personId: pId,
          previouslyClaimedBy: claimedPersonIds.get(pId)
        });
      } else {
        claimedPersonIds.set(pId, { index: idx, legacyStaff: legacyName });
        const displayName = mapName(legacyName);

        matchedLegacyEntries.push({
          personId: pId,
          dutyDomain: 'MO',
          displayName,
          personNameSnapshot: displayName,
          active: candidate.active !== undefined
            ? candidate.active
            : (candidate.Active !== undefined ? candidate.Active : true),
          orderIndex: idx,
          rawPerson: candidate
        });
      }
    }
  });

  // 4. Identify any unmatched V2 MO people (not claimed by any legacy staff)
  const unmatchedV2Mo = [];
  v2MoPeople.forEach((p, origIdx) => {
    const pId = p.PersonId || p.personId || '';
    if (!claimedPersonIds.has(pId)) {
      unmatchedV2Mo.push({
        index: origIdx,
        personId: pId,
        name: p.CurrentDisplayName || p.currentDisplayName || p.name || pId,
        rawPerson: p
      });
    }
  });

  // 5. Sort matched entries strictly by legacy orderIndex ascending
  matchedLegacyEntries.sort((a, b) => a.orderIndex - b.orderIndex);

  // 6. Attach diagnostics metadata
  const ok = unmatchedLegacyStaff.length === 0 &&
    unmatchedV2Mo.length === 0 &&
    ambiguousMappings.length === 0 &&
    duplicatePersonIds.length === 0;

  matchedLegacyEntries.diagnostics = {
    ok,
    unmatchedLegacyStaff,
    unmatchedV2Mo,
    ambiguousMappings,
    duplicatePersonIds
  };

  return matchedLegacyEntries;
}

/**
 * Explicit helper returning both visible staff list and diagnostic breakdown.
 */
export function projectMoStaffWithDiagnostics(opts) {
  const staff = projectMoStaff(opts);
  return {
    staff,
    diagnostics: staff.diagnostics
  };
}
