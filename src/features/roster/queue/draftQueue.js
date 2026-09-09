import protocol from './protocol.js';
import {emptyEntity,terminal,projection,mergeSnapshot,retryDelay,unloadGuard,validateEntity,validateCells} from './state.js';
export const sha256=async text=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),b=>b.toString(16).padStart(2,'0')).join('');

let browserTabId;
const tabIdentity=()=>browserTabId ||= crypto.randomUUID();
export class DraftQueue {
  constructor({store,repository,settings={},locks=globalThis.navigator?.locks,online=()=>globalThis.navigator?.onLine!==false,now=Date.now,random=Math.random,debounceMs=500,maxAttempts=5,tabId=tabIdentity(),target=globalThis.window}) {
    Object.assign(this,{store,repository,settings,locks,online,now,random,debounceMs,maxAttempts});
    this.tabId=tabId;this.listeners=new Set();this.entities=new Map();this.unsafe=new Map();this.guard=unloadGuard(target);
    this.bus=null;this.timer=null;this.stopped=false;this.localError=null;this.generation=0;this.persistence=new Map();
  }
  enabled(){return protocol.enabled(this.settings);}
  subscribe(fn){this.listeners.add(fn);return()=>this.listeners.delete(fn);}
  emit(){this.guard(this.unsafe.size>0||!!this.localError);for(const fn of this.listeners)fn();}
  async start(){const generation=++this.generation;this.stopped=false;clearInterval(this.timer);this.clientId=await this.store.clientId();await this.reload();if(generation!==this.generation||this.stopped||!this.enabled())return;
    this.timer=setInterval(()=>this.tick().catch(e=>{this.localError=e.message;this.emit();}),250);
    await this.tick();
  }
  stop(){this.generation++;this.stopped=true;clearInterval(this.timer);this.bus?.close();this.guard(this.unsafe.size>0||!!this.localError);}
  async validateStored(e){validateEntity(e);if(e.baseline.checksum&&e.baseline.checksum!==await sha256(protocol.canonical(e.baseline.cells)))throw new Error('OUTBOX_INVALID');
    for(const op of e.operations)if(op.payloadHash&&op.payloadHash!==await sha256(protocol.canonical(protocol.payload(op))))throw new Error('OUTBOX_INVALID');return e;}
  async reload(){try{const rows=await this.store.all();await Promise.all(rows.map(e=>this.validateStored(e)));for(const e of rows)if(e.storageRevision>=(this.entities.get(e.entityKey)?.storageRevision||0))this.entities.set(e.entityKey,e);this.emit();}
    catch(e){this.localError=e.message;this.emit();throw e;}}
  async change(key,fn){try{const e=await this.store.update(key,current=>{if(current)validateEntity(current,key);const version=current?.storageRevision||0;const next=fn(current||emptyEntity(key));next.storageRevision=version+1;return validateEntity(next,key);});if(e.storageRevision>=(this.entities.get(key)?.storageRevision||0))this.entities.set(key,e);this.localError=null;this.emit();this.bus?.send(key,'changed');return e;}
    catch(e){this.localError=e.message.startsWith('OUTBOX_')?e.message:'PERSISTENCE_FAILED';this.emit();throw e;}}
  view(key){const e=this.entities.get(key)||emptyEntity(key),v=projection(e);for(const intent of this.unsafe.values())if(intent.entityKey===key)for(const p of intent.patches){v.cells[protocol.cellKey(p)]=p.assignments;v.statuses[protocol.cellKey(p)]={status:'NOT_DURABLE',operationId:intent.id};}return {...e,...v,unsafe:this.unsafe.size>0,error:this.localError};}
  async enqueue(entityKey,patches) {
    if(!this.enabled())throw protocol.fail('FEATURE_DISABLED');
    if(!this.locks)throw protocol.fail('PERMANENT_FAILURE',{reason:'WEB_LOCKS_UNAVAILABLE'});
    const intent={id:crypto.randomUUID(),entityKey,patches:structuredClone(patches),baseRevision:this.entities.get(entityKey)?.baseline.revision||0};
    protocol.payload({operationId:intent.id,clientId:this.clientId,tabId:this.tabId,operationType:'DRAFT_PATCH',entityKey,expectedRevision:intent.baseRevision,payload:{patches:intent.patches}});
    this.unsafe.set(intent.id,intent);this.emit();
    return this.persistIntent(intent);
  }
  persistIntent(intent){
    const previous=this.persistence.get(intent.entityKey)||Promise.resolve();
    const pending=previous.catch(()=>{}).then(async()=>{
      if(!this.unsafe.has(intent.id))return;
      const earlier=[...this.unsafe.values()].find(item=>item.entityKey===intent.entityKey);
      if(earlier.id!==intent.id){intent.persistenceFailed=true;throw new Error('PERSISTENCE_FAILED');}
      intent.persisting=true;
      try{return await this.persistOrderedIntent(intent);}catch(error){intent.persistenceFailed=true;throw error;}finally{intent.persisting=false;this.emit();}
    });
    this.persistence.set(intent.entityKey,pending);return pending;
  }
  async persistOrderedIntent(intent){
    let id;
    await this.change(intent.entityKey,e=>{
      const last=e.operations.at(-1),canCoalesce=last&&last.status==='QUEUED'&&!last.everSent&&last.tabId===this.tabId;
      const prior=e.operations.filter(o=>!terminal(o)).at(-1);
      const expected=canCoalesce?last.expectedRevision:prior&&prior.tabId===this.tabId?prior.expectedRevision+1:intent.baseRevision;
      const merged=new Map((canCoalesce?last.payload.patches:[]).map(p=>[protocol.cellKey(p),p]));for(const p of intent.patches)merged.set(protocol.cellKey(p),p);
      const base={operationId:canCoalesce?last.operationId:intent.id,clientId:this.clientId,tabId:this.tabId,operationType:'DRAFT_PATCH',entityKey:intent.entityKey,expectedRevision:expected,payload:{patches:[...merged.values()]}};
      const normalized=protocol.payload(base);id=base.operationId;
      const op={...base,...normalized,schemaVersion:1,operationClass:'DRAFT',payloadHash:null,localSequence:canCoalesce?last.localSequence:++e.sequence,
        status:expected<e.baseline.revision?'CONFLICT':'QUEUED',everSent:false,attemptCount:0,nextRetryAt:this.now()+this.debounceMs,lastError:expected<e.baseline.revision?'REVISION_CONFLICT':null,createdAt:canCoalesce?last.createdAt:this.now(),updatedAt:this.now(),
        lastConfirmed:Object.fromEntries(normalized.payload.patches.map(p=>[protocol.cellKey(p),e.baseline.cells[protocol.cellKey(p)]||[]]))};
      if(canCoalesce)e.operations[e.operations.length-1]=op;else e.operations.push(op);return e;
    });
    this.unsafe.delete(intent.id);this.emit();return id;
  }
  discardUnsafe(id){const intent=this.unsafe.get(id);if(intent?.persisting)return;this.unsafe.delete(id);if(!this.unsafe.size)this.localError=null;this.emit();}
  async retryPersistence(){for(const intent of [...this.unsafe.values()])await this.persistIntent(intent);await this.reload();this.localError=null;this.emit();}
  async verifySnapshot(key,snapshot){if(!snapshot.ok)throw protocol.fail(snapshot.error.code);validateCells(key,snapshot.cells);if(snapshot.entityKey!==key||!Number.isSafeInteger(snapshot.revision)||snapshot.revision<0||!snapshot.cells||snapshot.checksum!==await sha256(protocol.canonical(snapshot.cells)))throw new Error('INVALID_SNAPSHOT');return snapshot;}
  async refresh(key){const snapshot=await this.verifySnapshot(key,await this.repository.read(key));return this.change(key,e=>mergeSnapshot(e,snapshot));}
  async tick(){if(this.stopped||!this.enabled()||!this.locks||!this.online())return;await this.reload();
    await Promise.all([...this.entities.keys()].map(key=>this.locks.request(this.store.name+':'+key,{ifAvailable:true},lock=>lock?this.process(key):undefined)));
  }
  async process(key){
    const e=await this.store.read(key);if(e)await this.validateStored(e);if(this.stopped||!this.enabled()||!this.online())return;const head=e?.operations.find(o=>!terminal(o));if(!head||(head.status!=='SENDING'&&head.nextRetryAt>this.now()))return;
    if(!['QUEUED','RETRY_SCHEDULED','SENDING','AWAITING_STATUS'].includes(head.status))return;
    if(head.everSent){await this.reconcile(key,head.operationId);return;}
    await this.send(key,head.operationId);
  }
  async send(key,id){
    let op;
    await this.change(key,e=>{op=e.operations.find(o=>o.operationId===id);if(!op||!['QUEUED','RETRY_SCHEDULED'].includes(op.status))return e;
      op.status='SENDING';op.everSent=true;op.attemptCount++;op.updatedAt=this.now();return e;});
    if(!op||op.status!=='SENDING')return;
    op=structuredClone(op);op.payloadHash=await sha256(protocol.canonical(protocol.payload(op)));
    await this.change(key,e=>{const current=e.operations.find(o=>o.operationId===id);current.payloadHash=op.payloadHash;return e;});
    try{const response=await this.repository.write(op);await this.handle(key,id,response);}
    catch(error){await this.schedule(key,id,'NETWORK_AMBIGUOUS');}
  }
  async schedule(key,id,code){await this.change(key,e=>{const op=e.operations.find(o=>o.operationId===id);if(terminal(op))return e;
    op.status=op.attemptCount>=this.maxAttempts?'RECOVERY_REQUIRED':'AWAITING_STATUS';op.lastError=code;op.nextRetryAt=this.now()+retryDelay(op.attemptCount,this.random);return e;});}
  async handle(key,id,response){
    if(response.ok&&response.status==='CONFIRMED'){
      const op=(await this.store.read(key)).operations.find(o=>o.operationId===id),result=response.result;
      if(response.operationId!==id||response.payloadHash!==op.payloadHash||result.operationId!==id||result.entityKey!==key||result.revision!==op.expectedRevision+1||
        protocol.canonical(result.patches)!==protocol.canonical(op.payload.patches))throw new Error('INVALID_CONFIRMATION');
      // Fetch a complete confirmed snapshot; never roll back to a stale returned patch.
      const snapshot=await this.verifySnapshot(key,await this.repository.read(key));if(snapshot.revision<result.revision||(snapshot.revision===result.revision&&snapshot.checksum!==result.checksum))throw new Error('INCOMPLETE_CONFIRMATION');
      await this.change(key,e=>{const operation=e.operations.find(o=>o.operationId===id);operation.status='CONFIRMED';operation.lastError=null;return mergeSnapshot(e,snapshot,id);});return;
    }
    if(response.ok&&['PENDING','RECOVERY_REQUIRED'].includes(response.status)){
      await this.change(key,e=>{const op=e.operations.find(o=>o.operationId===id);op.status='RECOVERY_REQUIRED';op.lastError='RECOVERY_REQUIRED';return e;});return;
    }
    const code=response.ok?(response.errorCode||'PERMANENT_FAILURE'):response.error?.code||'PERMANENT_FAILURE';
    if(['LOCK_BUSY','TRANSIENT_BACKEND'].includes(code)){await this.schedule(key,id,code);return;}
    await this.change(key,e=>{const op=e.operations.find(o=>o.operationId===id);if(terminal(op))return e;
      op.status=code==='REVISION_CONFLICT'?'CONFLICT':code==='RECOVERY_REQUIRED'?'RECOVERY_REQUIRED':'FAILED';op.lastError=code;return e;});
  }
  async reconcile(key,id){
    const frozen=(await this.store.read(key)).operations.find(o=>o.operationId===id);
    // SENDING is committed before hashing. A crash there has no transmitted payload;
    // finish its hash durably, then still query the original UUID before any send.
    if(!frozen.payloadHash){const hash=await sha256(protocol.canonical(protocol.payload(frozen)));await this.change(key,e=>{e.operations.find(o=>o.operationId===id).payloadHash=hash;return e;});}
    try{const response=await this.repository.status(id);if(response.ok&&response.status==='NOT_FOUND'){
      await this.change(key,e=>{const op=e.operations.find(o=>o.operationId===id);op.status='RETRY_SCHEDULED';return e;});await this.send(key,id);
    }else if(!response.ok&&['LOCK_BUSY','TRANSIENT_BACKEND'].includes(response.error.code)){
      await this.change(key,e=>{e.operations.find(o=>o.operationId===id).attemptCount++;return e;});await this.schedule(key,id,response.error.code);
    }else await this.handle(key,id,response);
    }catch(error){await this.change(key,e=>{e.operations.find(o=>o.operationId===id).attemptCount++;return e;});await this.schedule(key,id,'STATUS_UNAVAILABLE');}
  }
  async retry(key,id){if(!this.enabled())throw protocol.fail('FEATURE_DISABLED');return this.locks.request(this.store.name+':'+key,async()=>{
    const current=await this.validateStored(await this.store.read(key)),op=current.operations.find(o=>o.operationId===id);if(!op||terminal(op))return;
    if(current.operations.find(o=>!terminal(o))?.operationId!==id)throw protocol.fail('REVISION_CONFLICT',{reason:'EARLIER_OPERATION_UNRESOLVED'});
    if(['VALIDATION_FAILED','AUTHORIZATION_REQUIRED','IDEMPOTENCY_MISMATCH','REVISION_CONFLICT','FEATURE_DISABLED','PERMANENT_FAILURE'].includes(op.lastError))throw protocol.fail(op.lastError);
    if(op.status==='RECOVERY_REQUIRED'){const status=await this.repository.status(id);
      if(status.ok&&['PENDING','RECOVERY_REQUIRED'].includes(status.status)){await this.handle(key,id,await this.repository.recover(id));return;}}
    await this.change(key,e=>{const o=e.operations.find(o=>o.operationId===id);o.attemptCount=0;o.nextRetryAt=0;return e;});await this.reconcile(key,id);
  });}
  async revert(key,id){return this.locks.request(this.store.name+':'+key,async()=>{
    let op=(await this.validateStored(await this.store.read(key))).operations.find(o=>o.operationId===id);if(!op||terminal(op))throw protocol.fail('PERMANENT_FAILURE');
    if(op.everSent){let status=await this.repository.status(id);
      if(status.ok&&status.status==='NOT_FOUND'){const payloadHash=op.payloadHash||await sha256(protocol.canonical(protocol.payload(op)));status=await this.repository.abandon({...op,payloadHash});}
      if(!status.ok)throw protocol.fail(status.error.code);
      if(status.status==='CONFIRMED'){await this.handle(key,id,status);throw protocol.fail('PERMANENT_FAILURE',{reason:'ALREADY_CONFIRMED'});}
      // NOT_FOUND is not sufficient: an old request could still arrive. Recovery must prove FAILED.
      if(status.status!=='FAILED')throw protocol.fail('RECOVERY_REQUIRED');
    }
    await this.change(key,e=>{op=e.operations.find(o=>o.operationId===id);op.status='REVERTED';for(const later of e.operations)if(!terminal(later)&&later.localSequence>op.localSequence){later.status='CONFLICT';later.lastError='REVISION_CONFLICT';}return e;});
  });}
}
