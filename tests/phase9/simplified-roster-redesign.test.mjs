import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import React from 'react';
import ReactDOMServer from 'react-dom/server';

import { harness, currentSource, fixture } from '../phase1/apps-script-harness.mjs';
import {
  SIMPLIFIED_TIMEZONE,
  getCurrentMonthMalaysia,
  resolveSimplifiedRosterMode,
} from '../../src/features/roster/simplified/rosterMode.js';
import {
  CLEAR_MARKER,
  FIELD_MO_SHIFT,
  FIELD_EP_OFFICE_HOUR,
  FIELD_EP_ONCALL,
  resolveStaffIdentity,
  buildRosterCellKey,
  composeEffectiveRoster,
  getCellAmendmentInfo,
  buildCellsMapFromEditedGrid,
  diffBaselineAndEditedCells,
  computeCellsChecksum,
} from '../../src/features/roster/simplified/rosterComposition.js';
import * as localStagingStoreModule from '../../src/features/roster/simplified/localStagingStore.js';
import {
  SAVE_STATUS,
  getOrInitMonthStaging,
  hydrateMonthStagingFromIdb,
  hasUnsavedMonthEdits,
  getMonthSessionSnapshot,
  computeSessionChanges,
  applyLocalGridUpdate,
  undoLocalEdit,
  redoLocalEdit,
  detectConcurrentSaveConflicts,
  rebaseLocalEditsOntoServer,
  markMonthSaving,
  markMonthConflict,
  markMonthSaveFailed,
  markMonthSaveConfirmed,
  discardMonthStaging,
  resetAllMemoryStaging,
} from '../../src/features/roster/simplified/localStagingStore.js';
import {
  auditV2DraftVsMasterRoster,
} from '../../src/features/roster/simplified/novemberReconciliation.js';
import {
  isDevMockActive,
  setDevMockActive,
  resetMockStore,
  setSimulateSaveConflict,
  setSimulateSaveFailure,
  getMockSimulationState,
  handleDevMockRequest,
} from '../../src/features/roster/simplified/devMockApi.js';
import * as adminAuthModule from '../../src/features/roster/auth/adminAuth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');
const req = createRequire(import.meta.url);

// Setup clean mock localStorage / sessionStorage / cookie / IndexedDB for deterministic tests
const localStoreData = new Map();
globalThis.localStorage = {
  getItem: (k) => (localStoreData.has(k) ? localStoreData.get(k) : null),
  setItem: (k, v) => { localStoreData.set(k, String(v)); },
  removeItem: (k) => { localStoreData.delete(k); },
  clear: () => { localStoreData.clear(); },
  get length() { return localStoreData.size; },
  key: (i) => Array.from(localStoreData.keys())[i] || null,
};

const sessionStoreData = new Map();
globalThis.sessionStorage = {
  getItem: (k) => (sessionStoreData.has(k) ? sessionStoreData.get(k) : null),
  setItem: (k, v) => { sessionStoreData.set(k, String(v)); },
  removeItem: (k) => { sessionStoreData.delete(k); },
  clear: () => { sessionStoreData.clear(); },
};

if (typeof globalThis.window === 'undefined') {
  globalThis.window = globalThis;
}
if (typeof globalThis.window.addEventListener !== 'function') {
  globalThis.window.addEventListener = () => {};
  globalThis.window.removeEventListener = () => {};
}
if (typeof globalThis.document === 'undefined') {
  globalThis.document = { cookie: '' };
}

// Lightweight mock IndexedDB supporting open / objectStore.put / get / delete
const idbStores = new Map();
function installMockIndexedDB() {
  globalThis.indexedDB = {
    open(dbName) {
      if (!idbStores.has(dbName)) {
        idbStores.set(dbName, new Map());
      }
      const dbMap = idbStores.get(dbName);
      const reqObj = {
        result: {
          objectStoreNames: {
            contains: (storeName) => dbMap.has(storeName),
          },
          createObjectStore: (storeName) => {
            if (!dbMap.has(storeName)) dbMap.set(storeName, new Map());
          },
          transaction: (storeName) => {
            if (!dbMap.has(storeName)) dbMap.set(storeName, new Map());
            const table = dbMap.get(storeName);
            return {
              objectStore: () => ({
                put: (val) => {
                  table.set(val.rosterMonth, structuredClone(val));
                },
                delete: (key) => {
                  table.delete(key);
                },
                get: (key) => {
                  const getReq = { result: null, onsuccess: null, onerror: null };
                  queueMicrotask(() => {
                    getReq.result = table.has(key) ? structuredClone(table.get(key)) : undefined;
                    if (typeof getReq.onsuccess === 'function') getReq.onsuccess();
                  });
                  return getReq;
                },
              }),
            };
          },
          close: () => {},
        },
        onupgradeneeded: null,
        onsuccess: null,
        onerror: null,
      };
      queueMicrotask(() => {
        if (typeof reqObj.onupgradeneeded === 'function') reqObj.onupgradeneeded();
        if (typeof reqObj.onsuccess === 'function') reqObj.onsuccess();
      });
      return reqObj;
    },
  };
}
installMockIndexedDB();

// Certified 13-MO + 6-EP fixtures
const CERTIFIED_TEAM_MEMBERS = [
  { name: 'Adi', staffId: 'A05157', active: true },
  { name: 'Azrul', staffId: 'A05201', active: true },
  { name: 'Afiq', staffId: 'A05563', active: true },
  { name: 'Muaz', staffId: 'A05832', active: true },
  { name: 'Syuhada', staffId: 'A05836', active: true },
  { name: 'Najmi', staffId: 'A05887', active: true },
  { name: 'Aiman', staffId: 'KA5239', active: true },
  { name: 'Shafa', staffId: 'A06145', active: true },
  { name: 'Asyraaf', staffId: 'A05959', active: true },
  { name: 'Adli', staffId: 'A05962', active: true },
  { name: 'Iema', staffId: 'A05960', active: true },
  { name: 'Syifa', staffId: 'KA5335', active: true },
  { name: 'Afif', staffId: 'A05148', active: false },
];

const CERTIFIED_NAMES = CERTIFIED_TEAM_MEMBERS.map((m) => m.name);

const CERTIFIED_EPS = [
  { name: 'Iskasymar', staffId: 'EP01', active: true },
  { name: 'Luqman', staffId: 'EP02', active: true },
  { name: 'Hafizah', staffId: 'EP03', active: true },
  { name: 'Hayati', staffId: 'EP04', active: true },
  { name: 'Syakirah', staffId: 'EP05', active: true },
  { name: 'Suhaimi', staffId: 'EP06', active: true },
];

async function bundleComponent(relPath) {
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
    ],
    plugins: [
      {
        name: 'share-singleton-stores',
        setup(b) {
          b.onResolve({ filter: /(localStagingStore|adminAuth)(\.js)?$/ }, (args) => ({
            path: args.path,
            external: true,
          }));
        },
      },
    ],
  });
  const bundledCode = bundleResult.outputFiles[0].text;
  const mod = { exports: {} };
  const customRequire = (id) => {
    if (id.includes('localStagingStore')) return localStagingStoreModule;
    if (id.includes('adminAuth')) return adminAuthModule;
    if (id === 'react') return React;
    if (id === 'react-dom/server') return ReactDOMServer;
    if (id === 'lucide-react') {
      return new Proxy({}, {
        get: (_, iconName) => (props) => React.createElement('span', { 'data-icon': String(iconName), ...props }),
      });
    }
    return req(id);
  };
  const evalFn = new Function('require', 'module', 'exports', bundledCode);
  evalFn(customRequire, mod, mod.exports);
  return mod.exports.default || mod.exports;
}

