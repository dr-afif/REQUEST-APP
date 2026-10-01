import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import RosterLifecycle from '../../src/features/roster/lifecycle.js';
import RosterCompatibility from '../../src/features/roster/compatibility.js';
import RosterGuidance from '../../src/features/roster/guidance.js';

const sha256 = str => crypto.createHash('sha256').update(str).digest('hex');

const mockPerson1 = {
  PersonId: '11111111-1111-4111-8111-111111111111',
  CurrentDisplayName: 'Dr. Ali',
  DirectoryType: 'MO',
  Active: true
};

const mockPerson2 = {
  PersonId: '22222222-2222-4222-8222-222222222222',
  CurrentDisplayName: 'Dr. Siti',
  DirectoryType: 'MO',
  Active: true
};

const mockEp = {
  PersonId: '33333333-3333-4333-8333-333333333333',
  CurrentDisplayName: 'Dr. EP Kamal',
  DirectoryType: 'EP',
  Active: true
};

const mockPeople = [mockPerson1, mockPerson2, mockEp];

const mockPolicyA = {
  PolicyId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  PolicyCode: 'A',
  EffectiveMonday: '2030-01-07',
  RuleVersion: 1,
  RuleJson: RosterGuidance.policyRuleJson('A'),
  Active: true,
  Revision: 1
};

const mockPolicyB = {
  PolicyId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  PolicyCode: 'B',
  EffectiveMonday: '2030-01-07',
  RuleVersion: 1,
  RuleJson: RosterGuidance.policyRuleJson('B'),
  Active: true,
  Revision: 1
};

test('lifecycle states and operations are properly defined and frozen', () => {
  const { LIFECYCLE_STATES, LIFECYCLE_OPERATIONS, LIFECYCLE_ERRORS } = RosterLifecycle;
  assert.equal(LIFECYCLE_STATES.DRAFT, 'DRAFT');
  assert.equal(LIFECYCLE_STATES.PUBLISHED, 'PUBLISHED');
  assert.equal(LIFECYCLE_STATES.AMENDED, 'AMENDED');
  assert.equal(LIFECYCLE_STATES.CLOSED, 'CLOSED');
  assert.throws(() => { LIFECYCLE_STATES.NEW_STATE = 'SOMETHING'; });

  assert.equal(LIFECYCLE_OPERATIONS.PUBLISH, 'ROSTER_PUBLISH');
  assert.equal(LIFECYCLE_OPERATIONS.CLOSE, 'ROSTER_CLOSE');
  assert.equal(LIFECYCLE_OPERATIONS.REOPEN, 'ROSTER_REOPEN');
  assert.ok(LIFECYCLE_ERRORS.INVALID_LIFECYCLE_TRANSITION);
  assert.ok(LIFECYCLE_ERRORS.AMENDED_RESERVED_PHASE5);
});

test('state machine transition guards allow only Phase 4 operational transitions', () => {
  const { canTransition } = RosterLifecycle;
  assert.equal(canTransition('DRAFT', 'PUBLISHED'), true);
  assert.equal(canTransition('PUBLISHED', 'CLOSED'), true);
  assert.equal(canTransition('CLOSED', 'PUBLISHED'), true);

  // Forbidden transitions
  assert.equal(canTransition('DRAFT', 'CLOSED'), false);
  assert.equal(canTransition('DRAFT', 'AMENDED'), false);
  assert.equal(canTransition('PUBLISHED', 'DRAFT'), false);
  assert.equal(canTransition('CLOSED', 'DRAFT'), false);
  assert.equal(canTransition('PUBLISHED', 'AMENDED'), false);
  assert.equal(canTransition('AMENDED', 'CLOSED'), false);
  assert.equal(canTransition('UNKNOWN', 'DRAFT'), false);
});

test('validateTransition rejects AMENDED state in Phase 4', () => {
  assert.throws(() => {
    RosterLifecycle.validateTransition('PUBLISHED', 'AMENDED', { actor: 'admin' });
  }, err => err.code === 'AMENDED_RESERVED_PHASE5');

  assert.throws(() => {
    RosterLifecycle.validateTransition('AMENDED', 'CLOSED', { actor: 'admin' });
  }, err => err.code === 'AMENDED_RESERVED_PHASE5');
});

test('validateTransition enforces actor requirement on all transitions', () => {
  assert.throws(() => {
    RosterLifecycle.validateTransition('DRAFT', 'PUBLISHED', { plannedSnapshotId: 'snap-1' });
  }, err => err.code === 'INVALID_OPERATOR');

  assert.throws(() => {
    RosterLifecycle.validateTransition('PUBLISHED', 'CLOSED', { actor: '' });
  }, err => err.code === 'INVALID_OPERATOR');
});

test('validateTransition rules for DRAFT -> PUBLISHED', () => {
  assert.throws(() => {
    RosterLifecycle.validateTransition('DRAFT', 'PUBLISHED', { actor: 'admin', plannedSnapshotId: '' });
  }, err => err.code === 'VALIDATION_FAILED');

  const res = RosterLifecycle.validateTransition('DRAFT', 'PUBLISHED', {
    actor: 'admin',
    plannedSnapshotId: 'snapshot:2030-07:uuid-1'
  });
  assert.equal(res.valid, true);
  assert.equal(res.nextState, 'PUBLISHED');
  assert.equal(res.nextRevision, 1);
});

