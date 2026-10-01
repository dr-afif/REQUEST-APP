import RosterCompatibility from './compatibility.js';
import RosterGuidance from './guidance.js';

// Pure Phase 4 lifecycle contract. No I/O, no UI, no backend handlers.
const RosterLifecycle = (() => {
  const freeze = value => {
    if (value && typeof value === 'object') {
      Object.values(value).forEach(freeze);
      Object.freeze(value);
    }
    return value;
  };

  const LIFECYCLE_STATES = freeze({
    DRAFT: 'DRAFT',
    PUBLISHED: 'PUBLISHED',
    AMENDED: 'AMENDED', // Recognized for forward compatibility; reserved for Phase 5
    CLOSED: 'CLOSED'
  });

  const LIFECYCLE_OPERATIONS = freeze({
    PUBLISH: 'ROSTER_PUBLISH',
    CLOSE: 'ROSTER_CLOSE',
    REOPEN: 'ROSTER_REOPEN'
  });

  const LIFECYCLE_ERRORS = freeze({
    INVALID_LIFECYCLE_STATE: 'INVALID_LIFECYCLE_STATE',
    INVALID_LIFECYCLE_TRANSITION: 'INVALID_LIFECYCLE_TRANSITION',
    AMENDED_RESERVED_PHASE5: 'AMENDED_RESERVED_PHASE5',
    RECONCILIATION_FAILED: 'RECONCILIATION_FAILED',
    REOPEN_REASON_REQUIRED: 'REOPEN_REASON_REQUIRED',
    IMMUTABLE_SNAPSHOT_VIOLATION: 'IMMUTABLE_SNAPSHOT_VIOLATION',
    INVALID_PERIOD_ASSIGNMENT: 'INVALID_PERIOD_ASSIGNMENT',
    PROJECTION_MISMATCH: 'PROJECTION_MISMATCH',
    INVALID_OPERATOR: 'INVALID_OPERATOR',
    VALIDATION_FAILED: 'VALIDATION_FAILED'
  });

  const ROSTER_LIFECYCLE_SCHEMAS = RosterCompatibility.lifecycleSchemas || freeze({
    RosterPeriods: [
      'PeriodId', 'State', 'Revision', 'DraftRevision', 'PlannedSnapshotId',
      'PublishedAt', 'PublishedBy', 'ClosedAt', 'ClosedBy',
      'ProjectionChecksum', 'SchemaVersion', 'LastOperationId', 'UpdatedAt'
    ],
    RosterAssignments: [
      'AssignmentId', 'PeriodId', 'Layer', 'SnapshotId',
      'PersonId', 'PersonNameSnapshot', 'Date', 'DutyDomain',
      'ShiftCode', 'ModifiersJson', 'DraftRevision', 'Source',
      'OperationId', 'CreatedAt', 'CreatedBy'
    ],
    RosterEvents: [
      'EventId', 'LineId', 'EventType', 'OperationId', 'PeriodId',
      'BaseRevision', 'ResultRevision', 'PersonId', 'LinkedPersonIdsJson',
      'Date', 'DutyDomain', 'PlannedAssignmentJson', 'BeforeCurrentJson',
      'AfterCurrentJson', 'PublicReasonCode', 'AdminNote', 'ShortageAccepted',
      'ShortageReason', 'GoffTransactionIdsJson', 'ReversesEventId',
      'CreatedAt', 'CreatedBy'
    ],
    WeeklyOffSnapshots: [
      'WeekSnapshotId', 'WeekStart', 'WeekEnd', 'PolicyLockedByPeriodId',
      'PublishedPeriodIdsJson', 'PublishedDateMask', 'EvaluationState',
      'PlannedSnapshotIdsJson', 'PlannedWeekChecksum', 'PersonId',
      'PersonNameSnapshot', 'PolicyId', 'PolicyCode', 'RuleVersion',
      'HasQualifyingPlannedNight', 'RequiredOffCount', 'AssignedOffCountAtPublish',
      'Revision', 'OperationId', 'CreatedAt', 'CompletedAt'
    ]
  });

  const fail = (code, message) => {
    const err = new Error(message || code);
    err.code = code;
    return err;
  };

  const isUuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
  const genUuid = () => typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : (typeof Utilities !== 'undefined' && Utilities.getUuid ? Utilities.getUuid() : '00000000-0000-4000-8000-000000000000');

  function deterministicAssignmentId(operationId, personId, date, index, digestFn) {
    const seed = `${operationId}:${personId}:${date}:${index}`;
    if (typeof digestFn === 'function') {
      const h = digestFn(seed);
      return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
    }
    let h1 = 0x811c9dc5, h2 = 0x811c9dc5, h3 = 0x811c9dc5, h4 = 0x811c9dc5;
    for (let i = 0; i < seed.length; i++) {
      const c = seed.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 0x01000193);
      h2 = Math.imul(h2 ^ (c >> 2), 0x01000193);
      h3 = Math.imul(h3 ^ (c << 2), 0x01000193);
      h4 = Math.imul(h4 ^ (c + i), 0x01000193);
    }
    const hex = (h1 >>> 0).toString(16).padStart(8, '0') +
      (h2 >>> 0).toString(16).padStart(8, '0') +
      (h3 >>> 0).toString(16).padStart(8, '0') +
      (h4 >>> 0).toString(16).padStart(8, '0');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
  }

  function canTransition(fromState, toState) {
    if (fromState === LIFECYCLE_STATES.DRAFT && toState === LIFECYCLE_STATES.PUBLISHED) return true;
    if (fromState === LIFECYCLE_STATES.PUBLISHED && toState === LIFECYCLE_STATES.CLOSED) return true;
    if (fromState === LIFECYCLE_STATES.CLOSED && toState === LIFECYCLE_STATES.PUBLISHED) return true;
    return false;
  }

  function validateTransition(fromState, toState, context = {}) {
    if (toState === LIFECYCLE_STATES.AMENDED || fromState === LIFECYCLE_STATES.AMENDED) {
      throw fail(LIFECYCLE_ERRORS.AMENDED_RESERVED_PHASE5, 'AMENDED state is reserved for Phase 5; Phase 4 operational lifecycle is DRAFT -> PUBLISHED -> CLOSED -> PUBLISHED');
    }

    if (!canTransition(fromState, toState)) {
      throw fail(LIFECYCLE_ERRORS.INVALID_LIFECYCLE_TRANSITION, `Cannot transition lifecycle from ${fromState} to ${toState}`);
    }

    const actor = String(context.actor || '').trim();
    if (!actor) {
      throw fail(LIFECYCLE_ERRORS.INVALID_OPERATOR, 'Lifecycle transition requires an authenticated actor');
    }

    if (fromState === LIFECYCLE_STATES.DRAFT && toState === LIFECYCLE_STATES.PUBLISHED) {
      const plannedSnapshotId = String(context.plannedSnapshotId || '').trim();
      if (!plannedSnapshotId) {
        throw fail(LIFECYCLE_ERRORS.VALIDATION_FAILED, 'Publish transition requires a plannedSnapshotId');
      }
      return { valid: true, fromState, nextState: LIFECYCLE_STATES.PUBLISHED, nextRevision: 1 };
    }

    if (fromState === LIFECYCLE_STATES.PUBLISHED && toState === LIFECYCLE_STATES.CLOSED) {
      if (context.isManual === false) {
        throw fail(LIFECYCLE_ERRORS.INVALID_LIFECYCLE_TRANSITION, 'Closing must be explicitly manual; automatic closing is prohibited');
      }
      if (context.reconciliation) {
        if (context.reconciliation.pendingOperationsCount > 0) {
          throw fail(LIFECYCLE_ERRORS.RECONCILIATION_FAILED, `Cannot close period: ${context.reconciliation.pendingOperationsCount} pending operations remain in the journal`);
        }
        if (context.reconciliation.ok === false) {
          throw fail(LIFECYCLE_ERRORS.RECONCILIATION_FAILED, context.reconciliation.error || 'Period reconciliation check failed');
        }
      }
      const curRev = Number(context.currentRevision) || 1;
      return { valid: true, fromState, nextState: LIFECYCLE_STATES.CLOSED, nextRevision: curRev + 1 };
    }

    if (fromState === LIFECYCLE_STATES.CLOSED && toState === LIFECYCLE_STATES.PUBLISHED) {
      if (context.isManual === false) {
        throw fail(LIFECYCLE_ERRORS.INVALID_LIFECYCLE_TRANSITION, 'Reopening must be explicitly manual');
      }
      const reason = String(context.reason || '').trim();
      if (!reason) {
        throw fail(LIFECYCLE_ERRORS.REOPEN_REASON_REQUIRED, 'Reopen requires a non-empty reason string');
      }
      const curRev = Number(context.currentRevision) || 1;
      return { valid: true, fromState, nextState: LIFECYCLE_STATES.PUBLISHED, nextRevision: curRev + 1, reason };
    }

    throw fail(LIFECYCLE_ERRORS.INVALID_LIFECYCLE_TRANSITION, `Unsupported transition from ${fromState} to ${toState}`);
  }

  function generatePlannedSnapshot({
    periodId,
    draftCells = {},
    people = [],
    operationId,
    actor,
    timestamp = new Date().toISOString(),
    snapshotId,
    snapshotUuid,
    digestFn
  }) {
    RosterCompatibility.validatePeriod(periodId);
    if (!operationId || !isUuid(operationId)) {
      throw fail(LIFECYCLE_ERRORS.VALIDATION_FAILED, 'OperationId must be a valid UUID');
    }
    const cleanActor = String(actor || '').trim();
    if (!cleanActor) {
      throw fail(LIFECYCLE_ERRORS.INVALID_OPERATOR, 'Actor is required');
    }

    const peopleMap = new Map();
    people.forEach(p => {
      if (p.PersonId) peopleMap.set(p.PersonId, p);
    });

    // Deterministic snapshot ID based on operationId when not explicitly provided
    const plannedSnapshotId = snapshotId || (`snapshot:${periodId}:${snapshotUuid || operationId}`);
    const assignments = [];

    // Sort cell keys for stable iteration order
    const sortedCellKeys = Object.keys(draftCells).sort();

    for (const cellKey of sortedCellKeys) {
      const rawAssignments = draftCells[cellKey];
      const parts = cellKey.split('/');
      if (parts.length !== 2) continue;
      const [personId, date] = parts;

      if (!RosterCompatibility.localDate(date) || date.slice(0, 7) !== periodId) {
        throw fail(LIFECYCLE_ERRORS.INVALID_PERIOD_ASSIGNMENT, `Date ${date} is outside the target period ${periodId}`);
      }

      const person = peopleMap.get(personId);
      if (!person) {
        throw fail(LIFECYCLE_ERRORS.VALIDATION_FAILED, `PersonId ${personId} not found in registered people`);
      }

      const items = Array.isArray(rawAssignments) ? rawAssignments : [];
      items.forEach((item, index) => {
        const rawShift = typeof item === 'string' ? item : item.rawShift;
        const assignmentId = (typeof item === 'object' && item.assignmentId && isUuid(item.assignmentId))
          ? item.assignmentId
          : deterministicAssignmentId(operationId, personId, date, index, digestFn);
        const resolved = RosterCompatibility.resolveShift(rawShift, person.DirectoryType || 'MO');

        assignments.push({
          AssignmentId: assignmentId,
          PeriodId: periodId,
          Layer: 'PLANNED',
          SnapshotId: plannedSnapshotId,
          PersonId: person.PersonId,
          PersonNameSnapshot: person.CurrentDisplayName || person.MemberName || '',
          Date: date,
          DutyDomain: person.DirectoryType || 'MO',
          ShiftCode: resolved.baseCode,
          ModifiersJson: JSON.stringify(resolved.modifiers || { extended: false, standby: false }),
          DraftRevision: 0,
          Source: 'NEW',
          OperationId: operationId,
          CreatedAt: timestamp,
          CreatedBy: cleanActor,
          _rawShift: rawShift
        });
      });
    }

    assignments.sort((a, b) =>
      a.Date.localeCompare(b.Date) ||
      a.PersonNameSnapshot.localeCompare(b.PersonNameSnapshot) ||
      a.ShiftCode.localeCompare(b.ShiftCode) ||
      a.AssignmentId.localeCompare(b.AssignmentId)
    );

    return {
      plannedSnapshotId,
      assignments: assignments.map(({ _rawShift, ...row }) => row),
      _assignmentsWithRaw: assignments
    };
  }

  function formatRawShift(shiftCode, modifiers) {
    if (!modifiers) return shiftCode;
    const mods = typeof modifiers === 'string' ? JSON.parse(modifiers) : modifiers;
    let s = shiftCode;
    if (mods.standby) s += '(S)';
    if (mods.extended) s += '(X)';
    return s;
  }

  function generateMasterRosterProjection(assignments = []) {
    const rows = assignments.map(a => {
      const name = a.PersonNameSnapshot || a.Name || '';
      const date = a.Date;
      const shift = a._rawShift || formatRawShift(a.ShiftCode, a.ModifiersJson);
      return { Name: name, Date: date, Shift: shift };
    });

    rows.sort((a, b) =>
      a.Date.localeCompare(b.Date) ||
      a.Name.localeCompare(b.Name) ||
      a.Shift.localeCompare(b.Shift)
    );

    return rows;
  }

  function computeProjectionChecksum(projectedRows = [], digestFn) {
    if (typeof digestFn !== 'function') {
      throw fail(LIFECYCLE_ERRORS.VALIDATION_FAILED, 'digestFn is required to compute projection checksum');
    }
    const transportRows = RosterCompatibility.legacyTransportRows(projectedRows);
    const canonical = RosterCompatibility.canonicalJson(transportRows);
    return digestFn(canonical);
  }

  function mergeMasterRosterProjection(existingMasterRosterRows = [], periodId, projectedRows = []) {
    RosterCompatibility.validatePeriod(periodId);
    const preserved = [];
    let replacedCount = 0;

    for (const row of existingMasterRosterRows) {
      const d = RosterCompatibility.localDate(row.Date);
      if (d && d.slice(0, 7) === periodId) {
        replacedCount++;
      } else {
        preserved.push(row);
      }
    }

    const mergedRows = [...preserved, ...projectedRows];
    return {
      mergedRows,
      preservedCount: preserved.length,
      replacedCount,
      addedCount: projectedRows.length
    };
  }

  function aggregateWeeklyOffSnapshots({
    periodId,
    plannedAssignments = [],
    people = [],
    existingWeekSnapshots = [],
    adjacentPlannedAssignments = [],
    policies = [],
    operationId,
    actor,
    timestamp = new Date().toISOString(),
    digestFn
  }) {
    RosterCompatibility.validatePeriod(periodId);
    const weeks = RosterGuidance.weeksForPeriod(periodId);
    const moPeople = people.filter(p => (p.DirectoryType || 'MO') === 'MO');
    const existingMap = new Map();
    existingWeekSnapshots.forEach(snap => {
      existingMap.set(`${snap.PersonId}:${snap.WeekStart}`, snap);
    });

    const allAssignments = [...plannedAssignments, ...adjacentPlannedAssignments];
    const assignmentsByPersonDate = new Map();
    allAssignments.forEach(a => {
      const key = `${a.PersonId}:${a.Date}`;
      if (!assignmentsByPersonDate.has(key)) assignmentsByPersonDate.set(key, []);
      assignmentsByPersonDate.get(key).push(a.ShiftCode || a.Shift);
    });

    const results = [];

    for (const person of moPeople) {
      for (const weekStart of weeks) {
        const weekDates = RosterGuidance.weekDates(weekStart);
        const weekEnd = weekDates[6];
        const periodMask = weekDates.map(d => d.slice(0, 7) === periodId);
        const key = `${person.PersonId}:${weekStart}`;
        const existing = existingMap.get(key);

        let snapshotId;
        let policy;
        let policyLockedBy;
        let publishedPeriods;
        let publishedMask;
        let plannedSnapshotIds;
        let rev = 0;

        if (!existing) {
          policy = RosterGuidance.selectPolicy(policies, weekStart);
          policyLockedBy = periodId;
          publishedPeriods = [periodId];
          publishedMask = periodMask;
          snapshotId = genUuid();
          const pSnapshotId = plannedAssignments.find(a => a.PersonId === person.PersonId)?.SnapshotId || `snapshot:${periodId}:unknown`;
          plannedSnapshotIds = [pSnapshotId];
        } else {
          policy = {
            policyId: existing.PolicyId,
            policyCode: existing.PolicyCode,
            ruleVersion: Number(existing.RuleVersion) || 1
          };
          policyLockedBy = existing.PolicyLockedByPeriodId;
          const prevPeriods = JSON.parse(existing.PublishedPeriodIdsJson || '[]');
          publishedPeriods = prevPeriods.includes(periodId) ? prevPeriods : [...prevPeriods, periodId];
          const prevMask = JSON.parse(existing.PublishedDateMask || '[]');
          publishedMask = prevMask.map((val, idx) => val || periodMask[idx]);
          snapshotId = existing.WeekSnapshotId;
          const prevSnapshots = JSON.parse(existing.PlannedSnapshotIdsJson || '[]');
          const pSnapshotId = plannedAssignments.find(a => a.PersonId === person.PersonId)?.SnapshotId;
          plannedSnapshotIds = (pSnapshotId && !prevSnapshots.includes(pSnapshotId))
            ? [...prevSnapshots, pSnapshotId]
            : prevSnapshots;
          rev = (Number(existing.Revision) || 0) + 1;
        }

        const isComplete = publishedMask.every(Boolean);

        let evalState = 'PROVISIONAL';
        let qualNight = null;
        let reqOff = null;
        let assignedOff = null;
        let weekChecksum = null;
        let completedAt = '';

        if (isComplete) {
          evalState = 'COMPLETE';
          const plannedByDate = {};
          weekDates.forEach(d => {
            plannedByDate[d] = assignmentsByPersonDate.get(`${person.PersonId}:${d}`) || [];
          });

          const evalResult = RosterGuidance.evaluateWeek({
            weekStart,
            personId: person.PersonId,
            plannedByDate,
            availablePlannedDates: weekDates,
            policies,
            lockedPolicy: {
              PolicyId: policy.policyId,
              PolicyCode: policy.policyCode,
              EffectiveMonday: weekStart,
              RuleVersion: policy.ruleVersion,
              RuleJson: RosterGuidance.policyRuleJson(policy.policyCode),
              Active: true
            }
          });

          qualNight = evalResult.qualifyingPlannedNight;
          reqOff = evalResult.requiredOff;
          assignedOff = evalResult.plannedAssignedOff;
          completedAt = timestamp;

          if (typeof digestFn === 'function') {
            const weekShifts = weekDates.map(d => ({
              date: d,
              shifts: plannedByDate[d]
            }));
            weekChecksum = digestFn(RosterCompatibility.canonicalJson(weekShifts));
          }
        }

        results.push({
          WeekSnapshotId: snapshotId,
          WeekStart: weekStart,
          WeekEnd: weekEnd,
          PolicyLockedByPeriodId: policyLockedBy,
          PublishedPeriodIdsJson: JSON.stringify(publishedPeriods),
          PublishedDateMask: JSON.stringify(publishedMask),
          EvaluationState: evalState,
          PlannedSnapshotIdsJson: JSON.stringify(plannedSnapshotIds),
          PlannedWeekChecksum: weekChecksum || '',
          PersonId: person.PersonId,
          PersonNameSnapshot: person.CurrentDisplayName || person.MemberName || '',
          PolicyId: policy.policyId,
          PolicyCode: policy.policyCode,
          RuleVersion: policy.ruleVersion,
          HasQualifyingPlannedNight: qualNight,
          RequiredOffCount: reqOff,
          AssignedOffCountAtPublish: assignedOff,
          Revision: rev,
          OperationId: operationId,
          CreatedAt: existing?.CreatedAt || timestamp,
          CompletedAt: completedAt
        });
      }
    }

    return results;
  }

  function createInitialPeriodRecord({ periodId, schemaVersion = 2, enrolledBy = 'admin', timestamp = new Date().toISOString() }) {
    RosterCompatibility.validatePeriod(periodId);
    return {
      PeriodId: periodId,
      State: LIFECYCLE_STATES.DRAFT,
      Revision: 0,
      DraftRevision: 0,
      PlannedSnapshotId: '',
      PublishedAt: '',
      PublishedBy: '',
      ClosedAt: '',
      ClosedBy: '',
      ProjectionChecksum: '',
      SchemaVersion: schemaVersion,
      LastOperationId: '',
      UpdatedAt: timestamp
    };
  }

  function publishPeriodRecord({ periodRecord, plannedSnapshotId, projectionChecksum, actor, timestamp = new Date().toISOString(), operationId }) {
    validateTransition(periodRecord.State, LIFECYCLE_STATES.PUBLISHED, { actor, plannedSnapshotId });
    return {
      ...periodRecord,
      State: LIFECYCLE_STATES.PUBLISHED,
      Revision: 1,
      PlannedSnapshotId: plannedSnapshotId,
      PublishedAt: timestamp,
      PublishedBy: actor,
      ProjectionChecksum: projectionChecksum,
      LastOperationId: operationId,
      UpdatedAt: timestamp
    };
  }

  function closePeriodRecord({ periodRecord, actor, timestamp = new Date().toISOString(), operationId, isManual = true, reconciliation }) {
    validateTransition(periodRecord.State, LIFECYCLE_STATES.CLOSED, { actor, isManual, reconciliation, currentRevision: periodRecord.Revision });
    return {
      ...periodRecord,
      State: LIFECYCLE_STATES.CLOSED,
      Revision: (Number(periodRecord.Revision) || 1) + 1,
      ClosedAt: timestamp,
      ClosedBy: actor,
      LastOperationId: operationId,
      UpdatedAt: timestamp
    };
  }

  function reopenPeriodRecord({ periodRecord, reason, actor, timestamp = new Date().toISOString(), operationId, isManual = true }) {
    validateTransition(periodRecord.State, LIFECYCLE_STATES.PUBLISHED, { actor, reason, isManual, currentRevision: periodRecord.Revision });
    return {
      ...periodRecord,
      State: LIFECYCLE_STATES.PUBLISHED,
      Revision: (Number(periodRecord.Revision) || 1) + 1,
      ClosedAt: '',
      ClosedBy: '',
      LastOperationId: operationId,
      UpdatedAt: timestamp
    };
  }

  function createLifecycleEvent({
    eventType,
    periodId,
    baseRevision,
    resultRevision,
    operationId,
    actor,
    reason = '',
    timestamp = new Date().toISOString()
  }) {
    if (!['PUBLISH', 'CLOSE', 'REOPEN'].includes(eventType)) {
      throw fail(LIFECYCLE_ERRORS.VALIDATION_FAILED, `Unsupported eventType: ${eventType}`);
    }
    return {
      EventId: genUuid(),
      LineId: genUuid(),
      EventType: eventType,
      OperationId: operationId,
      PeriodId: periodId,
      BaseRevision: baseRevision,
      ResultRevision: resultRevision,
      PersonId: '',
      LinkedPersonIdsJson: '[]',
      Date: '',
      DutyDomain: '',
      PlannedAssignmentJson: '[]',
      BeforeCurrentJson: '[]',
      AfterCurrentJson: '[]',
      PublicReasonCode: eventType,
      AdminNote: reason || '',
      ShortageAccepted: false,
      ShortageReason: '',
      GoffTransactionIdsJson: '[]',
      ReversesEventId: '',
      CreatedAt: timestamp,
      CreatedBy: actor
    };
  }

  return freeze({
    LIFECYCLE_STATES,
    LIFECYCLE_OPERATIONS,
    LIFECYCLE_ERRORS,
    ROSTER_LIFECYCLE_SCHEMAS,
    deterministicAssignmentId,
    canTransition,
    validateTransition,
    generatePlannedSnapshot,
    formatRawShift,
    generateMasterRosterProjection,
    computeProjectionChecksum,
    mergeMasterRosterProjection,
    aggregateWeeklyOffSnapshots,
    createInitialPeriodRecord,
    publishPeriodRecord,
    closePeriodRecord,
    reopenPeriodRecord,
    createLifecycleEvent
  });
})();

export default RosterLifecycle;
