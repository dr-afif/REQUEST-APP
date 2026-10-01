import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import LifecycleControls, { LifecycleBadge, PublishModal, CloseModal, ReopenModal } from '../../src/features/roster/components/LifecycleControls.jsx';
import DraftQueuePanel from '../../src/features/roster/components/DraftQueuePanel.jsx';

// Expose mounting utilities on window
window.mountLifecycleTest = (options = {}) => {
  const {
    initialPeriod = '2026-03',
    initialState = 'DRAFT',
    isAdmin = true,
    isEnrolled = true,
    initialPendingOp = null,
    settings = { roster_v2_write_enabled: true, write_queue_v2_enabled: true },
    publishDelay = 0,
    publishResult = null,
    publishError = null,
    closeDelay = 0,
    closeResult = null,
    closeError = null,
    reopenDelay = 0,
    reopenResult = null,
    reopenError = null,
    getPeriodLifecycleDelay = 0,
    onStateChange = null,
  } = options;

  let subscribers = [];
  let currentPeriod = initialPeriod;
  let currentState = initialState;
  let currentRevision = 1;
  let pendingOp = initialPendingOp;
  let callLog = {
    publish: [],
    close: [],
    reopen: [],
    retry: [],
    getPeriodLifecycle: []
  };

  const periodData = new Map();
  if (isEnrolled) {
    periodData.set(initialPeriod, {
      PeriodId: initialPeriod,
      State: initialState,
      Revision: currentRevision,
      SchemaVersion: 1
    });
  }

  const notify = () => subscribers.forEach(fn => fn());

  const mockQueue = {
    enabled: () => Boolean(settings.roster_v2_write_enabled && settings.write_queue_v2_enabled),
    subscribe: (fn) => {
      subscribers.push(fn);
      return () => {
        subscribers = subscribers.filter(s => s !== fn);
      };
    },
    start: async () => {},
    view: (key) => {
      const p = key.replace('draft:', '');
      const pData = periodData.get(p);
      return {
        lifecycle: {
          state: pData ? pData.State : currentState,
          revision: pData ? pData.Revision : currentRevision
        },
        operations: pendingOp ? [pendingOp] : [],
        baseline: { checksum: 'mock-sum' },
        cells: {},
        statuses: {}
      };
    },
    getPeriodLifecycle: async (p) => {
      callLog.getPeriodLifecycle.push(p);
      if (getPeriodLifecycleDelay > 0) {
        await new Promise(r => setTimeout(r, getPeriodLifecycleDelay));
      }
      if (periodData.has(p)) {
        return { ok: true, period: periodData.get(p) };
      }
      return { ok: true, period: null };
    },
    publish: async (p, opts) => {
      callLog.publish.push({ period: p, opts });
      if (publishDelay > 0) {
        await new Promise(r => setTimeout(r, publishDelay));
      }
      if (publishError) {
        const err = new Error(publishError);
        err.code = publishError;
        throw err;
      }
      if (publishResult) {
        if (publishResult.state) {
          currentState = publishResult.state;
          currentRevision = publishResult.revision || (currentRevision + 1);
          periodData.set(p, { PeriodId: p, State: currentState, Revision: currentRevision, SchemaVersion: 1 });
          notify();
        }
        return publishResult;
      }
      currentState = 'PUBLISHED';
      currentRevision += 1;
      periodData.set(p, { PeriodId: p, State: 'PUBLISHED', Revision: currentRevision, SchemaVersion: 1 });
      notify();
      return { ok: true, state: 'PUBLISHED', revision: currentRevision };
    },
    close: async (p, opts) => {
      callLog.close.push({ period: p, opts });
      if (closeDelay > 0) {
        await new Promise(r => setTimeout(r, closeDelay));
      }
      if (closeError) {
        const err = new Error(closeError);
        err.code = closeError;
        throw err;
      }
      if (closeResult) {
        if (closeResult.state) {
          currentState = closeResult.state;
          currentRevision = closeResult.revision || (currentRevision + 1);
          periodData.set(p, { PeriodId: p, State: currentState, Revision: currentRevision, SchemaVersion: 1 });
          notify();
        }
        return closeResult;
      }
      currentState = 'CLOSED';
      currentRevision += 1;
      periodData.set(p, { PeriodId: p, State: 'CLOSED', Revision: currentRevision, SchemaVersion: 1 });
      notify();
      return { ok: true, state: 'CLOSED', revision: currentRevision };
    },
    reopen: async (p, reason) => {
      callLog.reopen.push({ period: p, reason });
      if (reopenDelay > 0) {
        await new Promise(r => setTimeout(r, reopenDelay));
      }
      if (reopenError) {
        const err = new Error(reopenError);
        err.code = reopenError;
        throw err;
      }
      if (reopenResult) {
        if (reopenResult.state) {
          currentState = reopenResult.state;
          currentRevision = reopenResult.revision || (currentRevision + 1);
          periodData.set(p, { PeriodId: p, State: currentState, Revision: currentRevision, SchemaVersion: 1 });
          notify();
        }
        return reopenResult;
      }
      currentState = 'PUBLISHED';
      currentRevision += 1;
      periodData.set(p, { PeriodId: p, State: 'PUBLISHED', Revision: currentRevision, SchemaVersion: 1 });
      notify();
      return { ok: true, state: 'PUBLISHED', revision: currentRevision };
    },
    retry: async (key, opId) => {
      callLog.retry.push({ key, opId });
      pendingOp = null;
      notify();
      return { ok: true };
    }
  };

  const container = document.createElement('div');
  container.id = 'test-lifecycle-container';
  document.body.appendChild(container);
  const root = createRoot(container);

  function Wrapper() {
    const [period, setPeriod] = useState(initialPeriod);
    const [admin, setAdmin] = useState(isAdmin);

    window.__setPeriod = (newP) => {
      currentPeriod = newP;
      setPeriod(newP);
    };

    window.__setAdmin = (val) => setAdmin(val);

    return (
      <LifecycleControls
        period={period}
        settings={settings}
        isAdmin={admin}
        queue={mockQueue}
        onLifecycleStateChange={onStateChange}
      />
    );
  }

  root.render(<Wrapper />);

  window.lifecycleTest = {
    mockQueue,
    callLog,
    periodData,
    setPeriod: (p) => window.__setPeriod?.(p),
    setAdmin: (a) => window.__setAdmin?.(a),
    setPendingOp: (op) => {
      pendingOp = op;
      notify();
    },
    close: () => {
      if (container.isConnected) {
        root.unmount();
        container.remove();
      }
      window.lifecycleTest = null;
    }
  };
};