test('validateTransition rules for PUBLISHED -> CLOSED enforce manual confirmation and reconciliation', () => {
  // Reject automatic close
  assert.throws(() => {
    RosterLifecycle.validateTransition('PUBLISHED', 'CLOSED', {
      actor: 'admin',
      isManual: false
    });
  }, err => err.code === 'INVALID_LIFECYCLE_TRANSITION');

  // Reject close if pending operations exist
  assert.throws(() => {
    RosterLifecycle.validateTransition('PUBLISHED', 'CLOSED', {
      actor: 'admin',
      isManual: true,
      reconciliation: { pendingOperationsCount: 2, ok: false }
    });
  }, err => err.code === 'RECONCILIATION_FAILED');

  // Reject close if reconciliation failed
  assert.throws(() => {
    RosterLifecycle.validateTransition('PUBLISHED', 'CLOSED', {
      actor: 'admin',
      isManual: true,
      reconciliation: { pendingOperationsCount: 0, ok: false, error: 'Projection mismatch' }
    });
  }, err => err.code === 'RECONCILIATION_FAILED');

  // Success on manual with clean reconciliation
  const res = RosterLifecycle.validateTransition('PUBLISHED', 'CLOSED', {
    actor: 'admin',
    isManual: true,
    currentRevision: 1,
    reconciliation: { pendingOperationsCount: 0, ok: true }
  });
  assert.equal(res.valid, true);
  assert.equal(res.nextState, 'CLOSED');
  assert.equal(res.nextRevision, 2);
});

test('validateTransition rules for CLOSED -> PUBLISHED (Reopen) require non-empty reason', () => {
  // Reject empty reason
  assert.throws(() => {
    RosterLifecycle.validateTransition('CLOSED', 'PUBLISHED', {
      actor: 'admin',
      reason: ''
    });
  }, err => err.code === 'REOPEN_REASON_REQUIRED');

  assert.throws(() => {
    RosterLifecycle.validateTransition('CLOSED', 'PUBLISHED', {
      actor: 'admin',
      reason: '   '
    });
  }, err => err.code === 'REOPEN_REASON_REQUIRED');

  // Success with valid reason
  const res = RosterLifecycle.validateTransition('CLOSED', 'PUBLISHED', {
    actor: 'admin',
    reason: 'Emergency shift reassignments required',
    currentRevision: 2
  });
  assert.equal(res.valid, true);
  assert.equal(res.nextState, 'PUBLISHED');
  assert.equal(res.nextRevision, 3);
  assert.equal(res.reason, 'Emergency shift reassignments required');
});

test('schema definitions match Major Update V2 specification and freeze immutability', () => {
  const schemas = RosterLifecycle.ROSTER_LIFECYCLE_SCHEMAS;

  // Cardinality checks
  assert.equal(schemas.RosterPeriods.length, 13, 'RosterPeriods must have exactly 13 headers');
  assert.equal(schemas.RosterAssignments.length, 15, 'RosterAssignments must have exactly 15 headers');
  assert.equal(schemas.RosterEvents.length, 22, 'RosterEvents must have exactly 22 headers');
  assert.equal(schemas.WeeklyOffSnapshots.length, 21, 'WeeklyOffSnapshots must have exactly 21 headers');

  assert.deepEqual(schemas.RosterPeriods, [
    'PeriodId', 'State', 'Revision', 'DraftRevision', 'PlannedSnapshotId',
    'PublishedAt', 'PublishedBy', 'ClosedAt', 'ClosedBy',
    'ProjectionChecksum', 'SchemaVersion', 'LastOperationId', 'UpdatedAt'
  ]);

  assert.deepEqual(schemas.RosterAssignments, [
    'AssignmentId', 'PeriodId', 'Layer', 'SnapshotId',
    'PersonId', 'PersonNameSnapshot', 'Date', 'DutyDomain',
    'ShiftCode', 'ModifiersJson', 'DraftRevision', 'Source',
    'OperationId', 'CreatedAt', 'CreatedBy'
  ]);

  assert.deepEqual(schemas.RosterEvents, [
    'EventId', 'LineId', 'EventType', 'OperationId', 'PeriodId',
    'BaseRevision', 'ResultRevision', 'PersonId', 'LinkedPersonIdsJson',
    'Date', 'DutyDomain', 'PlannedAssignmentJson', 'BeforeCurrentJson',
    'AfterCurrentJson', 'PublicReasonCode', 'AdminNote', 'ShortageAccepted',
    'ShortageReason', 'GoffTransactionIdsJson', 'ReversesEventId',
    'CreatedAt', 'CreatedBy'
  ]);

  assert.deepEqual(schemas.WeeklyOffSnapshots, [
    'WeekSnapshotId', 'WeekStart', 'WeekEnd', 'PolicyLockedByPeriodId',
    'PublishedPeriodIdsJson', 'PublishedDateMask', 'EvaluationState',
    'PlannedSnapshotIdsJson', 'PlannedWeekChecksum', 'PersonId',
    'PersonNameSnapshot', 'PolicyId', 'PolicyCode', 'RuleVersion',
    'HasQualifyingPlannedNight', 'RequiredOffCount', 'AssignedOffCountAtPublish',
    'Revision', 'OperationId', 'CreatedAt', 'CompletedAt'
  ]);

  assert.deepEqual(RosterCompatibility.lifecycleSchemas, schemas);
});

