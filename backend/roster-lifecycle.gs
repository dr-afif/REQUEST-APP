// Apps Script Phase 4 Roster Lifecycle Backend Engine
// Operates under ScriptLock, enforces deterministic planned snapshots, immutable published periods,
// month-scoped MasterRoster projections with persisted readback checksum verification, and idempotent journal recovery.

function rosterLifecycleSchemas_() {
  const schemas = Object.assign({}, RosterLifecycle.ROSTER_LIFECYCLE_SCHEMAS);
  if (typeof RosterAbsence !== 'undefined' && RosterAbsence.ABSENCE_SCHEMAS) {
    Object.assign(schemas, RosterAbsence.ABSENCE_SCHEMAS);
  }
  if (typeof RosterEntitlement !== 'undefined' && RosterEntitlement.ROSTER_ENTITLEMENT_SCHEMAS) {
    Object.assign(schemas, RosterEntitlement.ROSTER_ENTITLEMENT_SCHEMAS);
  }
  if (typeof RosterCompatibility !== 'undefined' && RosterCompatibility.schemas) {
    if (RosterCompatibility.schemas.RosterPeople) schemas.RosterPeople = RosterCompatibility.schemas.RosterPeople;
    if (RosterCompatibility.schemas.ShiftSemantics) schemas.ShiftSemantics = RosterCompatibility.schemas.ShiftSemantics;
  }
  if (typeof ROSTER_DRAFT_SCHEMAS !== 'undefined') {
    Object.assign(schemas, ROSTER_DRAFT_SCHEMAS);
  }
  if (typeof RosterGuidance !== 'undefined' && RosterGuidance.OFF_POLICY_HEADERS) {
    schemas.OffPolicies = RosterGuidance.OFF_POLICY_HEADERS;
  }
  return schemas;
}

function rosterLifecycleEnsureSchema_(sheetName) {
  const schemas = rosterLifecycleSchemas_();
  const targetHeaders = schemas[sheetName];
  if (!targetHeaders) throw new Error('Unknown lifecycle schema: ' + sheetName);

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    sheet.getRange(1, 1, 1, targetHeaders.length).setValues([targetHeaders]);
    SpreadsheetApp.flush();
    return sheet;
  }

  const dataRange = sheet.getDataRange();
  const values = dataRange.getValues();
  const currentHeaders = values[0] || [];

  if (currentHeaders.length === 0) {
    sheet.getRange(1, 1, 1, targetHeaders.length).setValues([targetHeaders]);
    SpreadsheetApp.flush();
    return sheet;
  }

  // If every targetHeader is already present in currentHeaders, no upgrade needed.
  const allTargetHeadersPresent = targetHeaders.every(function(h) {
    return currentHeaders.indexOf(h) >= 0;
  });
  if (allTargetHeadersPresent) return sheet;

  // Additive & idempotent upgrade:
  // Target lifecycle headers come first in canonical order, followed by any existing non-target headers
  // (preserving Phase 1 columns like EnrolledAt, EnrolledBy, and any custom/legacy fields).
  const extraHeaders = currentHeaders.filter(function(h) {
    return h && targetHeaders.indexOf(h) === -1;
  });
  const upgradedHeaders = targetHeaders.concat(extraHeaders);

  const rows = values.slice(1);
  const headerMap = {};
  currentHeaders.forEach(function(h, i) { if (h) headerMap[h] = i; });

  const upgradedRows = rows.map(function(row) {
    return upgradedHeaders.map(function(header) {
      if (headerMap[header] !== undefined) return row[headerMap[header]];
      if (sheetName === 'RosterPeriods') {
        if (header === 'State') return 'DRAFT';
        if (header === 'Revision') return 0;
        if (header === 'DraftRevision') return 0;
        if (header === 'SchemaVersion') return headerMap['SchemaVersion'] !== undefined ? row[headerMap['SchemaVersion']] : 2;
        if (header === 'UpdatedAt') return headerMap['EnrolledAt'] !== undefined ? row[headerMap['EnrolledAt']] : '';
      }
      return '';
    });
  });

  sheet.getDataRange().clearContent();
  const allValues = [upgradedHeaders].concat(upgradedRows);
  sheet.getRange(1, 1, allValues.length, upgradedHeaders.length).setValues(allValues);
  SpreadsheetApp.flush();
  return sheet;
}

function rosterLifecycleEnsureAllSchemas_() {
  ['RosterPeriods', 'RosterAssignments', 'RosterEvents', 'WeeklyOffSnapshots', 'RosterAbsences', 'RosterReplacements', 'RosterEntitlementTransactions'].forEach(function(name) {
    rosterLifecycleEnsureSchema_(name);
  });
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss.getSheetByName('OperationLog')) {
    const logSheet = ss.insertSheet('OperationLog');
    logSheet.getRange(1, 1, 1, ROSTER_DRAFT_SCHEMAS.OperationLog.length).setValues([ROSTER_DRAFT_SCHEMAS.OperationLog]);
    SpreadsheetApp.flush();
  }
}

function rosterEnsureDefaultSettings_() {
  const table = rosterV2ReadTable_('Settings');
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName('Settings');
  if (!sheet) {
    sheet = ss.insertSheet('Settings');
    sheet.getRange(1, 1, 1, 2).setValues([['Key', 'Value']]);
  }
  const existingKeys = new Set();
  if (table.exists) {
    table.rows.forEach(function(row) {
      const k = String(row[0] || '').trim();
      if (k) existingKeys.add(k);
    });
  }
  const defaults = [
    ['roster_v2_read_enabled', 'false'],
    ['roster_v2_write_enabled', 'false'],
    ['shift_semantics_v2_enabled', 'false'],
    ['weekly_off_guidance_enabled', 'false'],
    ['night_safety_guidance_enabled', 'false'],
    ['goff_ledger_enabled', 'false'],
    ['write_queue_v2_enabled', 'false'],
    ['roster_workspace_v2_enabled', 'false'],
    ['legacy_upload_enabled', 'true']
  ];
  const toAppend = defaults.filter(function(pair) { return !existingKeys.has(pair[0]); });
  if (toAppend.length > 0) {
    const startRow = sheet.getLastRow() + 1;
    sheet.getRange(startRow, 1, toAppend.length, 2).setValues(toAppend);
    SpreadsheetApp.flush();
  }
}

function rosterProvisionAllSchemas_() {
  const provisionOrder = [
    'RosterPeople',
    'ShiftSemantics',
    'OperationLog',
    'RosterDraftPatches',
    'OffPolicies',
    'RosterPeriods',
    'RosterAssignments',
    'WeeklyOffSnapshots',
    'RosterEvents',
    'RosterAbsences',
    'RosterReplacements',
    'RosterEntitlementTransactions'
  ];
  provisionOrder.forEach(function(name) {
    rosterLifecycleEnsureSchema_(name);
  });
  rosterEnsureDefaultSettings_();
}

function rosterLifecycleGetRecords_(sheetName) {
  rosterLifecycleEnsureSchema_(sheetName);
  const table = rosterV2ReadTable_(sheetName);
  if (!table.exists) return [];
  return table.rows.map(function(row, index) {
    const record = {};
    table.headers.forEach(function(header, colIdx) {
      record[header] = row[colIdx];
    });
    record._row = index + 2;
    return record;
  }).filter(function(record) {
    return table.headers.some(function(header) {
      return record[header] !== '' && record[header] !== null && record[header] !== undefined;
    });
  });
}

function rosterLifecycleWriteRow_(sheetName, record, row) {
  rosterLifecycleEnsureSchema_(sheetName);
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  const currentHeaders = sheet.getDataRange().getValues()[0] || [];
  const targetHeaders = currentHeaders.length > 0 ? currentHeaders : (rosterLifecycleSchemas_()[sheetName] || ROSTER_DRAFT_SCHEMAS[sheetName]);
  const values = targetHeaders.map(function(h) {
    return record[h] === undefined ? '' : record[h];
  });
  const targetRow = row || (sheet.getLastRow() + 1);
  sheet.getRange(targetRow, 1, 1, values.length).setValues([values]);
  SpreadsheetApp.flush();
}

function rosterLifecycleAppendRows_(sheetName, records) {
  if (!records || records.length === 0) return;
  rosterLifecycleEnsureSchema_(sheetName);
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  const currentHeaders = sheet.getDataRange().getValues()[0] || [];
  const targetHeaders = currentHeaders.length > 0 ? currentHeaders : rosterLifecycleSchemas_()[sheetName];
  const matrix = records.map(function(record) {
    return targetHeaders.map(function(h) {
      return record[h] === undefined ? '' : record[h];
    });
  });
  const startRow = sheet.getLastRow() + 1;
  sheet.getRange(startRow, 1, matrix.length, targetHeaders.length).setValues(matrix);
  SpreadsheetApp.flush();
}

function rosterLifecycleFindPeriod_(periodId) {
  const records = rosterLifecycleGetRecords_('RosterPeriods');
  return records.find(function(r) { return r.PeriodId === periodId; }) || null;
}

function rosterLifecycleFindPeriodByOperation_(operationId) {
  const records = rosterLifecycleGetRecords_('RosterPeriods');
  return records.find(function(r) { return r.LastOperationId === operationId; }) || null;
}

function rosterLifecycleFindAssignmentsByPeriod_(periodId) {
  const records = rosterLifecycleGetRecords_('RosterAssignments');
  return records.filter(function(r) { return r.PeriodId === periodId; });
}

function rosterLifecycleFindAssignmentsBySnapshot_(snapshotId) {
  const records = rosterLifecycleGetRecords_('RosterAssignments');
  return records.filter(function(r) { return r.SnapshotId === snapshotId; });
}

function rosterLifecycleFindAssignmentById_(assignmentId) {
  const records = rosterLifecycleGetRecords_('RosterAssignments');
  return records.find(function(r) { return r.AssignmentId === assignmentId; }) || null;
}

function rosterLifecycleFindAssignmentsByOperation_(operationId) {
  const records = rosterLifecycleGetRecords_('RosterAssignments');
  return records.filter(function(r) { return r.OperationId === operationId; });
}

function rosterLifecycleFindEventsByPeriod_(periodId) {
  const records = rosterLifecycleGetRecords_('RosterEvents');
  return records.filter(function(r) { return r.PeriodId === periodId; });
}

function rosterLifecycleFindEventById_(eventId) {
  const records = rosterLifecycleGetRecords_('RosterEvents');
  return records.find(function(r) { return r.EventId === eventId; }) || null;
}

function rosterLifecycleFindEventsByOperation_(operationId) {
  const records = rosterLifecycleGetRecords_('RosterEvents');
  return records.filter(function(r) { return r.OperationId === operationId; });
}

function rosterLifecycleFindWeeklyOffSnapshotsByPeriod_(periodId) {
  const records = rosterLifecycleGetRecords_('WeeklyOffSnapshots');
  return records.filter(function(r) {
    if (r.PolicyLockedByPeriodId === periodId) return true;
    try {
      const periods = JSON.parse(r.PublishedPeriodIdsJson || '[]');
      return Array.isArray(periods) && periods.includes(periodId);
    } catch (_) {
      return false;
    }
  });
}

function rosterLifecycleFindOperationLog_(operationId) {
  const table = rosterV2ReadTable_('OperationLog');
  if (!table.exists) return null;
  const opIdIdx = table.headers.indexOf('OperationId');
  if (opIdIdx === -1) return null;
  for (let i = 0; i < table.rows.length; i++) {
    const row = table.rows[i];
    if (row[opIdIdx] === operationId) {
      const record = { _row: i + 2 };
      table.headers.forEach(function(h, idx) { record[h] = row[idx]; });
      return record;
    }
  }
  return null;
}

function rosterLifecycleWriteLog_(logRecord) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('OperationLog');
  const headers = ROSTER_DRAFT_SCHEMAS.OperationLog;
  const values = headers.map(function(h) { return logRecord[h] === undefined ? '' : logRecord[h]; });
  if (logRecord._row) {
    sheet.getRange(logRecord._row, 1, 1, values.length).setValues([values]);
  } else {
    sheet.getRange(sheet.getLastRow() + 1, 1, 1, values.length).setValues([values]);
  }
  SpreadsheetApp.flush();
}

function rosterLifecycleGetPrincipalSafe_() {
  try {
    const allowed = String(PropertiesService.getScriptProperties().getProperty('ROSTER_V2_ADMIN_EMAIL') || '').trim().toLowerCase();
    const caller = String(Session.getActiveUser().getEmail() || '').trim().toLowerCase();
    if (allowed && caller && allowed === caller) {
      return { isAdmin: true, email: caller };
    }
    return { isAdmin: false, email: caller };
  } catch (_) {
    return { isAdmin: false, email: '' };
  }
}

function rosterLifecycleGetPeople_() {
  const table = rosterV2ReadTable_('RosterPeople');
  if (!table.exists) return [];
  return rosterV2Records_(table, ['PersonId', 'DirectoryType', 'CurrentDisplayName', 'LegacyNamesJson', 'Active']);
}

function rosterLifecycleGetConfirmedOperationIds_(periodId) {
  const table = rosterV2ReadTable_('OperationLog');
  const confirmed = new Set();
  if (!table.exists) return confirmed;
  const eKeyIdx = table.headers.indexOf('EntityKey');
  const statusIdx = table.headers.indexOf('Status');
  const opIdIdx = table.headers.indexOf('OperationId');
  const expectedKey = 'period:' + periodId;
  for (let i = 0; i < table.rows.length; i++) {
    const row = table.rows[i];
    if (row[eKeyIdx] === expectedKey && row[statusIdx] === 'CONFIRMED') {
      confirmed.add(row[opIdIdx]);
    }
  }
  return confirmed;
}

function rosterLifecycleFindConfirmedEventsByPeriod_(periodId, currentOperationIdToInclude) {
  const allEvents = rosterLifecycleFindEventsByPeriod_(periodId);
  const confirmedOpIds = rosterLifecycleGetConfirmedOperationIds_(periodId);
  return allEvents.filter(function(event) {
    if (confirmedOpIds.has(event.OperationId)) return true;
    if (currentOperationIdToInclude && event.OperationId === currentOperationIdToInclude) return true;
    return false;
  });
}

function rosterLifecycleFindAbsencesByPeriod_(periodId) {
  const records = rosterLifecycleGetRecords_('RosterAbsences');
  return records.filter(function(r) {
    if (r.PeriodId === periodId) return true;
    if (r.StartDate && String(r.StartDate).slice(0, 7) <= periodId && r.EndDate && String(r.EndDate).slice(0, 7) >= periodId) return true;
    return false;
  });
}

function rosterLifecycleFindConfirmedAbsencesByPeriod_(periodId, currentOperationIdToInclude) {
  const allAbsences = rosterLifecycleFindAbsencesByPeriod_(periodId);
  const confirmedOpIds = rosterLifecycleGetConfirmedOperationIds_(periodId);
  return allAbsences.filter(function(absence) {
    if (confirmedOpIds.has(absence.OperationId)) return true;
    if (currentOperationIdToInclude && absence.OperationId === currentOperationIdToInclude) return true;
    return false;
  });
}

function rosterLifecycleFindAbsenceById_(absenceId) {
  const records = rosterLifecycleGetRecords_('RosterAbsences');
  return records.find(function(r) { return r.AbsenceId === absenceId; }) || null;
}

function rosterLifecycleFindReplacementsByPeriod_(periodId) {
  const records = rosterLifecycleGetRecords_('RosterReplacements');
  const absences = rosterLifecycleFindAbsencesByPeriod_(periodId);
  const absenceIdSet = new Set(absences.map(function(a) { return a.AbsenceId; }));
  return records.filter(function(r) {
    if (r.Date && String(r.Date).slice(0, 7) === periodId) return true;
    if (r.AbsenceId && absenceIdSet.has(r.AbsenceId)) return true;
    return false;
  });
}

function rosterLifecycleFindConfirmedReplacementsByPeriod_(periodId, currentOperationIdToInclude) {
  const allReplacements = rosterLifecycleFindReplacementsByPeriod_(periodId);
  const confirmedOpIds = rosterLifecycleGetConfirmedOperationIds_(periodId);
  return allReplacements.filter(function(repl) {
    if (confirmedOpIds.has(repl.OperationId)) return true;
    if (currentOperationIdToInclude && repl.OperationId === currentOperationIdToInclude) return true;
    return false;
  });
}

function rosterLifecycleFindReplacementById_(replacementId) {
  const records = rosterLifecycleGetRecords_('RosterReplacements');
  return records.find(function(r) { return r.ReplacementId === replacementId; }) || null;
}

function rosterLifecycleGetConfirmedOperationIdsAll_() {
  const table = rosterV2ReadTable_('OperationLog');
  const confirmed = new Set();
  if (!table.exists) return confirmed;
  const statusIdx = table.headers.indexOf('Status');
  const opIdIdx = table.headers.indexOf('OperationId');
  for (let i = 0; i < table.rows.length; i++) {
    const row = table.rows[i];
    if (row[statusIdx] === 'CONFIRMED') {
      confirmed.add(row[opIdIdx]);
    }
  }
  return confirmed;
}

function rosterLifecycleFindConfirmedEntitlementsByPeriod_(periodId, currentOperationIdToInclude) {
  const records = rosterLifecycleGetRecords_('RosterEntitlementTransactions');
  const confirmedOpIds = rosterLifecycleGetConfirmedOperationIdsAll_();
  return records.filter(function(tx) {
    const inPeriod = (tx.PeriodId === periodId) ||
      (tx.EffectiveDate && String(tx.EffectiveDate).slice(0, 7) === periodId);
    if (!inPeriod) return false;
    if (tx.OperationId) {
      if (confirmedOpIds.has(tx.OperationId)) return true;
      if (currentOperationIdToInclude && tx.OperationId === currentOperationIdToInclude) return true;
      return false;
    }
    return tx.Status === 'CONFIRMED';
  });
}

function rosterLifecycleFindAllConfirmedEntitlementsByPerson_(personId, currentOperationIdToInclude) {
  const records = rosterLifecycleGetRecords_('RosterEntitlementTransactions');
  const confirmedOpIds = rosterLifecycleGetConfirmedOperationIdsAll_();
  return records.filter(function(tx) {
    if (tx.PersonId !== personId) return false;
    if (tx.OperationId) {
      if (confirmedOpIds.has(tx.OperationId)) return true;
      if (currentOperationIdToInclude && tx.OperationId === currentOperationIdToInclude) return true;
      return false;
    }
    return tx.Status === 'CONFIRMED';
  });
}

function rosterLifecycleFindEntitlementById_(transactionId) {
  const records = rosterLifecycleGetRecords_('RosterEntitlementTransactions');
  return records.find(function(r) { return r.TransactionId === transactionId; }) || null;
}

function rosterLifecycleWriteMasterRoster_(mergedRows) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let masterSheet = ss.getSheetByName('MasterRoster');
  if (!masterSheet) {
    masterSheet = ss.insertSheet('MasterRoster');
  }
  masterSheet.getDataRange().clearContent();
  const masterMatrix = [['Name', 'Date', 'Shift']].concat(
    mergedRows.map(function(r) { return [r.Name || '', r.Date || '', r.Shift || '']; })
  );
  masterSheet.getRange(1, 1, masterMatrix.length, 3).setValues(masterMatrix);
  SpreadsheetApp.flush();
}

function rosterLifecyclePersistEventsIdempotently_(canonicalLines) {
  if (!canonicalLines || canonicalLines.length === 0) return;
  const existingRows = rosterLifecycleGetRecords_('RosterEvents');
  const existingByLineId = {};
  existingRows.forEach(function(r) {
    if (r.LineId) existingByLineId[r.LineId] = r;
  });

  const linesToAppend = [];
  const immutableFields = [
    'EventType', 'OperationId', 'PeriodId', 'PersonId', 'Date', 'DutyDomain',
    'BeforeCurrentJson', 'AfterCurrentJson', 'PlannedAssignmentJson', 'PublicReasonCode',
    'ShortageAccepted', 'ShortageReason', 'GoffTransactionIdsJson'
  ];

  canonicalLines.forEach(function(line) {
    const existing = existingByLineId[line.LineId];
    if (existing) {
      for (let i = 0; i < immutableFields.length; i++) {
        const field = immutableFields[i];
        const existVal = existing[field] === undefined ? '' : String(existing[field]);
        const lineVal = line[field] === undefined ? '' : String(line[field]);
        if (existVal !== lineVal) {
          throw DraftProtocol.fail('IDEMPOTENCY_MISMATCH', {
            message: 'Existing event line ' + line.LineId + ' field ' + field + ' differs: existing="' + existVal + '", proposed="' + lineVal + '"'
          });
        }
      }
    } else {
      linesToAppend.push(line);
    }
  });

  if (linesToAppend.length > 0) {
    rosterLifecycleAppendRows_('RosterEvents', linesToAppend);
  }
}

function rosterLifecycleAdaptAssignmentsToCell_(assignments, targetPersonId, targetDate, targetDutyDomain) {
  if (!Array.isArray(assignments)) {
    if (assignments && typeof assignments === 'object') assignments = [assignments];
    else if (typeof assignments === 'string' && assignments.trim()) {
      try {
        const parsed = JSON.parse(assignments);
        assignments = Array.isArray(parsed) ? parsed : [parsed];
      } catch (_) {
        assignments = [{ shiftCode: assignments }];
      }
    } else return [];
  }
  return assignments.map(function(a) {
    if (typeof a === 'string') {
      return {
        PersonId: targetPersonId,
        Date: targetDate,
        DutyDomain: targetDutyDomain,
        ShiftCode: a,
        rawShift: a
      };
    }
    const raw = a._rawShift || a.rawShift || a.ShiftCode || a.shiftCode || '';
    const shiftCode = a.ShiftCode || a.shiftCode || raw;
    return {
      PersonId: targetPersonId,
      Date: targetDate,
      DutyDomain: targetDutyDomain,
      ShiftCode: shiftCode,
      rawShift: raw || shiftCode
    };
  });
}

function rosterLifecyclePublish_(data, actor) {
  const periodId = RosterCompatibility.validatePeriod(String(data.periodId || (data.payload && data.payload.periodId) || ''));
  const operationId = String(data.operationId || '').trim();
  if (!DraftProtocol.uuid(operationId)) {
    throw DraftProtocol.fail('VALIDATION_FAILED', { message: 'Valid operationId UUID is required' });
  }

  const clientId = String(data.clientId || operationId);
  const tabId = String(data.tabId || operationId);
  const entityKey = 'period:' + periodId;
  const expectedRevision = Number(data.expectedRevision !== undefined ? data.expectedRevision : (data.payload && data.payload.expectedRevision !== undefined ? data.payload.expectedRevision : 0));
  const draftCells = (data.payload && data.payload.draftCells) ? data.payload.draftCells : (data.draftCells || {});
  const timestamp = data.timestamp || new Date().toISOString();

  const meaning = {
    operationId: operationId,
    clientId: clientId,
    tabId: tabId,
    operationType: 'PERIOD_PUBLISH',
    entityKey: entityKey,
    expectedRevision: expectedRevision,
    payload: {
      periodId: periodId,
      draftCells: draftCells,
      adminNote: data.adminNote || (data.payload && data.payload.adminNote) || ''
    }
  };
  const payloadHash = rosterV2Digest_(DraftProtocol.canonical(meaning));
  if (data.payloadHash && data.payloadHash !== payloadHash) {
    throw DraftProtocol.fail('IDEMPOTENCY_MISMATCH');
  }

  rosterLifecycleEnsureAllSchemas_();

  let existingLog = rosterLifecycleFindOperationLog_(operationId);
  if (existingLog) {
    if (existingLog.PayloadHash && existingLog.PayloadHash !== payloadHash) {
      throw DraftProtocol.fail('IDEMPOTENCY_MISMATCH');
    }
    if (existingLog.Status === 'CONFIRMED') {
      return JSON.parse(existingLog.ResultJson);
    }
    if (existingLog.Status === 'FAILED') {
      throw DraftProtocol.fail(existingLog.ErrorCode || 'PERMANENT_FAILURE');
    }
  }

  const periodRecord = rosterLifecycleFindPeriod_(periodId);
  if (!periodRecord) {
    throw DraftProtocol.fail('ENTITY_NOT_FOUND', { message: 'Period ' + periodId + ' is not enrolled' });
  }

  const currentState = String(periodRecord.State || 'DRAFT').toUpperCase();
  if (currentState === 'PUBLISHED') {
    if (periodRecord.LastOperationId !== operationId) {
      throw DraftProtocol.fail('SNAPSHOT_IMMUTABLE', { message: 'Period ' + periodId + ' is already PUBLISHED and cannot be re-published' });
    }
    let result = null;
    if (existingLog && existingLog.ResultJson) {
      try { result = JSON.parse(existingLog.ResultJson); } catch (_) {}
    }
    if (!result) {
      const snapAssignments = rosterLifecycleFindAssignmentsBySnapshot_(periodRecord.PlannedSnapshotId);
      result = {
        ok: true,
        operationId: operationId,
        periodId: periodId,
        state: 'PUBLISHED',
        revision: Number(periodRecord.Revision),
        plannedSnapshotId: periodRecord.PlannedSnapshotId,
        assignmentCount: snapAssignments.length,
        projectionChecksum: periodRecord.ProjectionChecksum,
        publishedAt: periodRecord.PublishedAt,
        publishedBy: periodRecord.PublishedBy
      };
    }
    if (existingLog) {
      existingLog.Status = 'CONFIRMED';
      existingLog.ResultRevision = Number(periodRecord.Revision);
      existingLog.ResultJson = JSON.stringify(result);
      existingLog.CompletedAt = periodRecord.PublishedAt || timestamp;
      existingLog.ErrorCode = '';
      rosterLifecycleWriteLog_(existingLog);
    }
    return result;
  } else if (currentState !== 'DRAFT') {
    throw DraftProtocol.fail('INVALID_STATE', { message: 'Period ' + periodId + ' in state ' + currentState + ' cannot be published' });
  }

  const currentRevision = Number(periodRecord.Revision || 0);
  if (expectedRevision !== currentRevision) {
    throw DraftProtocol.fail('REVISION_CONFLICT', {
      entityKey: entityKey,
      currentRevision: currentRevision,
      expectedRevision: expectedRevision
    });
  }

  // Check conflicting in-flight operations
  const allLogs = rosterDraftReadTable_('OperationLog');
  if (allLogs.exists) {
    const eKeyIdx = allLogs.headers.indexOf('EntityKey');
    const statusIdx = allLogs.headers.indexOf('Status');
    const opIdIdx = allLogs.headers.indexOf('OperationId');
    for (let i = 0; i < allLogs.rows.length; i++) {
      const row = allLogs.rows[i];
      if (row[eKeyIdx] === entityKey && row[opIdIdx] !== operationId && ['PENDING', 'RECOVERY_REQUIRED'].includes(row[statusIdx])) {
        throw DraftProtocol.fail('RECOVERY_REQUIRED', { message: 'Conflicting in-flight operation exists on ' + entityKey });
      }
    }
  }

  // Journal PENDING
  if (!existingLog) {
    existingLog = {
      OperationId: operationId,
      ClientId: clientId,
      TabId: tabId,
      OperationType: 'PERIOD_PUBLISH',
      EntityKey: entityKey,
      ExpectedRevision: expectedRevision,
      ResultRevision: expectedRevision + 1,
      PayloadHash: payloadHash,
      Status: 'PENDING',
      ResultJson: '',
      ErrorCode: '',
      CreatedAt: timestamp,
      CompletedAt: ''
    };
    rosterLifecycleWriteLog_(existingLog);
    existingLog = rosterLifecycleFindOperationLog_(operationId);
  }

  // Generate Deterministic Planned Snapshot
  const peopleRecords = rosterV2Records_(rosterV2ReadTable_('RosterPeople'), ['PersonId', 'DirectoryType', 'CurrentDisplayName', 'LegacyNamesJson', 'Active']);
  let snapshotResult;
  try {
    snapshotResult = RosterLifecycle.generatePlannedSnapshot({
      periodId: periodId,
      draftCells: draftCells,
      people: peopleRecords,
      operationId: operationId,
      actor: actor,
      timestamp: timestamp,
      digestFn: rosterV2Digest_
    });
  } catch (err) {
    existingLog.Status = 'FAILED';
    existingLog.ResultRevision = '';
    existingLog.ErrorCode = err.code || 'VALIDATION_FAILED';
    existingLog.CompletedAt = timestamp;
    rosterLifecycleWriteLog_(existingLog);
    throw DraftProtocol.fail(existingLog.ErrorCode, { message: err.message });
  }

  // Persist Planned Assignments Idempotently
  const existingAssignments = rosterLifecycleFindAssignmentsBySnapshot_(snapshotResult.plannedSnapshotId);
  const existingIds = new Set(existingAssignments.map(function(a) { return a.AssignmentId; }));
  const assignmentsToAppend = snapshotResult.assignments.filter(function(a) {
    return !existingIds.has(a.AssignmentId);
  });
  if (assignmentsToAppend.length > 0) {
    rosterLifecycleAppendRows_('RosterAssignments', assignmentsToAppend);
  }

  // Persist WeeklyOffSnapshots Idempotently
  const policiesTable = rosterV2ReadTable_('OffPolicies');
  const policies = policiesTable.exists ? rosterV2Records_(policiesTable, RosterGuidance.OFF_POLICY_HEADERS) : [];
  const existingWeeks = rosterLifecycleGetRecords_('WeeklyOffSnapshots');
  const adjacentPlanned = rosterLifecycleGetRecords_('RosterAssignments').filter(function(a) {
    return a.PeriodId !== periodId && a.Layer === 'PLANNED';
  });

  const weekSnapshots = RosterLifecycle.aggregateWeeklyOffSnapshots({
    periodId: periodId,
    plannedAssignments: snapshotResult.assignments,
    people: peopleRecords,
    existingWeekSnapshots: existingWeeks,
    adjacentPlannedAssignments: adjacentPlanned,
    policies: policies,
    operationId: operationId,
    timestamp: timestamp,
    digestFn: rosterV2Digest_
  });

  const currentWeekRecords = rosterLifecycleGetRecords_('WeeklyOffSnapshots');
  weekSnapshots.forEach(function(ws) {
    const existing = currentWeekRecords.find(function(r) {
      return (r.WeekSnapshotId === ws.WeekSnapshotId) || (r.WeekStart === ws.WeekStart && r.PersonId === ws.PersonId);
    });
    if (existing) {
      if (Number(ws.Revision) >= Number(existing.Revision)) {
        rosterLifecycleWriteRow_('WeeklyOffSnapshots', ws, existing._row);
      }
    } else {
      rosterLifecycleWriteRow_('WeeklyOffSnapshots', ws);
    }
  });

  // Prepare and Write Month-Scoped MasterRoster Projection
  const projectedRows = RosterLifecycle.generateMasterRosterProjection(snapshotResult.assignments);
  const masterTable = rosterV2ReadTable_('MasterRoster');
  const existingMasterRows = masterTable.exists ? rosterV2Records_(masterTable, ['Name', 'Date', 'Shift'], true) : [];
  const mergeResult = RosterLifecycle.mergeMasterRosterProjection(existingMasterRows, periodId, projectedRows);

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let masterSheet = ss.getSheetByName('MasterRoster');
  if (!masterSheet) {
    masterSheet = ss.insertSheet('MasterRoster');
  }
  masterSheet.getDataRange().clearContent();
  const masterMatrix = [['Name', 'Date', 'Shift']].concat(
    mergeResult.mergedRows.map(function(r) { return [r.Name || '', r.Date || '', r.Shift || '']; })
  );
  masterSheet.getRange(1, 1, masterMatrix.length, 3).setValues(masterMatrix);
  SpreadsheetApp.flush();

  // Read Back Persisted Projection and Verify Checksum
  const readbackTable = rosterV2ReadTable_('MasterRoster');
  const readbackRows = rosterV2Records_(readbackTable, ['Name', 'Date', 'Shift'], true);
  const targetMonthPersistedRows = readbackRows.filter(function(r) {
    const d = RosterCompatibility.localDate(r.Date);
    return d && d.slice(0, 7) === periodId;
  });

  const actualChecksum = RosterLifecycle.computeProjectionChecksum(targetMonthPersistedRows, rosterV2Digest_);
  const expectedChecksum = RosterLifecycle.computeProjectionChecksum(projectedRows, rosterV2Digest_);

  if (actualChecksum !== expectedChecksum) {
    existingLog.Status = 'RECOVERY_REQUIRED';
    existingLog.ErrorCode = 'CHECKSUM_MISMATCH';
    rosterLifecycleWriteLog_(existingLog);
    throw DraftProtocol.fail('CHECKSUM_MISMATCH', {
      actual: actualChecksum,
      expected: expectedChecksum
    });
  }

  // Persist PUBLISH Event Idempotently
  const existingEvents = rosterLifecycleFindEventsByOperation_(operationId);
  if (existingEvents.length === 0) {
    const publishEvent = RosterLifecycle.createLifecycleEvent({
      periodId: periodId,
      eventType: 'PUBLISH',
      operationId: operationId,
      actor: actor,
      baseRevision: expectedRevision,
      resultRevision: expectedRevision + 1,
      reason: data.adminNote || 'Period published',
      timestamp: timestamp
    });
    rosterLifecycleAppendRows_('RosterEvents', [publishEvent]);
  }

  // Update RosterPeriods to PUBLISHED
  const updatedPeriod = Object.assign({}, periodRecord, {
    State: 'PUBLISHED',
    Revision: expectedRevision + 1,
    DraftRevision: expectedRevision + 1,
    PlannedSnapshotId: snapshotResult.plannedSnapshotId,
    PublishedAt: timestamp,
    PublishedBy: actor,
    ProjectionChecksum: actualChecksum,
    SchemaVersion: 2,
    LastOperationId: operationId,
    UpdatedAt: timestamp,
    EnrolledAt: periodRecord.EnrolledAt || timestamp,
    EnrolledBy: periodRecord.EnrolledBy || actor
  });
  rosterLifecycleWriteRow_('RosterPeriods', updatedPeriod, periodRecord._row);

  // Confirm Operation
  const confirmedResult = {
    ok: true,
    operationId: operationId,
    periodId: periodId,
    state: 'PUBLISHED',
    revision: expectedRevision + 1,
    plannedSnapshotId: snapshotResult.plannedSnapshotId,
    assignmentCount: snapshotResult.assignments.length,
    projectionChecksum: actualChecksum,
    publishedAt: timestamp,
    publishedBy: actor
  };

  existingLog.Status = 'CONFIRMED';
  existingLog.ResultRevision = expectedRevision + 1;
  existingLog.ResultJson = JSON.stringify(confirmedResult);
  existingLog.CompletedAt = new Date().toISOString();
  existingLog.ErrorCode = '';
  rosterLifecycleWriteLog_(existingLog);

  return confirmedResult;
}

