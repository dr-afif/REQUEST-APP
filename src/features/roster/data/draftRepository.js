// Separate transport: legacy request() behavior remains untouched.
import { isSessionTokenActive, subscribeAdminAuth } from '../auth/adminAuth.js';

// Module-scoped shared in-flight read broker across independent repository instances.
// READS ONLY: mutations strictly bypass this broker and are never coalesced.
const sharedInFlightReads = new Map();

// Module-scoped session staff directory cache (in-memory only).
// Retains verified directory after first authorized read, invalidating on auth revocation.
let sessionStaffDirectory = null;

if (typeof subscribeAdminAuth === 'function') {
  subscribeAdminAuth(() => {
    if (!isSessionTokenActive()) {
      sessionStaffDirectory = null;
    }
  });
}

export function getCachedStaffDirectory() {
  if (!isSessionTokenActive()) return null;
  return (sessionStaffDirectory && Array.isArray(sessionStaffDirectory.people))
    ? sessionStaffDirectory.people
    : null;
}

export function getCachedSchema() {
  if (!isSessionTokenActive()) return null;
  return sessionStaffDirectory;
}

export function setCachedStaffDirectory(schemaOrPeople) {
  if (!isSessionTokenActive()) return;
  if (Array.isArray(schemaOrPeople)) {
    sessionStaffDirectory = { ok: true, people: schemaOrPeople };
  } else if (schemaOrPeople && Array.isArray(schemaOrPeople.people)) {
    sessionStaffDirectory = schemaOrPeople;
  }
}

export function clearCachedStaffDirectory() {
  sessionStaffDirectory = null;
}

export function _clearSharedInFlightReads() {
  sharedInFlightReads.clear();
}

function buildFlightKey(baseUrl, action, fields = {}, token = null) {
  let normUrl = '';
  try {
    normUrl = new URL(baseUrl).toString();
  } catch (_) {
    normUrl = String(baseUrl || '');
  }

  // Canonicalize fields by sorting keys, omitting secrets
  const cleanFields = {};
  for (const k of Object.keys(fields).sort()) {
    if (k !== 'adminSessionToken' && k !== 'idToken') {
      cleanFields[k] = fields[k];
    }
  }

  // Distinguish authenticated vs unauthenticated context using an opaque non-secret discriminator
  const authScope = token ? 'auth' : 'anon';

  return `${normUrl}|${authScope}|${action}|${JSON.stringify(cleanFields)}`;
}

