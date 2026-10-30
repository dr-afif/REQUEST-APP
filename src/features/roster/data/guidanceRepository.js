import guidance from '../guidance.js';
import compatibility from '../compatibility.js';
import {sha256} from '../queue/draftQueue.js';
import {getAdminSessionToken as defaultGetAdminSessionToken} from '../auth/adminAuth.js';

export function createGuidanceRepository({baseUrl=import.meta.env?.VITE_APPS_SCRIPT_URL,fetcher=globalThis.fetch,timeoutMs=20000,getAdminSessionToken=defaultGetAdminSessionToken,getIdToken=null,maxReadRetries=2,readRetryDelayMs=250}={}) {
  const inFlightReads = new Map();

  async function executeSingleFetch(action, reqFields, isPost) {
    if(!baseUrl)throw new Error('GUIDANCE_ENDPOINT_UNCONFIGURED');
    const url=new URL(baseUrl),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
    const options={method:isPost?'POST':'GET',signal:controller.signal,cache:'no-store',headers:{Accept:'application/json'}};
    if(isPost){options.headers['Content-Type']='text/plain;charset=UTF-8';options.body=JSON.stringify({action,...reqFields});}
    else for(const [key,value]of Object.entries({action,...reqFields}))url.searchParams.set(key,value);
    try{
      const response=await fetcher(url.toString(),options);
      if(!response.ok)throw new Error('GUIDANCE_TRANSPORT_FAILED');
      const result=await response.json();
      if(typeof result?.ok!=='boolean')throw new Error('INVALID_GUIDANCE_RESPONSE');
      return result;
    }finally{clearTimeout(timer);}
  }

  async function request(action,fields={},write=false){
    let token = null;
    try {
      if (typeof getAdminSessionToken === 'function') token = await getAdminSessionToken();
      else if (typeof getIdToken === 'function') token = await getIdToken();
      else token = fields.adminSessionToken || fields.idToken || null;
    } catch (_) {}
    const reqFields = token ? { ...fields, adminSessionToken: token } : fields;
    const isPost = write || (Boolean(token) && ['rosterv2offpolicies','rosterv2guidanceschema'].includes(action));

    if (write) {
      return executeSingleFetch(action, reqFields, true);
    }

    const flightKey = `${action}:${JSON.stringify(fields)}`;
    if (inFlightReads.has(flightKey)) {
      return inFlightReads.get(flightKey);
    }

    const readPromise = (async () => {
      let attempt = 0;
      while (true) {
        attempt++;
        try {
          const result = await executeSingleFetch(action, reqFields, isPost);
          if (result.ok) {
            return result;
          }
          const errCode = result.error?.code;
          const isRetryable = result.error?.retryable === true || ['LOCK_BUSY', 'TRANSIENT_BACKEND'].includes(errCode);
          if (isRetryable && attempt <= maxReadRetries) {
            const delay = readRetryDelayMs * attempt;
            await new Promise(r => setTimeout(r, delay));
            continue;
          }
          return result;
        } catch (err) {
          const isTransport = err.message === 'GUIDANCE_TRANSPORT_FAILED' || err.name === 'AbortError';
          if (isTransport && attempt <= maxReadRetries) {
            const delay = readRetryDelayMs * attempt;
            await new Promise(r => setTimeout(r, delay));
            continue;
          }
          throw err;
        }
      }
    })().finally(() => {
      inFlightReads.delete(flightKey);
    });

    inFlightReads.set(flightKey, readPromise);
    return readPromise;
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