function rosterLifecycleAmend_(data, actor) {
  const periodId = RosterCompatibility.validatePeriod(String(data.periodId || (data.payload && data.payload.periodId) || ''));
  const operationId = String(data.operationId || '').trim();
  if (!DraftProtocol.uuid(operationId)) {
    throw DraftProtocol.fail('VALIDATION_FAILED', { message: 'Valid operationId UUID is required' });
  }

  const clientId = String(data.clientId || operationId);
  const tabId = String(data.tabId || operationId);
  const entityKey = 'period:' + periodId;
  const expectedRevision = Number(data.expectedRevision !== undefined ? data.expectedRevision : (data.payload && data.payload.expectedRevision !== undefined ? data.payload.expectedRevision : 0));
  const timestamp = data.timestamp || new Date().toISOString();

  const payload = data.payload || data;
  const eventType = String(payload.eventType || (payload.person1 ? 'SWAP' : 'ADMIN_CORRECTION')).toUpperCase();
  const publicReasonCode = payload.publicReasonCode || (eventType === 'SWAP' ? 'SHIFT_SWAP' : 'ADMIN_CORRECTION');
  const adminNote = String(payload.adminNote || '').trim();

  let semanticPayload;
  if (eventType === 'SWAP') {
    const p1 = payload.person1;
    const p2 = payload.person2;
    if (!p1 || !p2 || !p1.personId || !p2.personId || !p1.date || !p2.date || !p1.dutyDomain || !p2.dutyDomain) {
      throw DraftProtocol.fail('VALIDATION_FAILED', { message: 'SWAP requires person1 and person2 with personId, date, and dutyDomain' });
    }
    semanticPayload = {
      periodId: periodId,
      eventType: 'SWAP',
      person1: {
        personId: String(p1.personId).trim(),
        date: String(p1.date).trim(),
        dutyDomain: String(p1.dutyDomain).trim()
      },
      person2: {
        personId: String(p2.personId).trim(),
        date: String(p2.date).trim(),
        dutyDomain: String(p2.dutyDomain).trim()
      },
      publicReasonCode: publicReasonCode,
      adminNote: adminNote
    };
  } else {
    const personId = String(payload.personId || '').trim();
    const date = String(payload.date || '').trim();
    const dutyDomain = String(payload.dutyDomain || '').trim();
    if (!personId || !date || !dutyDomain) {
      throw DraftProtocol.fail('VALIDATION_FAILED', { message: 'Amendment requires personId, date, and dutyDomain' });
    }
    const afterAssignments = payload.afterAssignments !== undefined ? payload.afterAssignments : (payload.shiftCode !== undefined ? [{ shiftCode: payload.shiftCode }] : []);
    semanticPayload = {
      periodId: periodId,
      eventType: eventType,
      personId: personId,
      date: date,
      dutyDomain: dutyDomain,
      afterAssignments: afterAssignments,
      publicReasonCode: publicReasonCode,
      adminNote: adminNote
    };
  }

  const meaning = {
    operationId: operationId,
    clientId: clientId,
    tabId: tabId,
    operationType: 'PERIOD_AMEND',
    entityKey: entityKey,
    expectedRevision: expectedRevision,
    payload: semanticPayload
  };
  const payloadHash = rosterV2Digest_(DraftProtocol.canonical(meaning));
  if (data.payloadHash && data.payloadHash !== payloadHash) {
    throw DraftProtocol.fail('IDEMPOTENCY_MISMATCH');
  }

  rosterLifecycleEnsureAllSchemas_();

  let existingLog = rosterLifecycleFindOperationLog_(operationId);
  if (existingLog) {
    if (existingLog.PayloadHash && existingLog.PayloadHash !== payloadHash) {
      throw DraftProtocol.fail('IDEMPOTENCY_MISMATCH');
    }
    if (existingLog.Status === 'CONFIRMED') {
      return JSON.parse(existingLog.ResultJson);
    }
    if (existingLog.Status === 'FAILED') {
      throw DraftProtocol.fail(existingLog.ErrorCode || 'PERMANENT_FAILURE');
    }
  }

  const periodRecord = rosterLifecycleFindPeriod_(periodId);
  if (!periodRecord) {
    throw DraftProtocol.fail('ENTITY_NOT_FOUND', { message: 'Period ' + periodId + ' not found' });
  }

  const currentState = String(periodRecord.State || '').toUpperCase();
  if (currentState !== 'PUBLISHED' && currentState !== 'AMENDED') {
    throw DraftProtocol.fail('INVALID_STATE', { message: 'Period ' + periodId + ' in state ' + currentState + ' cannot be amended' });
  }

  const currentRevision = Number(periodRecord.Revision || 0);

  // Critical recovery window check: if period was already updated with this operationId
  if (periodRecord.LastOperationId === operationId) {
    let result = null;
    if (existingLog && existingLog.ResultJson) {
      try { result = JSON.parse(existingLog.ResultJson); } catch (_) {}
    }
    if (!result) {
      const evRows = rosterLifecycleFindEventsByOperation_(operationId);
      const firstEv = evRows[0] || {};
      result = {
        ok: true,
        operationId: operationId,
        periodId: periodId,
        state: 'AMENDED',
        revision: currentRevision,
        eventId: firstEv.EventId || '',
        lineCount: evRows.length,
        projectionChecksum: periodRecord.ProjectionChecksum,
        amendedAt: periodRecord.UpdatedAt || timestamp,
        amendedBy: firstEv.CreatedBy || actor
      };
    }
    if (existingLog) {
      existingLog.Status = 'CONFIRMED';
      existingLog.ResultRevision = currentRevision;
      existingLog.ResultJson = JSON.stringify(result);
      existingLog.CompletedAt = periodRecord.UpdatedAt || timestamp;
      existingLog.ErrorCode = '';
      rosterLifecycleWriteLog_(existingLog);
    }
    return result;
  }

  if (expectedRevision !== currentRevision) {
    throw DraftProtocol.fail('REVISION_CONFLICT', {
      entityKey: entityKey,
      currentRevision: currentRevision,
      expectedRevision: expectedRevision
    });
  }

  // Journal PENDING
  if (!existingLog) {
    existingLog = {
      OperationId: operationId,
      ClientId: clientId,
      TabId: tabId,
      OperationType: 'PERIOD_AMEND',
      EntityKey: entityKey,
      ExpectedRevision: expectedRevision,
      ResultRevision: expectedRevision + 1,
      PayloadHash: payloadHash,
      Status: 'PENDING',
      ResultJson: '',
      ErrorCode: '',
      CreatedAt: timestamp,
      CompletedAt: ''
    };
    rosterLifecycleWriteLog_(existingLog);
    existingLog = rosterLifecycleFindOperationLog_(operationId);
  }

  // Load immutable Planned rows
  const allAssignments = rosterLifecycleFindAssignmentsByPeriod_(periodId);
  const plannedAssignments = allAssignments.filter(function(r) { return r.Layer === 'PLANNED'; });
  DraftProtocol.ensure(plannedAssignments.length > 0, 'ENTITY_NOT_FOUND', { message: 'No Planned assignments found for period ' + periodId });

  // Load confirmed amendment/reversal events (excluding unconfirmed operations)
  const confirmedRows = rosterLifecycleFindConfirmedEventsByPeriod_(periodId, operationId);
  const priorConfirmedRows = confirmedRows.filter(function(r) { return r.OperationId !== operationId; });
  const priorConfirmedEvents = RosterLifecycle.groupEventLines(priorConfirmedRows);

  // Resolve authoritative current roster before this amendment
  const authoritativeCurrent = RosterLifecycle.resolveCurrentRoster({
    periodId: periodId,
    plannedAssignments: plannedAssignments,
    events: priorConfirmedEvents,
    people: rosterLifecycleGetPeople_(),
    digestFn: rosterV2Digest_
  });

  // Construct canonical event lines server-side
  let canonicalEvent;
  if (eventType === 'SWAP') {
    const p1 = semanticPayload.person1;
    const p2 = semanticPayload.person2;
    const cellKey1 = RosterLifecycle.makeCellKey(p1.personId, p1.date, p1.dutyDomain);
    const cellKey2 = RosterLifecycle.makeCellKey(p2.personId, p2.date, p2.dutyDomain);

    const cell1 = authoritativeCurrent.currentCells ? authoritativeCurrent.currentCells.get(cellKey1) : null;
    const cell2 = authoritativeCurrent.currentCells ? authoritativeCurrent.currentCells.get(cellKey2) : null;
    const cell1Assignments = cell1 || [];
    const cell2Assignments = cell2 || [];

    const planned1 = plannedAssignments.filter(function(a) {
      return a.PersonId === p1.personId && a.Date === p1.date && a.DutyDomain === p1.dutyDomain;
    });
    const planned2 = plannedAssignments.filter(function(a) {
      return a.PersonId === p2.personId && a.Date === p2.date && a.DutyDomain === p2.dutyDomain;
    });

    const after1 = rosterLifecycleAdaptAssignmentsToCell_(cell2Assignments, p1.personId, p1.date, p1.dutyDomain);
    const after2 = rosterLifecycleAdaptAssignmentsToCell_(cell1Assignments, p2.personId, p2.date, p2.dutyDomain);

    canonicalEvent = RosterLifecycle.createSwapEvent({
      periodId: periodId,
      baseRevision: currentRevision,
      resultRevision: currentRevision + 1,
      operationId: operationId,
      actor: actor,
      publicReasonCode: semanticPayload.publicReasonCode,
      adminNote: semanticPayload.adminNote,
      person1: {
        personId: p1.personId,
        date: p1.date,
        dutyDomain: p1.dutyDomain,
        beforeAssignments: cell1Assignments,
        afterAssignments: after1,
        plannedAssignments: planned1
      },
      person2: {
        personId: p2.personId,
        date: p2.date,
        dutyDomain: p2.dutyDomain,
        beforeAssignments: cell2Assignments,
        afterAssignments: after2,
        plannedAssignments: planned2
      },
      timestamp: timestamp
    });
  } else {
    const pId = semanticPayload.personId;
    const d = semanticPayload.date;
    const dom = semanticPayload.dutyDomain;
    const cellKey = RosterLifecycle.makeCellKey(pId, d, dom);

    const cell = authoritativeCurrent.currentCells ? authoritativeCurrent.currentCells.get(cellKey) : null;
    const beforeAssignments = cell || [];

    const planned = plannedAssignments.filter(function(a) {
      return a.PersonId === pId && a.Date === d && a.DutyDomain === dom;
    });

    const normalizedAfter = rosterLifecycleAdaptAssignmentsToCell_(semanticPayload.afterAssignments, pId, d, dom);

    canonicalEvent = RosterLifecycle.createAmendmentEvent({
      periodId: periodId,
      baseRevision: currentRevision,
      resultRevision: currentRevision + 1,
      operationId: operationId,
      actor: actor,
      eventType: eventType,
      publicReasonCode: semanticPayload.publicReasonCode,
      adminNote: semanticPayload.adminNote,
      personId: pId,
      date: d,
      dutyDomain: dom,
      beforeAssignments: beforeAssignments,
      afterAssignments: normalizedAfter,
      plannedAssignments: planned,
      timestamp: timestamp
    });
  }

  // Validate event contract
  RosterLifecycle.groupEventLines(canonicalEvent.lines);

  // Persist event rows idempotently
  rosterLifecyclePersistEventsIdempotently_(canonicalEvent.lines);

  // Compute intended Current
  const intendedEvents = priorConfirmedEvents.concat([canonicalEvent]);
  const intendedCurrent = RosterLifecycle.resolveCurrentRoster({
    periodId: periodId,
    plannedAssignments: plannedAssignments,
    events: intendedEvents,
    people: rosterLifecycleGetPeople_(),
    digestFn: rosterV2Digest_
  });

  // Project to MasterRoster and write
  const projectedRows = intendedCurrent.masterRosterProjection || RosterLifecycle.generateMasterRosterProjection(intendedCurrent.currentAssignments || intendedCurrent.assignments || []);
  const masterTable = rosterV2ReadTable_('MasterRoster');
  const existingMasterRows = masterTable.exists ? rosterV2Records_(masterTable, ['Name', 'Date', 'Shift'], true) : [];
  const mergeResult = RosterLifecycle.mergeMasterRosterProjection(existingMasterRows, periodId, projectedRows);
  rosterLifecycleWriteMasterRoster_(mergeResult.mergedRows);

  // Read back and verify projection checksum
  const readbackTable = rosterV2ReadTable_('MasterRoster');
  const readbackRows = rosterV2Records_(readbackTable, ['Name', 'Date', 'Shift'], true);
  const targetMonthPersistedRows = readbackRows.filter(function(r) {
    const ld = RosterCompatibility.localDate(r.Date);
    return ld && ld.slice(0, 7) === periodId;
  });

  const actualChecksum = RosterLifecycle.computeProjectionChecksum(targetMonthPersistedRows, rosterV2Digest_);
  const expectedChecksum = RosterLifecycle.computeProjectionChecksum(projectedRows, rosterV2Digest_);

  if (actualChecksum !== expectedChecksum) {
    existingLog.Status = 'RECOVERY_REQUIRED';
    existingLog.ErrorCode = 'CHECKSUM_MISMATCH';
    rosterLifecycleWriteLog_(existingLog);
    throw DraftProtocol.fail('CHECKSUM_MISMATCH', {
      actual: actualChecksum,
      expected: expectedChecksum
    });
  }

  // Update RosterPeriods
  const updatedPeriod = Object.assign({}, periodRecord, {
    State: 'AMENDED',
    Revision: currentRevision + 1,
    ProjectionChecksum: actualChecksum,
    LastOperationId: operationId,
    UpdatedAt: timestamp
  });
  rosterLifecycleWriteRow_('RosterPeriods', updatedPeriod, periodRecord._row);

  // Confirm OperationLog
  const confirmedResult = {
    ok: true,
    operationId: operationId,
    periodId: periodId,
    state: 'AMENDED',
    revision: currentRevision + 1,
    eventId: canonicalEvent.EventId,
    lineCount: canonicalEvent.lines.length,
    projectionChecksum: actualChecksum,
    amendedAt: timestamp,
    amendedBy: actor
  };
  existingLog.Status = 'CONFIRMED';
  existingLog.ResultRevision = currentRevision + 1;
  existingLog.ResultJson = JSON.stringify(confirmedResult);
  existingLog.CompletedAt = new Date().toISOString();
  existingLog.ErrorCode = '';
  rosterLifecycleWriteLog_(existingLog);

  return confirmedResult;
}

function rosterLifecycleAmendReversal_(data, actor) {
  const periodId = RosterCompatibility.validatePeriod(String(data.periodId || (data.payload && data.payload.periodId) || ''));
  const operationId = String(data.operationId || '').trim();
  if (!DraftProtocol.uuid(operationId)) {
    throw DraftProtocol.fail('VALIDATION_FAILED', { message: 'Valid operationId UUID is required' });
  }

  const clientId = String(data.clientId || operationId);
  const tabId = String(data.tabId || operationId);
  const entityKey = 'period:' + periodId;
  const expectedRevision = Number(data.expectedRevision !== undefined ? data.expectedRevision : (data.payload && data.payload.expectedRevision !== undefined ? data.payload.expectedRevision : 0));
  const targetEventId = String(data.targetEventId || (data.payload && data.payload.targetEventId) || '').trim();
  const adminNote = String(data.adminNote || (data.payload && data.payload.adminNote) || '').trim();
  const timestamp = data.timestamp || new Date().toISOString();

  if (!targetEventId) {
    throw DraftProtocol.fail('VALIDATION_FAILED', { message: 'targetEventId is required for reversal' });
  }

  const meaning = {
    operationId: operationId,
    clientId: clientId,
    tabId: tabId,
    operationType: 'PERIOD_AMEND_REVERSAL',
    entityKey: entityKey,
    expectedRevision: expectedRevision,
    payload: {
      periodId: periodId,
      targetEventId: targetEventId,
      adminNote: adminNote
    }
  };
  const payloadHash = rosterV2Digest_(DraftProtocol.canonical(meaning));
  if (data.payloadHash && data.payloadHash !== payloadHash) {
    throw DraftProtocol.fail('IDEMPOTENCY_MISMATCH');
  }

  rosterLifecycleEnsureAllSchemas_();

  let existingLog = rosterLifecycleFindOperationLog_(operationId);
  if (existingLog) {
    if (existingLog.PayloadHash && existingLog.PayloadHash !== payloadHash) {
      throw DraftProtocol.fail('IDEMPOTENCY_MISMATCH');
    }
    if (existingLog.Status === 'CONFIRMED') {
      return JSON.parse(existingLog.ResultJson);
    }
    if (existingLog.Status === 'FAILED') {
      throw DraftProtocol.fail(existingLog.ErrorCode || 'PERMANENT_FAILURE');
    }
  }

  const periodRecord = rosterLifecycleFindPeriod_(periodId);
  if (!periodRecord) {
    throw DraftProtocol.fail('ENTITY_NOT_FOUND', { message: 'Period ' + periodId + ' not found' });
  }

  const currentState = String(periodRecord.State || '').toUpperCase();
  if (currentState !== 'AMENDED') {
    if (!(currentState === 'PUBLISHED' && periodRecord.LastOperationId === operationId)) {
      throw DraftProtocol.fail('INVALID_STATE', { message: 'Period ' + periodId + ' in state ' + currentState + ' cannot have amendments reversed; must be AMENDED' });
    }
  }

  const currentRevision = Number(periodRecord.Revision || 0);

  // Critical recovery window check: if period was already updated with this operationId
  if (periodRecord.LastOperationId === operationId) {
    let result = null;
    if (existingLog && existingLog.ResultJson) {
      try { result = JSON.parse(existingLog.ResultJson); } catch (_) {}
    }
    if (!result) {
      const evRows = rosterLifecycleFindEventsByOperation_(operationId);
      const firstEv = evRows[0] || {};
      const allEvents = rosterLifecycleFindConfirmedEventsByPeriod_(periodId, operationId);
      const activeCount = RosterLifecycle.countActiveAmendments(RosterLifecycle.groupEventLines(allEvents));
      result = {
        ok: true,
        operationId: operationId,
        periodId: periodId,
        state: periodRecord.State,
        revision: currentRevision,
        reversalEventId: firstEv.EventId || '',
        targetEventId: targetEventId,
        activeAmendmentCount: activeCount,
        projectionChecksum: periodRecord.ProjectionChecksum,
        reversedAt: periodRecord.UpdatedAt || timestamp,
        reversedBy: firstEv.CreatedBy || actor
      };
    }
    if (existingLog) {
      existingLog.Status = 'CONFIRMED';
      existingLog.ResultRevision = currentRevision;
      existingLog.ResultJson = JSON.stringify(result);
      existingLog.CompletedAt = periodRecord.UpdatedAt || timestamp;
      existingLog.ErrorCode = '';
      rosterLifecycleWriteLog_(existingLog);
    }
    return result;
  }

  if (expectedRevision !== currentRevision) {
    throw DraftProtocol.fail('REVISION_CONFLICT', {
      entityKey: entityKey,
      currentRevision: currentRevision,
      expectedRevision: expectedRevision
    });
  }

  // Journal PENDING
  if (!existingLog) {
    existingLog = {
      OperationId: operationId,
      ClientId: clientId,
      TabId: tabId,
      OperationType: 'PERIOD_AMEND_REVERSAL',
      EntityKey: entityKey,
      ExpectedRevision: expectedRevision,
      ResultRevision: expectedRevision + 1,
      PayloadHash: payloadHash,
      Status: 'PENDING',
      ResultJson: '',
      ErrorCode: '',
      CreatedAt: timestamp,
      CompletedAt: ''
    };
    rosterLifecycleWriteLog_(existingLog);
    existingLog = rosterLifecycleFindOperationLog_(operationId);
  }

  // Load confirmed amendment/reversal events
  const confirmedRows = rosterLifecycleFindConfirmedEventsByPeriod_(periodId, operationId);
  const priorConfirmedRows = confirmedRows.filter(function(r) { return r.OperationId !== operationId; });
  const priorConfirmedEvents = RosterLifecycle.groupEventLines(priorConfirmedRows);

  // Locate canonical target event
  const targetEvent = priorConfirmedEvents.find(function(e) { return e.EventId === targetEventId; });
  if (!targetEvent) {
    throw DraftProtocol.fail('EVENT_NOT_FOUND', { message: 'Target event ' + targetEventId + ' not found in confirmed events' });
  }

  // Validate reversal eligibility using pure canReverseEvent
  const revCheck = RosterLifecycle.canReverseEvent(targetEventId, priorConfirmedEvents);
  if (!revCheck.canReverse) {
    throw DraftProtocol.fail(revCheck.code || 'REVERSAL_DEPENDENCY_CONFLICT', { message: revCheck.reason });
  }

  // Construct reversal compensating event
  const reversalEvent = RosterLifecycle.createReversalEvent({
    targetEvent: targetEvent,
    baseRevision: currentRevision,
    resultRevision: currentRevision + 1,
    operationId: operationId,
    actor: actor,
    publicReasonCode: targetEvent.PublicReasonCode,
    adminNote: adminNote,
    timestamp: timestamp
  });

  // Persist reversal event rows idempotently
  rosterLifecyclePersistEventsIdempotently_(reversalEvent.lines);

  // Load immutable Planned rows
  const allAssignments = rosterLifecycleFindAssignmentsByPeriod_(periodId);
  const plannedAssignments = allAssignments.filter(function(r) { return r.Layer === 'PLANNED'; });
  DraftProtocol.ensure(plannedAssignments.length > 0, 'ENTITY_NOT_FOUND', { message: 'No Planned assignments found for period ' + periodId });

  // Compute intended Current
  const intendedEvents = priorConfirmedEvents.concat([reversalEvent]);
  const intendedCurrent = RosterLifecycle.resolveCurrentRoster({
    periodId: periodId,
    plannedAssignments: plannedAssignments,
    events: intendedEvents,
    people: rosterLifecycleGetPeople_(),
    digestFn: rosterV2Digest_
  });

  // Determine next lifecycle state based on active amendments
  const activeCount = RosterLifecycle.countActiveAmendments(intendedEvents);
  const nextState = activeCount > 0 ? 'AMENDED' : 'PUBLISHED';

  // Project to MasterRoster and write
  const projectedRows = intendedCurrent.masterRosterProjection || RosterLifecycle.generateMasterRosterProjection(intendedCurrent.currentAssignments || intendedCurrent.assignments || []);
  const masterTable = rosterV2ReadTable_('MasterRoster');
  const existingMasterRows = masterTable.exists ? rosterV2Records_(masterTable, ['Name', 'Date', 'Shift'], true) : [];
  const mergeResult = RosterLifecycle.mergeMasterRosterProjection(existingMasterRows, periodId, projectedRows);
  rosterLifecycleWriteMasterRoster_(mergeResult.mergedRows);

  // Read back and verify projection checksum
  const readbackTable = rosterV2ReadTable_('MasterRoster');
  const readbackRows = rosterV2Records_(readbackTable, ['Name', 'Date', 'Shift'], true);
  const targetMonthPersistedRows = readbackRows.filter(function(r) {
    const ld = RosterCompatibility.localDate(r.Date);
    return ld && ld.slice(0, 7) === periodId;
  });

  const actualChecksum = RosterLifecycle.computeProjectionChecksum(targetMonthPersistedRows, rosterV2Digest_);
  const expectedChecksum = RosterLifecycle.computeProjectionChecksum(projectedRows, rosterV2Digest_);

  if (actualChecksum !== expectedChecksum) {
    existingLog.Status = 'RECOVERY_REQUIRED';
    existingLog.ErrorCode = 'CHECKSUM_MISMATCH';
    rosterLifecycleWriteLog_(existingLog);
    throw DraftProtocol.fail('CHECKSUM_MISMATCH', {
      actual: actualChecksum,
      expected: expectedChecksum
    });
  }

  // Update RosterPeriods
  const updatedPeriod = Object.assign({}, periodRecord, {
    State: nextState,
    Revision: currentRevision + 1,
    ProjectionChecksum: actualChecksum,
    LastOperationId: operationId,
    UpdatedAt: timestamp
  });
  rosterLifecycleWriteRow_('RosterPeriods', updatedPeriod, periodRecord._row);

  // Confirm OperationLog
  const confirmedResult = {
    ok: true,
    operationId: operationId,
    periodId: periodId,
    state: nextState,
    revision: currentRevision + 1,
    reversalEventId: reversalEvent.EventId,
    targetEventId: targetEventId,
    activeAmendmentCount: activeCount,
    projectionChecksum: actualChecksum,
    reversedAt: timestamp,
    reversedBy: actor
  };
  existingLog.Status = 'CONFIRMED';
  existingLog.ResultRevision = currentRevision + 1;
  existingLog.ResultJson = JSON.stringify(confirmedResult);
  existingLog.CompletedAt = new Date().toISOString();
  existingLog.ErrorCode = '';
  rosterLifecycleWriteLog_(existingLog);

  return confirmedResult;
}

function rosterLifecycleSanitizeAssignmentsForViewer_(assignmentsJson) {
  if (!assignmentsJson) return '[]';
  try {
    const list = typeof assignmentsJson === 'string' ? JSON.parse(assignmentsJson) : assignmentsJson;
    if (!Array.isArray(list)) return '[]';
    const safeList = list.map(function(item) {
      if (!item || typeof item !== 'object') return item;
      return {
        AssignmentId: item.AssignmentId || item.assignmentId,
        PersonId: item.PersonId || item.personId,
        Date: item.Date || item.date,
        DutyDomain: item.DutyDomain || item.dutyDomain,
        ShiftCode: item.ShiftCode || item.shiftCode,
        rawShift: item.rawShift || item.RawShift || item.ShiftCode || item.shiftCode
      };
    });
    return JSON.stringify(safeList);
  } catch (_) {
    return '[]';
  }
}

function rosterLifecycleAmendmentHistory_(data, principal) {
  const periodId = RosterCompatibility.validatePeriod(String(data.periodId || data.period || ''));
  rosterLifecycleEnsureAllSchemas_();
  const periodRecord = rosterLifecycleFindPeriod_(periodId);
  if (!periodRecord) {
    throw DraftProtocol.fail('ENTITY_NOT_FOUND', { message: 'Period ' + periodId + ' not found' });
  }

  const confirmedRows = rosterLifecycleFindConfirmedEventsByPeriod_(periodId);
  const amendmentRows = confirmedRows.filter(function(r) {
    return !['PUBLISH', 'CLOSE', 'REOPEN'].includes(r.EventType);
  });
  const events = RosterLifecycle.groupEventLines(amendmentRows);

  const allConfirmedGroups = RosterLifecycle.groupEventLines(confirmedRows);
  const reversedIds = new Set();
  allConfirmedGroups.forEach(function(g) {
    if (g.EventType === 'REVERSAL' && g.ReversesEventId) reversedIds.add(g.ReversesEventId);
  });

  events.forEach(function(ev) {
    ev.isReversed = reversedIds.has(ev.EventId);
    const revCheck = RosterLifecycle.canReverseEvent(ev.EventId, allConfirmedGroups);
    ev.canReverse = revCheck.canReverse;
    if (!revCheck.canReverse) ev.reversalIneligibilityReason = revCheck.reason;
  });

  // Reverse chronological ordering
  events.sort(function(a, b) {
    return (b.CreatedAt || '').localeCompare(a.CreatedAt || '') ||
      (b.ResultRevision || 0) - (a.ResultRevision || 0) ||
      (b.EventId || '').localeCompare(a.EventId || '');
  });

  // Privacy separation: omit private fields if non-admin viewer
  const isAdmin = Boolean(principal && principal.isAdmin);
  if (!isAdmin) {
    events.forEach(function(ev) {
      delete ev.AdminNote;
      delete ev.CreatedBy;
      delete ev.OperationId;
      delete ev.canReverse;
      delete ev.reversalIneligibilityReason;
      if (Array.isArray(ev.lines)) {
        ev.lines.forEach(function(l) {
          delete l.AdminNote;
          delete l.CreatedBy;
          delete l.OperationId;
          delete l.ShortageReason;
          l.PlannedAssignmentJson = rosterLifecycleSanitizeAssignmentsForViewer_(l.PlannedAssignmentJson);
          l.BeforeCurrentJson = rosterLifecycleSanitizeAssignmentsForViewer_(l.BeforeCurrentJson);
          l.AfterCurrentJson = rosterLifecycleSanitizeAssignmentsForViewer_(l.AfterCurrentJson);
        });
      }
    });
  }

  return {
    ok: true,
    periodId: periodId,
    events: events,
    count: events.length,
    isAdmin: isAdmin
  };
}

function rosterLifecycleGetPlanned_(data) {
  const periodId = RosterCompatibility.validatePeriod(String(data.periodId || data.period || ''));
  rosterLifecycleEnsureAllSchemas_();
  const periodRecord = rosterLifecycleFindPeriod_(periodId);
  if (!periodRecord) {
    throw DraftProtocol.fail('ENTITY_NOT_FOUND', { message: 'Period ' + periodId + ' not found or not enrolled' });
  }

  const plannedSnapshotId = String(periodRecord.PlannedSnapshotId || '').trim();
  if (!plannedSnapshotId) {
    throw DraftProtocol.fail('INVALID_STATE', { message: 'Period ' + periodId + ' has no authoritative Planned snapshot' });
  }

  const allPeriodAssignments = rosterLifecycleFindAssignmentsByPeriod_(periodId);
  const plannedRows = allPeriodAssignments.filter(function(r) { return r.Layer === 'PLANNED'; });

  if (plannedRows.length === 0) {
    throw DraftProtocol.fail('ENTITY_NOT_FOUND', { message: 'No Planned assignments found for period ' + periodId });
  }

  // Snapshot consistency checks:
  // 1. Verify only the period's authoritative PlannedSnapshotId is present (no foreign snapshot rows mixed in)
  const foreignSnapshotRows = plannedRows.filter(function(r) { return r.SnapshotId !== plannedSnapshotId; });
  if (foreignSnapshotRows.length > 0) {
    throw DraftProtocol.fail('CORRUPT_DATA', { message: 'Foreign snapshot rows detected in Planned layer for period ' + periodId });
  }

  // 2. Duplicate / contradictory snapshot rows fail safely
  const seenAssignmentIds = new Set();
  for (let i = 0; i < plannedRows.length; i++) {
    const id = String(plannedRows[i].AssignmentId || '').trim();
    if (!id || seenAssignmentIds.has(id)) {
      throw DraftProtocol.fail('CORRUPT_DATA', { message: 'Duplicate or missing AssignmentId in Planned snapshot for period ' + periodId });
    }
    seenAssignmentIds.add(id);
  }

  // 3. Deterministic canonical ordering across sheet row permutations
  plannedRows.sort(function(a, b) {
    return (a.Date || '').localeCompare(b.Date || '') ||
      (a.DutyDomain || '').localeCompare(b.DutyDomain || '') ||
      (a.PersonId || '').localeCompare(b.PersonId || '') ||
      (a.ShiftCode || '').localeCompare(b.ShiftCode || '') ||
      (a.AssignmentId || '').localeCompare(b.AssignmentId || '');
  });

  // 4. Safe viewer DTO: omit OperationId, CreatedBy, internal row numbers, hashes, admin notes
  const assignments = plannedRows.map(function(r) {
    let modifiers = {};
    if (r.ModifiersJson) {
      if (typeof r.ModifiersJson === 'string') {
        try { modifiers = JSON.parse(r.ModifiersJson); } catch (_) { modifiers = {}; }
      } else if (typeof r.ModifiersJson === 'object' && r.ModifiersJson !== null) {
        modifiers = r.ModifiersJson;
      }
    }
    return {
      assignmentId: String(r.AssignmentId || ''),
      personId: String(r.PersonId || ''),
      personNameSnapshot: String(r.PersonNameSnapshot || ''),
      date: String(r.Date || ''),
      dutyDomain: String(r.DutyDomain || ''),
      shiftCode: String(r.ShiftCode || ''),
      modifiers: modifiers
    };
  });

  return {
    ok: true,
    periodId: periodId,
    plannedSnapshotId: plannedSnapshotId,
    count: assignments.length,
    assignments: assignments
  };
}

