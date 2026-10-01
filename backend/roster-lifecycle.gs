// Apps Script Phase 4 Roster Lifecycle Backend Engine
// Operates under ScriptLock, enforces deterministic planned snapshots, immutable published periods,
// month-scoped MasterRoster projections with persisted readback checksum verification, and idempotent journal recovery.

function rosterLifecycleSchemas_() {
  return RosterLifecycle.ROSTER_LIFECYCLE_SCHEMAS;
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

  const isMatch = currentHeaders.length === targetHeaders.length &&
    currentHeaders.every(function(h, i) { return h === targetHeaders[i]; });
  if (isMatch) return sheet;

  // Dynamic additive & idempotent upgrade
  const rows = values.slice(1);
  const headerMap = {};
  currentHeaders.forEach(function(h, i) { if (h) headerMap[h] = i; });

  const upgradedRows = rows.map(function(row) {
    return targetHeaders.map(function(header) {
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
  const allValues = [targetHeaders].concat(upgradedRows);
  sheet.getRange(1, 1, allValues.length, targetHeaders.length).setValues(allValues);
  SpreadsheetApp.flush();
  return sheet;
}

function rosterLifecycleEnsureAllSchemas_() {
  ['RosterPeriods', 'RosterAssignments', 'RosterEvents', 'WeeklyOffSnapshots'].forEach(function(name) {
    rosterLifecycleEnsureSchema_(name);
  });
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss.getSheetByName('OperationLog')) {
    const logSheet = ss.insertSheet('OperationLog');
    logSheet.getRange(1, 1, 1, ROSTER_DRAFT_SCHEMAS.OperationLog.length).setValues([ROSTER_DRAFT_SCHEMAS.OperationLog]);
    SpreadsheetApp.flush();
  }
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
  const targetHeaders = rosterLifecycleSchemas_()[sheetName] || (ROSTER_DRAFT_SCHEMAS[sheetName]);
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
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
  const targetHeaders = rosterLifecycleSchemas_()[sheetName];
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
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
      return r.WeekSnapshotId === ws.WeekSnapshotId && r.PersonId === ws.PersonId;
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
    UpdatedAt: timestamp
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
  if (currentState !== 'PUBLISHED') {
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
  if (currentState === 'PUBLISHED') {
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
          state: 'PUBLISHED',
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
    throw DraftProtocol.fail('INVALID_STATE', { message: 'Period ' + periodId + ' is already PUBLISHED' });
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

  try {
    RosterLifecycle.validateTransition(currentState, 'PUBLISHED', {
      actor: actor,
      reason: reason,
      isManual: true,
      currentRevision: currentRevision
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
    State: 'PUBLISHED',
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
    state: 'PUBLISHED',
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
    if (period && period.State === 'PUBLISHED' && period.LastOperationId === operationId) {
      if (!log.ResultJson) {
        log.ResultJson = JSON.stringify({
          ok: true,
          operationId: operationId,
          periodId: periodId,
          state: 'PUBLISHED',
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
  }

  return rosterLifecycleStatus_(operationId);
}

function rosterLifecycleRoute_(action, data) {
  let lock, acquired = false, principal;
  try {
    try {
      principal = rosterV2RequireAdmin_();
    } catch (error) {
      throw DraftProtocol.fail('AUTHORIZATION_REQUIRED');
    }

    const settings = rosterDraftSettings_();
    const switches = RosterCompatibility.featureSwitches(settings);
    const writeActions = ['rosterv2publish', 'rosterv2close', 'rosterv2reopen', 'rosterv2lifecyclerecover'];
    const isWrite = writeActions.includes(action);

    if (isWrite) {
      DraftProtocol.ensure(switches.roster_v2_write_enabled, 'FEATURE_DISABLED');
    } else {
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

    throw DraftProtocol.fail('VALIDATION_FAILED');
  } catch (error) {
    const recognizedErrors = [
      'SNAPSHOT_IMMUTABLE', 'IMMUTABLE_SNAPSHOT_VIOLATION',
      'INVALID_STATE', 'INVALID_LIFECYCLE_STATE', 'INVALID_LIFECYCLE_TRANSITION',
      'CHECKSUM_MISMATCH', 'RECONCILIATION_FAILED', 'REOPEN_REASON_REQUIRED',
      'AMENDED_RESERVED_PHASE5', 'TRANSITION_BLOCKED'
    ];
    const code = (DraftProtocol.errors.includes(error.code) ||
      (RosterLifecycle.LIFECYCLE_ERRORS && RosterLifecycle.LIFECYCLE_ERRORS[error.code]) ||
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