export function createDraftRepository({baseUrl=import.meta.env?.VITE_APPS_SCRIPT_URL,fetcher=globalThis.fetch,timeoutMs=20000,getAdminSessionToken=null,getIdToken=null,maxReadRetries=2,readRetryDelayMs=250}={}) {
  async function executeSingleFetch(action, reqFields, isPost) {
    if(!baseUrl)throw new Error('DRAFT_ENDPOINT_UNCONFIGURED');
    const url=new URL(baseUrl),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
    const options={method:isPost?'POST':'GET',signal:controller.signal,cache:'no-store',headers:{Accept:'application/json'}};
    if(isPost){options.headers['Content-Type']='text/plain;charset=UTF-8';options.body=JSON.stringify({action,...reqFields});}
    else for(const [k,v] of Object.entries({action,...reqFields}))url.searchParams.set(k,v);
    try{
      const response=await fetcher(url.toString(),options);
      if(!response.ok)throw new Error('DRAFT_TRANSPORT_FAILED');
      const result=await response.json();
      if(typeof result?.ok!=='boolean')throw new Error('INVALID_DRAFT_RESPONSE');
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
    const isPost = write || (Boolean(token) && ['rosterv2draft','rosterv2draftschema'].includes(action));

    // Mutations are NEVER coalesced and NEVER retried at repository level
    if (write) {
      return executeSingleFetch(action, reqFields, true);
    }

    // Coalesce concurrent identical in-flight read requests across all repository instances
    const flightKey = buildFlightKey(baseUrl, action, fields, token);
    if (sharedInFlightReads.has(flightKey)) {
      return sharedInFlightReads.get(flightKey);
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
          const isTransport = err.message === 'DRAFT_TRANSPORT_FAILED' || err.name === 'AbortError';
          if (isTransport && attempt <= maxReadRetries) {
            const delay = readRetryDelayMs * attempt;
            await new Promise(r => setTimeout(r, delay));
            continue;
          }
          throw err;
        }
      }
    })().finally(() => {
      sharedInFlightReads.delete(flightKey);
    });

    sharedInFlightReads.set(flightKey, readPromise);
    return readPromise;
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
    if(op.operationType==='PERIOD_AMEND'){
      const semanticPayload=op.payload?.payload||op.payload||{};
      return {
        ...base,
        payloadHash:op.payloadHash,
        payload:semanticPayload,
        eventType:semanticPayload.eventType,
        personId:semanticPayload.personId,
        date:semanticPayload.date,
        dutyDomain:semanticPayload.dutyDomain,
        afterAssignments:semanticPayload.afterAssignments,
        person1:semanticPayload.person1,
        person2:semanticPayload.person2,
        publicReasonCode:semanticPayload.publicReasonCode,
        adminNote:semanticPayload.adminNote
      };
    }
    if(op.operationType==='PERIOD_AMEND_REVERSAL'){
      const semanticPayload=op.payload?.payload||op.payload||{};
      return {
        ...base,
        payloadHash:op.payloadHash,
        payload:semanticPayload,
        targetEventId:semanticPayload.targetEventId,
        adminNote:semanticPayload.adminNote
      };
    }
    if(op.operationType==='ABSENCE_CREATE'){
      const semanticPayload=op.payload?.payload||op.payload||{};
      return {
        ...base,
        payloadHash:op.payloadHash,
        payload:semanticPayload,
        personId:semanticPayload.personId,
        absenceType:semanticPayload.absenceType,
        startDate:semanticPayload.startDate,
        endDate:semanticPayload.endDate,
        dutyDomain:semanticPayload.dutyDomain,
        publicReason:semanticPayload.publicReason,
        adminNote:semanticPayload.adminNote,
        shortageAccepted:semanticPayload.shortageAccepted,
        shortageReason:semanticPayload.shortageReason
      };
    }
    if(op.operationType==='REPLACEMENT_CREATE'){
      const semanticPayload=op.payload?.payload||op.payload||{};
      return {
        ...base,
        payloadHash:op.payloadHash,
        payload:semanticPayload,
        absenceId:semanticPayload.absenceId,
        originalAssignmentId:semanticPayload.originalAssignmentId,
        replacementPersonId:semanticPayload.replacementPersonId,
        date:semanticPayload.date,
        dutyDomain:semanticPayload.dutyDomain,
        shiftCode:semanticPayload.shiftCode,
        publicReason:semanticPayload.publicReason,
        adminNote:semanticPayload.adminNote
      };
    }
    if(op.operationType==='ABSENCE_REVERSE'){
      const semanticPayload=op.payload?.payload||op.payload||{};
      return {
        ...base,
        payloadHash:op.payloadHash,
        payload:semanticPayload,
        absenceId:semanticPayload.absenceId,
        adminNote:semanticPayload.adminNote
      };
    }
    if(op.operationType==='REPLACEMENT_REVERSE'){
      const semanticPayload=op.payload?.payload||op.payload||{};
      return {
        ...base,
        payloadHash:op.payloadHash,
        payload:semanticPayload,
        replacementId:semanticPayload.replacementId,
        adminNote:semanticPayload.adminNote,
        shortageAccepted:semanticPayload.shortageAccepted,
        shortageReason:semanticPayload.shortageReason
      };
    }
    if(op.operationType==='ENTITLEMENT_EARN_GOFF'){
      const semanticPayload=op.payload?.payload||op.payload||{};
      return {
        ...base,
        payloadHash:op.payloadHash,
        payload:semanticPayload,
        personId:semanticPayload.personId,
        date:semanticPayload.date,
        adminNote:semanticPayload.adminNote
      };
    }
    if(op.operationType==='ENTITLEMENT_EARN_GHKA'){
      const semanticPayload=op.payload?.payload||op.payload||{};
      return {
        ...base,
        payloadHash:op.payloadHash,
        payload:semanticPayload,
        personId:semanticPayload.personId,
        date:semanticPayload.date,
        adminNote:semanticPayload.adminNote
      };
    }
    if(op.operationType==='ENTITLEMENT_CREDIT_MANUAL'){
      const semanticPayload=op.payload?.payload||op.payload||{};
      return {
        ...base,
        payloadHash:op.payloadHash,
        payload:semanticPayload,
        personId:semanticPayload.personId,
        entitlementType:semanticPayload.entitlementType,
        amount:semanticPayload.amount,
        effectiveDate:semanticPayload.effectiveDate,
        reasonCode:semanticPayload.reasonCode,
        adminNote:semanticPayload.adminNote
      };
    }
    if(op.operationType==='ENTITLEMENT_CONSUME'){
      const semanticPayload=op.payload?.payload||op.payload||{};
      return {
        ...base,
        payloadHash:op.payloadHash,
        payload:semanticPayload,
        personId:semanticPayload.personId,
        entitlementType:semanticPayload.entitlementType,
        date:semanticPayload.date,
        expectedRevision:semanticPayload.expectedRevision!==undefined?semanticPayload.expectedRevision:op.expectedRevision,
        adminNote:semanticPayload.adminNote
      };
    }
    if(op.operationType==='ENTITLEMENT_CREDIT_REVERSAL'){
      const semanticPayload=op.payload?.payload||op.payload||{};
      return {
        ...base,
        payloadHash:op.payloadHash,
        payload:semanticPayload,
        transactionId:semanticPayload.transactionId,
        adminNote:semanticPayload.adminNote
      };
    }
    if(op.operationType==='ENTITLEMENT_CONSUMPTION_REVERSAL'){
      const semanticPayload=op.payload?.payload||op.payload||{};
      return {
        ...base,
        payloadHash:op.payloadHash,
        payload:semanticPayload,
        transactionId:semanticPayload.transactionId,
        expectedRevision:semanticPayload.expectedRevision!==undefined?semanticPayload.expectedRevision:op.expectedRevision,
        adminNote:semanticPayload.adminNote
      };
    }
    return {...base,payload:op.payload};
  };
  return {
    schema:async(options={})=>{
      const forceRefresh = Boolean(options?.forceRefresh);
      if(!forceRefresh && isSessionTokenActive() && sessionStaffDirectory && Array.isArray(sessionStaffDirectory.people)){
        return sessionStaffDirectory;
      }
      const res = await request('rosterv2draftschema');
      if(res?.ok && Array.isArray(res.people) && isSessionTokenActive()){
        sessionStaffDirectory = res;
      }
      return res;
    },
    getCachedSchema:()=>getCachedSchema(),
    getCachedPeople:()=>getCachedStaffDirectory(),
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
    recoverLifecycle:operationId=>request('rosterv2lifecyclerecover',{operationId},true),
    amend:op=>request('rosterv2amend',lifecycleWire(op),true),
    reverseAmendment:op=>request('rosterv2amendreversal',lifecycleWire(op),true),
    getAmendmentHistory:periodId=>request('rosterv2amendmenthistory',typeof periodId==='object'?periodId:{periodId}),
    createAbsence:op=>request('rosterv2absencecreate',lifecycleWire(op),true),
    createReplacement:op=>request('rosterv2replacementcreate',lifecycleWire(op),true),
    reverseAbsence:op=>request('rosterv2absencereverse',lifecycleWire(op),true),
    reverseReplacement:op=>request('rosterv2replacementreverse',lifecycleWire(op),true),
    recoverAbsence:operationId=>request('rosterv2absencerecover',{operationId},true),
    recoverReplacement:operationId=>request('rosterv2replacementrecover',{operationId},true),
    getAbsences:periodId=>request('rosterv2absences',typeof periodId==='object'?periodId:{periodId}),
    getReplacements:periodId=>request('rosterv2replacements',typeof periodId==='object'?periodId:{periodId}),
    earnGoff:op=>request('rosterv2entitlementearngoff',lifecycleWire(op),true),
    earnGhka:op=>request('rosterv2entitlementearnghka',lifecycleWire(op),true),
    creditManual:op=>request('rosterv2entitlementcreditmanual',lifecycleWire(op),true),
    consumeEntitlement:op=>request('rosterv2entitlementconsume',lifecycleWire(op),true),
    reverseCredit:op=>request('rosterv2entitlementcreditreverse',lifecycleWire(op),true),
    reverseConsumption:op=>request('rosterv2entitlementconsumereverse',lifecycleWire(op),true),
    recoverEntitlement:operationId=>request('rosterv2entitlementrecover',{operationId},true),
    getEntitlementBalances:async params=>{
      const param=typeof params==='object'?params:{personId:params};
      return request('rosterv2entitlementbalances',param);
    },
    getEntitlementTransactions:async params=>{
      const param=typeof params==='object'?params:{periodId:params};
      return request('rosterv2entitlementtransactions',param);
    },
    getPlannedRoster:async periodId=>{
      const param=typeof periodId==='object'?periodId:{periodId};
      const res=await request('rosterv2planned',param);
      if(res&&Array.isArray(res.assignments)){
        res.assignments.sort((a,b)=>
          (a.date||'').localeCompare(b.date||'')||
          (a.dutyDomain||'').localeCompare(b.dutyDomain||'')||
          (a.personId||'').localeCompare(b.personId||'')||
          (a.shiftCode||'').localeCompare(b.shiftCode||'')||
          (a.assignmentId||'').localeCompare(b.assignmentId||'')
        );
      }
      return res;
    },
    getCurrentRoster:async periodId=>{
      const param=typeof periodId==='object'?periodId:{periodId};
      const res=await request('rosterv2current',param);
      if(res&&Array.isArray(res.assignments)){
        res.assignments.sort((a,b)=>
          (a.date||'').localeCompare(b.date||'')||
          (a.dutyDomain||'').localeCompare(b.dutyDomain||'')||
          (a.personId||'').localeCompare(b.personId||'')||
          (a.shiftCode||'').localeCompare(b.shiftCode||'')||
          (a.assignmentId||'').localeCompare(b.assignmentId||'')
        );
      }
      return res;
    }
  };
}