function rosterLifecycleGetCurrent_(data) {
  const periodId = RosterCompatibility.validatePeriod(String(data.periodId || data.period || ''));
  rosterLifecycleEnsureAllSchemas_();
  const periodRecord = rosterLifecycleFindPeriod_(periodId);
  if (!periodRecord) {
    throw DraftProtocol.fail('ENTITY_NOT_FOUND', { message: 'Period ' + periodId + ' not found or not enrolled' });
  }

  const plannedSnapshotId = String(periodRecord.PlannedSnapshotId || '').trim();
  if (!plannedSnapshotId) {
    throw DraftProtocol.fail('INVALID_STATE', { message: 'Period ' + periodId + ' has no authoritative Planned snapshot' });
  }

  const allPeriodAssignments = rosterLifecycleFindAssignmentsByPeriod_(periodId);
  const plannedRows = allPeriodAssignments.filter(function(r) { return r.Layer === 'PLANNED'; });

  if (plannedRows.length === 0) {
    throw DraftProtocol.fail('ENTITY_NOT_FOUND', { message: 'No Planned assignments found for period ' + periodId });
  }

  // 1. Snapshot consistency checks on Planned layer
  const foreignSnapshotRows = plannedRows.filter(function(r) { return r.SnapshotId !== plannedSnapshotId; });
  if (foreignSnapshotRows.length > 0) {
    throw DraftProtocol.fail('CORRUPT_DATA', { message: 'Foreign snapshot rows detected in Planned layer for period ' + periodId });
  }

  // 2. Duplicate or missing AssignmentId or malformed required identity fields in Planned snapshot
  const seenPlannedIds = new Set();
  const validDomains = ['MO', 'EP'];
  for (let i = 0; i < plannedRows.length; i++) {
    const r = plannedRows[i];
    const id = String(r.AssignmentId || '').trim();
    if (!id || seenPlannedIds.has(id)) {
      throw DraftProtocol.fail('CORRUPT_DATA', { message: 'Duplicate or missing AssignmentId in Planned snapshot for period ' + periodId });
    }
    seenPlannedIds.add(id);

    const personId = String(r.PersonId || '').trim();
    const date = String(r.Date || '').trim();
    const dutyDomain = String(r.DutyDomain || '').trim();
    if (!personId || !date || !dutyDomain) {
      throw DraftProtocol.fail('CORRUPT_DATA', { message: 'Malformed required identity field in Planned assignment for period ' + periodId });
    }
    if (!validDomains.includes(dutyDomain)) {
      throw DraftProtocol.fail('CORRUPT_DATA', { message: 'Invalid DutyDomain "' + dutyDomain + '" in Planned assignment for period ' + periodId });
    }
  }

  // 3. Read confirmed amendment/reversal events, absences, replacements, and entitlements (unconfirmed operations remain invisible)
  const confirmedEvents = rosterLifecycleFindConfirmedEventsByPeriod_(periodId);
  const confirmedAbsences = rosterLifecycleFindConfirmedAbsencesByPeriod_(periodId);
  const confirmedReplacements = rosterLifecycleFindConfirmedReplacementsByPeriod_(periodId);
  const confirmedEntitlements = rosterLifecycleFindConfirmedEntitlementsByPeriod_(periodId);

  // 4. Derive Current using canonical Phase 5/6/7 resolver
  const people = rosterLifecycleGetPeople_();
  let resolved;
  try {
    resolved = RosterLifecycle.resolveCurrentRoster({
      periodId: periodId,
      plannedAssignments: plannedRows,
      events: confirmedEvents,
      absences: confirmedAbsences,
      replacements: confirmedReplacements,
      entitlements: confirmedEntitlements,
      people: people,
      digestFn: rosterV2Digest_
    });
  } catch (err) {
    throw DraftProtocol.fail(err.code || 'CORRUPT_DATA', { message: err.message || 'Failed to resolve Current roster' });
  }

  // 5. Post-resolution corruption checks
  const seenCurrentIds = new Set();
  for (let i = 0; i < resolved.currentAssignments.length; i++) {
    const a = resolved.currentAssignments[i];
    const id = String(a.AssignmentId || '').trim();
    if (!id || seenCurrentIds.has(id)) {
      throw DraftProtocol.fail('CORRUPT_DATA', { message: 'Duplicate or missing AssignmentId in resolved Current assignments for period ' + periodId });
    }
    seenCurrentIds.add(id);

    const personId = String(a.PersonId || '').trim();
    const date = String(a.Date || '').trim();
    const dutyDomain = String(a.DutyDomain || '').trim();
    if (!personId || !date || !dutyDomain) {
      throw DraftProtocol.fail('CORRUPT_DATA', { message: 'Malformed required identity field in resolved Current assignment for period ' + periodId });
    }
    if (!validDomains.includes(dutyDomain)) {
      throw DraftProtocol.fail('CORRUPT_DATA', { message: 'Invalid DutyDomain "' + dutyDomain + '" in resolved Current assignment for period ' + periodId });
    }
  }

  // 6. Deterministic sort:
  //    1. Date
  //    2. DutyDomain
  //    3. PersonId
  //    4. ShiftCode
  //    5. AssignmentId
  const sorted = resolved.currentAssignments.slice();
  sorted.sort(function(a, b) {
    return (a.Date || '').localeCompare(b.Date || '') ||
      (a.DutyDomain || '').localeCompare(b.DutyDomain || '') ||
      (a.PersonId || '').localeCompare(b.PersonId || '') ||
      (a.ShiftCode || '').localeCompare(b.ShiftCode || '') ||
      (a.AssignmentId || '').localeCompare(b.AssignmentId || '');
  });

  // 7. Viewer DTO: strip internal/private fields
  const assignments = sorted.map(function(r) {
    let modifiers = {};
    if (r.ModifiersJson) {
      if (typeof r.ModifiersJson === 'string') {
        try { modifiers = JSON.parse(r.ModifiersJson); } catch (_) { modifiers = {}; }
      } else if (typeof r.ModifiersJson === 'object' && r.ModifiersJson !== null) {
        modifiers = r.ModifiersJson;
      }
    }
    const dto = {
      assignmentId: String(r.AssignmentId || ''),
      personId: String(r.PersonId || ''),
      personNameSnapshot: String(r.PersonNameSnapshot || ''),
      date: String(r.Date || ''),
      dutyDomain: String(r.DutyDomain || ''),
      shiftCode: String(r.ShiftCode || ''),
      modifiers: modifiers
    };
    if (r.CoverageStatus) dto.coverageStatus = r.CoverageStatus;
    if (r.AbsenceId) dto.absenceId = r.AbsenceId;
    if (r.ReplacementId) dto.replacementId = r.ReplacementId;
    if (r.OriginalShiftCode) dto.originalShiftCode = r.OriginalShiftCode;
    if (r.OriginalAssignmentId) dto.originalAssignmentId = r.OriginalAssignmentId;
    if (r.CoveringForPersonId) dto.coveringForPersonId = r.CoveringForPersonId;
    if (r.EntitlementTransactionId) dto.entitlementTransactionId = r.EntitlementTransactionId;
    if (r.EntitlementType) dto.entitlementType = r.EntitlementType;
    if (r.Source && (r.Source === 'ABSENCE' || r.Source === 'REPLACEMENT' || r.Source === 'GOFF' || r.Source === 'GHKA')) dto.source = r.Source;
    return dto;
  });

  const isPeriodClosed = String(periodRecord.State || '').toUpperCase() === 'CLOSED';
  const effectiveState = isPeriodClosed ? 'CLOSED' : resolved.effectiveState;

  return {
    ok: true,
    periodId: periodId,
    effectiveState: effectiveState,
    lifecycleState: String(periodRecord.State || '').toUpperCase(),
    activeAmendmentCount: resolved.activeAmendmentCount,
    activeAbsences: (resolved.activeAbsences || []).length,
    activeReplacements: (resolved.activeReplacements || []).length,
    activeEntitlements: (resolved.activeEntitlements || []).length,
    totalEvents: resolved.totalEvents,
    count: assignments.length,
    assignments: assignments,
    projectionChecksum: resolved.projectionChecksum
  };
}

function rosterLifecycleClose_(data, actor) {
  const periodId = RosterCompatibility.validatePeriod(String(data.periodId || (data.payload && data.payload.periodId) || ''));
  const operationId = String(data.operationId || '').trim();
  if (!DraftProtocol.uuid(operationId)) {
    throw DraftProtocol.fail('VALIDATION_FAILED', { message: 'Valid operationId UUID is required' });
  }

  const clientId = String(data.clientId || operationId);
  const tabId = String(data.tabId || operationId);
  const entityKey = 'period:' + periodId;
  const expectedRevision = Number(data.expectedRevision !== undefined ? data.expectedRevision : (data.payload && data.payload.expectedRevision !== undefined ? data.payload.expectedRevision : 0));
  const timestamp = data.timestamp || new Date().toISOString();

  const meaning = {
    operationId: operationId,
    clientId: clientId,
    tabId: tabId,
    operationType: 'PERIOD_CLOSE',
    entityKey: entityKey,
    expectedRevision: expectedRevision,
    payload: {
      periodId: periodId,
      adminNote: data.adminNote || (data.payload && data.payload.adminNote) || ''
    }
  };
  const payloadHash = rosterV2Digest_(DraftProtocol.canonical(meaning));
  if (data.payloadHash && data.payloadHash !== payloadHash) {
    throw DraftProtocol.fail('IDEMPOTENCY_MISMATCH');
  }

  rosterLifecycleEnsureAllSchemas_();

  let existingLog = rosterLifecycleFindOperationLog_(operationId);
  if (existingLog) {
    if (existingLog.PayloadHash && existingLog.PayloadHash !== payloadHash) {
      throw DraftProtocol.fail('IDEMPOTENCY_MISMATCH');
    }
    if (existingLog.Status === 'CONFIRMED') {
      return JSON.parse(existingLog.ResultJson);
    }
    if (existingLog.Status === 'FAILED') {
      throw DraftProtocol.fail(existingLog.ErrorCode || 'PERMANENT_FAILURE');
    }
  }

  const periodRecord = rosterLifecycleFindPeriod_(periodId);
  if (!periodRecord) {
    throw DraftProtocol.fail('ENTITY_NOT_FOUND', { message: 'Period ' + periodId + ' not found' });
  }

  const currentState = String(periodRecord.State || '').toUpperCase();
  if (currentState === 'CLOSED') {
    if (periodRecord.LastOperationId === operationId) {
      let result = null;
      if (existingLog && existingLog.ResultJson) {
        try { result = JSON.parse(existingLog.ResultJson); } catch (_) {}
      }
      if (!result) {
        result = {
          ok: true,
          operationId: operationId,
          periodId: periodId,
          state: 'CLOSED',
          revision: Number(periodRecord.Revision),
          closedAt: periodRecord.ClosedAt,
          closedBy: periodRecord.ClosedBy
        };
      }
      if (existingLog) {
        existingLog.Status = 'CONFIRMED';
        existingLog.ResultRevision = Number(periodRecord.Revision);
        existingLog.ResultJson = JSON.stringify(result);
        existingLog.CompletedAt = periodRecord.ClosedAt || timestamp;
        existingLog.ErrorCode = '';
        rosterLifecycleWriteLog_(existingLog);
      }
      return result;
    }
    throw DraftProtocol.fail('INVALID_STATE', { message: 'Period ' + periodId + ' is already CLOSED' });
  }
  if (currentState !== 'PUBLISHED' && currentState !== 'AMENDED') {
    throw DraftProtocol.fail('INVALID_STATE', { message: 'Period ' + periodId + ' in state ' + currentState + ' cannot be closed' });
  }

  const currentRevision = Number(periodRecord.Revision || 0);
  if (expectedRevision !== currentRevision) {
    throw DraftProtocol.fail('REVISION_CONFLICT', {
      entityKey: entityKey,
      currentRevision: currentRevision,
      expectedRevision: expectedRevision
    });
  }

  let pendingCount = 0;
  let failedCount = 0;
  const allLogs = rosterDraftReadTable_('OperationLog');
  if (allLogs.exists) {
    const eKeyIdx = allLogs.headers.indexOf('EntityKey');
    const statusIdx = allLogs.headers.indexOf('Status');
    const opIdIdx = allLogs.headers.indexOf('OperationId');
    for (let i = 0; i < allLogs.rows.length; i++) {
      const row = allLogs.rows[i];
      if (row[eKeyIdx] === entityKey && row[opIdIdx] !== operationId) {
        if (row[statusIdx] === 'PENDING') pendingCount++;
        if (['RECOVERY_REQUIRED', 'FAILED'].includes(row[statusIdx])) failedCount++;
      }
    }
  }

  try {
    RosterLifecycle.validateTransition(currentState, 'CLOSED', {
      actor: actor,
      isManual: true,
      currentRevision: currentRevision,
      phase: 5,
      reconciliation: {
        ok: pendingCount === 0 && failedCount === 0,
        pendingOperationsCount: pendingCount,
        error: pendingCount > 0
          ? `Cannot close period: ${pendingCount} pending operations remain in the journal`
          : (failedCount > 0 ? `Cannot close period: ${failedCount} failed operations remain in the journal` : '')
      }
    });
  } catch (err) {
    throw DraftProtocol.fail(err.code || 'RECONCILIATION_FAILED', { message: err.message });
  }

  if (!existingLog) {
    existingLog = {
      OperationId: operationId,
      ClientId: clientId,
      TabId: tabId,
      OperationType: 'PERIOD_CLOSE',
      EntityKey: entityKey,
      ExpectedRevision: expectedRevision,
      ResultRevision: expectedRevision + 1,
      PayloadHash: payloadHash,
      Status: 'PENDING',
      ResultJson: '',
      ErrorCode: '',
      CreatedAt: timestamp,
      CompletedAt: ''
    };
    rosterLifecycleWriteLog_(existingLog);
    existingLog = rosterLifecycleFindOperationLog_(operationId);
  }

  const existingEvents = rosterLifecycleFindEventsByOperation_(operationId);
  if (existingEvents.length === 0) {
    const closeEvent = RosterLifecycle.createLifecycleEvent({
      periodId: periodId,
      eventType: 'CLOSE',
      operationId: operationId,
      actor: actor,
      baseRevision: currentRevision,
      resultRevision: currentRevision + 1,
      reason: data.adminNote || 'Period closed',
      timestamp: timestamp
    });
    rosterLifecycleAppendRows_('RosterEvents', [closeEvent]);
  }

  const updatedPeriod = Object.assign({}, periodRecord, {
    State: 'CLOSED',
    Revision: currentRevision + 1,
    ClosedAt: timestamp,
    ClosedBy: actor,
    LastOperationId: operationId,
    UpdatedAt: timestamp
  });
  rosterLifecycleWriteRow_('RosterPeriods', updatedPeriod, periodRecord._row);

  const confirmedResult = {
    ok: true,
    operationId: operationId,
    periodId: periodId,
    state: 'CLOSED',
    revision: currentRevision + 1,
    closedAt: timestamp,
    closedBy: actor
  };

  existingLog.Status = 'CONFIRMED';
  existingLog.ResultRevision = currentRevision + 1;
  existingLog.ResultJson = JSON.stringify(confirmedResult);
  existingLog.CompletedAt = new Date().toISOString();
  existingLog.ErrorCode = '';
  rosterLifecycleWriteLog_(existingLog);

  return confirmedResult;
}

function rosterLifecycleReopen_(data, actor) {
  const periodId = RosterCompatibility.validatePeriod(String(data.periodId || (data.payload && data.payload.periodId) || ''));
  const operationId = String(data.operationId || '').trim();
  if (!DraftProtocol.uuid(operationId)) {
    throw DraftProtocol.fail('VALIDATION_FAILED', { message: 'Valid operationId UUID is required' });
  }

  const clientId = String(data.clientId || operationId);
  const tabId = String(data.tabId || operationId);
  const entityKey = 'period:' + periodId;
  const expectedRevision = Number(data.expectedRevision !== undefined ? data.expectedRevision : (data.payload && data.payload.expectedRevision !== undefined ? data.payload.expectedRevision : 0));
  const reason = String(data.reason || (data.payload && data.payload.reason) || data.adminNote || (data.payload && data.payload.adminNote) || '').trim();
  const timestamp = data.timestamp || new Date().toISOString();

  if (!reason) {
    throw DraftProtocol.fail('REOPEN_REASON_REQUIRED', { message: 'Reopen requires a non-empty trimmed reason string' });
  }

  const meaning = {
    operationId: operationId,
    clientId: clientId,
    tabId: tabId,
    operationType: 'PERIOD_REOPEN',
    entityKey: entityKey,
    expectedRevision: expectedRevision,
    payload: {
      periodId: periodId,
      reason: reason
    }
  };
  const payloadHash = rosterV2Digest_(DraftProtocol.canonical(meaning));
  if (data.payloadHash && data.payloadHash !== payloadHash) {
    throw DraftProtocol.fail('IDEMPOTENCY_MISMATCH');
  }

  rosterLifecycleEnsureAllSchemas_();

  let existingLog = rosterLifecycleFindOperationLog_(operationId);
  if (existingLog) {
    if (existingLog.PayloadHash && existingLog.PayloadHash !== payloadHash) {
      throw DraftProtocol.fail('IDEMPOTENCY_MISMATCH');
    }
    if (existingLog.Status === 'CONFIRMED') {
      return JSON.parse(existingLog.ResultJson);
    }
    if (existingLog.Status === 'FAILED') {
      throw DraftProtocol.fail(existingLog.ErrorCode || 'PERMANENT_FAILURE');
    }
  }

  const periodRecord = rosterLifecycleFindPeriod_(periodId);
  if (!periodRecord) {
    throw DraftProtocol.fail('ENTITY_NOT_FOUND', { message: 'Period ' + periodId + ' not found' });
  }

  const currentState = String(periodRecord.State || '').toUpperCase();
  if (currentState === 'PUBLISHED' || currentState === 'AMENDED') {
    if (periodRecord.LastOperationId === operationId) {
      let result = null;
      if (existingLog && existingLog.ResultJson) {
        try { result = JSON.parse(existingLog.ResultJson); } catch (_) {}
      }
      if (!result) {
        result = {
          ok: true,
          operationId: operationId,
          periodId: periodId,
          state: currentState,
          revision: Number(periodRecord.Revision),
          reopenedAt: periodRecord.UpdatedAt,
          reopenedBy: actor,
          reason: reason
        };
      }
      if (existingLog) {
        existingLog.Status = 'CONFIRMED';
        existingLog.ResultRevision = Number(periodRecord.Revision);
        existingLog.ResultJson = JSON.stringify(result);
        existingLog.CompletedAt = periodRecord.UpdatedAt || timestamp;
        existingLog.ErrorCode = '';
        rosterLifecycleWriteLog_(existingLog);
      }
      return result;
    }
    throw DraftProtocol.fail('INVALID_STATE', { message: 'Period ' + periodId + ' is already ' + currentState });
  }
  if (currentState !== 'CLOSED') {
    throw DraftProtocol.fail('INVALID_STATE', { message: 'Period ' + periodId + ' in state ' + currentState + ' cannot be reopened' });
  }

  const currentRevision = Number(periodRecord.Revision || 0);
  if (expectedRevision !== currentRevision) {
    throw DraftProtocol.fail('REVISION_CONFLICT', {
      entityKey: entityKey,
      currentRevision: currentRevision,
      expectedRevision: expectedRevision
    });
  }

  const confirmedRows = rosterLifecycleFindConfirmedEventsByPeriod_(periodId);
  const activeCount = RosterLifecycle.countActiveAmendments(confirmedRows);
  const confirmedAbsences = rosterLifecycleFindConfirmedAbsencesByPeriod_(periodId);
  const activeAbsences = confirmedAbsences.filter(function(a) { return a.Status === 'ACTIVE'; });
  const confirmedReplacements = rosterLifecycleFindConfirmedReplacementsByPeriod_(periodId);
  const activeReplacements = confirmedReplacements.filter(function(r) { return r.Status === 'ACTIVE'; });
  const allAssignments = rosterLifecycleFindAssignmentsByPeriod_(periodId);
  const plannedAssignments = allAssignments.filter(function(r) { return r.Layer === 'PLANNED'; });
  const priorEvents = RosterLifecycle.groupEventLines(confirmedRows);
  const confirmedEntitlements = rosterLifecycleFindConfirmedEntitlementsByPeriod_(periodId);
  const cur = RosterLifecycle.resolveCurrentRoster({
    periodId: periodId,
    plannedAssignments: plannedAssignments,
    events: priorEvents,
    absences: activeAbsences,
    replacements: activeReplacements,
    entitlements: confirmedEntitlements,
    people: rosterLifecycleGetPeople_(),
    digestFn: rosterV2Digest_
  });
  const targetState = cur.effectiveState || (activeCount > 0 ? 'AMENDED' : 'PUBLISHED');
  const effectiveActiveCount = (targetState === 'AMENDED') ? Math.max(1, activeCount + activeAbsences.length) : 0;

  try {
    RosterLifecycle.validateTransition(currentState, targetState, {
      actor: actor,
      reason: reason,
      isManual: true,
      currentRevision: currentRevision,
      phase: 5,
      activeAmendmentCount: effectiveActiveCount
    });
  } catch (err) {
    throw DraftProtocol.fail(err.code || 'VALIDATION_FAILED', { message: err.message });
  }

  if (!existingLog) {
    existingLog = {
      OperationId: operationId,
      ClientId: clientId,
      TabId: tabId,
      OperationType: 'PERIOD_REOPEN',
      EntityKey: entityKey,
      ExpectedRevision: expectedRevision,
      ResultRevision: expectedRevision + 1,
      PayloadHash: payloadHash,
      Status: 'PENDING',
      ResultJson: '',
      ErrorCode: '',
      CreatedAt: timestamp,
      CompletedAt: ''
    };
    rosterLifecycleWriteLog_(existingLog);
    existingLog = rosterLifecycleFindOperationLog_(operationId);
  }

  const existingEvents = rosterLifecycleFindEventsByOperation_(operationId);
  if (existingEvents.length === 0) {
    const reopenEvent = RosterLifecycle.createLifecycleEvent({
      periodId: periodId,
      eventType: 'REOPEN',
      operationId: operationId,
      actor: actor,
      baseRevision: currentRevision,
      resultRevision: currentRevision + 1,
      reason: reason,
      timestamp: timestamp
    });
    rosterLifecycleAppendRows_('RosterEvents', [reopenEvent]);
  }

  const updatedPeriod = Object.assign({}, periodRecord, {
    State: targetState,
    Revision: currentRevision + 1,
    ClosedAt: '',
    ClosedBy: '',
    LastOperationId: operationId,
    UpdatedAt: timestamp
  });
  rosterLifecycleWriteRow_('RosterPeriods', updatedPeriod, periodRecord._row);

  const confirmedResult = {
    ok: true,
    operationId: operationId,
    periodId: periodId,
    state: targetState,
    revision: currentRevision + 1,
    reopenedAt: timestamp,
    reopenedBy: actor,
    reason: reason
  };

  existingLog.Status = 'CONFIRMED';
  existingLog.ResultRevision = currentRevision + 1;
  existingLog.ResultJson = JSON.stringify(confirmedResult);
  existingLog.CompletedAt = new Date().toISOString();
  existingLog.ErrorCode = '';
  rosterLifecycleWriteLog_(existingLog);

  return confirmedResult;
}

function rosterLifecycleStatus_(operationId) {
  const log = rosterLifecycleFindOperationLog_(operationId);
  if (!log) return { ok: true, operationId: operationId, status: 'NOT_FOUND' };
  let result = null;
  if (log.Status === 'CONFIRMED' && log.ResultJson) {
    result = JSON.parse(log.ResultJson);
  }
  return {
    ok: true,
    operationId: operationId,
    status: log.Status,
    payloadHash: log.PayloadHash,
    entityKey: log.EntityKey,
    resultRevision: log.ResultRevision,
    errorCode: log.ErrorCode || null,
    result: result
  };
}

// Supported Recovery Contract:
// 1. `rosterv2publish` retry (with the SAME operationId):
//    Performs deterministic repair and resumption of incomplete transitions.
//    If a publish attempt fails (e.g. CHECKSUM_MISMATCH, partial append, or transient readback error),
//    retrying `rosterv2publish` with the same operationId deterministically repairs the target-month
//    MasterRoster projection, deduplicates assignments and weekly snapshots, appends exactly one
//    PUBLISH event, updates RosterPeriods to PUBLISHED, and marks the OperationLog as CONFIRMED.
//
// 2. `rosterv2lifecyclerecover`:
//    Generic journal reconciliation endpoint that recovers lost acknowledgments.
//    It finalizes operations whose canonical transitions have ALREADY completed in the underlying
//    domain table (e.g. period.State === 'PUBLISHED' and period.LastOperationId === operationId)
//    but whose OperationLog write was interrupted.
//    For operations whose canonical transition did not complete (e.g. still DRAFT after CHECKSUM_MISMATCH),
//    it reports `status: 'RECOVERY_REQUIRED'` with `errorCode: 'CHECKSUM_MISMATCH'` and DOES NOT
//    falsely claim successful repair. Callers must retry the original publish operation with the same
//    operationId and payload to effectuate repair.
function rosterLifecycleRecover_(operationId) {
  const log = rosterLifecycleFindOperationLog_(operationId);
  if (!log) throw DraftProtocol.fail('ENTITY_NOT_FOUND');
  if (['CONFIRMED', 'FAILED'].includes(log.Status)) {
    return rosterLifecycleStatus_(operationId);
  }

  const periodId = log.EntityKey.replace(/^period:/, '');
  const period = rosterLifecycleFindPeriod_(periodId);

  if (log.OperationType === 'PERIOD_PUBLISH') {
    if (period && period.State === 'PUBLISHED' && period.LastOperationId === operationId) {
      if (!log.ResultJson) {
        const snapAssignments = rosterLifecycleFindAssignmentsBySnapshot_(period.PlannedSnapshotId);
        log.ResultJson = JSON.stringify({
          ok: true,
          operationId: operationId,
          periodId: periodId,
          state: 'PUBLISHED',
          revision: Number(period.Revision),
          plannedSnapshotId: period.PlannedSnapshotId,
          assignmentCount: snapAssignments.length,
          projectionChecksum: period.ProjectionChecksum,
          publishedAt: period.PublishedAt,
          publishedBy: period.PublishedBy
        });
      }
      log.Status = 'CONFIRMED';
      log.ErrorCode = '';
      log.CompletedAt = new Date().toISOString();
      rosterLifecycleWriteLog_(log);
      return rosterLifecycleStatus_(operationId);
    }
    return rosterLifecycleStatus_(operationId);
  } else if (log.OperationType === 'PERIOD_CLOSE') {
    if (period && period.State === 'CLOSED' && period.LastOperationId === operationId) {
      if (!log.ResultJson) {
        log.ResultJson = JSON.stringify({
          ok: true,
          operationId: operationId,
          periodId: periodId,
          state: 'CLOSED',
          revision: Number(period.Revision),
          closedAt: period.ClosedAt,
          closedBy: period.ClosedBy
        });
      }
      log.Status = 'CONFIRMED';
      log.ErrorCode = '';
      log.CompletedAt = new Date().toISOString();
      rosterLifecycleWriteLog_(log);
      return rosterLifecycleStatus_(operationId);
    }
    return rosterLifecycleStatus_(operationId);
  } else if (log.OperationType === 'PERIOD_REOPEN') {
    if (period && (period.State === 'PUBLISHED' || period.State === 'AMENDED') && period.LastOperationId === operationId) {
      if (!log.ResultJson) {
        log.ResultJson = JSON.stringify({
          ok: true,
          operationId: operationId,
          periodId: periodId,
          state: period.State,
          revision: Number(period.Revision)
        });
      }
      log.Status = 'CONFIRMED';
      log.ErrorCode = '';
      log.CompletedAt = new Date().toISOString();
      rosterLifecycleWriteLog_(log);
      return rosterLifecycleStatus_(operationId);
    }
    return rosterLifecycleStatus_(operationId);
  } else if (log.OperationType === 'PERIOD_AMEND' || log.OperationType === 'PERIOD_AMEND_REVERSAL') {
    if (period && (period.State === 'AMENDED' || period.State === 'PUBLISHED') && period.LastOperationId === operationId) {
      if (!log.ResultJson) {
        if (log.OperationType === 'PERIOD_AMEND') {
          const evRows = rosterLifecycleFindEventsByOperation_(operationId);
          const firstEv = evRows[0] || {};
          log.ResultJson = JSON.stringify({
            ok: true,
            operationId: operationId,
            periodId: periodId,
            state: period.State,
            revision: Number(period.Revision),
            eventId: firstEv.EventId || '',
            lineCount: evRows.length,
            projectionChecksum: period.ProjectionChecksum,
            amendedAt: period.UpdatedAt || firstEv.CreatedAt || '',
            amendedBy: firstEv.CreatedBy || ''
          });
        } else {
          const evRows = rosterLifecycleFindEventsByOperation_(operationId);
          const firstEv = evRows[0] || {};
          const allEvents = rosterLifecycleFindConfirmedEventsByPeriod_(periodId, operationId);
          const activeCount = RosterLifecycle.countActiveAmendments(RosterLifecycle.groupEventLines(allEvents));
          log.ResultJson = JSON.stringify({
            ok: true,
            operationId: operationId,
            periodId: periodId,
            state: period.State,
            revision: Number(period.Revision),
            reversalEventId: firstEv.EventId || '',
            targetEventId: firstEv.ReversesEventId || '',
            activeAmendmentCount: activeCount,
            projectionChecksum: period.ProjectionChecksum,
            reversedAt: period.UpdatedAt || firstEv.CreatedAt || '',
            reversedBy: firstEv.CreatedBy || ''
          });
        }
      }
      log.Status = 'CONFIRMED';
      log.ErrorCode = '';
      log.CompletedAt = new Date().toISOString();
      rosterLifecycleWriteLog_(log);
      return rosterLifecycleStatus_(operationId);
    }
  } else if (log.OperationType === 'ABSENCE_CREATE' || log.OperationType === 'ABSENCE_REVERSE') {
    return rosterLifecycleAbsenceRecover_(operationId, '');
  } else if (log.OperationType === 'REPLACEMENT_CREATE' || log.OperationType === 'REPLACEMENT_REVERSE') {
    return rosterLifecycleReplacementRecover_(operationId, '');
  }

  return rosterLifecycleStatus_(operationId);
}

