import guidance from '../guidance.js';
import compatibility from '../compatibility.js';
import {sha256} from '../queue/draftQueue.js';

export function createGuidanceRepository({baseUrl=import.meta.env?.VITE_APPS_SCRIPT_URL,fetcher=globalThis.fetch,timeoutMs=20000}={}) {
  async function request(action,fields={},write=false){
    if(!baseUrl)throw new Error('GUIDANCE_ENDPOINT_UNCONFIGURED');const url=new URL(baseUrl),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
    const options={method:write?'POST':'GET',signal:controller.signal,cache:'no-store',credentials:'include',headers:{Accept:'application/json'}};
    if(write){options.headers['Content-Type']='text/plain;charset=UTF-8';options.body=JSON.stringify({action,...fields});}
    else for(const [key,value]of Object.entries({action,...fields}))url.searchParams.set(key,value);
    try{const response=await fetcher(url.toString(),options);if(!response.ok)throw new Error('GUIDANCE_TRANSPORT_FAILED');const result=await response.json();if(typeof result?.ok!=='boolean')throw new Error('INVALID_GUIDANCE_RESPONSE');return result;}finally{clearTimeout(timer);}
  }
  const wire=operation=>({operationId:operation.operationId,clientId:operation.clientId,tabId:operation.tabId,operationType:operation.operationType,
    entityKey:operation.entityKey,expectedRevision:operation.expectedRevision,payload:operation.payload,payloadHash:operation.payloadHash});
  return {schema:()=>request('rosterv2guidanceschema'),policies:()=>request('rosterv2offpolicies'),save:operation=>request('rosterv2offpolicy',wire(operation),true),
    status:operationId=>request('rosterv2operation',{operationId}),recover:operationId=>request('rosterv2offpolicyrecover',{operationId},true)};
}
export async function createPolicyOperation({clientId,tabId,expectedRevision,payload}){
  const operation={operationId:crypto.randomUUID(),clientId,tabId,operationType:'OFF_POLICY_UPSERT',entityKey:'off-policies',expectedRevision,payload};
  operation.payloadHash=await sha256(guidancePolicyCanonical(operation));return operation;
}
export const guidancePolicyCanonical=operation=>compatibility.canonicalJson(guidance.policyOperation(operation));

export function createPolicyMutation({store,repository,clientId,tabId}){
  const key='phase3PolicyPending';
  const persist=value=>store.transaction('meta',key,()=>value);
  const pending=()=>store.transaction('meta',key);
  const clear=()=>persist(null);
  async function reconcile(operation){
    let response;
    try{response=await repository.status(operation.operationId);}catch{return {status:'RECOVERY_REQUIRED',operation};}
    if(response.ok&&response.status==='NOT_FOUND')response=await repository.save(operation);
    if(response.ok&&['PENDING','RECOVERY_REQUIRED'].includes(response.status))response=await repository.recover(operation.operationId);
    if(response.ok&&response.status==='CONFIRMED'){
      if(response.operationId!==operation.operationId||response.payloadHash!==operation.payloadHash||response.result?.revision!==operation.expectedRevision+1)throw new Error('INVALID_POLICY_CONFIRMATION');
      await clear();return response;
    }
    if(response.ok&&response.status==='FAILED'){await clear();return response;}
    return response;
  }
  return {pending,reconcile,async resume(){const operation=await pending();return operation?reconcile(operation):null;},async save(payload,expectedRevision){if(await pending())throw new Error('POLICY_OPERATION_PENDING');
    const operation=await createPolicyOperation({clientId,tabId,expectedRevision,payload});await persist(operation);
    try{return await reconcile(operation);}catch(error){error.operationId=operation.operationId;throw error;}
  }};
}
