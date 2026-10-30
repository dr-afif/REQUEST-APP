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

function findManualMapping(entry, manualMappings) {
  if (!Array.isArray(manualMappings) || manualMappings.length === 0) return null;
  const canonical = RosterCompatibility.canonicalName(entry.rawName, entry.directoryType);
  return manualMappings.find(m => {
    if (m.directoryType && m.directoryType !== entry.directoryType) return false;
    const mCanonical = RosterCompatibility.canonicalName(m.rawName || m.memberName || m.name, entry.directoryType);
    return mCanonical === canonical;
  }) || null;
}

export function planIdentityMigration({
  teamMembers = [],
  emergencyPhysicians = [],
  existingPeople = [],
  manualMappings = [],
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
    const staffId = cleanStaffId(entry.StaffId || entry.staffId);
    const email = cleanEmail(entry.Email || entry.email);
    const active = entry.Active !== false && String(entry.Active).toLowerCase() !== 'false';
    rawEntries.push({
      directoryType: 'MO',
      rawName,
      sourceKey,
      identifierType,
      identifierValue,
      staffId,
      email,
      active,
      index: idx
    });
  });

  // Ingest EmergencyPhysicians (EP)
  emergencyPhysicians.forEach((entry, idx) => {
    const rawName = cleanStr(entry.MemberName || entry.name);
    if (!rawName) return;
    const { sourceKey, identifierType, identifierValue } = deriveSourceKey(entry, 'EP');
    const staffId = cleanStaffId(entry.StaffId || entry.staffId);
    const email = cleanEmail(entry.Email || entry.email);
    const active = entry.Active !== false && String(entry.Active).toLowerCase() !== 'false';
    rawEntries.push({
      directoryType: 'EP',
      rawName,
      sourceKey,
      identifierType,
      identifierValue,
      staffId,
      email,
      active,
      index: idx
    });
  });

  // Apply approved manual mappings to raw entries before collision detection
  rawEntries.forEach(entry => {
    const manual = findManualMapping(entry, manualMappings);
    if (manual) {
      entry.manualMapping = manual;
      if (manual.approved === true) {
        if (manual.staffId) {
          entry.staffId = cleanStaffId(manual.staffId);
          entry.sourceKey = `${entry.directoryType}:staffId:${cleanStaffId(manual.staffId)}`;
          entry.identifierType = 'STAFF_ID';
          entry.identifierValue = cleanStaffId(manual.staffId);
        } else if (manual.email) {
          entry.email = cleanEmail(manual.email);
          entry.sourceKey = `${entry.directoryType}:email:${cleanEmail(manual.email)}`;
          entry.identifierType = 'EMAIL';
          entry.identifierValue = cleanEmail(manual.email);
        } else if (manual.personId || manual.approvedPersonId) {
          const pid = manual.personId || manual.approvedPersonId;
          entry.sourceKey = `${entry.directoryType}:manual:${pid}`;
          entry.identifierType = 'MANUAL';
          entry.identifierValue = pid;
          entry.explicitPersonId = pid;
        }
      }
    }
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
    if (e.identifierValue && (!e.manualMapping || !e.manualMapping.approved)) {
      const gKey = `${e.identifierType}:${e.identifierValue}`;
      if (!globalIdentifierCounts.has(gKey)) globalIdentifierCounts.set(gKey, new Set());
      globalIdentifierCounts.get(gKey).add(e.directoryType);
    }
  });

  const plans = [];

  rawEntries.forEach(entry => {
    const { directoryType, rawName, sourceKey, identifierType, identifierValue, staffId, email, active, manualMapping, explicitPersonId } = entry;
    const gKey = identifierValue ? `${identifierType}:${identifierValue}` : null;
    const isCrossDomainCollision = gKey && globalIdentifierCounts.get(gKey) && globalIdentifierCounts.get(gKey).size > 1;
    const isDuplicateStableId = sourceKey && (sourceKeyCounts.get(sourceKey) > 1);

    // Fail-Closed Category: AMBIGUOUS (unless approved manual mapping explicitly resolves it)
    if (isCrossDomainCollision && (!manualMapping || manualMapping.approved !== true)) {
      plans.push({
        category: 'AMBIGUOUS',
        directoryType,
        sourceKey,
        staffId: staffId || '',
        email: email || '',
        memberName: rawName,
        personId: null,
        proposedDisplayName: rawName,
        legacyNames: [],
        active,
        reason: `CROSS_DOMAIN_COLLISION: ${identifierType} ${identifierValue} exists in both MO and EP`
      });
      return;
    }

    if (isDuplicateStableId && (!manualMapping || manualMapping.approved !== true)) {
      plans.push({
        category: 'AMBIGUOUS',
        directoryType,
        sourceKey,
        staffId: staffId || '',
        email: email || '',
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
      const reason = manualMapping && manualMapping.approved === false
        ? 'Manual mapping unapproved. Record remains blocked.'
        : 'Missing immutable StaffId and valid Email. Manual admin mapping required.';
      plans.push({
        category: 'MISSING_STABLE_ID',
        directoryType,
        sourceKey: null,
        staffId: staffId || '',
        email: email || '',
        memberName: rawName,
        personId: null,
        proposedDisplayName: rawName,
        legacyNames: [],
        active,
        reason
      });
      return;
    }

    // Derive or assign deterministic RFC 4122 v4 UUID
    const personId = explicitPersonId || RosterLifecycle.deterministicUuid(`person:${sourceKey}`, digestFn);
    const existing = existingById.get(personId);
    const manualNote = (manualMapping && manualMapping.approved) ? ` (Approved manual mapping: ${manualMapping.notes || manualMapping.reviewer || 'Operator resolved'})` : '';

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
          staffId: staffId || '',
          email: email || '',
          memberName: rawName,
          personId,
          proposedDisplayName: rawName,
          legacyNames,
          active: false,
          reason: `Marked inactive in directory; retained with Active: false${manualNote}`
        });
        return;
      }

      if (isRenamed) {
        if (!legacyNames.includes(existingName)) legacyNames.push(existingName);
        plans.push({
          category: 'ALIAS_UPDATE',
          directoryType,
          sourceKey,
          staffId: staffId || '',
          email: email || '',
          memberName: rawName,
          personId,
          proposedDisplayName: rawName,
          legacyNames,
          active: true,
          reason: `Display name changed from "${existingName}" to "${rawName}"; former name added to LegacyNamesJson${manualNote}`
        });
        return;
      }

      plans.push({
        category: 'REUSE',
        directoryType,
        sourceKey,
        staffId: staffId || '',
        email: email || '',
        memberName: rawName,
        personId,
        proposedDisplayName: rawName,
        legacyNames,
        active: Boolean(existing.Active !== false),
        reason: `Identical stable ID and display name already registered${manualNote}`
      });
      return;
    }

    // New person
    if (!active) {
      plans.push({
        category: 'INACTIVE',
        directoryType,
        sourceKey,
        staffId: staffId || '',
        email: email || '',
        memberName: rawName,
        personId,
        proposedDisplayName: rawName,
        legacyNames: [],
        active: false,
        reason: `New staff member registered as inactive${manualNote}`
      });
      return;
    }

    plans.push({
      category: 'CREATE',
      directoryType,
      sourceKey,
      staffId: staffId || '',
      email: email || '',
      memberName: rawName,
      personId,
      proposedDisplayName: rawName,
      legacyNames: [],
      active: true,
      reason: `New canonical identity derived from stable identifier${manualNote}`
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