function rosterLifecycleAbsenceRecover_(operationId, actor) {
  const log = rosterLifecycleFindOperationLog_(operationId);
  if (!log) throw DraftProtocol.fail('ENTITY_NOT_FOUND', { message: 'Operation ' + operationId + ' not found' });
  if (['CONFIRMED', 'FAILED'].includes(log.Status)) {
    return rosterLifecycleStatus_(operationId);
  }

  const periodId = log.EntityKey.replace(/^period:/, '');
  const period = rosterLifecycleFindPeriod_(periodId);
  if (!period) throw DraftProtocol.fail('ENTITY_NOT_FOUND', { message: 'Period ' + periodId + ' not found' });

  const currentRevision = Number(period.Revision || 0);

  if (log.OperationType === 'ABSENCE_CREATE') {
    const absences = rosterLifecycleGetRecords_('RosterAbsences');
    const targetAbsence = absences.find(function(a) { return a.OperationId === operationId; });
    if (!targetAbsence) {
      log.Status = 'FAILED';
      log.ErrorCode = log.ErrorCode || 'NO_PERSISTED_MUTATION';
      log.CompletedAt = new Date().toISOString();
      rosterLifecycleWriteLog_(log);
      return rosterLifecycleStatus_(operationId);
    }

    const allAssignments = rosterLifecycleFindAssignmentsByPeriod_(periodId);
    const plannedAssignments = allAssignments.filter(function(r) { return r.Layer === 'PLANNED'; });
    const confirmedEvents = rosterLifecycleFindConfirmedEventsByPeriod_(periodId, operationId);
    const priorEvents = RosterLifecycle.groupEventLines(confirmedEvents.filter(function(r) { return r.OperationId !== operationId; }));
    const confirmedAbsences = rosterLifecycleFindConfirmedAbsencesByPeriod_(periodId, operationId);
    const activeAbsences = confirmedAbsences.filter(function(a) { return a.Status === 'ACTIVE'; });
    if (!activeAbsences.some(function(a) { return a.AbsenceId === targetAbsence.AbsenceId; }) && targetAbsence.Status === 'ACTIVE') {
      activeAbsences.push(targetAbsence);
    }
    const confirmedReplacements = rosterLifecycleFindConfirmedReplacementsByPeriod_(periodId, operationId);
    const activeReplacements = confirmedReplacements.filter(function(r) { return r.Status === 'ACTIVE'; });
    const people = rosterLifecycleGetPeople_();

    const beforeAbsences = activeAbsences.filter(function(a) { return a.AbsenceId !== targetAbsence.AbsenceId; });
    const authBefore = RosterLifecycle.resolveCurrentRoster({
      periodId: periodId,
      plannedAssignments: plannedAssignments,
      events: priorEvents,
      absences: beforeAbsences,
      replacements: activeReplacements,
      people: people,
      digestFn: rosterV2Digest_
    });
    const affectedDuties = (authBefore.currentAssignments || []).filter(function(a) {
      return a.PersonId === targetAbsence.PersonId &&
        a.DutyDomain === targetAbsence.DutyDomain &&
        a.Date >= targetAbsence.StartDate &&
        a.Date <= targetAbsence.EndDate &&
        a.ShiftCode !== 'OFF' &&
        !RosterAbsence.isValidAbsenceType(a.ShiftCode);
    });
    const isNoDuty = (affectedDuties.length === 0);

    const intendedCurrent = RosterLifecycle.resolveCurrentRoster({
      periodId: periodId,
      plannedAssignments: plannedAssignments,
      events: priorEvents,
      absences: activeAbsences,
      replacements: activeReplacements,
      people: people,
      digestFn: rosterV2Digest_
    });

    const projectedRows = intendedCurrent.masterRosterProjection || RosterLifecycle.generateMasterRosterProjection(intendedCurrent.currentAssignments || []);
    const masterTable = rosterV2ReadTable_('MasterRoster');
    const existingMasterRows = masterTable.exists ? rosterV2Records_(masterTable, ['Name', 'Date', 'Shift'], true) : [];
    const mergeResult = RosterLifecycle.mergeMasterRosterProjection(existingMasterRows, periodId, projectedRows);
    rosterLifecycleWriteMasterRoster_(mergeResult.mergedRows);

    const readbackTable = rosterV2ReadTable_('MasterRoster');
    const readbackRows = rosterV2Records_(readbackTable, ['Name', 'Date', 'Shift'], true);
    const targetMonthPersistedRows = readbackRows.filter(function(r) {
      const ld = RosterCompatibility.localDate(r.Date);
      return ld && ld.slice(0, 7) === periodId;
    });
    const actualChecksum = RosterLifecycle.computeProjectionChecksum(targetMonthPersistedRows, rosterV2Digest_);
    const expectedChecksum = RosterLifecycle.computeProjectionChecksum(projectedRows, rosterV2Digest_);

    if (actualChecksum !== expectedChecksum) {
      log.Status = 'RECOVERY_REQUIRED';
      log.ErrorCode = 'CHECKSUM_MISMATCH';
      rosterLifecycleWriteLog_(log);
      throw DraftProtocol.fail('CHECKSUM_MISMATCH', { actual: actualChecksum, expected: expectedChecksum });
    }

    let targetRevision = currentRevision;
    let targetState = period.State;

    if (period.LastOperationId === operationId) {
      targetRevision = currentRevision;
      targetState = period.State;
    } else {
      if (isNoDuty) {
        targetRevision = currentRevision;
        targetState = period.State;
      } else {
        targetRevision = currentRevision + 1;
        targetState = 'AMENDED';
      }
      const updatedPeriod = Object.assign({}, period, {
        State: targetState,
        Revision: targetRevision,
        ProjectionChecksum: actualChecksum,
        LastOperationId: operationId,
        UpdatedAt: new Date().toISOString()
      });
      rosterLifecycleWriteRow_('RosterPeriods', updatedPeriod, period._row);
    }

    const confirmedResult = {
      ok: true,
      operationId: operationId,
      periodId: periodId,
      state: targetState,
      revision: targetRevision,
      absenceId: targetAbsence.AbsenceId,
      affectedAssignmentCount: affectedDuties.length,
      projectionChecksum: actualChecksum,
      createdAt: targetAbsence.CreatedAt || new Date().toISOString(),
      createdBy: targetAbsence.CreatedBy || actor || ''
    };
    log.Status = 'CONFIRMED';
    log.ResultRevision = targetRevision;
    log.ResultJson = JSON.stringify(confirmedResult);
    log.CompletedAt = new Date().toISOString();
    log.ErrorCode = '';
    rosterLifecycleWriteLog_(log);
    return rosterLifecycleStatus_(operationId);

  } else if (log.OperationType === 'ABSENCE_REVERSE') {
    const absences = rosterLifecycleGetRecords_('RosterAbsences');
    const targetAbsence = absences.find(function(a) { return a.OperationId === operationId && a.Status === 'REVERSED'; });
    if (!targetAbsence) {
      log.Status = 'FAILED';
      log.ErrorCode = log.ErrorCode || 'NO_PERSISTED_MUTATION';
      log.CompletedAt = new Date().toISOString();
      rosterLifecycleWriteLog_(log);
      return rosterLifecycleStatus_(operationId);
    }

    const allAssignments = rosterLifecycleFindAssignmentsByPeriod_(periodId);
    const plannedAssignments = allAssignments.filter(function(r) { return r.Layer === 'PLANNED'; });
    const confirmedEvents = rosterLifecycleFindConfirmedEventsByPeriod_(periodId, operationId);
    const priorEvents = RosterLifecycle.groupEventLines(confirmedEvents.filter(function(r) { return r.OperationId !== operationId; }));
    const confirmedAbsences = rosterLifecycleFindConfirmedAbsencesByPeriod_(periodId, operationId);
    const remainingActiveAbsences = confirmedAbsences.filter(function(a) { return a.AbsenceId !== targetAbsence.AbsenceId && a.Status === 'ACTIVE'; });
    const confirmedReplacements = rosterLifecycleFindConfirmedReplacementsByPeriod_(periodId, operationId);
    const activeReplacements = confirmedReplacements.filter(function(r) { return r.Status === 'ACTIVE'; });
    const people = rosterLifecycleGetPeople_();

    const intendedCurrent = RosterLifecycle.resolveCurrentRoster({
      periodId: periodId,
      plannedAssignments: plannedAssignments,
      events: priorEvents,
      absences: remainingActiveAbsences,
      replacements: activeReplacements,
      people: people,
      digestFn: rosterV2Digest_
    });

    const projectedRows = intendedCurrent.masterRosterProjection || RosterLifecycle.generateMasterRosterProjection(intendedCurrent.currentAssignments || []);
    const masterTable = rosterV2ReadTable_('MasterRoster');
    const existingMasterRows = masterTable.exists ? rosterV2Records_(masterTable, ['Name', 'Date', 'Shift'], true) : [];
    const mergeResult = RosterLifecycle.mergeMasterRosterProjection(existingMasterRows, periodId, projectedRows);
    rosterLifecycleWriteMasterRoster_(mergeResult.mergedRows);

    const readbackTable = rosterV2ReadTable_('MasterRoster');
    const readbackRows = rosterV2Records_(readbackTable, ['Name', 'Date', 'Shift'], true);
    const targetMonthPersistedRows = readbackRows.filter(function(r) {
      const ld = RosterCompatibility.localDate(r.Date);
      return ld && ld.slice(0, 7) === periodId;
    });
    const actualChecksum = RosterLifecycle.computeProjectionChecksum(targetMonthPersistedRows, rosterV2Digest_);
    const expectedChecksum = RosterLifecycle.computeProjectionChecksum(projectedRows, rosterV2Digest_);

    if (actualChecksum !== expectedChecksum) {
      log.Status = 'RECOVERY_REQUIRED';
      log.ErrorCode = 'CHECKSUM_MISMATCH';
      rosterLifecycleWriteLog_(log);
      throw DraftProtocol.fail('CHECKSUM_MISMATCH', { actual: actualChecksum, expected: expectedChecksum });
    }

    let targetRevision = currentRevision;
    const targetState = intendedCurrent.effectiveState || 'PUBLISHED';

    if (period.LastOperationId === operationId) {
      targetRevision = currentRevision;
    } else {
      const isNoDuty = (actualChecksum === period.ProjectionChecksum && targetState === period.State);
      targetRevision = isNoDuty ? currentRevision : currentRevision + 1;
      const updatedPeriod = Object.assign({}, period, {
        State: targetState,
        Revision: targetRevision,
        ProjectionChecksum: actualChecksum,
        LastOperationId: operationId,
        UpdatedAt: new Date().toISOString()
      });
      rosterLifecycleWriteRow_('RosterPeriods', updatedPeriod, period._row);
    }

    const confirmedResult = {
      ok: true,
      operationId: operationId,
      periodId: periodId,
      state: targetState,
      revision: targetRevision,
      absenceId: targetAbsence.AbsenceId,
      status: 'REVERSED',
      projectionChecksum: actualChecksum,
      reversedAt: targetAbsence.ReversedAt || targetAbsence.UpdatedAt || new Date().toISOString(),
      reversedBy: targetAbsence.ReversedBy || actor || ''
    };
    log.Status = 'CONFIRMED';
    log.ResultRevision = targetRevision;
    log.ResultJson = JSON.stringify(confirmedResult);
    log.CompletedAt = new Date().toISOString();
    log.ErrorCode = '';
    rosterLifecycleWriteLog_(log);
    return rosterLifecycleStatus_(operationId);
  }

  throw DraftProtocol.fail('VALIDATION_FAILED', { message: 'Unsupported absence operation type: ' + log.OperationType });
}

function rosterLifecycleReplacementRecover_(operationId, actor) {
  const log = rosterLifecycleFindOperationLog_(operationId);
  if (!log) throw DraftProtocol.fail('ENTITY_NOT_FOUND', { message: 'Operation ' + operationId + ' not found' });
  if (['CONFIRMED', 'FAILED'].includes(log.Status)) {
    return rosterLifecycleStatus_(operationId);
  }

  const periodId = log.EntityKey.replace(/^period:/, '');
  const period = rosterLifecycleFindPeriod_(periodId);
  if (!period) throw DraftProtocol.fail('ENTITY_NOT_FOUND', { message: 'Period ' + periodId + ' not found' });

  const currentRevision = Number(period.Revision || 0);

  if (log.OperationType === 'REPLACEMENT_CREATE') {
    const replacements = rosterLifecycleGetRecords_('RosterReplacements');
    const targetRepl = replacements.find(function(r) { return r.OperationId === operationId; });
    if (!targetRepl) {
      log.Status = 'FAILED';
      log.ErrorCode = log.ErrorCode || 'NO_PERSISTED_MUTATION';
      log.CompletedAt = new Date().toISOString();
      rosterLifecycleWriteLog_(log);
      return rosterLifecycleStatus_(operationId);
    }

    const allAssignments = rosterLifecycleFindAssignmentsByPeriod_(periodId);
    const plannedAssignments = allAssignments.filter(function(r) { return r.Layer === 'PLANNED'; });
    const confirmedEvents = rosterLifecycleFindConfirmedEventsByPeriod_(periodId, operationId);
    const priorEvents = RosterLifecycle.groupEventLines(confirmedEvents.filter(function(r) { return r.OperationId !== operationId; }));
    const confirmedAbsences = rosterLifecycleFindConfirmedAbsencesByPeriod_(periodId, operationId);
    const activeAbsences = confirmedAbsences.filter(function(a) { return a.Status === 'ACTIVE'; });
    const confirmedReplacements = rosterLifecycleFindConfirmedReplacementsByPeriod_(periodId, operationId);
    const activeReplacements = confirmedReplacements.filter(function(r) { return r.Status === 'ACTIVE'; });
    if (!activeReplacements.some(function(r) { return r.ReplacementId === targetRepl.ReplacementId; }) && targetRepl.Status === 'ACTIVE') {
      activeReplacements.push(targetRepl);
    }
    const people = rosterLifecycleGetPeople_();

    const intendedCurrent = RosterLifecycle.resolveCurrentRoster({
      periodId: periodId,
      plannedAssignments: plannedAssignments,
      events: priorEvents,
      absences: activeAbsences,
      replacements: activeReplacements,
      people: people,
      digestFn: rosterV2Digest_
    });

    const projectedRows = intendedCurrent.masterRosterProjection || RosterLifecycle.generateMasterRosterProjection(intendedCurrent.currentAssignments || []);
    const masterTable = rosterV2ReadTable_('MasterRoster');
    const existingMasterRows = masterTable.exists ? rosterV2Records_(masterTable, ['Name', 'Date', 'Shift'], true) : [];
    const mergeResult = RosterLifecycle.mergeMasterRosterProjection(existingMasterRows, periodId, projectedRows);
    rosterLifecycleWriteMasterRoster_(mergeResult.mergedRows);

    const readbackTable = rosterV2ReadTable_('MasterRoster');
    const readbackRows = rosterV2Records_(readbackTable, ['Name', 'Date', 'Shift'], true);
    const targetMonthPersistedRows = readbackRows.filter(function(r) {
      const ld = RosterCompatibility.localDate(r.Date);
      return ld && ld.slice(0, 7) === periodId;
    });
    const actualChecksum = RosterLifecycle.computeProjectionChecksum(targetMonthPersistedRows, rosterV2Digest_);
    const expectedChecksum = RosterLifecycle.computeProjectionChecksum(projectedRows, rosterV2Digest_);

    if (actualChecksum !== expectedChecksum) {
      log.Status = 'RECOVERY_REQUIRED';
      log.ErrorCode = 'CHECKSUM_MISMATCH';
      rosterLifecycleWriteLog_(log);
      throw DraftProtocol.fail('CHECKSUM_MISMATCH', { actual: actualChecksum, expected: expectedChecksum });
    }

    let targetRevision = currentRevision;
    const targetState = 'AMENDED';

    if (period.LastOperationId === operationId) {
      targetRevision = currentRevision;
    } else {
      targetRevision = currentRevision + 1;
      const updatedPeriod = Object.assign({}, period, {
        State: targetState,
        Revision: targetRevision,
        ProjectionChecksum: actualChecksum,
        LastOperationId: operationId,
        UpdatedAt: new Date().toISOString()
      });
      rosterLifecycleWriteRow_('RosterPeriods', updatedPeriod, period._row);
    }

    const confirmedResult = {
      ok: true,
      operationId: operationId,
      periodId: periodId,
      state: targetState,
      revision: targetRevision,
      replacementId: targetRepl.ReplacementId,
      absenceId: targetRepl.AbsenceId,
      originalAssignmentId: targetRepl.OriginalAssignmentId,
      replacementAssignmentId: targetRepl.ReplacementAssignmentId,
      projectionChecksum: actualChecksum,
      createdAt: targetRepl.CreatedAt || new Date().toISOString(),
      createdBy: targetRepl.CreatedBy || actor || ''
    };
    log.Status = 'CONFIRMED';
    log.ResultRevision = targetRevision;
    log.ResultJson = JSON.stringify(confirmedResult);
    log.CompletedAt = new Date().toISOString();
    log.ErrorCode = '';
    rosterLifecycleWriteLog_(log);
    return rosterLifecycleStatus_(operationId);

  } else if (log.OperationType === 'REPLACEMENT_REVERSE') {
    const replacements = rosterLifecycleGetRecords_('RosterReplacements');
    const targetRepl = replacements.find(function(r) { return r.OperationId === operationId && r.Status === 'REVERSED'; });
    if (!targetRepl) {
      log.Status = 'FAILED';
      log.ErrorCode = log.ErrorCode || 'NO_PERSISTED_MUTATION';
      log.CompletedAt = new Date().toISOString();
      rosterLifecycleWriteLog_(log);
      return rosterLifecycleStatus_(operationId);
    }

    const allAssignments = rosterLifecycleFindAssignmentsByPeriod_(periodId);
    const plannedAssignments = allAssignments.filter(function(r) { return r.Layer === 'PLANNED'; });
    const confirmedEvents = rosterLifecycleFindConfirmedEventsByPeriod_(periodId, operationId);
    const priorEvents = RosterLifecycle.groupEventLines(confirmedEvents.filter(function(r) { return r.OperationId !== operationId; }));
    const confirmedAbsences = rosterLifecycleFindConfirmedAbsencesByPeriod_(periodId, operationId);
    const activeAbsences = confirmedAbsences.filter(function(a) { return a.Status === 'ACTIVE'; });
    const confirmedReplacements = rosterLifecycleFindConfirmedReplacementsByPeriod_(periodId, operationId);
    const remainingActiveReplacements = confirmedReplacements.filter(function(r) { return r.ReplacementId !== targetRepl.ReplacementId && r.Status === 'ACTIVE'; });
    const people = rosterLifecycleGetPeople_();

    const intendedCurrent = RosterLifecycle.resolveCurrentRoster({
      periodId: periodId,
      plannedAssignments: plannedAssignments,
      events: priorEvents,
      absences: activeAbsences,
      replacements: remainingActiveReplacements,
      people: people,
      digestFn: rosterV2Digest_
    });

    const projectedRows = intendedCurrent.masterRosterProjection || RosterLifecycle.generateMasterRosterProjection(intendedCurrent.currentAssignments || []);
    const masterTable = rosterV2ReadTable_('MasterRoster');
    const existingMasterRows = masterTable.exists ? rosterV2Records_(masterTable, ['Name', 'Date', 'Shift'], true) : [];
    const mergeResult = RosterLifecycle.mergeMasterRosterProjection(existingMasterRows, periodId, projectedRows);
    rosterLifecycleWriteMasterRoster_(mergeResult.mergedRows);

    const readbackTable = rosterV2ReadTable_('MasterRoster');
    const readbackRows = rosterV2Records_(readbackTable, ['Name', 'Date', 'Shift'], true);
    const targetMonthPersistedRows = readbackRows.filter(function(r) {
      const ld = RosterCompatibility.localDate(r.Date);
      return ld && ld.slice(0, 7) === periodId;
    });
    const actualChecksum = RosterLifecycle.computeProjectionChecksum(targetMonthPersistedRows, rosterV2Digest_);
    const expectedChecksum = RosterLifecycle.computeProjectionChecksum(projectedRows, rosterV2Digest_);

    if (actualChecksum !== expectedChecksum) {
      log.Status = 'RECOVERY_REQUIRED';
      log.ErrorCode = 'CHECKSUM_MISMATCH';
      rosterLifecycleWriteLog_(log);
      throw DraftProtocol.fail('CHECKSUM_MISMATCH', { actual: actualChecksum, expected: expectedChecksum });
    }

    let targetRevision = currentRevision;
    const targetState = intendedCurrent.effectiveState || 'AMENDED';

    if (period.LastOperationId === operationId) {
      targetRevision = currentRevision;
    } else {
      targetRevision = currentRevision + 1;
      const updatedPeriod = Object.assign({}, period, {
        State: targetState,
        Revision: targetRevision,
        ProjectionChecksum: actualChecksum,
        LastOperationId: operationId,
        UpdatedAt: new Date().toISOString()
      });
      rosterLifecycleWriteRow_('RosterPeriods', updatedPeriod, period._row);
    }

    const confirmedResult = {
      ok: true,
      operationId: operationId,
      periodId: periodId,
      state: targetState,
      revision: targetRevision,
      replacementId: targetRepl.ReplacementId,
      status: 'REVERSED',
      coverageStatus: 'UNCOVERED',
      projectionChecksum: actualChecksum,
      reversedAt: targetRepl.ReversedAt || targetRepl.UpdatedAt || new Date().toISOString(),
      reversedBy: targetRepl.ReversedBy || actor || ''
    };
    log.Status = 'CONFIRMED';
    log.ResultRevision = targetRevision;
    log.ResultJson = JSON.stringify(confirmedResult);
    log.CompletedAt = new Date().toISOString();
    log.ErrorCode = '';
    rosterLifecycleWriteLog_(log);
    return rosterLifecycleStatus_(operationId);
  }

  throw DraftProtocol.fail('VALIDATION_FAILED', { message: 'Unsupported replacement operation type: ' + log.OperationType });
}

function rosterLifecycleAbsenceCreate_(data, actor) {
  const payloadMeaning = DraftProtocol.payload(Object.assign({}, data, {
    operationType: 'ABSENCE_CREATE',
    clientId: data.clientId || data.operationId,
    tabId: data.tabId || data.operationId
  }));
  const operationId = payloadMeaning.operationId;
  const clientId = payloadMeaning.clientId;
  const tabId = payloadMeaning.tabId;
  const periodId = payloadMeaning.payload.periodId;
  const expectedRevision = payloadMeaning.expectedRevision;
  const personId = payloadMeaning.payload.personId;
  const absenceType = payloadMeaning.payload.absenceType;
  const startDate = payloadMeaning.payload.startDate;
  const endDate = payloadMeaning.payload.endDate;
  const dutyDomain = payloadMeaning.payload.dutyDomain;
  const publicReason = payloadMeaning.payload.publicReason;
  const adminNote = payloadMeaning.payload.adminNote;
  const shortageAccepted = payloadMeaning.payload.shortageAccepted;
  const shortageReason = payloadMeaning.payload.shortageReason;
  const timestamp = data.timestamp || new Date().toISOString();

  const payloadHash = rosterV2Digest_(DraftProtocol.canonical(payloadMeaning));
  if (data.payloadHash && data.payloadHash !== payloadHash) {
    throw DraftProtocol.fail('IDEMPOTENCY_MISMATCH');
  }

  rosterLifecycleEnsureAllSchemas_();

  let existingLog = rosterLifecycleFindOperationLog_(operationId);
  if (existingLog) {
    if (existingLog.PayloadHash && existingLog.PayloadHash !== payloadHash) {
      throw DraftProtocol.fail('IDEMPOTENCY_MISMATCH');
    }
    if (existingLog.Status === 'CONFIRMED') {
      return JSON.parse(existingLog.ResultJson);
    }
    if (existingLog.Status === 'FAILED') {
      throw DraftProtocol.fail(existingLog.ErrorCode || 'PERMANENT_FAILURE');
    }
  }

  const periodRecord = rosterLifecycleFindPeriod_(periodId);
  if (!periodRecord) {
    throw DraftProtocol.fail('ENTITY_NOT_FOUND', { message: 'Period ' + periodId + ' not found or not enrolled' });
  }

  const currentState = String(periodRecord.State || '').toUpperCase();
  if (currentState !== 'PUBLISHED' && currentState !== 'AMENDED') {
    throw DraftProtocol.fail('INVALID_STATE', { message: 'Period ' + periodId + ' in state ' + currentState + ' cannot receive absence mutation; must be PUBLISHED or AMENDED' });
  }

  const currentRevision = Number(periodRecord.Revision || 0);

  // Critical recovery window check: if period was already updated with this operationId
  if (periodRecord.LastOperationId === operationId) {
    let result = null;
    if (existingLog && existingLog.ResultJson) {
      try { result = JSON.parse(existingLog.ResultJson); } catch (_) {}
    }
    if (!result) {
      const absences = rosterLifecycleGetRecords_('RosterAbsences');
      const targetAbsence = absences.find(function(a) { return a.OperationId === operationId; });
      result = {
        ok: true,
        operationId: operationId,
        periodId: periodId,
        state: periodRecord.State,
        revision: currentRevision,
        absenceId: targetAbsence ? targetAbsence.AbsenceId : '',
        projectionChecksum: periodRecord.ProjectionChecksum,
        createdAt: targetAbsence ? targetAbsence.CreatedAt : timestamp,
        createdBy: targetAbsence ? targetAbsence.CreatedBy : actor
      };
    }
    if (existingLog) {
      existingLog.Status = 'CONFIRMED';
      existingLog.ResultRevision = currentRevision;
      existingLog.ResultJson = JSON.stringify(result);
      existingLog.CompletedAt = periodRecord.UpdatedAt || timestamp;
      existingLog.ErrorCode = '';
      rosterLifecycleWriteLog_(existingLog);
    }
    return result;
  }

  if (expectedRevision !== currentRevision) {
    throw DraftProtocol.fail('REVISION_CONFLICT', {
      entityKey: 'period:' + periodId,
      currentRevision: currentRevision,
      expectedRevision: expectedRevision
    });
  }

  // 1. Validate person in RosterPeople
  const people = rosterLifecycleGetPeople_();
  const person = people.find(function(p) { return p.PersonId === personId; });
  if (!person) {
    throw DraftProtocol.fail('INVALID_PERSON_IDENTITY', { message: 'Person ' + personId + ' does not exist in RosterPeople' });
  }
  const personNameSnapshot = person.CurrentDisplayName || person.MemberName || '';

  // 2. Validate DutyDomain
  if (!['MO', 'EP'].includes(dutyDomain)) {
    throw DraftProtocol.fail('DUTY_DOMAIN_MISMATCH', { message: 'Invalid DutyDomain: ' + dutyDomain });
  }
  if (person.DirectoryType && person.DirectoryType !== dutyDomain) {
    throw DraftProtocol.fail('DUTY_DOMAIN_MISMATCH', { message: 'Person directory type ' + person.DirectoryType + ' does not match DutyDomain ' + dutyDomain });
  }

  // 3. Validate AbsenceType
  if (!RosterAbsence.isValidAbsenceType(absenceType)) {
    throw DraftProtocol.fail('INVALID_ABSENCE_TYPE', { message: 'Invalid absence type: ' + absenceType });
  }

  // 4. Validate Date Range
  if (!startDate || !endDate || startDate > endDate) {
    throw DraftProtocol.fail('INVALID_DATE_RANGE', { message: 'Invalid date range: ' + startDate + ' to ' + endDate });
  }
  if (startDate.slice(0, 7) !== periodId && endDate.slice(0, 7) !== periodId) {
    throw DraftProtocol.fail('INVALID_DATE_RANGE', { message: 'Date range does not belong to period ' + periodId });
  }

  // 5. Check overlapping active absences
  const confirmedAbsences = rosterLifecycleFindConfirmedAbsencesByPeriod_(periodId, operationId);
  const priorAbsences = confirmedAbsences.filter(function(a) { return a.OperationId !== operationId && a.Status === 'ACTIVE'; });
  RosterAbsence.checkAbsenceOverlap({
    candidateAbsence: {
      PersonId: personId,
      DutyDomain: dutyDomain,
      StartDate: startDate,
      EndDate: endDate
    },
    existingAbsences: priorAbsences
  });

  // 6. Load baseline Planned and confirmed amendments/replacements
  const allAssignments = rosterLifecycleFindAssignmentsByPeriod_(periodId);
  const plannedAssignments = allAssignments.filter(function(r) { return r.Layer === 'PLANNED'; });
  DraftProtocol.ensure(plannedAssignments.length > 0, 'ENTITY_NOT_FOUND', { message: 'No Planned assignments found for period ' + periodId });

  const confirmedEvents = rosterLifecycleFindConfirmedEventsByPeriod_(periodId, operationId);
  const priorEvents = RosterLifecycle.groupEventLines(confirmedEvents.filter(function(r) { return r.OperationId !== operationId; }));
  const confirmedReplacements = rosterLifecycleFindConfirmedReplacementsByPeriod_(periodId, operationId);
  const priorReplacements = confirmedReplacements.filter(function(r) { return r.OperationId !== operationId && r.Status === 'ACTIVE'; });

  // 7. Resolve Current BEFORE this absence to find affected duties
  const authoritativeBefore = RosterLifecycle.resolveCurrentRoster({
    periodId: periodId,
    plannedAssignments: plannedAssignments,
    events: priorEvents,
    absences: priorAbsences,
    replacements: priorReplacements,
    people: people,
    digestFn: rosterV2Digest_
  });

  const affectedDuties = (authoritativeBefore.currentAssignments || []).filter(function(a) {
    return a.PersonId === personId &&
      a.DutyDomain === dutyDomain &&
      a.Date >= startDate &&
      a.Date <= endDate &&
      a.ShiftCode !== 'OFF' &&
      !RosterAbsence.isValidAbsenceType(a.ShiftCode);
  });

  const isNoDuty = (affectedDuties.length === 0);
  const targetRevision = isNoDuty ? currentRevision : (currentRevision + 1);
  const targetState = isNoDuty ? periodRecord.State : 'AMENDED';

  // Shortage validation: only required if active working duty is affected
  if (affectedDuties.length > 0) {
    RosterAbsence.validateShortageAcceptance({
      coverageStatus: 'UNCOVERED',
      shortageAccepted: shortageAccepted,
      shortageReason: shortageReason
    });
  }

  // Journal PENDING
  if (!existingLog) {
    existingLog = {
      OperationId: operationId,
      ClientId: clientId,
      TabId: tabId,
      OperationType: 'ABSENCE_CREATE',
      EntityKey: 'period:' + periodId,
      ExpectedRevision: expectedRevision,
      ResultRevision: targetRevision,
      PayloadHash: payloadHash,
      Status: 'PENDING',
      ResultJson: '',
      ErrorCode: '',
      CreatedAt: timestamp,
      CompletedAt: ''
    };
    rosterLifecycleWriteLog_(existingLog);
    existingLog = rosterLifecycleFindOperationLog_(operationId);
  }

  let entityPersisted = false;
  try {
    // 8. Persist Absence row idempotently
    const absenceId = RosterAbsence.deterministicAbsenceId(operationId, personId, startDate, endDate, dutyDomain, rosterV2Digest_);
    const absenceRecord = {
      AbsenceId: absenceId,
      PeriodId: periodId,
      PersonId: personId,
      PersonNameSnapshot: personNameSnapshot,
      AbsenceType: absenceType,
      StartDate: startDate,
      EndDate: endDate,
      DutyDomain: dutyDomain,
      PublicReason: publicReason,
      AdminNote: adminNote,
      Status: 'ACTIVE',
      OperationId: operationId,
      CreatedAt: timestamp,
      CreatedBy: actor
    };

    const existingAbsences = rosterLifecycleGetRecords_('RosterAbsences');
    const existingAbsence = existingAbsences.find(function(a) { return a.AbsenceId === absenceId; });
    if (existingAbsence) {
      rosterLifecycleWriteRow_('RosterAbsences', Object.assign({}, existingAbsence, absenceRecord), existingAbsence._row);
    } else {
      rosterLifecycleAppendRows_('RosterAbsences', [absenceRecord]);
    }
    entityPersisted = true;

    // 9. Compute intended Current with the new absence
    const intendedAbsences = priorAbsences.concat([absenceRecord]);
    const intendedCurrent = RosterLifecycle.resolveCurrentRoster({
      periodId: periodId,
      plannedAssignments: plannedAssignments,
      events: priorEvents,
      absences: intendedAbsences,
      replacements: priorReplacements,
      people: people,
      digestFn: rosterV2Digest_
    });

    // 10. Project to MasterRoster and write
    const projectedRows = intendedCurrent.masterRosterProjection || RosterLifecycle.generateMasterRosterProjection(intendedCurrent.currentAssignments || []);
    const masterTable = rosterV2ReadTable_('MasterRoster');
    const existingMasterRows = masterTable.exists ? rosterV2Records_(masterTable, ['Name', 'Date', 'Shift'], true) : [];
    const mergeResult = RosterLifecycle.mergeMasterRosterProjection(existingMasterRows, periodId, projectedRows);
    rosterLifecycleWriteMasterRoster_(mergeResult.mergedRows);

    // 11. Read back and verify projection checksum
    const readbackTable = rosterV2ReadTable_('MasterRoster');
    const readbackRows = rosterV2Records_(readbackTable, ['Name', 'Date', 'Shift'], true);
    const targetMonthPersistedRows = readbackRows.filter(function(r) {
      const ld = RosterCompatibility.localDate(r.Date);
      return ld && ld.slice(0, 7) === periodId;
    });

    const actualChecksum = RosterLifecycle.computeProjectionChecksum(targetMonthPersistedRows, rosterV2Digest_);
    const expectedChecksum = RosterLifecycle.computeProjectionChecksum(projectedRows, rosterV2Digest_);

    if (actualChecksum !== expectedChecksum) {
      existingLog.Status = 'RECOVERY_REQUIRED';
      existingLog.ErrorCode = 'CHECKSUM_MISMATCH';
      rosterLifecycleWriteLog_(existingLog);
      throw DraftProtocol.fail('CHECKSUM_MISMATCH', {
        actual: actualChecksum,
        expected: expectedChecksum
      });
    }

    // 12. Update RosterPeriods
    const updatedPeriod = Object.assign({}, periodRecord, {
      State: targetState,
      Revision: targetRevision,
      ProjectionChecksum: actualChecksum,
      LastOperationId: operationId,
      UpdatedAt: timestamp
    });
    rosterLifecycleWriteRow_('RosterPeriods', updatedPeriod, periodRecord._row);

    // 13. Confirm OperationLog
    const confirmedResult = {
      ok: true,
      operationId: operationId,
      periodId: periodId,
      state: targetState,
      revision: targetRevision,
      absenceId: absenceId,
      affectedAssignmentCount: affectedDuties.length,
      projectionChecksum: actualChecksum,
      createdAt: timestamp,
      createdBy: actor
    };
    existingLog.Status = 'CONFIRMED';
    existingLog.ResultRevision = targetRevision;
    existingLog.ResultJson = JSON.stringify(confirmedResult);
    existingLog.CompletedAt = new Date().toISOString();
    existingLog.ErrorCode = '';
    rosterLifecycleWriteLog_(existingLog);

    return confirmedResult;
  } catch (err) {
    if (existingLog) {
      existingLog.Status = entityPersisted ? 'RECOVERY_REQUIRED' : 'FAILED';
      existingLog.ErrorCode = err.code || (entityPersisted ? 'RECOVERY_REQUIRED' : 'VALIDATION_FAILED');
      existingLog.CompletedAt = new Date().toISOString();
      rosterLifecycleWriteLog_(existingLog);
    }
    throw err;
  }
}