test('generatePlannedSnapshot generates deterministic, immutable planned assignments', () => {
  const draftCells = {
    [`${mockPerson1.PersonId}/2030-07-01`]: [{ assignmentId: '11111111-0000-4000-8000-000000000001', rawShift: 'AM' }],
    [`${mockPerson1.PersonId}/2030-07-02`]: [{ assignmentId: '11111111-0000-4000-8000-000000000002', rawShift: 'PM (S)' }],
    [`${mockPerson2.PersonId}/2030-07-01`]: [{ assignmentId: '22222222-0000-4000-8000-000000000001', rawShift: 'OFF' }]
  };

  const opId = 'aaaaaaaa-1111-4111-8111-111111111111';
  const snapshotUuid = '99999999-9999-4999-8999-999999999999';

  const res = RosterLifecycle.generatePlannedSnapshot({
    periodId: '2030-07',
    draftCells,
    people: mockPeople,
    operationId: opId,
    actor: 'admin@example.com',
    timestamp: '2030-06-30T10:00:00Z',
    snapshotUuid
  });

  assert.equal(res.plannedSnapshotId, 'snapshot:2030-07:99999999-9999-4999-8999-999999999999');
  assert.equal(res.assignments.length, 3);

  // Check first assignment
  const a0 = res.assignments[0];
  assert.equal(a0.PeriodId, '2030-07');
  assert.equal(a0.Layer, 'PLANNED');
  assert.equal(a0.SnapshotId, res.plannedSnapshotId);
  assert.equal(a0.PersonId, mockPerson1.PersonId);
  assert.equal(a0.PersonNameSnapshot, 'Dr. Ali');
  assert.equal(a0.Date, '2030-07-01');
  assert.equal(a0.ShiftCode, 'AM');
  assert.equal(a0.ModifiersJson, JSON.stringify({ extended: false, standby: false }));
  assert.equal(a0.OperationId, opId);
  assert.equal(a0.CreatedBy, 'admin@example.com');

  // Check standby modifier
  const a1 = res.assignments[2]; // sorted by Date (2030-07-02)
  assert.equal(a1.ShiftCode, 'PM');
  assert.equal(a1.ModifiersJson, JSON.stringify({ extended: false, standby: true }));
});

test('generatePlannedSnapshot strictly rejects dates outside the target monthly period', () => {
  const badDraftCells = {
    [`${mockPerson1.PersonId}/2030-06-30`]: [{ assignmentId: '11111111-0000-4000-8000-000000000001', rawShift: 'AM' }]
  };

  assert.throws(() => {
    RosterLifecycle.generatePlannedSnapshot({
      periodId: '2030-07',
      draftCells: badDraftCells,
      people: mockPeople,
      operationId: 'aaaaaaaa-1111-4111-8111-111111111111',
      actor: 'admin@example.com'
    });
  }, err => err.code === 'INVALID_PERIOD_ASSIGNMENT');
});

test('generatePlannedSnapshot strictly rejects unregistered person IDs', () => {
  const badDraftCells = {
    '99999999-0000-4000-8000-000000000099/2030-07-01': [{ assignmentId: '11111111-0000-4000-8000-000000000001', rawShift: 'AM' }]
  };

  assert.throws(() => {
    RosterLifecycle.generatePlannedSnapshot({
      periodId: '2030-07',
      draftCells: badDraftCells,
      people: mockPeople,
      operationId: 'aaaaaaaa-1111-4111-8111-111111111111',
      actor: 'admin@example.com'
    });
  }, err => err.code === 'VALIDATION_FAILED');
});

test('generateMasterRosterProjection and computeProjectionChecksum match legacy contract', () => {
  const assignments = [
    { PersonNameSnapshot: 'Dr. Ali', Date: '2030-07-01', ShiftCode: 'AM', ModifiersJson: '{"extended":false,"standby":false}' },
    { PersonNameSnapshot: 'Dr. Ali', Date: '2030-07-01', ShiftCode: 'PM', ModifiersJson: '{"extended":false,"standby":true}' },
    { PersonNameSnapshot: 'Dr. Siti', Date: '2030-07-01', ShiftCode: 'OFF', ModifiersJson: '{"extended":false,"standby":false}' }
  ];

  const projection = RosterLifecycle.generateMasterRosterProjection(assignments);
  assert.equal(projection.length, 3);
  assert.deepEqual(projection[0], { Name: 'Dr. Ali', Date: '2030-07-01', Shift: 'AM' });
  assert.deepEqual(projection[1], { Name: 'Dr. Ali', Date: '2030-07-01', Shift: 'PM(S)' });
  assert.deepEqual(projection[2], { Name: 'Dr. Siti', Date: '2030-07-01', Shift: 'OFF' });

  const checksum1 = RosterLifecycle.computeProjectionChecksum(projection, sha256);
  const checksum2 = RosterLifecycle.computeProjectionChecksum(projection, sha256);
  assert.equal(checksum1, checksum2);
  assert.match(checksum1, /^[0-9a-f]{64}$/);

  // Different shift produces different checksum
  const altered = [{ Name: 'Dr. Ali', Date: '2030-07-01', Shift: 'ON1' }];
  const checksumAltered = RosterLifecycle.computeProjectionChecksum(altered, sha256);
  assert.notEqual(checksum1, checksumAltered);
});

