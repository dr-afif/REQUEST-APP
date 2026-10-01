import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DraftQueue, sha256 } from '../../src/features/roster/queue/draftQueue.js';
import { createDraftRepository } from '../../src/features/roster/data/draftRepository.js';
import protocol from '../../src/features/roster/queue/protocol.js';
import { emptyEntity, validateEntity } from '../../src/features/roster/queue/state.js';
import RosterCompatibility from '../../src/features/roster/compatibility.js';

// --- Test Harness Helpers ---

function createMockLocks() {
  const held = new Set();
  return {
    async request(name, options, callback) {
      if (typeof options === 'function') {
        callback = options;
        options = {};
      }
      if (options?.ifAvailable && held.has(name)) {
        return callback(null);
      }
      while (held.has(name)) {
        await new Promise(r => setTimeout(r, 5));
      }
      held.add(name);
      try {
        return await callback({ name });
      } finally {
        held.delete(name);
      }
    }
  };
}

function createMockStore(initialEntities = {}) {
  const entities = new Map();
  for (const [k, v] of Object.entries(initialEntities)) {
    entities.set(k, structuredClone(v));
  }
  const clientUuid = crypto.randomUUID();
  return {
    name: 'test-store',
    async all() {
      return [...entities.values()].map(e => structuredClone(e));
    },
    async read(key) {
      const e = entities.get(key);
      return e ? structuredClone(e) : null;
    },
    async update(key, fn) {
      const current = entities.get(key) ? structuredClone(entities.get(key)) : null;
      const next = fn(current);
      entities.set(key, structuredClone(next));
      return structuredClone(next);
    },
    async clientId() {
      return clientUuid;
    },
    close() {}
  };
}

function createMockRepository() {
  const calls = [];
  const state = {
    lifecycleSchemaResponse: { ok: true, schemaVersion: 2, schemas: {}, lifecycleWritesEnabled: true },
    periodLifecycleResponses: new Map(),
    publishResponse: null,
    closeResponse: null,
    reopenResponse: null,
    recoverResponse: null,
    statusResponse: null,
    writeResponse: null,
    readResponse: null
  };

  return {
    calls,
    state,
    async lifecycleSchema() {
      calls.push({ method: 'lifecycleSchema' });
      return structuredClone(state.lifecycleSchemaResponse);
    },
    async getPeriodLifecycle(periodId) {
      calls.push({ method: 'getPeriodLifecycle', periodId });
      return structuredClone(state.periodLifecycleResponses.get(periodId) || { ok: true, periodId, period: null, events: [] });
    },
    async publish(op) {
      calls.push({ method: 'publish', op: structuredClone(op) });
      if (state.publishResponse instanceof Error) throw state.publishResponse;
      return structuredClone(state.publishResponse || {
        ok: true,
        operationId: op.operationId,
        periodId: op.payload?.periodId || op.periodId,
        state: 'PUBLISHED',
        revision: (op.expectedRevision || 0) + 1,
        plannedSnapshotId: 'snap-1',
        assignmentCount: 2,
        projectionChecksum: 'checksum-1'
      });
    },
    async close(op) {
      calls.push({ method: 'close', op: structuredClone(op) });
      if (state.closeResponse instanceof Error) throw state.closeResponse;
      return structuredClone(state.closeResponse || {
        ok: true,
        operationId: op.operationId,
        periodId: op.payload?.periodId || op.periodId,
        state: 'CLOSED',
        revision: (op.expectedRevision || 0) + 1,
        closedAt: new Date().toISOString(),
        closedBy: 'admin@example.invalid'
      });
    },
    async reopen(op) {
      calls.push({ method: 'reopen', op: structuredClone(op) });
      if (state.reopenResponse instanceof Error) throw state.reopenResponse;
      return structuredClone(state.reopenResponse || {
        ok: true,
        operationId: op.operationId,
        periodId: op.payload?.periodId || op.periodId,
        state: 'PUBLISHED',
        revision: (op.expectedRevision || 0) + 1,
        reopenedAt: new Date().toISOString(),
        reopenedBy: 'admin@example.invalid',
        reason: op.payload?.reason || op.reason
      });
    },
    async recoverLifecycle(operationId) {
      calls.push({ method: 'recoverLifecycle', operationId });
      if (state.recoverResponse instanceof Error) throw state.recoverResponse;
      return structuredClone(state.recoverResponse || {
        ok: true,
        operationId,
        status: 'CONFIRMED',
        result: {
          ok: true,
          operationId,
          periodId: '2030-07',
          state: 'PUBLISHED',
          revision: 1
        }
      });
    },
    async status(operationId) {
      calls.push({ method: 'status', operationId });
      if (state.statusResponse instanceof Error) throw state.statusResponse;
      return structuredClone(state.statusResponse || {
        ok: true,
        operationId,
        status: 'CONFIRMED',
        result: {
          ok: true,
          operationId,
          periodId: '2030-07',
          state: 'PUBLISHED',
          revision: 1
        }
      });
    },
    async write(op) {
      calls.push({ method: 'write', op: structuredClone(op) });
      if (state.writeResponse instanceof Error) throw state.writeResponse;
      const patches = op.payload?.patches || [];
      const cells = protocol.apply(state.readResponse?.cells || {}, patches);
      const checksum = await sha256(protocol.canonical(cells));
      state.readResponse = { ok: true, entityKey: op.entityKey, revision: (op.expectedRevision || 0) + 1, checksum, cells };
      return structuredClone(state.writeResponse || {
        ok: true,
        status: 'CONFIRMED',
        operationId: op.operationId,
        payloadHash: op.payloadHash,
        result: {
          ok: true,
          operationId: op.operationId,
          entityKey: op.entityKey,
          revision: (op.expectedRevision || 0) + 1,
          checksum: checksum,
          patches: patches
        }
      });
    },
    async read(entityKey) {
      calls.push({ method: 'read', entityKey });
      if (state.readResponse instanceof Error) throw state.readResponse;
      const cells = state.readResponse?.cells || {};
      const checksum = await sha256(protocol.canonical(cells));
      return structuredClone(state.readResponse || {
        ok: true,
        entityKey,
        revision: state.readResponse?.revision || 0,
        checksum,
        cells
      });
    }
  };
}