function rosterLifecycleReplacementCreate_(data, actor) {
  const payloadMeaning = DraftProtocol.payload(Object.assign({}, data, {
    operationType: 'REPLACEMENT_CREATE',
    clientId: data.clientId || data.operationId,
    tabId: data.tabId || data.operationId
  }));
  const operationId = payloadMeaning.operationId;
  const clientId = payloadMeaning.clientId;
  const tabId = payloadMeaning.tabId;
  const periodId = payloadMeaning.payload.periodId;
  const expectedRevision = payloadMeaning.expectedRevision;
  const absenceId = payloadMeaning.payload.absenceId;
  const originalAssignmentId = payloadMeaning.payload.originalAssignmentId;
  const replacementPersonId = payloadMeaning.payload.replacementPersonId;
  const date = payloadMeaning.payload.date;
  const dutyDomain = payloadMeaning.payload.dutyDomain;
  const shiftCode = payloadMeaning.payload.shiftCode;
  const publicReason = payloadMeaning.payload.publicReason;
  const adminNote = payloadMeaning.payload.adminNote;
  const timestamp = data.timestamp || new Date().toISOString();

  const payloadHash = rosterV2Digest_(DraftProtocol.canonical(payloadMeaning));
  if (data.payloadHash && data.payloadHash !== payloadHash) {
    throw DraftProtocol.fail('IDEMPOTENCY_MISMATCH');
  }

  rosterLifecycleEnsureAllSchemas_();

  let existingLog = rosterLifecycleFindOperationLog_(operationId);
  if (existingLog) {
    if (existingLog.PayloadHash && existingLog.PayloadHash !== payloadHash) {
      throw DraftProtocol.fail('IDEMPOTENCY_MISMATCH');
    }
    if (existingLog.Status === 'CONFIRMED') {
      return JSON.parse(existingLog.ResultJson);
    }
    if (existingLog.Status === 'FAILED') {
      throw DraftProtocol.fail(existingLog.ErrorCode || 'PERMANENT_FAILURE');
    }
  }

  const periodRecord = rosterLifecycleFindPeriod_(periodId);
  if (!periodRecord) {
    throw DraftProtocol.fail('ENTITY_NOT_FOUND', { message: 'Period ' + periodId + ' not found or not enrolled' });
  }

  const currentState = String(periodRecord.State || '').toUpperCase();
  if (currentState !== 'PUBLISHED' && currentState !== 'AMENDED') {
    throw DraftProtocol.fail('INVALID_STATE', { message: 'Period ' + periodId + ' in state ' + currentState + ' cannot receive replacement mutation; must be PUBLISHED or AMENDED' });
  }

  const currentRevision = Number(periodRecord.Revision || 0);

  // Critical recovery window check: if period was already updated with this operationId
  if (periodRecord.LastOperationId === operationId) {
    let result = null;
    if (existingLog && existingLog.ResultJson) {
      try { result = JSON.parse(existingLog.ResultJson); } catch (_) {}
    }
    if (!result) {
      const replacements = rosterLifecycleGetRecords_('RosterReplacements');
      const targetRepl = replacements.find(function(r) { return r.OperationId === operationId; });
      result = {
        ok: true,
        operationId: operationId,
        periodId: periodId,
        state: periodRecord.State,
        revision: currentRevision,
        replacementId: targetRepl ? targetRepl.ReplacementId : '',
        absenceId: absenceId,
        originalAssignmentId: targetRepl ? targetRepl.OriginalAssignmentId : '',
        replacementAssignmentId: targetRepl ? targetRepl.ReplacementAssignmentId : '',
        projectionChecksum: periodRecord.ProjectionChecksum,
        createdAt: targetRepl ? targetRepl.CreatedAt : timestamp,
        createdBy: targetRepl ? targetRepl.CreatedBy : actor
      };
    }
    if (existingLog) {
      existingLog.Status = 'CONFIRMED';
      existingLog.ResultRevision = currentRevision;
      existingLog.ResultJson = JSON.stringify(result);
      existingLog.CompletedAt = periodRecord.UpdatedAt || timestamp;
      existingLog.ErrorCode = '';
      rosterLifecycleWriteLog_(existingLog);
    }
    return result;
  }

  if (expectedRevision !== currentRevision) {
    throw DraftProtocol.fail('REVISION_CONFLICT', {
      entityKey: 'period:' + periodId,
      currentRevision: currentRevision,
      expectedRevision: expectedRevision
    });
  }

  // 1. Locate parent absence
  const absenceRecord = rosterLifecycleFindAbsenceById_(absenceId);
  if (!absenceRecord) {
    throw DraftProtocol.fail('ABSENCE_NOT_FOUND', { message: 'Absence ' + absenceId + ' not found' });
  }
  if (absenceRecord.Status !== 'ACTIVE') {
    throw DraftProtocol.fail('ABSENCE_ALREADY_REVERSED', { message: 'Cannot add replacement to non-active absence ' + absenceId });
  }

  // Parent operation must be CONFIRMED
  const parentOpLog = rosterLifecycleFindOperationLog_(absenceRecord.OperationId);
  if (!parentOpLog || parentOpLog.Status !== 'CONFIRMED') {
    throw DraftProtocol.fail('VALIDATION_FAILED', { message: 'Parent absence operation is not confirmed' });
  }

  // Date must be within parent absence range
  if (date < absenceRecord.StartDate || date > absenceRecord.EndDate) {
    throw DraftProtocol.fail('INVALID_DATE_RANGE', { message: 'Replacement date ' + date + ' is outside absence range [' + absenceRecord.StartDate + ', ' + absenceRecord.EndDate + ']' });
  }

  // DutyDomain must match parent absence
  if (dutyDomain !== absenceRecord.DutyDomain) {
    throw DraftProtocol.fail('DUTY_DOMAIN_MISMATCH', { message: 'Replacement DutyDomain ' + dutyDomain + ' does not match absence DutyDomain ' + absenceRecord.DutyDomain });
  }

  // Replacement person must exist and not be the absent person
  const people = rosterLifecycleGetPeople_();
  const replPerson = people.find(function(p) { return p.PersonId === replacementPersonId; });
  if (!replPerson) {
    throw DraftProtocol.fail('INVALID_PERSON_IDENTITY', { message: 'Replacement person ' + replacementPersonId + ' does not exist in RosterPeople' });
  }
  if (replacementPersonId === absenceRecord.PersonId) {
    throw DraftProtocol.fail('INVALID_PERSON_IDENTITY', { message: 'Replacement person cannot be the same as the absent person' });
  }
  // 2. Load prior state and verify target duty is genuinely affected
  const allAssignments = rosterLifecycleFindAssignmentsByPeriod_(periodId);
  const plannedAssignments = allAssignments.filter(function(r) { return r.Layer === 'PLANNED'; });
  DraftProtocol.ensure(plannedAssignments.length > 0, 'ENTITY_NOT_FOUND', { message: 'No Planned assignments found for period ' + periodId });

  const confirmedEvents = rosterLifecycleFindConfirmedEventsByPeriod_(periodId, operationId);
  const priorEvents = RosterLifecycle.groupEventLines(confirmedEvents.filter(function(r) { return r.OperationId !== operationId; }));
  const confirmedAbsences = rosterLifecycleFindConfirmedAbsencesByPeriod_(periodId, operationId);
  const priorAbsences = confirmedAbsences.filter(function(a) { return a.OperationId !== operationId && a.Status === 'ACTIVE'; });
  const confirmedReplacements = rosterLifecycleFindConfirmedReplacementsByPeriod_(periodId, operationId);
  const priorReplacements = confirmedReplacements.filter(function(r) { return r.OperationId !== operationId && r.Status === 'ACTIVE'; });

  // Replacement person cannot be on active absence on this date in this duty domain
  const replPersonAbsence = priorAbsences.find(function(a) {
    return a.PersonId === replacementPersonId &&
      a.DutyDomain === dutyDomain &&
      a.StartDate <= date &&
      a.EndDate >= date;
  });
  if (replPersonAbsence) {
    throw DraftProtocol.fail('INVALID_ASSIGNMENT', { message: 'Replacement person ' + replacementPersonId + ' is on active absence (' + replPersonAbsence.AbsenceType + ') on date ' + date });
  }

  const authoritativeBefore = RosterLifecycle.resolveCurrentRoster({
    periodId: periodId,
    plannedAssignments: plannedAssignments,
    events: priorEvents,
    absences: priorAbsences,
    replacements: priorReplacements,
    people: people,
    digestFn: rosterV2Digest_
  });

  // Verify absent person currently has an UNCOVERED assignment on this date
  const absentAssignmentsOnDate = (authoritativeBefore.currentAssignments || []).filter(function(a) {
    return a.PersonId === absenceRecord.PersonId &&
      a.Date === date &&
      a.DutyDomain === dutyDomain &&
      a.AbsenceId === absenceId;
  });

  if (absentAssignmentsOnDate.length === 0) {
    throw DraftProtocol.fail('INVALID_ASSIGNMENT', { message: 'No absent assignment found for ' + absenceRecord.PersonId + ' on date ' + date });
  }

  const targetAbsentAssignment = absentAssignmentsOnDate[0];
  if (targetAbsentAssignment.CoverageStatus === 'COVERED') {
    throw DraftProtocol.fail('INVALID_ASSIGNMENT', { message: 'Assignment on date ' + date + ' is already covered' });
  }

  const effectiveOrigAssignId = originalAssignmentId || targetAbsentAssignment.OriginalAssignmentId || targetAbsentAssignment.AssignmentId;

  // Collision check: replacement person cannot already have an active working assignment on this date in this DutyDomain
  const replPersonCurrentOnDate = (authoritativeBefore.currentAssignments || []).filter(function(a) {
    return a.PersonId === replacementPersonId &&
      a.Date === date &&
      a.DutyDomain === dutyDomain &&
      a.ShiftCode !== 'OFF';
  });
  if (replPersonCurrentOnDate.length > 0) {
    throw DraftProtocol.fail('INVALID_ASSIGNMENT', { message: 'Replacement person ' + replacementPersonId + ' already has an active assignment on date ' + date });
  }

  // Journal PENDING
  if (!existingLog) {
    existingLog = {
      OperationId: operationId,
      ClientId: clientId,
      TabId: tabId,
      OperationType: 'REPLACEMENT_CREATE',
      EntityKey: 'period:' + periodId,
      ExpectedRevision: expectedRevision,
      ResultRevision: expectedRevision + 1,
      PayloadHash: payloadHash,
      Status: 'PENDING',
      ResultJson: '',
      ErrorCode: '',
      CreatedAt: timestamp,
      CompletedAt: ''
    };
    rosterLifecycleWriteLog_(existingLog);
    existingLog = rosterLifecycleFindOperationLog_(operationId);
  }

  let entityPersisted = false;
  try {
    // 3. Persist Replacement row idempotently
    const replacementId = RosterAbsence.deterministicReplacementId(operationId, absenceId, effectiveOrigAssignId, replacementPersonId, rosterV2Digest_);
    const replacementAssignmentId = RosterLifecycle.deterministicAssignmentId(operationId, replacementPersonId, date, dutyDomain, shiftCode, 0, rosterV2Digest_);

    const replacementRecord = {
      ReplacementId: replacementId,
      AbsenceId: absenceId,
      OriginalAssignmentId: effectiveOrigAssignId,
      ReplacementPersonId: replacementPersonId,
      ReplacementAssignmentId: replacementAssignmentId,
      DutyDomain: dutyDomain,
      Date: date,
      ShiftCode: shiftCode,
      Status: 'ACTIVE',
      OperationId: operationId,
      CreatedAt: timestamp,
      CreatedBy: actor
    };

    const existingReplacements = rosterLifecycleGetRecords_('RosterReplacements');
    const existingRepl = existingReplacements.find(function(r) { return r.ReplacementId === replacementId; });
    if (existingRepl) {
      rosterLifecycleWriteRow_('RosterReplacements', Object.assign({}, existingRepl, replacementRecord), existingRepl._row);
    } else {
      rosterLifecycleAppendRows_('RosterReplacements', [replacementRecord]);
    }
    entityPersisted = true;

    // 4. Compute intended Current with the new replacement
    const intendedReplacements = priorReplacements.concat([replacementRecord]);
    const intendedCurrent = RosterLifecycle.resolveCurrentRoster({
      periodId: periodId,
      plannedAssignments: plannedAssignments,
      events: priorEvents,
      absences: priorAbsences,
      replacements: intendedReplacements,
      people: people,
      digestFn: rosterV2Digest_
    });

    // 5. Project to MasterRoster and write
    const projectedRows = intendedCurrent.masterRosterProjection || RosterLifecycle.generateMasterRosterProjection(intendedCurrent.currentAssignments || []);
    const masterTable = rosterV2ReadTable_('MasterRoster');
    const existingMasterRows = masterTable.exists ? rosterV2Records_(masterTable, ['Name', 'Date', 'Shift'], true) : [];
    const mergeResult = RosterLifecycle.mergeMasterRosterProjection(existingMasterRows, periodId, projectedRows);
    rosterLifecycleWriteMasterRoster_(mergeResult.mergedRows);

    // 6. Read back and verify projection checksum
    const readbackTable = rosterV2ReadTable_('MasterRoster');
    const readbackRows = rosterV2Records_(readbackTable, ['Name', 'Date', 'Shift'], true);
    const targetMonthPersistedRows = readbackRows.filter(function(r) {
      const ld = RosterCompatibility.localDate(r.Date);
      return ld && ld.slice(0, 7) === periodId;
    });

    const actualChecksum = RosterLifecycle.computeProjectionChecksum(targetMonthPersistedRows, rosterV2Digest_);
    const expectedChecksum = RosterLifecycle.computeProjectionChecksum(projectedRows, rosterV2Digest_);

    if (actualChecksum !== expectedChecksum) {
      existingLog.Status = 'RECOVERY_REQUIRED';
      existingLog.ErrorCode = 'CHECKSUM_MISMATCH';
      rosterLifecycleWriteLog_(existingLog);
      throw DraftProtocol.fail('CHECKSUM_MISMATCH', {
        actual: actualChecksum,
        expected: expectedChecksum
      });
    }

    // 7. Update RosterPeriods
    const updatedPeriod = Object.assign({}, periodRecord, {
      State: 'AMENDED',
      Revision: currentRevision + 1,
      ProjectionChecksum: actualChecksum,
      LastOperationId: operationId,
      UpdatedAt: timestamp
    });
    rosterLifecycleWriteRow_('RosterPeriods', updatedPeriod, periodRecord._row);

    // 8. Confirm OperationLog
    const confirmedResult = {
      ok: true,
      operationId: operationId,
      periodId: periodId,
      state: 'AMENDED',
      revision: currentRevision + 1,
      replacementId: replacementId,
      absenceId: absenceId,
      originalAssignmentId: effectiveOrigAssignId,
      replacementAssignmentId: replacementAssignmentId,
      projectionChecksum: actualChecksum,
      createdAt: timestamp,
      createdBy: actor
    };
    existingLog.Status = 'CONFIRMED';
    existingLog.ResultRevision = currentRevision + 1;
    existingLog.ResultJson = JSON.stringify(confirmedResult);
    existingLog.CompletedAt = new Date().toISOString();
    existingLog.ErrorCode = '';
    rosterLifecycleWriteLog_(existingLog);

    return confirmedResult;
  } catch (err) {
    if (existingLog) {
      existingLog.Status = entityPersisted ? 'RECOVERY_REQUIRED' : 'FAILED';
      existingLog.ErrorCode = err.code || (entityPersisted ? 'RECOVERY_REQUIRED' : 'VALIDATION_FAILED');
      existingLog.CompletedAt = new Date().toISOString();
      rosterLifecycleWriteLog_(existingLog);
    }
    throw err;
  }
}

function rosterLifecycleAbsenceReverse_(data, actor) {
  const payloadMeaning = DraftProtocol.payload(Object.assign({}, data, {
    operationType: 'ABSENCE_REVERSE',
    clientId: data.clientId || data.operationId,
    tabId: data.tabId || data.operationId
  }));
  const operationId = payloadMeaning.operationId;
  const clientId = payloadMeaning.clientId;
  const tabId = payloadMeaning.tabId;
  const periodId = payloadMeaning.payload.periodId;
  const expectedRevision = payloadMeaning.expectedRevision;
  const absenceId = payloadMeaning.payload.absenceId;
  const adminNote = payloadMeaning.payload.adminNote;
  const timestamp = data.timestamp || new Date().toISOString();

  const payloadHash = rosterV2Digest_(DraftProtocol.canonical(payloadMeaning));
  if (data.payloadHash && data.payloadHash !== payloadHash) {
    throw DraftProtocol.fail('IDEMPOTENCY_MISMATCH');
  }

  rosterLifecycleEnsureAllSchemas_();

  let existingLog = rosterLifecycleFindOperationLog_(operationId);
  if (existingLog) {
    if (existingLog.PayloadHash && existingLog.PayloadHash !== payloadHash) {
      throw DraftProtocol.fail('IDEMPOTENCY_MISMATCH');
    }
    if (existingLog.Status === 'CONFIRMED') {
      return JSON.parse(existingLog.ResultJson);
    }
    if (existingLog.Status === 'FAILED') {
      throw DraftProtocol.fail(existingLog.ErrorCode || 'PERMANENT_FAILURE');
    }
  }

  const periodRecord = rosterLifecycleFindPeriod_(periodId);
  if (!periodRecord) {
    throw DraftProtocol.fail('ENTITY_NOT_FOUND', { message: 'Period ' + periodId + ' not found or not enrolled' });
  }

  const currentState = String(periodRecord.State || '').toUpperCase();
  if (currentState !== 'AMENDED') {
    if (!(currentState === 'PUBLISHED' && periodRecord.LastOperationId === operationId)) {
      throw DraftProtocol.fail('INVALID_STATE', { message: 'Period ' + periodId + ' in state ' + currentState + ' cannot reverse absence; must be AMENDED' });
    }
  }

  const currentRevision = Number(periodRecord.Revision || 0);

  // Critical recovery window check: if period was already updated with this operationId
  if (periodRecord.LastOperationId === operationId) {
    let result = null;
    if (existingLog && existingLog.ResultJson) {
      try { result = JSON.parse(existingLog.ResultJson); } catch (_) {}
    }
    if (!result) {
      result = {
        ok: true,
        operationId: operationId,
        periodId: periodId,
        state: periodRecord.State,
        revision: currentRevision,
        absenceId: absenceId,
        status: 'REVERSED',
        projectionChecksum: periodRecord.ProjectionChecksum,
        reversedAt: periodRecord.UpdatedAt || timestamp,
        reversedBy: actor
      };
    }
    if (existingLog) {
      existingLog.Status = 'CONFIRMED';
      existingLog.ResultRevision = currentRevision;
      existingLog.ResultJson = JSON.stringify(result);
      existingLog.CompletedAt = periodRecord.UpdatedAt || timestamp;
      existingLog.ErrorCode = '';
      rosterLifecycleWriteLog_(existingLog);
    }
    return result;
  }

  if (expectedRevision !== currentRevision) {
    throw DraftProtocol.fail('REVISION_CONFLICT', {
      entityKey: 'period:' + periodId,
      currentRevision: currentRevision,
      expectedRevision: expectedRevision
    });
  }

  // 1. Locate target absence
  const absenceRecord = rosterLifecycleFindAbsenceById_(absenceId);
  if (!absenceRecord) {
    throw DraftProtocol.fail('ABSENCE_NOT_FOUND', { message: 'Absence ' + absenceId + ' not found' });
  }
  if (absenceRecord.Status === 'REVERSED') {
    throw DraftProtocol.fail('ABSENCE_ALREADY_REVERSED', { message: 'Absence ' + absenceId + ' is already reversed' });
  }

  // 2. Check dependencies: are there active replacements for this absence?
  const confirmedReplacements = rosterLifecycleFindConfirmedReplacementsByPeriod_(periodId, operationId);
  const activeReplacements = confirmedReplacements.filter(function(r) {
    return r.AbsenceId === absenceId && r.Status === 'ACTIVE';
  });
  if (activeReplacements.length > 0) {
    throw DraftProtocol.fail('REPLACEMENT_DEPENDENCY_CONFLICT', {
      message: 'Cannot reverse absence ' + absenceId + ' while ' + activeReplacements.length + ' active replacement(s) depend on it'
    });
  }

  // Journal PENDING
  if (!existingLog) {
    existingLog = {
      OperationId: operationId,
      ClientId: clientId,
      TabId: tabId,
      OperationType: 'ABSENCE_REVERSE',
      EntityKey: 'period:' + periodId,
      ExpectedRevision: expectedRevision,
      ResultRevision: expectedRevision + 1,
      PayloadHash: payloadHash,
      Status: 'PENDING',
      ResultJson: '',
      ErrorCode: '',
      CreatedAt: timestamp,
      CompletedAt: ''
    };
    rosterLifecycleWriteLog_(existingLog);
    existingLog = rosterLifecycleFindOperationLog_(operationId);
  }

  let entityPersisted = false;
  try {
    // 3. Mark absence row as REVERSED
    const updatedAbsence = Object.assign({}, absenceRecord, {
      Status: 'REVERSED',
      OperationId: operationId,
      UpdatedAt: timestamp,
      ReversedBy: actor,
      ReversedAt: timestamp
    });
    rosterLifecycleWriteRow_('RosterAbsences', updatedAbsence, absenceRecord._row);
    entityPersisted = true;

    // 4. Load baseline Planned, confirmed events, confirmed absences/replacements
    const allAssignments = rosterLifecycleFindAssignmentsByPeriod_(periodId);
    const plannedAssignments = allAssignments.filter(function(r) { return r.Layer === 'PLANNED'; });
    DraftProtocol.ensure(plannedAssignments.length > 0, 'ENTITY_NOT_FOUND', { message: 'No Planned assignments found for period ' + periodId });

    const confirmedEvents = rosterLifecycleFindConfirmedEventsByPeriod_(periodId, operationId);
    const priorEvents = RosterLifecycle.groupEventLines(confirmedEvents.filter(function(r) { return r.OperationId !== operationId; }));
    const confirmedAbsences = rosterLifecycleFindConfirmedAbsencesByPeriod_(periodId, operationId);
    const remainingActiveAbsences = confirmedAbsences.filter(function(a) {
      return a.AbsenceId !== absenceId && a.Status === 'ACTIVE';
    });
    const remainingActiveReplacements = confirmedReplacements.filter(function(r) {
      return r.Status === 'ACTIVE';
    });
    const people = rosterLifecycleGetPeople_();

    // 5. Recompute intended Current
    const intendedCurrent = RosterLifecycle.resolveCurrentRoster({
      periodId: periodId,
      plannedAssignments: plannedAssignments,
      events: priorEvents,
      absences: remainingActiveAbsences,
      replacements: remainingActiveReplacements,
      people: people,
      digestFn: rosterV2Digest_
    });

    // 6. Project to MasterRoster and write
    const projectedRows = intendedCurrent.masterRosterProjection || RosterLifecycle.generateMasterRosterProjection(intendedCurrent.currentAssignments || []);
    const masterTable = rosterV2ReadTable_('MasterRoster');
    const existingMasterRows = masterTable.exists ? rosterV2Records_(masterTable, ['Name', 'Date', 'Shift'], true) : [];
    const mergeResult = RosterLifecycle.mergeMasterRosterProjection(existingMasterRows, periodId, projectedRows);
    rosterLifecycleWriteMasterRoster_(mergeResult.mergedRows);

    // 7. Read back and verify projection checksum
    const readbackTable = rosterV2ReadTable_('MasterRoster');
    const readbackRows = rosterV2Records_(readbackTable, ['Name', 'Date', 'Shift'], true);
    const targetMonthPersistedRows = readbackRows.filter(function(r) {
      const ld = RosterCompatibility.localDate(r.Date);
      return ld && ld.slice(0, 7) === periodId;
    });

    const actualChecksum = RosterLifecycle.computeProjectionChecksum(targetMonthPersistedRows, rosterV2Digest_);
    const expectedChecksum = RosterLifecycle.computeProjectionChecksum(projectedRows, rosterV2Digest_);

    if (actualChecksum !== expectedChecksum) {
      existingLog.Status = 'RECOVERY_REQUIRED';
      existingLog.ErrorCode = 'CHECKSUM_MISMATCH';
      rosterLifecycleWriteLog_(existingLog);
      throw DraftProtocol.fail('CHECKSUM_MISMATCH', {
        actual: actualChecksum,
        expected: expectedChecksum
      });
    }

    // 8. Determine target state and revision
    const targetState = intendedCurrent.effectiveState || 'PUBLISHED';
    const isNoDuty = (actualChecksum === periodRecord.ProjectionChecksum && targetState === periodRecord.State);
    const targetRevision = isNoDuty ? currentRevision : (currentRevision + 1);

    // Update RosterPeriods
    const updatedPeriod = Object.assign({}, periodRecord, {
      State: targetState,
      Revision: targetRevision,
      ProjectionChecksum: actualChecksum,
      LastOperationId: operationId,
      UpdatedAt: timestamp
    });
    rosterLifecycleWriteRow_('RosterPeriods', updatedPeriod, periodRecord._row);

    // 9. Confirm OperationLog
    const confirmedResult = {
      ok: true,
      operationId: operationId,
      periodId: periodId,
      state: targetState,
      revision: targetRevision,
      absenceId: absenceId,
      status: 'REVERSED',
      projectionChecksum: actualChecksum,
      reversedAt: timestamp,
      reversedBy: actor
    };
    existingLog.Status = 'CONFIRMED';
    existingLog.ResultRevision = targetRevision;
    existingLog.ResultJson = JSON.stringify(confirmedResult);
    existingLog.CompletedAt = new Date().toISOString();
    existingLog.ErrorCode = '';
    rosterLifecycleWriteLog_(existingLog);

    return confirmedResult;
  } catch (err) {
    if (existingLog) {
      existingLog.Status = entityPersisted ? 'RECOVERY_REQUIRED' : 'FAILED';
      existingLog.ErrorCode = err.code || (entityPersisted ? 'RECOVERY_REQUIRED' : 'VALIDATION_FAILED');
      existingLog.CompletedAt = new Date().toISOString();
      rosterLifecycleWriteLog_(existingLog);
    }
    throw err;
  }
}

function rosterLifecycleReplacementReverse_(data, actor) {
  const payloadMeaning = DraftProtocol.payload(Object.assign({}, data, {
    operationType: 'REPLACEMENT_REVERSE',
    clientId: data.clientId || data.operationId,
    tabId: data.tabId || data.operationId
  }));
  const operationId = payloadMeaning.operationId;
  const clientId = payloadMeaning.clientId;
  const tabId = payloadMeaning.tabId;
  const periodId = payloadMeaning.payload.periodId;
  const expectedRevision = payloadMeaning.expectedRevision;
  const replacementId = payloadMeaning.payload.replacementId;
  const adminNote = payloadMeaning.payload.adminNote;
  const shortageAccepted = payloadMeaning.payload.shortageAccepted;
  const shortageReason = payloadMeaning.payload.shortageReason;
  const timestamp = data.timestamp || new Date().toISOString();

  const payloadHash = rosterV2Digest_(DraftProtocol.canonical(payloadMeaning));
  if (data.payloadHash && data.payloadHash !== payloadHash) {
    throw DraftProtocol.fail('IDEMPOTENCY_MISMATCH');
  }

  rosterLifecycleEnsureAllSchemas_();

  let existingLog = rosterLifecycleFindOperationLog_(operationId);
  if (existingLog) {
    if (existingLog.PayloadHash && existingLog.PayloadHash !== payloadHash) {
      throw DraftProtocol.fail('IDEMPOTENCY_MISMATCH');
    }
    if (existingLog.Status === 'CONFIRMED') {
      return JSON.parse(existingLog.ResultJson);
    }
    if (existingLog.Status === 'FAILED') {
      throw DraftProtocol.fail(existingLog.ErrorCode || 'PERMANENT_FAILURE');
    }
  }

  const periodRecord = rosterLifecycleFindPeriod_(periodId);
  if (!periodRecord) {
    throw DraftProtocol.fail('ENTITY_NOT_FOUND', { message: 'Period ' + periodId + ' not found or not enrolled' });
  }

  const currentState = String(periodRecord.State || '').toUpperCase();
  if (currentState !== 'AMENDED') {
    if (!(currentState === 'PUBLISHED' && periodRecord.LastOperationId === operationId)) {
      throw DraftProtocol.fail('INVALID_STATE', { message: 'Period ' + periodId + ' in state ' + currentState + ' cannot reverse replacement; must be AMENDED' });
    }
  }

  const currentRevision = Number(periodRecord.Revision || 0);

  // Critical recovery window check: if period was already updated with this operationId
  if (periodRecord.LastOperationId === operationId) {
    let result = null;
    if (existingLog && existingLog.ResultJson) {
      try { result = JSON.parse(existingLog.ResultJson); } catch (_) {}
    }
    if (!result) {
      result = {
        ok: true,
        operationId: operationId,
        periodId: periodId,
        state: periodRecord.State,
        revision: currentRevision,
        replacementId: replacementId,
        status: 'REVERSED',
        coverageStatus: 'UNCOVERED',
        projectionChecksum: periodRecord.ProjectionChecksum,
        reversedAt: periodRecord.UpdatedAt || timestamp,
        reversedBy: actor
      };
    }
    if (existingLog) {
      existingLog.Status = 'CONFIRMED';
      existingLog.ResultRevision = currentRevision;
      existingLog.ResultJson = JSON.stringify(result);
      existingLog.CompletedAt = periodRecord.UpdatedAt || timestamp;
      existingLog.ErrorCode = '';
      rosterLifecycleWriteLog_(existingLog);
    }
    return result;
  }

  if (expectedRevision !== currentRevision) {
    throw DraftProtocol.fail('REVISION_CONFLICT', {
      entityKey: 'period:' + periodId,
      currentRevision: currentRevision,
      expectedRevision: expectedRevision
    });
  }

  // 1. Locate target replacement
  const replacementRecord = rosterLifecycleFindReplacementById_(replacementId);
  if (!replacementRecord) {
    throw DraftProtocol.fail('REPLACEMENT_NOT_FOUND', { message: 'Replacement ' + replacementId + ' not found' });
  }
  if (replacementRecord.Status === 'REVERSED') {
    throw DraftProtocol.fail('REPLACEMENT_ALREADY_REVERSED', { message: 'Replacement ' + replacementId + ' is already reversed' });
  }

  // 2. Parent absence must remain ACTIVE
  const parentAbsence = rosterLifecycleFindAbsenceById_(replacementRecord.AbsenceId);
  if (!parentAbsence || parentAbsence.Status !== 'ACTIVE') {
    throw DraftProtocol.fail('ABSENCE_ALREADY_REVERSED', { message: 'Parent absence is no longer active' });
  }

  // Shortage validation: reversing replacement leaves duty uncovered
  RosterAbsence.validateShortageAcceptance({
    coverageStatus: 'UNCOVERED',
    shortageAccepted: shortageAccepted,
    shortageReason: shortageReason
  });

  // Journal PENDING
  if (!existingLog) {
    existingLog = {
      OperationId: operationId,
      ClientId: clientId,
      TabId: tabId,
      OperationType: 'REPLACEMENT_REVERSE',
      EntityKey: 'period:' + periodId,
      ExpectedRevision: expectedRevision,
      ResultRevision: expectedRevision + 1,
      PayloadHash: payloadHash,
      Status: 'PENDING',
      ResultJson: '',
      ErrorCode: '',
      CreatedAt: timestamp,
      CompletedAt: ''
    };
    rosterLifecycleWriteLog_(existingLog);
    existingLog = rosterLifecycleFindOperationLog_(operationId);
  }

  let entityPersisted = false;
  try {
    // 3. Mark replacement row as REVERSED
    const updatedRepl = Object.assign({}, replacementRecord, {
      Status: 'REVERSED',
      OperationId: operationId,
      UpdatedAt: timestamp,
      ReversedBy: actor,
      ReversedAt: timestamp
    });
    rosterLifecycleWriteRow_('RosterReplacements', updatedRepl, replacementRecord._row);
    entityPersisted = true;

    // 4. Load baseline Planned, confirmed events, confirmed absences/replacements
    const allAssignments = rosterLifecycleFindAssignmentsByPeriod_(periodId);
    const plannedAssignments = allAssignments.filter(function(r) { return r.Layer === 'PLANNED'; });
    DraftProtocol.ensure(plannedAssignments.length > 0, 'ENTITY_NOT_FOUND', { message: 'No Planned assignments found for period ' + periodId });

    const confirmedEvents = rosterLifecycleFindConfirmedEventsByPeriod_(periodId, operationId);
    const priorEvents = RosterLifecycle.groupEventLines(confirmedEvents.filter(function(r) { return r.OperationId !== operationId; }));
    const confirmedAbsences = rosterLifecycleFindConfirmedAbsencesByPeriod_(periodId, operationId);
    const activeAbsences = confirmedAbsences.filter(function(a) { return a.Status === 'ACTIVE'; });
    const confirmedReplacements = rosterLifecycleFindConfirmedReplacementsByPeriod_(periodId, operationId);
    const remainingActiveReplacements = confirmedReplacements.filter(function(r) {
      return r.ReplacementId !== replacementId && r.Status === 'ACTIVE';
    });
    const people = rosterLifecycleGetPeople_();

    // 5. Recompute intended Current (duty returns to UNCOVERED absence)
    const intendedCurrent = RosterLifecycle.resolveCurrentRoster({
      periodId: periodId,
      plannedAssignments: plannedAssignments,
      events: priorEvents,
      absences: activeAbsences,
      replacements: remainingActiveReplacements,
      people: people,
      digestFn: rosterV2Digest_
    });

    // 6. Project to MasterRoster and write
    const projectedRows = intendedCurrent.masterRosterProjection || RosterLifecycle.generateMasterRosterProjection(intendedCurrent.currentAssignments || []);
    const masterTable = rosterV2ReadTable_('MasterRoster');
    const existingMasterRows = masterTable.exists ? rosterV2Records_(masterTable, ['Name', 'Date', 'Shift'], true) : [];
    const mergeResult = RosterLifecycle.mergeMasterRosterProjection(existingMasterRows, periodId, projectedRows);
    rosterLifecycleWriteMasterRoster_(mergeResult.mergedRows);

    // 7. Read back and verify projection checksum
    const readbackTable = rosterV2ReadTable_('MasterRoster');
    const readbackRows = rosterV2Records_(readbackTable, ['Name', 'Date', 'Shift'], true);
    const targetMonthPersistedRows = readbackRows.filter(function(r) {
      const ld = RosterCompatibility.localDate(r.Date);
      return ld && ld.slice(0, 7) === periodId;
    });

    const actualChecksum = RosterLifecycle.computeProjectionChecksum(targetMonthPersistedRows, rosterV2Digest_);
    const expectedChecksum = RosterLifecycle.computeProjectionChecksum(projectedRows, rosterV2Digest_);

    if (actualChecksum !== expectedChecksum) {
      existingLog.Status = 'RECOVERY_REQUIRED';
      existingLog.ErrorCode = 'CHECKSUM_MISMATCH';
      rosterLifecycleWriteLog_(existingLog);
      throw DraftProtocol.fail('CHECKSUM_MISMATCH', {
        actual: actualChecksum,
        expected: expectedChecksum
      });
    }

    // 8. Update RosterPeriods (remains AMENDED since parent absence is active)
    const updatedPeriod = Object.assign({}, periodRecord, {
      State: 'AMENDED',
      Revision: currentRevision + 1,
      ProjectionChecksum: actualChecksum,
      LastOperationId: operationId,
      UpdatedAt: timestamp
    });
    rosterLifecycleWriteRow_('RosterPeriods', updatedPeriod, periodRecord._row);

    // 9. Confirm OperationLog
    const confirmedResult = {
      ok: true,
      operationId: operationId,
      periodId: periodId,
      state: 'AMENDED',
      revision: currentRevision + 1,
      replacementId: replacementId,
      status: 'REVERSED',
      coverageStatus: 'UNCOVERED',
      projectionChecksum: actualChecksum,
      reversedAt: timestamp,
      reversedBy: actor
    };
    existingLog.Status = 'CONFIRMED';
    existingLog.ResultRevision = currentRevision + 1;
    existingLog.ResultJson = JSON.stringify(confirmedResult);
    existingLog.CompletedAt = new Date().toISOString();
    existingLog.ErrorCode = '';
    rosterLifecycleWriteLog_(existingLog);

    return confirmedResult;
  } catch (err) {
    if (existingLog) {
      existingLog.Status = entityPersisted ? 'RECOVERY_REQUIRED' : 'FAILED';
      existingLog.ErrorCode = err.code || (entityPersisted ? 'RECOVERY_REQUIRED' : 'VALIDATION_FAILED');
      existingLog.CompletedAt = new Date().toISOString();
      rosterLifecycleWriteLog_(existingLog);
    }
    throw err;
  }
}

