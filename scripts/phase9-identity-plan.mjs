import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { planIdentityMigration } from '../src/features/roster/identityMigration.js';

/**
 * Phase 9 Production Identity Reconciliation Package
 *
 * Generates an auditable, deterministic dry-run plan for migrating legacy
 * TeamMembers (MO) and EmergencyPhysicians (EP) into canonical RosterPeople records.
 *
 * Enforces Hard Release Blocker (Requirement 8):
 * - AMBIGUOUS = 0
 * - MISSING_STABLE_ID = 0
 * Production identity migration may proceed ONLY if all records have valid stable
 * identifiers or explicit approved manual mappings.
 */

export function digestSha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function parseDirectoryGrid(grid, defaultDomain) {
  if (!Array.isArray(grid) || grid.length <= 1) return [];
  const header = grid[0].map(h => String(h ?? '').trim().toLowerCase());
  const nameIdx = header.findIndex(h => h === 'membername' || h === 'name' || h === 'fullname');
  const staffIdx = header.findIndex(h => h === 'staffid');
  const emailIdx = header.findIndex(h => h === 'email');
  const actIdx = header.findIndex(h => h === 'active');

  return grid.slice(1).map(row => {
    return {
      MemberName: String(row[nameIdx >= 0 ? nameIdx : 0] ?? '').trim(),
      StaffId: staffIdx >= 0 ? String(row[staffIdx] ?? '').trim() : '',
      Email: emailIdx >= 0 ? String(row[emailIdx] ?? '').trim() : '',
      Active: actIdx >= 0 ? row[actIdx] : true
    };
  }).filter(e => Boolean(e.MemberName));
}

function parseExistingPeopleGrid(grid) {
  if (!Array.isArray(grid) || grid.length <= 1) return [];
  const header = grid[0].map(h => String(h ?? '').trim().toLowerCase());
  const pidIdx = header.findIndex(h => h === 'personid');
  const dirIdx = header.findIndex(h => h === 'directorytype');
  const nameIdx = header.findIndex(h => h === 'currentdisplayname');
  const legIdx = header.findIndex(h => h === 'legacynamesjson');
  const actIdx = header.findIndex(h => h === 'active');

  return grid.slice(1).map(row => {
    return {
      PersonId: pidIdx >= 0 ? String(row[pidIdx] ?? '').trim() : '',
      DirectoryType: dirIdx >= 0 ? String(row[dirIdx] ?? '').trim() : 'MO',
      CurrentDisplayName: nameIdx >= 0 ? String(row[nameIdx] ?? '').trim() : '',
      LegacyNamesJson: legIdx >= 0 ? String(row[legIdx] ?? '').trim() : '[]',
      Active: actIdx >= 0 ? row[actIdx] : true
    };
  }).filter(p => Boolean(p.PersonId));
}

export function generateIdentityPlan({
  workbookInput,
  manualMappings = [],
  digestFn = digestSha256
}) {
  let tables = workbookInput;
  if (typeof workbookInput === 'string') {
    const raw = fs.readFileSync(path.resolve(workbookInput), 'utf8');
    const parsed = JSON.parse(raw);
    tables = parsed.tables || parsed;
  } else if (workbookInput?.tables) {
    tables = workbookInput.tables;
  }

  const teamMembers = parseDirectoryGrid(tables['TeamMembers'] || [], 'MO');
  const emergencyPhysicians = parseDirectoryGrid(tables['EmergencyPhysicians'] || [], 'EP');
  const existingPeople = parseExistingPeopleGrid(tables['RosterPeople'] || []);

  const result = planIdentityMigration({
    teamMembers,
    emergencyPhysicians,
    existingPeople,
    manualMappings,
    digestFn
  });

  return result;
}

/**
 * Converts identity plan list into human-reviewable CSV format.
 * Columns: DirectoryType,CurrentDisplayName,StaffId,Email,ProposedPersonId,Action,Reason,AliasesToPreserve,Active
 */
