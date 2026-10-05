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

  const AMENDMENT_EVENT_TYPES = freeze({
    ADMIN_CORRECTION: 'ADMIN_CORRECTION',
    SWAP: 'SWAP',
    REVERSAL: 'REVERSAL'
  });

  const PUBLIC_REASON_CODES = freeze({
    SHIFT_SWAP: 'SHIFT_SWAP',
    ADMIN_CORRECTION: 'ADMIN_CORRECTION',
    DUTY_COVERAGE: 'DUTY_COVERAGE',
    OPERATIONAL_CHANGE: 'OPERATIONAL_CHANGE',
    OTHER: 'OTHER'
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
    VALIDATION_FAILED: 'VALIDATION_FAILED',
    MALFORMED_EVENT: 'MALFORMED_EVENT',
    INCOMPLETE_SWAP: 'INCOMPLETE_SWAP',
    EVENT_ALREADY_REVERSED: 'EVENT_ALREADY_REVERSED',
    CANNOT_REVERSE_REVERSAL: 'CANNOT_REVERSE_REVERSAL',
    CANNOT_REVERSE_LIFECYCLE_EVENT: 'CANNOT_REVERSE_LIFECYCLE_EVENT',
    REVERSAL_DEPENDENCY_CONFLICT: 'REVERSAL_DEPENDENCY_CONFLICT',
    REVISION_CONFLICT: 'REVISION_CONFLICT',
    UNKNOWN_REASON_CODE: 'UNKNOWN_REASON_CODE',
    EVENT_NOT_FOUND: 'EVENT_NOT_FOUND'
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

  // Deterministic UUID generator formatted with RFC 4122 layout (version 4, variant 8).
  function deterministicUuid(seed, digest) {
    if (typeof digest === 'function') {
      const h = digest(seed);
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

  function deterministicEventId(operationId, eventType, ...context) {
    const cleanOpId = String(operationId || '').trim();
    const parts = [cleanOpId, eventType].concat(context.filter(Boolean).map(v => String(v).trim()));
    const seed = `event:${parts.join(':')}`;
    return deterministicUuid(seed);
  }

  function deterministicLineId(eventId, lineIndex, ...context) {
    const cleanEventId = String(eventId || '').trim();
    const parts = [cleanEventId, lineIndex].concat(context.filter(Boolean).map(v => String(v).trim()));
    const seed = `line:${parts.join(':')}`;
    return deterministicUuid(seed);
  }

  // Deterministic UUID-shaped assignment identifier derived from semantic identity tuple.
  // Formatted with RFC 4122 layout (setting version 4 and variant 8) to satisfy UUID validators,
  // but explicitly documented as a deterministic assignment identifier, not a random UUID v4.
  function deterministicAssignmentId(operationId, personId, date, dutyDomainOrIndex, shiftCode, rawShiftOrOccurrence, occurrenceOrDigest, maybeDigest) {
    let seed;
    let digest = maybeDigest;
    if (typeof shiftCode === 'undefined' || typeof dutyDomainOrIndex === 'number') {
      // Legacy signature: (operationId, personId, date, index, digestFn)
      seed = `${operationId}:${personId}:${date}:${dutyDomainOrIndex}`;
      digest = shiftCode;
    } else if (typeof occurrenceOrDigest === 'function' || (typeof maybeDigest === 'undefined' && typeof occurrenceOrDigest === 'undefined')) {
      // Signature: (operationId, personId, date, dutyDomain, shiftCode, occurrence, digestFn)
      const occurrence = typeof rawShiftOrOccurrence === 'number' ? rawShiftOrOccurrence : 0;
      seed = `${operationId}:${personId}:${date}:${dutyDomainOrIndex}:${shiftCode}:${occurrence}`;
      digest = typeof occurrenceOrDigest === 'function' ? occurrenceOrDigest : maybeDigest;
    } else {
      // Signature: (operationId, personId, date, dutyDomain, shiftCode, rawShift, occurrence, digestFn)
      const raw = rawShiftOrOccurrence == null ? '' : String(rawShiftOrOccurrence);
      const occurrence = typeof occurrenceOrDigest === 'number' ? occurrenceOrDigest : 0;
      seed = `${operationId}:${personId}:${date}:${dutyDomainOrIndex}:${shiftCode}:${raw}:${occurrence}`;
      digest = maybeDigest;
    }
    return deterministicUuid(seed, digest);
  }

  function canTransition(fromState, toState, context = {}) {
    const isPhase5 = context === 5 || context?.phase === 5 || context?.isPhase5 === true || context?.allowAmended === true;
    if (isPhase5) {
      if (fromState === LIFECYCLE_STATES.DRAFT && toState === LIFECYCLE_STATES.PUBLISHED) return true;
      if (fromState === LIFECYCLE_STATES.PUBLISHED && toState === LIFECYCLE_STATES.AMENDED) return true;
      if (fromState === LIFECYCLE_STATES.AMENDED && toState === LIFECYCLE_STATES.AMENDED) return true;
      if (fromState === LIFECYCLE_STATES.AMENDED && toState === LIFECYCLE_STATES.PUBLISHED) return true;
      if (fromState === LIFECYCLE_STATES.PUBLISHED && toState === LIFECYCLE_STATES.CLOSED) return true;
      if (fromState === LIFECYCLE_STATES.AMENDED && toState === LIFECYCLE_STATES.CLOSED) return true;
      if (fromState === LIFECYCLE_STATES.CLOSED && toState === LIFECYCLE_STATES.PUBLISHED) return true;
      if (fromState === LIFECYCLE_STATES.CLOSED && toState === LIFECYCLE_STATES.AMENDED) return true;
      return false;
    }
    if (fromState === LIFECYCLE_STATES.DRAFT && toState === LIFECYCLE_STATES.PUBLISHED) return true;
    if (fromState === LIFECYCLE_STATES.PUBLISHED && toState === LIFECYCLE_STATES.CLOSED) return true;
    if (fromState === LIFECYCLE_STATES.CLOSED && toState === LIFECYCLE_STATES.PUBLISHED) return true;
    return false;
  }

  function validateTransition(fromState, toState, context = {}) {
    const isPhase5 = context.phase === 5 || context.isPhase5 === true || context.allowAmended === true || context.activeAmendmentCount !== undefined || context.operationType === 'PERIOD_AMEND';

    if (!isPhase5 && (toState === LIFECYCLE_STATES.AMENDED || fromState === LIFECYCLE_STATES.AMENDED)) {
      throw fail(LIFECYCLE_ERRORS.AMENDED_RESERVED_PHASE5, 'AMENDED state is reserved for Phase 5; Phase 4 operational lifecycle is DRAFT -> PUBLISHED -> CLOSED -> PUBLISHED');
    }

    if (!canTransition(fromState, toState, isPhase5 ? { phase: 5 } : {})) {
      throw fail(LIFECYCLE_ERRORS.INVALID_LIFECYCLE_TRANSITION, `Cannot transition lifecycle from ${fromState} to ${toState}`);
    }

    const actor = String(context.actor || '').trim();
    if (!actor) {
      throw fail(LIFECYCLE_ERRORS.INVALID_OPERATOR, 'Lifecycle transition requires an authenticated actor');
    }

    const curRev = Number(context.currentRevision) || 1;

    if (fromState === LIFECYCLE_STATES.DRAFT && toState === LIFECYCLE_STATES.PUBLISHED) {
      const plannedSnapshotId = String(context.plannedSnapshotId || '').trim();
      if (!plannedSnapshotId) {
        throw fail(LIFECYCLE_ERRORS.VALIDATION_FAILED, 'Publish transition requires a plannedSnapshotId');
      }
      return { valid: true, fromState, nextState: LIFECYCLE_STATES.PUBLISHED, nextRevision: 1 };
    }

    if ((fromState === LIFECYCLE_STATES.PUBLISHED || fromState === LIFECYCLE_STATES.AMENDED) && toState === LIFECYCLE_STATES.CLOSED) {
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
      return { valid: true, fromState, nextState: LIFECYCLE_STATES.CLOSED, nextRevision: curRev + 1 };
    }

    if (fromState === LIFECYCLE_STATES.CLOSED && (toState === LIFECYCLE_STATES.PUBLISHED || toState === LIFECYCLE_STATES.AMENDED)) {
      if (context.isManual === false) {
        throw fail(LIFECYCLE_ERRORS.INVALID_LIFECYCLE_TRANSITION, 'Reopening must be explicitly manual');
      }
      const reason = String(context.reason || '').trim();
      if (!reason) {
        throw fail(LIFECYCLE_ERRORS.REOPEN_REASON_REQUIRED, 'Reopen requires a non-empty reason string');
      }
      if (context.activeAmendmentCount !== undefined) {
        const expected = determineReopenTarget(context.activeAmendmentCount);
        if (toState !== expected) {
          throw fail(LIFECYCLE_ERRORS.INVALID_LIFECYCLE_TRANSITION, `Reopen with ${context.activeAmendmentCount} active amendments must transition to ${expected}, not ${toState}`);
        }
      }
      return { valid: true, fromState, nextState: toState, nextRevision: curRev + 1, reason };
    }

    if ((fromState === LIFECYCLE_STATES.PUBLISHED || fromState === LIFECYCLE_STATES.AMENDED) && toState === LIFECYCLE_STATES.AMENDED) {
      return { valid: true, fromState, nextState: LIFECYCLE_STATES.AMENDED, nextRevision: curRev + 1 };
    }

    if (fromState === LIFECYCLE_STATES.AMENDED && toState === LIFECYCLE_STATES.PUBLISHED) {
      if (context.activeAmendmentCount !== undefined && context.activeAmendmentCount > 0) {
        throw fail(LIFECYCLE_ERRORS.INVALID_LIFECYCLE_TRANSITION, `Cannot return to PUBLISHED while ${context.activeAmendmentCount} active amendments remain`);
      }
      return { valid: true, fromState, nextState: LIFECYCLE_STATES.PUBLISHED, nextRevision: curRev + 1 };
    }

    throw fail(LIFECYCLE_ERRORS.INVALID_LIFECYCLE_TRANSITION, `Unsupported transition from ${fromState} to ${toState}`);
  }

  function normalizeDraftCells(draftCells) {
    const normalized = new Map();
    if (!draftCells) return normalized;

    function addCellItem(personId, date, item) {
      if (!personId || !date) return;
      const key = `${personId}/${date}`;
      if (!normalized.has(key)) normalized.set(key, []);
      normalized.get(key).push(item);
    }

    if (Array.isArray(draftCells)) {
      draftCells.forEach(entry => {
        if (!entry) return;
        if (Array.isArray(entry) && entry.length >= 2) {
          const [cellKey, items] = entry;
          const parts = String(cellKey).split('/');
          if (parts.length === 2) {
            const arr = Array.isArray(items) ? items : [items];
            arr.forEach(it => addCellItem(parts[0], parts[1], it));
          }
        } else if (typeof entry === 'object') {
          if (entry.cellKey) {
            const parts = String(entry.cellKey).split('/');
            if (parts.length === 2) {
              const items = entry.assignments || entry.rawAssignments || entry.items || entry;
              const arr = Array.isArray(items) ? items : [items];
              arr.forEach(it => addCellItem(parts[0], parts[1], it));
            }
          } else {
            const personId = entry.PersonId || entry.personId;
            const date = entry.Date || entry.date;
            if (personId && date) {
              addCellItem(personId, date, entry);
            }
          }
        }
      });
    } else if (draftCells instanceof Map) {
      for (const [cellKey, value] of draftCells.entries()) {
        const parts = String(cellKey).split('/');
        if (parts.length === 2) {
          const arr = Array.isArray(value) ? value : [value];
          arr.forEach(it => addCellItem(parts[0], parts[1], it));
        }
      }
    } else if (typeof draftCells === 'object') {
      for (const [cellKey, value] of Object.entries(draftCells)) {
        const parts = String(cellKey).split('/');
        if (parts.length === 2) {
          const arr = Array.isArray(value) ? value : [value];
          arr.forEach(it => addCellItem(parts[0], parts[1], it));
        }
      }
    }

    return normalized;
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

    const normalizedCells = normalizeDraftCells(draftCells);
    const sortedCellKeys = Array.from(normalizedCells.keys()).sort();

    for (const cellKey of sortedCellKeys) {
      const items = normalizedCells.get(cellKey) || [];
      const [personId, date] = cellKey.split('/');

      if (!RosterCompatibility.localDate(date) || date.slice(0, 7) !== periodId) {
        throw fail(LIFECYCLE_ERRORS.INVALID_PERIOD_ASSIGNMENT, `Date ${date} is outside the target period ${periodId}`);
      }

      const person = peopleMap.get(personId);
      if (!person) {
        throw fail(LIFECYCLE_ERRORS.VALIDATION_FAILED, `PersonId ${personId} not found in registered people`);
      }

      const dutyDomain = person.DirectoryType || 'MO';

      // Step A: Parse items into normalized objects
      const parsedItems = items.map(item => {
        const rawShift = typeof item === 'string' ? item : (item.rawShift || item.ShiftCode || item.shiftCode || '');
        const resolved = RosterCompatibility.resolveShift(rawShift, dutyDomain);
        const explicitId = (typeof item === 'object' && (item.assignmentId || item.AssignmentId) && isUuid(item.assignmentId || item.AssignmentId))
          ? (item.assignmentId || item.AssignmentId)
          : null;
        return { rawShift, resolved, explicitId };
      });

      // Step B: Sort items canonically before assigning fallback IDs to eliminate raw input array ordering dependency
      parsedItems.sort((a, b) => {
        if (a.explicitId && b.explicitId) return a.explicitId.localeCompare(b.explicitId);
        if (a.explicitId) return -1;
        if (b.explicitId) return 1;
        const codeCmp = a.resolved.baseCode.localeCompare(b.resolved.baseCode);
        if (codeCmp !== 0) return codeCmp;
        return String(a.rawShift).localeCompare(String(b.rawShift));
      });

      // Step C: Assign IDs with occurrence discriminator computed in canonical order
      const occurrenceCounters = new Map();

      parsedItems.forEach(item => {
        const { rawShift, resolved, explicitId } = item;
        const semanticKey = `${dutyDomain}:${resolved.baseCode}:${rawShift}`;
        const occurrence = occurrenceCounters.get(semanticKey) || 0;
        occurrenceCounters.set(semanticKey, occurrence + 1);

        const assignmentId = explicitId ||
          deterministicAssignmentId(operationId, personId, date, dutyDomain, resolved.baseCode, rawShift, occurrence, digestFn);

        assignments.push({
          AssignmentId: assignmentId,
          PeriodId: periodId,
          Layer: 'PLANNED',
          SnapshotId: plannedSnapshotId,
          PersonId: person.PersonId,
          PersonNameSnapshot: person.CurrentDisplayName || person.MemberName || '',
          Date: date,
          DutyDomain: dutyDomain,
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
      const name = a.PersonNameSnapshot || a.personNameSnapshot || a.Name || a.name || '';
      const date = a.Date || a.date || '';
      const shift = a._rawShift || a.rawShift || formatRawShift(a.ShiftCode || a.shiftCode, a.ModifiersJson || a.modifiers);
      return { Name: name, Date: date, Shift: shift };
    });

    rows.sort((a, b) =>
      (a.Date || '').localeCompare(b.Date || '') ||
      (a.Name || '').localeCompare(b.Name || '') ||
      (a.Shift || '').localeCompare(b.Shift || '')
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
    validateTransition(periodRecord.State, LIFECYCLE_STATES.CLOSED, { actor, isManual, reconciliation, currentRevision: periodRecord.Revision, phase: 5 });
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

  function reopenPeriodRecord({ periodRecord, reason, actor, timestamp = new Date().toISOString(), operationId, isManual = true, activeAmendmentCount = 0 }) {
    const nextState = determineReopenTarget(activeAmendmentCount);
    validateTransition(periodRecord.State, nextState, { actor, reason, isManual, currentRevision: periodRecord.Revision, phase: 5, activeAmendmentCount });
    return {
      ...periodRecord,
      State: nextState,
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

  /**
   * CANONICAL AMENDMENT TARGET IDENTITY CONTRACT (Phase 5)
   *
   * An amendment cell is uniquely identified by the 3-tuple:
   *   (PersonId, Date, DutyDomain)
   * Formatted string: `${PersonId}/${Date}/${DutyDomain}`
   *
   * Rationale & Invariants:
   * 1. Clinical rosters legitimately contain multiple assignments for the same person
   *    and date across distinct duty domains (e.g. 'MO' for medical officer clinical duty,
   *    'EP' / 'EP_OFFICE_HOUR' / 'EP_ONCALL' for emergency physician coverage).
   * 2. Within a single domain cell (PersonId + Date + DutyDomain), multiple shifts
   *    (e.g., duty + standby, or AM + ON1) are represented as an array of assignment objects
   *    inside BeforeCurrentJson and AfterCurrentJson.
   * 3. Targeting PersonId + Date + DutyDomain guarantees that modifying or swapping an
   *    assignment in one domain (e.g. MO clinical duty) never corrupts, removes, or
   *    overwrites an assignment belonging to the same person on the same date in a
   *    different domain.
   * 4. For backward compatibility with 2-part keys (PersonId/Date), DutyDomain defaults to 'MO'.
   *
   * PLANNED SNAPSHOT INTEGRITY CONTRACT:
   * - PlannedSnapshotId is an immutable identity token ('snapshot:<periodId>:<id>'), NOT a checksum.
   * - Immutable Layer='PLANNED' rows + PlannedSnapshotId preserve the original published snapshot.
   * - PlannedWeekChecksum in WeeklyOffSnapshots preserves weekly publication-time compliance integrity.
   * - No separate monthly planned checksum exists in the database schema; RosterPeriods.ProjectionChecksum
   *   holds the checksum of the active MasterRoster projection (Planned at publish, Current after amendments).
   */
  function makeCellKey(personId, date, dutyDomain = 'MO') {
    const p = String(personId || '').trim();
    const d = String(date || '').trim();
    const dom = dutyDomain !== undefined && dutyDomain !== null ? String(dutyDomain).trim() : 'MO';
    if (!p) throw fail(LIFECYCLE_ERRORS.VALIDATION_FAILED, 'personId is required for makeCellKey');
    if (!d) throw fail(LIFECYCLE_ERRORS.VALIDATION_FAILED, 'date is required for makeCellKey');
    if (!dom) throw fail(LIFECYCLE_ERRORS.VALIDATION_FAILED, 'dutyDomain is required for makeCellKey');
    return `${p}/${d}/${dom}`;
  }

  function parseCellKey(cellKey) {
    const parts = String(cellKey || '').split('/');
    if (parts.length >= 3) {
      return {
        personId: parts[0],
        date: parts[1],
        dutyDomain: parts[2] || 'MO'
      };
    }
    return {
      personId: parts[0] || '',
      date: parts[1] || '',
      dutyDomain: 'MO'
    };
  }

  function isValidPublicReasonCode(code) {
    if (!code || typeof code !== 'string') return false;
    const clean = code.trim();
    return Object.values(PUBLIC_REASON_CODES).includes(clean) ||
           ['PUBLISH', 'CLOSE', 'REOPEN'].includes(clean);
  }

  function validatePublicReasonCode(code) {
    if (!isValidPublicReasonCode(code)) {
      throw fail(LIFECYCLE_ERRORS.UNKNOWN_REASON_CODE, `Invalid public reason code: '${code}'`);
    }
    return String(code).trim();
  }

  /**
   * Pure grouping and atomicity validation layer.
   * Groups physical line-oriented RosterEvents rows sharing EventId into an atomic event object.
   * Validates header identity, LineId uniqueness, and cardinality.
   */
  function groupEventLines(rawRows = []) {
    if (!Array.isArray(rawRows)) return [];
    const groups = new Map();

    for (const raw of rawRows) {
      if (!raw) continue;
      const eventId = String(raw.EventId || raw.eventId || '').trim();
      const lineId = String(raw.LineId || raw.lineId || '').trim();
      if (!eventId) throw fail(LIFECYCLE_ERRORS.MALFORMED_EVENT, 'Event line missing EventId');
      if (!lineId) throw fail(LIFECYCLE_ERRORS.MALFORMED_EVENT, 'Event line missing LineId');

      const normEventType = String(raw.EventType || raw.eventType || '').trim();
      const rawDomain = raw.DutyDomain !== undefined && raw.DutyDomain !== null
        ? String(raw.DutyDomain).trim()
        : (raw.dutyDomain !== undefined && raw.dutyDomain !== null ? String(raw.dutyDomain).trim() : '');
      const rawPerson = raw.PersonId !== undefined && raw.PersonId !== null
        ? String(raw.PersonId).trim()
        : (raw.personId !== undefined && raw.personId !== null ? String(raw.personId).trim() : '');
      const rawDate = raw.Date !== undefined && raw.Date !== null
        ? String(raw.Date).trim()
        : (raw.date !== undefined && raw.date !== null ? String(raw.date).trim() : '');

      if (['ADMIN_CORRECTION', 'SWAP', 'REVERSAL'].includes(normEventType)) {
        if (!rawDomain) {
          throw fail(LIFECYCLE_ERRORS.MALFORMED_EVENT, `Event line '${lineId}' missing DutyDomain`);
        }
        if (!rawPerson) {
          throw fail(LIFECYCLE_ERRORS.MALFORMED_EVENT, `Event line '${lineId}' missing PersonId`);
        }
        if (!rawDate) {
          throw fail(LIFECYCLE_ERRORS.MALFORMED_EVENT, `Event line '${lineId}' missing Date`);
        }
      }

      const normRow = {
        EventId: eventId,
        LineId: lineId,
        EventType: normEventType,
        OperationId: String(raw.OperationId || raw.operationId || '').trim(),
        PeriodId: String(raw.PeriodId || raw.periodId || '').trim(),
        BaseRevision: Number(raw.BaseRevision ?? raw.baseRevision ?? 0),
        ResultRevision: Number(raw.ResultRevision ?? raw.resultRevision ?? 0),
        PersonId: rawPerson,
        LinkedPersonIdsJson: typeof raw.LinkedPersonIdsJson === 'string' ? raw.LinkedPersonIdsJson : JSON.stringify(raw.LinkedPersonIdsJson || []),
        Date: rawDate,
        DutyDomain: rawDomain,
        PlannedAssignmentJson: typeof raw.PlannedAssignmentJson === 'string' ? raw.PlannedAssignmentJson : JSON.stringify(raw.PlannedAssignmentJson || []),
        BeforeCurrentJson: typeof raw.BeforeCurrentJson === 'string' ? raw.BeforeCurrentJson : JSON.stringify(raw.BeforeCurrentJson || []),
        AfterCurrentJson: typeof raw.AfterCurrentJson === 'string' ? raw.AfterCurrentJson : JSON.stringify(raw.AfterCurrentJson || []),
        PublicReasonCode: String(raw.PublicReasonCode || raw.publicReasonCode || '').trim(),
        AdminNote: String(raw.AdminNote || raw.adminNote || ''),
        ShortageAccepted: Boolean(raw.ShortageAccepted || raw.shortageAccepted),
        ShortageReason: String(raw.ShortageReason || raw.shortageReason || ''),
        GoffTransactionIdsJson: typeof raw.GoffTransactionIdsJson === 'string' ? raw.GoffTransactionIdsJson : JSON.stringify(raw.GoffTransactionIdsJson || []),
        ReversesEventId: String(raw.ReversesEventId || raw.reversesEventId || '').trim(),
        CreatedAt: String(raw.CreatedAt || raw.createdAt || ''),
        CreatedBy: String(raw.CreatedBy || raw.createdBy || '')
      };

      if (!groups.has(eventId)) groups.set(eventId, []);
      groups.get(eventId).push(normRow);
    }

    const eventList = [];

    for (const [eventId, lines] of groups.entries()) {
      if (lines.length === 0) continue;
      const head = lines[0];

      // Validate uniformity across lines for all event-level fields
      const seenLineIds = new Set();
      for (const line of lines) {
        if (seenLineIds.has(line.LineId)) {
          throw fail(LIFECYCLE_ERRORS.MALFORMED_EVENT, `Duplicate LineId '${line.LineId}' in event '${eventId}'`);
        }
        seenLineIds.add(line.LineId);

        // Event-level fields MUST be strictly identical across all lines
        if (line.EventType !== head.EventType) {
          throw fail(LIFECYCLE_ERRORS.MALFORMED_EVENT, `Inconsistent EventType in event '${eventId}'`);
        }
        if (line.OperationId !== head.OperationId) {
          throw fail(LIFECYCLE_ERRORS.MALFORMED_EVENT, `Inconsistent OperationId in event '${eventId}'`);
        }
        if (line.PeriodId !== head.PeriodId) {
          throw fail(LIFECYCLE_ERRORS.MALFORMED_EVENT, `Inconsistent PeriodId in event '${eventId}'`);
        }
        if (line.BaseRevision !== head.BaseRevision) {
          throw fail(LIFECYCLE_ERRORS.MALFORMED_EVENT, `Inconsistent BaseRevision in event '${eventId}'`);
        }
        if (line.ResultRevision !== head.ResultRevision) {
          throw fail(LIFECYCLE_ERRORS.MALFORMED_EVENT, `Inconsistent ResultRevision in event '${eventId}'`);
        }
        if (line.PublicReasonCode !== head.PublicReasonCode) {
          throw fail(LIFECYCLE_ERRORS.MALFORMED_EVENT, `Inconsistent PublicReasonCode in event '${eventId}'`);
        }
        if (line.AdminNote !== head.AdminNote) {
          throw fail(LIFECYCLE_ERRORS.MALFORMED_EVENT, `Inconsistent AdminNote in event '${eventId}'`);
        }
        if (line.ReversesEventId !== head.ReversesEventId) {
          throw fail(LIFECYCLE_ERRORS.MALFORMED_EVENT, `Inconsistent ReversesEventId in event '${eventId}'`);
        }
        if (line.CreatedAt !== head.CreatedAt) {
          throw fail(LIFECYCLE_ERRORS.MALFORMED_EVENT, `Inconsistent CreatedAt in event '${eventId}'`);
        }
        if (line.CreatedBy !== head.CreatedBy) {
          throw fail(LIFECYCLE_ERRORS.MALFORMED_EVENT, `Inconsistent CreatedBy in event '${eventId}'`);
        }
        if (line.ShortageAccepted !== head.ShortageAccepted) {
          throw fail(LIFECYCLE_ERRORS.MALFORMED_EVENT, `Inconsistent ShortageAccepted in event '${eventId}'`);
        }
        if (line.ShortageReason !== head.ShortageReason) {
          throw fail(LIFECYCLE_ERRORS.MALFORMED_EVENT, `Inconsistent ShortageReason in event '${eventId}'`);
        }
      }

      // Validate EventType specific cardinality and structure
      if (head.EventType === 'SWAP') {
        if (lines.length !== 2) {
          throw fail(LIFECYCLE_ERRORS.INCOMPLETE_SWAP, `SWAP event must contain exactly 2 lines; found ${lines.length}`);
        }
        const p1 = lines[0].PersonId;
        const p2 = lines[1].PersonId;
        if (!p1 || !p2) {
          throw fail(LIFECYCLE_ERRORS.INCOMPLETE_SWAP, 'SWAP event lines must both specify PersonId');
        }
        let l1, l2;
        try { l1 = JSON.parse(lines[0].LinkedPersonIdsJson); } catch (e) { l1 = []; }
        try { l2 = JSON.parse(lines[1].LinkedPersonIdsJson); } catch (e) { l2 = []; }
        if (!Array.isArray(l1) || !l1.includes(p2)) {
          throw fail(LIFECYCLE_ERRORS.INCOMPLETE_SWAP, `SWAP line 1 must link to person 2 (${p2})`);
        }
        if (!Array.isArray(l2) || !l2.includes(p1)) {
          throw fail(LIFECYCLE_ERRORS.INCOMPLETE_SWAP, `SWAP line 2 must link to person 1 (${p1})`);
        }
      } else if (head.EventType === 'REVERSAL') {
        if (!head.ReversesEventId) {
          throw fail(LIFECYCLE_ERRORS.MALFORMED_EVENT, 'REVERSAL event must have ReversesEventId');
        }
        if (lines.length < 1) {
          throw fail(LIFECYCLE_ERRORS.MALFORMED_EVENT, 'REVERSAL event must have at least 1 line');
        }
      } else if (['PUBLISH', 'CLOSE', 'REOPEN'].includes(head.EventType)) {
        if (lines.length !== 1) {
          throw fail(LIFECYCLE_ERRORS.MALFORMED_EVENT, `Lifecycle event ${head.EventType} must have exactly 1 line`);
        }
      } else if (head.EventType === 'ADMIN_CORRECTION') {
        if (lines.length < 1) {
          throw fail(LIFECYCLE_ERRORS.MALFORMED_EVENT, 'ADMIN_CORRECTION must have at least 1 line');
        }
      }

      // Deterministic line ordering by LineId
      lines.sort((a, b) => a.LineId.localeCompare(b.LineId));

      eventList.push({
        EventId: head.EventId,
        EventType: head.EventType,
        OperationId: head.OperationId,
        PeriodId: head.PeriodId,
        BaseRevision: head.BaseRevision,
        ResultRevision: head.ResultRevision,
        ReversesEventId: head.ReversesEventId,
        PublicReasonCode: head.PublicReasonCode,
        AdminNote: head.AdminNote,
        CreatedAt: head.CreatedAt,
        CreatedBy: head.CreatedBy,
        lines
      });
    }

    // Deterministic event ordering by ResultRevision ASC, BaseRevision ASC, EventId ASC
    eventList.sort((a, b) =>
      a.ResultRevision - b.ResultRevision ||
      a.BaseRevision - b.BaseRevision ||
      a.EventId.localeCompare(b.EventId)
    );

    return eventList;
  }

  function countActiveAmendments(events = []) {
    const eventGroups = Array.isArray(events) && events.length > 0 && events[0]?.lines
      ? events
      : groupEventLines(events);

    const reversedIds = new Set();
    for (const ev of eventGroups) {
      if (ev.EventType === 'REVERSAL' && ev.ReversesEventId) {
        reversedIds.add(ev.ReversesEventId);
      }
    }

    let activeCount = 0;
    for (const ev of eventGroups) {
      if (['PUBLISH', 'CLOSE', 'REOPEN', 'REVERSAL'].includes(ev.EventType)) continue;
      if (!reversedIds.has(ev.EventId)) {
        activeCount++;
      }
    }
    return activeCount;
  }

  function determineReopenTarget(activeAmendmentCount) {
    const count = Number(activeAmendmentCount) || 0;
    return count > 0 ? LIFECYCLE_STATES.AMENDED : LIFECYCLE_STATES.PUBLISHED;
  }

  /**
   * Reversal eligibility and dependency validator.
   * Enforces append-only compensating reversal safety.
   */
  function canReverseEvent(targetEventId, events = []) {
    const eventGroups = Array.isArray(events) && events.length > 0 && events[0]?.lines
      ? events
      : groupEventLines(events);

    const targetEvent = eventGroups.find(e => e.EventId === targetEventId);
    if (!targetEvent) {
      return { canReverse: false, code: LIFECYCLE_ERRORS.EVENT_NOT_FOUND, reason: `Target event '${targetEventId}' not found` };
    }

    if (['PUBLISH', 'CLOSE', 'REOPEN'].includes(targetEvent.EventType)) {
      return { canReverse: false, code: LIFECYCLE_ERRORS.CANNOT_REVERSE_LIFECYCLE_EVENT, reason: `Lifecycle event ${targetEvent.EventType} cannot be reversed` };
    }

    if (targetEvent.EventType === 'REVERSAL') {
      return { canReverse: false, code: LIFECYCLE_ERRORS.CANNOT_REVERSE_REVERSAL, reason: 'A reversal event cannot itself be reversed' };
    }

    // Check if target event was already reversed
    const existingReversal = eventGroups.find(e => e.EventType === 'REVERSAL' && e.ReversesEventId === targetEventId);
    if (existingReversal) {
      return {
        canReverse: false,
        code: LIFECYCLE_ERRORS.EVENT_ALREADY_REVERSED,
        reason: `Event '${targetEventId}' was already reversed by event '${existingReversal.EventId}'`
      };
    }

    // Target cells touched by target event
    const targetCells = new Set(targetEvent.lines.map(l => makeCellKey(l.PersonId, l.Date, l.DutyDomain)));

    // Track active status of subsequent events
    const reversedIds = new Set(
      eventGroups.filter(e => e.EventType === 'REVERSAL' && e.ReversesEventId).map(e => e.ReversesEventId)
    );

    // Look for newer active amendments touching any of the target cells
    for (const ev of eventGroups) {
      if (ev.ResultRevision <= targetEvent.ResultRevision) continue;
      if (['PUBLISH', 'CLOSE', 'REOPEN', 'REVERSAL'].includes(ev.EventType)) continue;
      if (reversedIds.has(ev.EventId)) continue; // Newer amendment was itself reversed, so not a conflict

      for (const line of ev.lines) {
        const key = makeCellKey(line.PersonId, line.Date, line.DutyDomain);
        if (targetCells.has(key)) {
          return {
            canReverse: false,
            code: LIFECYCLE_ERRORS.REVERSAL_DEPENDENCY_CONFLICT,
            conflictingEventId: ev.EventId,
            conflictingCell: key,
            reason: `Newer active amendment '${ev.EventId}' modified cell '${key}'`
          };
        }
      }
    }

    return { canReverse: true, targetEvent };
  }

  /**
   * Pure deterministic Current Roster resolver.
   * Receives immutable planned assignments and confirmed event lines/groups.
   * Never mutates inputs, accesses external I/O, or leaks private notes.
   */
  function resolveCurrentRoster({
    periodId,
    plannedAssignments = [],
    events = [],
    absences = [],
    replacements = [],
    people = [],
    digestFn
  }) {
    RosterCompatibility.validatePeriod(periodId);
    const eventGroups = Array.isArray(events) && events.length > 0 && events[0]?.lines && Number.isInteger(events[0]?.BaseRevision)
      ? events
      : groupEventLines(events.flatMap(e => (e && e.lines) ? e.lines : [e]));

    // 1. Initialize Current cells from Planned assignments (pure, no mutation)
    const currentCells = new Map();

    for (const a of plannedAssignments) {
      const cellKey = makeCellKey(a.PersonId, a.Date, a.DutyDomain);
      if (!currentCells.has(cellKey)) {
        currentCells.set(cellKey, []);
      }
      currentCells.get(cellKey).push({
        AssignmentId: a.AssignmentId,
        PeriodId: a.PeriodId,
        Layer: 'CURRENT',
        SnapshotId: a.SnapshotId,
        PersonId: a.PersonId,
        PersonNameSnapshot: a.PersonNameSnapshot || '',
        Date: a.Date,
        DutyDomain: a.DutyDomain,
        ShiftCode: a.ShiftCode,
        ModifiersJson: typeof a.ModifiersJson === 'object' ? JSON.stringify(a.ModifiersJson) : (a.ModifiersJson || '{}'),
        DraftRevision: a.DraftRevision || 0,
        Source: a.Source || 'NEW',
        OperationId: a.OperationId,
        CreatedAt: a.CreatedAt,
        CreatedBy: a.CreatedBy,
        _rawShift: a._rawShift
      });
    }

    // 2. Validate revision chain invariants and track reversals
    const reversedEventIds = new Set();
    for (let i = 0; i < eventGroups.length; i++) {
      const ev = eventGroups[i];
      if (!Number.isInteger(ev.BaseRevision) || ev.BaseRevision < 0) {
        throw fail(LIFECYCLE_ERRORS.MALFORMED_EVENT, `Event '${ev.EventId}' has invalid BaseRevision: ${ev.BaseRevision}`);
      }
      if (!Number.isInteger(ev.ResultRevision) || ev.ResultRevision <= 0) {
        throw fail(LIFECYCLE_ERRORS.MALFORMED_EVENT, `Event '${ev.EventId}' has invalid ResultRevision: ${ev.ResultRevision}`);
      }
      if (ev.ResultRevision <= ev.BaseRevision) {
        throw fail(LIFECYCLE_ERRORS.MALFORMED_EVENT, `Event '${ev.EventId}' ResultRevision (${ev.ResultRevision}) must be greater than BaseRevision (${ev.BaseRevision})`);
      }

      if (i > 0) {
        const prev = eventGroups[i - 1];
        if (ev.ResultRevision === prev.ResultRevision) {
          throw fail(LIFECYCLE_ERRORS.REVISION_CONFLICT, `Duplicate ResultRevision ${ev.ResultRevision} found in events '${ev.EventId}' and '${prev.EventId}'`);
        }
        if (ev.BaseRevision < prev.ResultRevision) {
          throw fail(LIFECYCLE_ERRORS.REVISION_CONFLICT, `Event '${ev.EventId}' branches from BaseRevision ${ev.BaseRevision}, but preceding event already produced ResultRevision ${prev.ResultRevision}`);
        }
      }

      if (ev.EventType === 'REVERSAL') {
        if (!ev.ReversesEventId) {
          throw fail(LIFECYCLE_ERRORS.MALFORMED_EVENT, `Reversal event '${ev.EventId}' missing ReversesEventId`);
        }
        if (reversedEventIds.has(ev.ReversesEventId)) {
          throw fail(LIFECYCLE_ERRORS.EVENT_ALREADY_REVERSED, `Target event '${ev.ReversesEventId}' has already been reversed`);
        }
        reversedEventIds.add(ev.ReversesEventId);
      }
    }

    // 3. Apply event groups in ResultRevision order
    for (const ev of eventGroups) {
      if (['PUBLISH', 'CLOSE', 'REOPEN'].includes(ev.EventType)) {
        continue; // Lifecycle events do not alter assignment cells
      }

      for (const line of ev.lines) {
        if (!line.DutyDomain || !String(line.DutyDomain).trim()) {
          throw fail(LIFECYCLE_ERRORS.MALFORMED_EVENT, `Event line '${line.LineId}' missing DutyDomain`);
        }
        const cellKey = makeCellKey(line.PersonId, line.Date, line.DutyDomain);
        let afterItems = [];
        if (line.AfterCurrentJson) {
          try {
            afterItems = typeof line.AfterCurrentJson === 'string'
              ? JSON.parse(line.AfterCurrentJson)
              : line.AfterCurrentJson;
          } catch (e) {
            throw fail(LIFECYCLE_ERRORS.MALFORMED_EVENT, `Invalid JSON in AfterCurrentJson for line '${line.LineId}'`);
          }
        }
        if (!Array.isArray(afterItems)) {
          afterItems = afterItems ? [afterItems] : [];
        }

        const normalizedItems = afterItems.map((item, idx) => {
          if (typeof item === 'string') {
            const resolved = RosterCompatibility.resolveShift(item, line.DutyDomain);
            return {
              AssignmentId: deterministicAssignmentId(ev.OperationId, line.PersonId, line.Date, line.DutyDomain, resolved.baseCode, item, idx, digestFn),
              PeriodId: line.PeriodId,
              Layer: 'CURRENT',
              SnapshotId: '',
              PersonId: line.PersonId,
              PersonNameSnapshot: '',
              Date: line.Date,
              DutyDomain: line.DutyDomain,
              ShiftCode: resolved.baseCode,
              ModifiersJson: JSON.stringify(resolved.modifiers || { extended: false, standby: false }),
              DraftRevision: 0,
              Source: 'AMENDMENT',
              OperationId: ev.OperationId,
              CreatedAt: ev.CreatedAt,
              CreatedBy: ev.CreatedBy,
              _rawShift: item
            };
          }
          const raw = item._rawShift || item.rawShift || item.ShiftCode || item.shiftCode || '';
          const resolved = RosterCompatibility.resolveShift(raw, line.DutyDomain);
          return {
            AssignmentId: item.AssignmentId || item.assignmentId || deterministicAssignmentId(ev.OperationId, line.PersonId, line.Date, line.DutyDomain, resolved.baseCode, raw, idx, digestFn),
            PeriodId: line.PeriodId,
            Layer: 'CURRENT',
            SnapshotId: item.SnapshotId || '',
            PersonId: line.PersonId,
            PersonNameSnapshot: item.PersonNameSnapshot || item.Name || '',
            Date: line.Date,
            DutyDomain: line.DutyDomain,
            ShiftCode: item.ShiftCode || resolved.baseCode,
            ModifiersJson: typeof item.ModifiersJson === 'object' ? JSON.stringify(item.ModifiersJson) : (item.ModifiersJson || JSON.stringify(resolved.modifiers || { extended: false, standby: false })),
            DraftRevision: item.DraftRevision || 0,
            Source: item.Source || 'AMENDMENT',
            OperationId: ev.OperationId,
            CreatedAt: item.CreatedAt || ev.CreatedAt,
            CreatedBy: item.CreatedBy || ev.CreatedBy,
            _rawShift: raw
          };
        });

        // Enrich person names from people or planned assignments
        normalizedItems.forEach(item => {
          if (!item.PersonNameSnapshot) {
            const fromPlan = plannedAssignments.find(p => p.PersonId === item.PersonId);
            if (fromPlan?.PersonNameSnapshot) {
              item.PersonNameSnapshot = fromPlan.PersonNameSnapshot;
            } else {
              const person = people.find(p => p.PersonId === item.PersonId);
              if (person) {
                item.PersonNameSnapshot = person.CurrentDisplayName || person.MemberName || '';
              }
            }
          }
        });

        currentCells.set(cellKey, normalizedItems);
      }
    }

    // 3b. Apply active Phase 6 Absences (operational state reflects unavailable staff)
    const activeAbsences = (absences || []).filter(a =>
      a && (a.Status === 'ACTIVE' || a.status === 'ACTIVE') &&
      (!a.PeriodId || a.PeriodId === periodId || (a.StartDate && a.StartDate.slice(0, 7) <= periodId && a.EndDate && a.EndDate.slice(0, 7) >= periodId))
    );

    for (const absence of activeAbsences) {
      const domain = absence.DutyDomain || absence.dutyDomain || 'MO';
      const personId = absence.PersonId || absence.personId;
      const startDate = absence.StartDate || absence.startDate;
      const endDate = absence.EndDate || absence.endDate;
      const absenceType = absence.AbsenceType || absence.absenceType;

      for (const [key, items] of currentCells.entries()) {
        const parsed = parseCellKey(key);
        if (parsed.personId !== personId || parsed.dutyDomain !== domain) continue;
        if (parsed.date < startDate || parsed.date > endDate) continue;

        for (const item of items) {
          if (item.ShiftCode !== 'OFF') {
            item.OriginalShiftCode = item.OriginalShiftCode || item.ShiftCode;
            item.OriginalAssignmentId = item.OriginalAssignmentId || item.AssignmentId;
            item.ShiftCode = absenceType;
            item._rawShift = absenceType;
            item.Source = 'ABSENCE';
            item.AbsenceId = absence.AbsenceId || absence.absenceId;
            item.CoverageStatus = 'UNCOVERED';
          }
        }
      }
    }

    // 3c. Apply active Phase 6 Replacements (operational state reflects covering staff)
    const activeReplacements = (replacements || []).filter(r =>
      r && (r.Status === 'ACTIVE' || r.status === 'ACTIVE')
    );

    const peopleLookup = new Map();
    for (const p of people) {
      if (p.PersonId) peopleLookup.set(p.PersonId, p.CurrentDisplayName || p.MemberName || '');
    }

    for (const repl of activeReplacements) {
      const absenceId = repl.AbsenceId || repl.absenceId;
      const domain = repl.DutyDomain || repl.dutyDomain || 'MO';
      const replDate = repl.Date || repl.date;
      const replShift = repl.ShiftCode || repl.shiftCode;
      const replPersonId = repl.ReplacementPersonId || repl.replacementPersonId;
      const origAssignId = repl.OriginalAssignmentId || repl.originalAssignmentId;
      const replId = repl.ReplacementId || repl.replacementId;

      const targetAbsence = activeAbsences.find(a => (a.AbsenceId || a.absenceId) === absenceId);
      if (!targetAbsence) continue; // Inactive or missing absence target

      // Mark the absent assignment as COVERED
      const absentPersonId = targetAbsence.PersonId || targetAbsence.personId;
      const absentKey = makeCellKey(absentPersonId, replDate, domain);
      const absentItems = currentCells.get(absentKey) || [];
      for (const item of absentItems) {
        if (item.AbsenceId === absenceId && (!origAssignId || item.OriginalAssignmentId === origAssignId)) {
          item.CoverageStatus = 'COVERED';
          item.ReplacementId = replId;
        }
      }

      // Add the covering replacement assignment
      const replKey = makeCellKey(replPersonId, replDate, domain);
      if (!currentCells.has(replKey)) {
        currentCells.set(replKey, []);
      }

      const replPersonName = peopleLookup.get(replPersonId) ||
        repl.PersonNameSnapshot ||
        repl.personNameSnapshot ||
        plannedAssignments.find(a => a.PersonId === replPersonId)?.PersonNameSnapshot ||
        '';

      const replAssignId = repl.ReplacementAssignmentId || repl.replacementAssignmentId ||
        deterministicAssignmentId(repl.OperationId || targetAbsence.OperationId, replPersonId, replDate, domain, replShift, 0, digestFn);

      const replAssignment = {
        AssignmentId: replAssignId,
        PeriodId: periodId,
        Layer: 'CURRENT',
        SnapshotId: '',
        PersonId: replPersonId,
        PersonNameSnapshot: replPersonName,
        Date: replDate,
        DutyDomain: domain,
        ShiftCode: replShift,
        ModifiersJson: JSON.stringify({ extended: false, standby: false }),
        DraftRevision: 0,
        Source: 'REPLACEMENT',
        CoverageStatus: 'COVERED',
        AbsenceId: absenceId,
        ReplacementId: replId,
        OriginalAssignmentId: origAssignId,
        CoveringForPersonId: absentPersonId,
        OperationId: repl.OperationId || targetAbsence.OperationId,
        CreatedAt: repl.CreatedAt || targetAbsence.CreatedAt,
        CreatedBy: repl.CreatedBy || targetAbsence.CreatedBy,
        _rawShift: replShift
      };

      currentCells.get(replKey).push(replAssignment);
    }

    // 4. Flatten all current assignments and sort canonically
    const currentAssignments = [];
    for (const [_, items] of currentCells.entries()) {
      for (const item of items) {
        currentAssignments.push(item);
      }
    }

    currentAssignments.sort((a, b) =>
      (a.Date || '').localeCompare(b.Date || '') ||
      (a.DutyDomain || '').localeCompare(b.DutyDomain || '') ||
      (a.PersonId || '').localeCompare(b.PersonId || '') ||
      (a.ShiftCode || '').localeCompare(b.ShiftCode || '') ||
      (a.AssignmentId || '').localeCompare(b.AssignmentId || '')
    );

    // 5. Active amendments & effective state
    const activeCount = countActiveAmendments(eventGroups);
    const hasActiveAbsence = activeAbsences.length > 0;
    const effectiveState = (activeCount > 0 || hasActiveAbsence) ? LIFECYCLE_STATES.AMENDED : LIFECYCLE_STATES.PUBLISHED;

    // 6. Master roster projection & checksum
    const masterRosterProjection = generateMasterRosterProjection(currentAssignments);
    let projectionChecksum = '';
    if (typeof digestFn === 'function') {
      projectionChecksum = computeProjectionChecksum(masterRosterProjection, digestFn);
    }

    return {
      periodId,
      effectiveState,
      activeAmendmentCount: activeCount,
      activeAbsences,
      activeReplacements,
      totalEvents: eventGroups.length,
      reversedEventIds: Array.from(reversedEventIds),
      currentAssignments,
      assignments: currentAssignments,
      currentCells,
      masterRosterProjection,
      projectionChecksum,
      events: eventGroups
    };
  }

  function createAmendmentEvent({
    periodId,
    baseRevision,
    resultRevision,
    operationId,
    actor,
    eventType = AMENDMENT_EVENT_TYPES.ADMIN_CORRECTION,
    publicReasonCode,
    adminNote = '',
    personId,
    date,
    dutyDomain,
    plannedAssignments = [],
    beforeAssignments = [],
    afterAssignments = [],
    linkedPersonIds = [],
    shortageAccepted = false,
    shortageReason = '',
    timestamp = new Date().toISOString(),
    eventId: explicitEventId,
    lineId: explicitLineId
  }) {
    RosterCompatibility.validatePeriod(periodId);
    if (!operationId || !isUuid(operationId)) {
      throw fail(LIFECYCLE_ERRORS.VALIDATION_FAILED, 'OperationId must be a valid UUID');
    }
    const cleanActor = String(actor || '').trim();
    if (!cleanActor) {
      throw fail(LIFECYCLE_ERRORS.INVALID_OPERATOR, 'Actor is required');
    }
    if (!dutyDomain || typeof dutyDomain !== 'string' || !dutyDomain.trim()) {
      throw fail(LIFECYCLE_ERRORS.VALIDATION_FAILED, 'DutyDomain is required and must be explicit for amendment event');
    }
    const cleanPersonId = String(personId || '').trim();
    if (!cleanPersonId) {
      throw fail(LIFECYCLE_ERRORS.VALIDATION_FAILED, 'PersonId is required and must be explicit for amendment event');
    }
    const cleanDate = String(date || '').trim();
    if (!cleanDate) {
      throw fail(LIFECYCLE_ERRORS.VALIDATION_FAILED, 'Date is required and must be explicit for amendment event');
    }
    const reason = validatePublicReasonCode(publicReasonCode);

    const eventId = explicitEventId || deterministicEventId(operationId, eventType, cleanPersonId, cleanDate, dutyDomain.trim());
    const lineId = explicitLineId || deterministicLineId(eventId, 0, cleanPersonId, cleanDate, dutyDomain.trim());

    const line = {
      EventId: eventId,
      LineId: lineId,
      EventType: eventType,
      OperationId: operationId,
      PeriodId: periodId,
      BaseRevision: Number(baseRevision),
      ResultRevision: Number(resultRevision),
      PersonId: cleanPersonId,
      LinkedPersonIdsJson: JSON.stringify(linkedPersonIds || []),
      Date: cleanDate,
      DutyDomain: dutyDomain.trim(),
      PlannedAssignmentJson: typeof plannedAssignments === 'string' ? plannedAssignments : JSON.stringify(plannedAssignments || []),
      BeforeCurrentJson: typeof beforeAssignments === 'string' ? beforeAssignments : JSON.stringify(beforeAssignments || []),
      AfterCurrentJson: typeof afterAssignments === 'string' ? afterAssignments : JSON.stringify(afterAssignments || []),
      PublicReasonCode: reason,
      AdminNote: String(adminNote || ''),
      ShortageAccepted: Boolean(shortageAccepted),
      ShortageReason: String(shortageReason || ''),
      GoffTransactionIdsJson: '[]',
      ReversesEventId: '',
      CreatedAt: timestamp,
      CreatedBy: cleanActor
    };

    return {
      eventId,
      EventId: eventId,
      EventType: line.EventType,
      OperationId: line.OperationId,
      PeriodId: line.PeriodId,
      BaseRevision: line.BaseRevision,
      ResultRevision: line.ResultRevision,
      ReversesEventId: line.ReversesEventId,
      PublicReasonCode: line.PublicReasonCode,
      AdminNote: line.AdminNote,
      CreatedAt: line.CreatedAt,
      CreatedBy: line.CreatedBy,
      lines: [line]
    };
  }

  function createSwapEvent({
    periodId,
    baseRevision,
    resultRevision,
    operationId,
    actor,
    publicReasonCode = PUBLIC_REASON_CODES.SHIFT_SWAP,
    adminNote = '',
    person1,
    person2,
    timestamp = new Date().toISOString(),
    eventId: explicitEventId,
    line1Id: explicitLine1Id,
    line2Id: explicitLine2Id
  }) {
    RosterCompatibility.validatePeriod(periodId);
    if (!operationId || !isUuid(operationId)) {
      throw fail(LIFECYCLE_ERRORS.VALIDATION_FAILED, 'OperationId must be a valid UUID');
    }
    const cleanActor = String(actor || '').trim();
    if (!cleanActor) {
      throw fail(LIFECYCLE_ERRORS.INVALID_OPERATOR, 'Actor is required');
    }
    if (!person1 || !person2 || !person1.personId || !person2.personId) {
      throw fail(LIFECYCLE_ERRORS.VALIDATION_FAILED, 'SWAP event requires two participants with personId');
    }
    if (!person1.date || !person2.date) {
      throw fail(LIFECYCLE_ERRORS.VALIDATION_FAILED, 'SWAP event requires dates for both participants');
    }
    if (!person1.dutyDomain || typeof person1.dutyDomain !== 'string' || !person1.dutyDomain.trim()) {
      throw fail(LIFECYCLE_ERRORS.VALIDATION_FAILED, 'person1 DutyDomain is required and must be explicit for swap event');
    }
    if (!person2.dutyDomain || typeof person2.dutyDomain !== 'string' || !person2.dutyDomain.trim()) {
      throw fail(LIFECYCLE_ERRORS.VALIDATION_FAILED, 'person2 DutyDomain is required and must be explicit for swap event');
    }
    const reason = validatePublicReasonCode(publicReasonCode);

    const eventId = explicitEventId || deterministicEventId(operationId, 'SWAP', String(person1.personId).trim(), String(person2.personId).trim());
    const line1Id = explicitLine1Id || deterministicLineId(eventId, 0, String(person1.personId).trim(), String(person1.date).trim(), String(person1.dutyDomain).trim());
    const line2Id = explicitLine2Id || deterministicLineId(eventId, 1, String(person2.personId).trim(), String(person2.date).trim(), String(person2.dutyDomain).trim());

    const line1 = {
      EventId: eventId,
      LineId: line1Id,
      EventType: AMENDMENT_EVENT_TYPES.SWAP,
      OperationId: operationId,
      PeriodId: periodId,
      BaseRevision: Number(baseRevision),
      ResultRevision: Number(resultRevision),
      PersonId: String(person1.personId).trim(),
      LinkedPersonIdsJson: JSON.stringify([String(person2.personId).trim()]),
      Date: String(person1.date).trim(),
      DutyDomain: String(person1.dutyDomain).trim(),
      PlannedAssignmentJson: typeof person1.plannedAssignments === 'string' ? person1.plannedAssignments : JSON.stringify(person1.plannedAssignments || []),
      BeforeCurrentJson: typeof person1.beforeAssignments === 'string' ? person1.beforeAssignments : JSON.stringify(person1.beforeAssignments || []),
      AfterCurrentJson: typeof person1.afterAssignments === 'string' ? person1.afterAssignments : JSON.stringify(person1.afterAssignments || []),
      PublicReasonCode: reason,
      AdminNote: String(adminNote || ''),
      ShortageAccepted: false,
      ShortageReason: '',
      GoffTransactionIdsJson: '[]',
      ReversesEventId: '',
      CreatedAt: timestamp,
      CreatedBy: cleanActor
    };

    const line2 = {
      EventId: eventId,
      LineId: line2Id,
      EventType: AMENDMENT_EVENT_TYPES.SWAP,
      OperationId: operationId,
      PeriodId: periodId,
      BaseRevision: Number(baseRevision),
      ResultRevision: Number(resultRevision),
      PersonId: String(person2.personId).trim(),
      LinkedPersonIdsJson: JSON.stringify([String(person1.personId).trim()]),
      Date: String(person2.date).trim(),
      DutyDomain: String(person2.dutyDomain).trim(),
      PlannedAssignmentJson: typeof person2.plannedAssignments === 'string' ? person2.plannedAssignments : JSON.stringify(person2.plannedAssignments || []),
      BeforeCurrentJson: typeof person2.beforeAssignments === 'string' ? person2.beforeAssignments : JSON.stringify(person2.beforeAssignments || []),
      AfterCurrentJson: typeof person2.afterAssignments === 'string' ? person2.afterAssignments : JSON.stringify(person2.afterAssignments || []),
      PublicReasonCode: reason,
      AdminNote: String(adminNote || ''),
      ShortageAccepted: false,
      ShortageReason: '',
      GoffTransactionIdsJson: '[]',
      ReversesEventId: '',
      CreatedAt: timestamp,
      CreatedBy: cleanActor
    };

    return {
      eventId,
      EventId: eventId,
      EventType: line1.EventType,
      OperationId: line1.OperationId,
      PeriodId: line1.PeriodId,
      BaseRevision: line1.BaseRevision,
      ResultRevision: line1.ResultRevision,
      ReversesEventId: line1.ReversesEventId,
      PublicReasonCode: line1.PublicReasonCode,
      AdminNote: line1.AdminNote,
      CreatedAt: line1.CreatedAt,
      CreatedBy: line1.CreatedBy,
      lines: [line1, line2]
    };
  }

  function createReversalEvent({
    targetEvent,
    baseRevision,
    resultRevision,
    operationId,
    actor,
    publicReasonCode,
    adminNote = '',
    timestamp = new Date().toISOString(),
    eventId: explicitEventId
  }) {
    if (!targetEvent || !targetEvent.EventId || !Array.isArray(targetEvent.lines) || targetEvent.lines.length === 0) {
      throw fail(LIFECYCLE_ERRORS.VALIDATION_FAILED, 'Valid targetEvent with lines is required for reversal');
    }
    if (!operationId || !isUuid(operationId)) {
      throw fail(LIFECYCLE_ERRORS.VALIDATION_FAILED, 'OperationId must be a valid UUID');
    }
    const cleanActor = String(actor || '').trim();
    if (!cleanActor) {
      throw fail(LIFECYCLE_ERRORS.INVALID_OPERATOR, 'Actor is required');
    }

    const chosenCode = publicReasonCode || targetEvent.PublicReasonCode || PUBLIC_REASON_CODES.ADMIN_CORRECTION;
    const reason = validatePublicReasonCode(chosenCode);

    for (const tgtLine of targetEvent.lines) {
      if (!tgtLine.DutyDomain || !String(tgtLine.DutyDomain).trim()) {
        throw fail(LIFECYCLE_ERRORS.VALIDATION_FAILED, `targetEvent line '${tgtLine.LineId}' missing DutyDomain`);
      }
      if (!tgtLine.PersonId || !String(tgtLine.PersonId).trim()) {
        throw fail(LIFECYCLE_ERRORS.VALIDATION_FAILED, `targetEvent line '${tgtLine.LineId}' missing PersonId`);
      }
      if (!tgtLine.Date || !String(tgtLine.Date).trim()) {
        throw fail(LIFECYCLE_ERRORS.VALIDATION_FAILED, `targetEvent line '${tgtLine.LineId}' missing Date`);
      }
    }

    const eventId = explicitEventId || deterministicEventId(operationId, 'REVERSAL', targetEvent.EventId);
    const lines = targetEvent.lines.map((tgtLine, idx) => ({
      EventId: eventId,
      LineId: deterministicLineId(eventId, idx, tgtLine.PersonId, tgtLine.Date, tgtLine.DutyDomain),
      EventType: AMENDMENT_EVENT_TYPES.REVERSAL,
      OperationId: operationId,
      PeriodId: tgtLine.PeriodId,
      BaseRevision: Number(baseRevision),
      ResultRevision: Number(resultRevision),
      PersonId: tgtLine.PersonId,
      LinkedPersonIdsJson: tgtLine.LinkedPersonIdsJson || '[]',
      Date: tgtLine.Date,
      DutyDomain: tgtLine.DutyDomain,
      PlannedAssignmentJson: tgtLine.PlannedAssignmentJson || '[]',
      BeforeCurrentJson: tgtLine.AfterCurrentJson, // State immediately before reversal
      AfterCurrentJson: tgtLine.BeforeCurrentJson,  // State to restore
      PublicReasonCode: reason,
      AdminNote: String(adminNote || ''),
      ShortageAccepted: false,
      ShortageReason: '',
      GoffTransactionIdsJson: '[]',
      ReversesEventId: targetEvent.EventId,
      CreatedAt: timestamp,
      CreatedBy: cleanActor
    }));

    const head = lines[0];
    return {
      eventId,
      EventId: eventId,
      EventType: head.EventType,
      OperationId: head.OperationId,
      PeriodId: head.PeriodId,
      BaseRevision: head.BaseRevision,
      ResultRevision: head.ResultRevision,
      ReversesEventId: head.ReversesEventId,
      PublicReasonCode: head.PublicReasonCode,
      AdminNote: head.AdminNote,
      CreatedAt: head.CreatedAt,
      CreatedBy: head.CreatedBy,
      lines
    };
  }

  return freeze({
    LIFECYCLE_STATES,
    LIFECYCLE_OPERATIONS,
    LIFECYCLE_ERRORS,
    ROSTER_LIFECYCLE_SCHEMAS,
    AMENDMENT_EVENT_TYPES,
    PUBLIC_REASON_CODES,
    deterministicUuid,
    deterministicEventId,
    deterministicLineId,
    deterministicAssignmentId,
    makeCellKey,
    parseCellKey,
    isValidPublicReasonCode,
    validatePublicReasonCode,
    groupEventLines,
    groupEventRows: groupEventLines,
    countActiveAmendments,
    determineReopenTarget,
    canReverseEvent,
    resolveCurrentRoster,
    createAmendmentEvent,
    createSwapEvent,
    createReversalEvent,
    canTransition,
    canTransitionPhase5: (from, to) => canTransition(from, to, { phase: 5 }),
    validateTransition,
    generatePlannedSnapshot,
    formatRawShift,
    generateMasterRosterProjection,
    generateCurrentMasterRosterProjection: generateMasterRosterProjection,
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
