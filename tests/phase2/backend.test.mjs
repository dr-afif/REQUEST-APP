import test from 'node:test';import assert from 'node:assert/strict';import crypto from 'node:crypto';import vm from 'node:vm';
import protocol from '../../src/features/roster/queue/protocol.js';
import {harness,digest,currentSource,fixture} from '../phase1/apps-script-harness.mjs';
const person='11111111-1111-4111-8111-111111111111';
function setup(options={}){const h=harness(currentSource,{activeEmail:'admin@example.invalid',adminEmail:'admin@example.invalid',...options});
 h.context.SpreadsheetApp.flush=()=>{};
 h.grids.Settings.push(['roster_v2_write_enabled','true'],['write_queue_v2_enabled','true']);
 h.grids.RosterPeriods=[['PeriodId','SchemaVersion','EnrolledAt','EnrolledBy'],['2030-07',2,'2030-01-01','owner'],['2030-08',2,'2030-01-01','owner']];
 h.grids.RosterPeople=[['PersonId','DirectoryType','CurrentDisplayName','LegacyNamesJson','Active'],[person,'MO','Synthetic','[]',true]];
 const schemas=vm.runInContext('ROSTER_DRAFT_SCHEMAS',h.context);for(const [k,v]of Object.entries(schemas))h.grids[k]=[[...v]];return h;}
function operation({entityKey='draft:2030-07',expectedRevision=0,raw=['AM'],...rest}={}){
 const op={operationId:crypto.randomUUID(),clientId:crypto.randomUUID(),tabId:crypto.randomUUID(),operationType:'DRAFT_PATCH',entityKey,expectedRevision,
 payload:{patches:[{personId:person,date:entityKey.slice(6)+'-01',assignments:raw.map(rawShift=>({assignmentId:crypto.randomUUID(),rawShift}))}]},...rest};
 op.payloadHash=digest(protocol.canonical(protocol.payload(op)));return op;}
const save=(h,op)=>h.post({action:'rosterv2draftpatch',...op});
const status=(h,op)=>h.get('rosterv2operation',{operationId:op.operationId});
const read=h=>h.get('rosterv2draft',{entityKey:'draft:2030-07'});
const recover=(h,op)=>h.post({action:'rosterv2draftrecover',operationId:op.operationId});
function fault(h,index,after=false){const original=h.context.rosterDraftWriteRow_;let n=0;h.context.rosterDraftWriteRow_=function(...args){if(++n===index){if(after)original(...args);throw Error('Injected I/O loss');}return original(...args);};return()=>{h.context.rosterDraftWriteRow_=original;};}

