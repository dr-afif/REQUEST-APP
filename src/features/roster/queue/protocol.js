import RosterCompatibility from '../compatibility.js';

// Shared transport and patch contract; no I/O or future lifecycle rules.
const DraftProtocol = (() => {
  const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
  const errors = [
    'VALIDATION_FAILED','AUTHORIZATION_REQUIRED','FEATURE_DISABLED','ENTITY_NOT_FOUND','REVISION_CONFLICT',
    'IDEMPOTENCY_MISMATCH','LOCK_BUSY','TRANSIENT_BACKEND','PERMANENT_FAILURE','RECOVERY_REQUIRED',
    'SNAPSHOT_IMMUTABLE','IMMUTABLE_SNAPSHOT_VIOLATION','INVALID_STATE','INVALID_LIFECYCLE_STATE',
    'INVALID_LIFECYCLE_TRANSITION','CHECKSUM_MISMATCH','RECONCILIATION_FAILED','REOPEN_REASON_REQUIRED',
    'AMENDED_RESERVED_PHASE5','TRANSITION_BLOCKED','LIFECYCLE_OPERATION_PENDING',
    'MALFORMED_EVENT','INCOMPLETE_SWAP','EVENT_ALREADY_REVERSED','REVERSAL_DEPENDENCY_CONFLICT',
    'CANNOT_REVERSE_LIFECYCLE_EVENT','CANNOT_REVERSE_REVERSAL','DUTY_DOMAIN_REQUIRED','EVENT_NOT_FOUND',
    'INVALID_OPERATOR','REVERSAL_CONFLICT','ALREADY_REVERSED','CANNOT_REVERSE','INVALID_AMENDMENT_TYPE'
  ];
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
    ensure(Number.isSafeInteger(operation.expectedRevision) && operation.expectedRevision >= 0);

    if (operation.operationType === 'DRAFT_PATCH') {
      ensure(typeof operation.entityKey === 'string' && /^draft:(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(operation.entityKey));
      const period = operation.entityKey.slice(6);
      RosterCompatibility.validatePeriod(period);
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

    if (operation.operationType === 'PERIOD_PUBLISH') {
      const periodId = operation.payload?.periodId || operation.periodId || (typeof operation.entityKey === 'string' ? operation.entityKey.replace(/^(draft|period):/, '') : '');
      RosterCompatibility.validatePeriod(periodId);
      const draftCells = operation.payload?.draftCells !== undefined ? operation.payload.draftCells : (operation.draftCells !== undefined ? operation.draftCells : {});
      ensure(draftCells && typeof draftCells === 'object' && !Array.isArray(draftCells));
      const adminNote = String(operation.payload?.adminNote || operation.adminNote || '');
      return {
        operationId: operation.operationId,
        clientId: operation.clientId,
        tabId: operation.tabId,
        operationType: 'PERIOD_PUBLISH',
        entityKey: 'period:' + periodId,
        expectedRevision: operation.expectedRevision === 0 ? 0 : operation.expectedRevision,
        payload: {
          periodId: periodId,
          draftCells: draftCells,
          adminNote: adminNote
        }
      };
    }

    if (operation.operationType === 'PERIOD_CLOSE') {
      const periodId = operation.payload?.periodId || operation.periodId || (typeof operation.entityKey === 'string' ? operation.entityKey.replace(/^(draft|period):/, '') : '');
      RosterCompatibility.validatePeriod(periodId);
      const adminNote = String(operation.payload?.adminNote || operation.adminNote || '');
      return {
        operationId: operation.operationId,
        clientId: operation.clientId,
        tabId: operation.tabId,
        operationType: 'PERIOD_CLOSE',
        entityKey: 'period:' + periodId,
        expectedRevision: operation.expectedRevision === 0 ? 0 : operation.expectedRevision,
        payload: {
          periodId: periodId,
          adminNote: adminNote
        }
      };
    }

    if (operation.operationType === 'PERIOD_REOPEN') {
      const periodId = operation.payload?.periodId || operation.periodId || (typeof operation.entityKey === 'string' ? operation.entityKey.replace(/^(draft|period):/, '') : '');
      RosterCompatibility.validatePeriod(periodId);
      const reason = String(operation.payload?.reason || operation.reason || '').trim();
      ensure(reason.length > 0, 'REOPEN_REASON_REQUIRED');
      return {
        operationId: operation.operationId,
        clientId: operation.clientId,
        tabId: operation.tabId,
        operationType: 'PERIOD_REOPEN',
        entityKey: 'period:' + periodId,
        expectedRevision: operation.expectedRevision === 0 ? 0 : operation.expectedRevision,
        payload: {
          periodId: periodId,
          reason: reason
        }
      };
    }

    if (operation.operationType === 'PERIOD_AMEND') {
      const periodId = operation.payload?.periodId || operation.periodId || (typeof operation.entityKey === 'string' ? operation.entityKey.replace(/^(draft|period):/, '') : '');
      RosterCompatibility.validatePeriod(periodId);
      const payload = operation.payload?.payload || operation.payload || {};
      const eventType = String(payload.eventType || operation.eventType || 'ADMIN_CORRECTION').toUpperCase();
      const publicReasonCode = String(payload.publicReasonCode || operation.publicReasonCode || 'CLINICAL_SERVICE_CONTINUITY').trim();
      const adminNote = String(payload.adminNote || operation.adminNote || '').trim();

      let semanticPayload;
      if (eventType === 'SWAP') {
        const p1 = payload.person1 || operation.person1;
        const p2 = payload.person2 || operation.person2;
        ensure(p1 && p2 && p1.personId && p2.personId && p1.date && p2.date && p1.dutyDomain && p2.dutyDomain, 'VALIDATION_FAILED');
        semanticPayload = {
          periodId: periodId,
          eventType: 'SWAP',
          person1: {
            personId: String(p1.personId).trim(),
            date: String(p1.date).trim(),
            dutyDomain: String(p1.dutyDomain).trim()
          },
          person2: {
            personId: String(p2.personId).trim(),
            date: String(p2.date).trim(),
            dutyDomain: String(p2.dutyDomain).trim()
          },
          publicReasonCode: publicReasonCode,
          adminNote: adminNote
        };
      } else {
        const personId = String(payload.personId || operation.personId || '').trim();
        const date = String(payload.date || operation.date || '').trim();
        const dutyDomain = String(payload.dutyDomain || operation.dutyDomain || '').trim();
        ensure(personId && date && dutyDomain, 'VALIDATION_FAILED');
        const afterAssignments = payload.afterAssignments !== undefined
          ? payload.afterAssignments
          : (operation.afterAssignments !== undefined
              ? operation.afterAssignments
              : (payload.shiftCode !== undefined
                  ? [{ shiftCode: payload.shiftCode }]
                  : (operation.shiftCode !== undefined ? [{ shiftCode: operation.shiftCode }] : [])));
        semanticPayload = {
          periodId: periodId,
          eventType: eventType,
          personId: personId,
          date: date,
          dutyDomain: dutyDomain,
          afterAssignments: afterAssignments,
          publicReasonCode: publicReasonCode,
          adminNote: adminNote
        };
      }

      return {
        operationId: operation.operationId,
        clientId: operation.clientId,
        tabId: operation.tabId,
        operationType: 'PERIOD_AMEND',
        entityKey: 'period:' + periodId,
        expectedRevision: operation.expectedRevision === 0 ? 0 : operation.expectedRevision,
        payload: semanticPayload
      };
    }

    if (operation.operationType === 'PERIOD_AMEND_REVERSAL') {
      const periodId = operation.payload?.periodId || operation.periodId || (typeof operation.entityKey === 'string' ? operation.entityKey.replace(/^(draft|period):/, '') : '');
      RosterCompatibility.validatePeriod(periodId);
      const payload = operation.payload?.payload || operation.payload || {};
      const targetEventId = String(payload.targetEventId || operation.targetEventId || '').trim();
      ensure(targetEventId.length > 0, 'VALIDATION_FAILED');
      const adminNote = String(payload.adminNote || operation.adminNote || '').trim();
      const publicReasonCode = String(payload.publicReasonCode || operation.publicReasonCode || 'REVERSAL').trim();

      return {
        operationId: operation.operationId,
        clientId: operation.clientId,
        tabId: operation.tabId,
        operationType: 'PERIOD_AMEND_REVERSAL',
        entityKey: 'period:' + periodId,
        expectedRevision: operation.expectedRevision === 0 ? 0 : operation.expectedRevision,
        payload: {
          periodId: periodId,
          targetEventId: targetEventId,
          publicReasonCode: publicReasonCode,
          adminNote: adminNote
        }
      };
    }

    throw fail('VALIDATION_FAILED');
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