export function identityPlanToCsv(plans) {
  const header = [
    'DirectoryType',
    'CurrentDisplayName',
    'StaffId',
    'Email',
    'ProposedPersonId',
    'Action',
    'Reason',
    'AliasesToPreserve',
    'Active'
  ];

  const escapeCsv = val => {
    const s = String(val ?? '').trim();
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };

  const rows = plans.map(p => {
    let staffId = p.staffId || '';
    let email = p.email || '';
    if (!staffId && p.sourceKey?.includes(':staffId:')) {
      staffId = p.sourceKey.split(':staffId:')[1] || '';
    }
    if (!email && p.sourceKey?.includes(':email:')) {
      email = p.sourceKey.split(':email:')[1] || '';
    }
    const aliases = (p.legacyNames || []).join('; ');

    return [
      escapeCsv(p.directoryType),
      escapeCsv(p.memberName),
      escapeCsv(staffId),
      escapeCsv(email),
      escapeCsv(p.personId || ''),
      escapeCsv(p.category),
      escapeCsv(p.reason),
      escapeCsv(aliases),
      escapeCsv(p.active ? 'TRUE' : 'FALSE')
    ].join(',');
  });

  return [header.join(','), ...rows].join('\n');
}

/**
 * Validates identity plan against production release criteria (Requirement 8).
 */
export function validateIdentityPlanForRelease(planResult) {
  const { summary, plans } = planResult;
  const blockers = [];

  if (summary.ambiguous > 0) {
    const ambigPlans = plans.filter(p => p.category === 'AMBIGUOUS');
    blockers.push(`AMBIGUOUS count is ${summary.ambiguous} (records: ${ambigPlans.map(p => `${p.directoryType}:${p.memberName}`).join(', ')}). Release blocked.`);
  }

  if (summary.missingStableId > 0) {
    const missingPlans = plans.filter(p => p.category === 'MISSING_STABLE_ID');
    blockers.push(`MISSING_STABLE_ID count is ${summary.missingStableId} (records: ${missingPlans.map(p => `${p.directoryType}:${p.memberName}`).join(', ')}). Release blocked.`);
  }

  return {
    canProceed: blockers.length === 0,
    blockers,
    summary
  };
}

// CLI entry point
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'))) {
  const workbookPath = process.argv[2];
  const manualMappingsPath = process.argv[3];
  const csvOut = process.argv[4];
  const jsonOut = process.argv[5];

  if (!workbookPath) {
    console.error('Usage: node scripts/phase9-identity-plan.mjs <workbook.json> [manual-mappings.json] [out.csv] [out.json]');
    process.exit(1);
  }

  let manualMappings = [];
  if (manualMappingsPath && fs.existsSync(manualMappingsPath)) {
    manualMappings = JSON.parse(fs.readFileSync(path.resolve(manualMappingsPath), 'utf8'));
  }

  const result = generateIdentityPlan({ workbookInput: workbookPath, manualMappings });
  const validation = validateIdentityPlanForRelease(result);

  console.log(`Identity Plan Summary: Total=${result.summary.total}, CREATE=${result.summary.create}, REUSE=${result.summary.reuse}, ALIAS_UPDATE=${result.summary.aliasUpdate}, INACTIVE=${result.summary.inactive}, AMBIGUOUS=${result.summary.ambiguous}, MISSING_STABLE_ID=${result.summary.missingStableId}`);
  console.log(`Release Ready: ${validation.canProceed ? 'YES' : 'NO - BLOCKER'}`);

  if (csvOut) {
    const csvContent = identityPlanToCsv(result.plans);
    fs.writeFileSync(path.resolve(csvOut), csvContent, 'utf8');
    console.log(`Wrote review CSV to ${csvOut}`);
  }

  if (jsonOut) {
    fs.writeFileSync(path.resolve(jsonOut), JSON.stringify({ ...result, validation }, null, 2), 'utf8');
    console.log(`Wrote JSON artifact to ${jsonOut}`);
  }

  if (!validation.canProceed) {
    process.exit(2);
  }
}