test('same operation replay and lost response never duplicate authoritative effects',()=>{
 const h=setup(),op=operation(),first=save(h,op);assert.equal(first.status,'CONFIRMED');
 for(let i=0;i<4;i++)assert.deepEqual(save(h,op),first);
 assert.deepEqual(status(h,op),first);assert.equal(h.grids.OperationLog.length,2);assert.equal(h.grids.RosterDraftPatches.length,2);assert.equal(read(h).revision,1);
});
test('meaning hash ignores object key order and diagnostic changes, covers revision and patch values',()=>{
 const op=operation(),reverse=JSON.parse(JSON.stringify(op));reverse.payload.patches[0].assignments[0]={rawShift:'AM',assignmentId:op.payload.patches[0].assignments[0].assignmentId};
 assert.equal(digest(protocol.canonical(protocol.payload(reverse))),op.payloadHash);
 reverse.clientId=crypto.randomUUID();reverse.tabId=crypto.randomUUID();assert.equal(digest(protocol.canonical(protocol.payload(reverse))),op.payloadHash);
 for(const field of ['revision','value']){const changed=structuredClone(op);if(field==='revision')changed.expectedRevision++;else changed.payload.patches[0].assignments[0].rawShift='PM';assert.notEqual(digest(protocol.canonical(protocol.payload(changed))),op.payloadHash);}
});
test('reused UUID changed meaning is rejected, including confirmed and pending states',()=>{
 for(const partial of [false,true]){const h=setup(),op=operation();const restore=partial?fault(h,2):()=>{};save(h,op);restore();const changed=structuredClone(op);changed.payload.patches[0].assignments[0].rawShift='PM';changed.payloadHash=digest(protocol.canonical(protocol.payload(changed)));
 assert.equal(save(h,changed).error.code,'IDEMPOTENCY_MISMATCH');assert.equal(h.grids.OperationLog.length,2);}
});
test('expected revisions reject stale two-client writes and retain the first value',()=>{
 const h=setup(),a=operation(),b=operation({raw:['PM']});assert.equal(save(h,a).status,'CONFIRMED');const rejected=save(h,b);assert.equal(rejected.error.code,'REVISION_CONFLICT');assert.equal(rejected.error.details.currentRevision,1);
 assert.equal(read(h).cells[person+'/2030-07-01'][0].rawShift,'AM');assert.equal(h.grids.RosterDraftPatches.length,2);
 const next=operation({expectedRevision:1,raw:['PN']});assert.equal(save(h,next).resultRevision,2);assert.equal(save(h,b).error.code,'REVISION_CONFLICT');
});
for(const [index,after]of [[1,false],[1,true],[2,false],[2,true],[3,false],[3,true]])test(`partial journal write ${index}, after=${after}: hidden until proven confirmed`,()=>{
 const h=setup(),op=operation(),restore=fault(h,index,after);assert.equal(save(h,op).error.code,'RECOVERY_REQUIRED');restore();
 const before=read(h);assert.equal(before.ok,true);assert.equal(before.revision,index===3&&after?1:0);
 const s=status(h,op);
 if(s.status==='NOT_FOUND'){assert.equal(save(h,op).status,'CONFIRMED');}
 else{const recovery=recover(h,op);assert.equal(recovery.status,index<=2&&!after||index===1?'FAILED':'CONFIRMED');}
 assert.ok(h.grids.RosterDraftPatches.length<=2);assert.ok(h.locks.filter(x=>x==='release').length>0);
});
test('corrupted or duplicate staged payload remains durable RECOVERY_REQUIRED and blocks later writes',()=>{
 for(const corrupt of ['hash','duplicate']){const h=setup(),op=operation(),restore=fault(h,3);save(h,op);restore();
 if(corrupt==='hash')h.grids.RosterDraftPatches[1][5]='bad';else h.grids.RosterDraftPatches.push([...h.grids.RosterDraftPatches[1]]);
 assert.equal(recover(h,op).status,'RECOVERY_REQUIRED');assert.equal(status(h,op).status,'RECOVERY_REQUIRED');assert.equal(read(h).revision,0);assert.equal(save(h,operation()).error.code,'RECOVERY_REQUIRED');}
});
test('confirmed source corruption fails closed instead of returning a partial canonical draft',()=>{
 const h=setup(),op=operation();save(h,op);h.grids.RosterDraftPatches[1][5]='bad';assert.equal(read(h).error.code,'RECOVERY_REQUIRED');assert.equal(status(h,op).error.code,'RECOVERY_REQUIRED');
});
test('server lock contention is specific, retryable, and writes nothing',()=>{
 const h=setup({failLock:true});assert.equal(save(h,operation()).error.code,'LOCK_BUSY');assert.equal(h.writes.length,0);assert.deepEqual(h.locks,['acquire']);
});
test('missing/false switches and unauthorized caller deny mutation without side effects',()=>{
 for(const which of ['roster_v2_write_enabled','write_queue_v2_enabled'])for(const value of ['',false,'false']){const h=setup();h.grids.Settings=h.grids.Settings.filter(r=>r[0]!==which);if(value!=='')h.grids.Settings.push([which,value]);assert.equal(save(h,operation()).error.code,'FEATURE_DISABLED');assert.equal(h.writes.length,0);}
 const h=setup({activeEmail:''});for(const action of ['rosterv2draftpatch','rosterv2draftrecover','rosterv2draftabandon'])assert.equal(h.post({action,...operation(),admin:true}).error.code,'AUTHORIZATION_REQUIRED');
 for(const action of ['rosterv2draft','rosterv2operation','rosterv2draftschema'])assert.equal(h.get(action,{entityKey:'draft:2030-07',operationId:crypto.randomUUID()}).error.code,'AUTHORIZATION_REQUIRED');assert.equal(h.writes.length,0);
});
test('legacy or missing schema/identity cannot auto-enroll or create tabs',()=>{
 for(const table of ['RosterPeriods','RosterPeople','OperationLog','RosterDraftPatches']){const h=setup();delete h.grids[table];assert.equal(save(h,operation()).error.code,'ENTITY_NOT_FOUND');assert.equal(h.writes.length,0);assert.equal(h.grids[table],undefined);}
});
test('AM+PM, AM+PN, EP pair, modifiers and unknowns remain separate occurrences',()=>{
 for(const raw of [['AM','PM'],['AM','PN'],['EP_OFFICE_HOUR','EP_ONCALL'],['AM (S)','PMX','UNMAPPED','AM']]){const h=setup(),op=operation({raw});const before=JSON.stringify(h.grids.MasterRoster);assert.equal(save(h,op).status,'CONFIRMED');assert.deepEqual(read(h).cells[person+'/2030-07-01'].map(a=>a.rawShift),raw);assert.equal(JSON.stringify(h.grids.MasterRoster),before);}
});
test('validation rejects malformed payload, cross-month cells, duplicate assignment IDs and private fields',()=>{
 for(const change of [op=>op.operationId='123',op=>op.expectedRevision=-1,op=>op.payload.patches[0].date='2030-08-01',op=>op.payload.patches[0].notes='private',op=>op.payload.patches[0].assignments.push({...op.payload.patches[0].assignments[0]})]){
 const h=setup(),op=operation();change(op);assert.equal(save(h,op).error.code,'VALIDATION_FAILED');assert.equal(h.writes.length,0);}
});
test('abandon tombstone blocks a delayed original request without altering the confirmed draft',()=>{
 const h=setup(),op=operation();const abandoned=h.post({action:'rosterv2draftabandon',...op});assert.equal(abandoned.status,'FAILED');assert.equal(save(h,op).status,'FAILED');assert.equal(read(h).revision,0);assert.equal(h.grids.RosterDraftPatches.length,1);
});
test('authorized status reads still work when writes are disabled and public legacy responses gain no journal',()=>{
 const h=setup(),op=operation();save(h,op);h.grids.Settings=h.grids.Settings.filter(r=>!['roster_v2_write_enabled','write_queue_v2_enabled'].includes(r[0]));assert.equal(status(h,op).status,'CONFIRMED');
 const all=h.get('alldata');assert.equal(JSON.stringify(all).includes(op.operationId),false);assert.equal(h.get('rosterv2schema').capabilities.officialWrites,false);
});

