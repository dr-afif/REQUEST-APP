import RosterLifecycle from './lifecycle.js';
import RosterCompatibility from './compatibility.js';

/**
 * Identity Migration Dry-Run Utility
 *
 * Implements deterministic source identity priority for transitioning legacy
 * TeamMembers (MO) and EmergencyPhysicians (EP) into canonical RosterPeople entries.
 *
 * Identity Priority:
 * 1. DirectoryType + StaffId (primary immutable identifier)
 * 2. DirectoryType + Email (secondary unique identifier where StaffId is absent)
 * 3. Reviewed manual mapping (for records missing both)
 *
 * Output Categories:
 * - CREATE: New person with valid stable ID not yet in RosterPeople
 * - REUSE: Existing person with matching PersonId and identical display name
 * - ALIAS_UPDATE: Existing person with matching PersonId whose display name changed
 * - INACTIVE: Existing or new staff member flagged Active: false
 * - AMBIGUOUS: Duplicate StaffId/Email in directory or cross-domain collision
 * - MISSING_STABLE_ID: Record lacks both StaffId and Email; cannot derive durable ID
 */

const cleanStr = v => String(v || '').trim();
const cleanEmail = v => {
  const s = cleanStr(v).toLowerCase();
  return (s.includes('@') && s.length >= 5) ? s : '';
};
const cleanStaffId = v => cleanStr(v).toUpperCase();

function deriveSourceKey(entry, directoryType) {
  const staffId = cleanStaffId(entry.StaffId || entry.staffId);
  if (staffId) {
    return {
      sourceKey: `${directoryType}:staffId:${staffId}`,
      identifierType: 'STAFF_ID',
      identifierValue: staffId
    };
  }

  const email = cleanEmail(entry.Email || entry.email);
  if (email) {
    return {
      sourceKey: `${directoryType}:email:${email}`,
      identifierType: 'EMAIL',
      identifierValue: email
    };
  }

  return {
    sourceKey: null,
    identifierType: 'NONE',
    identifierValue: null
  };
}

