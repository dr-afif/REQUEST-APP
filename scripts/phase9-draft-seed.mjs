import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import RosterCompatibility from '../src/features/roster/compatibility.js';
import { computeRowsChecksum } from './phase9-production-baseline.mjs';

/**
 * Phase 9 Preliminary MasterRoster to V2 DRAFT Seeding Utility
 *
 * Deterministically converts an existing target-month legacy MasterRoster partition
 * into an initial V2 DRAFT patch operation without modifying live production
 * Google Sheets or publishing the roster.
 *
 * Invariants:
 * - Read-only with respect to legacy MasterRoster (MASTERROSTER_MUTATION_COUNT = 0).
 * - Zero Planned assignments created (PLANNED_ASSIGNMENTS_CREATED = 0).
 * - Zero Entitlement transactions created (ENTITLEMENT_TRANSACTIONS_CREATED = 0).
 * - Fails closed on any identity collision, unsupported shift, malformed date, or checksum mismatch.
 * - Deterministic: identical inputs produce byte-for-byte identical draft patches.
 */

export function deterministicUuid(seed) {
  const hash = crypto.createHash('sha256').update(String(seed)).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

export function parseGridToRows(grid) {
  if (!Array.isArray(grid) || grid.length <= 1) return [];
  const header = grid[0].map(h => String(h ?? '').trim().toLowerCase());
  const nameIdx = header.findIndex(h => h === 'name' || h === 'membername' || h === 'doctor');
  const dateIdx = header.findIndex(h => h === 'date' || h === 'dutydate');
  const shiftIdx = header.findIndex(h => h === 'shift' || h === 'shifttype');

  const actualNameIdx = nameIdx >= 0 ? nameIdx : 0;
  const actualDateIdx = dateIdx >= 0 ? dateIdx : 1;
  const actualShiftIdx = shiftIdx >= 0 ? shiftIdx : 2;

  return grid.slice(1).map((row, idx) => {
    return {
      sourceRow: idx + 2,
      rawRow: row,
      Name: String(row[actualNameIdx] ?? '').trim(),
      Date: String(row[actualDateIdx] ?? '').trim(),
      Shift: String(row[actualShiftIdx] ?? '').trim()
    };
  }).filter(r => Boolean(r.Name || r.Date || r.Shift));
}

export function parseRosterPeopleInput(rosterPeople) {
  if (Array.isArray(rosterPeople)) {
    // Check if 2D grid
    if (rosterPeople.length > 0 && Array.isArray(rosterPeople[0])) {
      const header = rosterPeople[0].map(h => String(h ?? '').trim().toLowerCase());
      const pidIdx = header.indexOf('personid');
      const nameIdx = header.indexOf('currentdisplayname');
      const dirIdx = header.indexOf('directorytype');
      const legIdx = header.indexOf('legacynamesjson');
      const actIdx = header.indexOf('active');

      return rosterPeople.slice(1).map(row => ({
        PersonId: pidIdx >= 0 ? String(row[pidIdx] ?? '').trim() : '',
        CurrentDisplayName: nameIdx >= 0 ? String(row[nameIdx] ?? '').trim() : '',
        DirectoryType: dirIdx >= 0 ? String(row[dirIdx] ?? '').trim() : 'MO',
        LegacyNamesJson: legIdx >= 0 ? String(row[legIdx] ?? '').trim() : '[]',
        Active: actIdx >= 0 ? row[actIdx] : true
      })).filter(p => Boolean(p.PersonId));
    }
    return rosterPeople.map(p => ({
      PersonId: p.PersonId || p.personId,
      CurrentDisplayName: p.CurrentDisplayName || p.currentDisplayName || p.displayName,
      DirectoryType: p.DirectoryType || p.directoryType || 'MO',
      LegacyNamesJson: p.LegacyNamesJson || (Array.isArray(p.aliases) ? JSON.stringify(p.aliases) : p.legacyNamesJson) || '[]',
      Active: p.Active !== undefined ? p.Active : (p.active !== undefined ? p.active : true)
    })).filter(p => Boolean(p.PersonId));
  }
  return [];
}

/**
 * Generates an initial V2 DRAFT seed plan for the target month from legacy MasterRoster.
 */
export function generateDraftSeedPlan({
  periodId,
  legacyMasterRoster,
  rosterPeople,
  shiftSemantics = null,
  expectedChecksum = null,
  existingDraftState = null,
  resume = false,
  operationId = null,
  clientId = null,
  tabId = null
}) {
  // 1. Period validation
  if (!periodId || !/^\d{4}-(0[1-9]|1[0-2])$/.test(periodId)) {
    throw new Error(`INVALID_PERIOD_ID: "${periodId}". Must be YYYY-MM.`);
  }

  // 2. Existing draft state gate
  if (existingDraftState && !resume) {
    const existingCells = existingDraftState.cells || existingDraftState;
    if (Object.keys(existingCells).length > 0) {
      throw new Error(`DRAFT_ALREADY_EXISTS: Target period ${periodId} already contains draft state.`);
    }
  }

  // 3. Normalize legacy rows
  let rows = [];
  let rawPartitionRows = [];
  if (Array.isArray(legacyMasterRoster)) {
    if (legacyMasterRoster.length > 0 && Array.isArray(legacyMasterRoster[0])) {
      rows = parseGridToRows(legacyMasterRoster);
      // Filter rows specifically matching the period
      const targetGridRows = legacyMasterRoster.slice(1).filter(r => {
        const d = String(r[1] ?? '').trim();
        return d.startsWith(periodId);
      });
      rawPartitionRows = targetGridRows;
    } else {
      rows = legacyMasterRoster.map((r, idx) => ({
        sourceRow: idx + 2,
        rawRow: [r.Name, r.Date, r.Shift],
        Name: String(r.Name || r.name || '').trim(),
        Date: String(r.Date || r.date || '').trim(),
        Shift: String(r.Shift || r.shift || '').trim()
      }));
      rawPartitionRows = rows.filter(r => r.Date.startsWith(periodId)).map(r => r.rawRow);
    }
  }

  const periodRows = rows.filter(r => r.Date.startsWith(periodId));

  // 4. Source checksum verification gate
  if (expectedChecksum) {
    const computed = computeRowsChecksum(rawPartitionRows);
    if (computed !== expectedChecksum) {
      throw new Error(`SOURCE_MASTERROSTER_CHANGED: Expected checksum "${expectedChecksum}" does not match computed partition checksum "${computed}".`);
    }
  }

  // 5. Build identity resolver
  const peopleRecords = parseRosterPeopleInput(rosterPeople);
  if (peopleRecords.length === 0) {
    throw new Error('NO_ROSTER_PEOPLE: Approved RosterPeople identities required for draft seeding.');
  }
  const resolvePerson = RosterCompatibility.personIndex(peopleRecords);

  // 6. Resolve and validate each row
  const patches = [];
  const logicalCells = {};
  const seenAssignments = new Set();
  const shiftDistribution = {};
  const personsRepresented = new Set();
  const datesRepresented = new Set();

  periodRows.forEach(row => {
    // Check date validity
    const isoDate = RosterCompatibility.localDate(row.Date);
    if (!isoDate || !isoDate.startsWith(periodId)) {
      throw new Error(`MALFORMED_DATE: Invalid date "${row.Date}" on row ${row.sourceRow}`);
    }

    // Resolve person across domains
    const person = resolvePerson(row.Name, 'AUTO');

    // Reject EP identity in MO seed
    if (person && person.directoryType === 'EP') {
      throw new Error(`EP_IN_MO_SEED_REJECTED: Doctor "${row.Name}" (${person.personId || 'unregistered'}) is registered as Emergency Physician (EP). MO draft seed strictly rejects EP identities.`);
    }

    if (!person || !person.personId) {
      throw new Error(`UNRESOLVED_IDENTITY: Cannot resolve doctor "${row.Name}" on row ${row.sourceRow} to registered PersonId.`);
    }

    // Check duplicate assignment
    const assignKey = `${person.personId}/${isoDate}`;
    if (seenAssignments.has(assignKey)) {
      throw new Error(`DUPLICATE_ASSIGNMENT: Multiple assignments found for person "${person.personId}" (${row.Name}) on date "${isoDate}".`);
    }
    seenAssignments.add(assignKey);

    // Validate shift semantics
    const shiftResolved = RosterCompatibility.resolveShift(row.Shift, 'MO');
    if (!shiftResolved.known || shiftResolved.moApplicable === false) {
      throw new Error(`UNSUPPORTED_SHIFT_CODE: Shift code "${row.Shift}" on row ${row.sourceRow} is not recognized in ShiftSemantics catalog.`);
    }

    const canonicalShift = shiftResolved.canonicalCode || shiftResolved.baseCode || String(row.Shift).trim().toUpperCase();

    patches.push({
      personId: person.personId,
      date: isoDate,
      value: canonicalShift,
      sourceRow: row.sourceRow,
      doctorName: person.displayName
    });

    logicalCells[assignKey] = canonicalShift;
    shiftDistribution[canonicalShift] = (shiftDistribution[canonicalShift] || 0) + 1;
    personsRepresented.add(person.personId);
    datesRepresented.add(isoDate);
  });

  // Sort patches deterministically: by date ascending, then personId ascending
  patches.sort((a, b) => a.date.localeCompare(b.date) || a.personId.localeCompare(b.personId));

  // Compute canonical checksum of cells
  const cellsChecksum = crypto.createHash('sha256')
    .update(RosterCompatibility.canonicalJson(logicalCells))
    .digest('hex');

  const finalOpId = operationId || deterministicUuid(`draft-seed:op:${periodId}:${cellsChecksum}`);
  const finalClientId = clientId || deterministicUuid(`draft-seed:client:${periodId}`);
  const finalTabId = tabId || deterministicUuid(`draft-seed:tab:${periodId}`);

  const operation = {
    operationId: finalOpId,
    clientId: finalClientId,
    tabId: finalTabId,
    operationType: 'DRAFT_PATCH',
    entityKey: `draft:${periodId}`,
    expectedRevision: 0,
    payload: {
      patches: patches.map(p => ({
        personId: p.personId,
        date: p.date,
        value: p.value
      }))
    }
  };

  return {
    periodId,
    operation,
    summary: {
      sourceRowCount: periodRows.length,
      resolvedRowCount: patches.length,
      personsRepresentedCount: personsRepresented.size,
      datesRepresentedCount: datesRepresented.size,
      shiftDistribution,
      cellsChecksum,
      duplicateCount: 0,
      unsupportedShiftCount: 0,
      unresolvedIdentityCount: 0
    },
    logicalCells,
    invariants: {
      masterRosterMutationCount: 0,
      plannedAssignmentsCreated: 0,
      entitlementTransactionsCreated: 0
    },
    rawPatchesWithMetadata: patches
  };
}

/**
 * Reverse verification: checks that logical draft cells match source rows exactly 1-to-1.
 */
export function verifyDraftSeedEquivalence(seedPlan, legacyMasterRoster) {
  let rows = [];
  if (Array.isArray(legacyMasterRoster)) {
    if (legacyMasterRoster.length > 0 && Array.isArray(legacyMasterRoster[0])) {
      rows = parseGridToRows(legacyMasterRoster);
    } else {
      rows = legacyMasterRoster.map((r, idx) => ({
        sourceRow: idx + 2,
        Name: String(r.Name || r.name || '').trim(),
        Date: String(r.Date || r.date || '').trim(),
        Shift: String(r.Shift || r.shift || '').trim()
      }));
    }
  }

  const periodRows = rows.filter(r => r.Date.startsWith(seedPlan.periodId));
  const cells = seedPlan.logicalCells;

  if (periodRows.length !== Object.keys(cells).length) {
    return {
      equivalent: false,
      reason: `Row count mismatch: source has ${periodRows.length} rows, draft has ${Object.keys(cells).length} cells.`,
      sourceCount: periodRows.length,
      draftCount: Object.keys(cells).length
    };
  }

  const patchLookup = new Map();
  seedPlan.rawPatchesWithMetadata.forEach(p => {
    // Map doctorName/date -> value
    const key = `${p.doctorName.toLowerCase()}/${p.date}`;
    patchLookup.set(key, p.value);
  });

  const discrepancies = [];
  periodRows.forEach(r => {
    const docName = RosterCompatibility.canonicalName(r.Name, 'MO');
    const isoDate = RosterCompatibility.localDate(r.Date);
    const key = `${docName.toLowerCase()}/${isoDate}`;
    const draftValue = patchLookup.get(key);

    const resolvedShift = RosterCompatibility.resolveShift(r.Shift, 'MO');
    const expectedShift = resolvedShift.canonicalCode || resolvedShift.baseCode || String(r.Shift).trim().toUpperCase();

    if (!draftValue) {
      discrepancies.push(`Source row for "${r.Name}" on ${r.Date} has no matching draft cell.`);
    } else if (draftValue !== expectedShift) {
      discrepancies.push(`Shift mismatch for "${r.Name}" on ${r.Date}: source=${expectedShift}, draft=${draftValue}.`);
    }
  });

  return {
    equivalent: discrepancies.length === 0,
    discrepancies,
    sourceRowCount: periodRows.length,
    draftCellCount: Object.keys(cells).length
  };
}

// CLI entry point
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'))) {
  const snapshotPath = process.argv[2];
  const targetPeriod = process.argv[3] || '2026-11';
  const expectedChecksum = process.argv[4] || null;
  const jsonOut = process.argv[5] || null;
  const csvOut = process.argv[6] || null;

  if (!snapshotPath) {
    console.error('Usage: node scripts/phase9-draft-seed.mjs <snapshot.json> [periodId] [expectedChecksum] [out.json] [out.csv]');
    process.exit(1);
  }

  const raw = fs.readFileSync(path.resolve(snapshotPath), 'utf8');
  const snap = JSON.parse(raw);
  const tables = snap.tables || snap;

  const plan = generateDraftSeedPlan({
    periodId: targetPeriod,
    legacyMasterRoster: tables['MasterRoster'] || [],
    rosterPeople: tables['RosterPeople'] || [],
    expectedChecksum
  });

  const verification = verifyDraftSeedEquivalence(plan, tables['MasterRoster'] || []);

  console.log(`Draft Seed Plan for ${targetPeriod}:`);
  console.log(`Source rows: ${plan.summary.sourceRowCount}, Resolved cells: ${plan.summary.resolvedRowCount}`);
  console.log(`Reverse Equivalence: ${verification.equivalent ? 'PASS (100% equivalent)' : 'FAIL'}`);

  if (jsonOut) {
    fs.writeFileSync(path.resolve(jsonOut), JSON.stringify({ ...plan, verification }, null, 2), 'utf8');
    console.log(`Wrote JSON preview to ${jsonOut}`);
  }

  if (csvOut) {
    const csvHeader = ['PersonId', 'DoctorName', 'Date', 'Shift', 'SourceRow'];
    const csvRows = plan.rawPatchesWithMetadata.map(p =>
      `"${p.personId}","${p.doctorName}","${p.date}","${p.value}",${p.sourceRow}`
    );
    fs.writeFileSync(path.resolve(csvOut), [csvHeader.join(','), ...csvRows].join('\n'), 'utf8');
    console.log(`Wrote CSV review to ${csvOut}`);
  }
}
