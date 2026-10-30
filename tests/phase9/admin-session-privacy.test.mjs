import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import React from 'react';
import ReactDOMServer from 'react-dom/server';

import * as adminAuthModule from '../../src/features/roster/auth/adminAuth.js';

if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => store.get(k) || null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear()
  };
}

if (typeof globalThis.sessionStorage === 'undefined') {
  const store = new Map();
  globalThis.sessionStorage = {
    getItem: (k) => store.get(k) || null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear()
  };
}

if (typeof globalThis.window === 'undefined') {
  globalThis.window = globalThis;
}

if (typeof globalThis.document === 'undefined') {
  globalThis.document = {
    body: {
      nodeType: 1
    },
    getElementById: () => null,
    addEventListener: () => {},
    removeEventListener: () => {}
  };
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');
const req = createRequire(import.meta.url);

async function loadJsxComponent(relPath) {
  const bundleResult = await build({
    entryPoints: [path.resolve(rootDir, relPath)],
    bundle: true,
    write: false,
    format: 'cjs',
    jsx: 'automatic',
    define: { 'import.meta.env': '{}' },
    external: [
      'react',
      'react-dom',
      'react-dom/server',
      'lucide-react',
      'jspdf',
      'html2canvas',
      'docxtemplater',
      'pizzip',
      'file-saver',
      '../auth/adminAuth.js',
      './auth/adminAuth.js',
      '../features/roster/auth/adminAuth.js',
      '*/adminAuth.js'
    ]
  });
  const bundledCode = bundleResult.outputFiles[0].text;
  const mod = { exports: {} };
  const customRequire = (id) => {
    if (id.includes('adminAuth')) return adminAuthModule;
    if (id === 'react') return React;
    if (id === 'react-dom/server') return ReactDOMServer;
    return req(id);
  };
  const evalFn = new Function('require', 'module', 'exports', bundledCode);
  evalFn(customRequire, mod, mod.exports);
  return mod.exports.default || mod.exports;
}

function findNode(node, predicate) {
  if (!node) return null;
  if (predicate(node)) return node;
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findNode(item, predicate);
      if (found) return found;
    }
  }
  if (node.props?.children) {
    return findNode(node.props.children, predicate);
  }
  return null;
}

const createSlotHarness = () => ({
  states: new Map(),
  refs: new Map(),
  callbacks: new Map(),
  prevDeps: new Map(),
  cleanups: new Map()
});

const runWithSlot = (slot, renderFn) => {
  let sIdx = 0;
  let rIdx = 0;
  let cIdx = 0;
  let eIdx = 0;
  const pendingEffects = [];

  const origDispatcher = React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentDispatcher.current;

  React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentDispatcher.current = {
    useState: (init) => {
      const i = sIdx++;
      if (!slot.states.has(i)) {
        let val = typeof init === 'function' ? init() : init;
        if (val && typeof val === 'object' && 'isEnrolled' in val && 'state' in val) {
          val = {
            period: '2026-11',
            isEnrolled: true,
            state: 'DRAFT',
            revision: 1
          };
        }
        slot.states.set(i, val);
      }
      const setter = (next) => {
        const prev = slot.states.get(i);
        const resolved = typeof next === 'function' ? next(prev) : next;
        slot.states.set(i, resolved);
      };
      return [slot.states.get(i), setter];
    },
    useRef: (init) => {
      const i = rIdx++;
      if (!slot.refs.has(i)) {
        slot.refs.set(i, { current: init });
      }
      return slot.refs.get(i);
    },
    useCallback: (cb, deps) => {
      const i = cIdx++;
      const prev = slot.callbacks.get(i);
      if (
        prev &&
        deps &&
        prev.deps &&
        deps.length === prev.deps.length &&
        deps.every((d, idx) => Object.is(d, prev.deps[idx]))
      ) {
        return prev.cb;
      }
      slot.callbacks.set(i, { cb, deps });
      return cb;
    },
    useMemo: (cb) => cb(),
    useEffect: (cb, deps) => {
      const i = eIdx++;
      const prev = slot.prevDeps.get(i);
      const changed =
        !prev ||
        !deps ||
        deps.length !== prev.length ||
        deps.some((d, idx) => !Object.is(d, prev[idx]));
      if (changed) {
        slot.prevDeps.set(i, deps);
        pendingEffects.push({ i, cb });
      }
    }
  };

  try {
    const tree = renderFn();
    return {
      tree,
      flushEffects: () => {
        for (const { i, cb } of pendingEffects) {
          const prevCleanup = slot.cleanups.get(i);
          if (typeof prevCleanup === 'function') prevCleanup();
          const cleanup = cb();
          slot.cleanups.set(i, cleanup);
        }
      }
    };
  } finally {
    React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentDispatcher.current = origDispatcher;
  }
};