function rosterLifecycleGetAbsences_(parameters, principal) {
  const periodId = RosterCompatibility.validatePeriod(String(parameters.periodId || parameters.period || ''));
  rosterLifecycleEnsureAllSchemas_();
  const periodRecord = rosterLifecycleFindPeriod_(periodId);
  if (!periodRecord) {
    throw DraftProtocol.fail('ENTITY_NOT_FOUND', { message: 'Period ' + periodId + ' not found or not enrolled' });
  }

  const confirmedAbsences = rosterLifecycleFindConfirmedAbsencesByPeriod_(periodId);
  const isAdmin = Boolean(principal && principal.isAdmin);

  const absences = confirmedAbsences.map(function(a) {
    if (isAdmin) {
      return {
        AbsenceId: a.AbsenceId,
        PeriodId: a.PeriodId,
        PersonId: a.PersonId,
        PersonNameSnapshot: a.PersonNameSnapshot || '',
        AbsenceType: a.AbsenceType,
        StartDate: a.StartDate,
        EndDate: a.EndDate,
        DutyDomain: a.DutyDomain,
        PublicReason: a.PublicReason || '',
        AdminNote: a.AdminNote || '',
        Status: a.Status,
        OperationId: a.OperationId,
        CreatedAt: a.CreatedAt,
        CreatedBy: a.CreatedBy
      };
    }
    return RosterAbsence.toPublicAbsenceDto(a);
  });

  return {
    ok: true,
    periodId: periodId,
    absences: absences,
    count: absences.length,
    isAdmin: isAdmin
  };
}

function rosterLifecycleGetReplacements_(parameters, principal) {
  const periodId = RosterCompatibility.validatePeriod(String(parameters.periodId || parameters.period || ''));
  rosterLifecycleEnsureAllSchemas_();
  const periodRecord = rosterLifecycleFindPeriod_(periodId);
  if (!periodRecord) {
    throw DraftProtocol.fail('ENTITY_NOT_FOUND', { message: 'Period ' + periodId + ' not found or not enrolled' });
  }

  const confirmedReplacements = rosterLifecycleFindConfirmedReplacementsByPeriod_(periodId);
  const isAdmin = Boolean(principal && principal.isAdmin);

  const replacements = confirmedReplacements.map(function(r) {
    const dto = {
      ReplacementId: r.ReplacementId,
      AbsenceId: r.AbsenceId,
      OriginalAssignmentId: r.OriginalAssignmentId,
      ReplacementPersonId: r.ReplacementPersonId,
      ReplacementAssignmentId: r.ReplacementAssignmentId,
      DutyDomain: r.DutyDomain,
      Date: r.Date,
      ShiftCode: r.ShiftCode,
      Status: r.Status,
      CreatedAt: r.CreatedAt
    };
    if (isAdmin) {
      dto.OperationId = r.OperationId;
      dto.CreatedBy = r.CreatedBy;
    }
    return dto;
  });

  return {
    ok: true,
    periodId: periodId,
    replacements: replacements,
    count: replacements.length,
    isAdmin: isAdmin
  };
}

function rosterLifecycleGetEntitlementBalances_(parameters, principal) {
  if (!principal || !principal.isAdmin) {
    throw DraftProtocol.fail('AUTHORIZATION_REQUIRED', { message: 'Administrator authorization required to view entitlement balances' });
  }
  const personId = String(parameters.personId || parameters.person || '').trim();
  const asOfDate = parameters.asOfDate ? String(parameters.asOfDate).trim() : null;
  if (!personId) {
    throw DraftProtocol.fail('VALIDATION_FAILED', { message: 'personId is required' });
  }

  rosterLifecycleEnsureAllSchemas_();
  const people = rosterLifecycleGetPeople_();
  const person = people.find(function(p) { return p.PersonId === personId; });
  if (!person) {
    throw DraftProtocol.fail('INVALID_PERSON_IDENTITY', { message: 'Person ' + personId + ' not found' });
  }

  // EP domain boundary: Section 1 & 9
  if (person.DirectoryType === 'EP') {
    throw DraftProtocol.fail('EP_DOMAIN_EXCLUDED', { message: 'EP domain does not participate in entitlement accounting' });
  }
  if (person.DirectoryType !== 'MO') {
    throw DraftProtocol.fail('EP_DOMAIN_EXCLUDED', { message: 'Only MO directory type participates in entitlement accounting' });
  }

  // Read all confirmed transactions for this person across periods
  const confirmedTx = rosterLifecycleFindAllConfirmedEntitlementsByPerson_(personId);
  const goff = RosterEntitlement.deriveEntitlementBalance(confirmedTx, personId, 'GOFF', asOfDate);
  const ghka = RosterEntitlement.deriveEntitlementBalance(confirmedTx, personId, 'GHKA', asOfDate);

  return {
    ok: true,
    personId: personId,
    balances: {
      GOFF: goff.currentBalance,
      GHKA: ghka.currentBalance
    },
    availableBalances: {
      GOFF: goff.availableBalance,
      GHKA: ghka.availableBalance
    },
    asOfDate: asOfDate || null
  };
}

function rosterLifecycleGetEntitlementTransactions_(parameters, principal) {
  const periodId = parameters.periodId || parameters.period ? RosterCompatibility.validatePeriod(String(parameters.periodId || parameters.period)) : null;
  const personId = parameters.personId || parameters.person ? String(parameters.personId || parameters.person).trim() : null;
  const isAdmin = Boolean(principal && principal.isAdmin);

  if (!isAdmin && personId) {
    throw DraftProtocol.fail('AUTHORIZATION_REQUIRED', { message: 'Administrator authorization required to view individual staff entitlement history' });
  }

  rosterLifecycleEnsureAllSchemas_();
  let confirmedTx;
  if (personId) {
    confirmedTx = rosterLifecycleFindAllConfirmedEntitlementsByPerson_(personId);
    if (periodId) {
      confirmedTx = confirmedTx.filter(function(tx) {
        return (tx.PeriodId === periodId) || (tx.EffectiveDate && String(tx.EffectiveDate).slice(0, 7) === periodId);
      });
    }
  } else if (periodId) {
    confirmedTx = rosterLifecycleFindConfirmedEntitlementsByPeriod_(periodId);
  } else {
    const records = rosterLifecycleGetRecords_('RosterEntitlementTransactions');
    const confirmedOpIds = rosterLifecycleGetConfirmedOperationIdsAll_();
    confirmedTx = records.filter(function(tx) {
      if (tx.OperationId) {
        return confirmedOpIds.has(tx.OperationId);
      }
      return tx.Status === 'CONFIRMED';
    });
  }

  const transactions = confirmedTx.map(function(tx) {
    if (isAdmin) {
      return {
        TransactionId: tx.TransactionId,
        PeriodId: tx.PeriodId,
        PersonId: tx.PersonId,
        PersonNameSnapshot: tx.PersonNameSnapshot || '',
        EntitlementType: tx.EntitlementType,
        DutyDomain: tx.DutyDomain,
        TransactionType: tx.TransactionType,
        Amount: Number(tx.Amount),
        EffectiveDate: tx.EffectiveDate,
        SourceType: tx.SourceType,
        SourceId: tx.SourceId || '',
        SourceAssignmentId: tx.SourceAssignmentId || '',
        SourcePeriodId: tx.SourcePeriodId || '',
        PublicHolidayDate: tx.PublicHolidayDate || '',
        PublicHolidayName: tx.PublicHolidayName || '',
        RosterAssignmentId: tx.RosterAssignmentId || '',
        RelatedTransactionId: tx.RelatedTransactionId || '',
        ReasonCode: tx.ReasonCode || '',
        AdminNote: tx.AdminNote || '',
        ExpiresAt: tx.ExpiresAt || '',
        ExpiryPolicyCode: tx.ExpiryPolicyCode || '',
        Status: tx.Status,
        OperationId: tx.OperationId,
        CreatedAt: tx.CreatedAt,
        CreatedBy: tx.CreatedBy
      };
    }
    return RosterEntitlement.scrubEntitlementViewerDto(tx);
  });

  return {
    ok: true,
    periodId: periodId,
    personId: personId,
    transactions: transactions,
    count: transactions.length,
    isAdmin: isAdmin
  };
}

function rosterLifecycleEntitlementEarnGoff_(data, actor) {
  const payloadMeaning = DraftProtocol.payload(Object.assign({}, data, {
    operationType: 'ENTITLEMENT_EARN_GOFF',
    expectedRevision: Number.isSafeInteger(data.expectedRevision) ? data.expectedRevision : 0,
    clientId: data.clientId || data.operationId,
    tabId: data.tabId || data.operationId
  }));
  const operationId = payloadMeaning.operationId;
  const clientId = payloadMeaning.clientId;
  const tabId = payloadMeaning.tabId;
  const periodId = payloadMeaning.payload.periodId;
  const personId = payloadMeaning.payload.personId;
  const date = payloadMeaning.payload.date || payloadMeaning.payload.effectiveDate;
  const adminNote = payloadMeaning.payload.adminNote || '';
  const timestamp = data.timestamp || new Date().toISOString();

  if (!periodId) throw DraftProtocol.fail('VALIDATION_FAILED', { message: 'periodId is required' });
  if (!personId) throw DraftProtocol.fail('VALIDATION_FAILED', { message: 'personId is required' });
  if (!date) throw DraftProtocol.fail('VALIDATION_FAILED', { message: 'date is required' });

  const payloadHash = rosterV2Digest_(DraftProtocol.canonical(payloadMeaning));
  if (data.payloadHash && data.payloadHash !== payloadHash) {
    throw DraftProtocol.fail('IDEMPOTENCY_MISMATCH');
  }

  rosterLifecycleEnsureAllSchemas_();

  let existingLog = rosterLifecycleFindOperationLog_(operationId);
  if (existingLog) {
    if (existingLog.PayloadHash && existingLog.PayloadHash !== payloadHash) {
      throw DraftProtocol.fail('IDEMPOTENCY_MISMATCH');
    }
    if (existingLog.Status === 'CONFIRMED') {
      return JSON.parse(existingLog.ResultJson);
    }
    if (existingLog.Status === 'FAILED') {
      throw DraftProtocol.fail(existingLog.ErrorCode || 'PERMANENT_FAILURE');
    }
  }

  const periodRecord = rosterLifecycleFindPeriod_(periodId);
  if (!periodRecord) {
    throw DraftProtocol.fail('ENTITY_NOT_FOUND', { message: 'Period ' + periodId + ' not found or not enrolled' });
  }

  // 1. Validate person and directory type: MO only, EP excluded
  const people = rosterLifecycleGetPeople_();
  const person = people.find(function(p) { return p.PersonId === personId; });
  if (!person) {
    throw DraftProtocol.fail('INVALID_PERSON_IDENTITY', { message: 'Person ' + personId + ' does not exist in RosterPeople' });
  }
  if (person.DirectoryType === 'EP') {
    throw DraftProtocol.fail('EP_DOMAIN_EXCLUDED', { message: 'EP domain cannot earn entitlement credits' });
  }
  if (person.DirectoryType !== 'MO') {
    throw DraftProtocol.fail('EP_DOMAIN_EXCLUDED', { message: 'Only MO directory type can earn entitlement credits' });
  }
  const personNameSnapshot = person.CurrentDisplayName || person.MemberName || personId;

  // 2. Validate Planned snapshot existed and was OFF on this date
  const allAssignments = rosterLifecycleFindAssignmentsByPeriod_(periodId);
  const plannedAssignments = allAssignments.filter(function(r) { return r.Layer === 'PLANNED'; });
  DraftProtocol.ensure(plannedAssignments.length > 0, 'ENTITY_NOT_FOUND', { message: 'No Planned assignments found for period ' + periodId });

  const plannedOff = plannedAssignments.find(function(a) {
    return a.PersonId === personId && a.Date === date && a.DutyDomain === 'MO';
  });
  if (!plannedOff || plannedOff.ShiftCode !== 'OFF') {
    throw DraftProtocol.fail('NO_DISPLACED_OFF', {
      message: 'Person ' + personId + ' was not planned OFF on ' + date + ' (planned: ' + (plannedOff ? plannedOff.ShiftCode : 'NONE') + ')'
    });
  }

  // 3. Validate Current assignment is operational working duty displacing the OFF
  const confirmedEvents = rosterLifecycleFindConfirmedEventsByPeriod_(periodId, operationId);
  const confirmedAbsences = rosterLifecycleFindConfirmedAbsencesByPeriod_(periodId, operationId);
  const confirmedReplacements = rosterLifecycleFindConfirmedReplacementsByPeriod_(periodId, operationId);
  const confirmedEntitlements = rosterLifecycleFindConfirmedEntitlementsByPeriod_(periodId, operationId);

  const currentRoster = RosterLifecycle.resolveCurrentRoster({
    periodId: periodId,
    plannedAssignments: plannedAssignments,
    events: RosterLifecycle.groupEventLines(confirmedEvents.filter(function(r) { return r.OperationId !== operationId; })),
    absences: confirmedAbsences.filter(function(a) { return a.OperationId !== operationId && a.Status === 'ACTIVE'; }),
    replacements: confirmedReplacements.filter(function(r) { return r.OperationId !== operationId && r.Status === 'ACTIVE'; }),
    entitlements: confirmedEntitlements.filter(function(e) { return e.OperationId !== operationId && e.Status === 'CONFIRMED'; }),
    people: people,
    digestFn: rosterV2Digest_
  });

  const currentDuty = (currentRoster.currentAssignments || []).find(function(a) {
    return a.PersonId === personId && a.Date === date && a.DutyDomain === 'MO';
  });

  const nonWorkingShifts = ['OFF', 'MC', 'AL', 'EL', 'COURSE', 'HKA'];
  if (!currentDuty || nonWorkingShifts.includes(currentDuty.ShiftCode)) {
    throw DraftProtocol.fail('NO_DISPLACED_OFF', {
      message: 'Current assignment on ' + date + ' is not an operational working duty (shift: ' + (currentDuty ? currentDuty.ShiftCode : 'NONE') + ')'
    });
  }

  // 4. Duplicate credit check: deterministic SourceId
  const sourceId = 'displaced-off:' + periodId + ':' + personId + ':' + date;
  const existingRecords = rosterLifecycleGetRecords_('RosterEntitlementTransactions');
  const confirmedOpIds = rosterLifecycleGetConfirmedOperationIdsAll_();
  const confirmedReversals = new Set(
    existingRecords
      .filter(function(tx) {
        return tx.TransactionType === 'CREDIT_REVERSAL' &&
          tx.RelatedTransactionId &&
          (confirmedOpIds.has(tx.OperationId) || !tx.OperationId);
      })
      .map(function(tx) { return tx.RelatedTransactionId; })
  );
  const duplicateCredit = existingRecords.find(function(tx) {
    return tx.PersonId === personId &&
      tx.EffectiveDate === date &&
      tx.EntitlementType === 'GOFF' &&
      tx.SourceType === 'DISPLACED_WEEKLY_OFF' &&
      (confirmedOpIds.has(tx.OperationId) || !tx.OperationId) &&
      !confirmedReversals.has(tx.TransactionId);
  });
  if (duplicateCredit && duplicateCredit.OperationId !== operationId) {
    throw DraftProtocol.fail('DUPLICATE_CREDIT_SOURCE', {
      message: 'GOFF credit already exists for displaced off on ' + date + ' (TransactionId: ' + duplicateCredit.TransactionId + ')'
    });
  }

  // Critical recovery window check
  const existingForOp = existingRecords.find(function(tx) { return tx.OperationId === operationId; });
  if (existingForOp) {
    const result = {
      ok: true,
      operationId: operationId,
      transactionId: existingForOp.TransactionId,
      entitlementType: 'GOFF',
      personId: personId,
      amount: 1,
      effectiveDate: date,
      status: 'CONFIRMED',
      createdAt: existingForOp.CreatedAt || timestamp,
      createdBy: existingForOp.CreatedBy || actor
    };
    if (existingLog) {
      existingLog.Status = 'CONFIRMED';
      existingLog.ResultRevision = Number(periodRecord.Revision || 0);
      existingLog.ResultJson = JSON.stringify(result);
      existingLog.CompletedAt = timestamp;
      existingLog.ErrorCode = '';
      rosterLifecycleWriteLog_(existingLog);
    }
    return result;
  }

  // Journal PENDING
  if (!existingLog) {
    existingLog = {
      OperationId: operationId,
      ClientId: clientId,
      TabId: tabId,
      OperationType: 'ENTITLEMENT_EARN_GOFF',
      EntityKey: 'period:' + periodId,
      ExpectedRevision: Number(periodRecord.Revision || 0),
      ResultRevision: Number(periodRecord.Revision || 0),
      PayloadHash: payloadHash,
      Status: 'PENDING',
      ResultJson: '',
      ErrorCode: '',
      CreatedAt: timestamp,
      CompletedAt: ''
    };
    rosterLifecycleWriteLog_(existingLog);
    existingLog = rosterLifecycleFindOperationLog_(operationId);
  }

  let entityPersisted = false;
  try {
    const transactionId = 'etx-goff-' + rosterV2Digest_(operationId + ':' + personId + ':' + date).slice(0, 16);
    const transactionRecord = {
      TransactionId: transactionId,
      PeriodId: periodId,
      PersonId: personId,
      PersonNameSnapshot: personNameSnapshot,
      EntitlementType: 'GOFF',
      DutyDomain: 'MO',
      TransactionType: 'CREDIT_EARNED',
      Amount: 1,
      EffectiveDate: date,
      SourceType: 'DISPLACED_WEEKLY_OFF',
      SourceId: sourceId,
      SourceAssignmentId: currentDuty.AssignmentId || '',
      SourcePeriodId: periodId,
      PublicHolidayDate: '',
      PublicHolidayName: '',
      RosterAssignmentId: '',
      RelatedTransactionId: '',
      ReasonCode: 'DISPLACED_OFF_CREDIT',
      AdminNote: adminNote,
      ExpiresAt: '',
      ExpiryPolicyCode: '',
      Status: 'CONFIRMED',
      OperationId: operationId,
      CreatedAt: timestamp,
      CreatedBy: actor
    };

    rosterLifecycleAppendRows_('RosterEntitlementTransactions', [transactionRecord]);
    entityPersisted = true;

    const confirmedResult = {
      ok: true,
      operationId: operationId,
      transactionId: transactionId,
      entitlementType: 'GOFF',
      personId: personId,
      amount: 1,
      effectiveDate: date,
      status: 'CONFIRMED',
      createdAt: timestamp,
      createdBy: actor
    };

    existingLog.Status = 'CONFIRMED';
    existingLog.ResultRevision = Number(periodRecord.Revision || 0);
    existingLog.ResultJson = JSON.stringify(confirmedResult);
    existingLog.CompletedAt = new Date().toISOString();
    existingLog.ErrorCode = '';
    rosterLifecycleWriteLog_(existingLog);

    return confirmedResult;
  } catch (err) {
    if (existingLog) {
      existingLog.Status = entityPersisted ? 'RECOVERY_REQUIRED' : 'FAILED';
      existingLog.ErrorCode = err.code || (entityPersisted ? 'RECOVERY_REQUIRED' : 'VALIDATION_FAILED');
      existingLog.CompletedAt = new Date().toISOString();
      rosterLifecycleWriteLog_(existingLog);
    }
    throw err;
  }
}

function rosterLifecycleEntitlementEarnGhka_(data, actor) {
  const payloadMeaning = DraftProtocol.payload(Object.assign({}, data, {
    operationType: 'ENTITLEMENT_EARN_GHKA',
    expectedRevision: Number.isSafeInteger(data.expectedRevision) ? data.expectedRevision : 0,
    clientId: data.clientId || data.operationId,
    tabId: data.tabId || data.operationId
  }));
  const operationId = payloadMeaning.operationId;
  const clientId = payloadMeaning.clientId;
  const tabId = payloadMeaning.tabId;
  const periodId = payloadMeaning.payload.periodId;
  const personId = payloadMeaning.payload.personId;
  const date = payloadMeaning.payload.date || payloadMeaning.payload.holidayDate || payloadMeaning.payload.effectiveDate;
  const adminNote = payloadMeaning.payload.adminNote || '';
  const timestamp = data.timestamp || new Date().toISOString();

  if (!periodId) throw DraftProtocol.fail('VALIDATION_FAILED', { message: 'periodId is required' });
  if (!personId) throw DraftProtocol.fail('VALIDATION_FAILED', { message: 'personId is required' });
  if (!date) throw DraftProtocol.fail('VALIDATION_FAILED', { message: 'date is required' });

  const payloadHash = rosterV2Digest_(DraftProtocol.canonical(payloadMeaning));
  if (data.payloadHash && data.payloadHash !== payloadHash) {
    throw DraftProtocol.fail('IDEMPOTENCY_MISMATCH');
  }

  rosterLifecycleEnsureAllSchemas_();

  let existingLog = rosterLifecycleFindOperationLog_(operationId);
  if (existingLog) {
    if (existingLog.PayloadHash && existingLog.PayloadHash !== payloadHash) {
      throw DraftProtocol.fail('IDEMPOTENCY_MISMATCH');
    }
    if (existingLog.Status === 'CONFIRMED') {
      return JSON.parse(existingLog.ResultJson);
    }
    if (existingLog.Status === 'FAILED') {
      throw DraftProtocol.fail(existingLog.ErrorCode || 'PERMANENT_FAILURE');
    }
  }

  const periodRecord = rosterLifecycleFindPeriod_(periodId);
  if (!periodRecord) {
    throw DraftProtocol.fail('ENTITY_NOT_FOUND', { message: 'Period ' + periodId + ' not found or not enrolled' });
  }

  // 1. Validate person and directory type
  const people = rosterLifecycleGetPeople_();
  const person = people.find(function(p) { return p.PersonId === personId; });
  if (!person) {
    throw DraftProtocol.fail('INVALID_PERSON_IDENTITY', { message: 'Person ' + personId + ' does not exist in RosterPeople' });
  }
  if (person.DirectoryType === 'EP') {
    throw DraftProtocol.fail('EP_DOMAIN_EXCLUDED', { message: 'EP domain cannot earn entitlement credits' });
  }
  if (person.DirectoryType !== 'MO') {
    throw DraftProtocol.fail('EP_DOMAIN_EXCLUDED', { message: 'Only MO directory type can earn entitlement credits' });
  }
  const personNameSnapshot = person.CurrentDisplayName || person.MemberName || personId;

  // 2. Validate Public Holiday
  const holidayName = RosterEntitlement.getPublicHoliday(date);
  if (!holidayName) {
    throw DraftProtocol.fail('NOT_PUBLIC_HOLIDAY', { message: 'Date ' + date + ' is not a recognized gazetted public holiday' });
  }

  // 3. Validate Current assignment is qualifying holiday working duty
  const allAssignments = rosterLifecycleFindAssignmentsByPeriod_(periodId);
  const plannedAssignments = allAssignments.filter(function(r) { return r.Layer === 'PLANNED'; });
  DraftProtocol.ensure(plannedAssignments.length > 0, 'ENTITY_NOT_FOUND', { message: 'No Planned assignments found for period ' + periodId });

  const confirmedEvents = rosterLifecycleFindConfirmedEventsByPeriod_(periodId, operationId);
  const confirmedAbsences = rosterLifecycleFindConfirmedAbsencesByPeriod_(periodId, operationId);
  const confirmedReplacements = rosterLifecycleFindConfirmedReplacementsByPeriod_(periodId, operationId);
  const confirmedEntitlements = rosterLifecycleFindConfirmedEntitlementsByPeriod_(periodId, operationId);

  const currentRoster = RosterLifecycle.resolveCurrentRoster({
    periodId: periodId,
    plannedAssignments: plannedAssignments,
    events: RosterLifecycle.groupEventLines(confirmedEvents.filter(function(r) { return r.OperationId !== operationId; })),
    absences: confirmedAbsences.filter(function(a) { return a.OperationId !== operationId && a.Status === 'ACTIVE'; }),
    replacements: confirmedReplacements.filter(function(r) { return r.OperationId !== operationId && r.Status === 'ACTIVE'; }),
    entitlements: confirmedEntitlements.filter(function(e) { return e.OperationId !== operationId && e.Status === 'CONFIRMED'; }),
    people: people,
    digestFn: rosterV2Digest_
  });

  const currentDuty = (currentRoster.currentAssignments || []).find(function(a) {
    return a.PersonId === personId && a.Date === date && a.DutyDomain === 'MO';
  });

  if (!currentDuty || !RosterEntitlement.QUALIFYING_HOLIDAY_SHIFTS.includes(currentDuty.ShiftCode)) {
    throw DraftProtocol.fail('NOT_QUALIFYING_DUTY', {
      message: 'Person ' + personId + ' does not have a qualifying working duty on holiday ' + date + ' (shift: ' + (currentDuty ? currentDuty.ShiftCode : 'NONE') + ')'
    });
  }

  // 4. Max one GHKA per person per holiday date
  const sourceId = 'holiday-duty:' + date + ':' + personId;
  const existingRecords = rosterLifecycleGetRecords_('RosterEntitlementTransactions');
  const confirmedOpIds = rosterLifecycleGetConfirmedOperationIdsAll_();
  const confirmedReversals = new Set(
    existingRecords
      .filter(function(tx) {
        return tx.TransactionType === 'CREDIT_REVERSAL' &&
          tx.RelatedTransactionId &&
          (confirmedOpIds.has(tx.OperationId) || !tx.OperationId);
      })
      .map(function(tx) { return tx.RelatedTransactionId; })
  );
  const duplicateCredit = existingRecords.find(function(tx) {
    return tx.PersonId === personId &&
      tx.EffectiveDate === date &&
      tx.EntitlementType === 'GHKA' &&
      tx.SourceType === 'PUBLIC_HOLIDAY_DUTY' &&
      (confirmedOpIds.has(tx.OperationId) || !tx.OperationId) &&
      !confirmedReversals.has(tx.TransactionId);
  });
  if (duplicateCredit && duplicateCredit.OperationId !== operationId) {
    throw DraftProtocol.fail('DUPLICATE_CREDIT_SOURCE', {
      message: 'GHKA credit already exists for public holiday duty on ' + date + ' (TransactionId: ' + duplicateCredit.TransactionId + ')'
    });
  }

  // Critical recovery window check
  const existingForOp = existingRecords.find(function(tx) { return tx.OperationId === operationId; });
  if (existingForOp) {
    const result = {
      ok: true,
      operationId: operationId,
      transactionId: existingForOp.TransactionId,
      entitlementType: 'GHKA',
      personId: personId,
      amount: 1,
      effectiveDate: date,
      holidayName: holidayName,
      status: 'CONFIRMED',
      createdAt: existingForOp.CreatedAt || timestamp,
      createdBy: existingForOp.CreatedBy || actor
    };
    if (existingLog) {
      existingLog.Status = 'CONFIRMED';
      existingLog.ResultRevision = Number(periodRecord.Revision || 0);
      existingLog.ResultJson = JSON.stringify(result);
      existingLog.CompletedAt = timestamp;
      existingLog.ErrorCode = '';
      rosterLifecycleWriteLog_(existingLog);
    }
    return result;
  }

  // Journal PENDING
  if (!existingLog) {
    existingLog = {
      OperationId: operationId,
      ClientId: clientId,
      TabId: tabId,
      OperationType: 'ENTITLEMENT_EARN_GHKA',
      EntityKey: 'period:' + periodId,
      ExpectedRevision: Number(periodRecord.Revision || 0),
      ResultRevision: Number(periodRecord.Revision || 0),
      PayloadHash: payloadHash,
      Status: 'PENDING',
      ResultJson: '',
      ErrorCode: '',
      CreatedAt: timestamp,
      CompletedAt: ''
    };
    rosterLifecycleWriteLog_(existingLog);
    existingLog = rosterLifecycleFindOperationLog_(operationId);
  }

  let entityPersisted = false;
  try {
    const transactionId = 'etx-ghka-' + rosterV2Digest_(operationId + ':' + personId + ':' + date).slice(0, 16);
    const transactionRecord = {
      TransactionId: transactionId,
      PeriodId: periodId,
      PersonId: personId,
      PersonNameSnapshot: personNameSnapshot,
      EntitlementType: 'GHKA',
      DutyDomain: 'MO',
      TransactionType: 'CREDIT_EARNED',
      Amount: 1,
      EffectiveDate: date,
      SourceType: 'PUBLIC_HOLIDAY_DUTY',
      SourceId: sourceId,
      SourceAssignmentId: currentDuty.AssignmentId || '',
      SourcePeriodId: periodId,
      PublicHolidayDate: date,
      PublicHolidayName: holidayName,
      RosterAssignmentId: '',
      RelatedTransactionId: '',
      ReasonCode: 'HOLIDAY_DUTY_CREDIT',
      AdminNote: adminNote,
      ExpiresAt: '',
      ExpiryPolicyCode: '',
      Status: 'CONFIRMED',
      OperationId: operationId,
      CreatedAt: timestamp,
      CreatedBy: actor
    };

    rosterLifecycleAppendRows_('RosterEntitlementTransactions', [transactionRecord]);
    entityPersisted = true;

    const confirmedResult = {
      ok: true,
      operationId: operationId,
      transactionId: transactionId,
      entitlementType: 'GHKA',
      personId: personId,
      amount: 1,
      effectiveDate: date,
      holidayName: holidayName,
      status: 'CONFIRMED',
      createdAt: timestamp,
      createdBy: actor
    };

    existingLog.Status = 'CONFIRMED';
    existingLog.ResultRevision = Number(periodRecord.Revision || 0);
    existingLog.ResultJson = JSON.stringify(confirmedResult);
    existingLog.CompletedAt = new Date().toISOString();
    existingLog.ErrorCode = '';
    rosterLifecycleWriteLog_(existingLog);

    return confirmedResult;
  } catch (err) {
    if (existingLog) {
      existingLog.Status = entityPersisted ? 'RECOVERY_REQUIRED' : 'FAILED';
      existingLog.ErrorCode = err.code || (entityPersisted ? 'RECOVERY_REQUIRED' : 'VALIDATION_FAILED');
      existingLog.CompletedAt = new Date().toISOString();
      rosterLifecycleWriteLog_(existingLog);
    }
    throw err;
  }
}