window.mountDraftPanelTest = (options = {}) => {
  const {
    period = '2026-03',
    lifecycleState = 'PUBLISHED',
  } = options;

  const key = `draft:${period}`;
  let subscribers = [];
  const mockQueue = {
    enabled: () => true,
    subscribe: (fn) => {
      subscribers.push(fn);
      return () => { subscribers = subscribers.filter(s => s !== fn); };
    },
    start: async () => {},
    stop: () => {},
    entities: new Map(),
    unsafe: new Map(),
    view: () => ({
      lifecycle: { state: lifecycleState, revision: 1 },
      baseline: { checksum: 'mock-sum' },
      cells: {},
      statuses: {},
      unsafe: false,
      error: null
    }),
    refresh: async () => {},
    enqueue: async () => {
      if (['PUBLISHED', 'CLOSED'].includes(lifecycleState)) {
        throw new Error('SNAPSHOT_IMMUTABLE');
      }
    },
    repository: {
      schema: async () => ({
        ok: true,
        people: [{ PersonId: 'person-1', CurrentDisplayName: 'Dr. Test', DirectoryType: 'MO' }],
        draftWritesEnabled: true
      })
    }
  };

  const container = document.createElement('div');
  container.id = 'test-draft-panel-container';
  document.body.appendChild(container);
  const root = createRoot(container);

  root.render(
    <DraftQueuePanel
      period={period}
      settings={{ roster_v2_write_enabled: true, write_queue_v2_enabled: true }}
      runtimeFactory={async () => mockQueue}
    />
  );

  window.draftPanelTest = {
    mockQueue,
    close: () => {
      if (container.isConnected) {
        root.unmount();
        container.remove();
      }
      window.draftPanelTest = null;
    }
  };
};
