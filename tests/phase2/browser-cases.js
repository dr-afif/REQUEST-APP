import {IndexedOutbox} from '../../src/features/roster/queue/indexedOutbox.js';
import {DraftQueue,sha256} from '../../src/features/roster/queue/draftQueue.js';
import {createSignals,unloadGuard} from '../../src/features/roster/queue/state.js';
import protocol from '../../src/features/roster/queue/protocol.js';
const person='11111111-1111-4111-8111-111111111111',key='draft:2030-07',cell=person+'/2030-07-01';
const assert=(ok,message='Assertion failed')=>{if(!ok)throw new Error(message);};
const equal=(a,b)=>assert(JSON.stringify(a)===JSON.stringify(b),JSON.stringify({actual:a,expected:b}));
const patch=(raw='AM',date='2030-07-01')=>({personId:person,date,assignments:(Array.isArray(raw)?raw:[raw]).map(rawShift=>({assignmentId:crypto.randomUUID(),rawShift}))});
const settings={roster_v2_write_enabled:true,write_queue_v2_enabled:true};
const waitFor=async fn=>{for(let i=0;i<200;i++){if(fn())return;await new Promise(r=>setTimeout(r,5));}throw new Error('Timed out');};
export function server(){
 const states=new Map(),logs=new Map(),calls=[];
 let lose=false,hold=null,partial=false,unavailable=false;
 const read=async entityKey=>{let state=states.get(entityKey);if(!state){state={ok:true,entityKey,revision:0,cells:{},checksum:await sha256(protocol.canonical({}))};states.set(entityKey,state);}return structuredClone(state);};
 const status=async id=>{calls.push(['status',id]);if(unavailable)throw Error('Offline');return structuredClone(logs.get(id)||{ok:true,status:'NOT_FOUND',operationId:id});};
 const write=async op=>{
   calls.push(['write',op.operationId]);if(hold)await hold;if(unavailable)throw Error('Offline');
   if(logs.has(op.operationId)){const old=logs.get(op.operationId);return old.payloadHash===op.payloadHash?structuredClone(old):{ok:false,error:{code:'IDEMPOTENCY_MISMATCH'}};}
   const state=await read(op.entityKey);
   if(state.revision!==op.expectedRevision)return {ok:false,error:{code:'REVISION_CONFLICT'}};
   const cells=protocol.apply(state.cells,op.payload.patches),checksum=await sha256(protocol.canonical(cells));
   const result={ok:true,operationId:op.operationId,entityKey:op.entityKey,revision:state.revision+1,checksum,patches:structuredClone(op.payload.patches)};
   const record={ok:true,operationId:op.operationId,entityKey:op.entityKey,status:partial?'RECOVERY_REQUIRED':'CONFIRMED',payloadHash:op.payloadHash,result:partial?null:result};
   logs.set(op.operationId,record);if(!partial)states.set(op.entityKey,{...state,cells,revision:result.revision,checksum});
   if(lose){lose=false;throw Error('Response lost');}return structuredClone(record);
 };
 return {read,write,status,recover:async id=>status(id),abandon:async op=>{const old=logs.get(op.operationId);if(old)return structuredClone(old);const row={ok:true,status:'FAILED',operationId:op.operationId,payloadHash:op.payloadHash,errorCode:'PERMANENT_FAILURE'};logs.set(op.operationId,row);return structuredClone(row);},
   states,logs,calls,setLose:()=>{lose=true;},setHold:p=>{hold=p;},setPartial:()=>{partial=true;},setUnavailable:value=>{unavailable=value;}};
}
export async function setup({repo=server(),name='phase2-'+crypto.randomUUID(),flags=settings,options={}}={}){
 const store=await IndexedOutbox.open({name});let time=0;
 const q=new DraftQueue({store,repository:repo,settings:flags,now:()=>repo.clock||0,random:()=>0.5,tabId:crypto.randomUUID(),...options});q.clientId=await store.clientId();await q.reload();
 await q.refresh(key);return {q,store,repo,name,advance:()=>{repo.clock=(repo.clock||0)+100000;},close:()=>{q.stop();store.close();}};
}
export const cases={
 async 'disabled foundation imports do not require crypto or initialize a queue'(){
  const saved=crypto.randomUUID;let calls=0;crypto.randomUUID=()=>{calls++;throw new Error('Unavailable capability');};
  try{await import('/src/features/roster/queue/draftQueue.js?disabled-import');equal(calls,0);}finally{crypto.randomUUID=saved;}
 },

 async 'delayed IndexedDB reload cannot replace a newer local operation state'(){
  const a=await setup(),old=await a.store.all(),original=a.store.all.bind(a.store);let release;const gate=new Promise(r=>{release=r;});
  a.store.all=async()=>{await gate;return old;};const loading=a.q.reload();await a.q.enqueue(key,[patch('NEW')]);release();await loading;equal(a.q.view(key).cells[cell][0].rawShift,'NEW');a.store.all=original;a.close();
 },

 async 'stale in-memory view never adopts a newer shared IndexedDB revision at enqueue'(){
  const a=await setup(),b=await setup({repo:a.repo,name:a.name});await a.q.enqueue(key,[patch('FIRST')]);a.advance();await a.q.tick();
  await b.q.enqueue(key,[patch('LOCAL')]);const record=await b.store.read(key);equal(record.operations[1].expectedRevision,0);equal(record.operations[1].status,'CONFLICT');equal(record.baseline.revision,1);a.close();b.close();
 },
 async 'manual Retry cannot overtake an unresolved earlier operation'(){
  const a=await setup(),b=await setup({repo:a.repo,name:a.name});await a.q.enqueue(key,[patch('FIRST')]);const second=await b.q.enqueue(key,[patch('SECOND')]);let denied=false;try{await b.q.retry(key,second);}catch(e){denied=e.code==='REVISION_CONFLICT';}assert(denied);equal(a.repo.calls.length,0);a.close();b.close();
 },
 async 'bad snapshot checksum cannot replace confirmed or optimistic cells'(){
  const a=await setup();await a.q.enqueue(key,[patch('LOCAL')]);a.repo.read=async()=>({ok:true,entityKey:key,revision:4,checksum:'wrong',cells:{}});let denied=false;try{await a.q.refresh(key);}catch{denied=true;}assert(denied);equal(a.q.view(key).cells[cell][0].rawShift,'LOCAL');equal(a.q.view(key).baseline.revision,0);a.close();
 },
 async 'stopping for navigation retains non-durable intent and its unload guard'(){
  const target={events:new Set(),addEventListener:n=>target.events.add(n),removeEventListener:n=>target.events.delete(n)};
  const a=await setup({options:{target}});a.store.update=async()=>{throw Error('Storage blocked');};try{await a.q.enqueue(key,[patch('UNSAVED')]);}catch{}
  a.q.stop();assert(target.events.has('beforeunload'));equal(a.q.view(key).cells[cell][0].rawShift,'UNSAVED');for(const id of a.q.unsafe.keys())a.q.discardUnsafe(id);assert(!target.events.has('beforeunload'));a.close();
 },

 async 'real IndexedDB restart preserves unsent proposal and last-confirmed baseline'(){
  const a=await setup();const id=await a.q.enqueue(key,[patch()]);a.close();
  const b=await setup({repo:a.repo,name:a.name});equal(b.q.view(key).cells[cell][0].rawShift,'AM');equal(b.q.view(key).operations[0].operationId,id);equal(b.q.view(key).operations[0].status,'QUEUED');equal(b.q.view(key).baseline.revision,0);
  b.advance();await b.q.tick();equal(b.q.view(key).baseline.revision,1);b.close();
  const c=await setup({repo:a.repo,name:a.name});equal(c.q.view(key).baseline.cells[cell][0].rawShift,'AM');equal(c.q.view(key).operations[0].status,'CONFIRMED');c.close();
 },
 async 'coalescing batches unsent cells but retains multiple assignment occurrences'(){
  const a=await setup();const id=await a.q.enqueue(key,[patch(['AM','PM'])]);const same=await a.q.enqueue(key,[patch(['AM','PN'])]);await a.q.enqueue(key,[patch(['EP_OFFICE_HOUR','EP_ONCALL'],'2030-07-02')]);equal(id,same);equal(a.q.view(key).operations.length,1);
  a.advance();await a.q.tick();equal(a.repo.calls.filter(c=>c[0]==='write').length,1);equal(a.q.view(key).baseline.cells[cell].map(x=>x.rawShift),['AM','PN']);equal(Object.keys(a.q.view(key).baseline.cells).length,2);a.close();
 },
 async 'same-entity rapid edits cannot send in reverse order or let a delayed response overwrite C'(){
  const a=await setup();let release;const gate=new Promise(r=>{release=r;});a.repo.setHold(gate);
  const first=await a.q.enqueue(key,[patch('B')]);a.advance();const pending=a.q.tick();await waitFor(()=>a.repo.calls.some(c=>c[0]==='write'));
  const second=await a.q.enqueue(key,[patch('C')]);assert(first!==second);a.advance();await a.q.tick();equal(a.repo.calls.filter(c=>c[0]==='write').length,1);
  release();await pending;a.repo.setHold(null);a.advance();await a.q.tick();equal(a.q.view(key).cells[cell][0].rawShift,'C');equal(a.q.view(key).baseline.revision,2);
  await a.q.handle(key,first,await a.repo.status(first));equal(a.q.view(key).cells[cell][0].rawShift,'C');a.close();
 },
 async 'independent entities proceed while one is awaiting its response'(){
  const a=await setup();let release;const gate=new Promise(r=>{release=r;}),original=a.repo.write;
  a.repo.write=async op=>{if(op.entityKey===key)await gate;return original(op);};
  await a.q.enqueue(key,[patch()]);const other='draft:2030-08';await a.q.refresh(other);await a.q.enqueue(other,[patch('PM','2030-08-01')]);a.advance();const run=a.q.tick();
  await waitFor(()=>a.repo.states.get(other)?.revision===1);equal(a.repo.states.get(key).revision,0);release();await run;a.close();
 },
 async 'lost successful response is reconciled by original UUID after restart with no second write'(){
  const a=await setup();a.repo.setLose();const id=await a.q.enqueue(key,[patch()]);a.advance();await a.q.tick();equal(a.q.view(key).operations[0].status,'AWAITING_STATUS');equal((await a.repo.read(key)).revision,1);a.close();
  const b=await setup({repo:a.repo,name:a.name});b.advance();await b.q.tick();equal(b.q.view(key).operations[0].status,'CONFIRMED');equal(b.repo.calls.filter(c=>c[0]==='write').length,1);assert(b.repo.calls.some(c=>c[0]==='status'&&c[1]===id));b.close();
 },
 async 'absent ambiguous operation retries with same UUID and unchanged payload hash'(){
  const a=await setup();a.repo.setUnavailable(true);const id=await a.q.enqueue(key,[patch()]);a.advance();await a.q.tick();const hash=a.q.view(key).operations[0].payloadHash;a.repo.setUnavailable(false);a.advance();await a.q.tick();
  equal(a.repo.calls.filter(c=>c[0]==='write').map(c=>c[1]),[id,id]);equal(a.q.view(key).operations[0].payloadHash,hash);equal(a.q.view(key).baseline.revision,1);a.close();
 },
 async 'bounded retry metadata persists and exhausted attempts require visible manual recovery'(){
  const a=await setup({options:{maxAttempts:2}});a.repo.setUnavailable(true);await a.q.enqueue(key,[patch()]);a.advance();await a.q.tick();a.advance();await a.q.tick();equal(a.q.view(key).operations[0].status,'RECOVERY_REQUIRED');const count=a.repo.calls.length;a.advance();await a.q.tick();equal(a.repo.calls.length,count);a.close();
 },
 async 'revert removes only A while later B and independent cells remain visible'(){
  const a=await setup();let release;const gate=new Promise(r=>{release=r;});a.repo.setHold(gate);const id=await a.q.enqueue(key,[patch('A')]);a.advance();const run=a.q.tick();await waitFor(()=>a.repo.calls.length);
  await a.q.enqueue(key,[patch('B'),patch('PM','2030-07-02')]);a.repo.setUnavailable(true);release();await run;a.repo.setUnavailable(false);a.repo.setHold(null);
  await a.q.revert(key,id);equal(a.q.view(key).cells[cell][0].rawShift,'B');equal(a.q.view(key).cells[person+'/2030-07-02'][0].rawShift,'PM');equal(a.q.view(key).operations[0].status,'REVERTED');equal(a.q.view(key).operations[1].status,'CONFLICT');
  const op=a.q.view(key).operations[0];equal((await a.repo.write(op)).status,'FAILED');a.close();
 },
 async 'revert cannot hide an already committed ambiguous operation'(){
  const a=await setup();a.repo.setLose();const id=await a.q.enqueue(key,[patch()]);a.advance();await a.q.tick();let rejected=false;try{await a.q.revert(key,id);}catch{rejected=true;}assert(rejected);equal(a.q.view(key).operations[0].status,'CONFIRMED');equal(a.q.view(key).cells[cell][0].rawShift,'AM');a.close();
 },
 async 'new external refresh preserves pending intent and surfaces conflict; stale refresh is ignored'(){
  const a=await setup();await a.q.enqueue(key,[patch('LOCAL')]);const other={operationId:crypto.randomUUID(),clientId:crypto.randomUUID(),tabId:crypto.randomUUID(),operationType:'DRAFT_PATCH',entityKey:key,expectedRevision:0,payload:{patches:[patch('REMOTE')]}};other.payloadHash=await sha256(protocol.canonical(protocol.payload(other)));await a.repo.write(other);await a.q.refresh(key);
  equal(a.q.view(key).cells[cell][0].rawShift,'LOCAL');equal(a.q.view(key).baseline.cells[cell][0].rawShift,'REMOTE');equal(a.q.view(key).operations[0].status,'CONFLICT');
  const original=a.repo.read;a.repo.read=async()=>({ok:true,entityKey:key,revision:0,cells:{},checksum:await sha256(protocol.canonical({}))});await a.q.refresh(key);equal(a.q.view(key).baseline.revision,1);a.repo.read=original;a.close();
 },
 async 'two browser clients editing revision zero cannot silently overwrite the first confirmation'(){
  const a=await setup(),b=await setup({repo:a.repo});await a.q.enqueue(key,[patch('FIRST')]);await b.q.enqueue(key,[patch('SECOND')]);a.advance();await a.q.tick();b.advance();await b.q.tick();equal(b.q.view(key).operations[0].status,'CONFLICT');equal((await a.repo.read(key)).cells[cell][0].rawShift,'FIRST');equal(b.q.view(key).cells[cell][0].rawShift,'SECOND');a.close();b.close();
 },
 async 'same IndexedDB tabs share client ID but not TabId, do not coalesce foreign edits'(){
  const a=await setup(),b=await setup({repo:a.repo,name:a.name});equal(a.q.clientId,b.q.clientId);assert(a.q.tabId!==b.q.tabId);
  await a.q.enqueue(key,[patch('FIRST')]);await b.q.enqueue(key,[patch('SECOND')]);equal((await a.store.read(key)).operations.length,2);a.advance();await a.q.tick();await b.q.reload();equal(b.q.view(key).operations[1].status,'CONFLICT');equal(b.q.view(key).cells[cell][0].rawShift,'SECOND');a.close();b.close();
 },
 async 'recovery-required operations survive restart and never appear saved'(){
  const a=await setup();a.repo.setPartial();const id=await a.q.enqueue(key,[patch()]);a.advance();await a.q.tick();equal(a.q.view(key).operations[0].status,'RECOVERY_REQUIRED');equal(a.q.view(key).baseline.revision,0);a.close();
  const b=await setup({repo:a.repo,name:a.name});equal(b.q.view(key).operations[0].status,'RECOVERY_REQUIRED');await b.q.retry(key,id);equal(b.q.view(key).operations[0].status,'RECOVERY_REQUIRED');b.close();
 },
 async 'feature defaults prevent enqueue and dispatch, including pending records restored while disabled'(){
  const a=await setup();await a.q.enqueue(key,[patch()]);a.close();const b=await setup({repo:a.repo,name:a.name,flags:{}});let denied=false;try{await b.q.enqueue(key,[patch()]);}catch(e){denied=e.code==='FEATURE_DISABLED';}assert(denied);b.advance();await b.q.tick();equal(a.repo.calls.length,0);b.close();
 },
 async 'transaction abort retains local intent and unload warning until durability retry succeeds'(){
  const target={events:new Set(),addEventListener(name){this.events.add(name);},removeEventListener(name){this.events.delete(name);}};
  const a=await setup({options:{target}}),original=a.store.update.bind(a.store);a.store.update=async()=>{throw Error('Quota');};let failed=false;
  try{await a.q.enqueue(key,[patch()]);}catch{failed=true;}assert(failed);assert(target.events.has('beforeunload'));equal(a.q.view(key).cells[cell][0].rawShift,'AM');
  a.store.update=original;await a.q.retryPersistence();assert(!target.events.has('beforeunload'));equal(a.q.view(key).operations[0].status,'QUEUED');a.close();
 },
 async 'actual IndexedDB transaction rejects async mutations and preserves previous value'(){
  const a=await setup();let rejected=false;try{await a.store.update(key,async e=>({...e,sequence:999}));}catch{rejected=true;}assert(rejected);equal((await a.store.read(key)).sequence,0);a.close();
 },
 async 'BroadcastChannel sends metadata only; fallback storage listener is removable'(){
  let received;const name='test-signal-'+crypto.randomUUID();const a=createSignals(()=>{},{name}),b=createSignals(m=>{received=m;},{name});a.send(key,'confirmed');await waitFor(()=>received);equal(received.entityKey,key);assert(!JSON.stringify(received).includes('assignments'));a.close();b.close();
  const events=new Map(),writes=[];const target={addEventListener:(k,fn)=>events.set(k,fn),removeEventListener:k=>events.delete(k),localStorage:{setItem:(k,v)=>writes.push([k,v])}};
  const c=createSignals(m=>{received=m;},{name,Broadcast:null,target});c.send(key,'queued');events.get('storage')({key:name,newValue:writes[0][1]});equal(received.event,'queued');c.close();equal(events.size,0);
 },
 async 'beforeunload exists only while nondurable edits are at risk'(){
  const events=new Set(),guard=unloadGuard({addEventListener:n=>events.add(n),removeEventListener:n=>events.delete(n)});guard(false);equal(events.size,0);guard(true);guard(true);equal(events.size,1);guard(false);equal(events.size,0);
 },
 async 'startup reconciles a persisted SENDING operation before any replay'(){
  const a=await setup();const id=await a.q.enqueue(key,[patch()]);a.advance();await a.q.tick();await a.store.update(key,e=>{e.operations[0].status='SENDING';return e;});a.close();
  const b=await setup({repo:a.repo,name:a.name});await b.q.start();b.q.stop();equal(b.q.view(key).operations[0].status,'CONFIRMED');equal(b.repo.calls.filter(c=>c[0]==='write').length,1);assert(b.repo.calls.some(c=>c[0]==='status'&&c[1]===id));b.close();
 }
};