test('mergeMasterRosterProjection cleanly isolates target month and preserves other months byte-for-byte', () => {
  const existingMaster = [
    { Name: 'Dr. Ali', Date: '2030-06-30', Shift: 'AM' },
    { Name: 'Dr. Siti', Date: '2030-06-30', Shift: 'PM' },
    { Name: 'Dr. Old', Date: '2030-07-01', Shift: 'OLD_SHIFT' },
    { Name: 'Dr. Ali', Date: '2030-08-01', Shift: 'OFF' }
  ];

  const newProj = [
    { Name: 'Dr. Ali', Date: '2030-07-01', Shift: 'AM' },
    { Name: 'Dr. Siti', Date: '2030-07-01', Shift: 'PM' }
  ];

  const res = RosterLifecycle.mergeMasterRosterProjection(existingMaster, '2030-07', newProj);
  assert.equal(res.preservedCount, 3);
  assert.equal(res.replacedCount, 1);
  assert.equal(res.addedCount, 2);
  assert.equal(res.mergedRows.length, 5);

  // Ensure June and August rows are preserved exactly
  assert.deepEqual(res.mergedRows[0], { Name: 'Dr. Ali', Date: '2030-06-30', Shift: 'AM' });
  assert.deepEqual(res.mergedRows[1], { Name: 'Dr. Siti', Date: '2030-06-30', Shift: 'PM' });
  assert.deepEqual(res.mergedRows[2], { Name: 'Dr. Ali', Date: '2030-08-01', Shift: 'OFF' });
  assert.deepEqual(res.mergedRows[3], { Name: 'Dr. Ali', Date: '2030-07-01', Shift: 'AM' });
  assert.deepEqual(res.mergedRows[4], { Name: 'Dr. Siti', Date: '2030-07-01', Shift: 'PM' });
});

test('WeeklyOffSnapshots: internal non-boundary week evaluates to COMPLETE on first publication', () => {
  // Week 2030-07-08 to 2030-07-14 (entirely inside July 2030)
  const plannedAssignments = [
    { PersonId: mockPerson1.PersonId, Date: '2030-07-08', ShiftCode: 'AM', SnapshotId: 'snap-july' },
    { PersonId: mockPerson1.PersonId, Date: '2030-07-09', ShiftCode: 'AM', SnapshotId: 'snap-july' },
    { PersonId: mockPerson1.PersonId, Date: '2030-07-10', ShiftCode: 'AM', SnapshotId: 'snap-july' },
    { PersonId: mockPerson1.PersonId, Date: '2030-07-11', ShiftCode: 'AM', SnapshotId: 'snap-july' },
    { PersonId: mockPerson1.PersonId, Date: '2030-07-12', ShiftCode: 'AM', SnapshotId: 'snap-july' },
    { PersonId: mockPerson1.PersonId, Date: '2030-07-13', ShiftCode: 'OFF', SnapshotId: 'snap-july' },
    { PersonId: mockPerson1.PersonId, Date: '2030-07-14', ShiftCode: 'OFF', SnapshotId: 'snap-july' }
  ];

  const snapshots = RosterLifecycle.aggregateWeeklyOffSnapshots({
    periodId: '2030-07',
    plannedAssignments,
    people: [mockPerson1],
    existingWeekSnapshots: [],
    policies: [mockPolicyA],
    operationId: 'op-1',
    actor: 'admin',
    timestamp: '2030-06-30T10:00:00Z',
    digestFn: sha256
  });

  const weekSnap = snapshots.find(s => s.WeekStart === '2030-07-08');
  assert.ok(weekSnap);
  assert.equal(weekSnap.PolicyLockedByPeriodId, '2030-07');
  assert.equal(weekSnap.EvaluationState, 'COMPLETE');
  assert.equal(weekSnap.PolicyCode, 'A');
  assert.equal(weekSnap.RequiredOffCount, 1);
  assert.equal(weekSnap.AssignedOffCountAtPublish, 2);
  assert.equal(weekSnap.HasQualifyingPlannedNight, false);
  assert.ok(weekSnap.PlannedWeekChecksum);
  assert.equal(weekSnap.CompletedAt, '2030-06-30T10:00:00Z');
});

