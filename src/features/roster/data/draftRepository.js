// Separate transport: legacy request() behavior remains untouched.
export function createDraftRepository({baseUrl=import.meta.env?.VITE_APPS_SCRIPT_URL,fetcher=globalThis.fetch,timeoutMs=20000}={}) {
  async function request(action,fields={},write=false){
    if(!baseUrl)throw new Error('DRAFT_ENDPOINT_UNCONFIGURED');
    const url=new URL(baseUrl),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
    const options={method:write?'POST':'GET',signal:controller.signal,cache:'no-store',credentials:'include',headers:{Accept:'application/json'}};
    if(write){options.headers['Content-Type']='text/plain;charset=UTF-8';options.body=JSON.stringify({action,...fields});}
    else for(const [k,v] of Object.entries({action,...fields}))url.searchParams.set(k,v);
    try{const response=await fetcher(url.toString(),options);if(!response.ok)throw new Error('DRAFT_TRANSPORT_FAILED');
      const result=await response.json();if(typeof result?.ok!=='boolean')throw new Error('INVALID_DRAFT_RESPONSE');return result;
    }finally{clearTimeout(timer);}
  }
  const wire=op=>({operationId:op.operationId,clientId:op.clientId,tabId:op.tabId,operationType:op.operationType,entityKey:op.entityKey,
    expectedRevision:op.expectedRevision,payload:op.payload,payloadHash:op.payloadHash});
  const lifecycleWire=op=>{
    const periodId=op.payload?.periodId||op.periodId||(typeof op.entityKey==='string'?op.entityKey.replace(/^(draft|period):/,''):'');
    const base={operationId:op.operationId,clientId:op.clientId,tabId:op.tabId,operationType:op.operationType,
      entityKey:`period:${periodId}`,periodId,expectedRevision:op.expectedRevision,payloadHash:op.payloadHash};
    if(op.operationType==='PERIOD_PUBLISH'){
      const draftCells=op.payload?.draftCells!==undefined?op.payload.draftCells:(op.draftCells!==undefined?op.draftCells:{});
      const adminNote=op.payload?.adminNote||op.adminNote||'';
      return {...base,draftCells,adminNote,payload:{periodId,draftCells,adminNote}};
    }
    if(op.operationType==='PERIOD_CLOSE'){
      const adminNote=op.payload?.adminNote||op.adminNote||'';
      return {...base,adminNote,payload:{periodId,adminNote}};
    }
    if(op.operationType==='PERIOD_REOPEN'){
      const reason=op.payload?.reason||op.reason||'';
      return {...base,reason,payload:{periodId,reason}};
    }
    return {...base,payload:op.payload};
  };
  return {
    schema:()=>request('rosterv2draftschema'),
    read:entityKey=>request('rosterv2draft',{entityKey}),
    write:op=>request('rosterv2draftpatch',wire(op),true),
    status:operationId=>request('rosterv2operation',{operationId}),
    recover:operationId=>request('rosterv2draftrecover',{operationId},true),
    abandon:op=>request('rosterv2draftabandon',wire(op),true),
    getPeriodLifecycle:periodId=>request('rosterv2periodlifecycle',{periodId}),
    lifecycleSchema:()=>request('rosterv2lifecycleschema'),
    publish:op=>request('rosterv2publish',lifecycleWire(op),true),
    close:op=>request('rosterv2close',lifecycleWire(op),true),
    reopen:op=>request('rosterv2reopen',lifecycleWire(op),true),
    recoverLifecycle:operationId=>request('rosterv2lifecyclerecover',{operationId},true)
  };
}
