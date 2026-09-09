import RosterCompatibility from '../compatibility.js';

// Shared transport and patch contract; no I/O or future lifecycle rules.
const DraftProtocol = (() => {
  const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
  const errors = ['VALIDATION_FAILED','AUTHORIZATION_REQUIRED','FEATURE_DISABLED','ENTITY_NOT_FOUND','REVISION_CONFLICT',
    'IDEMPOTENCY_MISMATCH','LOCK_BUSY','TRANSIENT_BACKEND','PERMANENT_FAILURE','RECOVERY_REQUIRED'];
  const fail = (code, details = {}) => Object.assign(new Error(code), { code, details });
  const ensure = (ok, code = 'VALIDATION_FAILED') => { if (!ok) throw fail(code); };
  const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every(k => Object.prototype.hasOwnProperty.call(value,k));
  const enabled = settings => {
    const f = RosterCompatibility.featureSwitches(settings);
    return f.roster_v2_write_enabled && f.write_queue_v2_enabled;
  };
  function payload(operation) {
    ensure(operation && uuid(operation.operationId) && uuid(operation.clientId) && uuid(operation.tabId));
    ensure(operation.operationType === 'DRAFT_PATCH' && typeof operation.entityKey==='string' && /^draft:(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(operation.entityKey));
    const period = operation.entityKey.slice(6);
    RosterCompatibility.validatePeriod(period);
    ensure(Number.isSafeInteger(operation.expectedRevision) && operation.expectedRevision >= 0);
    ensure(exact(operation.payload,['patches']) && Array.isArray(operation.payload.patches) && operation.payload.patches.length > 0 && operation.payload.patches.length <= 100);
    const cells = new Set(), ids = new Set();
    const patches = operation.payload.patches.map(p => {
      ensure(exact(p,['personId','date','assignments']) && uuid(p.personId) &&
        /^\d{4}-\d{2}-\d{2}$/.test(p.date) && RosterCompatibility.localDate(p.date) === p.date && p.date.slice(0,7) === period);
      const key = cellKey(p); ensure(!cells.has(key)); cells.add(key);
      ensure(Array.isArray(p.assignments) && p.assignments.length <= 12);
      const assignments = p.assignments.map(a => {
        ensure(exact(a,['assignmentId','rawShift']) && uuid(a.assignmentId) && typeof a.rawShift === 'string' && a.rawShift.length <= 80);
        ensure(!ids.has(a.assignmentId)); ids.add(a.assignmentId);
        return { assignmentId:a.assignmentId, rawShift:a.rawShift };
      });
      return { personId:p.personId, date:p.date, assignments };
    }).sort((a,b) => cellKey(a).localeCompare(cellKey(b),'en'));
    const result = { operationType:'DRAFT_PATCH', entityKey:operation.entityKey, expectedRevision:operation.expectedRevision===0?0:operation.expectedRevision, payload:{patches} };
    ensure(JSON.stringify(result).length < 35000);
    return result;
  }
  const cellKey = p => p.personId + '/' + p.date;
  function apply(cells, patches) {
    const result = { ...cells };
    for (const p of patches) result[cellKey(p)] = p.assignments.map(a=>({...a}));
    const ids = new Set();
    for (const assignments of Object.values(result)) for(const a of assignments) { ensure(!ids.has(a.assignmentId)); ids.add(a.assignmentId); }
    return result;
  }
  const canonical = value => RosterCompatibility.canonicalJson(value);
  return Object.freeze({uuid,errors,fail,ensure,enabled,payload,cellKey,apply,canonical});
})();
export default DraftProtocol;