const standardSettings = {
  roster_v2_write_enabled: true,
  write_queue_v2_enabled: true
};

const personA = '11111111-1111-4111-8111-111111111111';
const personB = '22222222-2222-4222-8222-222222222222';

// --- Tests ---

describe('Phase 4 Slice 3: Client Data Layer & Queue Integration', () => {

  describe('1. Lifecycle repository API & transport mapping', () => {
    it('maps all lifecycle methods to the correct action and HTTP method', async () => {
      const requests = [];
      const fetcher = async (url, options) => {
        const parsedUrl = new URL(url);
        const action = options.method === 'POST' ? JSON.parse(options.body).action : parsedUrl.searchParams.get('action');
        requests.push({ url: url.toString(), method: options.method, action, body: options.body ? JSON.parse(options.body) : null });
        return {
          ok: true,
          json: async () => ({ ok: true, status: 'CONFIRMED', action })
        };
      };

      const repo = createDraftRepository({
        baseUrl: 'https://script.google.com/macros/s/test/exec',
        fetcher
      });

      // getPeriodLifecycle
      await repo.getPeriodLifecycle('2030-07');
      assert.equal(requests[0].action, 'rosterv2periodlifecycle');
      assert.equal(requests[0].method, 'GET');
      assert.match(requests[0].url, /periodId=2030-07/);

      // lifecycleSchema
      await repo.lifecycleSchema();
      assert.equal(requests[1].action, 'rosterv2lifecycleschema');
      assert.equal(requests[1].method, 'GET');

      // publish
      const publishOp = {
        operationId: crypto.randomUUID(),
        clientId: crypto.randomUUID(),
        tabId: crypto.randomUUID(),
        operationType: 'PERIOD_PUBLISH',
        entityKey: 'draft:2030-07',
        expectedRevision: 0,
        payload: { periodId: '2030-07', draftCells: {}, adminNote: 'note' },
        payloadHash: 'hash1'
      };
      await repo.publish(publishOp);
      assert.equal(requests[2].action, 'rosterv2publish');
      assert.equal(requests[2].method, 'POST');
      assert.equal(requests[2].body.operationId, publishOp.operationId);
      assert.equal(requests[2].body.periodId, '2030-07');
      assert.equal(requests[2].body.entityKey, 'period:2030-07');
      assert.equal(requests[2].body.adminNote, 'note');

      // close
      const closeOp = {
        operationId: crypto.randomUUID(),
        clientId: crypto.randomUUID(),
        tabId: crypto.randomUUID(),
        operationType: 'PERIOD_CLOSE',
        entityKey: 'draft:2030-07',
        expectedRevision: 1,
        payload: { periodId: '2030-07', adminNote: 'close note' },
        payloadHash: 'hash2'
      };
      await repo.close(closeOp);
      assert.equal(requests[3].action, 'rosterv2close');
      assert.equal(requests[3].method, 'POST');
      assert.equal(requests[3].body.operationId, closeOp.operationId);
      assert.equal(requests[3].body.periodId, '2030-07');
      assert.equal(requests[3].body.adminNote, 'close note');

      // reopen
      const reopenOp = {
        operationId: crypto.randomUUID(),
        clientId: crypto.randomUUID(),
        tabId: crypto.randomUUID(),
        operationType: 'PERIOD_REOPEN',
        entityKey: 'draft:2030-07',
        expectedRevision: 2,
        payload: { periodId: '2030-07', reason: 'reopen reason' },
        payloadHash: 'hash3'
      };
      await repo.reopen(reopenOp);
      assert.equal(requests[4].action, 'rosterv2reopen');
      assert.equal(requests[4].method, 'POST');
      assert.equal(requests[4].body.operationId, reopenOp.operationId);
      assert.equal(requests[4].body.periodId, '2030-07');
      assert.equal(requests[4].body.reason, 'reopen reason');

      // recoverLifecycle
      const recoverOpId = crypto.randomUUID();
      await repo.recoverLifecycle(recoverOpId);
      assert.equal(requests[5].action, 'rosterv2lifecyclerecover');
      assert.equal(requests[5].method, 'POST');
      assert.equal(requests[5].body.operationId, recoverOpId);
    });
  });

  describe('2. Stable operation identity & persistence', () => {
    it('preserves the same operationId across timeout, retry, reload, and recovery', async () => {
      const store = createMockStore();
      const repo = createMockRepository();
      const locks = createMockLocks();
      const periodId = '2030-07';
      const key = `draft:${periodId}`;

      // Simulate network error on first publish attempt
      repo.state.publishResponse = new Error('Network timeout');

      const q1 = new DraftQueue({
        store,
        repository: repo,
        settings: standardSettings,
        locks
      });
      await q1.start();

      const stableOpId = crypto.randomUUID();
      let publishPromise = q1.publish(periodId, { operationId: stableOpId, adminNote: 'Initial attempt' });

      // Should complete attempt and transition to scheduled/recovering state due to network failure
      const result = await publishPromise;
      assert.equal(result.operationId, stableOpId);
      assert.equal(result.pending, true);

      // Verify operation in outbox
      const storedAfterTimeout = await store.read(key);
      const op = storedAfterTimeout.operations.find(o => o.operationId === stableOpId);
      assert.ok(op);
      assert.equal(op.operationId, stableOpId);
      assert.equal(op.everSent, true);
      assert.equal(op.operationType, 'PERIOD_PUBLISH');

      // Now simulate a full page reload by instantiating a new DraftQueue on the same store
      q1.stop();
      const q2 = new DraftQueue({
        store,
        repository: repo,
        settings: standardSettings,
        locks
      });
      await q2.start();

      const viewAfterReload = q2.view(key);
      const reloadedOp = viewAfterReload.operations.find(o => o.operationId === stableOpId);
      assert.ok(reloadedOp, 'Operation survived page reload');
      assert.equal(reloadedOp.operationId, stableOpId);
      assert.equal(reloadedOp.payload.adminNote, 'Initial attempt');

      // Now backend is back online and confirms the operation
      repo.state.publishResponse = null;
      repo.state.statusResponse = {
        ok: true,
        operationId: stableOpId,
        status: 'CONFIRMED',
        result: {
          ok: true,
          operationId: stableOpId,
          periodId,
          state: 'PUBLISHED',
          revision: 1
        }
      };

      // Call retry / publish again - must reuse stableOpId and finalize
      const finalResult = await q2.publish(periodId, { operationId: crypto.randomUUID() }); // passes different opId, must reuse existing pending!
      assert.equal(finalResult.state, 'PUBLISHED');
      assert.equal(finalResult.revision, 1);

      // Verify in store
      const confirmedStore = await store.read(key);
      const confirmedOp = confirmedStore.operations.find(o => o.operationId === stableOpId);
      assert.equal(confirmedOp.status, 'CONFIRMED');
      assert.equal(confirmedStore.lifecycle.state, 'PUBLISHED');
      assert.equal(confirmedStore.lifecycle.revision, 1);
      q2.stop();
    });
  });

  describe('3. Queue integration & publish ordering', () => {
    it('flushes pending/debounced draft changes and waits for preceding draft operations before publishing', async () => {
      const store = createMockStore();
      const repo = createMockRepository();
      const locks = createMockLocks();
      const periodId = '2030-07';
      const key = `draft:${periodId}`;

      const q = new DraftQueue({
        store,
        repository: repo,
        settings: standardSettings,
        locks,
        debounceMs: 50
      });
      await q.start();

      // Enqueue a draft mutation
      const patch = {
        personId: personA,
        date: `${periodId}-01`,
        assignments: [{ assignmentId: crypto.randomUUID(), rawShift: 'AM' }]
      };
      await q.enqueue(key, [patch]);

      // Publish immediately without waiting for debounce timer
      const publishPromise = q.publish(periodId, { adminNote: 'Ordered publish' });

      // Before confirmation, draft patch must have been sent first
      const lifecycle = await publishPromise;
      assert.equal(lifecycle.state, 'PUBLISHED');

      // Verify call sequence: write (draft patch) came BEFORE publish
      const writeCallIdx = repo.calls.findIndex(c => c.method === 'write');
      const publishCallIdx = repo.calls.findIndex(c => c.method === 'publish');
      assert.ok(writeCallIdx >= 0, 'Draft write was executed');
      assert.ok(publishCallIdx > writeCallIdx, 'Publish was executed after draft write confirmed');

      q.stop();
    });

    it('rejects publish if preceding draft operations have unrecoverable conflict', async () => {
      const store = createMockStore();
      const repo = createMockRepository();
      const locks = createMockLocks();
      const periodId = '2030-07';
      const key = `draft:${periodId}`;

      const q = new DraftQueue({
        store,
        repository: repo,
        settings: standardSettings,
        locks
      });
      await q.start();

      // Set entity with a conflicting draft operation
      await q.change(key, e => {
        e.operations.push({
          operationId: crypto.randomUUID(),
          clientId: q.clientId,
          tabId: q.tabId,
          operationType: 'DRAFT_PATCH',
          operationClass: 'DRAFT',
          entityKey: key,
          expectedRevision: 0,
          payload: {
            patches: [{
              personId: personA,
              date: `${periodId}-01`,
              assignments: [{ assignmentId: crypto.randomUUID(), rawShift: 'PM' }]
            }]
          },
          schemaVersion: 1,
          payloadHash: null,
          localSequence: ++e.sequence,
          status: 'CONFLICT',
          everSent: false,
          attemptCount: 0,
          nextRetryAt: 0,
          lastError: 'REVISION_CONFLICT',
          createdAt: q.now(),
          updatedAt: q.now(),
          lastConfirmed: {}
        });
        return e;
      });

      // Attempting publish must reject
      await assert.rejects(
        () => q.publish(periodId),
        err => err.code === 'REVISION_CONFLICT'
      );

      q.stop();
    });
  });

  describe('4. Draft write guards after lifecycle transitions', () => {
    it('rejects draft edits when period is in PUBLISHED state with SNAPSHOT_IMMUTABLE', async () => {
      const store = createMockStore();
      const repo = createMockRepository();
      const locks = createMockLocks();
      const periodId = '2030-07';
      const key = `draft:${periodId}`;

      const q = new DraftQueue({
        store,
        repository: repo,
        settings: standardSettings,
        locks
      });
      await q.start();

      // Transition period to PUBLISHED
      await q.publish(periodId);
      assert.equal(q.view(key).lifecycle.state, 'PUBLISHED');

      // Attempt draft edit
      await assert.rejects(
        () => q.enqueue(key, [{
          personId: personA,
          date: `${periodId}-01`,
          assignments: [{ assignmentId: crypto.randomUUID(), rawShift: 'NIGHT' }]
        }]),
        err => err.code === 'SNAPSHOT_IMMUTABLE'
      );

      q.stop();
    });

    it('rejects draft edits when period is in CLOSED state with INVALID_STATE', async () => {
      const store = createMockStore();
      const repo = createMockRepository();
      const locks = createMockLocks();
      const periodId = '2030-07';
      const key = `draft:${periodId}`;

      const q = new DraftQueue({
        store,
        repository: repo,
        settings: standardSettings,
        locks
      });
      await q.start();

      await q.publish(periodId);
      await q.close(periodId);
      assert.equal(q.view(key).lifecycle.state, 'CLOSED');

      // Attempt draft edit
      await assert.rejects(
        () => q.enqueue(key, [{
          personId: personA,
          date: `${periodId}-01`,
          assignments: [{ assignmentId: crypto.randomUUID(), rawShift: 'NIGHT' }]
        }]),
        err => err.code === 'INVALID_STATE'
      );

      q.stop();
    });

    it('rejects draft edits when period is in forward-compatibility AMENDED state with AMENDED_RESERVED_PHASE5', async () => {
      const store = createMockStore();
      const repo = createMockRepository();
      const locks = createMockLocks();
      const periodId = '2030-07';
      const key = `draft:${periodId}`;

      const q = new DraftQueue({
        store,
        repository: repo,
        settings: standardSettings,
        locks
      });
      await q.start();

      await q.change(key, e => {
        e.lifecycle = { state: 'AMENDED', revision: 2 };
        return e;
      });

      // Attempt draft edit
      await assert.rejects(
        () => q.enqueue(key, [{
          personId: personA,
          date: `${periodId}-01`,
          assignments: [{ assignmentId: crypto.randomUUID(), rawShift: 'NIGHT' }]
        }]),
        err => err.code === 'AMENDED_RESERVED_PHASE5'
      );

      q.stop();
    });

    it('rejects draft edits while a lifecycle operation is in flight with LIFECYCLE_OPERATION_PENDING', async () => {
      const store = createMockStore();
      const repo = createMockRepository();
      const locks = createMockLocks();
      const periodId = '2030-07';
      const key = `draft:${periodId}`;

      const q = new DraftQueue({
        store,
        repository: repo,
        settings: standardSettings,
        locks
      });
      await q.start();

      // Put a lifecycle operation into pending state
      await q.change(key, e => {
        e.operations.push({
          operationId: crypto.randomUUID(),
          clientId: q.clientId,
          tabId: q.tabId,
          operationType: 'PERIOD_PUBLISH',
          operationClass: 'LIFECYCLE',
          entityKey: key,
          expectedRevision: 0,
          payload: { periodId, draftCells: {}, adminNote: '' },
          schemaVersion: 1,
          payloadHash: null,
          localSequence: ++e.sequence,
          status: 'SENDING',
          everSent: true,
          attemptCount: 1,
          nextRetryAt: 0,
          lastError: null,
          createdAt: q.now(),
          updatedAt: q.now(),
          lastConfirmed: {}
        });
        return e;
      });

      // Attempt draft edit while publish is in flight
      await assert.rejects(
        () => q.enqueue(key, [{
          personId: personA,
          date: `${periodId}-01`,
          assignments: [{ assignmentId: crypto.randomUUID(), rawShift: 'NIGHT' }]
        }]),
        err => err.code === 'LIFECYCLE_OPERATION_PENDING'
      );

      q.stop();
    });
  });

  describe('5. CHECKSUM_MISMATCH / RECOVERY_REQUIRED deterministic repair', () => {
    it('repairs CHECKSUM_MISMATCH publish by retrying the SAME operationId and payload', async () => {
      const store = createMockStore();
      const repo = createMockRepository();
      const locks = createMockLocks();
      const periodId = '2030-07';
      const key = `draft:${periodId}`;

      // First publish returns CHECKSUM_MISMATCH
      repo.state.publishResponse = {
        ok: false,
        error: { code: 'CHECKSUM_MISMATCH', details: { actual: 'bad', expected: 'good' } }
      };

      const q = new DraftQueue({
        store,
        repository: repo,
        settings: standardSettings,
        locks
      });
      await q.start();

      const stableOpId = crypto.randomUUID();
      await assert.rejects(
        () => q.publish(periodId, { operationId: stableOpId }),
        err => err.code === 'RECOVERY_REQUIRED' && err.details?.errorCode === 'CHECKSUM_MISMATCH'
      );

      // Verify operation is in RECOVERY_REQUIRED status
      const entityAfterMismatch = await store.read(key);
      const op = entityAfterMismatch.operations.find(o => o.operationId === stableOpId);
      assert.equal(op.status, 'RECOVERY_REQUIRED');
      assert.equal(op.lastError, 'CHECKSUM_MISMATCH');

      // Now backend repair logic is ready. RecoverLifecycle confirms period is not yet published in domain table
      repo.state.recoverResponse = {
        ok: true,
        operationId: stableOpId,
        status: 'RECOVERY_REQUIRED',
        errorCode: 'CHECKSUM_MISMATCH'
      };

      // On retry, backend publish succeeds and repairs MasterRoster projection
      repo.state.publishResponse = {
        ok: true,
        operationId: stableOpId,
        periodId,
        state: 'PUBLISHED',
        revision: 1,
        projectionChecksum: 'repaired-checksum'
      };

      // Call retry(key, stableOpId)
      await q.retry(key, stableOpId);

      // Verify confirmed state
      const entityAfterRetry = await store.read(key);
      const repairedOp = entityAfterRetry.operations.find(o => o.operationId === stableOpId);
      assert.equal(repairedOp.status, 'CONFIRMED');
      assert.equal(entityAfterRetry.lifecycle.state, 'PUBLISHED');
      assert.equal(entityAfterRetry.lifecycle.revision, 1);

      // Verify that publish was called twice with the EXACT SAME operationId
      const publishCalls = repo.calls.filter(c => c.method === 'publish');
      assert.equal(publishCalls.length, 2);
      assert.equal(publishCalls[0].op.operationId, stableOpId);
      assert.equal(publishCalls[1].op.operationId, stableOpId);

      q.stop();
    });
  });

  describe('6. Close & Reopen client behavior', () => {
    it('executes Close flow and handles RECONCILIATION_FAILED without infinite retry loop', async () => {
      const store = createMockStore();
      const repo = createMockRepository();
      const locks = createMockLocks();
      const periodId = '2030-07';
      const key = `draft:${periodId}`;

      const q = new DraftQueue({
        store,
        repository: repo,
        settings: standardSettings,
        locks
      });
      await q.start();

      // First publish period so it is in PUBLISHED state
      await q.publish(periodId);
      assert.equal(q.view(key).lifecycle.state, 'PUBLISHED');

      // Next, test RECONCILIATION_FAILED on close
      repo.state.closeResponse = {
        ok: false,
        error: { code: 'RECONCILIATION_FAILED', message: 'Target month projection does not match planned assignments' }
      };

      await assert.rejects(
        () => q.close(periodId, { adminNote: 'Close attempt' }),
        err => err.code === 'RECONCILIATION_FAILED'
      );

      const failedEntity = await store.read(key);
      const closeOp = failedEntity.operations.find(o => o.operationType === 'PERIOD_CLOSE');
      assert.equal(closeOp.status, 'FAILED');
      assert.equal(closeOp.lastError, 'RECONCILIATION_FAILED');

      // Attempting to retry a RECONCILIATION_FAILED operation directly must throw and not retry endlessly
      await assert.rejects(
        () => q.retry(key, closeOp.operationId),
        err => err.code === 'RECONCILIATION_FAILED'
      );

      // Now allow successful close
      repo.state.closeResponse = null;

      // Reset operations for next clean close test
      await q.change(key, e => {
        e.operations = e.operations.filter(o => o.operationId !== closeOp.operationId);
        e.sequence = e.operations.length ? e.operations[e.operations.length - 1].localSequence : 0;
        return e;
      });

      const closeResult = await q.close(periodId, { adminNote: 'Successful close' });
      assert.equal(closeResult.state, 'CLOSED');
      assert.equal(closeResult.revision, 2);
      assert.equal(q.view(key).lifecycle.state, 'CLOSED');

      q.stop();
    });

    it('requires a non-empty trimmed reason for Reopen and persists it across reload', async () => {
      const store = createMockStore();
      const repo = createMockRepository();
      const locks = createMockLocks();
      const periodId = '2030-07';
      const key = `draft:${periodId}`;

      const q = new DraftQueue({
        store,
        repository: repo,
        settings: standardSettings,
        locks
      });
      await q.start();

      await q.publish(periodId);
      await q.close(periodId);
      assert.equal(q.view(key).lifecycle.state, 'CLOSED');

      // Empty reason rejection
      await assert.rejects(
        () => q.reopen(periodId, ''),
        err => err.code === 'REOPEN_REASON_REQUIRED'
      );

      // Whitespace-only reason rejection
      await assert.rejects(
        () => q.reopen(periodId, '    \t   '),
        err => err.code === 'REOPEN_REASON_REQUIRED'
      );

      // Valid reopen
      const reason = 'Emergency physician schedule adjustment approved by medical director';
      const reopenResult = await q.reopen(periodId, reason);
      assert.equal(reopenResult.state, 'PUBLISHED');
      assert.equal(reopenResult.revision, 3);
      assert.equal(reopenResult.reason, reason);

      // Verify reason is preserved in outbox record
      const finalEntity = await store.read(key);
      const reopenOp = finalEntity.operations.find(o => o.operationType === 'PERIOD_REOPEN');
      assert.equal(reopenOp.status, 'CONFIRMED');
      assert.equal(reopenOp.payload.reason, reason);

      q.stop();
    });
  });

  describe('7. Multi-tab coordination', () => {
    it('prevents two tabs from independently generating two logical publish operations for the same period', async () => {
      const store = createMockStore();
      const repo = createMockRepository();
      const locks = createMockLocks();
      const periodId = '2030-07';
      const key = `draft:${periodId}`;

      const tab1 = new DraftQueue({
        store,
        repository: repo,
        settings: standardSettings,
        locks,
        tabId: crypto.randomUUID()
      });
      const tab2 = new DraftQueue({
        store,
        repository: repo,
        settings: standardSettings,
        locks,
        tabId: crypto.randomUUID()
      });

      await tab1.start();
      await tab2.start();

      // Tab 1 publishes
      const p1 = tab1.publish(periodId, { adminNote: 'Tab 1 Publish' });
      // Tab 2 concurrently calls publish for the same period
      const p2 = tab2.publish(periodId, { adminNote: 'Tab 2 Publish' });

      const [res1, res2] = await Promise.all([p1, p2]);
      assert.equal(res1.state, 'PUBLISHED');
      assert.equal(res2.state, 'PUBLISHED');

      // Exactly ONE publish operation must have been created in the store
      const finalEntity = await store.read(key);
      const publishOps = finalEntity.operations.filter(o => o.operationType === 'PERIOD_PUBLISH');
      assert.equal(publishOps.length, 1, 'Only one logical publish operation exists');

      // Only one publish call to backend
      const backendPublishCalls = repo.calls.filter(c => c.method === 'publish');
      assert.equal(backendPublishCalls.length, 1);

      tab1.stop();
      tab2.stop();
    });
  });

  describe('8. Legacy compatibility', () => {
    it('leaves non-enrolled legacy periods outside V2 lifecycle without error', async () => {
      const store = createMockStore();
      const repo = createMockRepository();
      const locks = createMockLocks();

      const q = new DraftQueue({
        store,
        repository: repo,
        settings: standardSettings,
        locks
      });
      await q.start();

      // Non-enrolled period returns null period record from backend
      const result = await q.getPeriodLifecycle('2024-01');
      assert.equal(result.ok, true);
      assert.equal(result.period, null);
      assert.deepEqual(result.events, []);

      // No entity created in store for non-enrolled period
      const stored = await store.read('draft:2024-01');
      assert.equal(stored, null);

      q.stop();
    });
  });

});
