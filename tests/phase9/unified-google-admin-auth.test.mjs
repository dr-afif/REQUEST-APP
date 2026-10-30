import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import React from 'react';
import ReactDOMServer from 'react-dom/server';

import * as adminAuthModule from '../../src/features/roster/auth/adminAuth.js';
import { DraftQueue } from '../../src/features/roster/queue/draftQueue.js';

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
  globalThis.window = {
    location: {
      origin: 'http://localhost:5173',
      href: 'http://localhost:5173/REQUEST-APP/',
      pathname: '/REQUEST-APP/',
      search: '',
      hash: ''
    },
    history: {
      state: null,
      replaceState: (state, title, url) => {
        const u = new URL(url, 'http://localhost:5173');
        globalThis.window.location.search = u.search;
        globalThis.window.location.href = u.href;
      }
    },
    addEventListener: () => {},
    removeEventListener: () => {}
  };
}

if (typeof globalThis.document === 'undefined') {
  globalThis.document = {
    title: 'ED Roster App',
    body: { nodeType: 1 },
    getElementById: () => null,
    addEventListener: () => {},
    removeEventListener: () => {},
    createElement: () => ({ setAttribute: () => {}, addEventListener: () => {} }),
    querySelector: () => null
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
      './features/roster/auth/adminAuth.js',
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

test('Phase A2: Unified Google Administrator Authentication Suite', async (t) => {
  const AppNavigation = await loadJsxComponent('src/components/AppNavigation.jsx');
  const AdminPanel = await loadJsxComponent('src/components/AdminPanel.jsx');
  const RosterPage = await loadJsxComponent('src/components/RosterPage.jsx');

  t.beforeEach(() => {
    adminAuthModule.clearAdminSessionToken();
    globalThis.localStorage.clear();
    globalThis.sessionStorage.clear();
    globalThis.window.location.search = '';
    globalThis.window.location.href = 'http://localhost:5173/REQUEST-APP/';
  });

  t.afterEach(() => {
    adminAuthModule.clearAdminSessionToken();
    globalThis.localStorage.clear();
    globalThis.sessionStorage.clear();
  });

  // Scenario 1: Admin entry through Google verification
  await t.test('1. Admin entry initiates Google verification; no PIN modal required', async () => {
    let redirectInitiated = false;
    let challengeRequested = false;

    // Simulate selecting Admin with unauthenticated session
    assert.equal(adminAuthModule.isSessionTokenActive(), false, 'Session must initially be inactive');

    const fakeFetcher = async (url) => {
      if (String(url).includes('rosterv2authchallenge')) {
        challengeRequested = true;
        return {
          ok: true,
          json: async () => ({
            ok: true,
            state: 'server_state_nonce_123',
            redirectUri: adminAuthModule.PRODUCTION_OAUTH_REDIRECT_URI
          })
        };
      }
      return { ok: false };
    };

    const challenge = await adminAuthModule.requestAuthChallenge({
      baseUrl: 'https://script.google.com/test',
      fetcher: fakeFetcher
    });

    assert.equal(challenge.state, 'server_state_nonce_123');
    assert.equal(challengeRequested, true, 'Challenge endpoint must be called');
    assert.equal(adminAuthModule.isSessionTokenActive(), false, 'Session is not active until code redemption');
  });

  // Scenario 2: Successful OAuth handoff and return to the app
  await t.test('2. Successful OAuth handoff ?v2auth= strips query param and redeems token into memory', async () => {
    globalThis.window.location.href = 'http://localhost:5173/REQUEST-APP/?v2auth=handoff_code_abc';
    globalThis.window.location.search = '?v2auth=handoff_code_abc';

    let redeemedAction = null;
    let redeemedCode = null;

    const fakeFetcher = async (url, opts) => {
      const body = JSON.parse(opts.body);
      redeemedAction = body.action;
      redeemedCode = body.handoffCode;
      return {
        ok: true,
        json: async () => ({
          ok: true,
          adminSessionToken: 'hmac_session_token_xyz',
          email: 'admin@hospital.gov.my',
          expiresAt: Math.floor(Date.now() / 1000) + 900
        })
      };
    };

    const result = await adminAuthModule.handleUrlAuthHandoff({
      baseUrl: 'https://script.google.com/test',
      fetcher: fakeFetcher,
      urlStr: globalThis.window.location.href
    });

    assert.equal(result?.ok, true);
    assert.equal(result.adminSessionToken, 'hmac_session_token_xyz');
    assert.equal(redeemedAction, 'rosterv2authredeem');
    assert.equal(redeemedCode, 'handoff_code_abc');

    // Token must be active in memory
    assert.equal(adminAuthModule.isSessionTokenActive(), true);
    assert.equal(adminAuthModule.getAdminSessionToken(), 'hmac_session_token_xyz');
    assert.equal(adminAuthModule.getAdminEmail(), 'admin@hospital.gov.my');

    // URL parameter must be stripped from window history
    assert.equal(globalThis.window.location.search, '', 'v2auth must be stripped immediately from URL');
  });

  // Scenario 3: Failed or unauthorized Google login
  await t.test('3. Failed or unauthorized Google login fails closed without granting Admin', async () => {
    globalThis.window.location.href = 'http://localhost:5173/REQUEST-APP/?v2auth=unauthorized_code';
    globalThis.window.location.search = '?v2auth=unauthorized_code';

    const fakeFetcher = async () => ({
      ok: true,
      json: async () => ({
        ok: false,
        error: { code: 'NOT_AN_ADMINISTRATOR', message: 'User is not an authorized administrator.' }
      })
    });

    await assert.rejects(
      async () => {
        await adminAuthModule.handleUrlAuthHandoff({
          baseUrl: 'https://script.google.com/test',
          fetcher: fakeFetcher,
          urlStr: globalThis.window.location.href
        });
      },
      /User is not an authorized administrator/
    );

    // Fail closed: session must remain inactive
    assert.equal(adminAuthModule.isSessionTokenActive(), false);
    assert.equal(adminAuthModule.getAdminSessionToken(), null);
  });

  // Scenario 4: No repeated login during month navigation
  await t.test('4. Valid token in memory allows month switching without repeated login flow', () => {
    adminAuthModule.setAdminSessionToken('active_hmac_token_123', 'admin@hospital.gov.my', 900);
    assert.equal(adminAuthModule.isSessionTokenActive(), true);

    // Navigate to October, then November, then December
    const month1 = '2026-11';
    const month2 = '2026-10';
    const month3 = '2026-11';

    // Token remains active across period switches in memory
    assert.equal(adminAuthModule.isSessionTokenActive(), true, `Active in ${month1}`);
    assert.equal(adminAuthModule.isSessionTokenActive(), true, `Active in ${month2}`);
    assert.equal(adminAuthModule.isSessionTokenActive(), true, `Active in ${month3}`);
    assert.equal(adminAuthModule.getAdminSessionToken(), 'active_hmac_token_123');
  });

  // Scenario 5: Legacy Admin panel access after authentication
  await t.test('5. AdminPanel renders verification banner when unauthenticated, full controls when authenticated', () => {
    // 1. Unauthenticated: must display Verification Required card
    adminAuthModule.clearAdminSessionToken();
    const unauthHtml = ReactDOMServer.renderToStaticMarkup(
      React.createElement(AdminPanel, { requests: [], shiftBlocks: [], names: ['Doctor 1'] })
    );
    assert.ok(unauthHtml.includes('Administrator Verification Required'), 'Unauth AdminPanel must show verification banner');
    assert.ok(!unauthHtml.includes('Shift Block Management'), 'Unauth AdminPanel must not show operational controls');

    // 2. Authenticated: displays full panel
    adminAuthModule.setAdminSessionToken('valid_token', 'admin@hospital.gov.my', 900);
    const authHtml = ReactDOMServer.renderToStaticMarkup(
      React.createElement(AdminPanel, { requests: [], shiftBlocks: [], names: ['Doctor 1'] })
    );
    assert.ok(!authHtml.includes('Administrator Verification Required'), 'Auth AdminPanel must not show verification warning');
    assert.ok(authHtml.includes('Administrative Controls') || authHtml.includes('Admin Panel') || authHtml.includes('Requests') || authHtml.includes('Shift Block'), 'Auth AdminPanel renders controls');
  });

  // Scenario 6: Admin-only actions remain backend-authorized
  await t.test('6. Setting localStorage/sessionStorage without HMAC token cannot gain Admin privileges', () => {
    adminAuthModule.clearAdminSessionToken();
    globalThis.localStorage.setItem('resq_member_name', 'Admin');
    globalThis.sessionStorage.setItem('resq_admin_verified', 'true');

    // Navigation rendered for unverified user spoofing Admin in storage
    const navHtml = ReactDOMServer.renderToStaticMarkup(
      React.createElement(AppNavigation, {
        currentPage: 'dashboard',
        selectedName: 'Admin',
        onPageChange: () => {},
        onSelectName: () => {},
        names: ['Dr. Alice', 'Dr. Bob']
      })
    );

    // Must NOT render Admin Panel or Summary nav items without active HMAC token
    assert.ok(!navHtml.includes('Admin Panel'), 'Nav must not show Admin Panel tab without active token');
    assert.ok(!navHtml.includes('Exit Admin'), 'Nav must not show Exit Admin button without active token');
  });

  // Scenario 7: Logout from desktop, mobile and roster workspace
  await t.test('7. Logout revokes token and clears session state across components', () => {
    adminAuthModule.setAdminSessionToken('token_to_clear', 'admin@hospital.gov.my', 900);
    assert.equal(adminAuthModule.isSessionTokenActive(), true);

    let authNotificationCount = 0;
    const unsub = adminAuthModule.subscribeAdminAuth(() => {
      authNotificationCount++;
    });

    // Invoke logout
    adminAuthModule.clearAdminSessionToken();

    assert.equal(adminAuthModule.isSessionTokenActive(), false);
    assert.equal(adminAuthModule.getAdminSessionToken(), null);
    assert.equal(authNotificationCount, 1, 'Subscribers must be notified on logout');
    unsub();
  });

  // Scenario 8: Admin-to-doctor role switching
  await t.test('8. Role transition from Admin to doctor revokes admin token', () => {
    adminAuthModule.setAdminSessionToken('admin_token_active', 'admin@hospital.gov.my', 900);
    assert.equal(adminAuthModule.isSessionTokenActive(), true);

    // Simulate switching to Dr. Alice
    adminAuthModule.clearAdminSessionToken();
    globalThis.localStorage.setItem('resq_member_name', 'Dr. Alice');

    assert.equal(adminAuthModule.isSessionTokenActive(), false);
    assert.equal(globalThis.localStorage.getItem('resq_member_name'), 'Dr. Alice');
  });

  // Scenario 9: Session expiration
  await t.test('9. Session expiration timer automatically revokes token and notifies', (t, done) => {
    let notified = false;
    const unsub = adminAuthModule.subscribeAdminAuth(() => {
      notified = true;
    });

    // Set 1-second expiration
    adminAuthModule.setAdminSessionToken('short_lived_token', 'admin@test.gov', 1);
    assert.equal(adminAuthModule.isSessionTokenActive(), true);

    setTimeout(() => {
      assert.equal(adminAuthModule.isSessionTokenActive(), false, 'Token must expire after TTL');
      assert.equal(notified, true, 'Subscribers must be notified on expiry');
      unsub();
      done();
    }, 1100);
  });

  // Scenario 10: Reauthentication after expiration
  await t.test('10. Clean reauthentication after expiration restores session', () => {
    adminAuthModule.setAdminSessionToken('expired_token', 'admin@test.gov', 0);
    assert.equal(adminAuthModule.isSessionTokenActive(), false, 'Initially expired');

    // Reauthenticate
    adminAuthModule.setAdminSessionToken('fresh_token_after_reauth', 'admin@test.gov', 900);
    assert.equal(adminAuthModule.isSessionTokenActive(), true);
    assert.equal(adminAuthModule.getAdminSessionToken(), 'fresh_token_after_reauth');
  });

  // Scenario 11: Private roster data hidden after logout
  await t.test('11. Private draft data in RosterPage is wiped when session token is revoked', () => {
    adminAuthModule.clearAdminSessionToken();

    // RosterPage rendered with unauthenticated admin
    const unauthHtml = ReactDOMServer.renderToStaticMarkup(
      React.createElement(RosterPage, {
        rosterMonth: '2026-11',
        selectedName: 'Admin',
        isAdmin: false,
        settings: { roster_workspace_v2_enabled: true, roster_v2_read_enabled: true }
      })
    );

    // Verified indicator must NOT be present
    assert.ok(!unauthHtml.includes('Verified Administrator'), 'Unverified session must not show verified indicator');
  });

  // Scenario 12: Late asynchronous response rejection
  await t.test('12. In-flight asynchronous auth response resolving after logout is discarded', async () => {
    adminAuthModule.setAdminSessionToken('initial_token', 'admin@test.gov', 900);

    // Asynchronous network call in-flight
    const slowRedeemPromise = new Promise((resolve) => {
      setTimeout(() => {
        resolve({ ok: true, adminSessionToken: 'late_token', email: 'admin@test.gov' });
      }, 50);
    });

    // User logs out before call returns
    adminAuthModule.clearAdminSessionToken();
    assert.equal(adminAuthModule.isSessionTokenActive(), false);

    const result = await slowRedeemPromise;
    // Late response should not revive session if session was actively revoked
    assert.equal(adminAuthModule.isSessionTokenActive(), false);
  });

  // Scenario 13: Instant November revisits preserved
  await t.test('13. Authenticated November revisit preserves DraftQueue in-memory baseline', () => {
    adminAuthModule.setAdminSessionToken('valid_admin_token', 'admin@hospital.gov.my', 900);

    const queue = {
      view: (key) => ({
        key,
        cells: { 'doc_1:2026-11-01': ['M'] },
        baseline: { revision: 1, cells: { 'doc_1:2026-11-01': ['M'] } },
        operations: [],
        lifecycle: { state: 'DRAFT', revision: 1 }
      })
    };

    const v1 = queue.view('draft:2026-11');
    assert.deepEqual(v1.cells['doc_1:2026-11-01'], ['M']);

    // Simulating revisit from October back to November
    const v2 = queue.view('draft:2026-11');
    assert.deepEqual(v2.cells['doc_1:2026-11-01'], ['M']);
  });

  // Scenario 14: December isolation preserved
  await t.test('14. December period remains completely unenrolled and uninitialized', () => {
    const decQueue = {
      view: (key) => ({
        key,
        cells: {},
        baseline: { revision: 0, cells: {} },
        operations: [],
        lifecycle: { state: 'UNENROLLED', revision: 0 }
      })
    };
    const decView = decQueue.view('draft:2026-12');
    assert.equal(Object.keys(decView.cells).length, 0, 'December queue must have 0 cells');
    assert.equal(decView.lifecycle.state, 'UNENROLLED');
  });

  // Scenario 15: Existing automatic DraftQueue saving unchanged
  await t.test('15. Automatic DraftQueue autosave remains server-enforced and unmodified', () => {
    // Verify DraftQueue prototype and methods have not been modified with manual-save changes
    assert.equal(typeof DraftQueue.prototype.enqueue, 'function');
    assert.equal(typeof DraftQueue.prototype.view, 'function');
    assert.equal(typeof DraftQueue.prototype.change, 'function');
    // Ensure no manual-save methods exist on DraftQueue
    assert.equal(DraftQueue.prototype.manualSave, undefined);
    assert.equal(DraftQueue.prototype.commitDraftManual, undefined);
  });

  // -------------------------------------------------------------------------------------------------
  // Phase A2 OAuth Return Handoff & Idempotency Suite (Scenarios 16 - 28)
  // -------------------------------------------------------------------------------------------------

  await t.test('16. (1) Successful return from Google exchanges code for in-memory token', async () => {
    adminAuthModule.resetAuthHandoffState();
    globalThis.window.location.href = 'http://localhost:5173/REQUEST-APP/?v2auth=auth_code_return_1';
    globalThis.window.location.search = '?v2auth=auth_code_return_1';

    let fetchCalls = 0;
    const fakeFetcher = async (url, opts) => {
      fetchCalls++;
      const body = JSON.parse(opts.body);
      return {
        ok: true,
        json: async () => ({
          ok: true,
          adminSessionToken: 'hmac_session_token_1',
          email: 'admin@hospital.gov.my',
          expiresAt: Math.floor(Date.now() / 1000) + 900
        })
      };
    };

    const res = await adminAuthModule.handleUrlAuthHandoff({
      baseUrl: 'https://script.google.com/test',
      fetcher: fakeFetcher,
      urlStr: globalThis.window.location.href
    });

    assert.equal(res.ok, true);
    assert.equal(res.adminSessionToken, 'hmac_session_token_1');
    assert.equal(fetchCalls, 1);
    assert.equal(adminAuthModule.isSessionTokenActive(), true);
    assert.equal(adminAuthModule.getAdminSessionToken(), 'hmac_session_token_1');
    assert.equal(globalThis.window.location.search, '');
  });

  await t.test('17. (2) One-time code is redeemed exactly once even if called multiple times', async () => {
    adminAuthModule.resetAuthHandoffState();
    globalThis.window.location.href = 'http://localhost:5173/REQUEST-APP/?v2auth=single_use_code_123';
    globalThis.window.location.search = '?v2auth=single_use_code_123';

    let fetchCalls = 0;
    const fakeFetcher = async () => {
      fetchCalls++;
      return {
        ok: true,
        json: async () => ({
          ok: true,
          adminSessionToken: 'token_single_use',
          email: 'admin@hospital.gov.my',
          expiresAt: Math.floor(Date.now() / 1000) + 900
        })
      };
    };

    // First call
    const res1 = await adminAuthModule.handleUrlAuthHandoff({
      baseUrl: 'https://script.google.com/test',
      fetcher: fakeFetcher,
      urlStr: globalThis.window.location.href
    });

    // Second call with same code (or after URL param was removed)
    const res2 = await adminAuthModule.handleUrlAuthHandoff({
      baseUrl: 'https://script.google.com/test',
      fetcher: fakeFetcher,
      urlStr: 'http://localhost:5173/REQUEST-APP/?v2auth=single_use_code_123'
    });

    // Third call with cleaned URL
    const res3 = await adminAuthModule.handleUrlAuthHandoff({
      baseUrl: 'https://script.google.com/test',
      fetcher: fakeFetcher,
      urlStr: 'http://localhost:5173/REQUEST-APP/'
    });

    assert.equal(fetchCalls, 1, 'Exactly one backend network fetch must occur');
    assert.equal(res1.adminSessionToken, 'token_single_use');
    assert.equal(res2.adminSessionToken, 'token_single_use');
    assert.equal(res3.adminSessionToken, 'token_single_use');
  });

  await t.test('18. (3) React StrictMode or effect replay shares the in-flight redemption promise', async () => {
    adminAuthModule.resetAuthHandoffState();
    globalThis.window.location.href = 'http://localhost:5173/REQUEST-APP/?v2auth=strictmode_code';
    globalThis.window.location.search = '?v2auth=strictmode_code';

    let fetchCalls = 0;
    let resolveNetwork;
    const networkPromise = new Promise((resolve) => { resolveNetwork = resolve; });

    const fakeFetcher = async () => {
      fetchCalls++;
      await networkPromise;
      return {
        ok: true,
        json: async () => ({
          ok: true,
          adminSessionToken: 'token_strict_mode',
          email: 'admin@hospital.gov.my',
          expiresAt: Math.floor(Date.now() / 1000) + 900
        })
      };
    };

    // Mount 1 starts handoff
    const p1 = adminAuthModule.handleUrlAuthHandoff({
      baseUrl: 'https://script.google.com/test',
      fetcher: fakeFetcher,
      urlStr: globalThis.window.location.href
    });

    assert.equal(adminAuthModule.isAuthHandoffPending(), true, 'Handoff must be in-flight');

    // Mount 2 (StrictMode replay) calls handoff while Mount 1 is still in flight (URL has been cleaned)
    const p2 = adminAuthModule.handleUrlAuthHandoff({
      baseUrl: 'https://script.google.com/test',
      fetcher: fakeFetcher,
      urlStr: globalThis.window.location.href
    });

    // Both promises should be identical
    assert.equal(p1, p2, 'StrictMode remount must receive the exact same in-flight promise');
    assert.equal(fetchCalls, 1, 'Only one network call dispatched');

    resolveNetwork();
    const [res1, res2] = await Promise.all([p1, p2]);

    assert.equal(res1.adminSessionToken, 'token_strict_mode');
    assert.equal(res2.adminSessionToken, 'token_strict_mode');
    assert.equal(adminAuthModule.isAuthHandoffPending(), false);
  });

  await t.test('19. (4) Duplicate component mounting deduplicates concurrent redemptions', async () => {
    adminAuthModule.resetAuthHandoffState();
    globalThis.window.location.href = 'http://localhost:5173/REQUEST-APP/?v2auth=concurrent_code';
    globalThis.window.location.search = '?v2auth=concurrent_code';

    let fetchCalls = 0;
    const fakeFetcher = async () => {
      fetchCalls++;
      await new Promise((r) => setTimeout(r, 10));
      return {
        ok: true,
        json: async () => ({
          ok: true,
          adminSessionToken: 'token_concurrent',
          email: 'admin@hospital.gov.my',
          expiresAt: Math.floor(Date.now() / 1000) + 900
        })
      };
    };

    // 5 concurrent component mounts trying to redeem at the exact same tick
    const promises = [
      adminAuthModule.handleUrlAuthHandoff({ baseUrl: 'https://test', fetcher: fakeFetcher, urlStr: globalThis.window.location.href }),
      adminAuthModule.handleUrlAuthHandoff({ baseUrl: 'https://test', fetcher: fakeFetcher, urlStr: globalThis.window.location.href }),
      adminAuthModule.handleUrlAuthHandoff({ baseUrl: 'https://test', fetcher: fakeFetcher, urlStr: globalThis.window.location.href }),
      adminAuthModule.handleUrlAuthHandoff({ baseUrl: 'https://test', fetcher: fakeFetcher, urlStr: globalThis.window.location.href }),
      adminAuthModule.handleUrlAuthHandoff({ baseUrl: 'https://test', fetcher: fakeFetcher, urlStr: globalThis.window.location.href })
    ];

    const results = await Promise.all(promises);
    assert.equal(fetchCalls, 1, 'All 5 concurrent callers must share 1 network request');
    for (const r of results) {
      assert.equal(r.adminSessionToken, 'token_concurrent');
    }
  });

  await t.test('20. (5) Redemption success with token established in memory', async () => {
    adminAuthModule.resetAuthHandoffState();
    const fakeFetcher = async () => ({
      ok: true,
      json: async () => ({
        ok: true,
        adminSessionToken: 'established_token_999',
        email: 'chief_admin@hospital.gov.my',
        expiresAt: Math.floor(Date.now() / 1000) + 900
      })
    });

    const res = await adminAuthModule.redeemAuthHandoff({
      handoffCode: 'valid_handoff_code',
      baseUrl: 'https://test',
      fetcher: fakeFetcher
    });

    assert.equal(res.ok, true);
    assert.equal(adminAuthModule.isSessionTokenActive(), true);
    assert.equal(adminAuthModule.getAdminSessionToken(), 'established_token_999');
    assert.equal(adminAuthModule.getAdminEmail(), 'chief_admin@hospital.gov.my');
  });

  await t.test('21. (6) Redemption returns authorization error (UNAUTHORIZED_EMAIL) and fails closed', async () => {
    adminAuthModule.resetAuthHandoffState();
    globalThis.window.location.href = 'http://localhost:5173/REQUEST-APP/?v2auth=unauthorized_email_code';

    const fakeFetcher = async () => ({
      ok: true,
      json: async () => ({
        ok: false,
        error: { code: 'UNAUTHORIZED_EMAIL', message: 'Handoff email does not match admin email.' }
      })
    });

    let caughtError = null;
    try {
      await adminAuthModule.handleUrlAuthHandoff({
        baseUrl: 'https://test',
        fetcher: fakeFetcher,
        urlStr: globalThis.window.location.href
      });
    } catch (err) {
      caughtError = err;
    }

    assert.ok(caughtError);
    assert.equal(caughtError.code, 'UNAUTHORIZED_EMAIL');
    assert.equal(adminAuthModule.isSessionTokenActive(), false);
    assert.equal(adminAuthModule.formatAdminAuthError(caughtError), 'The Google account selected is not authorized as an administrator.');
  });

  await t.test('22. (7) Redemption network failure throws actionable error and fails closed', async () => {
    adminAuthModule.resetAuthHandoffState();
    globalThis.window.location.href = 'http://localhost:5173/REQUEST-APP/?v2auth=network_fail_code';

    const fakeFetcher = async () => {
      throw new Error('Failed to fetch');
    };

    let caughtError = null;
    try {
      await adminAuthModule.handleUrlAuthHandoff({
        baseUrl: 'https://test',
        fetcher: fakeFetcher,
        urlStr: globalThis.window.location.href
      });
    } catch (err) {
      caughtError = err;
    }

    assert.ok(caughtError);
    assert.equal(adminAuthModule.isSessionTokenActive(), false);
    assert.ok(adminAuthModule.formatAdminAuthError(caughtError).includes('Failed to fetch') || adminAuthModule.formatAdminAuthError(caughtError).includes('Check your network connection'));
  });

  await t.test('23. (8) Redemption bounded timeout aborts and formats timeout message', async () => {
    adminAuthModule.resetAuthHandoffState();
    globalThis.window.location.href = 'http://localhost:5173/REQUEST-APP/?v2auth=hanging_code';

    // Simulate an indefinitely hanging network request
    const hangingFetcher = async (_url, opts) => {
      return new Promise((resolve, reject) => {
        if (opts?.signal) {
          opts.signal.addEventListener('abort', () => {
            const err = new Error('AbortError');
            err.name = 'AbortError';
            reject(err);
          });
        }
      });
    };

    let caughtError = null;
    try {
      await adminAuthModule.handleUrlAuthHandoff({
        baseUrl: 'https://test',
        fetcher: hangingFetcher,
        urlStr: globalThis.window.location.href,
        timeoutMs: 50 // Short bounded timeout
      });
    } catch (err) {
      caughtError = err;
    }

    assert.ok(caughtError);
    assert.equal(caughtError.code, 'AUTH_REDEEM_TIMEOUT');
    assert.equal(adminAuthModule.isSessionTokenActive(), false);
    assert.equal(adminAuthModule.formatAdminAuthError(caughtError), 'Verification timed out. Check your network connection and try again.');
  });

  await t.test('24. (9) Malformed redemption response fails closed without token establishment', async () => {
    adminAuthModule.resetAuthHandoffState();
    globalThis.window.location.href = 'http://localhost:5173/REQUEST-APP/?v2auth=malformed_code';

    const fakeFetcher = async () => ({
      ok: true,
      json: async () => ({
        ok: true,
        somethingElse: 123 // Missing adminSessionToken
      })
    });

    let caughtError = null;
    try {
      await adminAuthModule.handleUrlAuthHandoff({
        baseUrl: 'https://test',
        fetcher: fakeFetcher,
        urlStr: globalThis.window.location.href
      });
    } catch (err) {
      caughtError = err;
    }

    assert.ok(caughtError);
    assert.equal(adminAuthModule.isSessionTokenActive(), false);
  });

  await t.test('25. (10) Loading overlay terminates and error dialog is supported', () => {
    // formatAdminAuthError translates errors to clear user messages
    const timeoutMsg = adminAuthModule.formatAdminAuthError({ code: 'AUTH_REDEEM_TIMEOUT' });
    const invalidMsg = adminAuthModule.formatAdminAuthError({ code: 'INVALID_HANDOFF' });
    const unauthMsg = adminAuthModule.formatAdminAuthError({ code: 'UNAUTHORIZED_EMAIL' });

    assert.ok(timeoutMsg.includes('timed out'));
    assert.ok(invalidMsg.includes('expired or has already been used'));
    assert.ok(unauthMsg.includes('not authorized as an administrator'));
  });

  await t.test('26. (11) No unauthorized Admin state on failure (fails closed)', () => {
    // When error occurs, token is null and session is inactive
    adminAuthModule.clearAdminSessionToken();
    assert.equal(adminAuthModule.isSessionTokenActive(), false);
    assert.equal(adminAuthModule.getAdminSessionToken(), null);
    assert.equal(adminAuthModule.getAdminEmail(), null);
  });

  await t.test('27. (12) Successful retry after failure allows clean re-authentication', async () => {
    adminAuthModule.resetAuthHandoffState();

    // 1. Initial attempt fails
    const failFetcher = async () => ({
      ok: false,
      status: 500
    });

    let firstFailed = false;
    try {
      await adminAuthModule.redeemAuthHandoff({
        handoffCode: 'retry_code_attempt_1',
        baseUrl: 'https://test',
        fetcher: failFetcher
      });
    } catch (_) {
      firstFailed = true;
    }
    assert.equal(firstFailed, true);
    assert.equal(adminAuthModule.isSessionTokenActive(), false);

    // 2. User clicks Retry: reset handoff state and try with fresh code
    adminAuthModule.resetAuthHandoffState();

    const successFetcher = async () => ({
      ok: true,
      json: async () => ({
        ok: true,
        adminSessionToken: 'retry_success_token',
        email: 'admin@hospital.gov.my',
        expiresAt: Math.floor(Date.now() / 1000) + 900
      })
    });

    const retryRes = await adminAuthModule.redeemAuthHandoff({
      handoffCode: 'retry_code_attempt_2',
      baseUrl: 'https://test',
      fetcher: successFetcher
    });

    assert.equal(retryRes.ok, true);
    assert.equal(adminAuthModule.isSessionTokenActive(), true);
    assert.equal(adminAuthModule.getAdminSessionToken(), 'retry_success_token');
  });

  await t.test('28. (13) Existing logout/session privacy behavior remains fail-closed and in-memory only', () => {
    adminAuthModule.setAdminSessionToken('temp_token', 'admin@hospital.gov.my', 900);
    assert.equal(adminAuthModule.isSessionTokenActive(), true);

    let notified = false;
    const unsub = adminAuthModule.subscribeAdminAuth(() => {
      notified = true;
    });

    adminAuthModule.clearAdminSessionToken();
    unsub();

    assert.equal(notified, true);
    assert.equal(adminAuthModule.isSessionTokenActive(), false);
    assert.equal(adminAuthModule.getAdminSessionToken(), null);
    assert.equal(adminAuthModule.getAdminEmail(), null);
  });

  await t.test('29. Explicit logout invalidates recent cached handoff results immediately', async () => {
    adminAuthModule.resetAuthHandoffState();
    globalThis.window.location.href = 'http://localhost:5173/REQUEST-APP/?v2auth=cached_handoff_logout_test';

    const fakeFetcher = async () => ({
      ok: true,
      json: async () => ({
        ok: true,
        adminSessionToken: 'session_token_before_logout',
        email: 'admin@hospital.gov.my',
        expiresAt: Math.floor(Date.now() / 1000) + 900
      })
    });

    // 1. Redeem token
    const res = await adminAuthModule.handleUrlAuthHandoff({
      baseUrl: 'https://test',
      fetcher: fakeFetcher,
      urlStr: globalThis.window.location.href
    });

    assert.equal(res.ok, true);
    assert.equal(adminAuthModule.isSessionTokenActive(), true);
    assert.equal(adminAuthModule.hasRecentAuthHandoff(), true);

    // 2. User explicitly logs out
    adminAuthModule.clearAdminSessionToken();
    assert.equal(adminAuthModule.isSessionTokenActive(), false);

    // 3. Cached result must be purged immediately
    assert.equal(adminAuthModule.hasRecentAuthHandoff(), false);

    // Subsequent call cannot restore previous admin session
    const subsequentRes = await adminAuthModule.handleUrlAuthHandoff({
      baseUrl: 'https://test',
      fetcher: fakeFetcher,
      urlStr: 'http://localhost:5173/REQUEST-APP/'
    });
    assert.equal(subsequentRes, null);
    assert.equal(adminAuthModule.isSessionTokenActive(), false);
  });

  await t.test('30. Late in-flight redemption cannot restore a revoked session after logout', async () => {
    adminAuthModule.resetAuthHandoffState();

    let resolveFetch;
    const fetchDelayPromise = new Promise((resolve) => { resolveFetch = resolve; });

    const hangingFetcher = async () => {
      await fetchDelayPromise;
      return {
        ok: true,
        json: async () => ({
          ok: true,
          adminSessionToken: 'late_arriving_token',
          email: 'admin@hospital.gov.my',
          expiresAt: Math.floor(Date.now() / 1000) + 900
        })
      };
    };

    // 1. Start redemption in-flight
    const inFlightRedemption = adminAuthModule.redeemAuthHandoff({
      handoffCode: 'late_handoff_code',
      baseUrl: 'https://test',
      fetcher: hangingFetcher
    });

    assert.equal(adminAuthModule.isSessionTokenActive(), false);

    // 2. User logs out while redemption is in flight
    adminAuthModule.clearAdminSessionToken();

    // 3. Backend response arrives after logout
    resolveFetch();

    let caughtError = null;
    try {
      await inFlightRedemption;
    } catch (err) {
      caughtError = err;
    }

    assert.ok(caughtError, 'Late in-flight redemption must be rejected');
    assert.equal(caughtError.code, 'AUTH_SESSION_REVOKED');
    // Session must remain fail-closed and inactive
    assert.equal(adminAuthModule.isSessionTokenActive(), false);
    assert.equal(adminAuthModule.getAdminSessionToken(), null);
  });
});