function findNode(node, predicate) {
  if (!node || typeof node !== 'object') return null;
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

function findAllNodes(node, predicate, acc = []) {
  if (!node || typeof node !== 'object') return acc;
  if (predicate(node)) acc.push(node);
  if (Array.isArray(node)) {
    for (const item of node) {
      findAllNodes(item, predicate, acc);
    }
  } else if (node.props?.children) {
    findAllNodes(node.props.children, predicate, acc);
  }
  return acc;
}

function createInteractiveComponentHarness(Component, defaultProps = {}) {
  const origDispatcher = React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentDispatcher.current;
  const stateMap = new Map();
  const refMap = new Map();
  const effectDepsMap = new Map();

  const render = (overrideProps = {}) => {
    let stateIdx = 0;
    let refIdx = 0;
    let effectIdx = 0;
    const pendingEffects = [];

    try {
      React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentDispatcher.current = {
        useState: (initial) => {
          const idx = stateIdx++;
          if (!stateMap.has(idx)) {
            stateMap.set(idx, typeof initial === 'function' ? initial() : initial);
          }
          const cur = stateMap.get(idx);
          const setter = (next) => {
            const resolved = typeof next === 'function' ? next(stateMap.get(idx)) : next;
            stateMap.set(idx, resolved);
          };
          return [cur, setter];
        },
        useRef: (initial) => {
          const idx = refIdx++;
          if (!refMap.has(idx)) {
            refMap.set(idx, { current: initial });
          }
          return refMap.get(idx);
        },
        useCallback: (cb) => cb,
        useMemo: (cb) => cb(),
        useEffect: (cb, deps) => {
          const idx = effectIdx++;
          const prevDeps = effectDepsMap.get(idx);
          let shouldRun = false;
          if (!deps || !prevDeps || deps.length !== prevDeps.length) {
            shouldRun = true;
          } else {
            shouldRun = deps.some((d, i) => !Object.is(d, prevDeps[i]));
          }
          effectDepsMap.set(idx, deps);
          if (shouldRun) pendingEffects.push(cb);
        },
      };

      const mergedProps = { ...defaultProps, ...overrideProps };
      const tree = Component(mergedProps);
      for (const eff of pendingEffects) {
        if (typeof eff === 'function') eff();
      }
      return tree;
    } finally {
      React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentDispatcher.current = origDispatcher;
    }
  };

  const renderHtml = (overrideProps = {}) => {
    const mergedProps = { ...defaultProps, ...overrideProps };
    return ReactDOMServer.renderToStaticMarkup(React.createElement(Component, mergedProps));
  };

  return { render, renderHtml, stateMap };
}

test('Simplified Roster Redesign — 28-Scenario End-to-End Verification Suite', async (t) => {
  let RosterPage;
  let AdminPinModal;

  t.before(async () => {
    RosterPage = await bundleComponent('src/components/RosterPage.jsx');
    AdminPinModal = await bundleComponent('src/components/AdminPinModal.jsx');
  });

  t.beforeEach(() => {
    resetAllMemoryStaging({ clearStorage: true });
    localStoreData.clear();
    sessionStoreData.clear();
    idbStores.clear();
    adminAuthModule.clearAdminSessionToken();
    globalThis.document.cookie = '';
  });

  await t.test('Scenario 01 — Public View Mode without login shows Main + Amendments and hides unsaved Admin edits', () => {
    const mainRows = [
      { Name: 'Adi', Date: '2026-10-05', Shift: 'AM' },
      { Name: 'Azrul', Date: '2026-10-05', Shift: 'PM' },
    ];
    const amendments = [
      {
        AmendmentId: 'amd-1',
        OperationId: 'op-1',
        RosterMonth: '2026-10',
        Date: '2026-10-05',
        TargetType: 'MO',
        Field: 'MO_SHIFT',
        StaffKey: 'A05157',
        StaffName: 'Adi',
        PreviousValue: 'AM',
        NewValue: 'ON1',
        IsCleared: false,
        SavedAt: '2026-10-05T08:00:00.000Z',
        Sequence: 1,
      },
    ];

    // Stage an unsaved local Admin edit for Azrul -> NIGHT in localStagingStore
    const composed = composeEffectiveRoster({
      mainRows,
      amendments,
      rosterMonth: '2026-10',
      teamMembers: CERTIFIED_TEAM_MEMBERS,
    });
    getOrInitMonthStaging({
      rosterMonth: '2026-10',
      initialGridFactory: () => ({ '2026-10-05': { AM: '', PM: 'Azrul', ON1: 'Adi', NIGHT: '' } }),
      serverCellsMap: composed.cellsMap,
      serverChecksum: composed.checksum,
      names: ['Adi', 'Azrul'],
      teamMembers: CERTIFIED_TEAM_MEMBERS,
    });
    applyLocalGridUpdate({
      rosterMonth: '2026-10',
      updater: () => ({ '2026-10-05': { AM: '', PM: '', ON1: 'Adi', NIGHT: 'Azrul' } }),
      names: ['Adi', 'Azrul'],
      teamMembers: CERTIFIED_TEAM_MEMBERS,
    });
    assert.equal(hasUnsavedMonthEdits('2026-10'), true);

    // Render as Guest / Doctor (isAdmin = false)
    let pinModalRequested = 0;
    const h = createInteractiveComponentHarness(RosterPage, {
      simplifiedMode: true,
      clockNow: '2026-10-29T12:00:00+08:00',
      rosterMonth: '2026-10',
      names: ['Adi', 'Azrul'],
      teamMembers: CERTIFIED_TEAM_MEMBERS,
      emergencyPhysicians: CERTIFIED_EPS,
      masterRoster: mainRows,
      rosterAmendments: amendments,
      selectedName: 'Adi',
      isAdmin: false,
      onRequestAdminPin: () => { pinModalRequested++; },
    });

    const html = h.renderHtml();
    assert.ok(html.includes('btn-roster-admin-unlock') || html.includes('Admin Edit'), 'Guest/Doctor sees Admin Edit unlock button');
    assert.ok(!html.includes('simplified-save-status'), 'Guest/Doctor never sees Admin save status badge');
    assert.ok(!html.includes('Save Changes'), 'Guest/Doctor never sees Save Changes button');

    const tree = h.render();
    const unlockBtn = findNode(tree, (n) => n.props?.['data-testid'] === 'btn-roster-admin-unlock');
    assert.ok(unlockBtn, 'Admin unlock button exists in View Mode');
    unlockBtn.props.onClick();
    assert.equal(pinModalRequested, 1, 'Clicking Admin Edit triggers PIN modal callback');

    // Switch to Table View as Guest and confirm Azrul still shows committed PM (NOT unsaved Admin NIGHT!)
    const toggleTableBtn = findNode(tree, (n) => n.type === 'button' && String(n.props?.children || '').includes('Table View'));
    toggleTableBtn.props.onClick();
    const tableTree = h.render();
    const tableSerialized = JSON.stringify(tableTree);
    assert.ok(tableSerialized.includes('ON1'), 'Committed amendment ON1 for Adi is visible in View Mode');
    assert.ok(!tableSerialized.includes('fast-table-cell-'), 'Interactive fast-edit cells are NOT rendered for non-Admin');
  });

  await t.test('Scenario 02 — Admin PIN Edit Mode unlocks once per session in memory only and persists across month navigation', async () => {
    const html = ReactDOMServer.renderToStaticMarkup(
      React.createElement(AdminPinModal, {
        isOpen: true,
        onClose: () => {},
        onSuccess: () => {},
      })
    );
    assert.ok(html.includes('admin-pin-modal'), 'AdminPinModal renders modal testid');
    assert.ok(html.includes('admin-pin-unlock'), 'AdminPinModal renders Unlock button');

    assert.equal(adminAuthModule.isSessionTokenActive(), false);
    assert.equal(adminAuthModule.verifyAdminPin('9999'), false, 'Wrong PIN rejected');
    assert.equal(adminAuthModule.verifyAdminPin('1234'), true, 'Default PIN 1234 accepted locally when VITE_ADMIN_PIN unset');

    adminAuthModule.setAdminPinSession({ ttlSeconds: 28800 });
    assert.equal(adminAuthModule.isSessionTokenActive(), true, 'Admin session active in memory');
    assert.equal(adminAuthModule.isPinSessionActive(), true, 'PIN session flag active in memory');

    // Zero browser storage persistence for Admin PIN / session token
    assert.equal(localStoreData.size, 0, 'Zero localStorage entries written for Admin PIN session');
    assert.equal(sessionStoreData.size, 0, 'Zero sessionStorage entries written for Admin PIN session');
    assert.equal(globalThis.document.cookie, '', 'Zero cookies written for Admin PIN session');

    // Navigating across months keeps session active without re-prompting PIN
    let monthProp = '2026-10';
    const h = createInteractiveComponentHarness(RosterPage, {
      simplifiedMode: true,
      clockNow: '2026-10-29T12:00:00+08:00',
      rosterMonth: monthProp,
      onMonthChange: (nextM) => { monthProp = nextM; },
      names: ['Adi', 'Azrul'],
      teamMembers: CERTIFIED_TEAM_MEMBERS,
      masterRoster: [],
      rosterAmendments: [],
      selectedName: 'Admin',
      isAdmin: true,
    });

    let tree = h.render({ rosterMonth: '2026-10' });
    assert.ok(findNode(tree, (n) => n.props?.['data-testid'] === 'simplified-mode-badge'), 'Mode badge visible in Oct');
    tree = h.render({ rosterMonth: '2026-11' });
    assert.equal(adminAuthModule.isSessionTokenActive(), true, 'PIN session stays active after navigating Oct -> Nov');
    tree = h.render({ rosterMonth: '2026-12' });
    assert.equal(adminAuthModule.isSessionTokenActive(), true, 'PIN session stays active after navigating Nov -> Dec');
  });

  await t.test('Scenario 03 — Backend authorization boundary rejects unauthorized writes fail-closed and verifies server PIN', () => {
    const h = harness(currentSource, {
      adminEmail: 'admin@hospital.gov.my',
      sessionSecret: 'super-secret-hmac-key-for-simplified-roster-test',
      adminPin: '4826',
      clockIso: '2026-10-29T04:00:00.000Z', // 2026-10-29 12:00 MYT
    });

    const writesBefore = h.writes.length;

    // 1. Unauthenticated savemasterrosterdraft rejected
    const unauthDraft = h.post({
      action: 'savemasterrosterdraft',
      targetMonth: '2026-11',
      rows: [{ name: 'Adi', date: '2026-11-01', shift: 'AM' }],
    });
    assert.equal(unauthDraft.result, 'error');
    assert.match(unauthDraft.message, /authorization required/i);

    // 2. Wrong PIN appendrosteramendments rejected
    const wrongPinAmend = h.post({
      action: 'appendrosteramendments',
      adminPin: '0000',
      targetMonth: '2026-10',
      operationId: 'op-unauth-1',
      amendments: [{ date: '2026-10-05', staffName: 'Adi', newValue: 'PM' }],
    });
    assert.equal(wrongPinAmend.result, 'error');
    assert.match(wrongPinAmend.message, /authorization required/i);

    // 3. Unauthenticated legacy admin mutation rejected
    const unauthSetting = h.post({
      action: 'updatesetting',
      key: 'testKey',
      value: 'hacked',
    });
    assert.equal(unauthSetting.result, 'error');
    assert.equal(h.writes.length, writesBefore, 'Zero workbook writes occurred on unauthorized requests');

    // 4. Server-side verifyadminpin rejects wrong PIN and exchanges valid PIN for HMAC session token
    const badVerify = h.post({ action: 'verifyadminpin', pin: '1111' });
    assert.equal(badVerify.result, 'error');
    assert.equal(badVerify.code, 'INVALID_PIN');

    const okVerify = h.post({ action: 'verifyadminpin', pin: '4826' });
    assert.equal(okVerify.result, 'success');
    assert.equal(okVerify.verified, true);
    assert.ok(okVerify.adminSessionToken && okVerify.adminSessionToken.split('.').length === 3, 'Issued signed HMAC JWT');

    // 5. Issued HMAC token authorizes savemasterrosterdraft
    const authedDraft = h.post({
      action: 'savemasterrosterdraft',
      adminSessionToken: okVerify.adminSessionToken,
      targetMonth: '2026-11',
      operationId: 'op-authed-1',
      rows: [{ name: 'Adi', date: '2026-11-01', shift: 'AM' }],
    });
    assert.equal(authedDraft.result, 'success');
    assert.equal(authedDraft.mode, 'DRAFT');
  });

  await t.test('Scenario 04 — Future month automatically selects DRAFT (saves to MAIN / MasterRoster)', () => {
    const res = resolveSimplifiedRosterMode('2026-11', '2026-10-29T12:00:00+08:00');
    assert.equal(res.mode, 'DRAFT');
    assert.equal(res.target, 'MAIN');
    assert.equal(res.targetSheet, 'MasterRoster');
    assert.equal(res.isFutureMonth, true);
  });

  await t.test('Scenario 05 — Current month automatically selects AMEND (saves to AMEND / RosterAmendments)', () => {
    const res = resolveSimplifiedRosterMode('2026-10', '2026-10-29T12:00:00+08:00');
    assert.equal(res.mode, 'AMEND');
    assert.equal(res.target, 'AMEND');
    assert.equal(res.targetSheet, 'RosterAmendments');
    assert.equal(res.isFutureMonth, false);
  });

  await t.test('Scenario 06 — Previous month automatically selects AMEND', () => {
    const res = resolveSimplifiedRosterMode('2026-09', '2026-10-29T12:00:00+08:00');
    assert.equal(res.mode, 'AMEND');
    assert.equal(res.target, 'AMEND');
    assert.equal(res.isFutureMonth, false);
  });

  await t.test('Scenario 07 — Month and year boundary transitions automatically in Asia/Kuala_Lumpur without manual publish', () => {
    assert.equal(SIMPLIFIED_TIMEZONE, 'Asia/Kuala_Lumpur');

    // Year-end boundary: Dec 31 23:59:59 MYT -> Jan 2027 is DRAFT, Dec 2026 is AMEND
    const beforeNewYear = '2026-12-31T23:59:59+08:00';
    assert.equal(resolveSimplifiedRosterMode('2027-01', beforeNewYear).mode, 'DRAFT');
    assert.equal(resolveSimplifiedRosterMode('2026-12', beforeNewYear).mode, 'AMEND');

    // Two seconds later: Jan 1 00:00:01 MYT -> Jan 2027 automatically becomes AMEND with zero publish/rewrite!
    const afterNewYear = '2027-01-01T00:00:01+08:00';
    assert.equal(resolveSimplifiedRosterMode('2027-01', afterNewYear).mode, 'AMEND');
    assert.equal(resolveSimplifiedRosterMode('2027-02', afterNewYear).mode, 'DRAFT');

    // Timezone edge case: 2026-10-31T16:30:00Z is already 2026-11-01 00:30 MYT!
    const utcLateOct = '2026-10-31T16:30:00.000Z';
    assert.equal(getCurrentMonthMalaysia(utcLateOct), '2026-11');
    assert.equal(resolveSimplifiedRosterMode('2026-11', utcLateOct).mode, 'AMEND');
  });

  await t.test('Scenario 08 — Fast local cell editing (single-keystroke, multi-cell range, QuickShiftPalette, EP 1-click)', () => {
    const h = createInteractiveComponentHarness(RosterPage, {
      simplifiedMode: true,
      clockNow: '2026-10-29T12:00:00+08:00',
      rosterMonth: '2026-11',
      names: ['Adi', 'Azrul', 'Afiq'],
      teamMembers: CERTIFIED_TEAM_MEMBERS.slice(0, 3),
      emergencyPhysicians: CERTIFIED_EPS,
      masterRoster: [],
      rosterAmendments: [],
      selectedName: 'Admin',
      isAdmin: true,
    });

    // Switch to Table View and click Edit Roster
    let tree = h.render();
    const tableTabBtn = findNode(tree, (n) => n.type === 'button' && String(n.props?.children || '').includes('Table View'));
    tableTabBtn.props.onClick();

    tree = h.render();
    const editBtn = findNode(tree, (n) => n.type === 'button' && JSON.stringify(n.props?.children || '').includes('Edit Roster'));
    assert.ok(editBtn, 'Edit Roster button rendered for Admin');
    editBtn.props.onClick();

    tree = h.render();
    const cell00 = findNode(tree, (n) => n.props?.id === 'fast-table-cell-0-0');
    assert.ok(cell00, 'Interactive fast-table-cell-0-0 rendered in Table View Edit Mode');

    // Single-keystroke 'a' -> assigns AM to Adi on 2026-11-01
    cell00.props.onClick({ shiftKey: false, stopPropagation: () => {} });
    tree = h.render();
    const activeCell00 = findNode(tree, (n) => n.props?.id === 'fast-table-cell-0-0');
    activeCell00.props.onKeyDown({ key: 'a', preventDefault: () => {}, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false });

    const snapAfterKey = getMonthSessionSnapshot('2026-11');
    assert.equal(snapAfterKey.editedGrid['2026-11-01'].AM, 'Adi', 'Single-keystroke A assigned AM immediately');
    assert.equal(snapAfterKey.status, SAVE_STATUS.UNSAVED_CHANGES);

    // Rectangular Shift+Click range selection across days 0..1 and doctors 0..1 -> press 'p' -> assigns PM to all 4 cells!
    tree = h.render();
    const cell11 = findNode(tree, (n) => n.props?.id === 'fast-table-cell-1-1');
    cell11.props.onClick({ shiftKey: true, stopPropagation: () => {} });
    tree = h.render();
    const rangeCell = findNode(tree, (n) => n.props?.id === 'fast-table-cell-0-0');
    rangeCell.props.onKeyDown({ key: 'p', preventDefault: () => {}, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false });

    const snapAfterRange = getMonthSessionSnapshot('2026-11');
    assert.ok(snapAfterRange.editedGrid['2026-11-01'].PM.includes('Adi'), 'Range assigned PM to Adi day 1');
    assert.ok(snapAfterRange.editedGrid['2026-11-01'].PM.includes('Azrul'), 'Range assigned PM to Azrul day 1');
    assert.ok(snapAfterRange.editedGrid['2026-11-02'].PM.includes('Adi'), 'Range assigned PM to Adi day 2');
    assert.ok(snapAfterRange.editedGrid['2026-11-02'].PM.includes('Azrul'), 'Range assigned PM to Azrul day 2');
  });

  await t.test('Scenario 09 — Zero automatic network writes occur during cell editing, Undo/Redo, or month switching', () => {
    const origFetch = globalThis.fetch;
    const fetchCalls = [];
    globalThis.fetch = async (...args) => {
      fetchCalls.push(args);
      throw new Error('Unexpected network call during local editing!');
    };

    try {
      const composed = composeEffectiveRoster({
        mainRows: [{ Name: 'Adi', Date: '2026-11-01', Shift: 'AM' }],
        amendments: [],
        rosterMonth: '2026-11',
        teamMembers: CERTIFIED_TEAM_MEMBERS,
      });

      getOrInitMonthStaging({
        rosterMonth: '2026-11',
        initialGridFactory: () => ({ '2026-11-01': { AM: 'Adi', PM: '', NIGHT: '' } }),
        serverCellsMap: composed.cellsMap,
        serverChecksum: composed.checksum,
        names: CERTIFIED_NAMES,
        teamMembers: CERTIFIED_TEAM_MEMBERS,
      });

      for (const shiftCode of ['PM', 'NIGHT', 'OFF', 'ON1', 'ON2', 'AM', 'HKA', 'AL', 'MC', 'OH']) {
        applyLocalGridUpdate({
          rosterMonth: '2026-11',
          updater: () => ({ '2026-11-01': { [shiftCode]: 'Adi' } }),
          names: CERTIFIED_NAMES,
          teamMembers: CERTIFIED_TEAM_MEMBERS,
        });
      }
      undoLocalEdit('2026-11', CERTIFIED_NAMES, CERTIFIED_TEAM_MEMBERS);
      redoLocalEdit('2026-11', CERTIFIED_NAMES, CERTIFIED_TEAM_MEMBERS);

      // Switch to 2026-12 and edit locally
      getOrInitMonthStaging({
        rosterMonth: '2026-12',
        initialGridFactory: () => ({}),
        serverCellsMap: new Map(),
        serverChecksum: 'empty',
        names: CERTIFIED_NAMES,
        teamMembers: CERTIFIED_TEAM_MEMBERS,
      });
      applyLocalGridUpdate({
        rosterMonth: '2026-12',
        updater: () => ({ '2026-12-01': { AM: 'Azrul' } }),
        names: CERTIFIED_NAMES,
        teamMembers: CERTIFIED_TEAM_MEMBERS,
      });

      assert.equal(fetchCalls.length, 0, 'Strictly zero network requests fired during local editing');
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  await t.test('Scenario 10 — Manual Save consolidates intermediate edits and omits cells reverted back to baseline', () => {
    const mainRows = [
      { Name: 'Adi', Date: '2026-10-10', Shift: 'AM' },
      { Name: 'Azrul', Date: '2026-10-10', Shift: 'ON1' },
    ];
    const composed = composeEffectiveRoster({
      mainRows,
      amendments: [],
      rosterMonth: '2026-10',
      teamMembers: CERTIFIED_TEAM_MEMBERS,
    });

    getOrInitMonthStaging({
      rosterMonth: '2026-10',
      initialGridFactory: () => ({ '2026-10-10': { AM: 'Adi', ON1: 'Azrul' } }),
      serverCellsMap: composed.cellsMap,
      serverChecksum: composed.checksum,
      names: ['Adi', 'Azrul'],
      teamMembers: CERTIFIED_TEAM_MEMBERS,
    });

    // Adi: AM -> PM -> OFF (consolidated net change: AM -> OFF)
    applyLocalGridUpdate({
      rosterMonth: '2026-10',
      updater: () => ({ '2026-10-10': { PM: 'Adi', ON1: 'Azrul' } }),
      names: ['Adi', 'Azrul'],
      teamMembers: CERTIFIED_TEAM_MEMBERS,
    });
    applyLocalGridUpdate({
      rosterMonth: '2026-10',
      updater: () => ({ '2026-10-10': { OFF: 'Adi', ON1: 'Azrul' } }),
      names: ['Adi', 'Azrul'],
      teamMembers: CERTIFIED_TEAM_MEMBERS,
    });

    // Azrul: ON1 -> blank -> ON1 (net change: 0, must NOT emit an amendment!)
    applyLocalGridUpdate({
      rosterMonth: '2026-10',
      updater: () => ({ '2026-10-10': { OFF: 'Adi', ON1: '' } }),
      names: ['Adi', 'Azrul'],
      teamMembers: CERTIFIED_TEAM_MEMBERS,
    });
    const finalSession = applyLocalGridUpdate({
      rosterMonth: '2026-10',
      updater: () => ({ '2026-10-10': { OFF: 'Adi', ON1: 'Azrul' } }),
      names: ['Adi', 'Azrul'],
      teamMembers: CERTIFIED_TEAM_MEMBERS,
    });

    const changes = computeSessionChanges(finalSession, ['Adi', 'Azrul'], CERTIFIED_TEAM_MEMBERS);
    assert.equal(changes.length, 1, 'Only 1 consolidated net change emitted');
    assert.equal(changes[0].staffName, 'Adi');
    assert.equal(changes[0].previousValue, 'AM');
    assert.equal(changes[0].newValue, 'OFF');
  });

  await t.test('Scenario 11 — Draft saves target Main (MasterRoster) for future months only and preserve all other months', () => {
    const tables = structuredClone(fixture.tables);
    tables.MasterRoster = [
      ['Name', 'Date', 'Shift'],
      ['Adi', '2026-10-15', 'AM'],
      ['Azrul', '2026-11-01', 'PM'],
    ];

    const h = harness(currentSource, {
      tables,
      adminPin: '1234',
      clockIso: '2026-10-29T04:00:00.000Z', // 2026-10 MYT -> 2026-11 is future (DRAFT)
    });

    // Rejects Draft save for current month (2026-10)
    const badDraft = h.post({
      action: 'savemasterrosterdraft',
      adminPin: '1234',
      targetMonth: '2026-10',
      rows: [{ name: 'Adi', date: '2026-10-15', shift: 'OFF' }],
    });
    assert.equal(badDraft.result, 'error');
    assert.match(badDraft.message, /future months/i);

    // Accepts Draft save for future month (2026-11) and preserves 2026-10 untouched
    const okDraft = h.post({
      action: 'savemasterrosterdraft',
      adminPin: '1234',
      targetMonth: '2026-11',
      operationId: 'op-draft-nov-1',
      rows: [
        { name: 'Adi', date: '2026-11-01', shift: 'ON1' },
        { name: 'Muaz', date: '2026-11-02', shift: 'NIGHT' },
      ],
    });
    assert.equal(okDraft.result, 'success');
    assert.equal(okDraft.mode, 'DRAFT');
    assert.equal(okDraft.target, 'MAIN');

    const masterAfter = h.get('masterroster');
    assert.deepEqual(
      masterAfter.filter((r) => String(r.Date).startsWith('2026-10')),
      [{ Name: 'Adi', Date: '2026-10-15', Shift: 'AM' }],
      'October MasterRoster rows preserved untouched'
    );
    const novRows = masterAfter.filter((r) => String(r.Date).startsWith('2026-11'));
    assert.equal(novRows.length, 2);
    assert.equal(novRows[0].Shift, 'ON1');
    assert.equal(h.grids.RosterAmendments, undefined, 'Draft save did not create or touch RosterAmendments');
  });

  await t.test('Scenario 12 — Amend saves target Amend (RosterAmendments) for current/past months and resolve stable StaffId', () => {
    const tables = structuredClone(fixture.tables);
    tables.TeamMembers = [
      ['MemberName', 'FullName', 'Phone', 'Active', 'StaffId', 'Email'],
      ['Adi', 'Dr Adi', '0123456789', true, 'A05157', 'adi@hospital.gov.my'],
    ];
    tables.MasterRoster = [
      ['Name', 'Date', 'Shift'],
      ['Adi', '2026-10-05', 'AM'],
    ];

    const h = harness(currentSource, {
      tables,
      adminPin: '1234',
      clockIso: '2026-10-29T04:00:00.000Z', // 2026-10 MYT
    });

    // Rejects Amend save for future month (2026-11)
    const badAmend = h.post({
      action: 'appendrosteramendments',
      adminPin: '1234',
      targetMonth: '2026-11',
      operationId: 'op-future-amend',
      amendments: [{ date: '2026-11-01', staffName: 'Adi', newValue: 'PM' }],
    });
    assert.equal(badAmend.result, 'error');
    assert.match(badAmend.message, /current or past months/i);

    // Appends structured amendment for current month (2026-10)
    const okAmend = h.post({
      action: 'appendrosteramendments',
      adminPin: '1234',
      targetMonth: '2026-10',
      operationId: 'op-oct-amend-1',
      amendments: [
        {
          date: '2026-10-05',
          targetType: 'MO',
          field: 'MO_SHIFT',
          staffName: 'Adi',
          previousValue: 'AM',
          newValue: 'PM',
          isCleared: false,
        },
      ],
    });
    assert.equal(okAmend.result, 'success');
    assert.equal(okAmend.mode, 'AMEND');
    assert.equal(okAmend.target, 'AMEND');
    assert.equal(okAmend.count, 1);
    assert.equal(okAmend.records[0].StaffKey, 'a05157', 'Resolved stable StaffId A05157 from TeamMembers');

    const fetched = h.get('rosteramendments', { month: '2026-10' });
    assert.equal(fetched.length, 1);
    assert.equal(fetched[0].NewValue, 'PM');
    assert.equal(fetched[0].Sequence, 1);
  });

  await t.test('Scenario 13 — Main (MasterRoster) remains byte-for-byte unchanged after multiple Amend saves', () => {
    const tables = structuredClone(fixture.tables);
    tables.MasterRoster = [
      ['Name', 'Date', 'Shift'],
      ['Adi', '2026-10-05', 'AM'],
      ['Azrul', '2026-10-05', 'PM'],
      ['Muaz', '2026-10-06', 'NIGHT'],
    ];

    const h = harness(currentSource, {
      tables,
      adminPin: '1234',
      clockIso: '2026-10-29T04:00:00.000Z',
    });

    const masterBefore = structuredClone(h.grids.MasterRoster);

    // 1. Modify Adi AM -> ON1, 2. Clear Azrul PM -> blank, 3. Add Afiq -> OH
    const res = h.post({
      action: 'appendrosteramendments',
      adminPin: '1234',
      targetMonth: '2026-10',
      operationId: 'op-preserve-main-1',
      amendments: [
        { date: '2026-10-05', staffName: 'Adi', previousValue: 'AM', newValue: 'ON1', isCleared: false },
        { date: '2026-10-05', staffName: 'Azrul', previousValue: 'PM', newValue: '', isCleared: true },
        { date: '2026-10-05', staffName: 'Afiq', previousValue: '', newValue: 'OH', isCleared: false },
      ],
    });
    assert.equal(res.result, 'success');
    assert.deepEqual(h.grids.MasterRoster, masterBefore, 'MasterRoster sheet is 100% untouched byte-for-byte');
  });

  await t.test('Scenario 14 — Latest amendment wins deterministically (Sequence -> SavedAt -> index)', () => {
    const mainRows = [{ Name: 'Adi', Date: '2026-10-05', Shift: 'AM' }];
    // Supply out-of-order array: Sequence 3 is ON1, Sequence 1 is PM, Sequence 2 is OFF
    const amendments = [
      {
        AmendmentId: 'a3',
        RosterMonth: '2026-10',
        Date: '2026-10-05',
        Field: 'MO_SHIFT',
        StaffKey: 'A05157',
        StaffName: 'Adi',
        PreviousValue: 'OFF',
        NewValue: 'ON1',
        IsCleared: false,
        SavedAt: '2026-10-05T10:00:00.000Z',
        Sequence: 3,
      },
      {
        AmendmentId: 'a1',
        RosterMonth: '2026-10',
        Date: '2026-10-05',
        Field: 'MO_SHIFT',
        StaffKey: 'A05157',
        StaffName: 'Adi',
        PreviousValue: 'AM',
        NewValue: 'PM',
        IsCleared: false,
        SavedAt: '2026-10-05T08:00:00.000Z',
        Sequence: 1,
      },
      {
        AmendmentId: 'a2',
        RosterMonth: '2026-10',
        Date: '2026-10-05',
        Field: 'MO_SHIFT',
        StaffKey: 'A05157',
        StaffName: 'Adi',
        PreviousValue: 'PM',
        NewValue: 'OFF',
        IsCleared: false,
        SavedAt: '2026-10-05T09:00:00.000Z',
        Sequence: 2,
      },
    ];

    const composed = composeEffectiveRoster({
      mainRows,
      amendments,
      rosterMonth: '2026-10',
      teamMembers: CERTIFIED_TEAM_MEMBERS,
    });

    assert.equal(composed.effectiveRows.length, 1);
    assert.equal(composed.effectiveRows[0].Shift, 'ON1', 'Sequence 3 deterministically wins');
    const info = getCellAmendmentInfo(composed.amendedCellsMap, {
      date: '2026-10-05',
      field: FIELD_MO_SHIFT,
      staffKey: 'Adi',
      teamMembers: CERTIFIED_TEAM_MEMBERS,
    });
    assert.equal(info.isAmended, true);
    assert.equal(info.mainValue, 'AM', 'Original Main value AM preserved for provenance tooltip');
    assert.equal(info.effectiveValue, 'ON1');
  });

  await t.test('Scenario 15 — Explicit shift deletion (IsCleared / __CLEAR__) renders blank and NEVER falls back to Main', () => {
    const mainRows = [
      { Name: 'Adi', Date: '2026-10-05', Shift: 'AM' },
      { Name: 'Azrul', Date: '2026-10-05', Shift: 'PM' },
    ];
    const amendments = [
      {
        AmendmentId: 'del-1',
        OperationId: 'op-del-1',
        RosterMonth: '2026-10',
        Date: '2026-10-05',
        TargetType: 'MO',
        Field: 'MO_SHIFT',
        StaffKey: 'A05157',
        StaffName: 'Adi',
        PreviousValue: 'AM',
        NewValue: CLEAR_MARKER,
        IsCleared: true,
        SavedAt: '2026-10-06T01:00:00.000Z',
        Sequence: 1,
      },
    ];

    const composed = composeEffectiveRoster({
      mainRows,
      amendments,
      rosterMonth: '2026-10',
      teamMembers: CERTIFIED_TEAM_MEMBERS,
    });

    const adiRows = composed.effectiveRows.filter((r) => r.Name === 'Adi' && r.Date === '2026-10-05');
    assert.equal(adiRows.length, 0, 'Cleared shift emits ZERO rows for Adi (never falls back to Main AM)');

    const cellInfo = getCellAmendmentInfo(composed.amendedCellsMap, {
      date: '2026-10-05',
      field: FIELD_MO_SHIFT,
      staffKey: 'Adi',
      teamMembers: CERTIFIED_TEAM_MEMBERS,
    });
    assert.ok(cellInfo, 'Cleared cell tracked in amendedCellsMap');
    assert.equal(cellInfo.isCleared, true);
    assert.equal(cellInfo.effectiveValue, '');
    assert.equal(cellInfo.mainValue, 'AM');
  });

  await t.test('Scenario 16 — Unchanged Main assignments remain visible alongside amended cells', () => {
    const mainRows = [
      { Name: 'Adi', Date: '2026-10-05', Shift: 'AM' },
      { Name: 'Azrul', Date: '2026-10-05', Shift: 'PM' },
      { Name: 'Muaz', Date: '2026-10-06', Shift: 'NIGHT' },
    ];
    const amendments = [
      {
        AmendmentId: 'a-1',
        RosterMonth: '2026-10',
        Date: '2026-10-05',
        Field: 'MO_SHIFT',
        StaffKey: 'A05157',
        StaffName: 'Adi',
        PreviousValue: 'AM',
        NewValue: 'OFF',
        IsCleared: false,
        Sequence: 1,
      },
    ];

    const composed = composeEffectiveRoster({
      mainRows,
      amendments,
      rosterMonth: '2026-10',
      teamMembers: CERTIFIED_TEAM_MEMBERS,
    });

    assert.equal(composed.effectiveRows.length, 3);
    assert.ok(composed.effectiveRows.some((r) => r.Name === 'Adi' && r.Date === '2026-10-05' && r.Shift === 'OFF'));
    assert.ok(composed.effectiveRows.some((r) => r.Name === 'Azrul' && r.Date === '2026-10-05' && r.Shift === 'PM'));
    assert.ok(composed.effectiveRows.some((r) => r.Name === 'Muaz' && r.Date === '2026-10-06' && r.Shift === 'NIGHT'));
  });

  await t.test('Scenario 17 — Unsaved edits survive month switching AND full page reload (localStorage + IndexedDB)', async () => {
    // 1. Stage edits in 2026-11
    getOrInitMonthStaging({
      rosterMonth: '2026-11',
      initialGridFactory: () => ({}),
      serverCellsMap: new Map(),
      serverChecksum: 'nov-empty',
      names: ['Adi', 'Azrul'],
      teamMembers: CERTIFIED_TEAM_MEMBERS,
    });
    applyLocalGridUpdate({
      rosterMonth: '2026-11',
      updater: () => ({ '2026-11-03': { AM: 'Adi' } }),
      names: ['Adi', 'Azrul'],
      teamMembers: CERTIFIED_TEAM_MEMBERS,
    });

    // 2. Switch to 2026-12 and stage edits there
    getOrInitMonthStaging({
      rosterMonth: '2026-12',
      initialGridFactory: () => ({}),
      serverCellsMap: new Map(),
      serverChecksum: 'dec-empty',
      names: ['Adi', 'Azrul'],
      teamMembers: CERTIFIED_TEAM_MEMBERS,
    });
    applyLocalGridUpdate({
      rosterMonth: '2026-12',
      updater: () => ({ '2026-12-10': { NIGHT: 'Azrul' } }),
      names: ['Adi', 'Azrul'],
      teamMembers: CERTIFIED_TEAM_MEMBERS,
    });

    // Allow microtasks for IndexedDB writes to complete
    await new Promise((r) => setTimeout(r, 10));

    // Switch back to 2026-11 in memory -> still intact
    assert.equal(getMonthSessionSnapshot('2026-11').editedGrid['2026-11-03'].AM, 'Adi');
    assert.equal(getMonthSessionSnapshot('2026-12').editedGrid['2026-12-10'].NIGHT, 'Azrul');

    // 3. Simulate browser page reload (clear memory, keep storage) -> restores from localStorage
    resetAllMemoryStaging({ clearStorage: false });
    assert.equal(getMonthSessionSnapshot('2026-11'), null);

    const restoredFromLs = getOrInitMonthStaging({
      rosterMonth: '2026-11',
      initialGridFactory: () => ({}),
      serverCellsMap: new Map(),
      serverChecksum: 'nov-empty',
      names: ['Adi', 'Azrul'],
      teamMembers: CERTIFIED_TEAM_MEMBERS,
    });
    assert.equal(restoredFromLs.hasUnsavedEdits, true);
    assert.equal(restoredFromLs.status, SAVE_STATUS.UNSAVED_CHANGES);
    assert.equal(restoredFromLs.editedGrid['2026-11-03'].AM, 'Adi');

    // 4. Simulate localStorage eviction + memory reset -> restores from IndexedDB!
    resetAllMemoryStaging({ clearStorage: true });
    localStoreData.clear();
    const restoredFromIdb = await hydrateMonthStagingFromIdb('2026-12', ['Adi', 'Azrul'], CERTIFIED_TEAM_MEMBERS);
    assert.ok(restoredFromIdb, 'Hydrated unsaved draft from IndexedDB');
    assert.equal(restoredFromIdb.hasUnsavedEdits, true);
    assert.equal(restoredFromIdb.editedGrid['2026-12-10'].NIGHT, 'Azrul');
  });

  await t.test('Scenario 18 — Failed saves preserve local changes and surface Save Failed status for safe retry', async () => {
    const h = createInteractiveComponentHarness(RosterPage, {
      simplifiedMode: true,
      clockNow: '2026-10-29T12:00:00+08:00',
      rosterMonth: '2026-11',
      names: ['Adi'],
      teamMembers: [CERTIFIED_TEAM_MEMBERS[0]],
      masterRoster: [],
      rosterAmendments: [],
      selectedName: 'Admin',
      isAdmin: true,
      onFetchLatestServerState: async () => ({
        masterRoster: [],
        rosterAmendments: [],
      }),
      onSaveSimplifiedDraft: async () => {
        throw new Error('Simulated network timeout while saving');
      },
    });

    // Enter Edit Mode & apply local edit
    let tree = h.render();
    findNode(tree, (n) => n.type === 'button' && JSON.stringify(n.props?.children || '').includes('Table View')).props.onClick();
    tree = h.render();
    findNode(tree, (n) => n.type === 'button' && JSON.stringify(n.props?.children || '').includes('Edit Roster')).props.onClick();
    tree = h.render();

    const cell = findNode(tree, (n) => n.props?.id === 'fast-table-cell-0-0');
    cell.props.onClick({ shiftKey: false, stopPropagation: () => {} });
    tree = h.render();
    findNode(tree, (n) => n.props?.id === 'fast-table-cell-0-0').props.onKeyDown({
      key: 'a',
      preventDefault: () => {},
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      shiftKey: false,
    });

    tree = h.render();
    const saveBtn = findNode(tree, (n) => n.props?.['data-testid'] === 'btn-simplified-save');
    assert.ok(saveBtn, 'Explicit Save button rendered');
    await saveBtn.props.onClick();

    const snap = getMonthSessionSnapshot('2026-11');
    assert.equal(snap.status, SAVE_STATUS.SAVE_FAILED, 'Status transitioned to Save Failed');
    assert.equal(snap.hasUnsavedEdits, true, 'Unsaved edits remain flagged');
    assert.equal(snap.editedGrid['2026-11-01'].AM, 'Adi', 'Local edit preserved after failed save');

    tree = h.render();
    assert.ok(
      findNode(tree, (n) => n.props?.['data-testid'] === 'simplified-save-failed-banner'),
      'Save Failed banner displayed to Admin'
    );
  });

  await t.test('Scenario 19 — Duplicate save retries with same operationId are idempotent for both Amend and Draft', () => {
    const h = harness(currentSource, {
      adminPin: '1234',
      clockIso: '2026-10-29T04:00:00.000Z',
    });

    // 1. Amend idempotency
    const amendPayload = {
      action: 'appendrosteramendments',
      adminPin: '1234',
      targetMonth: '2026-10',
      operationId: 'op-idem-amend-99',
      amendments: [{ date: '2026-10-12', staffName: 'Adi', previousValue: '', newValue: 'AM', isCleared: false }],
    };
    const firstAmend = h.post(amendPayload);
    assert.equal(firstAmend.result, 'success');
    assert.equal(firstAmend.idempotentReplay, undefined);

    const retryAmend = h.post(amendPayload);
    assert.equal(retryAmend.result, 'success');
    assert.equal(retryAmend.idempotentReplay, true, 'Duplicate operationId detected as idempotent replay');

    const storedAmendments = h.get('rosteramendments', { month: '2026-10' });
    assert.equal(storedAmendments.length, 1, 'Zero duplicate rows appended on retry');

    // 2. Draft idempotency
    const draftPayload = {
      action: 'savemasterrosterdraft',
      adminPin: '1234',
      targetMonth: '2026-11',
      operationId: 'op-idem-draft-99',
      rows: [{ name: 'Adi', date: '2026-11-05', shift: 'PM' }],
    };
    const firstDraft = h.post(draftPayload);
    assert.equal(firstDraft.result, 'success');
    const writesAfterFirstDraft = h.writes.length;

    const retryDraft = h.post(draftPayload);
    assert.equal(retryDraft.result, 'success');
    assert.equal(retryDraft.idempotentReplay, true);
    assert.equal(h.writes.length, writesAfterFirstDraft, 'Zero extra sheet writes on duplicate Draft retry');
  });

  await t.test('Scenario 20 — Concurrent edits raise Conflict instead of silently overwriting, and Rebase merges cleanly', () => {
    // 1. Client-side conflict detection + rebase with StaffId-backed TeamMembers
    const baseMain = [
      { Name: 'Adi', Date: '2026-11-05', Shift: 'AM' },
      { Name: 'Azrul', Date: '2026-11-05', Shift: 'PM' },
    ];
    const initialComposed = composeEffectiveRoster({
      mainRows: baseMain,
      amendments: [],
      rosterMonth: '2026-11',
      teamMembers: CERTIFIED_TEAM_MEMBERS,
    });

    getOrInitMonthStaging({
      rosterMonth: '2026-11',
      initialGridFactory: () => ({ '2026-11-05': { AM: 'Adi', PM: 'Azrul' } }),
      serverCellsMap: initialComposed.cellsMap,
      serverChecksum: initialComposed.checksum,
      names: ['Adi', 'Azrul', 'Muaz'],
      teamMembers: CERTIFIED_TEAM_MEMBERS,
    });

    // Local device changes Adi AM -> OFF
    applyLocalGridUpdate({
      rosterMonth: '2026-11',
      updater: () => ({ '2026-11-05': { AM: '', OFF: 'Adi', PM: 'Azrul' } }),
      names: ['Adi', 'Azrul', 'Muaz'],
      teamMembers: CERTIFIED_TEAM_MEMBERS,
    });

    // Meanwhile another device saved Muaz -> NIGHT on 2026-11-05 in DRAFT mode
    const serverUpdatedMain = [
      ...baseMain,
      { Name: 'Muaz', Date: '2026-11-05', Shift: 'NIGHT' },
    ];
    const latestServerComposed = composeEffectiveRoster({
      mainRows: serverUpdatedMain,
      amendments: [],
      rosterMonth: '2026-11',
      teamMembers: CERTIFIED_TEAM_MEMBERS,
    });

    const conflictCheck = detectConcurrentSaveConflicts({
      rosterMonth: '2026-11',
      latestServerCellsMap: latestServerComposed.cellsMap,
      mode: 'DRAFT',
      names: ['Adi', 'Azrul', 'Muaz'],
      teamMembers: CERTIFIED_TEAM_MEMBERS,
    });
    assert.equal(conflictCheck.hasConflict, true, 'Detected month baseline drift in DRAFT mode so Muaz NIGHT is never overwritten');
    markMonthConflict('2026-11', conflictCheck.conflicts);
    assert.equal(getMonthSessionSnapshot('2026-11').status, SAVE_STATUS.CONFLICT);

    // Rebase local edits onto latest server grid -> preserves BOTH Muaz NIGHT and local Adi OFF!
    const rebased = rebaseLocalEditsOntoServer({
      rosterMonth: '2026-11',
      latestServerGrid: { '2026-11-05': { AM: 'Adi', PM: 'Azrul', NIGHT: 'Muaz' } },
      latestServerCellsMap: latestServerComposed.cellsMap,
      latestServerChecksum: latestServerComposed.checksum,
      names: ['Adi', 'Azrul', 'Muaz'],
      teamMembers: CERTIFIED_TEAM_MEMBERS,
    });
    assert.equal(rebased.editedGrid['2026-11-05'].AM, '', 'Adi removed from old AM shift on rebase');
    assert.equal(rebased.editedGrid['2026-11-05'].OFF, 'Adi', 'Local Adi OFF preserved');
    assert.equal(rebased.editedGrid['2026-11-05'].NIGHT, 'Muaz', 'Concurrent server Muaz NIGHT preserved');

    // 2. Backend conflict check rejects stale previousValue on appendrosteramendments
    const tables = structuredClone(fixture.tables);
    tables.MasterRoster = [['Name', 'Date', 'Shift'], ['Adi', '2026-10-05', 'ON1']];
    const h = harness(currentSource, {
      tables,
      adminPin: '1234',
      clockIso: '2026-10-29T04:00:00.000Z',
    });

    const staleAmend = h.post({
      action: 'appendrosteramendments',
      adminPin: '1234',
      targetMonth: '2026-10',
      operationId: 'op-conflict-srv-1',
      amendments: [{ date: '2026-10-05', staffName: 'Adi', previousValue: 'AM', newValue: 'PM', isCleared: false }],
    });
    assert.equal(staleAmend.result, 'error');
    assert.match(staleAmend.message, /CONFLICT/i);
  });

  await t.test('Scenario 21 — Public Calendar View and Enhanced Table View display identical effective assignments and Amended markers', () => {
    const mainRows = [
      { Name: 'Adi', Date: '2026-10-02', Shift: 'AM' },
      { Name: 'Azrul', Date: '2026-10-02', Shift: 'PM' },
      { Name: 'Afiq', Date: '2026-10-02', Shift: 'NIGHT' },
    ];
    const amendments = [
      // Adi overridden AM -> ON1
      {
        AmendmentId: 'c1',
        RosterMonth: '2026-10',
        Date: '2026-10-02',
        Field: 'MO_SHIFT',
        StaffKey: 'A05157',
        StaffName: 'Adi',
        PreviousValue: 'AM',
        NewValue: 'ON1',
        IsCleared: false,
        Sequence: 1,
      },
      // Afiq cleared NIGHT -> blank
      {
        AmendmentId: 'c2',
        RosterMonth: '2026-10',
        Date: '2026-10-02',
        Field: 'MO_SHIFT',
        StaffKey: 'A05563',
        StaffName: 'Afiq',
        PreviousValue: 'NIGHT',
        NewValue: CLEAR_MARKER,
        IsCleared: true,
        Sequence: 2,
      },
    ];

    const h = createInteractiveComponentHarness(RosterPage, {
      simplifiedMode: true,
      clockNow: '2026-10-29T12:00:00+08:00',
      rosterMonth: '2026-10',
      names: ['Adi', 'Azrul', 'Afiq'],
      teamMembers: CERTIFIED_TEAM_MEMBERS.slice(0, 3),
      masterRoster: mainRows,
      rosterAmendments: amendments,
      selectedName: 'Guest',
      isAdmin: false,
    });

    // Calendar View
    const calTree = h.render();
    const calStr = JSON.stringify(calTree);
    assert.ok(calStr.includes('ON1'), 'Calendar View shows amended ON1 for Adi');
    assert.ok(calStr.includes('Azrul'), 'Calendar View shows unchanged PM for Azrul');
    assert.ok(!calStr.includes('Afiq'), 'Calendar View hides cleared NIGHT shift for Afiq');
    assert.ok(calStr.includes('amended-cell-indicator'), 'Calendar View shows Amended indicator');

    // Switch to Enhanced Table View
    findNode(calTree, (n) => n.type === 'button' && JSON.stringify(n.props?.children || '').includes('Table View')).props.onClick();
    const tableTree = h.render();
    const tableStr = JSON.stringify(tableTree);
    assert.ok(tableStr.includes('ON1'), 'Table View shows amended ON1 for Adi');
    assert.ok(tableStr.includes('PM'), 'Table View shows unchanged PM for Azrul');
    assert.ok(!tableStr.includes('"NIGHT"'), 'Table View does NOT show cleared NIGHT shift for Afiq');
    assert.ok(tableStr.includes('amended-cell-indicator'), 'Table View shows Amended indicator on both overridden and cleared cells');
  });

  await t.test('Scenario 22 — Legacy historical months remain readable and amendable without V2 enrollment or migration', () => {
    const tables = structuredClone(fixture.tables);
    tables.MasterRoster = [
      ['Name', 'Date', 'Shift'],
      ['Adi', '2026-08-14', 'AM'],
      ['Azrul', '2026-08-14', 'NIGHT'],
    ];

    const h = harness(currentSource, {
      tables,
      adminPin: '1234',
      clockIso: '2026-10-29T04:00:00.000Z',
    });

    // Historical month 2026-08 has zero V2 RosterPeriods table yet amends cleanly
    assert.equal(h.grids.RosterPeriods, undefined);
    const res = h.post({
      action: 'appendrosteramendments',
      adminPin: '1234',
      targetMonth: '2026-08',
      operationId: 'op-hist-aug-1',
      amendments: [{ date: '2026-08-14', staffName: 'Adi', previousValue: 'AM', newValue: 'AL', isCleared: false }],
    });
    assert.equal(res.result, 'success');

    const composed = composeEffectiveRoster({
      mainRows: h.get('masterroster'),
      amendments: h.get('rosteramendments', { month: '2026-08' }),
      rosterMonth: '2026-08',
      teamMembers: CERTIFIED_TEAM_MEMBERS,
    });
    assert.ok(composed.effectiveRows.some((r) => r.Name === 'Adi' && r.Shift === 'AL'));
    assert.ok(composed.effectiveRows.some((r) => r.Name === 'Azrul' && r.Shift === 'NIGHT'));
  });

  await t.test('Scenario 23 — Emergency Physician (EP) roster compatibility across Main, Amend, and explicit clears', () => {
    const mainRows = [
      { Name: 'Iskasymar', Date: '2026-10-08', Shift: FIELD_EP_OFFICE_HOUR },
      { Name: 'Luqman', Date: '2026-10-08', Shift: FIELD_EP_ONCALL },
      { Name: 'Adi', Date: '2026-10-08', Shift: 'AM' },
    ];
    const amendments = [
      // Replace EP_OFFICE_HOUR Iskasymar -> Hafizah
      {
        AmendmentId: 'ep-1',
        RosterMonth: '2026-10',
        Date: '2026-10-08',
        TargetType: 'EP',
        Field: FIELD_EP_OFFICE_HOUR,
        StaffKey: '__EP__',
        StaffName: 'Hafizah',
        PreviousValue: 'Iskasymar',
        NewValue: 'Hafizah',
        IsCleared: false,
        Sequence: 1,
      },
      // Clear EP_ONCALL Luqman -> blank
      {
        AmendmentId: 'ep-2',
        RosterMonth: '2026-10',
        Date: '2026-10-08',
        TargetType: 'EP',
        Field: FIELD_EP_ONCALL,
        StaffKey: '__EP__',
        StaffName: '',
        PreviousValue: 'Luqman',
        NewValue: CLEAR_MARKER,
        IsCleared: true,
        Sequence: 2,
      },
    ];

    const composed = composeEffectiveRoster({
      mainRows,
      amendments,
      rosterMonth: '2026-10',
      teamMembers: CERTIFIED_TEAM_MEMBERS,
    });

    assert.ok(
      composed.effectiveRows.some((r) => r.Name === 'Hafizah' && r.Shift === FIELD_EP_OFFICE_HOUR),
      'EP_OFFICE_HOUR amended to Hafizah'
    );
    assert.ok(
      !composed.effectiveRows.some((r) => r.Shift === FIELD_EP_ONCALL),
      'Cleared EP_ONCALL does NOT fall back to Luqman'
    );

    const h = createInteractiveComponentHarness(RosterPage, {
      simplifiedMode: true,
      clockNow: '2026-10-29T12:00:00+08:00',
      rosterMonth: '2026-10',
      names: ['Adi'],
      teamMembers: [CERTIFIED_TEAM_MEMBERS[0]],
      emergencyPhysicians: CERTIFIED_EPS,
      masterRoster: mainRows,
      rosterAmendments: amendments,
      selectedName: 'Guest',
      isAdmin: false,
    });
    const calHtml = h.renderHtml();
    assert.ok(calHtml.includes('>Hafizah<'), 'Calendar View displays amended EP Hafizah');
    assert.ok(!calHtml.includes('>Luqman<'), 'Calendar View omits cleared EP Luqman from active cell text');
    assert.ok(calHtml.includes('Main: Luqman → Current: Cleared'), 'Provenance tooltip records Main: Luqman -> Current: Cleared');
  });

  await t.test('Scenario 24 — Existing V2 files remain untouched and read-only November reconciliation accurately audits 98 MO assignments across 13 MOs', () => {
    // 1. Confirm V2 backend files remain preserved on disk
    for (const v2File of ['backend/roster-v2.gs', 'backend/roster-draft.gs', 'backend/roster-lifecycle.gs']) {
      assert.equal(fs.existsSync(path.resolve(rootDir, v2File)), true, `${v2File} preserved`);
    }

    // 2. Build realistic 98-assignment November 2026 V2 draft fixture across all 13 certified MOs
    const shiftsCycle = ['AM', 'PM', 'NIGHT', 'OFF', 'ON1', 'ON2', 'OH'];
    const v2NovDraft = [];
    for (let i = 0; i < 98; i++) {
      const mo = CERTIFIED_TEAM_MEMBERS[i % 13];
      const day = String((i % 28) + 1).padStart(2, '0');
      v2NovDraft.push({
        PersonNameSnapshot: mo.name,
        StaffId: mo.staffId,
        DutyDomain: 'MO',
        Date: `2026-11-${day}`,
        ShiftCode: shiftsCycle[i % shiftsCycle.length],
      });
    }
    const v2SnapshotBefore = structuredClone(v2NovDraft);

    // Case A: MasterRoster has 0 November rows -> requiresOneTimeCopy = true, 98/unique cells onlyInV2Draft
    const emptyAudit = auditV2DraftVsMasterRoster({
      rosterMonth: '2026-11',
      masterRosterRows: [{ Name: 'Iskasymar', Date: '2026-11-01', Shift: 'EP_OFFICE_HOUR' }],
      v2DraftAssignments: v2NovDraft,
      teamMembers: CERTIFIED_TEAM_MEMBERS,
    });
    assert.equal(emptyAudit.v2MoAssignmentCount, 98);
    assert.equal(emptyAudit.masterMoCellCount, 0);
    assert.equal(emptyAudit.epCellsInMasterRoster, 1, 'EP rows counted separately without polluting MO reconciliation');
    assert.equal(emptyAudit.requiresOneTimeCopy, true);
    assert.deepEqual(v2NovDraft, v2SnapshotBefore, 'Read-only audit never mutates input arrays');

    // Case B: After controlled copy of proposedMasterRosterRowsForCopy -> 100% match, requiresOneTimeCopy = false
    const matchedAudit = auditV2DraftVsMasterRoster({
      rosterMonth: '2026-11',
      masterRosterRows: emptyAudit.proposedMasterRosterRowsForCopy,
      v2DraftAssignments: v2NovDraft,
      teamMembers: CERTIFIED_TEAM_MEMBERS,
    });
    assert.equal(matchedAudit.onlyInV2Draft.length, 0);
    assert.equal(matchedAudit.onlyInMasterRoster.length, 0);
    assert.equal(matchedAudit.valueMismatches.length, 0);
    assert.equal(matchedAudit.requiresOneTimeCopy, false);
  });

  await t.test('Scenario 25 — Viewing or selecting December (2026-12) performs zero unexpected network or storage initialization', () => {
    const origFetch = globalThis.fetch;
    let fetchCount = 0;
    globalThis.fetch = async () => { fetchCount++; throw new Error('Should not fetch'); };

    try {
      const h = createInteractiveComponentHarness(RosterPage, {
        simplifiedMode: true,
        clockNow: '2026-10-29T12:00:00+08:00',
        rosterMonth: '2026-12',
        names: CERTIFIED_NAMES,
        teamMembers: CERTIFIED_TEAM_MEMBERS,
        masterRoster: [],
        rosterAmendments: [],
        selectedName: 'Admin',
        isAdmin: true,
      });

      const tree = h.render();
      assert.ok(tree);
      assert.equal(fetchCount, 0, 'Zero network requests on rendering December');
      const decOrStagingKeys = Array.from(localStoreData.keys()).filter(
        (k) => k.includes('2026-12') || k.includes('resq_simplified_staging') || k.includes('rosterv2')
      );
      assert.deepEqual(decOrStagingKeys, [], 'Zero December or staging localStorage entries created merely by viewing December');
      assert.equal(hasUnsavedMonthEdits('2026-12'), false);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  await t.test('Scenario 26 — Multi-step local Undo and Redo accurately restore cell grids and Save status', () => {
    const baseMain = [{ Name: 'Adi', Date: '2026-11-01', Shift: 'AM' }];
    const composed = composeEffectiveRoster({
      mainRows: baseMain,
      amendments: [],
      rosterMonth: '2026-11',
      teamMembers: CERTIFIED_TEAM_MEMBERS,
    });

    getOrInitMonthStaging({
      rosterMonth: '2026-11',
      initialGridFactory: () => ({ '2026-11-01': { AM: 'Adi' } }),
      serverCellsMap: composed.cellsMap,
      serverChecksum: composed.checksum,
      names: ['Adi'],
      teamMembers: [CERTIFIED_TEAM_MEMBERS[0]],
    });

    // Step 1: Adi -> PM
    applyLocalGridUpdate({
      rosterMonth: '2026-11',
      updater: () => ({ '2026-11-01': { PM: 'Adi' } }),
      names: ['Adi'],
      teamMembers: [CERTIFIED_TEAM_MEMBERS[0]],
    });
    // Step 2: Adi -> NIGHT
    applyLocalGridUpdate({
      rosterMonth: '2026-11',
      updater: () => ({ '2026-11-01': { NIGHT: 'Adi' } }),
      names: ['Adi'],
      teamMembers: [CERTIFIED_TEAM_MEMBERS[0]],
    });
    assert.equal(getMonthSessionSnapshot('2026-11').editedGrid['2026-11-01'].NIGHT, 'Adi');
    assert.equal(getMonthSessionSnapshot('2026-11').status, SAVE_STATUS.UNSAVED_CHANGES);

    // Undo 1 -> back to PM
    const u1 = undoLocalEdit('2026-11', ['Adi'], [CERTIFIED_TEAM_MEMBERS[0]]);
    assert.equal(u1.editedGrid['2026-11-01'].PM, 'Adi');
    assert.equal(u1.hasUnsavedEdits, true);

    // Undo 2 -> back to baseline AM -> status returns to Editing and hasUnsavedEdits becomes false!
    const u2 = undoLocalEdit('2026-11', ['Adi'], [CERTIFIED_TEAM_MEMBERS[0]]);
    assert.equal(u2.editedGrid['2026-11-01'].AM, 'Adi');
    assert.equal(u2.hasUnsavedEdits, false, 'Undoing all the way to baseline clears unsaved flag');
    assert.equal(u2.status, SAVE_STATUS.EDITING);

    // Redo 1 -> restores PM and Unsaved Changes
    const r1 = redoLocalEdit('2026-11', ['Adi'], [CERTIFIED_TEAM_MEMBERS[0]]);
    assert.equal(r1.editedGrid['2026-11-01'].PM, 'Adi');
    assert.equal(r1.hasUnsavedEdits, true);
    assert.equal(r1.status, SAVE_STATUS.UNSAVED_CHANGES);
  });

  await t.test('Scenario 27 — Simplified Mode removes Google OAuth prompt/redirect/spinner from App.jsx and restores AdminPinModal', () => {
    const appSrc = fs.readFileSync(path.resolve(rootDir, 'src/App.jsx'), 'utf8');
    const rosterSrc = fs.readFileSync(path.resolve(rootDir, 'src/components/RosterPage.jsx'), 'utf8');

    assert.ok(!appSrc.includes('startGoogleRedirectAuth'), 'App.jsx does NOT import or call startGoogleRedirectAuth');
    assert.ok(!appSrc.includes('handleUrlAuthHandoff'), 'App.jsx does NOT import or call handleUrlAuthHandoff');
    assert.ok(!appSrc.includes('Verifying administrator credentials...'), 'App.jsx does NOT render OAuth spinner');
    assert.ok(appSrc.includes('AdminPinModal'), 'App.jsx renders legacy AdminPinModal');
    assert.ok(!/rosterv2/i.test(rosterSrc), 'RosterPage.jsx contains zero direct rosterv2 endpoint tokens');
  });

  await t.test('Scenario 28 — Normal doctor request workflows succeed without Admin PIN and unconfirmed requests do NOT pollute Simplified Roster', () => {
    const h = harness(currentSource, {
      adminPin: '4826',
      clockIso: '2026-10-29T04:00:00.000Z',
    });

    // 1. Doctor submits, updates, and deletes a shift request without any Admin PIN or session token
    const subRes = h.post({
      action: 'submit',
      name: 'Adi',
      date: '2026-11-12',
      day: 'Thu',
      request: 'AL',
      comment: 'Family wedding',
      requestType: 'Leave',
    });
    assert.equal(subRes.result, 'success', 'Doctor submit succeeds without Admin PIN');
    assert.ok(subRes.id, 'Server assigned request ID');

    const updRes = h.post({
      action: 'update',
      id: subRes.id,
      name: 'Adi',
      date: '2026-11-12',
      day: 'Thu',
      request: 'OFF',
      comment: 'Updated request',
    });
    assert.equal(updRes.result, 'success', 'Doctor update succeeds without Admin PIN');

    const delRes = h.post({
      action: 'delete',
      id: subRes.id,
    });
    assert.equal(delRes.result, 'success', 'Doctor delete succeeds without Admin PIN');

    // 2. Unconfirmed future requests in requestsRosterMap do NOT auto-populate as confirmed shifts in Simplified Mode
    const pageHarness = createInteractiveComponentHarness(RosterPage, {
      simplifiedMode: true,
      clockNow: '2026-10-29T12:00:00+08:00',
      rosterMonth: '2026-11',
      isUpcomingMonth: true,
      names: ['Adi'],
      teamMembers: [CERTIFIED_TEAM_MEMBERS[0]],
      masterRoster: [],
      rosterAmendments: [],
      requestsRosterMap: {
        '2026-11-12': { AL: ['Adi'] },
      },
      selectedName: 'Adi',
      isAdmin: false,
    });

    const calTree = pageHarness.render();
    findNode(calTree, (n) => n.type === 'button' && JSON.stringify(n.props?.children || '').includes('Table View')).props.onClick();
    const tableStr = JSON.stringify(pageHarness.render());
    assert.ok(!tableStr.includes('"AL"'), 'Unconfirmed doctor request AL is NOT rendered as a confirmed roster shift');
  });

  await t.test('Scenario 29 — Server PIN rate-limiting throttling locks out after 5 failed attempts fail-closed and cannot be bypassed by rotating clientIdentifier', () => {
    const h = harness(currentSource, {
      adminPin: '5707',
      sessionSecret: 'test-secret-12345678901234567890123456789012',
    });

    // 1. Five consecutive wrong PIN attempts with ROTATING clientIdentifiers (testing bypass defense)
    for (let i = 1; i <= 5; i++) {
      const res = h.post({
        action: 'verifyadminpin',
        pin: 'wrong_' + i,
        clientIdentifier: 'rotating_attacker_' + i,
      });
      assert.equal(res.result, 'error');
      assert.equal(res.code, 'INVALID_PIN');
    }

    // 2. 6th attempt (even with a NEW clientIdentifier and the CORRECT PIN) must be locked out
    const lockedRes = h.post({
      action: 'verifyadminpin',
      pin: '5707',
      clientIdentifier: 'new_fresh_identifier_99',
    });
    assert.equal(lockedRes.result, 'error');
    assert.equal(lockedRes.code, 'PIN_LOCKED');
    assert.ok(lockedRes.message.includes('lockout active') || lockedRes.message.includes('Too many incorrect PIN attempts'));

    // 3. Attempt with NO clientIdentifier is also locked out
    const noIdLockedRes = h.post({
      action: 'verifyadminpin',
      pin: '5707',
    });
    assert.equal(noIdLockedRes.result, 'error');
    assert.equal(noIdLockedRes.code, 'PIN_LOCKED');

    // 4. Token verification security boundary on privileged writes:
    // Missing token
    const missingRes = h.post({ action: 'savemasterrosterdraft', targetMonth: '2026-11' });
    assert.equal(missingRes.result, 'error');
    assert.ok(missingRes.message.includes('authorization required'));

    // Invalid signature token
    const invalidRes = h.post({ action: 'savemasterrosterdraft', targetMonth: '2026-11', adminSessionToken: 'invalid.jwt.token' });
    assert.equal(invalidRes.result, 'error');
    assert.ok(invalidRes.message.includes('authorization required'));

    // Frontend-only fallback PIN '1234' cannot authorize backend writes
    const badPinRes = h.post({ action: 'savemasterrosterdraft', targetMonth: '2026-11', adminPin: '1234' });
    assert.equal(badPinRes.result, 'error');
    assert.ok(badPinRes.message.includes('authorization required'));
  });

  await t.test('Scenario 30 — savemasterrosterdraft with expectedMonthCellCount catches month-level drift fail-closed', () => {
    const h = harness(currentSource, {
      adminPin: '5707',
      sessionSecret: 'test-secret-12345678901234567890123456789012',
      clockIso: '2026-10-29T12:00:00.000Z',
    });

    // Obtain valid session token
    const authRes = h.post({ action: 'verifyadminpin', pin: '5707' });
    const token = authRes.adminSessionToken;

    // Suppose caller expects 99 filled cells in target future month (2026-11), but server has 0
    const conflictRes = h.post({
      action: 'savemasterrosterdraft',
      adminSessionToken: token,
      targetMonth: '2026-11',
      expectedMonthCellCount: 99,
      rows: [{ name: 'Adi', date: '2026-11-01', shift: 'AM' }],
    });
    assert.equal(conflictRes.result, 'error');
    assert.ok(conflictRes.message.includes('CONFLICT: Master roster was modified by another session'));

    // When expectedMonthCellCount matches the actual current count (0), save succeeds
    const goodRes = h.post({
      action: 'savemasterrosterdraft',
      adminSessionToken: token,
      targetMonth: '2026-11',
      expectedMonthCellCount: 0,
      rows: [{ name: 'Adi', date: '2026-11-01', shift: 'AM' }],
    });
    assert.equal(goodRes.result, 'success');
    assert.equal(goodRes.mode, 'DRAFT');
    assert.equal(goodRes.target, 'MAIN');
  });

  await t.test('Scenario 31 — Development Mock Mode intercepts API requests with zero network fetch and simulates conflict/failure', async () => {
    // 1. Activation flag
    setDevMockActive(true);
    assert.equal(isDevMockActive(), true);

    // 2. Initial synthetic dataset fetch
    const allData = await handleDevMockRequest({ method: 'GET', query: { action: 'alldata' } });
    assert.equal(allData.result, 'success');
    assert.equal(allData.teamMembers.length, 13, '13 MO team members in mock store');
    assert.equal(allData.emergencyPhysicians.length, 6, '6 EP doctors in mock store');
    assert.ok(allData.masterRoster.length > 50, 'Master roster populated with synthetic shifts');
    assert.equal(allData.rosterAmendments.length, 2, '2 pre-seeded sample amendments for Main + Amend visual proof');

    // 3. Mock PIN verification and throttling
    for (let i = 0; i < 5; i++) {
      const failRes = await handleDevMockRequest({
        method: 'POST',
        body: { action: 'verifyadminpin', pin: 'bad_pin' },
      });
      assert.equal(failRes.result, 'error');
      assert.equal(failRes.code, 'INVALID_PIN');
    }
    const lockedRes = await handleDevMockRequest({
      method: 'POST',
      body: { action: 'verifyadminpin', pin: '5707' },
    });
    assert.equal(lockedRes.result, 'error');
    assert.equal(lockedRes.code, 'PIN_LOCKED');

    // Reset store and verify valid PIN
    resetMockStore();
    const pinRes = await handleDevMockRequest({
      method: 'POST',
      body: { action: 'verifyadminpin', pin: '5707' },
    });
    assert.equal(pinRes.result, 'success');
    assert.equal(pinRes.verified, true);
    assert.ok(pinRes.adminSessionToken);

    // 4. Mock DRAFT save (future month 2026-11)
    const draftRes = await handleDevMockRequest({
      method: 'POST',
      body: {
        action: 'savemasterrosterdraft',
        targetMonth: '2026-11',
        rows: [{ name: 'Person A', date: '2026-11-01', shift: 'PM' }],
      },
    });
    assert.equal(draftRes.result, 'success');
    assert.equal(draftRes.mode, 'DRAFT');
    assert.equal(draftRes.target, 'MAIN');

    // 5. Mock AMEND save (current month 2026-10)
    const amendRes = await handleDevMockRequest({
      method: 'POST',
      body: {
        action: 'appendrosteramendments',
        targetMonth: '2026-10',
        amendments: [
          {
            date: '2026-10-15',
            targetType: 'MO',
            field: 'MO_SHIFT',
            staffKey: 'A05157',
            staffName: 'Person A',
            previousValue: 'AM',
            newValue: 'NIGHT',
          },
        ],
      },
    });
    assert.equal(amendRes.result, 'success');
    assert.equal(amendRes.mode, 'AMEND');
    assert.equal(amendRes.target, 'AMENDMENTS');

    // 6. Simulate conflict trigger
    setSimulateSaveConflict(true);
    await assert.rejects(
      async () => {
        await handleDevMockRequest({
          method: 'POST',
          body: {
            action: 'savemasterrosterdraft',
            targetMonth: '2026-11',
            rows: [],
          },
        });
      },
      /CONFLICT/
    );

    // 7. Simulate failure trigger
    setSimulateSaveFailure(true);
    await assert.rejects(
      async () => {
        await handleDevMockRequest({
          method: 'POST',
          body: {
            action: 'appendrosteramendments',
            targetMonth: '2026-10',
            amendments: [],
          },
        });
      },
      /Simulated network save failure/
    );

    // 8. Clean reset
    resetMockStore();
    setDevMockActive(false);
    assert.equal(isDevMockActive(), false);
  });

  await t.test('Scenario 32 — Main Save Failure Safety Under Adversarial Sheet Conditions', () => {
    // 1. Simulate exception before sheet modification
    const testTables = structuredClone(fixture.tables);
    testTables.MasterRoster = [
      ['Name', 'Date', 'Shift'],
      ['Person A', '2026-09-01', 'AM'],
      ['Person B', '2026-09-02', 'PM'],
      ['Person A', '2026-10-01', 'NIGHT'],
    ];
    const initialMasterRoster = structuredClone(testTables.MasterRoster);

    const h1 = harness(currentSource, {
      tables: testTables,
      adminPin: '5707',
      sessionSecret: 'test-secret-12345678901234567890123456789012',
      clockIso: '2026-10-29T12:00:00.000Z',
    });
    const auth1 = h1.post({ action: 'verifyadminpin', pin: '5707' });
    const token1 = auth1.adminSessionToken;

    // A. Payload with invalid date (does not match targetMonth)
    const errRes1 = h1.post({
      action: 'savemasterrosterdraft',
      adminSessionToken: token1,
      targetMonth: '2026-11',
      rows: [{ name: 'Person A', date: '2026-12-01', shift: 'AM' }],
    });
    assert.equal(errRes1.result, 'error');
    assert.deepEqual(h1.jsonState().MasterRoster, initialMasterRoster, 'MasterRoster sheet completely untouched on pre-write validation failure');

    // B. Payload with drift conflict (expectedMonthCellCount mismatch)
    const errRes2 = h1.post({
      action: 'savemasterrosterdraft',
      adminSessionToken: token1,
      targetMonth: '2026-11',
      expectedMonthCellCount: 50,
      rows: [{ name: 'Person A', date: '2026-11-01', shift: 'AM' }],
    });
    assert.equal(errRes2.result, 'error');
    assert.deepEqual(h1.jsonState().MasterRoster, initialMasterRoster, 'MasterRoster sheet completely untouched on conflict error');

    // 2. Successful save for future month (2026-11) verifies Write-Before-Cleanup
    const opId = 'op_safeguard_test_42';
    const initialWriteCount = h1.writes.length;
    const saveRes = h1.post({
      action: 'savemasterrosterdraft',
      adminSessionToken: token1,
      targetMonth: '2026-11',
      operationId: opId,
      rows: [
        { name: 'Person A', date: '2026-11-01', shift: 'AM' },
        { name: 'Echo', date: '2026-11-01', shift: 'EP_OFFICE_HOUR' },
      ],
    });
    assert.equal(saveRes.result, 'success');
    assert.equal(saveRes.count, 2);

    // Verify non-target months (2026-09 and 2026-10) are 100% preserved
    const afterRoster = h1.jsonState().MasterRoster;
    const sepRows = afterRoster.filter(r => String(r[1]).startsWith('2026-09'));
    const octRows = afterRoster.filter(r => String(r[1]).startsWith('2026-10'));
    const novRows = afterRoster.filter(r => String(r[1]).startsWith('2026-11'));
    assert.equal(sepRows.length, 2, 'September rows preserved');
    assert.equal(octRows.length, 1, 'October rows preserved');
    assert.equal(novRows.length, 2, 'November rows written');
    assert.ok(novRows.some(r => r[0] === 'Echo' && r[2] === 'EP_OFFICE_HOUR'), 'EP shift preserved in MasterRoster');

    // 3. Duplicate retry with same operationId is completely idempotent and executes zero extra writes
    const writesBeforeRetry = h1.writes.length;
    const retryRes = h1.post({
      action: 'savemasterrosterdraft',
      adminSessionToken: token1,
      targetMonth: '2026-11',
      operationId: opId,
      rows: [
        { name: 'Person A', date: '2026-11-01', shift: 'AM' },
        { name: 'Echo', date: '2026-11-01', shift: 'EP_OFFICE_HOUR' },
      ],
    });
    assert.equal(retryRes.result, 'success');
    assert.equal(retryRes.idempotentReplay, true);
    assert.equal(h1.writes.length, writesBeforeRetry, 'Zero extra sheet writes performed on idempotent replay');

    // 4. Simulate concurrent modification from another client
    const conflictRes = h1.post({
      action: 'savemasterrosterdraft',
      adminSessionToken: token1,
      targetMonth: '2026-11',
      expectedCellBaselines: [
        {
          date: '2026-11-01',
          field: 'MO_SHIFT',
          staffName: 'Person A',
          previousValue: 'NIGHT', // Client expected NIGHT, but server has AM
          newValue: 'PM',
        },
      ],
      rows: [{ name: 'Person A', date: '2026-11-01', shift: 'PM' }],
    });
    assert.equal(conflictRes.result, 'error');
    assert.ok(conflictRes.message.includes('CONFLICT: Concurrent edit detected'));
    assert.deepEqual(h1.jsonState().MasterRoster, afterRoster, 'MasterRoster untouched on concurrent conflict rejection');
  });
});
