import protocol from './protocol.js';
import {emptyEntity,terminal,projection,mergeSnapshot,mergeLifecycle,retryDelay,unloadGuard,validateEntity,validateCells} from './state.js';
import RosterCompatibility from '../compatibility.js';
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
    if(this.timer&&typeof this.timer.unref==='function')this.timer.unref();
    await this.tick();
  }
  stop(){this.generation++;this.stopped=true;clearInterval(this.timer);this.bus?.close();this.guard(this.unsafe.size>0||!!this.localError);}
  async validateStored(e){validateEntity(e);if(e.baseline.checksum&&e.baseline.checksum!==await sha256(protocol.canonical(e.baseline.cells)))throw new Error('OUTBOX_INVALID');
    for(const op of e.operations)if(op.payloadHash&&op.payloadHash!==await sha256(protocol.canonical(protocol.payload(op))))throw new Error('OUTBOX_INVALID');return e;}
  async reload(){try{const rows=await this.store.all();await Promise.all(rows.map(e=>this.validateStored(e)));for(const e of rows)if(e.storageRevision>=(this.entities.get(e.entityKey)?.storageRevision||0))this.entities.set(e.entityKey,e);this.emit();}
    catch(e){this.localError=e.message;this.emit();throw e;}}
  async change(key,fn){try{const e=await this.store.update(key,current=>{if(current)validateEntity(current,key);const version=current?.storageRevision||0;const next=fn(current||emptyEntity(key));next.storageRevision=version+1;return validateEntity(next,key);});if(e.storageRevision>=(this.entities.get(key)?.storageRevision||0))this.entities.set(key,e);this.localError=null;this.emit();this.bus?.send(key,'changed');return e;}
    catch(e){this.localError=e.message.startsWith('OUTBOX_')?e.message:'PERSISTENCE_FAILED';this.emit();throw e;}}
  view(key){const e=this.entities.get(key)||emptyEntity(key),v=projection(e);for(const intent of this.unsafe.values())if(intent.entityKey===key)for(const p of intent.patches){v.cells[protocol.cellKey(p)]=p.assignments;v.statuses[protocol.cellKey(p)]={status:'NOT_DURABLE',operationId:intent.id};}return {...e,...v,lifecycle:e.lifecycle||{state:'DRAFT',revision:e.baseline.revision},unsafe:this.unsafe.size>0,error:this.localError};}
  async enqueue(entityKey,patches) {
    if(!this.enabled())throw protocol.fail('FEATURE_DISABLED');
    if(!this.locks)throw protocol.fail('PERMANENT_FAILURE',{reason:'WEB_LOCKS_UNAVAILABLE'});
    const current=this.entities.get(entityKey);
    const state=String(current?.lifecycle?.state||'DRAFT').toUpperCase();
    if(state==='PUBLISHED')throw protocol.fail('SNAPSHOT_IMMUTABLE',{message:`Period ${entityKey} is PUBLISHED and immutable`});
    if(state==='CLOSED')throw protocol.fail('INVALID_STATE',{message:`Period ${entityKey} is CLOSED and read-only`});
    if(state==='AMENDED')throw protocol.fail('AMENDED_RESERVED_PHASE5',{message:`AMENDED editing is reserved for Phase 5`});
    if(current?.operations.some(o=>!terminal(o)&&o.operationClass==='LIFECYCLE'))throw protocol.fail('LIFECYCLE_OPERATION_PENDING',{message:'In-flight lifecycle operation exists'});
    const intent={id:crypto.randomUUID(),entityKey,patches:structuredClone(patches),baseRevision:current?.baseline.revision||0};
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
      const st=String(e.lifecycle?.state||'DRAFT').toUpperCase();
      if(st==='PUBLISHED')throw protocol.fail('SNAPSHOT_IMMUTABLE');
      if(st==='CLOSED')throw protocol.fail('INVALID_STATE');
      if(st==='AMENDED')throw protocol.fail('AMENDED_RESERVED_PHASE5');
      if(e.operations.some(o=>!terminal(o)&&o.operationClass==='LIFECYCLE'))throw protocol.fail('LIFECYCLE_OPERATION_PENDING');
      const last=e.operations.at(-1),canCoalesce=last&&last.operationClass==='DRAFT'&&last.status==='QUEUED'&&!last.everSent&&last.tabId===this.tabId;
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
    try{
      let response;
      if (op.operationType === 'PERIOD_PUBLISH') {
        response = await this.repository.publish(op);
      } else if (op.operationType === 'PERIOD_CLOSE') {
        response = await this.repository.close(op);
      } else if (op.operationType === 'PERIOD_REOPEN') {
        response = await this.repository.reopen(op);
      } else if (op.operationType === 'PERIOD_AMEND') {
        response = await this.repository.amend(op);
      } else if (op.operationType === 'PERIOD_AMEND_REVERSAL') {
        response = await this.repository.reverseAmendment(op);
      } else {
        response = await this.repository.write(op);
      }
      await this.handle(key,id,response);
    }
    catch(error){await this.schedule(key,id,'NETWORK_AMBIGUOUS');}
  }
  async schedule(key,id,code){await this.change(key,e=>{const op=e.operations.find(o=>o.operationId===id);if(terminal(op))return e;
    op.status=op.attemptCount>=this.maxAttempts?'RECOVERY_REQUIRED':'AWAITING_STATUS';op.lastError=code;op.nextRetryAt=this.now()+retryDelay(op.attemptCount,this.random);return e;});}
  async handle(key,id,response){
    const currentEntity = await this.store.read(key);
    const op = currentEntity?.operations.find(o=>o.operationId===id);
    if (!op) return;

    if (op.operationClass === 'LIFECYCLE') {
      const isConfirmed = response.ok && (response.status === 'CONFIRMED' || ['PUBLISHED','CLOSED','AMENDED'].includes(response.state));
      if (isConfirmed) {
        const result = response.result || response;
        if (response.operationId && response.operationId !== id) throw new Error('INVALID_CONFIRMATION');
        await this.change(key, e => mergeLifecycle(e, result, id));
        return;
      }
      if (response.ok && ['PENDING','RECOVERY_REQUIRED'].includes(response.status)) {
        await this.change(key, e => {
          const target = e.operations.find(o => o.operationId === id);
          if (target && !terminal(target)) {
            target.status = 'RECOVERY_REQUIRED';
            target.lastError = response.errorCode || 'RECOVERY_REQUIRED';
          }
          return e;
        });
        return;
      }
      const code = response.ok ? (response.errorCode || 'PERMANENT_FAILURE') : (response.error?.code || 'PERMANENT_FAILURE');
      if (code === 'CHECKSUM_MISMATCH') {
        await this.change(key, e => {
          const target = e.operations.find(o => o.operationId === id);
          if (target && !terminal(target)) {
            target.status = 'RECOVERY_REQUIRED';
            target.lastError = 'CHECKSUM_MISMATCH';
          }
          return e;
        });
        return;
      }
      if (code === 'RECONCILIATION_FAILED') {
        await this.change(key, e => {
          const target = e.operations.find(o => o.operationId === id);
          if (target && !terminal(target)) {
            target.status = 'FAILED';
            target.lastError = 'RECONCILIATION_FAILED';
          }
          return e;
        });
        return;
      }
      if (['LOCK_BUSY','TRANSIENT_BACKEND'].includes(code)) {
        await this.schedule(key, id, code);
        return;
      }
      await this.change(key, e => {
        const target = e.operations.find(o => o.operationId === id);
        if (target && !terminal(target)) {
          target.status = code === 'REVISION_CONFLICT' ? 'CONFLICT' : 'FAILED';
          target.lastError = code;
        }
        return e;
      });
      return;
    }

    if(response.ok&&response.status==='CONFIRMED'){
      const result=response.result;
      if(response.operationId!==id||response.payloadHash!==op.payloadHash||result.operationId!==id||result.entityKey!==key||result.revision!==op.expectedRevision+1||
        protocol.canonical(result.patches)!==protocol.canonical(op.payload.patches))throw new Error('INVALID_CONFIRMATION');
      // Fetch a complete confirmed snapshot; never roll back to a stale returned patch.
      const snapshot=await this.verifySnapshot(key,await this.repository.read(key));if(snapshot.revision<result.revision||(snapshot.revision===result.revision&&snapshot.checksum!==result.checksum))throw new Error('INCOMPLETE_CONFIRMATION');
      await this.change(key,e=>{const operation=e.operations.find(o=>o.operationId===id);operation.status='CONFIRMED';operation.lastError=null;return mergeSnapshot(e,snapshot,id);});return;
    }
    if(response.ok&&['PENDING','RECOVERY_REQUIRED'].includes(response.status)){
      await this.change(key,e=>{const o=e.operations.find(x=>x.operationId===id);o.status='RECOVERY_REQUIRED';o.lastError='RECOVERY_REQUIRED';return e;});return;
    }
    const code=response.ok?(response.errorCode||'PERMANENT_FAILURE'):response.error?.code||'PERMANENT_FAILURE';
    if(['LOCK_BUSY','TRANSIENT_BACKEND'].includes(code)){await this.schedule(key,id,code);return;}
    await this.change(key,e=>{const o=e.operations.find(x=>x.operationId===id);if(terminal(o))return e;
      o.status=code==='REVISION_CONFLICT'?'CONFLICT':code==='RECOVERY_REQUIRED'?'RECOVERY_REQUIRED':'FAILED';o.lastError=code;return e;});
  }
  async reconcile(key,id){
    const frozen=(await this.store.read(key)).operations.find(o=>o.operationId===id);
    if(!frozen.payloadHash){const hash=await sha256(protocol.canonical(protocol.payload(frozen)));await this.change(key,e=>{e.operations.find(o=>o.operationId===id).payloadHash=hash;return e;});}
    try{
      let response;
      if (frozen.operationClass === 'LIFECYCLE' && frozen.status === 'RECOVERY_REQUIRED' && frozen.lastError !== 'CHECKSUM_MISMATCH' && frozen.operationType !== 'PERIOD_AMEND' && frozen.operationType !== 'PERIOD_AMEND_REVERSAL') {
        response = await this.repository.recoverLifecycle(id);
      } else {
        response = await this.repository.status(id);
      }
      if(response.ok&&response.status==='NOT_FOUND'){
        await this.change(key,e=>{const op=e.operations.find(o=>o.operationId===id);op.status='RETRY_SCHEDULED';return e;});await this.send(key,id);
      }else if(response.ok&&['PENDING','RECOVERY_REQUIRED'].includes(response.status)&&(frozen.operationType==='PERIOD_AMEND'||frozen.operationType==='PERIOD_AMEND_REVERSAL')){
        await this.change(key,e=>{const op=e.operations.find(o=>o.operationId===id);op.status='RETRY_SCHEDULED';op.nextRetryAt=0;return e;});await this.send(key,id);
      }else if(!response.ok&&['LOCK_BUSY','TRANSIENT_BACKEND'].includes(response.error?.code)){
        await this.change(key,e=>{e.operations.find(o=>o.operationId===id).attemptCount++;return e;});await this.schedule(key,id,response.error.code);
      }else await this.handle(key,id,response);
    }catch(error){await this.change(key,e=>{e.operations.find(o=>o.operationId===id).attemptCount++;return e;});await this.schedule(key,id,'STATUS_UNAVAILABLE');}
  }
  async retry(key,id){if(!this.enabled())throw protocol.fail('FEATURE_DISABLED');return this.locks.request(this.store.name+':'+key,async()=>{
    const current=await this.validateStored(await this.store.read(key)),op=current.operations.find(o=>o.operationId===id);if(!op||terminal(op))return;
    if(current.operations.find(o=>!terminal(o))?.operationId!==id)throw protocol.fail('REVISION_CONFLICT',{reason:'EARLIER_OPERATION_UNRESOLVED'});
    if(['VALIDATION_FAILED','AUTHORIZATION_REQUIRED','IDEMPOTENCY_MISMATCH','REVISION_CONFLICT','FEATURE_DISABLED','PERMANENT_FAILURE','RECONCILIATION_FAILED','REOPEN_REASON_REQUIRED','AMENDED_RESERVED_PHASE5','EVENT_ALREADY_REVERSED','REVERSAL_DEPENDENCY_CONFLICT','CANNOT_REVERSE_LIFECYCLE_EVENT','CANNOT_REVERSE_REVERSAL','INVALID_STATE','INVALID_LIFECYCLE_STATE'].includes(op.lastError))throw protocol.fail(op.lastError);
    if(op.status==='RECOVERY_REQUIRED'){
      if(op.operationClass==='LIFECYCLE'){
        if(op.operationType==='PERIOD_AMEND'||op.operationType==='PERIOD_AMEND_REVERSAL'){
          await this.change(key,e=>{const o=e.operations.find(x=>x.operationId===id);o.attemptCount=0;o.nextRetryAt=0;o.status='RETRY_SCHEDULED';return e;});
          await this.send(key,id);
          return;
        }
        const rec=await this.repository.recoverLifecycle(id);
        if(rec.ok&&rec.status==='CONFIRMED'){
          await this.handle(key,id,rec);
          return;
        }
        if(op.operationType==='PERIOD_PUBLISH'&&(op.lastError==='CHECKSUM_MISMATCH'||rec.errorCode==='CHECKSUM_MISMATCH')){
          await this.change(key,e=>{const o=e.operations.find(x=>x.operationId===id);o.attemptCount=0;o.nextRetryAt=0;o.status='RETRY_SCHEDULED';return e;});
          await this.send(key,id);
          return;
        }
        await this.handle(key,id,rec);
        return;
      }else{
        const status=await this.repository.status(id);
        if(status.ok&&['PENDING','RECOVERY_REQUIRED'].includes(status.status)){await this.handle(key,id,await this.repository.recover(id));return;}
      }
    }
    await this.change(key,e=>{const o=e.operations.find(o=>o.operationId===id);o.attemptCount=0;o.nextRetryAt=0;return e;});await this.reconcile(key,id);
  });}
  async revert(key,id){return this.locks.request(this.store.name+':'+key,async()=>{
    let op=(await this.validateStored(await this.store.read(key))).operations.find(o=>o.operationId===id);if(!op||terminal(op))throw protocol.fail('PERMANENT_FAILURE');
    if(op.operationClass==='LIFECYCLE')throw protocol.fail('PERMANENT_FAILURE',{reason:'LIFECYCLE_CANNOT_REVERT'});
    if(op.everSent){let status=await this.repository.status(id);
      if(status.ok&&status.status==='NOT_FOUND'){const payloadHash=op.payloadHash||await sha256(protocol.canonical(protocol.payload(op)));status=await this.repository.abandon({...op,payloadHash});}
      if(!status.ok)throw protocol.fail(status.error.code);
      if(status.status==='CONFIRMED'){await this.handle(key,id,status);throw protocol.fail('PERMANENT_FAILURE',{reason:'ALREADY_CONFIRMED'});}
      // NOT_FOUND is not sufficient: an old request could still arrive. Recovery must prove FAILED.
      if(status.status!=='FAILED')throw protocol.fail('RECOVERY_REQUIRED');
    }
    await this.change(key,e=>{op=e.operations.find(o=>o.operationId===id);op.status='REVERTED';for(const later of e.operations)if(!terminal(later)&&later.localSequence>op.localSequence){later.status='CONFLICT';later.lastError='REVISION_CONFLICT';}return e;});
  });}
  async flush(periodId){
    const key=`draft:${periodId}`;
    const previous=this.persistence.get(key);
    if(previous){try{await previous;}catch(_){}}
  }
  async waitForDraftSettled(periodId,timeoutMs=10000){
    await this.flush(periodId);
    const key=`draft:${periodId}`;
    const start=this.now();
    while(this.now()-start<timeoutMs){
      const e=this.entities.get(key);
      if(!e)return;
      const preceding=e.operations.filter(o=>o.operationClass==='DRAFT'&&!terminal(o));
      if(!preceding.length)return;
      if(preceding.some(o=>o.status==='CONFLICT'||o.status==='FAILED')){
        const bad=preceding.find(o=>o.status==='CONFLICT'||o.status==='FAILED');
        throw protocol.fail(bad.lastError||'REVISION_CONFLICT',{operationId:bad.operationId});
      }
      if(preceding.some(o=>o.status==='QUEUED'&&o.nextRetryAt>this.now())){
        await this.change(key,entity=>{
          for(const op of entity.operations){
            if(op.operationClass==='DRAFT'&&op.status==='QUEUED'&&op.nextRetryAt>this.now()){
              op.nextRetryAt=this.now();
            }
          }
          return entity;
        });
      }
      await this.tick();
      const still=this.entities.get(key)?.operations.filter(o=>o.operationClass==='DRAFT'&&!terminal(o));
      if(!still?.length)return;
      await new Promise(r=>setTimeout(r,10));
    }
    throw protocol.fail('TRANSIENT_BACKEND',{message:'Timed out waiting for draft operations to settle'});
  }
  async getPeriodLifecycle(periodId){
    RosterCompatibility.validatePeriod(periodId);
    const response=await this.repository.getPeriodLifecycle(periodId);
    if(response.ok&&response.period){
      const key=`draft:${periodId}`;
      if(this.entities.has(key)){await this.change(key,e=>mergeLifecycle(e,response.period));}
    }
    return response;
  }
  async publish(periodId,options={}){
    if(!this.enabled())throw protocol.fail('FEATURE_DISABLED');
    if(!this.locks)throw protocol.fail('PERMANENT_FAILURE',{reason:'WEB_LOCKS_UNAVAILABLE'});
    RosterCompatibility.validatePeriod(periodId);
    const key=`draft:${periodId}`;
    await this.flush(periodId);
    await this.waitForDraftSettled(periodId);

    return this.locks.request(this.store.name+':'+key,async()=>{
      await this.reload();
      const stored=await this.store.read(key);
      const current=stored?await this.validateStored(stored):emptyEntity(key);
      const currentState=String(current.lifecycle?.state||'DRAFT').toUpperCase();
      if(currentState==='PUBLISHED'){
        const existingConfirmed=current.operations.find(o=>o.operationType==='PERIOD_PUBLISH'&&o.status==='CONFIRMED');
        if(existingConfirmed)return current.lifecycle;
        throw protocol.fail('SNAPSHOT_IMMUTABLE',{message:`Period ${periodId} is already PUBLISHED`});
      }
      if(currentState!=='DRAFT'){
        throw protocol.fail('INVALID_STATE',{message:`Period ${periodId} in state ${currentState} cannot be published`});
      }

      let op=current.operations.find(o=>o.operationType==='PERIOD_PUBLISH'&&!terminal(o));
      let id;
      if(op){
        id=op.operationId;
        await this.change(key,e=>{
          const target=e.operations.find(o=>o.operationId===id);
          if(target&&!terminal(target)){target.nextRetryAt=0;}
          return e;
        });
      }else{
        id=options.operationId||crypto.randomUUID();
        const expectedRevision=options.expectedRevision!==undefined?options.expectedRevision:(Number.isSafeInteger(current.lifecycle?.revision)?current.lifecycle.revision:0);
        const draftCells=structuredClone(current.baseline.cells);
        const adminNote=options.adminNote||'';
        await this.change(key,e=>{
          const st=String(e.lifecycle?.state||'DRAFT').toUpperCase();
          if(st==='PUBLISHED')throw protocol.fail('SNAPSHOT_IMMUTABLE');
          if(st!=='DRAFT')throw protocol.fail('INVALID_STATE');
          const existingOp=e.operations.find(o=>o.operationType==='PERIOD_PUBLISH'&&!terminal(o));
          if(existingOp){id=existingOp.operationId;return e;}
          const base={operationId:id,clientId:this.clientId,tabId:this.tabId,operationType:'PERIOD_PUBLISH',entityKey:key,expectedRevision,payload:{periodId,draftCells,adminNote}};
          protocol.payload(base);
          const newOp={...base,schemaVersion:1,operationClass:'LIFECYCLE',payloadHash:null,localSequence:++e.sequence,
            status:'QUEUED',everSent:false,attemptCount:0,nextRetryAt:0,lastError:null,createdAt:this.now(),updatedAt:this.now(),lastConfirmed:{}};
          e.operations.push(newOp);
          return e;
        });
      }

      await this.process(key);
      const after=await this.validateStored(await this.store.read(key));
      const targetOp=after.operations.find(o=>o.operationId===id);
      if(!targetOp)throw protocol.fail('PERMANENT_FAILURE');
      if(targetOp.status==='CONFIRMED')return after.lifecycle;
      if(targetOp.status==='RECOVERY_REQUIRED')throw protocol.fail('RECOVERY_REQUIRED',{operationId:id,errorCode:targetOp.lastError,status:'RECOVERY_REQUIRED'});
      if(targetOp.status==='CONFLICT')throw protocol.fail('REVISION_CONFLICT',{operationId:id});
      if(targetOp.status==='FAILED')throw protocol.fail(targetOp.lastError||'PERMANENT_FAILURE',{operationId:id});
      return {ok:true,operationId:id,status:targetOp.status,pending:true};
    });
  }
  async close(periodId,options={}){
    if(!this.enabled())throw protocol.fail('FEATURE_DISABLED');
    if(!this.locks)throw protocol.fail('PERMANENT_FAILURE',{reason:'WEB_LOCKS_UNAVAILABLE'});
    RosterCompatibility.validatePeriod(periodId);
    const key=`draft:${periodId}`;
    await this.flush(periodId);

    return this.locks.request(this.store.name+':'+key,async()=>{
      await this.reload();
      const stored=await this.store.read(key);
      const current=stored?await this.validateStored(stored):emptyEntity(key);
      const currentState=String(current.lifecycle?.state||'DRAFT').toUpperCase();
      if(currentState==='CLOSED'){
        const existingConfirmed=current.operations.find(o=>o.operationType==='PERIOD_CLOSE'&&o.status==='CONFIRMED');
        if(existingConfirmed)return current.lifecycle;
        throw protocol.fail('INVALID_STATE',{message:`Period ${periodId} is already CLOSED`});
      }
      if(currentState!=='PUBLISHED'&&currentState!=='AMENDED'){
        throw protocol.fail('INVALID_STATE',{message:`Period ${periodId} in state ${currentState} cannot be closed`});
      }

      let op=current.operations.find(o=>o.operationType==='PERIOD_CLOSE'&&!terminal(o));
      let id;
      if(op){
        id=op.operationId;
        await this.change(key,e=>{
          const target=e.operations.find(o=>o.operationId===id);
          if(target&&!terminal(target)){target.nextRetryAt=0;}
          return e;
        });
      }else{
        id=options.operationId||crypto.randomUUID();
        const expectedRevision=options.expectedRevision!==undefined?options.expectedRevision:(Number.isSafeInteger(current.lifecycle?.revision)?current.lifecycle.revision:0);
        const adminNote=options.adminNote||'';
        await this.change(key,e=>{
          const st=String(e.lifecycle?.state||'DRAFT').toUpperCase();
          if(st==='CLOSED')throw protocol.fail('INVALID_STATE');
          if(st!=='PUBLISHED'&&st!=='AMENDED')throw protocol.fail('INVALID_STATE');
          const existingOp=e.operations.find(o=>o.operationType==='PERIOD_CLOSE'&&!terminal(o));
          if(existingOp){id=existingOp.operationId;return e;}
          const base={operationId:id,clientId:this.clientId,tabId:this.tabId,operationType:'PERIOD_CLOSE',entityKey:key,expectedRevision,payload:{periodId,adminNote}};
          protocol.payload(base);
          const newOp={...base,schemaVersion:1,operationClass:'LIFECYCLE',payloadHash:null,localSequence:++e.sequence,
            status:'QUEUED',everSent:false,attemptCount:0,nextRetryAt:0,lastError:null,createdAt:this.now(),updatedAt:this.now(),lastConfirmed:{}};
          e.operations.push(newOp);
          return e;
        });
      }

      await this.process(key);
      const after=await this.validateStored(await this.store.read(key));
      const targetOp=after.operations.find(o=>o.operationId===id);
      if(!targetOp)throw protocol.fail('PERMANENT_FAILURE');
      if(targetOp.status==='CONFIRMED')return after.lifecycle;
      if(targetOp.status==='CONFLICT')throw protocol.fail('REVISION_CONFLICT',{operationId:id});
      if(targetOp.status==='FAILED')throw protocol.fail(targetOp.lastError||'PERMANENT_FAILURE',{operationId:id});
      return {ok:true,operationId:id,status:targetOp.status,pending:true};
    });
  }
  async reopen(periodId,reason,options={}){
    if(!this.enabled())throw protocol.fail('FEATURE_DISABLED');
    if(!this.locks)throw protocol.fail('PERMANENT_FAILURE',{reason:'WEB_LOCKS_UNAVAILABLE'});
    RosterCompatibility.validatePeriod(periodId);
    const trimmedReason=String(reason||'').trim();
    if(!trimmedReason)throw protocol.fail('REOPEN_REASON_REQUIRED',{message:'Reopen requires a non-empty trimmed reason string'});
    const key=`draft:${periodId}`;
    await this.flush(periodId);

    return this.locks.request(this.store.name+':'+key,async()=>{
      await this.reload();
      const stored=await this.store.read(key);
      const current=stored?await this.validateStored(stored):emptyEntity(key);
      const currentState=String(current.lifecycle?.state||'DRAFT').toUpperCase();
      if(currentState==='PUBLISHED'){
        const existingConfirmed=current.operations.find(o=>o.operationType==='PERIOD_REOPEN'&&o.status==='CONFIRMED');
        if(existingConfirmed)return current.lifecycle;
        throw protocol.fail('INVALID_STATE',{message:`Period ${periodId} is already in PUBLISHED state`});
      }
      if(currentState!=='CLOSED'){
        throw protocol.fail('INVALID_STATE',{message:`Period ${periodId} in state ${currentState} cannot be reopened`});
      }

      let op=current.operations.find(o=>o.operationType==='PERIOD_REOPEN'&&!terminal(o));
      let id;
      if(op){
        id=op.operationId;
        await this.change(key,e=>{
          const target=e.operations.find(o=>o.operationId===id);
          if(target&&!terminal(target)){target.nextRetryAt=0;}
          return e;
        });
      }else{
        id=options.operationId||crypto.randomUUID();
        const expectedRevision=options.expectedRevision!==undefined?options.expectedRevision:(Number.isSafeInteger(current.lifecycle?.revision)?current.lifecycle.revision:0);
        await this.change(key,e=>{
          const st=String(e.lifecycle?.state||'DRAFT').toUpperCase();
          if(st==='PUBLISHED')throw protocol.fail('INVALID_STATE');
          if(st!=='CLOSED')throw protocol.fail('INVALID_STATE');
          const existingOp=e.operations.find(o=>o.operationType==='PERIOD_REOPEN'&&!terminal(o));
          if(existingOp){id=existingOp.operationId;return e;}
          const base={operationId:id,clientId:this.clientId,tabId:this.tabId,operationType:'PERIOD_REOPEN',entityKey:key,expectedRevision,payload:{periodId,reason:trimmedReason}};
          protocol.payload(base);
          const newOp={...base,schemaVersion:1,operationClass:'LIFECYCLE',payloadHash:null,localSequence:++e.sequence,
            status:'QUEUED',everSent:false,attemptCount:0,nextRetryAt:0,lastError:null,createdAt:this.now(),updatedAt:this.now(),lastConfirmed:{}};
          e.operations.push(newOp);
          return e;
        });
      }

      await this.process(key);
      const after=await this.validateStored(await this.store.read(key));
      const targetOp=after.operations.find(o=>o.operationId===id);
      if(!targetOp)throw protocol.fail('PERMANENT_FAILURE');
      if(targetOp.status==='CONFIRMED')return after.lifecycle;
      if(targetOp.status==='CONFLICT')throw protocol.fail('REVISION_CONFLICT',{operationId:id});
      if(targetOp.status==='FAILED')throw protocol.fail(targetOp.lastError||'PERMANENT_FAILURE',{operationId:id});
      return {ok:true,operationId:id,status:targetOp.status,pending:true};
    });
  }
  async amend(periodId,payload,options={}){
    if(!this.enabled())throw protocol.fail('FEATURE_DISABLED');
    if(!this.locks)throw protocol.fail('PERMANENT_FAILURE',{reason:'WEB_LOCKS_UNAVAILABLE'});
    RosterCompatibility.validatePeriod(periodId);
    const key=`draft:${periodId}`;
    await this.flush(periodId);
    await this.waitForDraftSettled(periodId);

    return this.locks.request(this.store.name+':'+key,async()=>{
      await this.reload();
      const stored=await this.store.read(key);
      const current=stored?await this.validateStored(stored):emptyEntity(key);
      const currentState=String(current.lifecycle?.state||'DRAFT').toUpperCase();
      if(currentState==='DRAFT'){
        throw protocol.fail('INVALID_STATE',{message:`Period ${periodId} is in DRAFT state and cannot be amended`});
      }
      if(currentState==='CLOSED'){
        throw protocol.fail('INVALID_STATE',{message:`Period ${periodId} is CLOSED and cannot be amended`});
      }
      if(currentState!=='PUBLISHED'&&currentState!=='AMENDED'){
        throw protocol.fail('INVALID_STATE',{message:`Period ${periodId} in state ${currentState} cannot be amended`});
      }

      const earlierUnresolved=current.operations.find(o=>!terminal(o));
      let op=current.operations.find(o=>o.operationType==='PERIOD_AMEND'&&!terminal(o));
      let id;
      if(options.operationId&&earlierUnresolved&&earlierUnresolved.operationId===options.operationId){
        op=earlierUnresolved;
      }else if(earlierUnresolved&&(!options.operationId||earlierUnresolved.operationId!==options.operationId)){
        throw protocol.fail('LIFECYCLE_OPERATION_PENDING',{
          message:'An earlier operation is still unresolved',
          operationId:earlierUnresolved.operationId
        });
      }

      if(op){
        id=op.operationId;
        await this.change(key,e=>{
          const target=e.operations.find(o=>o.operationId===id);
          if(target&&!terminal(target)){target.nextRetryAt=0;}
          return e;
        });
      }else{
        id=options.operationId||crypto.randomUUID();
        const expectedRevision=options.expectedRevision!==undefined
          ?options.expectedRevision
          :(Number.isSafeInteger(current.lifecycle?.revision)?current.lifecycle.revision:0);
        await this.change(key,e=>{
          const st=String(e.lifecycle?.state||'DRAFT').toUpperCase();
          if(st==='DRAFT'||st==='CLOSED')throw protocol.fail('INVALID_STATE');
          const existingOp=e.operations.find(o=>o.operationType==='PERIOD_AMEND'&&!terminal(o));
          if(existingOp){id=existingOp.operationId;return e;}
          const base={
            operationId:id,
            clientId:this.clientId,
            tabId:this.tabId,
            operationType:'PERIOD_AMEND',
            entityKey:key,
            expectedRevision:expectedRevision,
            payload:{periodId,payload}
          };
          protocol.payload(base);
          const newOp={
            ...base,
            schemaVersion:1,
            operationClass:'LIFECYCLE',
            payloadHash:null,
            localSequence:++e.sequence,
            status:'QUEUED',
            everSent:false,
            attemptCount:0,
            nextRetryAt:0,
            lastError:null,
            createdAt:this.now(),
            updatedAt:this.now(),
            lastConfirmed:{}
          };
          e.operations.push(newOp);
          return e;
        });
      }

      await this.process(key);
      const after=await this.validateStored(await this.store.read(key));
      const targetOp=after.operations.find(o=>o.operationId===id);
      if(!targetOp)throw protocol.fail('PERMANENT_FAILURE');
      if(targetOp.status==='CONFIRMED')return after.lifecycle;
      if(targetOp.status==='RECOVERY_REQUIRED'){
        throw protocol.fail('RECOVERY_REQUIRED',{operationId:id,errorCode:targetOp.lastError,status:'RECOVERY_REQUIRED'});
      }
      if(targetOp.status==='CONFLICT')throw protocol.fail('REVISION_CONFLICT',{operationId:id});
      if(targetOp.status==='FAILED')throw protocol.fail(targetOp.lastError||'PERMANENT_FAILURE',{operationId:id});
      return {ok:true,operationId:id,status:targetOp.status,pending:true};
    });
  }
  async reverseAmendment(periodId,payloadOrTargetEventId,options={}){
    if(!this.enabled())throw protocol.fail('FEATURE_DISABLED');
    if(!this.locks)throw protocol.fail('PERMANENT_FAILURE',{reason:'WEB_LOCKS_UNAVAILABLE'});
    RosterCompatibility.validatePeriod(periodId);
    const key=`draft:${periodId}`;
    await this.flush(periodId);
    await this.waitForDraftSettled(periodId);

    const payload=typeof payloadOrTargetEventId==='string'
      ?{targetEventId:payloadOrTargetEventId,...(options.payload||{}),adminNote:options.adminNote||''}
      :(payloadOrTargetEventId||{});

    return this.locks.request(this.store.name+':'+key,async()=>{
      await this.reload();
      const stored=await this.store.read(key);
      const current=stored?await this.validateStored(stored):emptyEntity(key);
      const currentState=String(current.lifecycle?.state||'DRAFT').toUpperCase();
      if(currentState==='DRAFT'){
        throw protocol.fail('INVALID_STATE',{message:`Period ${periodId} is in DRAFT state and cannot have amendments reversed`});
      }
      if(currentState==='CLOSED'){
        throw protocol.fail('INVALID_STATE',{message:`Period ${periodId} is CLOSED and cannot have amendments reversed`});
      }
      if(currentState==='PUBLISHED'){
        throw protocol.fail('INVALID_STATE',{message:`Period ${periodId} is in PUBLISHED state and has no active amendments to reverse`});
      }
      if(currentState!=='AMENDED'){
        throw protocol.fail('INVALID_STATE',{message:`Period ${periodId} in state ${currentState} cannot have amendments reversed`});
      }

      const earlierUnresolved=current.operations.find(o=>!terminal(o));
      let op=current.operations.find(o=>o.operationType==='PERIOD_AMEND_REVERSAL'&&!terminal(o));
      let id;
      if(options.operationId&&earlierUnresolved&&earlierUnresolved.operationId===options.operationId){
        op=earlierUnresolved;
      }else if(earlierUnresolved&&(!options.operationId||earlierUnresolved.operationId!==options.operationId)){
        throw protocol.fail('LIFECYCLE_OPERATION_PENDING',{
          message:'An earlier operation is still unresolved',
          operationId:earlierUnresolved.operationId
        });
      }

      if(op){
        id=op.operationId;
        await this.change(key,e=>{
          const target=e.operations.find(o=>o.operationId===id);
          if(target&&!terminal(target)){target.nextRetryAt=0;}
          return e;
        });
      }else{
        id=options.operationId||crypto.randomUUID();
        const expectedRevision=options.expectedRevision!==undefined
          ?options.expectedRevision
          :(Number.isSafeInteger(current.lifecycle?.revision)?current.lifecycle.revision:0);
        await this.change(key,e=>{
          const st=String(e.lifecycle?.state||'DRAFT').toUpperCase();
          if(st==='DRAFT'||st==='CLOSED')throw protocol.fail('INVALID_STATE');
          const existingOp=e.operations.find(o=>o.operationType==='PERIOD_AMEND_REVERSAL'&&!terminal(o));
          if(existingOp){id=existingOp.operationId;return e;}
          const base={
            operationId:id,
            clientId:this.clientId,
            tabId:this.tabId,
            operationType:'PERIOD_AMEND_REVERSAL',
            entityKey:key,
            expectedRevision:expectedRevision,
            payload:{periodId,payload}
          };
          protocol.payload(base);
          const newOp={
            ...base,
            schemaVersion:1,
            operationClass:'LIFECYCLE',
            payloadHash:null,
            localSequence:++e.sequence,
            status:'QUEUED',
            everSent:false,
            attemptCount:0,
            nextRetryAt:0,
            lastError:null,
            createdAt:this.now(),
            updatedAt:this.now(),
            lastConfirmed:{}
          };
          e.operations.push(newOp);
          return e;
        });
      }

      await this.process(key);
      const after=await this.validateStored(await this.store.read(key));
      const targetOp=after.operations.find(o=>o.operationId===id);
      if(!targetOp)throw protocol.fail('PERMANENT_FAILURE');
      if(targetOp.status==='CONFIRMED')return after.lifecycle;
      if(targetOp.status==='RECOVERY_REQUIRED'){
        throw protocol.fail('RECOVERY_REQUIRED',{operationId:id,errorCode:targetOp.lastError,status:'RECOVERY_REQUIRED'});
      }
      if(targetOp.status==='CONFLICT')throw protocol.fail('REVISION_CONFLICT',{operationId:id});
      if(targetOp.status==='FAILED')throw protocol.fail(targetOp.lastError||'PERMANENT_FAILURE',{operationId:id});
      return {ok:true,operationId:id,status:targetOp.status,pending:true};
    });
  }
  async getAmendmentHistory(periodId){
    RosterCompatibility.validatePeriod(periodId);
    return this.repository.getAmendmentHistory(periodId);
  }
}