test('WeeklyOffSnapshots: boundary week across months transitions from PROVISIONAL to COMPLETE', () => {
  // Boundary week: 2026-06-29 (Monday) to 2026-07-05 (Sunday)
  // June owns 2026-06-29 and 2026-06-30 (2 days).
  // July owns 2026-07-01 to 2026-07-05 (5 days).

  // Step 1: June publishes first
  const juneAssignments = [
    { PersonId: mockPerson1.PersonId, Date: '2026-06-29', ShiftCode: 'AM', SnapshotId: 'snap-june' },
    { PersonId: mockPerson1.PersonId, Date: '2026-06-30', ShiftCode: 'ON1', SnapshotId: 'snap-june' }
  ];

  const policy2026B = {
    PolicyId: 'bbbbbbbb-2026-4bbb-8bbb-bbbbbbbbbbbb',
    PolicyCode: 'B',
    EffectiveMonday: '2026-01-05',
    RuleVersion: 1,
    RuleJson: RosterGuidance.policyRuleJson('B'),
    Active: true,
    Revision: 1
  };

  const juneSnapshots = RosterLifecycle.aggregateWeeklyOffSnapshots({
    periodId: '2026-06',
    plannedAssignments: juneAssignments,
    people: [mockPerson1],
    existingWeekSnapshots: [],
    policies: [policy2026B],
    operationId: 'op-june',
    actor: 'admin',
    timestamp: '2026-05-31T10:00:00Z',
    digestFn: sha256
  });

  const boundaryJune = juneSnapshots.find(s => s.WeekStart === '2026-06-29');
  assert.ok(boundaryJune);
  assert.equal(boundaryJune.PolicyLockedByPeriodId, '2026-06');
  assert.equal(boundaryJune.PolicyCode, 'B');
  assert.equal(boundaryJune.EvaluationState, 'PROVISIONAL');
  assert.equal(boundaryJune.RequiredOffCount, null);
  assert.equal(boundaryJune.AssignedOffCountAtPublish, null);
  assert.equal(boundaryJune.CompletedAt, '');
  assert.deepEqual(JSON.parse(boundaryJune.PublishedPeriodIdsJson), ['2026-06']);
  assert.deepEqual(JSON.parse(boundaryJune.PublishedDateMask), [true, true, false, false, false, false, false]);

  // Step 2: July publishes second with adjacent June assignments
  const julyAssignments = [
    { PersonId: mockPerson1.PersonId, Date: '2026-07-01', ShiftCode: 'ON2', SnapshotId: 'snap-july' },
    { PersonId: mockPerson1.PersonId, Date: '2026-07-02', ShiftCode: 'PN', SnapshotId: 'snap-july' },
    { PersonId: mockPerson1.PersonId, Date: '2026-07-03', ShiftCode: 'OFF', SnapshotId: 'snap-july' },
    { PersonId: mockPerson1.PersonId, Date: '2026-07-04', ShiftCode: 'AM', SnapshotId: 'snap-july' },
    { PersonId: mockPerson1.PersonId, Date: '2026-07-05', ShiftCode: 'PM', SnapshotId: 'snap-july' }
  ];

  const policy2026A = {
    PolicyId: 'aaaaaaaa-2026-4aaa-8aaa-aaaaaaaaaaaa',
    PolicyCode: 'A',
    EffectiveMonday: '2026-01-05',
    RuleVersion: 1,
    RuleJson: RosterGuidance.policyRuleJson('A'),
    Active: true,
    Revision: 1
  };

  const julySnapshots = RosterLifecycle.aggregateWeeklyOffSnapshots({
    periodId: '2026-07',
    plannedAssignments: julyAssignments,
    people: [mockPerson1],
    existingWeekSnapshots: [boundaryJune],
    adjacentPlannedAssignments: juneAssignments,
    policies: [policy2026A], // Policy A is active later, but Policy B was locked by June!
    operationId: 'op-july',
    actor: 'admin',
    timestamp: '2026-06-30T10:00:00Z',
    digestFn: sha256
  });

  const boundaryJuly = julySnapshots.find(s => s.WeekStart === '2026-06-29');
  assert.ok(boundaryJuly);
  // Must preserve locked policy from June!
  assert.equal(boundaryJuly.PolicyLockedByPeriodId, '2026-06');
  assert.equal(boundaryJuly.PolicyCode, 'B'); // Preserves Policy B!
  assert.equal(boundaryJuly.EvaluationState, 'COMPLETE'); // Now complete!
  assert.equal(boundaryJuly.HasQualifyingPlannedNight, true); // ON1 + ON2 qualifies under Policy B
  assert.equal(boundaryJuly.RequiredOffCount, 1); // Policy B with night requires 1 OFF
  assert.equal(boundaryJuly.AssignedOffCountAtPublish, 1); // July 3 is OFF
  assert.ok(boundaryJuly.PlannedWeekChecksum);
  assert.equal(boundaryJuly.CompletedAt, '2026-06-30T10:00:00Z');
  assert.deepEqual(JSON.parse(boundaryJuly.PublishedPeriodIdsJson), ['2026-06', '2026-07']);
  assert.deepEqual(JSON.parse(boundaryJuly.PublishedDateMask), [true, true, true, true, true, true, true]);
});

test('WeeklyOffSnapshots excludes EP identities from MO weekly entitlement', () => {
  const plannedAssignments = [
    { PersonId: mockEp.PersonId, Date: '2030-07-01', ShiftCode: 'EP_ONCALL', SnapshotId: 'snap-1' }
  ];

  const snapshots = RosterLifecycle.aggregateWeeklyOffSnapshots({
    periodId: '2030-07',
    plannedAssignments,
    people: [mockEp],
    existingWeekSnapshots: [],
    policies: [mockPolicyA],
    operationId: 'op-1',
    actor: 'admin'
  });

  assert.equal(snapshots.length, 0); // No weekly off snapshots generated for EPs
});