Object.assign(cases,{
 async 'review: simultaneous manual reconciliation calls serialize and return one confirmed effect'(){
  const a=await setup();a.repo.setLose();const id=await a.q.enqueue(key,[patch('ONE')]);a.advance();await a.q.tick();let release,entered=false;const gate=new Promise(r=>{release=r;}),status=a.repo.status;
  a.repo.status=async id=>{entered=true;await gate;return status(id);};const first=a.q.retry(key,id);await waitFor(()=>entered);const second=a.q.retry(key,id);release();await Promise.all([first,second]);
  equal(a.repo.calls.filter(c=>c[0]==='status').length,1);equal(a.repo.calls.filter(c=>c[0]==='write').length,1);equal(a.q.view(key).operations[0].status,'CONFIRMED');equal(a.q.view(key).baseline.revision,1);a.close();
 },
 async 'review: restart between durable send freeze and hashing checks status before the original-ID send'(){
  const a=await setup();const id=await a.q.enqueue(key,[patch('FROZEN')]);await a.store.update(key,e=>{Object.assign(e.operations[0],{status:'SENDING',everSent:true,attemptCount:1});return e;});a.close();
  const b=await setup({repo:a.repo,name:a.name});await b.q.start();b.q.stop();equal(b.repo.calls.map(c=>c[0]),['status','write']);equal(b.repo.calls.map(c=>c[1]),[id,id]);equal(b.q.view(key).operations[0].status,'CONFIRMED');equal(b.q.view(key).baseline.revision,1);b.close();
 },
 async 'review: overlapping startup creates one scheduler and stop removes it'(){
  const a=await setup();let release;const gate=new Promise(r=>{release=r;}),all=a.store.all.bind(a.store);a.store.all=async()=>{await gate;return all();};
  const start=setInterval,clear=clearInterval,active=new Set();globalThis.setInterval=(...args)=>{const id=start(...args);active.add(id);return id;};globalThis.clearInterval=id=>{active.delete(id);return clear(id);};
  try{const first=a.q.start(),second=a.q.start();release();await Promise.all([first,second]);equal(active.size,1);a.q.stop();equal(active.size,0);}finally{for(const id of active)clear(id);globalThis.setInterval=start;globalThis.clearInterval=clear;a.close();}
 },
 async 'review: unsupported record schema remains intact and blocked startup never sends'(){
  const a=await setup();await a.q.enqueue(key,[patch('LOCAL')]);await a.store.update(key,e=>({...e,schemaVersion:2}));const q=new DraftQueue({store:a.store,repository:a.repo,settings,tabId:crypto.randomUUID()});
  try{let error;try{await q.start();}catch(e){error=e.message;}equal(error,'OUTBOX_SCHEMA_UNSUPPORTED');equal((await a.store.read(key)).schemaVersion,2);equal(a.repo.calls.length,0);}finally{q.stop();a.close();}
 },
 async 'review: failed persistence followed by a newer edit cannot restore the older value on retry'(){
  const a=await setup(),update=a.store.update.bind(a.store);let fail=true;a.store.update=async(...args)=>{if(fail){fail=false;throw Error('Quota');}return update(...args);};
  try{await a.q.enqueue(key,[patch('A')]);}catch{}
  try{await a.q.enqueue(key,[patch('B')]);}catch{}
  equal(a.q.view(key).cells[cell][0].rawShift,'B');await a.q.retryPersistence();equal(a.q.view(key).cells[cell][0].rawShift,'B');
  a.advance();await a.q.tick();equal((await a.repo.read(key)).cells[cell][0].rawShift,'B');a.close();
 },
 async 'review: malformed persisted entities are retained but cannot dispatch or appear confirmed'(){
  for(const corrupt of [e=>e.operations[0].status='UNKNOWN',e=>e.operations[0].status='CONFIRMED',e=>e.operations[0].payload=null,e=>e.baseline.revision='0',e=>e.sequence=0,e=>e.operations.push({...e.operations[0]})]){
   const a=await setup();await a.q.enqueue(key,[patch('LOCAL')]);await a.store.update(key,e=>{corrupt(e);return e;});const saved=JSON.stringify(await a.store.read(key));
   const q=new DraftQueue({store:a.store,repository:a.repo,settings,tabId:crypto.randomUUID()});let rejected=false;try{await q.start();}catch{rejected=true;}finally{q.stop();}
   assert(rejected,'Malformed record must block startup');equal(a.repo.calls.length,0);equal(JSON.stringify(await a.store.read(key)),saved);assert(q.localError);a.close();
  }
 },
 async 'review: corrupted sent payload cannot be silently rehashed and retransmitted'(){
  const a=await setup();a.repo.setUnavailable(true);await a.q.enqueue(key,[patch('ORIGINAL')]);a.advance();await a.q.tick();a.repo.setUnavailable(false);
  await a.store.update(key,e=>{e.operations[0].payload.patches[0].assignments[0].rawShift='CHANGED';return e;});const count=a.repo.calls.length;
  let rejected=false;try{a.advance();await a.q.tick();}catch{rejected=true;}assert(rejected);equal(a.repo.calls.length,count);equal((await a.repo.read(key)).revision,0);a.close();
 },
 async 'review: three same-entity operations preserve A B C order through response loss and duplicate reconciliation'(){
  const a=await setup();let releaseA;const gateA=new Promise(r=>{releaseA=r;});a.repo.setHold(gateA);a.repo.setLose();
  const A=await a.q.enqueue(key,[patch('A')]);a.advance();const first=a.q.tick();await waitFor(()=>a.repo.calls.length);
  const B=await a.q.enqueue(key,[patch('B')]);releaseA();await first;a.repo.setHold(null);
  a.advance();await Promise.all([a.q.tick(),a.q.tick()]);equal(a.q.view(key).operations[0].status,'CONFIRMED');
  let releaseB;const gateB=new Promise(r=>{releaseB=r;});a.repo.setHold(gateB);a.advance();const second=a.q.tick();await waitFor(()=>a.repo.calls.some(c=>c[0]==='write'&&c[1]===B));
  const C=await a.q.enqueue(key,[patch('C')]);releaseB();await second;a.repo.setHold(null);a.advance();await a.q.tick();
  equal(a.q.view(key).operations.map(o=>o.operationId),[A,B,C]);equal(a.q.view(key).operations.map(o=>o.status),['CONFIRMED','CONFIRMED','CONFIRMED']);equal(a.q.view(key).baseline.revision,3);equal(a.q.view(key).cells[cell][0].rawShift,'C');
  await a.q.handle(key,B,await a.repo.status(B));await a.q.handle(key,A,await a.repo.status(A));equal(a.q.view(key).cells[cell][0].rawShift,'C');equal(a.repo.calls.filter(c=>c[0]==='write').map(c=>c[1]),[A,B,C]);a.close();
 },
 async 'review: revision five two-client race with delayed signals requires explicit review and new edit'(){
  const a=await setup();for(let i=0;i<5;i++){await a.q.enqueue(key,[patch('BASE'+i)]);a.advance();await a.q.tick();}
  const b=await setup({repo:a.repo});await a.q.enqueue(key,[patch('A')]);const id=await b.q.enqueue(key,[patch('B')]);b.advance();await b.q.tick();a.advance();await a.q.tick();
  equal((await a.repo.read(key)).revision,6);equal(a.q.view(key).operations.at(-1).status,'CONFLICT');equal(a.q.view(key).cells[cell][0].rawShift,'A');
  const rejected=a.q.view(key).operations.at(-1).operationId;let blocked=false;try{await a.q.retry(key,rejected);}catch{blocked=true;}assert(blocked);
  await a.q.refresh(key);await a.q.revert(key,rejected);const reviewed=await a.q.enqueue(key,[patch('REVIEWED')]);assert(reviewed!==rejected&&reviewed!==id);a.advance();await a.q.tick();equal((await a.repo.read(key)).revision,7);equal((await a.repo.read(key)).cells[cell][0].rawShift,'REVIEWED');a.close();b.close();
 },
 async 'review: malformed channel messages and duplicates cannot mark a server operation confirmed'(){
  const a=await setup();await a.q.enqueue(key,[patch('LOCAL')]);const name='review-signals-'+crypto.randomUUID();const sender=new BroadcastChannel(name);const receiver=createSignals(()=>a.q.reload(),{name});
  sender.postMessage(null);sender.postMessage({kind:'foreign',entityKey:key});sender.postMessage({kind:'roster-queue',entityKey:key,event:'confirmed',nonce:crypto.randomUUID()});sender.postMessage({kind:'roster-queue',entityKey:key,event:'confirmed',nonce:crypto.randomUUID()});
  await new Promise(r=>setTimeout(r,30));equal(a.q.view(key).operations[0].status,'QUEUED');equal(a.q.view(key).baseline.revision,0);equal(a.repo.calls.length,0);sender.close();receiver.close();a.close();
 },
 async 'review: offline durable edits wait for reconnect without spending retry attempts'(){
  let online=false;const a=await setup({options:{online:()=>online}});await a.q.enqueue(key,[patch('OFFLINE')]);a.advance();await a.q.tick();equal(a.repo.calls.length,0);equal(a.q.view(key).operations[0].attemptCount,0);
  online=true;await Promise.all([a.q.tick(),a.q.tick()]);equal(a.q.view(key).baseline.revision,1);equal(a.repo.calls.filter(c=>c[0]==='write').length,1);a.close();
 },
 async 'review: coalescing A B A retains the final assignment set and frozen sent meaning'(){
  const a=await setup(),p=patch(['A','PN']);const id=await a.q.enqueue(key,[p]);await a.q.enqueue(key,[{...p,assignments:p.assignments.map((x,i)=>({...x,rawShift:i?'PN':'B'}))}]);await a.q.enqueue(key,[p]);
  equal(a.q.view(key).operations.length,1);equal(a.q.view(key).cells[cell].map(x=>x.rawShift),['A','PN']);a.advance();await a.q.tick();equal((await a.repo.read(key)).cells[cell].map(x=>x.rawShift),['A','PN']);equal(a.q.view(key).operations[0].operationId,id);a.close();
 },
 async 'review: unavailable IndexedDB and blocked open reject, late success closes its connection'(){
  let rejected=false;try{await IndexedOutbox.open({indexedDB:null});}catch{rejected=true;}assert(rejected);
  const req={};let closed=0;const opening=IndexedOutbox.open({indexedDB:{open:()=>req}});req.onblocked();try{await opening;}catch{}
  req.result={close:()=>closed++};req.onsuccess();equal(closed,1);
 }
});
