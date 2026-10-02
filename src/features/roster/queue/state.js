import protocol from './protocol.js';
export const terminal = op => ['CONFIRMED','REVERTED'].includes(op.status);
export const emptyEntity = entityKey => ({schemaVersion:1,storageRevision:0,entityKey,baseline:{revision:0,checksum:null,cells:{}},sequence:0,operations:[]});
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const integer=value=>Number.isSafeInteger(value)&&value>=0;
const hash=value=>typeof value==='string'&&/^[0-9a-f]{64}$/.test(value);
const validationId='11111111-1111-4111-8111-111111111111';
export function validateCells(entityKey,cells) {
  if(!record(cells))throw new Error('OUTBOX_INVALID');
  const patches=Object.entries(cells).map(([key,assignments])=>{
    const [personId,date,...extra]=key.split('/');if(extra.length)throw new Error('OUTBOX_INVALID');
    const patch={personId,date,assignments};protocol.payload({operationId:validationId,clientId:validationId,tabId:validationId,operationType:'DRAFT_PATCH',entityKey,expectedRevision:0,payload:{patches:[patch]}});return patch;
  });
  protocol.apply({},patches); // Assignment IDs are unique across the complete draft.
}
export function validateEntity(entity,key=entity?.entityKey) {
  if(entity?.schemaVersion!==1)throw new Error('OUTBOX_SCHEMA_UNSUPPORTED');
  try {
    const check=ok=>{if(!ok)throw new Error('OUTBOX_INVALID');};
    check(record(entity)&&typeof key==='string'&&/^draft:(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(key)&&entity.entityKey===key);
    check(integer(entity.storageRevision)&&integer(entity.sequence)&&record(entity.baseline)&&integer(entity.baseline.revision)&&Array.isArray(entity.operations));
    validateCells(key,entity.baseline.cells);
    check(hash(entity.baseline.checksum)||(entity.baseline.checksum===null&&Object.keys(entity.baseline.cells).length===0));
    check(!entity.lifecycle||(record(entity.lifecycle)&&typeof entity.lifecycle.state==='string'&&integer(entity.lifecycle.revision)));
    let sequence=0;const ids=new Set();
    for(const op of entity.operations){
      check(record(op)&&op.schemaVersion===1&&op.entityKey===key&&['DRAFT','LIFECYCLE'].includes(op.operationClass));
      protocol.payload(op);
      check(!ids.has(op.operationId)&&integer(op.localSequence)&&op.localSequence>sequence);ids.add(op.operationId);sequence=op.localSequence;
      check(['QUEUED','SENDING','AWAITING_STATUS','RETRY_SCHEDULED','FAILED','CONFLICT','RECOVERY_REQUIRED','CONFIRMED','REVERTED'].includes(op.status));
      check(typeof op.everSent==='boolean'&&integer(op.attemptCount)&&Number.isFinite(op.nextRetryAt)&&op.nextRetryAt>=0);
      check(Number.isFinite(op.createdAt)&&Number.isFinite(op.updatedAt)&&op.updatedAt>=op.createdAt&&record(op.lastConfirmed));
      check(op.everSent?(hash(op.payloadHash)||(op.status==='SENDING'&&op.payloadHash===null)):op.payloadHash===null);
      check(!['SENDING','AWAITING_STATUS','CONFIRMED'].includes(op.status)||op.everSent);
      check(op.status!=='QUEUED'||!op.everSent);
      check(op.status!=='CONFIRMED'||entity.baseline.revision>=op.expectedRevision+1||(entity.lifecycle&&entity.lifecycle.revision>=op.expectedRevision+1));
    }
    check(entity.sequence===sequence);return entity;
  }catch{throw new Error('OUTBOX_INVALID');}
}
export function projection(entity) {
  let cells={...entity.baseline.cells}; const statuses={};
  for(const op of entity.operations.filter(o=>!terminal(o)).sort((a,b)=>a.localSequence-b.localSequence)) {
    if(op.operationType==='DRAFT_PATCH'&&op.payload?.patches){
      for(const patch of op.payload.patches){cells[protocol.cellKey(patch)]=patch.assignments;statuses[protocol.cellKey(patch)]={operationId:op.operationId,status:op.status};}
    }
  }
  return {cells,statuses};
}
export function mergeSnapshot(entity,snapshot,confirmedId=null) {
  if(snapshot.revision < entity.baseline.revision) return entity;
  if(snapshot.revision === entity.baseline.revision && entity.baseline.checksum && snapshot.checksum !== entity.baseline.checksum) throw new Error('CHECKSUM_CONFLICT');
  entity.baseline={revision:snapshot.revision,checksum:snapshot.checksum,cells:structuredClone(snapshot.cells)};
  for(const op of entity.operations){
    if(op.operationId===confirmedId){op.status='CONFIRMED';op.lastError=null;}
    else if(!terminal(op)&&!op.everSent&&op.expectedRevision<snapshot.revision){op.status='CONFLICT';op.lastError='REVISION_CONFLICT';}
  }
  return entity;
}
export function mergeLifecycle(entity, result, confirmedId=null) {
  if(!entity) return entity;
  if (confirmedId) {
    for (const op of entity.operations) {
      if (op.operationId === confirmedId) {
        op.status = 'CONFIRMED';
        op.lastError = null;
      }
    }
  }
  const incomingRevision = Number.isSafeInteger(result?.revision)
    ? result.revision
    : (Number.isSafeInteger(result?.period?.Revision) ? Number(result.period.Revision) : null);
  const currentRevision = Number.isSafeInteger(entity.lifecycle?.revision) ? entity.lifecycle.revision : null;

  // Monotonicity guard: if entity already has a newer confirmed lifecycle revision, ignore stale update
  if (incomingRevision !== null && currentRevision !== null && incomingRevision < currentRevision) {
    return entity;
  }

  const state = result?.state || (result?.period && result.period.State) || entity.lifecycle?.state || 'DRAFT';
  const revision = incomingRevision !== null ? incomingRevision : (currentRevision !== null ? currentRevision : 0);
  entity.lifecycle = {
    state,
    revision,
    updatedAt: result?.updatedAt || new Date().toISOString(),
    ...(result?.plannedSnapshotId ? { plannedSnapshotId: result.plannedSnapshotId } : {}),
    ...(result?.projectionChecksum ? { projectionChecksum: result.projectionChecksum } : {}),
    ...(result?.closedAt ? { closedAt: result.closedAt, closedBy: result.closedBy } : {}),
    ...(result?.reopenedAt ? { reopenedAt: result.reopenedAt, reopenedBy: result.reopenedBy, reason: result.reason } : {}),
    ...(result?.eventId ? { eventId: result.eventId } : {}),
    ...(result?.reversalEventId ? { reversalEventId: result.reversalEventId } : {}),
    ...(result?.targetEventId ? { targetEventId: result.targetEventId } : {}),
    ...(result?.activeAmendmentCount !== undefined ? { activeAmendmentCount: result.activeAmendmentCount } : {}),
    ...(result?.amendedAt ? { amendedAt: result.amendedAt, amendedBy: result.amendedBy } : {}),
    ...(result?.reversedAt ? { reversedAt: result.reversedAt, reversedBy: result.reversedBy } : {})
  };
  return entity;
}
export function retryDelay(attempt,random=Math.random) {return Math.floor(Math.min(30000,500*2**Math.max(0,attempt-1))*(0.75+random()*0.5));}
export function createSignals(onMessage,{name='request-app-roster-v2',target=globalThis.window,Broadcast=globalThis.BroadcastChannel}={}) {
  let channel;
  const receive=e=>{if(e.data?.kind==='roster-queue'&&typeof e.data.entityKey==='string')onMessage(e.data);};
  const storage=e=>{if(e.key!==name||!e.newValue)return;try{receive({data:JSON.parse(e.newValue)});}catch{ /* ignore unrelated/invalid signal */ }};
  if(Broadcast){channel=new Broadcast(name);channel.onmessage=receive;}else target?.addEventListener('storage',storage);
  return {send(entityKey,event){const message={kind:'roster-queue',entityKey,event,nonce:crypto.randomUUID()};
    if(channel)channel.postMessage(message);else try{target?.localStorage.setItem(name,JSON.stringify(message));}catch{ /* polling + server revision remain authoritative */ }},
    close(){channel?.close();target?.removeEventListener('storage',storage);}};
}
export function unloadGuard(target=globalThis.window) {
  let installed=false;const warn=e=>{e.preventDefault();e.returnValue='';};
  return unsafe=>{if(unsafe&&!installed)target?.addEventListener('beforeunload',warn);if(!unsafe&&installed)target?.removeEventListener('beforeunload',warn);installed=unsafe;};
}