test('lifecycle record creators and event generators produce valid records', () => {
  const initial = RosterLifecycle.createInitialPeriodRecord({
    periodId: '2030-07',
    enrolledBy: 'superadmin'
  });
  assert.equal(initial.PeriodId, '2030-07');
  assert.equal(initial.State, 'DRAFT');
  assert.equal(initial.Revision, 0);

  const published = RosterLifecycle.publishPeriodRecord({
    periodRecord: initial,
    plannedSnapshotId: 'snapshot:2030-07:uuid',
    projectionChecksum: 'hash123',
    actor: 'admin',
    operationId: 'op-pub'
  });
  assert.equal(published.State, 'PUBLISHED');
  assert.equal(published.Revision, 1);
  assert.equal(published.PlannedSnapshotId, 'snapshot:2030-07:uuid');
  assert.equal(published.ProjectionChecksum, 'hash123');

  const closed = RosterLifecycle.closePeriodRecord({
    periodRecord: published,
    actor: 'admin',
    operationId: 'op-close',
    reconciliation: { pendingOperationsCount: 0, ok: true }
  });
  assert.equal(closed.State, 'CLOSED');
  assert.equal(closed.Revision, 2);

  const reopened = RosterLifecycle.reopenPeriodRecord({
    periodRecord: closed,
    reason: 'Need adjustments',
    actor: 'admin',
    operationId: 'op-reopen'
  });
  assert.equal(reopened.State, 'PUBLISHED');
  assert.equal(reopened.Revision, 3);
  assert.equal(reopened.ClosedAt, '');

  const evPublish = RosterLifecycle.createLifecycleEvent({
    eventType: 'PUBLISH',
    periodId: '2030-07',
    baseRevision: 0,
    resultRevision: 1,
    operationId: 'op-pub',
    actor: 'admin'
  });
  assert.equal(evPublish.EventType, 'PUBLISH');
  assert.equal(evPublish.BaseRevision, 0);
  assert.equal(evPublish.ResultRevision, 1);
  assert.equal(evPublish.PublicReasonCode, 'PUBLISH');

  const evReopen = RosterLifecycle.createLifecycleEvent({
    eventType: 'REOPEN',
    periodId: '2030-07',
    baseRevision: 2,
    resultRevision: 3,
    operationId: 'op-reopen',
    actor: 'admin',
    reason: 'Emergency shift reassignments required'
  });
  assert.equal(evReopen.EventType, 'REOPEN');
  assert.equal(evReopen.AdminNote, 'Emergency shift reassignments required');
});

test('generatePlannedSnapshot produces deterministic SnapshotId and AssignmentId on retry/recovery', () => {
  const opId = 'dddddddd-4444-4ddd-8ddd-dddddddddddd';
  const draftCells = {
    [`${mockPerson1.PersonId}/2030-07-05`]: [
      { rawShift: 'AM' },
      { rawShift: 'PM' }
    ],
    [`${mockPerson2.PersonId}/2030-07-06`]: [
      { rawShift: 'ON1' }
    ]
  };

  // Attempt 1: Initial publish attempt
  const run1 = RosterLifecycle.generatePlannedSnapshot({
    periodId: '2030-07',
    draftCells,
    people: mockPeople,
    operationId: opId,
    actor: 'admin@example.com',
    timestamp: '2030-06-30T10:00:00.000Z'
  });

  // Attempt 2: Journal replay / recovery reconstruction of the same operationId
  const run2 = RosterLifecycle.generatePlannedSnapshot({
    periodId: '2030-07',
    draftCells,
    people: mockPeople,
    operationId: opId,
    actor: 'admin@example.com',
    timestamp: '2030-06-30T10:00:00.000Z'
  });

  assert.equal(run1.plannedSnapshotId, `snapshot:2030-07:${opId}`);
  assert.equal(run2.plannedSnapshotId, run1.plannedSnapshotId);
  assert.equal(run1.assignments.length, 3);
  assert.equal(run2.assignments.length, 3);

  // Each AssignmentId must be identical across runs
  for (let i = 0; i < run1.assignments.length; i++) {
    assert.equal(run1.assignments[i].AssignmentId, run2.assignments[i].AssignmentId);
    assert.equal(run1.assignments[i].SnapshotId, run2.assignments[i].SnapshotId);
    assert.deepEqual(run1.assignments[i], run2.assignments[i]);
  }

  // Projection and checksum must match identically across retries
  const proj1 = RosterLifecycle.generateMasterRosterProjection(run1.assignments);
  const proj2 = RosterLifecycle.generateMasterRosterProjection(run2.assignments);
  assert.deepEqual(proj1, proj2);
  assert.equal(
    RosterLifecycle.computeProjectionChecksum(proj1, sha256),
    RosterLifecycle.computeProjectionChecksum(proj2, sha256)
  );
});

test('projection checksum is order-stable, canonical, and value-whitespace-significant', () => {
  // Same content, different insertion order in object
  const cellsA = {
    [`${mockPerson1.PersonId}/2030-07-02`]: [{ assignmentId: '11111111-0000-4000-8000-000000000002', rawShift: 'PM' }],
    [`${mockPerson1.PersonId}/2030-07-01`]: [{ assignmentId: '11111111-0000-4000-8000-000000000001', rawShift: 'AM' }]
  };
  const cellsB = {
    [`${mockPerson1.PersonId}/2030-07-01`]: [{ assignmentId: '11111111-0000-4000-8000-000000000001', rawShift: 'AM' }],
    [`${mockPerson1.PersonId}/2030-07-02`]: [{ assignmentId: '11111111-0000-4000-8000-000000000002', rawShift: 'PM' }]
  };

  const snapA = RosterLifecycle.generatePlannedSnapshot({
    periodId: '2030-07', draftCells: cellsA, people: mockPeople,
    operationId: '11111111-2222-4333-8444-555555555555', actor: 'admin'
  });
  const snapB = RosterLifecycle.generatePlannedSnapshot({
    periodId: '2030-07', draftCells: cellsB, people: mockPeople,
    operationId: '11111111-2222-4333-8444-555555555555', actor: 'admin'
  });

  const projA = RosterLifecycle.generateMasterRosterProjection(snapA.assignments);
  const projB = RosterLifecycle.generateMasterRosterProjection(snapB.assignments);
  assert.deepEqual(projA, projB);
  assert.equal(
    RosterLifecycle.computeProjectionChecksum(projA, sha256),
    RosterLifecycle.computeProjectionChecksum(projB, sha256)
  );

  // Value whitespace is significant: 'AM ' vs 'AM'
  const rowClean = [{ Name: 'Dr. Ali', Date: '2030-07-01', Shift: 'AM' }];
  const rowSpaced = [{ Name: 'Dr. Ali', Date: '2030-07-01', Shift: 'AM ' }];
  const rowMultiSpaceName = [{ Name: 'Dr.  Ali', Date: '2030-07-01', Shift: 'AM' }];

  const hashClean = RosterLifecycle.computeProjectionChecksum(rowClean, sha256);
  const hashSpaced = RosterLifecycle.computeProjectionChecksum(rowSpaced, sha256);
  const hashMultiSpace = RosterLifecycle.computeProjectionChecksum(rowMultiSpaceName, sha256);

  assert.notEqual(hashClean, hashSpaced);
  assert.notEqual(hashClean, hashMultiSpace);
});

