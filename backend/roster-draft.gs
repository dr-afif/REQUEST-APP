// Private Phase 2 draft-only journal. No MasterRoster writes or automatic setup.
const ROSTER_DRAFT_SCHEMAS = {
  OperationLog: ['OperationId','ClientId','TabId','OperationType','EntityKey','ExpectedRevision','ResultRevision','PayloadHash','Status','ResultJson','ErrorCode','CreatedAt','CompletedAt'],
  RosterDraftPatches: ['OperationId','EntityKey','BaseRevision','ResultRevision','PayloadJson','ResultChecksum']
};
function rosterDraftReadTable_(name) {
  try { return rosterV2ReadTable_(name); } catch (error) { throw DraftProtocol.fail('TRANSIENT_BACKEND'); }
}
function rosterDraftSettings_() {
  try { return rosterV2Settings_(); } catch (error) { throw DraftProtocol.fail('TRANSIENT_BACKEND'); }
}
function rosterDraftTable_(name) {
  const table = rosterDraftReadTable_(name);
  DraftProtocol.ensure(table.exists, 'ENTITY_NOT_FOUND');
  DraftProtocol.ensure(DraftProtocol.canonical(table.headers) === DraftProtocol.canonical(ROSTER_DRAFT_SCHEMAS[name]), 'PERMANENT_FAILURE');
  const records = table.rows.map(function(row,index) {
    const record = {}; table.headers.forEach(function(k,i) { record[k] = row[i]; });
    record._row = index+2; return record;
  }).filter(function(r) { return table.headers.some(function(k) { return r[k] !== '' && r[k] !== null; }); });
  return records;
}
function rosterDraftLogs_() {
  const logs = rosterDraftTable_('OperationLog'), ids = new Set();
  const revision = function(value) { return (typeof value === 'number' || typeof value === 'string' && /^(0|[1-9]\d*)$/.test(value)) && Number.isSafeInteger(Number(value)) && Number(value) >= 0; };
  logs.forEach(function(r) {
    const meaningValid = (r.OperationType === 'DRAFT_PATCH' && typeof r.EntityKey === 'string' && /^draft:(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(r.EntityKey)) ||
      (r.OperationType === 'OFF_POLICY_UPSERT' && r.EntityKey === 'off-policies') ||
      (['PERIOD_PUBLISH', 'PERIOD_CLOSE', 'PERIOD_REOPEN', 'PERIOD_AMEND', 'PERIOD_AMEND_REVERSAL'].includes(r.OperationType) && typeof r.EntityKey === 'string' && /^period:(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(r.EntityKey));
    DraftProtocol.ensure(DraftProtocol.uuid(r.OperationId) && !ids.has(r.OperationId) &&
      DraftProtocol.uuid(r.ClientId) && DraftProtocol.uuid(r.TabId) && meaningValid &&
      typeof r.PayloadHash === 'string' && /^[0-9a-f]{64}$/.test(r.PayloadHash) && revision(r.ExpectedRevision) &&
      (r.Status === 'FAILED' && r.ResultRevision === '' || revision(r.ResultRevision) && Number(r.ResultRevision) === Number(r.ExpectedRevision)+1) &&
      ['PENDING','CONFIRMED','FAILED','RECOVERY_REQUIRED'].includes(r.Status), 'RECOVERY_REQUIRED');
    ids.add(r.OperationId);
  });
  return logs;
}
function rosterDraftWriteRow_(name, record, row) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  const values = ROSTER_DRAFT_SCHEMAS[name].map(function(k) { return record[k] === undefined ? '' : record[k]; });
  sheet.getRange(row || sheet.getLastRow()+1,1,1,values.length).setValues([values]);
  SpreadsheetApp.flush();
}
function rosterDraftEnrollment_(entityKey) {
  DraftProtocol.ensure(typeof entityKey === 'string' && /^draft:\d{4}-(0[1-9]|1[0-2])$/.test(entityKey));
  const periods = rosterV2Records_(rosterDraftReadTable_('RosterPeriods'), RosterCompatibility.schemas.RosterPeriods.slice(0,4));
  DraftProtocol.ensure(RosterCompatibility.periodInfo(entityKey.slice(6),periods).mode === 'ENROLLED','ENTITY_NOT_FOUND');
}
function rosterDraftState_(entityKey) {
  rosterDraftEnrollment_(entityKey);
  let cells = {}, revision = 0;
  const logs = rosterDraftLogs_().filter(function(r) { return r.EntityKey === entityKey && r.Status === 'CONFIRMED'; })
    .sort(function(a,b) { return Number(a.ResultRevision)-Number(b.ResultRevision); });
  const rows = rosterDraftTable_('RosterDraftPatches');
  logs.forEach(function(log) {
    DraftProtocol.ensure(Number(log.ExpectedRevision) === revision && Number(log.ResultRevision) === revision+1, 'RECOVERY_REQUIRED');
    const matching = rows.filter(function(r) { return r.OperationId === log.OperationId; });
    DraftProtocol.ensure(matching.length === 1,'RECOVERY_REQUIRED');
    const r = matching[0], meaning = JSON.parse(r.PayloadJson);
    const normalized = DraftProtocol.payload(Object.assign({operationId:log.OperationId,clientId:log.ClientId,tabId:log.TabId},meaning));
    DraftProtocol.ensure(r.EntityKey === entityKey && Number(r.BaseRevision) === revision && Number(r.ResultRevision) === revision+1 &&
      normalized.entityKey === entityKey && normalized.expectedRevision === revision && rosterV2Digest_(DraftProtocol.canonical(normalized)) === log.PayloadHash,'RECOVERY_REQUIRED');
    cells = DraftProtocol.apply(cells, normalized.payload.patches); revision++;
    const result = JSON.parse(log.ResultJson);
    DraftProtocol.ensure(rosterV2Digest_(DraftProtocol.canonical(cells)) === r.ResultChecksum && result.checksum === r.ResultChecksum &&
      result.revision === revision && result.operationId === log.OperationId && result.entityKey === entityKey &&
      DraftProtocol.canonical(result.patches) === DraftProtocol.canonical(normalized.payload.patches), 'RECOVERY_REQUIRED');
  });
  return {entityKey:entityKey,revision:revision,checksum:rosterV2Digest_(DraftProtocol.canonical(cells)),cells:cells};
}
function rosterDraftStatus_(id) {
  DraftProtocol.ensure(DraftProtocol.uuid(id));
  const log = rosterDraftLogs_().find(function(r) { return r.OperationId === id; });
  if (!log) return {ok:true,operationId:id,status:'NOT_FOUND'};
  let result = null;
  if (log.Status === 'CONFIRMED') {
    if(log.OperationType==='OFF_POLICY_UPSERT')return rosterGuidanceStatus_(id);
    if(['PERIOD_PUBLISH','PERIOD_CLOSE','PERIOD_REOPEN','PERIOD_AMEND','PERIOD_AMEND_REVERSAL'].includes(log.OperationType))return rosterLifecycleStatus_(id);
    rosterDraftState_(log.EntityKey);const stored = JSON.parse(log.ResultJson);
    result = {ok:true,operationId:stored.operationId,entityKey:stored.entityKey,revision:stored.revision,checksum:stored.checksum,patches:stored.patches};
  }
  return {ok:true,operationId:id,status:log.Status,payloadHash:log.PayloadHash,entityKey:log.EntityKey,
    resultRevision:log.ResultRevision, errorCode:log.ErrorCode ? (DraftProtocol.errors.includes(log.ErrorCode) ? log.ErrorCode : 'PERMANENT_FAILURE') : null,
    result:result};
}
function rosterDraftSave_(operation) {
  const meaning = DraftProtocol.payload(operation), hash = rosterV2Digest_(DraftProtocol.canonical(meaning));
  DraftProtocol.ensure(operation.payloadHash === hash);
  const logs = rosterDraftLogs_(), existing = logs.find(function(r) { return r.OperationId === operation.operationId; });
  if (existing) {
    DraftProtocol.ensure(existing.PayloadHash === hash,'IDEMPOTENCY_MISMATCH');
    return rosterDraftStatus_(operation.operationId);
  }
  const state = rosterDraftState_(meaning.entityKey);
  if (state.revision !== meaning.expectedRevision) throw DraftProtocol.fail('REVISION_CONFLICT',
    {entityKey:state.entityKey,currentRevision:state.revision,checksum:state.checksum,reviewRequired:true});
  DraftProtocol.ensure(!logs.some(function(r) { return r.EntityKey === meaning.entityKey && ['PENDING','RECOVERY_REQUIRED'].includes(r.Status); }), 'RECOVERY_REQUIRED');
  const people = rosterV2Records_(rosterDraftReadTable_('RosterPeople'),['PersonId','DirectoryType','CurrentDisplayName','LegacyNamesJson','Active']);
  RosterCompatibility.personIndex(people); // Fail on ambiguous registration before any write.
  meaning.payload.patches.forEach(function(p) { DraftProtocol.ensure(people.some(function(person) { return person.PersonId === p.personId; }),'ENTITY_NOT_FOUND'); });
  const cells = DraftProtocol.apply(state.cells,meaning.payload.patches);
  const result = {ok:true,operationId:operation.operationId,entityKey:meaning.entityKey,revision:state.revision+1,
    checksum:rosterV2Digest_(DraftProtocol.canonical(cells)),patches:meaning.payload.patches};
  DraftProtocol.ensure(JSON.stringify(result).length < 40000);
  const log = {OperationId:operation.operationId,ClientId:operation.clientId,TabId:operation.tabId,OperationType:meaning.operationType,
    EntityKey:meaning.entityKey,ExpectedRevision:state.revision,ResultRevision:result.revision,PayloadHash:hash,Status:'PENDING',
    ResultJson:JSON.stringify(result),ErrorCode:'',CreatedAt:new Date().toISOString(),CompletedAt:''};
  // Durable intent first; operation-scoped patches remain invisible until confirmation.
  try {
    rosterDraftWriteRow_('OperationLog',log);
    rosterDraftWriteRow_('RosterDraftPatches',{OperationId:log.OperationId,EntityKey:log.EntityKey,BaseRevision:state.revision,
      ResultRevision:result.revision,PayloadJson:JSON.stringify(meaning),ResultChecksum:result.checksum});
    return rosterDraftRecover_(log.OperationId);
  } catch (error) {
    // A write can have succeeded before its response failed. Never report a clean failure.
    throw DraftProtocol.fail('RECOVERY_REQUIRED',{operationId:operation.operationId,reviewRequired:true});
  }
}
function rosterDraftRecover_(id) {
  const log = rosterDraftLogs_().find(function(r) { return r.OperationId === id; });
  DraftProtocol.ensure(log,'ENTITY_NOT_FOUND');
  if(log.OperationType==='OFF_POLICY_UPSERT')return rosterGuidanceRecover_(id);
  if(['PERIOD_PUBLISH','PERIOD_CLOSE','PERIOD_REOPEN','PERIOD_AMEND','PERIOD_AMEND_REVERSAL'].includes(log.OperationType))return rosterLifecycleRecover_(id);
  if (['CONFIRMED','FAILED'].includes(log.Status)) return rosterDraftStatus_(id);
  const state = rosterDraftState_(log.EntityKey), rows = rosterDraftTable_('RosterDraftPatches').filter(function(r) { return r.OperationId === id; });
  if (!rows.length) {
    // Under the same server lock no original writer can still append this absent payload.
    log.Status = 'FAILED'; log.ErrorCode = 'PERMANENT_FAILURE'; log.CompletedAt = new Date().toISOString();
    rosterDraftWriteRow_('OperationLog',log,log._row); return rosterDraftStatus_(id);
  }
  try {
    DraftProtocol.ensure(rows.length === 1 && state.revision === Number(log.ExpectedRevision));
    const row = rows[0], meaning = JSON.parse(row.PayloadJson);
    const normalized = DraftProtocol.payload(Object.assign({operationId:id,clientId:log.ClientId,tabId:log.TabId},meaning));
    const result = JSON.parse(log.ResultJson);
    DraftProtocol.ensure(normalized.entityKey === log.EntityKey && normalized.expectedRevision === state.revision &&
      row.EntityKey === log.EntityKey && Number(row.BaseRevision) === state.revision && Number(row.ResultRevision) === state.revision+1 &&
      Number(log.ResultRevision) === state.revision+1 && rosterV2Digest_(DraftProtocol.canonical(normalized)) === log.PayloadHash &&
      rosterV2Digest_(DraftProtocol.canonical(DraftProtocol.apply(state.cells,normalized.payload.patches))) === row.ResultChecksum &&
      result.checksum === row.ResultChecksum && result.revision === state.revision+1 && result.entityKey === log.EntityKey && result.operationId === id &&
      DraftProtocol.canonical(result.patches) === DraftProtocol.canonical(normalized.payload.patches));
  } catch (error) {
    log.Status = 'RECOVERY_REQUIRED'; log.ErrorCode = 'RECOVERY_REQUIRED';
    rosterDraftWriteRow_('OperationLog',log,log._row); return rosterDraftStatus_(id);
  }
  log.Status = 'CONFIRMED'; log.ErrorCode = ''; log.CompletedAt = new Date().toISOString();
  rosterDraftWriteRow_('OperationLog',log,log._row);
  return rosterDraftStatus_(id);
}
function rosterDraftRoute_(action, data) {
  let lock, acquired = false;
  try {
    try { rosterV2RequireAdmin_(); } catch (error) { throw DraftProtocol.fail('AUTHORIZATION_REQUIRED'); }
    if (['rosterv2draftpatch','rosterv2draftrecover','rosterv2draftabandon'].includes(action)) DraftProtocol.ensure(DraftProtocol.enabled(rosterDraftSettings_()),'FEATURE_DISABLED');
    lock = LockService.getScriptLock();
    try { lock.waitLock(10000); acquired = true; } catch (error) { throw DraftProtocol.fail('LOCK_BUSY'); }
    // A kill switch may change while this execution waits for the lock.
    if (['rosterv2draftpatch','rosterv2draftrecover','rosterv2draftabandon'].includes(action)) DraftProtocol.ensure(DraftProtocol.enabled(rosterDraftSettings_()),'FEATURE_DISABLED');
    if (action === 'rosterv2draftpatch') return createJsonResponse(rosterDraftSave_(data));
    if (action === 'rosterv2operation') return createJsonResponse(rosterDraftStatus_(data.operationId));
    if (action === 'rosterv2draftabandon') return createJsonResponse(rosterDraftAbandon_(data));
    if (action === 'rosterv2draftrecover') return createJsonResponse(rosterDraftRecover_(data.operationId));
    if (action === 'rosterv2draft') return createJsonResponse(Object.assign({ok:true},rosterDraftState_(data.entityKey)));
    if (action === 'rosterv2draftschema') return createJsonResponse({ok:true,protocolVersion:1,schemas:ROSTER_DRAFT_SCHEMAS,
      draftWritesEnabled:DraftProtocol.enabled(rosterDraftSettings_()),automaticEnrollment:false,
      people:rosterV2Records_(rosterDraftReadTable_('RosterPeople'),['PersonId','CurrentDisplayName','DirectoryType'])});
    throw DraftProtocol.fail('VALIDATION_FAILED');
  } catch (error) {
    const code = DraftProtocol.errors.includes(error.code) ? error.code : 'RECOVERY_REQUIRED';
    return createJsonResponse({ok:false,error:{code:code,retryable:['LOCK_BUSY','TRANSIENT_BACKEND'].includes(code),
      details:error.details || {},message:code}});
  } finally { if (acquired) lock.releaseLock(); }
}

function rosterDraftAbandon_(operation) {
  const meaning = DraftProtocol.payload(operation), hash = rosterV2Digest_(DraftProtocol.canonical(meaning));
  DraftProtocol.ensure(hash === operation.payloadHash);
  const existing = rosterDraftLogs_().find(function(r) { return r.OperationId === operation.operationId; });
  if (existing) { DraftProtocol.ensure(existing.PayloadHash === hash, 'IDEMPOTENCY_MISMATCH'); return rosterDraftStatus_(operation.operationId); }
  rosterDraftEnrollment_(meaning.entityKey);
  // A tombstone under the server lock prevents a delayed original request from committing.
  rosterDraftWriteRow_('OperationLog',{OperationId:operation.operationId,ClientId:operation.clientId,TabId:operation.tabId,
    OperationType:meaning.operationType,EntityKey:meaning.entityKey,ExpectedRevision:meaning.expectedRevision,ResultRevision:'',
    PayloadHash:hash,Status:'FAILED',ResultJson:'{}',ErrorCode:'PERMANENT_FAILURE',CreatedAt:new Date().toISOString(),CompletedAt:new Date().toISOString()});
  return rosterDraftStatus_(operation.operationId);
}