/**
 * Pure deterministic converter from V2 draft cells state to CurrentRosterView assignment DTOs.
 * Preserves stable assignmentId, PersonId, date, dutyDomain, shiftCode, personNameSnapshot, and deterministic ordering.
 */
export function draftCellsToCurrentAssignments({ cells = {}, people = [] } = {}) {
  if (!cells || typeof cells !== 'object') return [];

  const peopleMap = new Map();
  (people || []).forEach(p => {
    const id = p.personId || p.PersonId;
    if (id) {
      peopleMap.set(id, {
        displayName: p.CurrentDisplayName || p.currentDisplayName || p.name || id,
        domain: p.DirectoryType || p.directoryType || p.dutyDomain || p.role || 'MO'
      });
    }
  });

  const assignments = [];
  const sortedCellKeys = Object.keys(cells).sort();

  for (const cellKey of sortedCellKeys) {
    const slashIdx = cellKey.indexOf('/');
    if (slashIdx === -1) continue;
    const personId = cellKey.slice(0, slashIdx);
    const date = cellKey.slice(slashIdx + 1);
    const cellAssignments = Array.isArray(cells[cellKey]) ? cells[cellKey] : [];

    const personInfo = peopleMap.get(personId);
    const personName = personInfo?.displayName || personId;
    const dutyDomain = personInfo?.domain || 'MO';

    for (const a of cellAssignments) {
      if (!a) continue;
      const shift = String(a.rawShift || a.shiftCode || '').trim();
      if (!shift) continue;

      assignments.push({
        assignmentId: a.assignmentId || `${personId}:${date}:${dutyDomain}:${shift}`,
        personId,
        personNameSnapshot: personName,
        date,
        dutyDomain: a.dutyDomain || dutyDomain,
        shiftCode: shift,
        rawShift: shift,
        Layer: 'CURRENT'
      });
    }
  }

  assignments.sort((a, b) => {
    const dateCmp = a.date.localeCompare(b.date);
    if (dateCmp !== 0) return dateCmp;
    const domainWeight = d => (d === 'MO' ? 0 : d === 'EP' ? 1 : 2);
    const dwA = domainWeight(a.dutyDomain);
    const dwB = domainWeight(b.dutyDomain);
    if (dwA !== dwB) return dwA - dwB;
    const nameCmp = (a.personNameSnapshot || '').localeCompare(b.personNameSnapshot || '');
    if (nameCmp !== 0) return nameCmp;
    return (a.assignmentId || '').localeCompare(b.assignmentId || '');
  });

  return assignments;
}

