import fs from 'node:fs';
import path from 'node:path';

/**
 * Phase 9 Opening Entitlement Balance Validator
 *
 * Enforces authoritative rules for non-production review and manual credit import:
 * 1. EntitlementType must strictly be GOFF or GHKA.
 * 2. Amount must strictly be +1 (atomic credit).
 * 3. ReasonCode must strictly be OPENING_BALANCE.
 * 4. Zero GOFF* legacy inference; zero automated balance calculation.
 * 5. EP staff are strictly rejected (MO domain only).
 * 6. PersonId must exist in the approved MO identity registry.
 * 7. Rows must have explicit review approval (Approved: true, non-empty ReviewedBy).
 */

export function parseCsvRows(csvContent) {
  if (!csvContent || typeof csvContent !== 'string') return [];
  const lines = csvContent.split(/\r?\n/).filter(line => line.trim().length > 0);
  if (lines.length <= 1) return [];

  const parseLine = line => {
    const result = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (inQuotes && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (c === ',' && !inQuotes) {
        result.push(cur.trim());
        cur = '';
      } else {
        cur += c;
      }
    }
    result.push(cur.trim());
    return result;
  };

  const header = parseLine(lines[0]).map(h => h.trim());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = parseLine(lines[i]);
    const rowObj = {};
    header.forEach((h, idx) => {
      rowObj[h] = vals[idx] ?? '';
    });
    rowObj._rowNumber = i + 1;
    rows.push(rowObj);
  }
  return rows;
}

export function validateOpeningEntitlementRows(rows, {
  approvedMoPersonIds = new Set(),
  epPersonIds = new Set()
} = {}) {
  const errors = [];
  const validRows = [];

  rows.forEach(row => {
    const rNum = row._rowNumber || 'unknown';
    const personId = String(row.PersonId || '').trim();
    const displayName = String(row.DisplayNameForReview || '').trim();
    const entitlementType = String(row.EntitlementType || '').trim().toUpperCase();
    const amount = Number(row.Amount);
    const effectiveDate = String(row.EffectiveDate || '').trim();
    const reasonCode = String(row.ReasonCode || '').trim();
    const adminNote = String(row.AdminNote || '').trim();
    const reviewedBy = String(row.ReviewedBy || '').trim();
    const approved = String(row.Approved || '').trim().toLowerCase() === 'true';

    // 1. PersonId & Domain Checks
    if (!personId) {
      errors.push(`Row ${rNum}: Missing PersonId for "${displayName}"`);
      return;
    }

    if (epPersonIds.has(personId)) {
      errors.push(`Row ${rNum}: PersonId ${personId} (${displayName}) belongs to Emergency Physician (EP) directory. EP staff are strictly excluded from MO entitlement ledger.`);
      return;
    }

    if (approvedMoPersonIds.size > 0 && !approvedMoPersonIds.has(personId)) {
      errors.push(`Row ${rNum}: PersonId ${personId} (${displayName}) not found in approved MO identity registry.`);
      return;
    }

    // 2. Entitlement Type
    if (entitlementType !== 'GOFF' && entitlementType !== 'GHKA') {
      errors.push(`Row ${rNum}: Invalid EntitlementType "${entitlementType}". Allowed types are strictly GOFF or GHKA.`);
      return;
    }

    // 3. Amount Constraints
    if (amount !== 1) {
      errors.push(`Row ${rNum}: Amount must strictly be +1 (atomic balance credit). Found "${row.Amount}".`);
      return;
    }

    // 4. Reason Code
    if (reasonCode !== 'OPENING_BALANCE') {
      errors.push(`Row ${rNum}: ReasonCode must strictly be "OPENING_BALANCE". Found "${reasonCode}".`);
      return;
    }

    // 5. Effective Date
    if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)) {
      errors.push(`Row ${rNum}: EffectiveDate must be in YYYY-MM-DD format. Found "${effectiveDate}".`);
      return;
    }

    // 6. Review & Approval
    if (!approved) {
      errors.push(`Row ${rNum}: Row for ${displayName} is not approved (Approved="${row.Approved}"). Unapproved opening balances cannot be imported.`);
    }

    if (!reviewedBy) {
      errors.push(`Row ${rNum}: Missing ReviewedBy auditor/HOD signature for ${displayName}.`);
    }

    if (!approved || !reviewedBy) {
      return;
    }

    validRows.push({
      personId,
      displayName,
      entitlementType,
      amount,
      effectiveDate,
      reasonCode,
      adminNote,
      reviewedBy
    });
  });

  return {
    isValid: errors.length === 0,
    errors,
    validRows,
    totalRows: rows.length,
    validRowCount: validRows.length
  };
}
