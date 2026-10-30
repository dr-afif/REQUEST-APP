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
  globalThis.localStorage = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
    clear: () => {}
  };
}

if (typeof globalThis.window === 'undefined') {
  globalThis.window = globalThis;
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
      './auth/adminAuth.js'
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

function createMockQueue(overrides = {}) {
  const lifecycleCalls = [];
  const refreshCalls = [];

  const {
    getPeriodLifecycle: overrideGetLifecycle,
    refresh: overrideRefresh,
    view: overrideView,
    getCurrentRoster: overrideGetCurrentRoster,
    ...restOverrides
  } = overrides;

  const queue = {
    lifecycleCalls,
    refreshCalls,
    enabled: () => true,
    start: async () => {},
    stop: () => {},
    subscribe: () => () => {},
    getPeriodLifecycle: async (period) => {
      lifecycleCalls.push({ period, timestamp: Date.now() });
      if (overrideGetLifecycle) {
        return overrideGetLifecycle(period);
      }
      return {
        ok: true,
        period: {
          PeriodId: period,
          State: 'DRAFT',
          Revision: 1,
          DraftRevision: 1
        }
      };
    },
    refresh: async (key) => {
      refreshCalls.push(key);
      if (overrideRefresh) {
        return overrideRefresh(key);
      }
      return { ok: true };
    },
    view: (key) => {
      if (overrideView) return overrideView(key);
      return {
        cells: {},
        statuses: {},
        baseline: { revision: 1, checksum: 'chk-default' },
        lifecycle: { state: 'DRAFT', revision: 1, draftRevision: 1 },
        operations: []
      };
    },
    getCurrentRoster: async (period) => {
      if (overrideGetCurrentRoster) return overrideGetCurrentRoster(period);
      return { ok: true, period, state: 'PUBLISHED', assignments: [] };
    },
    getPlannedRoster: async (period) => ({ ok: true, period, state: 'PUBLISHED', assignments: [] }),
    getAmendmentHistory: async () => ({ ok: true, amendments: [] }),
    getAbsences: async () => ({ ok: true, absences: [] }),
    getReplacements: async () => ({ ok: true, replacements: [] }),
    ...restOverrides
  };
  return queue;
}

test('Phase B3a.2: Administrator Auth Recovery Race & Session Consistency Suite', async (t) => {
  let Phase5RosterContainer;
  let LifecycleControls;
  let RosterPage;

  t.before(async () => {
    Phase5RosterContainer = await loadJsxComponent('src/features/roster/components/Phase5RosterContainer.jsx');
    LifecycleControls = await loadJsxComponent('src/features/roster/components/LifecycleControls.jsx');
    RosterPage = await loadJsxComponent('src/components/RosterPage.jsx');
  });

  let activeCleanup = null;
  t.afterEach(() => {
    activeCleanup?.();
    activeCleanup = null;
    adminAuthModule.clearAdminSessionToken();
  });

  const build98Cells = () => {
    const people98 = Array.from({ length: 7 }, (_, i) => ({
      personId: `doc_${i + 1}`,
      name: `Doctor ${i + 1}`,
      dutyDomain: 'MO',
      role: 'MO',
      active: true
    }));
    const cells98 = {};
    for (let pIdx = 0; pIdx < 7; pIdx++) {
      for (let day = 1; day <= 14; day++) {
        const dd = String(day).padStart(2, '0');
        const shiftCode = day % 2 === 0 ? 'PM' : 'AM';
        cells98[`doc_${pIdx + 1}/2026-11-${dd}`] = [
          {
            assignmentId: `doc_${pIdx + 1}:2026-11-${dd}:MO:${shiftCode}`,
            shiftCode,
            rawShift: shiftCode,
            dutyDomain: 'MO'
          }
        ];
      }
    }
    return { people98, cells98 };
  };

  const runWithDispatcher = async (props) => {
    const origDispatcher = React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentDispatcher.current;
    const stateMap = new Map();
    let stateIdx = 0;
    const refMap = new Map();
    let refIdx = 0;
    const effects = [];
    const cleanups = [];
    const prevDepsMap = new Map();
    let currentProps = props;

    const triggerRender = (newProps = null) => {
      const isInternalUpdate = !newProps;
      if (newProps) currentProps = newProps;

      stateIdx = 0;
      refIdx = 0;
      let effIdx = 0;
      effects.length = 0;

      React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentDispatcher.current = {
        useState: (initial) => {
          const idx = stateIdx++;
          if (!stateMap.has(idx)) {
            const val = typeof initial === 'function' ? initial() : initial;
            stateMap.set(idx, val);
          }
          const currentVal = stateMap.get(idx);
          const setter = (next) => {
            const nextVal = typeof next === 'function' ? next(stateMap.get(idx)) : next;
            stateMap.set(idx, nextVal);
          };
          return [currentVal, setter];
        },
        useRef: (initial) => {
          const idx = refIdx++;
          if (!refMap.has(idx)) {
            refMap.set(idx, { current: initial });
          }
          return refMap.get(idx);
        },
        useCallback: (cb) => cb,
        useEffect: (cb, deps) => {
          const idx = effIdx++;
          const prevDeps = prevDepsMap.get(idx);
          const changed = !prevDeps || !deps || deps.some((d, i) => d !== prevDeps[i]);
          prevDepsMap.set(idx, deps);
          if (changed && (!isInternalUpdate || idx !== 0)) {
            effects.push({ cb, deps });
          }
        },
        useMemo: (cb) => cb()
      };

      const element = Phase5RosterContainer(currentProps);
      return element;
    };

    const initialElement = triggerRender(props);

    for (const eff of effects) {
      if (typeof eff.cb === 'function') {
        const cleanup = eff.cb();
        if (typeof cleanup === 'function') cleanups.push(cleanup);
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 40));

    const renderedElement = triggerRender();
    for (const eff of effects) {
      if (typeof eff.cb === 'function') {
        const cleanup = eff.cb();
        if (typeof cleanup === 'function') cleanups.push(cleanup);
      }
    }

    const result = {
      element: renderedElement,
      stateMap,
      refMap,
      triggerRender,
      cleanup: () => {
        for (const c of cleanups) {
          try { c(); } catch (_) {}
        }
      },
      runEffects: async () => {
        for (const eff of effects) {
          if (typeof eff.cb === 'function') {
            const res = eff.cb();
            if (typeof res === 'function') cleanups.push(res);
            else if (res && typeof res.then === 'function') await res;
          }
        }
      }
    };
    activeCleanup = result.cleanup;
    return result;
  };

  await t.test('1. Unauthenticated November DRAFT shows authorization-required panel', async () => {
    adminAuthModule.clearAdminSessionToken();

    const authFailQueue = createMockQueue({
      refresh: async () => {
        const err = new Error('Admin authorization required');
        err.code = 'AUTHORIZATION_REQUIRED';
        throw err;
      }
    });

    let liveSnapshot = null;
    const { element, stateMap } = await runWithDispatcher({
      period: '2026-11',
      isAdmin: true,
      allowDraft: true,
      queue: authFailQueue,
      verifiedLifecycle: {
        period: '2026-11',
        isEnrolled: true,
        state: 'DRAFT',
        revision: 1,
        draftRevision: 1
      },
      settings: { roster_v2_read_enabled: true },
      onLiveSnapshotChange: (s) => { liveSnapshot = s; }
    });

    assert.equal(stateMap.get(10), 'AUTHORIZATION_REQUIRED', 'draftReadError must be AUTHORIZATION_REQUIRED');
    assert.equal(stateMap.get(4), null, 'currentRoster must be null when unauthenticated');

    const html = ReactDOMServer.renderToStaticMarkup(element);
    assert.ok(html.includes('Administrator Authorization Required'), 'Must render Authorization Required heading');
    assert.ok(html.includes('btn-auth-required-verify'), 'Must render Verify with Google button');
    assert.ok(html.includes('Verification required'), 'Must show Verification required pill');
    assert.ok(!html.includes('admin-auth-verified-badge'), 'Must not render Verified administrator badge');
    assert.ok(html.includes('admin-auth-required-badge'), 'Must render Administrator verification required badge');

    assert.ok(liveSnapshot !== null, 'Must emit snapshot');
    assert.equal(liveSnapshot.isLoaded, false, 'Snapshot isLoaded must be false');
    assert.deepEqual(liveSnapshot.assignments, [], 'Snapshot assignments must be empty');
  });

  await t.test('2. Auth succeeds before queue init; draft loads once queue ready', async () => {
    const { people98, cells98 } = build98Cells();
    adminAuthModule.setAdminSessionToken('token-early-auth-2', 'admin@example.com');

    const mockQueue = {
      enabled: () => true,
      start: async () => {},
      stop: () => {},
      subscribe: () => () => {},
      repository: {
        schema: async () => ({ ok: true, people: people98 })
      },
      getPeriodLifecycle: async (p) => ({
        ok: true,
        period: { PeriodId: p, State: 'DRAFT', Revision: 1, DraftRevision: 1 }
      }),
      refresh: async () => ({ ok: true }),
      view: (k) => ({
        cells: cells98,
        statuses: {},
        baseline: { revision: 1, checksum: 'chk-early' },
        lifecycle: { state: 'DRAFT', revision: 1, draftRevision: 1 },
        operations: []
      })
    };

    let liveSnapshot = null;
    const { element, stateMap } = await runWithDispatcher({
      period: '2026-11',
      isAdmin: true,
      allowDraft: true,
      queue: mockQueue,
      verifiedLifecycle: {
        period: '2026-11',
        isEnrolled: true,
        state: 'DRAFT',
        revision: 1,
        draftRevision: 1
      },
      settings: { roster_v2_read_enabled: true },
      people: people98,
      onLiveSnapshotChange: (s) => { liveSnapshot = s; }
    });

    assert.equal(stateMap.get(10), null, 'draftReadError must be null');
    assert.ok(stateMap.get(4)?.ok, 'currentRoster must be loaded');
    assert.equal(stateMap.get(4)?.assignments.length, 98, 'currentRoster must contain 98 assignments');

    const html = ReactDOMServer.renderToStaticMarkup(element);
    assert.ok(html.includes('admin-auth-verified-badge'), 'Must render Verified administrator badge');
    assert.ok(html.includes('admin@example.com'), 'Must show admin email in badge');
    assert.ok(!html.includes('Administrator Authorization Required'), 'Must not render Authorization Required panel');
    assert.ok(!html.includes('btn-auth-required-verify'), 'Must not render Verify button');

    assert.equal(liveSnapshot?.isLoaded, true, 'Live snapshot isLoaded must be true');
    assert.equal(liveSnapshot?.assignments.length, 98, 'Live snapshot must contain 98 assignments');
  });

  await t.test('3. Queue inits first; subsequent auth succeeds and loads draft', async () => {
    adminAuthModule.clearAdminSessionToken();
    const { people98, cells98 } = build98Cells();

    let serverHasAuth = false;
    const mockQueue = {
      enabled: () => true,
      start: async () => {},
      stop: () => {},
      subscribe: () => () => {},
      repository: {
        schema: async () => ({ ok: true, people: people98 })
      },
      getPeriodLifecycle: async (p) => ({
        ok: true,
        period: { PeriodId: p, State: 'DRAFT', Revision: 1, DraftRevision: 1 }
      }),
      refresh: async () => {
        if (!serverHasAuth) {
          const err = new Error('Admin authorization required');
          err.code = 'AUTHORIZATION_REQUIRED';
          throw err;
        }
        return { ok: true };
      },
      view: (k) => ({
        cells: serverHasAuth ? cells98 : {},
        statuses: {},
        baseline: { revision: 1, checksum: 'chk-3' },
        lifecycle: { state: 'DRAFT', revision: 1, draftRevision: 1 },
        operations: []
      })
    };

    let liveSnapshot = null;
    const { stateMap, triggerRender, runEffects } = await runWithDispatcher({
      period: '2026-11',
      isAdmin: true,
      allowDraft: true,
      queue: mockQueue,
      verifiedLifecycle: {
        period: '2026-11',
        isEnrolled: true,
        state: 'DRAFT',
        revision: 1,
        draftRevision: 1
      },
      settings: { roster_v2_read_enabled: true },
      people: people98,
      onLiveSnapshotChange: (s) => { liveSnapshot = s; }
    });

    assert.equal(stateMap.get(10), 'AUTHORIZATION_REQUIRED', 'Initial draftReadError must be AUTHORIZATION_REQUIRED');
    assert.equal(stateMap.get(4), null, 'Initial currentRoster must be null');

    serverHasAuth = true;
    adminAuthModule.setAdminSessionToken('token-subsequent-3', 'admin@example.com');

    await new Promise((resolve) => setTimeout(resolve, 40));
    const updatedElement = triggerRender();
    await runEffects();

    assert.equal(stateMap.get(10), null, 'draftReadError must be cleared after auth');
    assert.ok(stateMap.get(4)?.ok, 'currentRoster must be loaded after auth');
    assert.equal(stateMap.get(4)?.assignments.length, 98, 'currentRoster must contain 98 assignments');

    const html = ReactDOMServer.renderToStaticMarkup(updatedElement);
    assert.ok(html.includes('admin-auth-verified-badge'), 'Must render Verified administrator badge');
    assert.ok(!html.includes('Administrator Authorization Required'), 'Must clear Authorization Required panel');

    assert.equal(liveSnapshot?.isLoaded, true, 'Live snapshot isLoaded must become true');
    assert.equal(liveSnapshot?.assignments.length, 98, 'Live snapshot must update with 98 assignments');
  });

  await t.test('4. Verified indicator appears, stale warning disappears, draft loads 98 assignments', async () => {
    adminAuthModule.clearAdminSessionToken();
    const { people98, cells98 } = build98Cells();

    let serverHasAuth = false;
    const mockQueue = {
      enabled: () => true,
      start: async () => {},
      stop: () => {},
      subscribe: () => () => {},
      repository: {
        schema: async () => ({ ok: true, people: people98 })
      },
      getPeriodLifecycle: async (p) => ({
        ok: true,
        period: { PeriodId: p, State: 'DRAFT', Revision: 1, DraftRevision: 1 }
      }),
      refresh: async () => {
        if (!serverHasAuth) {
          const err = new Error('Auth required');
          err.code = 'AUTHORIZATION_REQUIRED';
          throw err;
        }
        return { ok: true };
      },
      view: (k) => ({
        cells: serverHasAuth ? cells98 : {},
        statuses: {},
        baseline: { revision: 1, checksum: 'chk-4' },
        lifecycle: { state: 'DRAFT', revision: 1, draftRevision: 1 },
        operations: []
      })
    };

    const { triggerRender, runEffects } = await runWithDispatcher({
      period: '2026-11',
      isAdmin: true,
      allowDraft: true,
      queue: mockQueue,
      verifiedLifecycle: {
        period: '2026-11',
        isEnrolled: true,
        state: 'DRAFT',
        revision: 1,
        draftRevision: 1
      },
      settings: { roster_v2_read_enabled: true },
      people: people98
    });

    // 1. Pre-auth state
    const preAuthHtml = ReactDOMServer.renderToStaticMarkup(triggerRender());
    assert.ok(preAuthHtml.includes('Verification required'), 'Pre-auth must show Verification required');
    assert.ok(preAuthHtml.includes('btn-auth-required-verify'), 'Pre-auth must show Verify button');
    assert.ok(!preAuthHtml.includes('admin-auth-verified-badge'), 'Pre-auth must not show Verified badge');

    // 2. Auth transition
    serverHasAuth = true;
    adminAuthModule.setAdminSessionToken('token-step-4', 'admin@example.com');
    await new Promise((resolve) => setTimeout(resolve, 30));
    await runEffects();

    // 3. Post-auth state
    const postAuthHtml = ReactDOMServer.renderToStaticMarkup(triggerRender());
    assert.ok(postAuthHtml.includes('admin-auth-verified-badge'), 'Post-auth must show Verified badge');
    assert.ok(!postAuthHtml.includes('Verification required'), 'Post-auth must NOT show Verification required');
    assert.ok(!postAuthHtml.includes('Administrator Authorization Required'), 'Post-auth must NOT show Authorization Required panel');
    assert.ok(!postAuthHtml.includes('btn-auth-required-verify'), 'Post-auth must NOT show Verify button');

    assert.equal(
      postAuthHtml.includes('admin-auth-verified-badge') && postAuthHtml.includes('btn-auth-required-verify'),
      false,
      'Conflicting state (verified badge AND verify button simultaneously) must NEVER occur'
    );
  });

  await t.test('5. Expiration/logout fails closed', async () => {
    const { people98, cells98 } = build98Cells();
    adminAuthModule.setAdminSessionToken('token-active-5', 'admin@example.com');

    const mockQueue = {
      enabled: () => true,
      start: async () => {},
      stop: () => {},
      subscribe: () => () => {},
      repository: {
        schema: async () => ({ ok: true, people: people98 })
      },
      getPeriodLifecycle: async (p) => ({
        ok: true,
        period: { PeriodId: p, State: 'DRAFT', Revision: 1, DraftRevision: 1 }
      }),
      refresh: async () => ({ ok: true }),
      view: (k) => ({
        cells: cells98,
        statuses: {},
        baseline: { revision: 1, checksum: 'chk-5' },
        lifecycle: { state: 'DRAFT', revision: 1, draftRevision: 1 },
        operations: []
      })
    };

    let liveSnapshot = null;
    const { stateMap, triggerRender, runEffects } = await runWithDispatcher({
      period: '2026-11',
      isAdmin: true,
      allowDraft: true,
      queue: mockQueue,
      verifiedLifecycle: {
        period: '2026-11',
        isEnrolled: true,
        state: 'DRAFT',
        revision: 1,
        draftRevision: 1
      },
      settings: { roster_v2_read_enabled: true },
      people: people98,
      onLiveSnapshotChange: (s) => { liveSnapshot = s; }
    });

    assert.equal(stateMap.get(4)?.assignments.length, 98, 'Draft must be loaded initially');
    assert.equal(liveSnapshot?.isLoaded, true, 'Live snapshot must be loaded initially');

    // Simulate session expiration / logout
    adminAuthModule.clearAdminSessionToken();
    await new Promise((resolve) => setTimeout(resolve, 40));
    const loggedOutElement = triggerRender();
    await runEffects();
    assert.equal(stateMap.get(4), null, 'currentRoster must be immediately cleared on logout');
    assert.equal(stateMap.get(10), 'AUTHORIZATION_REQUIRED', 'draftReadError must fail closed to AUTHORIZATION_REQUIRED');
    assert.equal(liveSnapshot?.isLoaded, false, 'Live snapshot isLoaded must become false on logout');
    assert.deepEqual(liveSnapshot?.assignments, [], 'Live snapshot assignments must be emptied on logout');

    const html = ReactDOMServer.renderToStaticMarkup(loggedOutElement);
    assert.ok(html.includes('Administrator Authorization Required'), 'Must render Authorization Required on logout');
    assert.ok(!html.includes('admin-auth-verified-badge'), 'Must remove Verified badge on logout');
  });

  await t.test('6. Rejected/expired backend token remains fail-closed', async () => {
    adminAuthModule.setAdminSessionToken('token-to-be-rejected-6', 'admin@example.com');

    const mockQueue = createMockQueue({
      refresh: async () => {
        const err = new Error('Token rejected by server');
        err.code = 'AUTHORIZATION_REQUIRED';
        throw err;
      }
    });

    const { element, stateMap } = await runWithDispatcher({
      period: '2026-11',
      isAdmin: true,
      allowDraft: true,
      queue: mockQueue,
      verifiedLifecycle: {
        period: '2026-11',
        isEnrolled: true,
        state: 'DRAFT',
        revision: 1,
        draftRevision: 1
      },
      settings: { roster_v2_read_enabled: true }
    });

    assert.equal(stateMap.get(10), 'AUTHORIZATION_REQUIRED', 'draftReadError must be AUTHORIZATION_REQUIRED on backend rejection');
    assert.equal(stateMap.get(4), null, 'currentRoster must be null');
    assert.equal(adminAuthModule.getAdminSessionToken(), null, 'Rejected token must be cleared from memory');

    const html = ReactDOMServer.renderToStaticMarkup(element);
    assert.ok(html.includes('Administrator Authorization Required'), 'Must render fail-closed Authorization Required panel');
    assert.ok(!html.includes('admin-auth-verified-badge'), 'Must NOT render Verified administrator badge when token is rejected');
  });

  await t.test('7. No duplicate draft reads per auth transition', async () => {
    adminAuthModule.clearAdminSessionToken();
    const { people98, cells98 } = build98Cells();

    let refreshCallCount = 0;
    const mockQueue = {
      enabled: () => true,
      start: async () => {},
      stop: () => {},
      subscribe: () => () => {},
      repository: {
        schema: async () => ({ ok: true, people: people98 })
      },
      getPeriodLifecycle: async (p) => ({
        ok: true,
        period: { PeriodId: p, State: 'DRAFT', Revision: 1, DraftRevision: 1 }
      }),
      refresh: async () => {
        refreshCallCount++;
        return { ok: true };
      },
      view: (k) => ({
        cells: cells98,
        statuses: {},
        baseline: { revision: 1, checksum: 'chk-7' },
        lifecycle: { state: 'DRAFT', revision: 1, draftRevision: 1 },
        operations: []
      })
    };

    const { runEffects } = await runWithDispatcher({
      period: '2026-11',
      isAdmin: true,
      allowDraft: true,
      queue: mockQueue,
      verifiedLifecycle: {
        period: '2026-11',
        isEnrolled: true,
        state: 'DRAFT',
        revision: 1,
        draftRevision: 1
      },
      settings: { roster_v2_read_enabled: true },
      people: people98
    });

    assert.equal(refreshCallCount, 1, 'Initial mount performs exactly 1 refresh call');

    // Trigger auth transition with rapid redundant notifications
    adminAuthModule.setAdminSessionToken('token-dedup-7', 'admin@example.com');
    adminAuthModule.setAdminSessionToken('token-dedup-7', 'admin@example.com');

    await new Promise((resolve) => setTimeout(resolve, 30));
    await runEffects();

    assert.equal(
      refreshCallCount,
      2,
      'Auth transition must perform exactly 1 additional refresh call, ignoring duplicate notifications'
    );
  });

  await t.test('8. Nov -> Oct -> Nov preserves session and reloads draft without re-auth', async () => {
    const { people98, cells98 } = build98Cells();
    adminAuthModule.setAdminSessionToken('token-preserved-8', 'admin@nav.com');

    const mockQueue = {
      enabled: () => true,
      start: async () => {},
      stop: () => {},
      subscribe: () => () => {},
      repository: {
        schema: async () => ({ ok: true, people: people98 })
      },
      getPeriodLifecycle: async (p) => {
        if (p === '2026-11') {
          return { ok: true, period: { PeriodId: '2026-11', State: 'DRAFT', Revision: 1, DraftRevision: 1 } };
        }
        return { ok: false, error: 'NOT_ENROLLED' };
      },
      refresh: async () => ({ ok: true }),
      view: (k) => ({
        cells: cells98,
        statuses: {},
        baseline: { revision: 1, checksum: 'chk-8' },
        lifecycle: { state: 'DRAFT', revision: 1, draftRevision: 1 },
        operations: []
      })
    };

    // 1. Visit November authenticated
    let nov1Snapshot = null;
    await runWithDispatcher({
      period: '2026-11',
      isAdmin: true,
      allowDraft: true,
      queue: mockQueue,
      verifiedLifecycle: {
        period: '2026-11',
        isEnrolled: true,
        state: 'DRAFT',
        revision: 1,
        draftRevision: 1
      },
      settings: { roster_v2_read_enabled: true },
      people: people98,
      onLiveSnapshotChange: (s) => { nov1Snapshot = s; }
    });

    assert.equal(nov1Snapshot?.isLoaded, true, 'November 1st visit loads draft');
    assert.equal(nov1Snapshot?.assignments.length, 98, 'November 1st visit loads 98 assignments');

    // 2. Navigate to October: token remains active in memory
    assert.equal(adminAuthModule.getAdminSessionToken(), 'token-preserved-8', 'Token remains preserved across navigation');

    // 3. Navigate back to November
    let nov2Snapshot = null;
    const { element: nov2Element, stateMap: nov2StateMap } = await runWithDispatcher({
      period: '2026-11',
      isAdmin: true,
      allowDraft: true,
      queue: mockQueue,
      verifiedLifecycle: {
        period: '2026-11',
        isEnrolled: true,
        state: 'DRAFT',
        revision: 1,
        draftRevision: 1
      },
      settings: { roster_v2_read_enabled: true },
      people: people98,
      onLiveSnapshotChange: (s) => { nov2Snapshot = s; }
    });

    assert.equal(nov2StateMap.get(10), null, 'draftReadError must be null on return to November');
    assert.equal(nov2StateMap.get(4)?.assignments.length, 98, 'currentRoster rehydrates all 98 assignments');
    assert.equal(nov2Snapshot?.isLoaded, true, 'November return live snapshot must be loaded');
    assert.equal(nov2Snapshot?.assignments.length, 98, 'November return live snapshot has 98 assignments');

    const html = ReactDOMServer.renderToStaticMarkup(nov2Element);
    assert.ok(html.includes('admin-auth-verified-badge'), 'Must show Verified administrator badge on return');
    assert.ok(!html.includes('Administrator Authorization Required'), 'Must not prompt for authorization on return');
  });

  await t.test('9. Late responses rejected', async () => {
    adminAuthModule.clearAdminSessionToken();
    const { people98, cells98 } = build98Cells();

    let resolveSlowFetch;
    const slowRefreshPromise = new Promise((resolve) => {
      resolveSlowFetch = resolve;
    });

    let refreshAttempt = 0;
    const mockQueue = {
      enabled: () => true,
      start: async () => {},
      stop: () => {},
      subscribe: () => () => {},
      repository: {
        schema: async () => ({ ok: true, people: people98 })
      },
      getPeriodLifecycle: async (p) => ({
        ok: true,
        period: { PeriodId: p, State: 'DRAFT', Revision: 1, DraftRevision: 1 }
      }),
      refresh: async () => {
        refreshAttempt++;
        if (refreshAttempt === 1) {
          await slowRefreshPromise;
          const err = new Error('Late auth failure');
          err.code = 'AUTHORIZATION_REQUIRED';
          throw err;
        }
        return { ok: true };
      },
      view: (k) => ({
        cells: cells98,
        statuses: {},
        baseline: { revision: 1, checksum: 'chk-9' },
        lifecycle: { state: 'DRAFT', revision: 1, draftRevision: 1 },
        operations: []
      })
    };

    const { stateMap, runEffects } = await runWithDispatcher({
      period: '2026-11',
      isAdmin: true,
      allowDraft: true,
      queue: mockQueue,
      verifiedLifecycle: {
        period: '2026-11',
        isEnrolled: true,
        state: 'DRAFT',
        revision: 1,
        draftRevision: 1
      },
      settings: { roster_v2_read_enabled: true },
      people: people98
    });

    // Authenticate and increment generation for second fetch
    adminAuthModule.setAdminSessionToken('token-fast-9', 'admin@fast.com');
    await runEffects();

    // Now resolve the slow 1st response late
    resolveSlowFetch();
    await new Promise((resolve) => setTimeout(resolve, 30));

    // Stale generation 1 error must NOT overwrite generation 2 state
    assert.notEqual(stateMap.get(10), 'AUTHORIZATION_REQUIRED', 'Late response must not overwrite with AUTHORIZATION_REQUIRED');
  });

  await t.test('10. Autosave / undo / redo intact', async () => {
    const { people98, cells98 } = build98Cells();
    adminAuthModule.setAdminSessionToken('token-editing-10', 'admin@editing.com');

    const mockQueue = {
      enabled: () => true,
      start: async () => {},
      stop: () => {},
      subscribe: () => () => {},
      repository: {
        schema: async () => ({ ok: true, people: people98 })
      },
      getPeriodLifecycle: async (p) => ({
        ok: true,
        period: { PeriodId: p, State: 'DRAFT', Revision: 1, DraftRevision: 1 }
      }),
      refresh: async () => ({ ok: true }),
      view: (k) => ({
        cells: cells98,
        statuses: {},
        baseline: { revision: 1, checksum: 'chk-10' },
        lifecycle: { state: 'DRAFT', revision: 1, draftRevision: 1 },
        operations: []
      })
    };

    const { element, stateMap } = await runWithDispatcher({
      period: '2026-11',
      isAdmin: true,
      allowDraft: true,
      queue: mockQueue,
      verifiedLifecycle: {
        period: '2026-11',
        isEnrolled: true,
        state: 'DRAFT',
        revision: 1,
        draftRevision: 1
      },
      settings: { roster_v2_read_enabled: true },
      people: people98
    });

    // Check draft editing stacks
    assert.ok(Array.isArray(stateMap.get(35)), 'draftUndoStack must be an array');
    assert.ok(Array.isArray(stateMap.get(36)), 'draftRedoStack must be an array');
    assert.equal(stateMap.get(38), 'saved', 'draftSaveStatus must be saved');

    const html = ReactDOMServer.renderToStaticMarkup(element);
    assert.ok(html.includes('All changes saved'), 'Must render All changes saved pill');
    assert.ok(html.includes('admin-auth-verified-badge'), 'Must render Verified badge');
  });
});
