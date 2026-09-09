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
  return {schema:()=>request('rosterv2draftschema'),read:entityKey=>request('rosterv2draft',{entityKey}),
    write:op=>request('rosterv2draftpatch',wire(op),true),status:operationId=>request('rosterv2operation',{operationId}),
    recover:operationId=>request('rosterv2draftrecover',{operationId},true),abandon:op=>request('rosterv2draftabandon',wire(op),true)};
}
