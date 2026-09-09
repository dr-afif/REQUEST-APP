// Phase 3 policy storage only. Guidance itself is pure and never edits a roster.
function rosterGuidanceTable_() {
  const table = rosterDraftReadTable_('OffPolicies');
  DraftProtocol.ensure(table.exists,'ENTITY_NOT_FOUND');
  DraftProtocol.ensure(DraftProtocol.canonical(table.headers) === DraftProtocol.canonical(RosterGuidance.OFF_POLICY_HEADERS),'PERMANENT_FAILURE');
  return table.rows.map(function(row,index) {const result={};table.headers.forEach(function(key,i){result[key]=row[i];});result._row=index+2;return result;})
    .filter(function(row){return table.headers.some(function(key){return row[key]!==''&&row[key]!==null;});});
}
function rosterGuidanceWriteRow_(record) {
  const sheet=SpreadsheetApp.getActiveSpreadsheet().getSheetByName('OffPolicies');
  const values=RosterGuidance.OFF_POLICY_HEADERS.map(function(key){return record[key]===undefined?'':record[key];});
  sheet.getRange(sheet.getLastRow()+1,1,1,values.length).setValues([values]);
  SpreadsheetApp.flush();
}
function rosterGuidanceAuditValid_(row) {
  return typeof row.CreatedAt==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(row.CreatedAt)&&
    typeof row.CreatedBy==='string'&&row.CreatedBy.trim()!=='';
}
function rosterGuidanceState_() {
  const logs=rosterDraftLogs_().filter(function(log){return log.OperationType==='OFF_POLICY_UPSERT'&&log.Status==='CONFIRMED';})
    .sort(function(a,b){return Number(a.ResultRevision)-Number(b.ResultRevision);});
  const rows=rosterGuidanceTable_(),policies=[],dates=new Set(),ids=new Set();let revision=0;
  logs.forEach(function(log){
    DraftProtocol.ensure(Number(log.ExpectedRevision)===revision&&Number(log.ResultRevision)===revision+1,'RECOVERY_REQUIRED');
    const matching=rows.filter(function(row){return row.OperationId===log.OperationId;});DraftProtocol.ensure(matching.length===1,'RECOVERY_REQUIRED');
    const row=matching[0],meaning=RosterGuidance.policyOperation({operationId:log.OperationId,clientId:log.ClientId,tabId:log.TabId,
      operationType:log.OperationType,entityKey:log.EntityKey,expectedRevision:Number(log.ExpectedRevision),payload:{policyId:row.PolicyId,
        policyCode:row.PolicyCode,effectiveMonday:row.EffectiveMonday,reason:row.Reason}});
    DraftProtocol.ensure(rosterV2Digest_(DraftProtocol.canonical(meaning))===log.PayloadHash&&Number(row.RuleVersion)===1&&row.RuleJson===RosterGuidance.policyRuleJson(row.PolicyCode)&&
      (row.Active===true||String(row.Active).toLowerCase()==='true')&&rosterGuidanceAuditValid_(row)&&Number(row.Revision)===revision+1&&!dates.has(row.EffectiveMonday)&&!ids.has(row.PolicyId),'RECOVERY_REQUIRED');
    const result=JSON.parse(log.ResultJson);DraftProtocol.ensure(result.operationId===log.OperationId&&result.entityKey==='off-policies'&&
      result.revision===revision+1&&result.policy.policyId===row.PolicyId&&result.policy.policyCode===row.PolicyCode&&
      result.policy.effectiveMonday===row.EffectiveMonday&&result.policy.ruleVersion===1,'RECOVERY_REQUIRED');
    dates.add(row.EffectiveMonday);ids.add(row.PolicyId);policies.push({PolicyId:row.PolicyId,PolicyCode:row.PolicyCode,EffectiveMonday:row.EffectiveMonday,
      RuleVersion:1,RuleJson:row.RuleJson,Active:true,Reason:row.Reason,Revision:revision+1});revision++;
  });
  return {entityKey:'off-policies',revision:revision,policies:policies};
}
function rosterGuidanceStatus_(id) {
  const log=rosterDraftLogs_().find(function(item){return item.OperationId===id;});
  DraftProtocol.ensure(log&&log.OperationType==='OFF_POLICY_UPSERT','ENTITY_NOT_FOUND');
  if(log.Status==='CONFIRMED')rosterGuidanceState_();
  return {ok:true,operationId:id,status:log.Status,payloadHash:log.PayloadHash,entityKey:log.EntityKey,
    resultRevision:log.ResultRevision,errorCode:log.ErrorCode||null,result:log.Status==='CONFIRMED'?JSON.parse(log.ResultJson):null};
}
function rosterGuidanceSave_(operation,actor) {
  DraftProtocol.ensure(typeof actor==='string'&&actor.trim()!=='','AUTHORIZATION_REQUIRED');
  let meaning;try{meaning=RosterGuidance.policyOperation(operation);}catch(error){throw DraftProtocol.fail('VALIDATION_FAILED');}
  const hash=rosterV2Digest_(DraftProtocol.canonical(meaning));
  DraftProtocol.ensure(operation.payloadHash===hash);
  const logs=rosterDraftLogs_(),existing=logs.find(function(item){return item.OperationId===operation.operationId;});
  if(existing){DraftProtocol.ensure(existing.PayloadHash===hash,'IDEMPOTENCY_MISMATCH');DraftProtocol.ensure(existing.OperationType==='OFF_POLICY_UPSERT','IDEMPOTENCY_MISMATCH');return rosterGuidanceStatus_(operation.operationId);}
  const state=rosterGuidanceState_();if(state.revision!==meaning.expectedRevision)throw DraftProtocol.fail('REVISION_CONFLICT',{entityKey:'off-policies',currentRevision:state.revision,reviewRequired:true});
  DraftProtocol.ensure(!state.policies.some(function(policy){return policy.PolicyId===meaning.payload.policyId||policy.EffectiveMonday===meaning.payload.effectiveMonday;}),'VALIDATION_FAILED');
  const result={ok:true,operationId:operation.operationId,entityKey:'off-policies',revision:state.revision+1,policy:{policyId:meaning.payload.policyId,
    policyCode:meaning.payload.policyCode,effectiveMonday:meaning.payload.effectiveMonday,ruleVersion:1}};
  const log={OperationId:operation.operationId,ClientId:operation.clientId,TabId:operation.tabId,OperationType:'OFF_POLICY_UPSERT',EntityKey:'off-policies',
    ExpectedRevision:state.revision,ResultRevision:result.revision,PayloadHash:hash,Status:'PENDING',ResultJson:JSON.stringify(result),ErrorCode:'',CreatedAt:new Date().toISOString(),CompletedAt:''};
  try {
    rosterDraftWriteRow_('OperationLog',log);
    rosterGuidanceWriteRow_({PolicyId:meaning.payload.policyId,PolicyCode:meaning.payload.policyCode,EffectiveMonday:meaning.payload.effectiveMonday,
      RuleVersion:1,RuleJson:RosterGuidance.policyRuleJson(meaning.payload.policyCode),Active:true,Reason:meaning.payload.reason,Revision:result.revision,OperationId:operation.operationId,CreatedAt:new Date().toISOString(),CreatedBy:actor});
    return rosterGuidanceRecover_(operation.operationId);
  } catch(error) {throw DraftProtocol.fail('RECOVERY_REQUIRED',{operationId:operation.operationId,reviewRequired:true});}
}
function rosterGuidanceRecover_(id) {
  const log=rosterDraftLogs_().find(function(item){return item.OperationId===id;});DraftProtocol.ensure(log&&log.OperationType==='OFF_POLICY_UPSERT','ENTITY_NOT_FOUND');
  if(['CONFIRMED','FAILED'].includes(log.Status))return rosterGuidanceStatus_(id);
  const state=rosterGuidanceState_(),rows=rosterGuidanceTable_().filter(function(row){return row.OperationId===id;});
  if(!rows.length){log.Status='FAILED';log.ErrorCode='PERMANENT_FAILURE';log.CompletedAt=new Date().toISOString();rosterDraftWriteRow_('OperationLog',log,log._row);return rosterGuidanceStatus_(id);}
  try {
    DraftProtocol.ensure(rows.length===1&&state.revision===Number(log.ExpectedRevision));const row=rows[0];
    const meaning=RosterGuidance.policyOperation({operationId:id,clientId:log.ClientId,tabId:log.TabId,operationType:log.OperationType,entityKey:log.EntityKey,
      expectedRevision:Number(log.ExpectedRevision),payload:{policyId:row.PolicyId,policyCode:row.PolicyCode,effectiveMonday:row.EffectiveMonday,reason:row.Reason}});
    const result=JSON.parse(log.ResultJson);DraftProtocol.ensure(rosterV2Digest_(DraftProtocol.canonical(meaning))===log.PayloadHash&&Number(row.RuleVersion)===1&&
      row.RuleJson===RosterGuidance.policyRuleJson(row.PolicyCode)&&(row.Active===true||String(row.Active).toLowerCase()==='true')&&rosterGuidanceAuditValid_(row)&&Number(row.Revision)===state.revision+1&&
      Number(log.ResultRevision)===state.revision+1&&result.revision===state.revision+1&&result.policy.policyId===row.PolicyId&&
      !state.policies.some(function(policy){return policy.PolicyId===row.PolicyId||policy.EffectiveMonday===row.EffectiveMonday;}));
  } catch(error){log.Status='RECOVERY_REQUIRED';log.ErrorCode='RECOVERY_REQUIRED';rosterDraftWriteRow_('OperationLog',log,log._row);return rosterGuidanceStatus_(id);}
  log.Status='CONFIRMED';log.ErrorCode='';log.CompletedAt=new Date().toISOString();rosterDraftWriteRow_('OperationLog',log,log._row);return rosterGuidanceStatus_(id);
}
function rosterGuidanceRoute_(action,data) {
  let lock,acquired=false,principal;
  try {
    try{principal=rosterV2RequireAdmin_();}catch(error){throw DraftProtocol.fail('AUTHORIZATION_REQUIRED');}
    const write=['rosterv2offpolicy','rosterv2offpolicyrecover'].includes(action);
    const settings=rosterDraftSettings_();DraftProtocol.ensure(RosterCompatibility.featureSwitches(settings).weekly_off_guidance_enabled,'FEATURE_DISABLED');
    if(write)DraftProtocol.ensure(RosterGuidance.policyWritesEnabled(settings),'FEATURE_DISABLED');
    lock=LockService.getScriptLock();try{lock.waitLock(10000);acquired=true;}catch(error){throw DraftProtocol.fail('LOCK_BUSY');}
    const locked=rosterDraftSettings_();DraftProtocol.ensure(RosterCompatibility.featureSwitches(locked).weekly_off_guidance_enabled,'FEATURE_DISABLED');
    if(write)DraftProtocol.ensure(RosterGuidance.policyWritesEnabled(locked),'FEATURE_DISABLED');
    if(action==='rosterv2offpolicies')return createJsonResponse(Object.assign({ok:true,schemaVersion:1,headers:RosterGuidance.OFF_POLICY_HEADERS},rosterGuidanceState_()));
    if(action==='rosterv2guidanceschema')return createJsonResponse({ok:true,schemaVersion:1,headers:RosterGuidance.OFF_POLICY_HEADERS,issueCodes:RosterGuidance.issueCodes,
      advisoryOnly:true,automaticRosterChanges:false,policyWritesEnabled:RosterGuidance.policyWritesEnabled(locked)});
    if(action==='rosterv2offpolicy')return createJsonResponse(rosterGuidanceSave_(data,principal.email));
    if(action==='rosterv2offpolicyrecover')return createJsonResponse(rosterGuidanceRecover_(data.operationId));
    throw DraftProtocol.fail('VALIDATION_FAILED');
  }catch(error){const code=DraftProtocol.errors.includes(error.code)?error.code:'RECOVERY_REQUIRED';return createJsonResponse({ok:false,error:{code:code,
    retryable:['LOCK_BUSY','TRANSIENT_BACKEND'].includes(code),details:error.details||{},message:code}});
  }finally{if(acquired)lock.releaseLock();}
}
