import test from 'node:test';
import assert from 'node:assert/strict';
import {createPolicyMutation} from '../../src/features/roster/data/guidanceRepository.js';

const ids={clientId:'11111111-1111-4111-8111-111111111111',tabId:'22222222-2222-4222-8222-222222222222'};
function memoryStore(){let value=null;return {transaction:async(_store,_key,update)=>{if(update)value=await update(value);return value;}};}
const payload=()=>({policyId:crypto.randomUUID(),policyCode:'A',effectiveMonday:'2030-01-07',reason:'Synthetic policy'});
const confirmation=operation=>({ok:true,status:'CONFIRMED',operationId:operation.operationId,payloadHash:operation.payloadHash,result:{revision:operation.expectedRevision+1}});

test('policy mutation persists before sending and clears only a valid confirmation',async()=>{
  const store=memoryStore(),seen=[];const repository={status:async()=>({ok:true,status:'NOT_FOUND'}),save:async operation=>{seen.push({operation,persisted:await store.transaction('meta','phase3PolicyPending')});return confirmation(operation);},recover:async()=>{throw Error('unexpected');}};
  const mutation=createPolicyMutation({store,repository,...ids}),result=await mutation.save(payload(),0);
  assert.equal(result.status,'CONFIRMED');assert.equal(seen.length,1);assert.equal(seen[0].persisted.operationId,seen[0].operation.operationId);assert.equal(await mutation.pending(),null);
});

test('resume keeps the original UUID and recovers an uncertain operation',async()=>{
  const store=memoryStore(),firstRepo={status:async()=>{throw Error('network');}},first=createPolicyMutation({store,repository:firstRepo,...ids});
  const uncertain=await first.save(payload(),4);assert.equal(uncertain.status,'RECOVERY_REQUIRED');const saved=await first.pending();
  const calls=[];const repository={status:async id=>{calls.push(['status',id]);return {ok:true,status:'PENDING'};},recover:async id=>{calls.push(['recover',id]);return confirmation(saved);},save:async()=>{throw Error('unexpected');}};
  const resumed=createPolicyMutation({store,repository,...ids}),result=await resumed.resume();
  assert.equal(result.status,'CONFIRMED');assert.deepEqual(calls,[['status',saved.operationId],['recover',saved.operationId]]);assert.equal(await resumed.pending(),null);
});

test('invalid confirmation leaves durable evidence and blocks a second operation',async()=>{
  const store=memoryStore(),repository={status:async()=>({ok:true,status:'NOT_FOUND'}),save:async operation=>({...confirmation(operation),payloadHash:'0'.repeat(64)})};
  const mutation=createPolicyMutation({store,repository,...ids});await assert.rejects(mutation.save(payload(),0),/INVALID_POLICY_CONFIRMATION/);
  const saved=await mutation.pending();assert.ok(saved.operationId);await assert.rejects(mutation.save(payload(),0),/POLICY_OPERATION_PENDING/);
});