const unmountSlot = (slot) => {
  for (const cleanup of slot.cleanups.values()) {
    if (typeof cleanup === 'function') cleanup();
  }
  slot.cleanups.clear();
};

function build98Assignments() {
  const assignments = [];
  const doctorNames = [
    'Adi', 'Azrul', 'Fitri', 'Faris', 'Haziq',
    'Izzat', 'Khairul', 'Lokman', 'Nabil', 'Ridhwan',
    'Syafiq', 'Syuhada', 'Zul'
  ];
  for (let day = 1; day <= 14; day++) {
    const dateStr = `2026-11-${String(day).padStart(2, '0')}`;
    doctorNames.slice(0, 7).forEach((name, idx) => {
      assignments.push({
        assignmentId: `asg-${day}-${idx}`,
        personId: `person-${idx}`,
        personNameSnapshot: name,
        date: dateStr,
        shiftCode: idx % 2 === 0 ? 'AM' : 'PM',
        rawShift: idx % 2 === 0 ? 'AM' : 'PM',
        dutyDomain: 'MO'
      });
    });
  }
  return assignments;
}

test('Phase A1: Administrator Session Privacy Foundation Suite', async (t) => {
  let Phase5RosterContainer;
  let RosterPage;

  t.before(async () => {
    Phase5RosterContainer = await loadJsxComponent('src/features/roster/components/Phase5RosterContainer.jsx');
    RosterPage = await loadJsxComponent('src/components/RosterPage.jsx');
  });

  t.afterEach(() => {
    adminAuthModule.clearAdminSessionToken();
    globalThis.localStorage.clear();
    globalThis.sessionStorage.clear();
  });

  await t.test('1. Application logout revokes V2 admin token and notifies subscribers', () => {
    adminAuthModule.setAdminSessionToken('token-active-1', 'admin@example.com', 3600);
    assert.equal(adminAuthModule.isSessionTokenActive(), true);

    let notifyCount = 0;
    const unsub = adminAuthModule.subscribeAdminAuth(() => {
      notifyCount++;
    });

    // Simulate App.jsx handleSelectName('') logout logic
    globalThis.sessionStorage.setItem('resq_admin_verified', 'true');
    globalThis.localStorage.setItem('resq_member_name', 'Admin');

    globalThis.localStorage.removeItem('resq_member_name');
    globalThis.sessionStorage.removeItem('resq_admin_verified');
    adminAuthModule.clearAdminSessionToken();

    assert.equal(adminAuthModule.getAdminSessionToken(), null);
    assert.equal(adminAuthModule.isSessionTokenActive(), false);
    assert.equal(adminAuthModule.getAdminEmail(), null);
    assert.equal(notifyCount, 1, 'Auth subscriber must be notified on session token clear');
    assert.equal(globalThis.sessionStorage.getItem('resq_admin_verified'), null);
    assert.equal(globalThis.localStorage.getItem('resq_member_name'), null);

    unsub();
  });

  await t.test('2. Role transition away from Admin revokes token and fails closed', () => {
    adminAuthModule.setAdminSessionToken('token-active-2', 'admin@example.com', 3600);
    assert.equal(adminAuthModule.isSessionTokenActive(), true);

    let notifyCount = 0;
    const unsub = adminAuthModule.subscribeAdminAuth(() => {
      notifyCount++;
    });

    // Simulate switching to Dr. Alice in App.jsx
    adminAuthModule.clearAdminSessionToken();
    globalThis.localStorage.setItem('resq_member_name', 'Dr. Alice');

    assert.equal(adminAuthModule.getAdminSessionToken(), null);
    assert.equal(adminAuthModule.isSessionTokenActive(), false);
    assert.equal(notifyCount, 1);
    assert.equal(globalThis.localStorage.getItem('resq_member_name'), 'Dr. Alice');

    unsub();
  });

  await t.test('3. In-workspace Sign Out button immediately revokes session', () => {
    adminAuthModule.setAdminSessionToken('token-signout-btn', 'admin@example.com', 3600);
    assert.equal(adminAuthModule.isSessionTokenActive(), true);

    let notified = false;
    const unsub = adminAuthModule.subscribeAdminAuth(() => {
      notified = true;
    });

    // Simulate clicking #btn-admin-auth-sign-out
    adminAuthModule.clearAdminSessionToken();

    assert.equal(adminAuthModule.isSessionTokenActive(), false);
    assert.equal(notified, true);

    unsub();
  });

  await t.test('4. Proactive in-memory session expiry timer automatically revokes token and notifies', async () => {
    let notified = false;
    const unsub = adminAuthModule.subscribeAdminAuth(() => {
      notified = true;
    });

    // Set token with 50ms relative TTL
    adminAuthModule.setAdminSessionToken('token-short-ttl', 'admin@example.com', 0.05);
    assert.equal(adminAuthModule.isSessionTokenActive(), true);

    // Wait 100ms for timer to trigger
    await new Promise((r) => setTimeout(r, 100));

    assert.equal(adminAuthModule.getAdminSessionToken(), null);
    assert.equal(adminAuthModule.isSessionTokenActive(), false);
    assert.equal(notified, true, 'Subscribers must be notified when token expires via timer');

    unsub();
  });

  await t.test('5. Table DOM fail-closed: unauthenticated or logged out shows Authorization Required gate', async () => {
    adminAuthModule.clearAdminSessionToken();

    const authFailQueue = {
      enabled: () => true,
      start: async () => {},
      stop: () => {},
      subscribe: () => () => {},
      getPeriodLifecycle: async (period) => ({
        ok: true,
        period: { PeriodId: period, State: 'DRAFT', Revision: 1, DraftRevision: 1 }
      }),
      refresh: async () => {
        const err = new Error('Admin authorization required');
        err.code = 'AUTHORIZATION_REQUIRED';
        throw err;
      },
      view: () => ({
        cells: {},
        statuses: {},
        baseline: { revision: 1, checksum: 'chk-fail' },
        lifecycle: { state: 'DRAFT', revision: 1, draftRevision: 1 },
        operations: []
      })
    };

    const slot = createSlotHarness();
    let pass = runWithSlot(slot, () =>
      Phase5RosterContainer({
        period: '2026-11',
        isAdmin: true,
        allowDraft: true,
        queue: authFailQueue,
        settings: { roster_v2_read_enabled: true },
        verifiedLifecycle: {
          period: '2026-11',
          isEnrolled: true,
          state: 'DRAFT',
          revision: 1
        }
      })
    );
    pass.flushEffects();

    // Allow async loadAuthoritativeData to complete
    await new Promise((r) => setTimeout(r, 50));

    // Second render pass to reflect loaded state
    pass = runWithSlot(slot, () =>
      Phase5RosterContainer({
        period: '2026-11',
        isAdmin: true,
        allowDraft: true,
        queue: authFailQueue,
        settings: { roster_v2_read_enabled: true },
        verifiedLifecycle: {
          period: '2026-11',
          isEnrolled: true,
          state: 'DRAFT',
          revision: 1
        }
      })
    );
    pass.flushEffects();

    const html = ReactDOMServer.renderToStaticMarkup(pass.tree);
    assert.ok(html.includes('Administrator Authorization Required'), 'Must render Authorization Required heading');
    assert.ok(html.includes('btn-auth-required-verify'), 'Must render Verify with Google button');
    assert.ok(!html.includes('btn-admin-auth-sign-out'), 'Must not render Sign Out button when unverified');

    unmountSlot(slot);
  });

  await t.test('6. Calendar DOM fail-closed: active 98 draft assignments vanish immediately on logout', () => {
    adminAuthModule.setAdminSessionToken('token-cal-test', 'admin@example.com', 3600);

    const assignments98 = build98Assignments();
    const pageSlot = createSlotHarness();

    // 1. Initial render as authenticated Admin
    let pass = runWithSlot(pageSlot, () =>
      RosterPage({
        rosterMonth: '2026-11',
        isAdmin: true,
        selectedName: 'Admin',
        settings: {
          roster_workspace_v2_enabled: true,
          roster_v2_read_enabled: true
        }
      })
    );
    pass.flushEffects();

    // Find Phase5RosterContainer and emit loaded snapshot with 98 assignments
    const p5Node = findNode(pass.tree, (n) => typeof n?.props?.onLiveSnapshotChange === 'function');
    assert.ok(p5Node, 'Phase5RosterContainer must be in tree');

    p5Node.props.onLiveSnapshotChange({
      period: '2026-11',
      state: 'DRAFT',
      revision: 1,
      assignments: assignments98,
      isLoaded: true,
      isSaving: false,
      draftSaveStatus: 'saved'
    });

    // Re-render frame
    pass = runWithSlot(pageSlot, () =>
      RosterPage({
        rosterMonth: '2026-11',
        isAdmin: true,
        selectedName: 'Admin',
        settings: {
          roster_workspace_v2_enabled: true,
          roster_v2_read_enabled: true
        }
      })
    );
    pass.flushEffects();

    // Calendar static HTML shows doctor names
    let html = ReactDOMServer.renderToStaticMarkup(pass.tree);
    assert.ok(html.includes('Adi'), 'Calendar must display Adi before logout');
    assert.ok(html.includes('Azrul'), 'Calendar must display Azrul before logout');

    // 2. NOW LOG OUT!
    adminAuthModule.clearAdminSessionToken();

    // Re-render frame after logout notification
    pass = runWithSlot(pageSlot, () =>
      RosterPage({
        rosterMonth: '2026-11',
        isAdmin: false,
        selectedName: '',
        settings: {
          roster_workspace_v2_enabled: true,
          roster_v2_read_enabled: true
        }
      })
    );
    pass.flushEffects();

    // Inspect HTML: ALL private doctor draft assignments must be gone!
    html = ReactDOMServer.renderToStaticMarkup(pass.tree);
    assert.equal(html.includes('Adi'), false, 'Calendar MUST NOT display Adi after logout');
    assert.equal(html.includes('Azrul'), false, 'Calendar MUST NOT display Azrul after logout');

    unmountSlot(pageSlot);
  });

  await t.test('7. Late in-flight asynchronous draft load resolving after logout is discarded', async () => {
    adminAuthModule.setAdminSessionToken('token-async-race', 'admin@example.com', 3600);

    let lateResolve;
    const slowQueue = {
      refresh: async () => {
        return new Promise((resolve) => {
          lateResolve = resolve;
        });
      },
      view: () => ({
        cells: { 'cell-1': 'AM' },
        baseline: { revision: 1, checksum: 'chk-late' },
        lifecycle: { state: 'DRAFT', revision: 1, draftRevision: 1 },
        operations: []
      })
    };

    let emittedSnapshot = null;
    const slot = createSlotHarness();
    const pass = runWithSlot(slot, () =>
      Phase5RosterContainer({
        period: '2026-11',
        isAdmin: true,
        allowDraft: true,
        queue: slowQueue,
        settings: { roster_v2_read_enabled: true },
        verifiedLifecycle: {
          period: '2026-11',
          isEnrolled: true,
          state: 'DRAFT',
          revision: 1
        },
        onLiveSnapshotChange: (snap) => {
          emittedSnapshot = snap;
        }
      })
    );
    pass.flushEffects();

    // User logs out while request is in flight
    adminAuthModule.clearAdminSessionToken();

    // Now late network response resolves
    if (typeof lateResolve === 'function') {
      lateResolve({ ok: true });
    }

    // Wait a tick
    await new Promise((r) => setTimeout(r, 20));

    // The emitted snapshot must remain not loaded
    if (emittedSnapshot) {
      assert.equal(emittedSnapshot.isLoaded, false, 'Late response must not mark snapshot loaded after logout');
      assert.deepEqual(emittedSnapshot.assignments, [], 'Late response must not populate private assignments');
    }

    unmountSlot(slot);
  });

  await t.test('8. Navigation cache is purged on logout preventing cached draft exposure on revisit', () => {
    adminAuthModule.setAdminSessionToken('token-cache-purge', 'admin@example.com', 3600);

    const assignments98 = build98Assignments();
    const pageSlot = createSlotHarness();

    // 1. Visit November and cache 98 assignments
    let pass = runWithSlot(pageSlot, () =>
      RosterPage({
        rosterMonth: '2026-11',
        isAdmin: true,
        selectedName: 'Admin',
        settings: {
          roster_workspace_v2_enabled: true,
          roster_v2_read_enabled: true
        }
      })
    );
    pass.flushEffects();

    const p5Node = findNode(pass.tree, (n) => typeof n?.props?.onLiveSnapshotChange === 'function');
    assert.ok(p5Node, 'Phase5RosterContainer must be in tree');

    p5Node.props.onLiveSnapshotChange({
      period: '2026-11',
      state: 'DRAFT',
      revision: 1,
      assignments: assignments98,
      isLoaded: true,
      isSaving: false,
      draftSaveStatus: 'saved'
    });

    // 2. Navigate away to October
    pass = runWithSlot(pageSlot, () =>
      RosterPage({
        rosterMonth: '2026-10',
        isAdmin: true,
        selectedName: 'Admin',
        settings: {
          roster_workspace_v2_enabled: true,
          roster_v2_read_enabled: true
        }
      })
    );
    pass.flushEffects();

    // 3. User logs out while on October
    adminAuthModule.clearAdminSessionToken();

    // 4. Return to November unauthenticated
    let capturedSnapshot = null;
    pass = runWithSlot(pageSlot, () =>
      RosterPage({
        rosterMonth: '2026-11',
        isAdmin: false,
        selectedName: '',
        onV2LiveSnapshotChange: (s) => {
          capturedSnapshot = s;
        },
        settings: {
          roster_workspace_v2_enabled: true,
          roster_v2_read_enabled: true
        }
      })
    );
    pass.flushEffects();

    // Verify: Cached November assignments must NOT be restored on Frame 0
    if (capturedSnapshot?.v2LiveSnapshot) {
      assert.equal(capturedSnapshot.v2LiveSnapshot.isLoaded, false);
      assert.deepEqual(capturedSnapshot.v2LiveSnapshot.assignments, []);
    }

    const html = ReactDOMServer.renderToStaticMarkup(pass.tree);
    assert.equal(html.includes('Adi'), false, 'Revisited November MUST NOT leak cached Adi');
    assert.equal(html.includes('Azrul'), false, 'Revisited November MUST NOT leak cached Azrul');

    unmountSlot(pageSlot);
  });
});