test('mergeMasterRosterProjection strictly preserves non-target month rows, types, and relative ordering', () => {
  const d1 = new Date('2030-05-15T00:00:00.000Z');
  const d2 = '2030-06-01';
  const d3 = '2030-08-30';

  const messyHistoricalRows = [
    { Name: 'Dr. May', Date: d1, Shift: 'OH', _legacyTag: 'historical-1' },
    { Name: 'Amir', Date: d2, Shift: 'OFF', _legacyTag: 'historical-2' },
    { Name: 'Dr. Target', Date: '2030-07-10', Shift: 'OLD_SHIFT' },
    { Name: 'Dr. Target', Date: '2030-07-11', Shift: 'OLD_SHIFT_2' },
    { Name: 'Dr. Aug', Date: d3, Shift: 'PM', _legacyTag: 'historical-3' }
  ];

  const newProjectedRows = [
    { Name: 'Dr. Ali', Date: '2030-07-01', Shift: 'AM' }
  ];

  const result = RosterLifecycle.mergeMasterRosterProjection(messyHistoricalRows, '2030-07', newProjectedRows);

  assert.equal(result.replacedCount, 2);
  assert.equal(result.preservedCount, 3);
  assert.equal(result.addedCount, 1);
  assert.equal(result.mergedRows.length, 4);

  // Exact relative ordering and reference integrity preserved for untouched rows
  assert.equal(result.mergedRows[0], messyHistoricalRows[0]);
  assert.equal(result.mergedRows[1], messyHistoricalRows[1]);
  assert.equal(result.mergedRows[2], messyHistoricalRows[4]);
  assert.equal(result.mergedRows[3], newProjectedRows[0]);

  // Types and properties unchanged
  assert.equal(result.mergedRows[0].Date, d1);
  assert.equal(result.mergedRows[0]._legacyTag, 'historical-1');
  assert.equal(result.mergedRows[1]._legacyTag, 'historical-2');
  assert.equal(result.mergedRows[2]._legacyTag, 'historical-3');
});