function rosterLifecycleEntitlementCreditManual_(data, actor) {
  const payloadMeaning = DraftProtocol.payload(Object.assign({}, data, {
    operationType: 'ENTITLEMENT_CREDIT_MANUAL',
    expectedRevision: Number.isSafeInteger(data.expectedRevision) ? data.expectedRevision : 0,
    clientId: data.clientId || data.operationId,
    tabId: data.tabId || data.operationId
  }));
  const operationId = payloadMeaning.operationId;
  const clientId = payloadMeaning.clientId;
  const tabId = payloadMeaning.tabId;
  const periodId = payloadMeaning.payload.periodId;
  const personId = payloadMeaning.payload.personId;
  const entitlementType = String(payloadMeaning.payload.entitlementType || '').toUpperCase();
  const amount = Number(payloadMeaning.payload.amount !== undefined ? payloadMeaning.payload.amount : 1);
  const effectiveDate = payloadMeaning.payload.effectiveDate || payloadMeaning.payload.date;
  const reasonCode = String(payloadMeaning.payload.reasonCode || '').trim();
  const adminNote = String(payloadMeaning.payload.adminNote || '').trim();
  const timestamp = data.timestamp || new Date().toISOString();

  if (!personId) throw DraftProtocol.fail('VALIDATION_FAILED', { message: 'personId is required' });
  if (!periodId) throw DraftProtocol.fail('VALIDATION_FAILED', { message: 'periodId is required' });
  if (!effectiveDate) throw DraftProtocol.fail('VALIDATION_FAILED', { message: 'effectiveDate is required' });
  if (!reasonCode) throw DraftProtocol.fail('VALIDATION_FAILED', { message: 'reasonCode is required for manual adjustment' });
  if (!adminNote) throw DraftProtocol.fail('VALIDATION_FAILED', { message: 'adminNote is required for manual adjustment' });
  if (amount !== 1) throw DraftProtocol.fail('VALIDATION_FAILED', { message: 'amount must be positive integer +1' });

  if (entitlementType !== 'GOFF' && entitlementType !== 'GHKA') {
    throw DraftProtocol.fail('INVALID_ENTITLEMENT_TYPE', { message: 'Invalid EntitlementType: ' + entitlementType });
  }

  const payloadHash = rosterV2Digest_(DraftProtocol.canonical(payloadMeaning));
  if (data.payloadHash && data.payloadHash !== payloadHash) {
    throw DraftProtocol.fail('IDEMPOTENCY_MISMATCH');
  }

  rosterLifecycleEnsureAllSchemas_();

  let existingLog = rosterLifecycleFindOperationLog_(operationId);
  if (existingLog) {
    if (existingLog.PayloadHash && existingLog.PayloadHash !== payloadHash) {
      throw DraftProtocol.fail('IDEMPOTENCY_MISMATCH');
    }
    if (existingLog.Status === 'CONFIRMED') {
      return JSON.parse(existingLog.ResultJson);
    }
    if (existingLog.Status === 'FAILED') {
      throw DraftProtocol.fail(existingLog.ErrorCode || 'PERMANENT_FAILURE');
    }
  }

  const periodRecord = rosterLifecycleFindPeriod_(periodId);
  if (!periodRecord) {
    throw DraftProtocol.fail('ENTITY_NOT_FOUND', { message: 'Period ' + periodId + ' not found or not enrolled' });
  }

  const people = rosterLifecycleGetPeople_();
  const person = people.find(function(p) { return p.PersonId === personId; });
  if (!person) {
    throw DraftProtocol.fail('INVALID_PERSON_IDENTITY', { message: 'Person ' + personId + ' does not exist in RosterPeople' });
  }
  if (person.DirectoryType === 'EP') {
    throw DraftProtocol.fail('EP_DOMAIN_EXCLUDED', { message: 'EP domain cannot receive manual entitlement adjustments' });
  }
  if (person.DirectoryType !== 'MO') {
    throw DraftProtocol.fail('EP_DOMAIN_EXCLUDED', { message: 'Only MO directory type can receive manual entitlement adjustments' });
  }
  const personNameSnapshot = person.CurrentDisplayName || person.MemberName || personId;

  const existingRecords = rosterLifecycleGetRecords_('RosterEntitlementTransactions');
  const existingForOp = existingRecords.find(function(tx) { return tx.OperationId === operationId; });
  if (existingForOp) {
    const result = {
      ok: true,
      operationId: operationId,
      transactionId: existingForOp.TransactionId,
      entitlementType: entitlementType,
      personId: personId,
      amount: 1,
      effectiveDate: effectiveDate,
      reasonCode: reasonCode,
      status: 'CONFIRMED',
      createdAt: existingForOp.CreatedAt || timestamp,
      createdBy: existingForOp.CreatedBy || actor
    };
    if (existingLog) {
      existingLog.Status = 'CONFIRMED';
      existingLog.ResultRevision = Number(periodRecord.Revision || 0);
      existingLog.ResultJson = JSON.stringify(result);
      existingLog.CompletedAt = timestamp;
      existingLog.ErrorCode = '';
      rosterLifecycleWriteLog_(existingLog);
    }
    return result;
  }

  if (!existingLog) {
    existingLog = {
      OperationId: operationId,
      ClientId: clientId,
      TabId: tabId,
      OperationType: 'ENTITLEMENT_CREDIT_MANUAL',
      EntityKey: 'period:' + periodId,
      ExpectedRevision: Number(periodRecord.Revision || 0),
      ResultRevision: Number(periodRecord.Revision || 0),
      PayloadHash: payloadHash,
      Status: 'PENDING',
      ResultJson: '',
      ErrorCode: '',
      CreatedAt: timestamp,
      CompletedAt: ''
    };
    rosterLifecycleWriteLog_(existingLog);
    existingLog = rosterLifecycleFindOperationLog_(operationId);
  }

  let entityPersisted = false;
  try {
    const transactionId = 'etx-man-' + rosterV2Digest_(operationId + ':' + personId + ':' + effectiveDate).slice(0, 16);
    const transactionRecord = {
      TransactionId: transactionId,
      PeriodId: periodId,
      PersonId: personId,
      PersonNameSnapshot: personNameSnapshot,
      EntitlementType: entitlementType,
      DutyDomain: 'MO',
      TransactionType: 'CREDIT_MANUAL',
      Amount: 1,
      EffectiveDate: effectiveDate,
      SourceType: 'ADMIN_ADJUSTMENT',
      SourceId: 'manual:' + operationId,
      SourceAssignmentId: '',
      SourcePeriodId: periodId,
      PublicHolidayDate: '',
      PublicHolidayName: '',
      RosterAssignmentId: '',
      RelatedTransactionId: '',
      ReasonCode: reasonCode,
      AdminNote: adminNote,
      ExpiresAt: '',
      ExpiryPolicyCode: '',
      Status: 'CONFIRMED',
      OperationId: operationId,
      CreatedAt: timestamp,
      CreatedBy: actor
    };

    rosterLifecycleAppendRows_('RosterEntitlementTransactions', [transactionRecord]);
    entityPersisted = true;

    const confirmedResult = {
      ok: true,
      operationId: operationId,
      transactionId: transactionId,
      entitlementType: entitlementType,
      personId: personId,
      amount: 1,
      effectiveDate: effectiveDate,
      reasonCode: reasonCode,
      status: 'CONFIRMED',
      createdAt: timestamp,
      createdBy: actor
    };

    existingLog.Status = 'CONFIRMED';
    existingLog.ResultRevision = Number(periodRecord.Revision || 0);
    existingLog.ResultJson = JSON.stringify(confirmedResult);
    existingLog.CompletedAt = new Date().toISOString();
    existingLog.ErrorCode = '';
    rosterLifecycleWriteLog_(existingLog);

    return confirmedResult;
  } catch (err) {
    if (existingLog) {
      existingLog.Status = entityPersisted ? 'RECOVERY_REQUIRED' : 'FAILED';
      existingLog.ErrorCode = err.code || (entityPersisted ? 'RECOVERY_REQUIRED' : 'VALIDATION_FAILED');
      existingLog.CompletedAt = new Date().toISOString();
      rosterLifecycleWriteLog_(existingLog);
    }
    throw err;
  }
}

function rosterLifecycleEntitlementConsume_(data, actor) {
  const payloadMeaning = DraftProtocol.payload(Object.assign({}, data, {
    operationType: 'ENTITLEMENT_CONSUME',
    clientId: data.clientId || data.operationId,
    tabId: data.tabId || data.operationId
  }));
  const operationId = payloadMeaning.operationId;
  const clientId = payloadMeaning.clientId;
  const tabId = payloadMeaning.tabId;
  const periodId = payloadMeaning.payload.periodId;
  const personId = payloadMeaning.payload.personId;
  const entitlementType = String(payloadMeaning.payload.entitlementType || '').toUpperCase();
  const date = payloadMeaning.payload.date || payloadMeaning.payload.effectiveDate;
  const expectedRevision = payloadMeaning.expectedRevision;
  const adminNote = payloadMeaning.payload.adminNote || '';
  const timestamp = data.timestamp || new Date().toISOString();

  if (!periodId) throw DraftProtocol.fail('VALIDATION_FAILED', { message: 'periodId is required' });
  if (!personId) throw DraftProtocol.fail('VALIDATION_FAILED', { message: 'personId is required' });
  if (!date) throw DraftProtocol.fail('VALIDATION_FAILED', { message: 'date is required' });
  if (entitlementType !== 'GOFF' && entitlementType !== 'GHKA') {
    throw DraftProtocol.fail('INVALID_ENTITLEMENT_TYPE', { message: 'Invalid EntitlementType: ' + entitlementType });
  }

  const payloadHash = rosterV2Digest_(DraftProtocol.canonical(payloadMeaning));
  if (data.payloadHash && data.payloadHash !== payloadHash) {
    throw DraftProtocol.fail('IDEMPOTENCY_MISMATCH');
  }

  rosterLifecycleEnsureAllSchemas_();

  let existingLog = rosterLifecycleFindOperationLog_(operationId);
  if (existingLog) {
    if (existingLog.PayloadHash && existingLog.PayloadHash !== payloadHash) {
      throw DraftProtocol.fail('IDEMPOTENCY_MISMATCH');
    }
    if (existingLog.Status === 'CONFIRMED') {
      return JSON.parse(existingLog.ResultJson);
    }
    if (existingLog.Status === 'FAILED') {
      throw DraftProtocol.fail(existingLog.ErrorCode || 'PERMANENT_FAILURE');
    }
  }

  const periodRecord = rosterLifecycleFindPeriod_(periodId);
  if (!periodRecord) {
    throw DraftProtocol.fail('ENTITY_NOT_FOUND', { message: 'Period ' + periodId + ' not found or not enrolled' });
  }

  const currentState = String(periodRecord.State || '').toUpperCase();
  if (currentState !== 'PUBLISHED' && currentState !== 'AMENDED') {
    throw DraftProtocol.fail('INVALID_STATE', { message: 'Period ' + periodId + ' in state ' + currentState + ' cannot receive entitlement consumption; must be PUBLISHED or AMENDED' });
  }

  const currentRevision = Number(periodRecord.Revision || 0);

  if (periodRecord.LastOperationId === operationId) {
    let result = null;
    if (existingLog && existingLog.ResultJson) {
      try { result = JSON.parse(existingLog.ResultJson); } catch (_) {}
    }
    if (!result) {
      const records = rosterLifecycleGetRecords_('RosterEntitlementTransactions');
      const targetCons = records.find(function(tx) { return tx.OperationId === operationId; });
      result = {
        ok: true,
        operationId: operationId,
        periodId: periodId,
        state: periodRecord.State,
        revision: currentRevision,
        transactionId: targetCons ? targetCons.TransactionId : '',
        entitlementType: entitlementType,
        date: date,
        projectionChecksum: periodRecord.ProjectionChecksum,
        consumedAt: targetCons ? targetCons.CreatedAt : timestamp,
        consumedBy: targetCons ? targetCons.CreatedBy : actor
      };
    }
    if (existingLog) {
      existingLog.Status = 'CONFIRMED';
      existingLog.ResultRevision = currentRevision;
      existingLog.ResultJson = JSON.stringify(result);
      existingLog.CompletedAt = periodRecord.UpdatedAt || timestamp;
      existingLog.ErrorCode = '';
      rosterLifecycleWriteLog_(existingLog);
    }
    return result;
  }

  if (expectedRevision !== currentRevision) {
    throw DraftProtocol.fail('REVISION_CONFLICT', {
      entityKey: 'period:' + periodId,
      currentRevision: currentRevision,
      expectedRevision: expectedRevision
    });
  }

  // 1. Validate person in RosterPeople
  const people = rosterLifecycleGetPeople_();
  const person = people.find(function(p) { return p.PersonId === personId; });
  if (!person) {
    throw DraftProtocol.fail('INVALID_PERSON_IDENTITY', { message: 'Person ' + personId + ' does not exist in RosterPeople' });
  }
  if (person.DirectoryType === 'EP') {
    throw DraftProtocol.fail('EP_DOMAIN_EXCLUDED', { message: 'EP domain cannot consume entitlement credits' });
  }
  if (person.DirectoryType !== 'MO') {
    throw DraftProtocol.fail('EP_DOMAIN_EXCLUDED', { message: 'Only MO directory type can consume entitlement credits' });
  }
  const personNameSnapshot = person.CurrentDisplayName || person.MemberName || personId;

  // 2. Validate separate balance: Section 11 & 12
  const confirmedTx = rosterLifecycleFindAllConfirmedEntitlementsByPerson_(personId, operationId);
  const bal = RosterEntitlement.deriveEntitlementBalance(
    confirmedTx.filter(function(tx) { return tx.OperationId !== operationId; }),
    personId,
    entitlementType
  );
  if (bal.currentBalance < 1) {
    if (entitlementType === 'GOFF') {
      throw DraftProtocol.fail('INSUFFICIENT_GOFF_BALANCE', {
        message: 'Insufficient GOFF balance (' + bal.currentBalance + '); cannot consume GOFF even if GHKA is available'
      });
    } else {
      throw DraftProtocol.fail('INSUFFICIENT_GHKA_BALANCE', {
        message: 'Insufficient GHKA balance (' + bal.currentBalance + '); cannot consume GHKA even if GOFF is available'
      });
    }
  }

  // 3. Operational conflict checks on date
  const allAssignments = rosterLifecycleFindAssignmentsByPeriod_(periodId);
  const plannedAssignments = allAssignments.filter(function(r) { return r.Layer === 'PLANNED'; });
  DraftProtocol.ensure(plannedAssignments.length > 0, 'ENTITY_NOT_FOUND', { message: 'No Planned assignments found for period ' + periodId });

  const confirmedEvents = rosterLifecycleFindConfirmedEventsByPeriod_(periodId, operationId);
  const priorEvents = RosterLifecycle.groupEventLines(confirmedEvents.filter(function(r) { return r.OperationId !== operationId; }));
  const confirmedAbsences = rosterLifecycleFindConfirmedAbsencesByPeriod_(periodId, operationId);
  const priorAbsences = confirmedAbsences.filter(function(a) { return a.OperationId !== operationId && a.Status === 'ACTIVE'; });
  const confirmedReplacements = rosterLifecycleFindConfirmedReplacementsByPeriod_(periodId, operationId);
  const priorReplacements = confirmedReplacements.filter(function(r) { return r.OperationId !== operationId && r.Status === 'ACTIVE'; });
  const confirmedEntitlements = rosterLifecycleFindConfirmedEntitlementsByPeriod_(periodId, operationId);
  const priorEntitlements = confirmedEntitlements.filter(function(e) { return e.OperationId !== operationId && e.Status === 'CONFIRMED'; });

  const authoritativeBefore = RosterLifecycle.resolveCurrentRoster({
    periodId: periodId,
    plannedAssignments: plannedAssignments,
    events: priorEvents,
    absences: priorAbsences,
    replacements: priorReplacements,
    entitlements: priorEntitlements,
    people: people,
    digestFn: rosterV2Digest_
  });

  const hasAbsence = (authoritativeBefore.currentAssignments || []).some(function(a) {
    return a.PersonId === personId && a.Date === date && a.DutyDomain === 'MO' && a.Source === 'ABSENCE';
  });
  if (hasAbsence) {
    throw DraftProtocol.fail('INCOMPATIBLE_OPERATIONAL_STATUS', {
      message: 'Cannot consume ' + entitlementType + ' on ' + date + ': Doctor has an active absence (MC/AL/EL/COURSE) on this date.'
    });
  }

  const alreadyConsumed = (authoritativeBefore.currentAssignments || []).some(function(a) {
    return a.PersonId === personId && a.Date === date && a.DutyDomain === 'MO' && (a.Source === 'GOFF' || a.Source === 'GHKA');
  });
  if (alreadyConsumed) {
    throw DraftProtocol.fail('INCOMPATIBLE_OPERATIONAL_STATUS', {
      message: 'Cannot consume ' + entitlementType + ' on ' + date + ': Date already has an active entitlement consumption.'
    });
  }

  const targetCurrentDuty = (authoritativeBefore.currentAssignments || []).find(function(a) {
    return a.PersonId === personId && a.Date === date && a.DutyDomain === 'MO';
  });
  if (!targetCurrentDuty || targetCurrentDuty.ShiftCode === 'OFF') {
    throw DraftProtocol.fail('INVALID_ASSIGNMENT', {
      message: 'Cannot consume ' + entitlementType + ' on a scheduled OFF date (' + date + ')'
    });
  }

  // Journal PENDING
  if (!existingLog) {
    existingLog = {
      OperationId: operationId,
      ClientId: clientId,
      TabId: tabId,
      OperationType: 'ENTITLEMENT_CONSUME',
      EntityKey: 'period:' + periodId,
      ExpectedRevision: expectedRevision,
      ResultRevision: currentRevision + 1,
      PayloadHash: payloadHash,
      Status: 'PENDING',
      ResultJson: '',
      ErrorCode: '',
      CreatedAt: timestamp,
      CompletedAt: ''
    };
    rosterLifecycleWriteLog_(existingLog);
    existingLog = rosterLifecycleFindOperationLog_(operationId);
  }

  let entityPersisted = false;
  try {
    const transactionId = 'etx-cons-' + rosterV2Digest_(operationId + ':' + personId + ':' + date).slice(0, 16);
    const txType = entitlementType === 'GOFF' ? 'GOFF_CONSUMED' : 'GHKA_CONSUMED';
    const consumptionRecord = {
      TransactionId: transactionId,
      PeriodId: periodId,
      PersonId: personId,
      PersonNameSnapshot: personNameSnapshot,
      EntitlementType: entitlementType,
      DutyDomain: 'MO',
      TransactionType: txType,
      Amount: -1,
      EffectiveDate: date,
      SourceType: 'ROSTER_ASSIGNMENT',
      SourceId: targetCurrentDuty.AssignmentId || '',
      SourceAssignmentId: targetCurrentDuty.AssignmentId || '',
      SourcePeriodId: periodId,
      PublicHolidayDate: '',
      PublicHolidayName: '',
      RosterAssignmentId: targetCurrentDuty.AssignmentId || '',
      RelatedTransactionId: '',
      ReasonCode: entitlementType + '_CONSUMPTION',
      AdminNote: adminNote,
      ExpiresAt: '',
      ExpiryPolicyCode: '',
      Status: 'CONFIRMED',
      OperationId: operationId,
      CreatedAt: timestamp,
      CreatedBy: actor
    };

    const existingRecords = rosterLifecycleGetRecords_('RosterEntitlementTransactions');
    const existingCons = existingRecords.find(function(tx) { return tx.TransactionId === transactionId || tx.OperationId === operationId; });
    if (!existingCons) {
      rosterLifecycleAppendRows_('RosterEntitlementTransactions', [consumptionRecord]);
    }
    entityPersisted = true;

    const intendedEntitlements = priorEntitlements.concat([consumptionRecord]);
    const intendedCurrent = RosterLifecycle.resolveCurrentRoster({
      periodId: periodId,
      plannedAssignments: plannedAssignments,
      events: priorEvents,
      absences: priorAbsences,
      replacements: priorReplacements,
      entitlements: intendedEntitlements,
      people: people,
      digestFn: rosterV2Digest_
    });

    const projectedRows = intendedCurrent.masterRosterProjection || RosterLifecycle.generateMasterRosterProjection(intendedCurrent.currentAssignments || []);
    const masterTable = rosterV2ReadTable_('MasterRoster');
    const existingMasterRows = masterTable.exists ? rosterV2Records_(masterTable, ['Name', 'Date', 'Shift'], true) : [];
    const mergeResult = RosterLifecycle.mergeMasterRosterProjection(existingMasterRows, periodId, projectedRows);
    rosterLifecycleWriteMasterRoster_(mergeResult.mergedRows);

    const readbackTable = rosterV2ReadTable_('MasterRoster');
    const readbackRows = rosterV2Records_(readbackTable, ['Name', 'Date', 'Shift'], true);
    const targetMonthPersistedRows = readbackRows.filter(function(r) {
      const ld = RosterCompatibility.localDate(r.Date);
      return ld && ld.slice(0, 7) === periodId;
    });

    const actualChecksum = RosterLifecycle.computeProjectionChecksum(targetMonthPersistedRows, rosterV2Digest_);
    const expectedChecksum = RosterLifecycle.computeProjectionChecksum(projectedRows, rosterV2Digest_);

    if (actualChecksum !== expectedChecksum) {
      existingLog.Status = 'RECOVERY_REQUIRED';
      existingLog.ErrorCode = 'CHECKSUM_MISMATCH';
      rosterLifecycleWriteLog_(existingLog);
      throw DraftProtocol.fail('CHECKSUM_MISMATCH', { actual: actualChecksum, expected: expectedChecksum });
    }

    const targetRevision = currentRevision + 1;
    const targetState = 'AMENDED';
    const updatedPeriod = Object.assign({}, periodRecord, {
      State: targetState,
      Revision: targetRevision,
      ProjectionChecksum: actualChecksum,
      LastOperationId: operationId,
      UpdatedAt: timestamp
    });
    rosterLifecycleWriteRow_('RosterPeriods', updatedPeriod, periodRecord._row);

    const confirmedResult = {
      ok: true,
      operationId: operationId,
      periodId: periodId,
      state: targetState,
      revision: targetRevision,
      transactionId: transactionId,
      entitlementType: entitlementType,
      date: date,
      projectionChecksum: actualChecksum,
      consumedAt: timestamp,
      consumedBy: actor
    };
    existingLog.Status = 'CONFIRMED';
    existingLog.ResultRevision = targetRevision;
    existingLog.ResultJson = JSON.stringify(confirmedResult);
    existingLog.CompletedAt = new Date().toISOString();
    existingLog.ErrorCode = '';
    rosterLifecycleWriteLog_(existingLog);

    return confirmedResult;
  } catch (err) {
    if (existingLog) {
      existingLog.Status = entityPersisted ? 'RECOVERY_REQUIRED' : 'FAILED';
      existingLog.ErrorCode = err.code || (entityPersisted ? 'RECOVERY_REQUIRED' : 'VALIDATION_FAILED');
      existingLog.CompletedAt = new Date().toISOString();
      rosterLifecycleWriteLog_(existingLog);
    }
    throw err;
  }
}

function rosterLifecycleEntitlementCreditReverse_(data, actor) {
  const payloadMeaning = DraftProtocol.payload(Object.assign({}, data, {
    operationType: 'ENTITLEMENT_CREDIT_REVERSAL',
    expectedRevision: Number.isSafeInteger(data.expectedRevision) ? data.expectedRevision : 0,
    clientId: data.clientId || data.operationId,
    tabId: data.tabId || data.operationId
  }));
  const operationId = payloadMeaning.operationId;
  const clientId = payloadMeaning.clientId;
  const tabId = payloadMeaning.tabId;
  const periodId = payloadMeaning.payload.periodId || data.periodId;
  const transactionId = payloadMeaning.payload.transactionId || data.transactionId;
  const adminNote = payloadMeaning.payload.adminNote || '';
  const timestamp = data.timestamp || new Date().toISOString();

  if (!transactionId) throw DraftProtocol.fail('VALIDATION_FAILED', { message: 'transactionId is required' });

  const payloadHash = rosterV2Digest_(DraftProtocol.canonical(payloadMeaning));
  if (data.payloadHash && data.payloadHash !== payloadHash) {
    throw DraftProtocol.fail('IDEMPOTENCY_MISMATCH');
  }

  rosterLifecycleEnsureAllSchemas_();

  let existingLog = rosterLifecycleFindOperationLog_(operationId);
  if (existingLog) {
    if (existingLog.PayloadHash && existingLog.PayloadHash !== payloadHash) {
      throw DraftProtocol.fail('IDEMPOTENCY_MISMATCH');
    }
    if (existingLog.Status === 'CONFIRMED') {
      return JSON.parse(existingLog.ResultJson);
    }
    if (existingLog.Status === 'FAILED') {
      throw DraftProtocol.fail(existingLog.ErrorCode || 'PERMANENT_FAILURE');
    }
  }

  const allRecords = rosterLifecycleGetRecords_('RosterEntitlementTransactions');
  const targetTx = allRecords.find(function(tx) { return tx.TransactionId === transactionId; });
  if (!targetTx) {
    throw DraftProtocol.fail('TRANSACTION_NOT_FOUND', { message: 'Transaction ' + transactionId + ' not found' });
  }

  const isCredit = (targetTx.TransactionType === 'CREDIT_EARNED' || targetTx.TransactionType === 'CREDIT_MANUAL');
  if (!isCredit) {
    throw DraftProtocol.fail('VALIDATION_FAILED', { message: 'Transaction ' + transactionId + ' is not an earned or manual credit' });
  }

  const alreadyReversed = allRecords.some(function(tx) {
    return tx.TransactionType === 'CREDIT_REVERSAL' && tx.RelatedTransactionId === transactionId && tx.Status === 'CONFIRMED';
  });
  if (alreadyReversed) {
    throw DraftProtocol.fail('TRANSACTION_ALREADY_REVERSED', { message: 'Transaction ' + transactionId + ' is already reversed' });
  }

  const existingForOp = allRecords.find(function(tx) { return tx.OperationId === operationId; });
  if (existingForOp) {
    const result = {
      ok: true,
      operationId: operationId,
      reversalTransactionId: existingForOp.TransactionId,
      targetTransactionId: transactionId,
      entitlementType: targetTx.EntitlementType,
      status: 'CONFIRMED',
      reversedAt: existingForOp.CreatedAt || timestamp,
      reversedBy: existingForOp.CreatedBy || actor
    };
    if (existingLog) {
      existingLog.Status = 'CONFIRMED';
      existingLog.ResultJson = JSON.stringify(result);
      existingLog.CompletedAt = timestamp;
      existingLog.ErrorCode = '';
      rosterLifecycleWriteLog_(existingLog);
    }
    return result;
  }

  // Section 15: dependent consumption check & cross-entitlement boundaries
  const directlyDependentCons = allRecords.find(function(tx) {
    return tx.RelatedTransactionId === transactionId &&
      (tx.TransactionType === 'GOFF_CONSUMED' || tx.TransactionType === 'GHKA_CONSUMED' || tx.TransactionType === 'ENTITLEMENT_CONSUMED') &&
      tx.Status === 'CONFIRMED';
  });
  if (directlyDependentCons) {
    if (directlyDependentCons.EntitlementType !== targetTx.EntitlementType) {
      throw DraftProtocol.fail('CROSS_ENTITLEMENT_DEPENDENCY_FORBIDDEN', {
        message: 'Cross-entitlement dependency conflict: ' + directlyDependentCons.EntitlementType + ' consumption cannot depend on ' + targetTx.EntitlementType + ' credit'
      });
    }
    throw DraftProtocol.fail('DEPENDENT_CONSUMPTION_EXISTS', {
      message: 'Cannot reverse ' + targetTx.EntitlementType + ' credit ' + transactionId + ': Dependent consumption ' + directlyDependentCons.TransactionId + ' must be reversed first'
    });
  }

  const confirmedForPerson = rosterLifecycleFindAllConfirmedEntitlementsByPerson_(targetTx.PersonId, operationId);
  const currentBal = RosterEntitlement.deriveEntitlementBalance(
    confirmedForPerson.filter(function(tx) { return tx.OperationId !== operationId; }),
    targetTx.PersonId,
    targetTx.EntitlementType
  );
  if (currentBal.currentBalance < 1) {
    throw DraftProtocol.fail('DEPENDENT_CONSUMPTION_EXISTS', {
      message: 'Cannot reverse ' + targetTx.EntitlementType + ' credit: Current balance (' + currentBal.currentBalance + ') is insufficient; dependent consumption exists'
    });
  }

  // Journal PENDING
  if (!existingLog) {
    existingLog = {
      OperationId: operationId,
      ClientId: clientId,
      TabId: tabId,
      OperationType: 'ENTITLEMENT_CREDIT_REVERSAL',
      EntityKey: 'period:' + (targetTx.PeriodId || periodId || ''),
      ExpectedRevision: 0,
      ResultRevision: 0,
      PayloadHash: payloadHash,
      Status: 'PENDING',
      ResultJson: '',
      ErrorCode: '',
      CreatedAt: timestamp,
      CompletedAt: ''
    };
    rosterLifecycleWriteLog_(existingLog);
    existingLog = rosterLifecycleFindOperationLog_(operationId);
  }

  let entityPersisted = false;
  try {
    const reversalId = 'etx-rev-' + rosterV2Digest_(operationId + ':' + transactionId).slice(0, 16);
    const reversalRecord = {
      TransactionId: reversalId,
      PeriodId: targetTx.PeriodId || periodId || '',
      PersonId: targetTx.PersonId,
      PersonNameSnapshot: targetTx.PersonNameSnapshot || '',
      EntitlementType: targetTx.EntitlementType,
      DutyDomain: targetTx.DutyDomain || 'MO',
      TransactionType: 'CREDIT_REVERSAL',
      Amount: -1,
      EffectiveDate: targetTx.EffectiveDate,
      SourceType: targetTx.SourceType,
      SourceId: transactionId,
      SourceAssignmentId: targetTx.SourceAssignmentId || '',
      SourcePeriodId: targetTx.SourcePeriodId || targetTx.PeriodId || '',
      PublicHolidayDate: targetTx.PublicHolidayDate || '',
      PublicHolidayName: targetTx.PublicHolidayName || '',
      RosterAssignmentId: '',
      RelatedTransactionId: transactionId,
      ReasonCode: 'CREDIT_REVERSAL',
      AdminNote: adminNote,
      ExpiresAt: '',
      ExpiryPolicyCode: '',
      Status: 'CONFIRMED',
      OperationId: operationId,
      CreatedAt: timestamp,
      CreatedBy: actor
    };

    rosterLifecycleAppendRows_('RosterEntitlementTransactions', [reversalRecord]);
    entityPersisted = true;

    const confirmedResult = {
      ok: true,
      operationId: operationId,
      reversalTransactionId: reversalId,
      targetTransactionId: transactionId,
      entitlementType: targetTx.EntitlementType,
      personId: targetTx.PersonId,
      amount: -1,
      status: 'CONFIRMED',
      reversedAt: timestamp,
      reversedBy: actor
    };

    existingLog.Status = 'CONFIRMED';
    existingLog.ResultJson = JSON.stringify(confirmedResult);
    existingLog.CompletedAt = new Date().toISOString();
    existingLog.ErrorCode = '';
    rosterLifecycleWriteLog_(existingLog);

    return confirmedResult;
  } catch (err) {
    if (existingLog) {
      existingLog.Status = entityPersisted ? 'RECOVERY_REQUIRED' : 'FAILED';
      existingLog.ErrorCode = err.code || (entityPersisted ? 'RECOVERY_REQUIRED' : 'VALIDATION_FAILED');
      existingLog.CompletedAt = new Date().toISOString();
      rosterLifecycleWriteLog_(existingLog);
    }
    throw err;
  }
}