export function planIdentityMigration({
  teamMembers = [],
  emergencyPhysicians = [],
  existingPeople = [],
  digestFn
}) {
  if (typeof digestFn !== 'function') {
    throw new Error('digestFn is required for deterministic identity migration');
  }

  const existingById = new Map();
  existingPeople.forEach(p => {
    if (p.PersonId) existingById.set(p.PersonId, p);
  });

  const rawEntries = [];

  // Ingest TeamMembers (MO)
  teamMembers.forEach((entry, idx) => {
    const rawName = cleanStr(entry.MemberName || entry.name);
    if (!rawName) return;
    const { sourceKey, identifierType, identifierValue } = deriveSourceKey(entry, 'MO');
    const active = entry.Active !== false && String(entry.Active).toLowerCase() !== 'false';
    rawEntries.push({
      directoryType: 'MO',
      rawName,
      sourceKey,
      identifierType,
      identifierValue,
      active,
      index: idx
    });
  });

  // Ingest EmergencyPhysicians (EP)
  emergencyPhysicians.forEach((entry, idx) => {
    const rawName = cleanStr(entry.MemberName || entry.name);
    if (!rawName) return;
    const { sourceKey, identifierType, identifierValue } = deriveSourceKey(entry, 'EP');
    const active = entry.Active !== false && String(entry.Active).toLowerCase() !== 'false';
    rawEntries.push({
      directoryType: 'EP',
      rawName,
      sourceKey,
      identifierType,
      identifierValue,
      active,
      index: idx
    });
  });

  // Collision detection: check for duplicate source keys across entries
  const sourceKeyCounts = new Map();
  const nameToKeys = new Map();

  rawEntries.forEach(e => {
    if (e.sourceKey) {
      sourceKeyCounts.set(e.sourceKey, (sourceKeyCounts.get(e.sourceKey) || 0) + 1);
    }
    const nameKey = `${e.directoryType}:${RosterCompatibility.canonicalName(e.rawName, e.directoryType)}`;
    if (!nameToKeys.has(nameKey)) nameToKeys.set(nameKey, new Set());
    if (e.sourceKey) nameToKeys.get(nameKey).add(e.sourceKey);
  });

  // Check cross-domain collision (e.g. same staffId or email in both MO and EP)
  const globalIdentifierCounts = new Map();
  rawEntries.forEach(e => {
    if (e.identifierValue) {
      const gKey = `${e.identifierType}:${e.identifierValue}`;
      if (!globalIdentifierCounts.has(gKey)) globalIdentifierCounts.set(gKey, new Set());
      globalIdentifierCounts.get(gKey).add(e.directoryType);
    }
  });

  const plans = [];

  rawEntries.forEach(entry => {
    const { directoryType, rawName, sourceKey, identifierType, identifierValue, active } = entry;
    const gKey = identifierValue ? `${identifierType}:${identifierValue}` : null;
    const isCrossDomainCollision = gKey && globalIdentifierCounts.get(gKey).size > 1;
    const isDuplicateStableId = sourceKey && (sourceKeyCounts.get(sourceKey) > 1);

    // Fail-Closed Category: AMBIGUOUS
    if (isCrossDomainCollision) {
      plans.push({
        category: 'AMBIGUOUS',
        directoryType,
        sourceKey,
        memberName: rawName,
        personId: null,
        proposedDisplayName: rawName,
        legacyNames: [],
        active,
        reason: `CROSS_DOMAIN_COLLISION: ${identifierType} ${identifierValue} exists in both MO and EP`
      });
      return;
    }

    if (isDuplicateStableId) {
      plans.push({
        category: 'AMBIGUOUS',
        directoryType,
        sourceKey,
        memberName: rawName,
        personId: null,
        proposedDisplayName: rawName,
        legacyNames: [],
        active,
        reason: `DUPLICATE_STABLE_ID: ${identifierType} ${identifierValue} shared by multiple records in ${directoryType}`
      });
      return;
    }

    // Fail-Closed Category: MISSING_STABLE_ID
    if (!sourceKey) {
      plans.push({
        category: 'MISSING_STABLE_ID',
        directoryType,
        sourceKey: null,
        memberName: rawName,
        personId: null,
        proposedDisplayName: rawName,
        legacyNames: [],
        active,
        reason: 'Missing immutable StaffId and valid Email. Manual admin mapping required.'
      });
      return;
    }

    // Derive deterministic RFC 4122 v4 UUID
    const personId = RosterLifecycle.deterministicUuid(`person:${sourceKey}`, digestFn);
    const existing = existingById.get(personId);

    // Existing person checks
    if (existing) {
      const existingName = cleanStr(existing.CurrentDisplayName);
      const isRenamed = existingName && existingName !== rawName;
      let legacyNames = [];
      try {
        legacyNames = JSON.parse(existing.LegacyNamesJson || '[]');
      } catch (_) {
        legacyNames = [];
      }

      if (!active) {
        plans.push({
          category: 'INACTIVE',
          directoryType,
          sourceKey,
          memberName: rawName,
          personId,
          proposedDisplayName: rawName,
          legacyNames,
          active: false,
          reason: 'Marked inactive in directory; retained with Active: false'
        });
        return;
      }

      if (isRenamed) {
        if (!legacyNames.includes(existingName)) legacyNames.push(existingName);
        plans.push({
          category: 'ALIAS_UPDATE',
          directoryType,
          sourceKey,
          memberName: rawName,
          personId,
          proposedDisplayName: rawName,
          legacyNames,
          active: true,
          reason: `Display name changed from "${existingName}" to "${rawName}"; former name added to LegacyNamesJson`
        });
        return;
      }

      plans.push({
        category: 'REUSE',
        directoryType,
        sourceKey,
        memberName: rawName,
        personId,
        proposedDisplayName: rawName,
        legacyNames,
        active: Boolean(existing.Active !== false),
        reason: 'Identical stable ID and display name already registered'
      });
      return;
    }

    // New person
    if (!active) {
      plans.push({
        category: 'INACTIVE',
        directoryType,
        sourceKey,
        memberName: rawName,
        personId,
        proposedDisplayName: rawName,
        legacyNames: [],
        active: false,
        reason: 'New staff member registered as inactive'
      });
      return;
    }

    plans.push({
      category: 'CREATE',
      directoryType,
      sourceKey,
      memberName: rawName,
      personId,
      proposedDisplayName: rawName,
      legacyNames: [],
      active: true,
      reason: 'New canonical identity derived from stable identifier'
    });
  });

  const summary = {
    total: plans.length,
    create: plans.filter(p => p.category === 'CREATE').length,
    reuse: plans.filter(p => p.category === 'REUSE').length,
    aliasUpdate: plans.filter(p => p.category === 'ALIAS_UPDATE').length,
    inactive: plans.filter(p => p.category === 'INACTIVE').length,
    ambiguous: plans.filter(p => p.category === 'AMBIGUOUS').length,
    missingStableId: plans.filter(p => p.category === 'MISSING_STABLE_ID').length,
    canProceed: plans.every(p => p.category !== 'AMBIGUOUS' && p.category !== 'MISSING_STABLE_ID')
  };

  return {
    summary,
    plans
  };
}

export default {
  planIdentityMigration
};