test('permutation determinism: input row/cell/item order permutations yield identical planned snapshots, IDs, and projection checksums', () => {
  const fixedOpId = '77777777-7777-4777-8777-777777777777';
  const explicitOffId = '33333333-3333-4333-8333-333333333333';

  // Logical dataset with:
  // - single assignment
  // - multiple distinct assignments for same person/date ('AM', 'PM')
  // - multiple identical true duplicate assignments for same person/date ('AM', 'AM')
  // - multiple assignments with modifiers ('PM', 'PM (S)')
  // - existing explicit assignmentId to verify preservation
  // - multiple people across multiple dates

  // Format 1: Canonical Map / Object grouping
  const draftSet1 = {
    [`${mockPerson1.PersonId}/2030-07-01`]: [
      { rawShift: 'AM' },
      { rawShift: 'PM' }
    ],
    [`${mockPerson1.PersonId}/2030-07-02`]: [
      { rawShift: 'ED' }
    ],
    [`${mockPerson1.PersonId}/2030-07-03`]: [
      { rawShift: 'AM' },
      { rawShift: 'AM' } // true duplicate semantic assignments
    ],
    [`${mockPerson2.PersonId}/2030-07-01`]: [
      { rawShift: 'PM' },
      { rawShift: 'PM (S)' }
    ],
    [`${mockPerson2.PersonId}/2030-07-02`]: [
      { assignmentId: explicitOffId, rawShift: 'OFF' }
    ]
  };

  // Format 2: Reversed object keys AND reversed cell item arrays within cells
  const draftSet2 = {
    [`${mockPerson2.PersonId}/2030-07-02`]: [
      { assignmentId: explicitOffId, rawShift: 'OFF' }
    ],
    [`${mockPerson2.PersonId}/2030-07-01`]: [
      { rawShift: 'PM (S)' },
      { rawShift: 'PM' } // reversed order of items within cell
    ],
    [`${mockPerson1.PersonId}/2030-07-03`]: [
      { rawShift: 'AM' },
      { rawShift: 'AM' }
    ],
    [`${mockPerson1.PersonId}/2030-07-02`]: [
      { rawShift: 'ED' }
    ],
    [`${mockPerson1.PersonId}/2030-07-01`]: [
      { rawShift: 'PM' },
      { rawShift: 'AM' } // reversed order of items within cell
    ]
  };

  // Format 3: Shuffled array of individual draft rows
  const draftSet3 = [
    { PersonId: mockPerson2.PersonId, Date: '2030-07-01', ShiftCode: 'PM (S)' },
    { PersonId: mockPerson1.PersonId, Date: '2030-07-03', ShiftCode: 'AM' },
    { PersonId: mockPerson1.PersonId, Date: '2030-07-01', ShiftCode: 'PM' },
    { PersonId: mockPerson2.PersonId, Date: '2030-07-02', AssignmentId: explicitOffId, ShiftCode: 'OFF' },
    { PersonId: mockPerson1.PersonId, Date: '2030-07-02', ShiftCode: 'ED' },
    { PersonId: mockPerson1.PersonId, Date: '2030-07-03', ShiftCode: 'AM' }, // duplicate AM
    { PersonId: mockPerson2.PersonId, Date: '2030-07-01', ShiftCode: 'PM' },
    { PersonId: mockPerson1.PersonId, Date: '2030-07-01', ShiftCode: 'AM' }
  ];

  // Format 4: Reverse of Format 3 array
  const draftSet4 = [...draftSet3].reverse();

  const snap1 = RosterLifecycle.generatePlannedSnapshot({
    periodId: '2030-07',
    draftCells: draftSet1,
    people: mockPeople,
    operationId: fixedOpId,
    actor: 'admin@example.com',
    timestamp: '2030-06-30T12:00:00.000Z'
  });

  const snap2 = RosterLifecycle.generatePlannedSnapshot({
    periodId: '2030-07',
    draftCells: draftSet2,
    people: mockPeople,
    operationId: fixedOpId,
    actor: 'admin@example.com',
    timestamp: '2030-06-30T12:00:00.000Z'
  });

  const snap3 = RosterLifecycle.generatePlannedSnapshot({
    periodId: '2030-07',
    draftCells: draftSet3,
    people: mockPeople,
    operationId: fixedOpId,
    actor: 'admin@example.com',
    timestamp: '2030-06-30T12:00:00.000Z'
  });

  const snap4 = RosterLifecycle.generatePlannedSnapshot({
    periodId: '2030-07',
    draftCells: draftSet4,
    people: mockPeople,
    operationId: fixedOpId,
    actor: 'admin@example.com',
    timestamp: '2030-06-30T12:00:00.000Z'
  });

  // 1. SnapshotId must be identical across all permutations
  assert.equal(snap1.plannedSnapshotId, `snapshot:2030-07:${fixedOpId}`);
  assert.equal(snap2.plannedSnapshotId, snap1.plannedSnapshotId);
  assert.equal(snap3.plannedSnapshotId, snap1.plannedSnapshotId);
  assert.equal(snap4.plannedSnapshotId, snap1.plannedSnapshotId);

  // 2. Total assignments count matches exactly
  assert.equal(snap1.assignments.length, 8);
  assert.equal(snap2.assignments.length, 8);
  assert.equal(snap3.assignments.length, 8);
  assert.equal(snap4.assignments.length, 8);

  // 3. Exact AssignmentIds match across all runs
  const ids1 = snap1.assignments.map(a => a.AssignmentId);
  const ids2 = snap2.assignments.map(a => a.AssignmentId);
  const ids3 = snap3.assignments.map(a => a.AssignmentId);
  const ids4 = snap4.assignments.map(a => a.AssignmentId);
  assert.deepEqual(ids1, ids2);
  assert.deepEqual(ids1, ids3);
  assert.deepEqual(ids1, ids4);

  // 4. Entire canonical planned rows match deeply across all permutations
  assert.deepEqual(snap1.assignments, snap2.assignments);
  assert.deepEqual(snap1.assignments, snap3.assignments);
  assert.deepEqual(snap1.assignments, snap4.assignments);

  // 5. Explicit assignment ID is preserved unchanged
  const preservedRow = snap1.assignments.find(a => a.Date === '2030-07-02' && a.PersonId === mockPerson2.PersonId);
  assert.ok(preservedRow);
  assert.equal(preservedRow.AssignmentId, explicitOffId);

  // 6. True duplicate assignments receive stable, distinct deterministic IDs
  const dupes = snap1.assignments.filter(a => a.Date === '2030-07-03' && a.PersonId === mockPerson1.PersonId);
  assert.equal(dupes.length, 2);
  assert.notEqual(dupes[0].AssignmentId, dupes[1].AssignmentId);

  // 7. Projected MasterRoster rows match across all permutations
  const proj1 = RosterLifecycle.generateMasterRosterProjection(snap1.assignments);
  const proj2 = RosterLifecycle.generateMasterRosterProjection(snap2.assignments);
  const proj3 = RosterLifecycle.generateMasterRosterProjection(snap3.assignments);
  const proj4 = RosterLifecycle.generateMasterRosterProjection(snap4.assignments);
  assert.deepEqual(proj1, proj2);
  assert.deepEqual(proj1, proj3);
  assert.deepEqual(proj1, proj4);

  // 8. Projection checksums match identically
  const chk1 = RosterLifecycle.computeProjectionChecksum(proj1, sha256);
  const chk2 = RosterLifecycle.computeProjectionChecksum(proj2, sha256);
  const chk3 = RosterLifecycle.computeProjectionChecksum(proj3, sha256);
  const chk4 = RosterLifecycle.computeProjectionChecksum(proj4, sha256);
  assert.equal(chk1, chk2);
  assert.equal(chk1, chk3);
  assert.equal(chk1, chk4);
});