test('temporary journal read failure is retryable and never creates an operation',()=>{
 const h=setup(),original=h.context.rosterV2ReadTable_;h.context.rosterV2ReadTable_=name=>{if(name==='OperationLog')throw Error('Synthetic unavailable');return original(name);};
 const result=save(h,operation());assert.equal(result.error.code,'TRANSIENT_BACKEND');assert.equal(result.error.retryable,true);assert.equal(h.writes.length,0);
});

test('review: malformed journal identity, type and revisions fail closed without further writes',()=>{
 for(const [field,value] of [['ExpectedRevision',''],['ExpectedRevision',false],['OperationType','PUBLISH'],['ClientId','bad'],['EntityKey','private marker'],['PayloadHash','bad']]){
  const h=setup(),op=operation();save(h,op);h.grids.OperationLog[1][h.grids.OperationLog[0].indexOf(field)]=value;const writes=h.writes.length;
  assert.equal(status(h,op).error?.code,'RECOVERY_REQUIRED',field);assert.equal(read(h).error?.code,'RECOVERY_REQUIRED',field);assert.equal(h.writes.length,writes);
 }
 const h=setup(),op=operation();save(h,op);h.grids.OperationLog.push([...h.grids.OperationLog[1]]);assert.equal(read(h).error.code,'RECOVERY_REQUIRED');
});

test('review: disabling writes while lock acquisition waits prevents the queued write',()=>{
 const h=setup(),getLock=h.context.LockService.getScriptLock;
 h.context.LockService.getScriptLock=()=>{const lock=getLock();const wait=lock.waitLock;lock.waitLock=(ms)=>{wait(ms);h.grids.Settings=h.grids.Settings.filter(r=>r[0]!=='write_queue_v2_enabled');};return lock;};
 assert.equal(save(h,operation()).error?.code,'FEATURE_DISABLED');assert.equal(h.writes.length,0);assert.deepEqual(h.locks,['acquire','release']);
});