function rosterLifecycleEntitlementConsumeReverse_(data, actor) {
  const payloadMeaning = DraftProtocol.payload(Object.assign({}, data, {
    operationType: 'ENTITLEMENT_CONSUMPTION_REVERSAL',
    clientId: data.clientId || data.operationId,
    tabId: data.tabId || data.operationId
  }));
  const operationId = payloadMeaning.operationId;
  const clientId = payloadMeaning.clientId;
  const tabId = payloadMeaning.tabId;
  const periodId = payloadMeaning.payload.periodId || data.periodId;
  const transactionId = payloadMeaning.payload.transactionId || data.transactionId;
  const expectedRevision = payloadMeaning.expectedRevision;
  const adminNote = payloadMeaning.payload.adminNote || '';
  const timestamp = data.timestamp || new Date().toISOString();

  if (!transactionId) throw DraftProtocol.fail('VALIDATION_FAILED', { message: 'transactionId is required' });
  if (!periodId) throw DraftProtocol.fail('VALIDATION_FAILED', { message: 'periodId is required' });

  const payloadHash = rosterV2Digest_(DraftProtocol.canonical(payloadMeaning));
  if (data.payloadHash && data.payloadHash !== payloadHash) {
    throw DraftProtocol.fail('IDEMPOTENCY_MISMATCH');
  }

  rosterLifecycleEnsureAllSchemas_();

  let existingLog = rosterLifecycleFindOperationLog_(operationId);
  if (existingLog) {
    if (existingLog.PayloadHash && existingLog.PayloadHash !== payloadHash) {
      throw DraftProtocol.fail('IDEMPOTENCY_MISMATCH');
    }
    if (existingLog.Status === 'CONFIRMED') {
      return JSON.parse(existingLog.ResultJson);
    }
    if (existingLog.Status === 'FAILED') {
      throw DraftProtocol.fail(existingLog.ErrorCode || 'PERMANENT_FAILURE');
    }
  }

  const periodRecord = rosterLifecycleFindPeriod_(periodId);
  if (!periodRecord) {
    throw DraftProtocol.fail('ENTITY_NOT_FOUND', { message: 'Period ' + periodId + ' not found or not enrolled' });
  }

  const currentState = String(periodRecord.State || '').toUpperCase();
  if (currentState !== 'PUBLISHED' && currentState !== 'AMENDED') {
    throw DraftProtocol.fail('INVALID_STATE', { message: 'Period ' + periodId + ' in state ' + currentState + ' cannot receive consumption reversal; must be PUBLISHED or AMENDED' });
  }

  const currentRevision = Number(periodRecord.Revision || 0);

  if (periodRecord.LastOperationId === operationId) {
    let result = null;
    if (existingLog && existingLog.ResultJson) {
      try { result = JSON.parse(existingLog.ResultJson); } catch (_) {}
    }
    if (!result) {
      const records = rosterLifecycleGetRecords_('RosterEntitlementTransactions');
      const targetRev = records.find(function(tx) { return tx.OperationId === operationId; });
      result = {
        ok: true,
        operationId: operationId,
        periodId: periodId,
        state: periodRecord.State,
        revision: currentRevision,
        reversalTransactionId: targetRev ? targetRev.TransactionId : '',
        targetTransactionId: transactionId,
        projectionChecksum: periodRecord.ProjectionChecksum,
        reversedAt: targetRev ? targetRev.CreatedAt : timestamp,
        reversedBy: targetRev ? targetRev.CreatedBy : actor
      };
    }
    if (existingLog) {
      existingLog.Status = 'CONFIRMED';
      existingLog.ResultRevision = currentRevision;
      existingLog.ResultJson = JSON.stringify(result);
      existingLog.CompletedAt = periodRecord.UpdatedAt || timestamp;
      existingLog.ErrorCode = '';
      rosterLifecycleWriteLog_(existingLog);
    }
    return result;
  }

  if (expectedRevision !== currentRevision) {
    throw DraftProtocol.fail('REVISION_CONFLICT', {
      entityKey: 'period:' + periodId,
      currentRevision: currentRevision,
      expectedRevision: expectedRevision
    });
  }

  const allRecords = rosterLifecycleGetRecords_('RosterEntitlementTransactions');
  const targetTx = allRecords.find(function(tx) { return tx.TransactionId === transactionId; });
  if (!targetTx) {
    throw DraftProtocol.fail('TRANSACTION_NOT_FOUND', { message: 'Transaction ' + transactionId + ' not found' });
  }

  const isConsumption = (targetTx.TransactionType === 'GOFF_CONSUMED' || targetTx.TransactionType === 'GHKA_CONSUMED' || targetTx.TransactionType === 'ENTITLEMENT_CONSUMED');
  if (!isConsumption) {
    throw DraftProtocol.fail('VALIDATION_FAILED', { message: 'Transaction ' + transactionId + ' is not a consumption' });
  }

  const alreadyReversed = allRecords.some(function(tx) {
    return tx.TransactionType === 'CONSUMPTION_REVERSAL' && tx.RelatedTransactionId === transactionId && tx.Status === 'CONFIRMED';
  });
  if (alreadyReversed) {
    throw DraftProtocol.fail('TRANSACTION_ALREADY_REVERSED', { message: 'Transaction ' + transactionId + ' is already reversed' });
  }

  // Journal PENDING
  if (!existingLog) {
    existingLog = {
      OperationId: operationId,
      ClientId: clientId,
      TabId: tabId,
      OperationType: 'ENTITLEMENT_CONSUMPTION_REVERSAL',
      EntityKey: 'period:' + periodId,
      ExpectedRevision: expectedRevision,
      ResultRevision: currentRevision + 1,
      PayloadHash: payloadHash,
      Status: 'PENDING',
      ResultJson: '',
      ErrorCode: '',
      CreatedAt: timestamp,
      CompletedAt: ''
    };
    rosterLifecycleWriteLog_(existingLog);
    existingLog = rosterLifecycleFindOperationLog_(operationId);
  }

  let entityPersisted = false;
  try {
    const reversalId = 'etx-rev-' + rosterV2Digest_(operationId + ':' + transactionId).slice(0, 16);
    const reversalRecord = {
      TransactionId: reversalId,
      PeriodId: periodId,
      PersonId: targetTx.PersonId,
      PersonNameSnapshot: targetTx.PersonNameSnapshot || '',
      EntitlementType: targetTx.EntitlementType,
      DutyDomain: targetTx.DutyDomain || 'MO',
      TransactionType: 'CONSUMPTION_REVERSAL',
      Amount: 1,
      EffectiveDate: targetTx.EffectiveDate,
      SourceType: targetTx.SourceType,
      SourceId: transactionId,
      SourceAssignmentId: targetTx.SourceAssignmentId || '',
      SourcePeriodId: periodId,
      PublicHolidayDate: '',
      PublicHolidayName: '',
      RosterAssignmentId: targetTx.RosterAssignmentId || '',
      RelatedTransactionId: transactionId,
      ReasonCode: 'CONSUMPTION_REVERSAL',
      AdminNote: adminNote,
      ExpiresAt: '',
      ExpiryPolicyCode: '',
      Status: 'CONFIRMED',
      OperationId: operationId,
      CreatedAt: timestamp,
      CreatedBy: actor
    };

    rosterLifecycleAppendRows_('RosterEntitlementTransactions', [reversalRecord]);
    entityPersisted = true;

    const allAssignments = rosterLifecycleFindAssignmentsByPeriod_(periodId);
    const plannedAssignments = allAssignments.filter(function(r) { return r.Layer === 'PLANNED'; });
    DraftProtocol.ensure(plannedAssignments.length > 0, 'ENTITY_NOT_FOUND', { message: 'No Planned assignments found for period ' + periodId });

    const confirmedEvents = rosterLifecycleFindConfirmedEventsByPeriod_(periodId, operationId);
    const priorEvents = RosterLifecycle.groupEventLines(confirmedEvents.filter(function(r) { return r.OperationId !== operationId; }));
    const confirmedAbsences = rosterLifecycleFindConfirmedAbsencesByPeriod_(periodId, operationId);
    const priorAbsences = confirmedAbsences.filter(function(a) { return a.OperationId !== operationId && a.Status === 'ACTIVE'; });
    const confirmedReplacements = rosterLifecycleFindConfirmedReplacementsByPeriod_(periodId, operationId);
    const priorReplacements = confirmedReplacements.filter(function(r) { return r.OperationId !== operationId && r.Status === 'ACTIVE'; });
    const confirmedEntitlements = rosterLifecycleFindConfirmedEntitlementsByPeriod_(periodId, operationId);
    const people = rosterLifecycleGetPeople_();

    const intendedEntitlements = confirmedEntitlements.concat([reversalRecord]);
    const intendedCurrent = RosterLifecycle.resolveCurrentRoster({
      periodId: periodId,
      plannedAssignments: plannedAssignments,
      events: priorEvents,
      absences: priorAbsences,
      replacements: priorReplacements,
      entitlements: intendedEntitlements,
      people: people,
      digestFn: rosterV2Digest_
    });

    const projectedRows = intendedCurrent.masterRosterProjection || RosterLifecycle.generateMasterRosterProjection(intendedCurrent.currentAssignments || []);
    const masterTable = rosterV2ReadTable_('MasterRoster');
    const existingMasterRows = masterTable.exists ? rosterV2Records_(masterTable, ['Name', 'Date', 'Shift'], true) : [];
    const mergeResult = RosterLifecycle.mergeMasterRosterProjection(existingMasterRows, periodId, projectedRows);
    rosterLifecycleWriteMasterRoster_(mergeResult.mergedRows);

    const readbackTable = rosterV2ReadTable_('MasterRoster');
    const readbackRows = rosterV2Records_(readbackTable, ['Name', 'Date', 'Shift'], true);
    const targetMonthPersistedRows = readbackRows.filter(function(r) {
      const ld = RosterCompatibility.localDate(r.Date);
      return ld && ld.slice(0, 7) === periodId;
    });

    const actualChecksum = RosterLifecycle.computeProjectionChecksum(targetMonthPersistedRows, rosterV2Digest_);
    const expectedChecksum = RosterLifecycle.computeProjectionChecksum(projectedRows, rosterV2Digest_);

    if (actualChecksum !== expectedChecksum) {
      existingLog.Status = 'RECOVERY_REQUIRED';
      existingLog.ErrorCode = 'CHECKSUM_MISMATCH';
      rosterLifecycleWriteLog_(existingLog);
      throw DraftProtocol.fail('CHECKSUM_MISMATCH', { actual: actualChecksum, expected: expectedChecksum });
    }

    const targetState = intendedCurrent.effectiveState || 'PUBLISHED';
    const targetRevision = currentRevision + 1;

    const updatedPeriod = Object.assign({}, periodRecord, {
      State: targetState,
      Revision: targetRevision,
      ProjectionChecksum: actualChecksum,
      LastOperationId: operationId,
      UpdatedAt: timestamp
    });
    rosterLifecycleWriteRow_('RosterPeriods', updatedPeriod, periodRecord._row);

    const confirmedResult = {
      ok: true,
      operationId: operationId,
      periodId: periodId,
      state: targetState,
      revision: targetRevision,
      reversalTransactionId: reversalId,
      targetTransactionId: transactionId,
      entitlementType: targetTx.EntitlementType,
      projectionChecksum: actualChecksum,
      reversedAt: timestamp,
      reversedBy: actor
    };

    existingLog.Status = 'CONFIRMED';
    existingLog.ResultRevision = targetRevision;
    existingLog.ResultJson = JSON.stringify(confirmedResult);
    existingLog.CompletedAt = new Date().toISOString();
    existingLog.ErrorCode = '';
    rosterLifecycleWriteLog_(existingLog);

    return confirmedResult;
  } catch (err) {
    if (existingLog) {
      existingLog.Status = entityPersisted ? 'RECOVERY_REQUIRED' : 'FAILED';
      existingLog.ErrorCode = err.code || (entityPersisted ? 'RECOVERY_REQUIRED' : 'VALIDATION_FAILED');
      existingLog.CompletedAt = new Date().toISOString();
      rosterLifecycleWriteLog_(existingLog);
    }
    throw err;
  }
}

function rosterLifecycleEntitlementRecover_(operationId, actor) {
  if (!operationId) throw DraftProtocol.fail('VALIDATION_FAILED', { message: 'operationId is required' });
  const log = rosterLifecycleFindOperationLog_(operationId);
  if (!log) throw DraftProtocol.fail('ENTITY_NOT_FOUND', { message: 'Operation ' + operationId + ' not found in OperationLog' });

  const phase7OpTypes = [
    'ENTITLEMENT_EARN_GOFF', 'ENTITLEMENT_EARN_GHKA', 'ENTITLEMENT_CREDIT_MANUAL',
    'ENTITLEMENT_CONSUME', 'ENTITLEMENT_CREDIT_REVERSAL', 'ENTITLEMENT_CONSUMPTION_REVERSAL'
  ];
  if (!phase7OpTypes.includes(log.OperationType)) {
    throw DraftProtocol.fail('VALIDATION_FAILED', { message: 'Unsupported entitlement operation type for recovery: ' + log.OperationType });
  }

  if (log.Status === 'CONFIRMED') {
    return rosterLifecycleStatus_(operationId);
  }
  if (log.Status === 'FAILED') {
    return rosterLifecycleStatus_(operationId);
  }

  const periodId = log.EntityKey ? log.EntityKey.replace(/^period:/, '') : '';
  const period = periodId ? rosterLifecycleFindPeriod_(periodId) : null;
  const currentRevision = period ? Number(period.Revision || 0) : 0;

  const records = rosterLifecycleGetRecords_('RosterEntitlementTransactions');
  const targetTx = records.find(function(tx) { return tx.OperationId === operationId; });

  if (!targetTx) {
    log.Status = 'FAILED';
    log.ErrorCode = log.ErrorCode || 'NO_PERSISTED_MUTATION';
    log.CompletedAt = new Date().toISOString();
    rosterLifecycleWriteLog_(log);
    return rosterLifecycleStatus_(operationId);
  }

  // Tamper detection: verify accounting-semantic fields match canonical expectations
  let tamperError = null;
  if (!targetTx.PersonId || targetTx.DutyDomain !== 'MO') {
    tamperError = 'Invalid PersonId or DutyDomain';
  } else if (periodId && targetTx.PeriodId && targetTx.PeriodId !== periodId) {
    tamperError = 'PeriodId mismatch';
  } else if (log.OperationType === 'ENTITLEMENT_EARN_GOFF') {
    const expectedTxId = 'etx-goff-' + rosterV2Digest_(operationId + ':' + targetTx.PersonId + ':' + targetTx.EffectiveDate).slice(0, 16);
    const expectedSourceId = 'displaced-off:' + periodId + ':' + targetTx.PersonId + ':' + targetTx.EffectiveDate;
    if (targetTx.EntitlementType !== 'GOFF' ||
        targetTx.TransactionType !== 'CREDIT_EARNED' ||
        Number(targetTx.Amount) !== 1 ||
        targetTx.SourceType !== 'DISPLACED_WEEKLY_OFF' ||
        targetTx.SourceId !== expectedSourceId ||
        targetTx.TransactionId !== expectedTxId) {
      tamperError = 'GOFF credit accounting fields corrupted';
    }
  } else if (log.OperationType === 'ENTITLEMENT_EARN_GHKA') {
    const expectedTxId = 'etx-ghka-' + rosterV2Digest_(operationId + ':' + targetTx.PersonId + ':' + targetTx.EffectiveDate).slice(0, 16);
    const expectedSourceId = 'holiday-duty:' + targetTx.EffectiveDate + ':' + targetTx.PersonId;
    if (targetTx.EntitlementType !== 'GHKA' ||
        targetTx.TransactionType !== 'CREDIT_EARNED' ||
        Number(targetTx.Amount) !== 1 ||
        targetTx.SourceType !== 'PUBLIC_HOLIDAY_DUTY' ||
        targetTx.SourceId !== expectedSourceId ||
        targetTx.TransactionId !== expectedTxId) {
      tamperError = 'GHKA credit accounting fields corrupted';
    }
  } else if (log.OperationType === 'ENTITLEMENT_CREDIT_MANUAL') {
    const expectedTxId = 'etx-man-' + rosterV2Digest_(operationId + ':' + targetTx.PersonId + ':' + targetTx.EffectiveDate).slice(0, 16);
    let expectedType = null;
    if (log.ResultJson) {
      try { expectedType = JSON.parse(log.ResultJson).entitlementType; } catch (_) {}
    }
    if ((expectedType && targetTx.EntitlementType !== expectedType) ||
        (targetTx.EntitlementType !== 'GOFF' && targetTx.EntitlementType !== 'GHKA') ||
        targetTx.TransactionType !== 'CREDIT_MANUAL' ||
        Number(targetTx.Amount) !== 1 ||
        targetTx.SourceType !== 'ADMIN_ADJUSTMENT' ||
        targetTx.SourceId !== ('manual:' + operationId) ||
        targetTx.TransactionId !== expectedTxId) {
      tamperError = 'Manual credit accounting fields corrupted';
    }
  } else if (log.OperationType === 'ENTITLEMENT_CONSUME') {
    const expectedTxId = 'etx-cons-' + rosterV2Digest_(operationId + ':' + targetTx.PersonId + ':' + targetTx.EffectiveDate).slice(0, 16);
    let expectedType = null;
    if (log.ResultJson) {
      try { expectedType = JSON.parse(log.ResultJson).entitlementType; } catch (_) {}
    }
    if ((expectedType && targetTx.EntitlementType !== expectedType) ||
        (targetTx.EntitlementType !== 'GOFF' && targetTx.EntitlementType !== 'GHKA') ||
        Number(targetTx.Amount) !== -1 ||
        targetTx.SourceType !== 'ROSTER_ASSIGNMENT' ||
        targetTx.TransactionId !== expectedTxId) {
      tamperError = 'Consumption accounting fields corrupted';
    }
  } else if (log.OperationType === 'ENTITLEMENT_CREDIT_REVERSAL') {
    const expectedTxId = 'etx-rev-' + rosterV2Digest_(operationId + ':' + targetTx.RelatedTransactionId).slice(0, 16);
    const relatedTarget = records.find(function(tx) { return tx.TransactionId === targetTx.RelatedTransactionId; });
    if (targetTx.TransactionType !== 'CREDIT_REVERSAL' ||
        Number(targetTx.Amount) !== -1 ||
        !targetTx.RelatedTransactionId ||
        targetTx.TransactionId !== expectedTxId ||
        !relatedTarget ||
        relatedTarget.EntitlementType !== targetTx.EntitlementType) {
      tamperError = 'Credit reversal accounting fields corrupted';
    }
  } else if (log.OperationType === 'ENTITLEMENT_CONSUMPTION_REVERSAL') {
    const expectedTxId = 'etx-rev-' + rosterV2Digest_(operationId + ':' + targetTx.RelatedTransactionId).slice(0, 16);
    const relatedTarget = records.find(function(tx) { return tx.TransactionId === targetTx.RelatedTransactionId; });
    if (targetTx.TransactionType !== 'CONSUMPTION_REVERSAL' ||
        Number(targetTx.Amount) !== 1 ||
        !targetTx.RelatedTransactionId ||
        targetTx.TransactionId !== expectedTxId ||
        !relatedTarget ||
        relatedTarget.EntitlementType !== targetTx.EntitlementType) {
      tamperError = 'Consumption reversal accounting fields corrupted';
    }
  }

  if (tamperError) {
    log.Status = 'RECOVERY_REQUIRED';
    log.ErrorCode = 'CORRUPT_DATA';
    rosterLifecycleWriteLog_(log);
    throw DraftProtocol.fail('CORRUPT_DATA', {
      message: 'Tamper detected: ' + tamperError,
      operationId: operationId,
      transactionId: targetTx.TransactionId
    });
  }

  const isRosterChanging = (log.OperationType === 'ENTITLEMENT_CONSUME' || log.OperationType === 'ENTITLEMENT_CONSUMPTION_REVERSAL');

  if (!isRosterChanging) {
    const confirmedResult = {
      ok: true,
      operationId: operationId,
      transactionId: targetTx.TransactionId,
      entitlementType: targetTx.EntitlementType,
      personId: targetTx.PersonId,
      status: 'CONFIRMED',
      createdAt: targetTx.CreatedAt || new Date().toISOString(),
      createdBy: targetTx.CreatedBy || actor || ''
    };
    log.Status = 'CONFIRMED';
    log.ResultRevision = currentRevision;
    log.ResultJson = JSON.stringify(confirmedResult);
    log.CompletedAt = new Date().toISOString();
    log.ErrorCode = '';
    rosterLifecycleWriteLog_(log);
    return rosterLifecycleStatus_(operationId);
  }

  DraftProtocol.ensure(period, 'ENTITY_NOT_FOUND', { message: 'Period ' + periodId + ' not found for recovery' });

  const allAssignments = rosterLifecycleFindAssignmentsByPeriod_(periodId);
  const plannedAssignments = allAssignments.filter(function(r) { return r.Layer === 'PLANNED'; });
  const confirmedEvents = rosterLifecycleFindConfirmedEventsByPeriod_(periodId, operationId);
  const priorEvents = RosterLifecycle.groupEventLines(confirmedEvents.filter(function(r) { return r.OperationId !== operationId; }));
  const confirmedAbsences = rosterLifecycleFindConfirmedAbsencesByPeriod_(periodId, operationId);
  const activeAbsences = confirmedAbsences.filter(function(a) { return a.Status === 'ACTIVE'; });
  const confirmedReplacements = rosterLifecycleFindConfirmedReplacementsByPeriod_(periodId, operationId);
  const activeReplacements = confirmedReplacements.filter(function(r) { return r.Status === 'ACTIVE'; });
  const confirmedEntitlements = rosterLifecycleFindConfirmedEntitlementsByPeriod_(periodId, operationId);
  if (!confirmedEntitlements.some(function(e) { return e.TransactionId === targetTx.TransactionId; })) {
    confirmedEntitlements.push(targetTx);
  }
  const people = rosterLifecycleGetPeople_();

  const intendedCurrent = RosterLifecycle.resolveCurrentRoster({
    periodId: periodId,
    plannedAssignments: plannedAssignments,
    events: priorEvents,
    absences: activeAbsences,
    replacements: activeReplacements,
    entitlements: confirmedEntitlements,
    people: people,
    digestFn: rosterV2Digest_
  });

  const projectedRows = intendedCurrent.masterRosterProjection || RosterLifecycle.generateMasterRosterProjection(intendedCurrent.currentAssignments || []);
  const masterTable = rosterV2ReadTable_('MasterRoster');
  const existingMasterRows = masterTable.exists ? rosterV2Records_(masterTable, ['Name', 'Date', 'Shift'], true) : [];
  const mergeResult = RosterLifecycle.mergeMasterRosterProjection(existingMasterRows, periodId, projectedRows);
  rosterLifecycleWriteMasterRoster_(mergeResult.mergedRows);

  const readbackTable = rosterV2ReadTable_('MasterRoster');
  const readbackRows = rosterV2Records_(readbackTable, ['Name', 'Date', 'Shift'], true);
  const targetMonthPersistedRows = readbackRows.filter(function(r) {
    const ld = RosterCompatibility.localDate(r.Date);
    return ld && ld.slice(0, 7) === periodId;
  });

  const actualChecksum = RosterLifecycle.computeProjectionChecksum(targetMonthPersistedRows, rosterV2Digest_);
  const expectedChecksum = RosterLifecycle.computeProjectionChecksum(projectedRows, rosterV2Digest_);

  if (actualChecksum !== expectedChecksum) {
    log.Status = 'RECOVERY_REQUIRED';
    log.ErrorCode = 'CHECKSUM_MISMATCH';
    rosterLifecycleWriteLog_(log);
    throw DraftProtocol.fail('CHECKSUM_MISMATCH', { actual: actualChecksum, expected: expectedChecksum });
  }

  let targetRevision = currentRevision;
  let targetState = period.State;

  if (period.LastOperationId === operationId) {
    targetRevision = currentRevision;
    targetState = period.State;
  } else {
    targetRevision = currentRevision + 1;
    targetState = intendedCurrent.effectiveState || 'AMENDED';
    const updatedPeriod = Object.assign({}, period, {
      State: targetState,
      Revision: targetRevision,
      ProjectionChecksum: actualChecksum,
      LastOperationId: operationId,
      UpdatedAt: new Date().toISOString()
    });
    rosterLifecycleWriteRow_('RosterPeriods', updatedPeriod, period._row);
  }

  const confirmedResult = {
    ok: true,
    operationId: operationId,
    periodId: periodId,
    state: targetState,
    revision: targetRevision,
    transactionId: targetTx.TransactionId,
    entitlementType: targetTx.EntitlementType,
    projectionChecksum: actualChecksum,
    createdAt: targetTx.CreatedAt || new Date().toISOString(),
    createdBy: targetTx.CreatedBy || actor || ''
  };
  log.Status = 'CONFIRMED';
  log.ResultRevision = targetRevision;
  log.ResultJson = JSON.stringify(confirmedResult);
  log.CompletedAt = new Date().toISOString();
  log.ErrorCode = '';
  rosterLifecycleWriteLog_(log);
  return rosterLifecycleStatus_(operationId);
}

function rosterLifecycleRoute_(action, data) {
  let lock, acquired = false, principal;
  try {
    const settings = rosterDraftSettings_();
    const switches = RosterCompatibility.featureSwitches(settings);
    const writeActions = [
      'rosterv2publish', 'rosterv2close', 'rosterv2reopen', 'rosterv2lifecyclerecover',
      'rosterv2amend', 'rosterv2amendreversal',
      'rosterv2absencecreate', 'rosterv2replacementcreate', 'rosterv2absencereverse', 'rosterv2replacementreverse',
      'rosterv2absencerecover', 'rosterv2replacementrecover',
      'rosterv2entitlementearngoff', 'rosterv2entitlementearnghka', 'rosterv2entitlementcreditmanual',
      'rosterv2entitlementconsume', 'rosterv2entitlementcreditreverse', 'rosterv2entitlementconsumereverse',
      'rosterv2entitlementrecover'
    ];
    const isWrite = writeActions.includes(action);

    if (isWrite) {
      try {
        principal = rosterV2RequireAdmin_();
      } catch (error) {
        throw DraftProtocol.fail('AUTHORIZATION_REQUIRED');
      }
      DraftProtocol.ensure(switches.roster_v2_write_enabled, 'FEATURE_DISABLED');
    } else {
      principal = rosterLifecycleGetPrincipalSafe_();
      DraftProtocol.ensure(switches.roster_v2_read_enabled, 'FEATURE_DISABLED');
    }

    lock = LockService.getScriptLock();
    try {
      lock.waitLock(10000);
      acquired = true;
    } catch (error) {
      throw DraftProtocol.fail('LOCK_BUSY');
    }

    const lockedSettings = rosterDraftSettings_();
    const lockedSwitches = RosterCompatibility.featureSwitches(lockedSettings);
    if (isWrite) {
      DraftProtocol.ensure(lockedSwitches.roster_v2_write_enabled, 'FEATURE_DISABLED');
    } else {
      DraftProtocol.ensure(lockedSwitches.roster_v2_read_enabled, 'FEATURE_DISABLED');
    }

    if (action === 'rosterv2lifecycleschema') {
      return createJsonResponse({
        ok: true,
        schemaVersion: 2,
        schemas: rosterLifecycleSchemas_(),
        lifecycleWritesEnabled: Boolean(lockedSwitches.roster_v2_write_enabled)
      });
    }

    if (action === 'rosterv2periodlifecycle') {
      const periodId = RosterCompatibility.validatePeriod(String(data.periodId || data.period || ''));
      rosterLifecycleEnsureAllSchemas_();
      const periodRecord = rosterLifecycleFindPeriod_(periodId);
      const events = rosterLifecycleFindEventsByPeriod_(periodId);
      return createJsonResponse({
        ok: true,
        periodId: periodId,
        period: periodRecord,
        events: events
      });
    }

    if (action === 'rosterv2amendmenthistory') {
      return createJsonResponse(rosterLifecycleAmendmentHistory_(data, principal));
    }

    if (action === 'rosterv2planned') {
      return createJsonResponse(rosterLifecycleGetPlanned_(data));
    }

    if (action === 'rosterv2current') {
      return createJsonResponse(rosterLifecycleGetCurrent_(data));
    }

    if (action === 'rosterv2absences') {
      return createJsonResponse(rosterLifecycleGetAbsences_(data, principal));
    }

    if (action === 'rosterv2replacements') {
      return createJsonResponse(rosterLifecycleGetReplacements_(data, principal));
    }

    if (action === 'rosterv2amend') {
      return createJsonResponse(rosterLifecycleAmend_(data, principal.email));
    }

    if (action === 'rosterv2amendreversal') {
      return createJsonResponse(rosterLifecycleAmendReversal_(data, principal.email));
    }

    if (action === 'rosterv2absencecreate') {
      return createJsonResponse(rosterLifecycleAbsenceCreate_(data, principal.email));
    }

    if (action === 'rosterv2replacementcreate') {
      return createJsonResponse(rosterLifecycleReplacementCreate_(data, principal.email));
    }

    if (action === 'rosterv2absencereverse') {
      return createJsonResponse(rosterLifecycleAbsenceReverse_(data, principal.email));
    }

    if (action === 'rosterv2replacementreverse') {
      return createJsonResponse(rosterLifecycleReplacementReverse_(data, principal.email));
    }

    if (action === 'rosterv2publish') {
      return createJsonResponse(rosterLifecyclePublish_(data, principal.email));
    }

    if (action === 'rosterv2close') {
      return createJsonResponse(rosterLifecycleClose_(data, principal.email));
    }

    if (action === 'rosterv2reopen') {
      return createJsonResponse(rosterLifecycleReopen_(data, principal.email));
    }

    if (action === 'rosterv2lifecyclerecover') {
      return createJsonResponse(rosterLifecycleRecover_(data.operationId));
    }

    if (action === 'rosterv2absencerecover') {
      return createJsonResponse(rosterLifecycleAbsenceRecover_(data.operationId, principal.email));
    }

    if (action === 'rosterv2replacementrecover') {
      return createJsonResponse(rosterLifecycleReplacementRecover_(data.operationId, principal.email));
    }

    if (action === 'rosterv2entitlementbalances') {
      return createJsonResponse(rosterLifecycleGetEntitlementBalances_(data, principal));
    }

    if (action === 'rosterv2entitlementtransactions') {
      return createJsonResponse(rosterLifecycleGetEntitlementTransactions_(data, principal));
    }

    if (action === 'rosterv2entitlementearngoff') {
      return createJsonResponse(rosterLifecycleEntitlementEarnGoff_(data, principal.email));
    }

    if (action === 'rosterv2entitlementearnghka') {
      return createJsonResponse(rosterLifecycleEntitlementEarnGhka_(data, principal.email));
    }

    if (action === 'rosterv2entitlementcreditmanual') {
      return createJsonResponse(rosterLifecycleEntitlementCreditManual_(data, principal.email));
    }

    if (action === 'rosterv2entitlementconsume') {
      return createJsonResponse(rosterLifecycleEntitlementConsume_(data, principal.email));
    }

    if (action === 'rosterv2entitlementcreditreverse') {
      return createJsonResponse(rosterLifecycleEntitlementCreditReverse_(data, principal.email));
    }

    if (action === 'rosterv2entitlementconsumereverse') {
      return createJsonResponse(rosterLifecycleEntitlementConsumeReverse_(data, principal.email));
    }

    if (action === 'rosterv2entitlementrecover') {
      return createJsonResponse(rosterLifecycleEntitlementRecover_(data.operationId, principal.email));
    }

    throw DraftProtocol.fail('VALIDATION_FAILED');
  } catch (error) {
    const recognizedErrors = [
      'SNAPSHOT_IMMUTABLE', 'IMMUTABLE_SNAPSHOT_VIOLATION',
      'INVALID_STATE', 'INVALID_LIFECYCLE_STATE', 'INVALID_LIFECYCLE_TRANSITION',
      'CHECKSUM_MISMATCH', 'RECONCILIATION_FAILED', 'REOPEN_REASON_REQUIRED',
      'AMENDED_RESERVED_PHASE5', 'TRANSITION_BLOCKED',
      'MALFORMED_EVENT', 'INCOMPLETE_SWAP', 'EVENT_ALREADY_REVERSED',
      'REVERSAL_DEPENDENCY_CONFLICT', 'CANNOT_REVERSE_LIFECYCLE_EVENT',
      'CANNOT_REVERSE_REVERSAL', 'IDEMPOTENCY_MISMATCH', 'REVISION_CONFLICT',
      'DUTY_DOMAIN_REQUIRED', 'EVENT_NOT_FOUND', 'INVALID_OPERATOR',
      'CORRUPT_DATA',
      'INVALID_ABSENCE_TYPE', 'INVALID_DATE_RANGE', 'OVERLAPPING_ABSENCE',
      'ABSENCE_NOT_FOUND', 'ABSENCE_ALREADY_REVERSED', 'REPLACEMENT_NOT_FOUND',
      'REPLACEMENT_ALREADY_REVERSED', 'DUTY_DOMAIN_MISMATCH',
      'INVALID_PERSON_IDENTITY', 'INVALID_ASSIGNMENT', 'SHORTAGE_ACCEPTANCE_REQUIRED',
      'INSUFFICIENT_GOFF_BALANCE', 'INSUFFICIENT_GHKA_BALANCE',
      'CROSS_ENTITLEMENT_CONSUMPTION_FORBIDDEN', 'CROSS_ENTITLEMENT_DEPENDENCY_FORBIDDEN',
      'INVALID_ENTITLEMENT_TYPE', 'EP_DOMAIN_EXCLUDED', 'DUPLICATE_CREDIT_SOURCE',
      'DEPENDENT_CONSUMPTION_EXISTS', 'INCOMPATIBLE_OPERATIONAL_STATUS',
      'TRANSACTION_NOT_FOUND', 'TRANSACTION_ALREADY_REVERSED',
      'NO_DISPLACED_OFF', 'NOT_PUBLIC_HOLIDAY', 'NOT_QUALIFYING_DUTY'
    ];
    const code = (DraftProtocol.errors.includes(error.code) ||
      (RosterLifecycle.LIFECYCLE_ERRORS && RosterLifecycle.LIFECYCLE_ERRORS[error.code]) ||
      (typeof RosterAbsence !== 'undefined' && RosterAbsence.ABSENCE_ERRORS && RosterAbsence.ABSENCE_ERRORS[error.code]) ||
      (typeof RosterEntitlement !== 'undefined' && RosterEntitlement.ENTITLEMENT_ERRORS && RosterEntitlement.ENTITLEMENT_ERRORS[error.code]) ||
      recognizedErrors.includes(error.code))
      ? error.code
      : 'RECOVERY_REQUIRED';
    let legacyMsg = error.message || code;
    if (code === 'AUTHORIZATION_REQUIRED') legacyMsg = 'V2 administrator authorization required.';
    else if (code === 'FEATURE_DISABLED') legacyMsg = 'Official v2 writes are disabled in Phase 1 / lifecycle not enabled.';
    const detailsMsg = (error.details && error.details.message) || error.message || code;
    return createJsonResponse({
      ok: false,
      result: 'error',
      message: legacyMsg,
      error: {
        code: code,
        retryable: ['LOCK_BUSY', 'TRANSIENT_BACKEND'].includes(code),
        details: error.details || {},
        message: detailsMsg
      }
    });
  } finally {
    if (acquired) lock.releaseLock();
  }
}