test('review: pending, recovery and failed replays remain idempotent under repeated recovery',()=>{
 for(const stage of [2,3]){const h=setup(),op=operation(),restore=fault(h,stage);save(h,op);restore();
  assert.equal(save(h,op).status,'PENDING');const first=recover(h,op);for(let i=0;i<4;i++){assert.deepEqual(recover(h,op),first);assert.deepEqual(save(h,op),first);assert.deepEqual(status(h,op),first);}
  assert.equal(read(h).revision,stage===2?0:1);assert.equal(h.grids.OperationLog.length,2);
 }
});

test('review: nested meaning, JSON type boundaries and revision collisions are independently distinguished',()=>{
 const h=setup(),op=operation({raw:['AM (S)','PN']});const reordered={...op,payload:{patches:op.payload.patches.map(p=>({assignments:p.assignments.map(a=>({rawShift:a.rawShift,assignmentId:a.assignmentId})),date:p.date,personId:p.personId}))}};
 assert.equal(save(h,op).status,'CONFIRMED');assert.equal(save(h,reordered).status,'CONFIRMED');
 for(const change of [o=>o.expectedRevision=1,o=>o.payload.patches[0].assignments[1].rawShift=' PN',o=>o.payload.patches[0].assignments.reverse(),o=>o.payload.patches[0].assignments[0].assignmentId=crypto.randomUUID()]){const next=structuredClone(op);change(next);next.payloadHash=digest(protocol.canonical(protocol.payload(next)));assert.equal(save(h,next).error.code,'IDEMPOTENCY_MISMATCH');}
 for(const value of [undefined,null,false,true,'0',-1,0.5,Number.MAX_SAFE_INTEGER+1]){const invalid=structuredClone(op);invalid.expectedRevision=value;assert.equal(save(h,invalid).error.code,'VALIDATION_FAILED');}
 for(const value of [undefined,null,false,1]){const invalid=structuredClone(op);invalid.payload.patches[0].assignments[0].rawShift=value;assert.equal(save(h,invalid).error.code,'VALIDATION_FAILED');}
 assert.equal(read(h).revision,1);
});

test('review: negative zero revision has the same wire meaning as zero',()=>{
 const h=setup(),op=operation();const zeroHash=op.payloadHash;op.expectedRevision=-0;op.payloadHash=digest(protocol.canonical(protocol.payload(op)));
 assert.equal(op.payloadHash,zeroHash);assert.equal(save(h,op).status,'CONFIRMED');
});

test('review: unavailable prerequisite reads are transient rather than an ambiguous write',()=>{
 for(const table of ['Settings','RosterPeriods','RosterPeople']){const h=setup(),original=h.context.rosterV2ReadTable_;h.context.rosterV2ReadTable_=name=>{if(name===table)throw Error('Unavailable');return original(name);};
  const result=save(h,operation());assert.equal(result.error.code,'TRANSIENT_BACKEND',table);assert.equal(result.error.retryable,true);assert.equal(h.writes.length,0);
 }
});

test('review: invalid zero-year entity returns validation failure before journal writes',()=>{
 const h=setup(),op=operation();op.entityKey='draft:0000-07';op.payload.patches[0].date='0000-07-01';assert.equal(save(h,op).error.code,'VALIDATION_FAILED');assert.equal(h.writes.length,0);
});

test('review: false-like switches block every direct mutation and status remains private',()=>{
 for(const value of [0,'0','',null,'TRUE','yes',{},[]])for(const action of ['rosterv2draftpatch','rosterv2draftrecover','rosterv2draftabandon']){const h=setup();h.grids.Settings=h.grids.Settings.filter(r=>r[0]!=='write_queue_v2_enabled');h.grids.Settings.push(['write_queue_v2_enabled',value]);assert.equal(h.post({action,...operation()}).error.code,'FEATURE_DISABLED');assert.equal(h.writes.length,0);}
 const h=setup({activeEmail:'viewer@example.invalid'});assert.equal(status(h,operation()).error.code,'AUTHORIZATION_REQUIRED');assert.equal(h.writes.length,0);
});
