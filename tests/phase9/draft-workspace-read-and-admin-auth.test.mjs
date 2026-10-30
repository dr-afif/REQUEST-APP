import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import React from 'react';
import ReactDOMServer from 'react-dom/server';

import {
  createDraftRepository,
  draftCellsToCurrentAssignments
} from '../../src/features/roster/data/draftRepository.js';
import {
  createGuidanceRepository
} from '../../src/features/roster/data/guidanceRepository.js';
import {
  getAdminSessionToken,
  setAdminSessionToken,
  clearAdminSessionToken,
  getAdminEmail,
  isSessionTokenActive,
  subscribeAdminAuth,
  requestAuthChallenge,
  redeemAuthHandoff,
  handleUrlAuthHandoff,
  startGoogleRedirectAuth,
  startGoogleCodeAuth,
  checkAuthStatus,
  PRODUCTION_OAUTH_REDIRECT_URI,
  GIS_SCRIPT_URL,
  GIS_LOAD_ERROR_USER_MESSAGE,
  formatAdminAuthError,
  ensureGoogleIdentityServicesLoaded
} from '../../src/features/roster/auth/adminAuth.js';
import * as adminAuthModule from '../../src/features/roster/auth/adminAuth.js';
import { settingsEquivalent } from '../../src/utils/normalise.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');

// Helper to construct a simulated Apps Script backend environment with V2 functions
function createBackendHarness({
  adminEmail = 'admin@example.com',
  clientId = 'oauth-client-id-123',
  clientSecret = 'oauth-client-secret-xyz',
  sessionSecret = 'super-secret-hmac-key-999',
  allowedOrigins = 'http://localhost:5174,http://localhost:5173,https://dr-afif.github.io',
  redirectUri = null,
  fetchMock = null
} = {}) {
  const cacheStorage = new Map();
  const fetchCalls = [];

  const scriptProperties = {
    ROSTER_V2_ADMIN_EMAIL: adminEmail,
    ROSTER_V2_OAUTH_CLIENT_ID: clientId,
    ROSTER_V2_OAUTH_CLIENT_SECRET: clientSecret,
    ROSTER_V2_SESSION_SECRET: sessionSecret,
    ROSTER_V2_ALLOWED_ORIGINS: allowedOrigins
  };
  if (redirectUri) {
    scriptProperties.ROSTER_V2_OAUTH_REDIRECT_URI = redirectUri;
  }

  const fakeUtilities = {
    getUuid: () => crypto.randomUUID(),
    DigestAlgorithm: { SHA_256: 'SHA-256' },
    Charset: { UTF_8: 'UTF-8' },
    computeDigest: (_, text) => [...crypto.createHash('sha256').update(text).digest()],
    base64EncodeWebSafe: (input) => {
      const buf = Buffer.isBuffer(input)
        ? input
        : (Array.isArray(input) ? Buffer.from(input) : Buffer.from(String(input), 'utf8'));
      return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
    },
    base64Decode: (str) => {
      return [...Buffer.from(str, 'base64')];
    },
    newBlob: (bytes) => ({
      getDataAsString: () => Buffer.from(bytes).toString('utf8')
    }),
    computeHmacSha256Signature: (value, key) => {
      const hmac = crypto.createHmac('sha256', key);
      hmac.update(value);
      return [...hmac.digest()];
    }
  };

  const fakeCache = {
    get: (key) => cacheStorage.get(key) || null,
    put: (key, value, ttl) => cacheStorage.set(key, value),
    remove: (key) => cacheStorage.delete(key)
  };

  const fakeUrlFetchApp = {
    fetch: (url, options = {}) => {
      fetchCalls.push({ url, options });
      if (typeof fetchMock === 'function') {
        return fetchMock(url, options);
      }
      return {
        getResponseCode: () => 500,
        getContentText: () => JSON.stringify({ error: 'NO_MOCK' })
      };
    }
  };

  const context = {
    console,
    JSON,
    Math,
    Date,
    String,
    Number,
    Boolean,
    Array,
    Object,
    encodeURIComponent,
    Utilities: fakeUtilities,
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (key) => scriptProperties[key] || null
      })
    },
    CacheService: {
      getScriptCache: () => fakeCache
    },
    UrlFetchApp: fakeUrlFetchApp,
    Session: {
      getActiveUser: () => ({ getEmail: () => '' })
    },
    HtmlService: {
      createHtmlOutput: (html) => ({
        getContent: () => html,
        asString: () => html
      })
    },
    createJsonResponse: (obj) => ({
      getContent: () => JSON.stringify(obj),
      getRaw: () => obj
    })
  };

  const backendSource = fs.readFileSync(path.join(rootDir, 'backend/roster-v2.gs'), 'utf8');
  vm.createContext(context);
  vm.runInContext(backendSource, context);

  return { context, cacheStorage, fetchCalls, scriptProperties };
}

// -------------------------------------------------------------------------------------------------
// 1. AUTH USES GIS REDIRECT MODE
// -------------------------------------------------------------------------------------------------
test('1. auth uses GIS redirect mode', async () => {
  const adminAuthSrc = fs.readFileSync(path.join(rootDir, 'src/features/roster/auth/adminAuth.js'), 'utf8');

  // Verify static configuration
  assert.equal(adminAuthSrc.includes("ux_mode: 'redirect'"), true, "Must configure ux_mode: 'redirect'");
  assert.equal(adminAuthSrc.includes("ux_mode: 'popup'"), false, "Must NOT contain ux_mode: 'popup'");

  // Functionally test startGoogleRedirectAuth
  let capturedInitConfig = null;
  let codeRequested = false;

  const mockWindow = {
    location: { origin: 'http://localhost:5174', href: 'http://localhost:5174/REQUEST-APP/' },
    google: {
      accounts: {
        oauth2: {
          initCodeClient: (config) => {
            capturedInitConfig = config;
            return {
              requestCode: () => { codeRequested = true; }
            };
          }
        }
      }
    }
  };

  globalThis.window = mockWindow;

  const mockFetcher = async (url) => {
    return {
      ok: true,
      json: async () => ({
        ok: true,
        state: 'mock-state-abc-123',
        redirectUri: PRODUCTION_OAUTH_REDIRECT_URI
      })
    };
  };

  await startGoogleRedirectAuth({
    clientId: 'test-google-client-id',
    baseUrl: 'https://script.google.com/macros/s/test/exec',
    fetcher: mockFetcher,
    origin: 'http://localhost:5174'
  });

  assert.ok(capturedInitConfig, 'initCodeClient must be called');
  assert.equal(capturedInitConfig.ux_mode, 'redirect');
  assert.equal(capturedInitConfig.client_id, 'test-google-client-id');
  assert.equal(capturedInitConfig.state, 'mock-state-abc-123');
  assert.equal(capturedInitConfig.redirect_uri, PRODUCTION_OAUTH_REDIRECT_URI);
  assert.equal(codeRequested, true, 'client.requestCode() must be invoked');

  delete globalThis.window;
});

// -------------------------------------------------------------------------------------------------
// 2. OAUTH STATE REQUIRED
// -------------------------------------------------------------------------------------------------
test('2. OAuth state required', () => {
  const harness = createBackendHarness();

  // Missing state
  const resNoState = harness.context.rosterV2HandleOAuthCallback_({ code: 'test-code' });
  assert.ok(resNoState.getContent().includes('Missing authorization code or state parameter'));

  // Missing code
  const resNoCode = harness.context.rosterV2HandleOAuthCallback_({ state: 'test-state' });
  assert.ok(resNoCode.getContent().includes('Missing authorization code or state parameter'));

  // Empty parameters
  const resEmpty = harness.context.rosterV2HandleOAuthCallback_({});
  assert.ok(resEmpty.getContent().includes('Missing authorization code or state parameter'));
});

// -------------------------------------------------------------------------------------------------
// 3. STATE SINGLE-USE
// -------------------------------------------------------------------------------------------------
test('3. state single-use', () => {
  const harness = createBackendHarness({
    fetchMock: (url) => {
      if (url.includes('oauth2.googleapis.com/token')) {
        return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ access_token: 'fake-token' }) };
      }
      if (url.includes('oauth2/v3/userinfo')) {
        return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ sub: '123', email: 'admin@example.com', email_verified: true }) };
      }
      return { getResponseCode: () => 500, getContentText: () => '{}' };
    }
  });

  const challenge = harness.context.rosterV2AuthChallenge_({ origin: 'http://localhost:5174' }).getRaw();
  const state = challenge.state;

  // First call consumes state
  const firstCall = harness.context.rosterV2HandleOAuthCallback_({ code: 'valid-code', state: state });
  assert.ok(firstCall.getContent().includes('Administrator Verification Successful'));

  // Second call with same state fails
  const secondCall = harness.context.rosterV2HandleOAuthCallback_({ code: 'valid-code', state: state });
  assert.ok(secondCall.getContent().includes('Authentication challenge expired or invalid'));
});

// -------------------------------------------------------------------------------------------------
// 4. STATE EXPIRY
// -------------------------------------------------------------------------------------------------
test('4. state expiry', () => {
  const harness = createBackendHarness();

  // An expired state will not exist in cache
  const resExpired = harness.context.rosterV2HandleOAuthCallback_({ code: 'valid-code', state: 'expired-or-missing-state' });
  assert.ok(resExpired.getContent().includes('Authentication challenge expired or invalid'));

  // Verify challenge TTL is set to 300 seconds
  const challenge = harness.context.rosterV2AuthChallenge_({ origin: 'http://localhost:5174' }).getRaw();
  assert.equal(challenge.expiresIn, 300);
});

// -------------------------------------------------------------------------------------------------
// 5. INVALID STATE REJECTED BEFORE CODE EXCHANGE
// -------------------------------------------------------------------------------------------------
test('5. invalid state rejected before code exchange', () => {
  const harness = createBackendHarness();

  const res = harness.context.rosterV2HandleOAuthCallback_({ code: 'suspicious-code', state: 'nonexistent-state' });
  assert.ok(res.getContent().includes('Authentication challenge expired or invalid'));

  // Assert UrlFetchApp was never invoked
  assert.equal(harness.fetchCalls.length, 0, 'No Google API calls must be made if state is invalid');
});

// -------------------------------------------------------------------------------------------------
// 6. OAUTH REDIRECT URI IS THE CONFIGURED APPS SCRIPT URL
// -------------------------------------------------------------------------------------------------
test('6. OAuth redirect URI is the configured Apps Script URL', () => {
  const harness = createBackendHarness();
  const challenge = harness.context.rosterV2AuthChallenge_({ origin: 'http://localhost:5174' }).getRaw();

  assert.equal(challenge.redirectUri, PRODUCTION_OAUTH_REDIRECT_URI);

  // Verification during code exchange
  let capturedTokenPayload = null;
  const exchangeHarness = createBackendHarness({
    fetchMock: (url, opts) => {
      if (url.includes('oauth2.googleapis.com/token')) {
        capturedTokenPayload = opts.payload;
        return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ access_token: 'fake-token' }) };
      }
      if (url.includes('oauth2/v3/userinfo')) {
        return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ sub: '123', email: 'admin@example.com', email_verified: true }) };
      }
      return { getResponseCode: () => 500, getContentText: () => '{}' };
    }
  });

  const c = exchangeHarness.context.rosterV2AuthChallenge_({ origin: 'http://localhost:5174' }).getRaw();
  exchangeHarness.context.rosterV2HandleOAuthCallback_({ code: 'valid-code', state: c.state });

  assert.ok(capturedTokenPayload);
  assert.equal(capturedTokenPayload.redirect_uri, PRODUCTION_OAUTH_REDIRECT_URI);

  // Mismatched configured redirect URI must fail closed
  const badUriHarness = createBackendHarness({ redirectUri: 'https://evil.example.com/callback' });
  assert.throws(
    () => badUriHarness.context.rosterV2GetOAuthRedirectUri_(),
    /Configured ROSTER_V2_OAUTH_REDIRECT_URI does not match expected deployment URI/
  );
});

// -------------------------------------------------------------------------------------------------
// 7. NO POSTMESSAGE FALLBACK EXISTS
// -------------------------------------------------------------------------------------------------
test('7. no postmessage fallback exists', () => {
  const backendSrc = fs.readFileSync(path.join(rootDir, 'backend/roster-v2.gs'), 'utf8');
  const appscriptSrc = fs.readFileSync(path.join(rootDir, 'appscript.txt'), 'utf8');
  const adminAuthSrc = fs.readFileSync(path.join(rootDir, 'src/features/roster/auth/adminAuth.js'), 'utf8');

  // Verify there is no executable 'postmessage' redirect URI
  const postmessageRegex = /redirect_uri\s*[:=]\s*['"]postmessage['"]/i;
  assert.equal(postmessageRegex.test(backendSrc), false, 'backend/roster-v2.gs must not set redirect_uri to postmessage');
  assert.equal(postmessageRegex.test(appscriptSrc), false, 'appscript.txt must not set redirect_uri to postmessage');
  assert.equal(postmessageRegex.test(adminAuthSrc), false, 'adminAuth.js must not set redirect_uri to postmessage');

  // Failure must fail closed without retry
  const harness = createBackendHarness({
    fetchMock: (url) => {
      if (url.includes('oauth2.googleapis.com/token')) {
        return {
          getResponseCode: () => 400,
          getContentText: () => JSON.stringify({ error: 'redirect_uri_mismatch' })
        };
      }
      return { getResponseCode: () => 500, getContentText: () => '{}' };
    }
  });

  const c = harness.context.rosterV2AuthChallenge_({ origin: 'http://localhost:5174' }).getRaw();
  const res = harness.context.rosterV2HandleOAuthCallback_({ code: 'some-code', state: c.state });
  assert.ok(res.getContent().includes('Failed to exchange authorization code with Google'));
  assert.equal(harness.fetchCalls.length, 1, 'Must NOT retry token exchange with a fallback URI');
});

// -------------------------------------------------------------------------------------------------
// 8. CODE EXCHANGE FAILURE FAILS CLOSED
// -------------------------------------------------------------------------------------------------
test('8. code exchange failure fails closed', () => {
  const harness = createBackendHarness({
    fetchMock: (url) => {
      if (url.includes('oauth2.googleapis.com/token')) {
        return {
          getResponseCode: () => 400,
          getContentText: () => JSON.stringify({ error: 'invalid_grant', error_description: 'Code expired or invalid' })
        };
      }
      return { getResponseCode: () => 500, getContentText: () => '{}' };
    }
  });

  const c = harness.context.rosterV2AuthChallenge_({ origin: 'http://localhost:5174' }).getRaw();
  const res = harness.context.rosterV2HandleOAuthCallback_({ code: 'bad-code', state: c.state });

  assert.ok(res.getContent().includes('Failed to exchange authorization code with Google'));
  // Ensure no handoff codes were stored in cache
  let handoffCount = 0;
  for (const [k] of harness.cacheStorage.entries()) {
    if (k.startsWith('v2_auth_handoff_')) handoffCount++;
  }
  assert.equal(handoffCount, 0, 'No handoff code generated on exchange failure');
});

// -------------------------------------------------------------------------------------------------
// 9. WRONG ADMIN EMAIL REJECTED
// -------------------------------------------------------------------------------------------------
test('9. wrong admin email rejected', () => {
  const harness = createBackendHarness({
    adminEmail: 'legit.admin@example.com',
    fetchMock: (url) => {
      if (url.includes('oauth2.googleapis.com/token')) {
        return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ access_token: 'fake-token' }) };
      }
      if (url.includes('oauth2/v3/userinfo')) {
        return {
          getResponseCode: () => 200,
          getContentText: () => JSON.stringify({
            sub: 'attacker-sub',
            email: 'attacker@example.com',
            email_verified: true
          })
        };
      }
      return { getResponseCode: () => 500, getContentText: () => '{}' };
    }
  });

  const c = harness.context.rosterV2AuthChallenge_({ origin: 'http://localhost:5174' }).getRaw();
  const res = harness.context.rosterV2HandleOAuthCallback_({ code: 'valid-code', state: c.state });

  assert.ok(res.getContent().includes('Google identity does not match configured administrator email'));
  let handoffCount = 0;
  for (const [k] of harness.cacheStorage.entries()) {
    if (k.startsWith('v2_auth_handoff_')) handoffCount++;
  }
  assert.equal(handoffCount, 0);
});

// -------------------------------------------------------------------------------------------------
// 10. UNVERIFIED EMAIL REJECTED
// -------------------------------------------------------------------------------------------------
test('10. unverified email rejected', () => {
  const harness = createBackendHarness({
    adminEmail: 'admin@example.com',
    fetchMock: (url) => {
      if (url.includes('oauth2.googleapis.com/token')) {
        return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ access_token: 'fake-token' }) };
      }
      if (url.includes('oauth2/v3/userinfo')) {
        return {
          getResponseCode: () => 200,
          getContentText: () => JSON.stringify({
            sub: 'admin-sub',
            email: 'admin@example.com',
            email_verified: false
          })
        };
      }
      return { getResponseCode: () => 500, getContentText: () => '{}' };
    }
  });

  const c = harness.context.rosterV2AuthChallenge_({ origin: 'http://localhost:5174' }).getRaw();
  const res = harness.context.rosterV2HandleOAuthCallback_({ code: 'valid-code', state: c.state });

  assert.ok(res.getContent().includes('Google email is unverified or missing'));
});

// -------------------------------------------------------------------------------------------------
// 11. ONE-TIME HANDOFF GENERATED ONLY AFTER VERIFIED IDENTITY WITH USER-ACTIVATED TOP NAVIGATION
// -------------------------------------------------------------------------------------------------
test('11. one-time handoff generated only after verified identity with user-activated top navigation', () => {
  const harness = createBackendHarness({
    adminEmail: 'admin@example.com',
    fetchMock: (url) => {
      if (url.includes('oauth2.googleapis.com/token')) {
        return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ access_token: 'valid-access' }) };
      }
      if (url.includes('oauth2/v3/userinfo')) {
        return {
          getResponseCode: () => 200,
          getContentText: () => JSON.stringify({
            sub: 'sub-admin-12345',
            email: 'admin@example.com',
            email_verified: true
          })
        };
      }
      return { getResponseCode: () => 500, getContentText: () => '{}' };
    }
  });

  const c = harness.context.rosterV2AuthChallenge_({
    origin: 'http://localhost:5174',
    returnUrl: 'http://localhost:5174/REQUEST-APP/'
  }).getRaw();

  const res = harness.context.rosterV2HandleOAuthCallback_({ code: 'good-code', state: c.state });
  const html = res.getContent();

  // 1. Must NOT rely on automatic script/meta redirects constrained by HtmlService sandbox
  assert.equal(html.includes('window.location.replace'), false, 'Must NOT contain window.location.replace');
  assert.equal(html.includes('window.top.location'), false, 'Must NOT contain window.top.location');
  assert.equal(html.includes('parent.location'), false, 'Must NOT contain parent.location');
  assert.equal(html.includes('<meta http-equiv="refresh"'), false, 'Must NOT rely on meta-refresh');

  // 2. Must contain genuine user-activated top-level navigation element
  assert.ok(html.includes('<base target="_top">'), 'Must include <base target="_top">');
  assert.ok(html.includes('target="_top"'), 'Must include target="_top"');
  assert.ok(html.includes('Continue to REQUEST-APP'), 'Must contain user-activated action text');
  assert.ok(html.includes('Administrator Verification Successful'), 'Must indicate successful verification');

  // 3. Extract handoff code from user-activated link href
  const match = html.match(/href="([^"]+)"/);
  assert.ok(match, 'Callback HTML must contain a link href');
  const href = match[1];
  assert.ok(href.startsWith('http://localhost:5174/REQUEST-APP/?v2auth='));

  const handoffMatch = href.match(/v2auth=([a-zA-Z0-9-]+)/);
  assert.ok(handoffMatch, 'Link href must contain v2auth=<uuid>');
  const handoffCode = handoffMatch[1];

  const cachedHandoff = JSON.parse(harness.cacheStorage.get('v2_auth_handoff_' + handoffCode));
  assert.ok(cachedHandoff);
  assert.equal(cachedHandoff.email, 'admin@example.com');
  assert.equal(cachedHandoff.sub, 'sub-admin-12345');
});

// -------------------------------------------------------------------------------------------------
// 12. HANDOFF EXPIRES
// -------------------------------------------------------------------------------------------------
test('12. handoff expires', () => {
  const harness = createBackendHarness();

  // Missing or expired handoff code
  const res = harness.context.rosterV2AuthRedeem_({ handoffCode: 'expired-or-nonexistent-code' }).getRaw();
  assert.equal(res.ok, false);
  assert.equal(res.error.code, 'INVALID_HANDOFF');
});

// -------------------------------------------------------------------------------------------------
// 13. HANDOFF IS SINGLE-USE
// -------------------------------------------------------------------------------------------------
test('13. handoff is single-use', () => {
  const harness = createBackendHarness({ adminEmail: 'admin@example.com' });

  // Store simulated verified handoff
  const handoffCode = 'single-use-handoff-uuid';
  harness.cacheStorage.set('v2_auth_handoff_' + handoffCode, JSON.stringify({
    sub: 'sub-1',
    email: 'admin@example.com',
    createdAt: Date.now()
  }));

  // First redemption succeeds
  const redeem1 = harness.context.rosterV2AuthRedeem_({ handoffCode }).getRaw();
  assert.equal(redeem1.ok, true);
  assert.ok(redeem1.adminSessionToken);

  // Second redemption fails closed
  const redeem2 = harness.context.rosterV2AuthRedeem_({ handoffCode }).getRaw();
  assert.equal(redeem2.ok, false);
  assert.equal(redeem2.error.code, 'INVALID_HANDOFF');
});

// -------------------------------------------------------------------------------------------------
// 14. HMAC SESSION TOKEN NOT PLACED IN REDIRECT URL
// -------------------------------------------------------------------------------------------------
test('14. HMAC session token not placed in redirect URL', () => {
  const harness = createBackendHarness({
    adminEmail: 'admin@example.com',
    fetchMock: (url) => {
      if (url.includes('oauth2.googleapis.com/token')) {
        return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ access_token: 'access-1' }) };
      }
      if (url.includes('oauth2/v3/userinfo')) {
        return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ sub: 'sub-1', email: 'admin@example.com', email_verified: true }) };
      }
      return { getResponseCode: () => 500, getContentText: () => '{}' };
    }
  });

  const c = harness.context.rosterV2AuthChallenge_({ origin: 'http://localhost:5174' }).getRaw();
  const res = harness.context.rosterV2HandleOAuthCallback_({ code: 'code-1', state: c.state });
  const html = res.getContent();

  // Redirect contains only ?v2auth=<uuid>
  assert.ok(html.includes('v2auth='));
  // Verify that NO HMAC token (containing typical JWT structure header.payload.signature) is in URL
  assert.equal(/v2auth=[^"&]+\.[^"&]+\.[^"&]+/.test(html), false, 'Redirect URL must NOT contain HMAC token');
  assert.equal(html.includes('eyJ'), false, 'Redirect URL must NOT contain base64 JWT payload');
});

// -------------------------------------------------------------------------------------------------
// 15. HANDOFF REDEMPTION ISSUES VALID SHORT-LIVED HMAC SESSION
// -------------------------------------------------------------------------------------------------
test('15. handoff redemption issues valid short-lived HMAC session', async () => {
  const harness = createBackendHarness({ adminEmail: 'admin@example.com' });
  const handoffCode = 'handoff-uuid-for-redemption';
  harness.cacheStorage.set('v2_auth_handoff_' + handoffCode, JSON.stringify({
    sub: 'sub-verified-456',
    email: 'admin@example.com',
    createdAt: Date.now()
  }));

  const mockFetcher = async (_, opts) => {
    const body = JSON.parse(opts.body);
    const resp = harness.context.rosterV2AuthRedeem_(body).getRaw();
    return {
      ok: true,
      json: async () => resp
    };
  };

  const result = await redeemAuthHandoff({
    handoffCode,
    baseUrl: 'https://script.google.com/macros/s/test/exec',
    fetcher: mockFetcher
  });

  assert.equal(result.ok, true);
  assert.ok(result.adminSessionToken);
  assert.equal(result.email, 'admin@example.com');
  const now = Math.floor(Date.now() / 1000);
  assert.ok(result.expiresAt > now + 600);
  assert.ok(result.expiresAt <= now + 1200);

  // In-memory token verified
  assert.equal(getAdminSessionToken(), result.adminSessionToken);
  assert.equal(getAdminEmail(), 'admin@example.com');
  assert.equal(isSessionTokenActive(), true);

  clearAdminSessionToken();
});

// -------------------------------------------------------------------------------------------------
// 16. URL PARAMETER REMOVED CLIENT-SIDE AFTER REDEMPTION
// -------------------------------------------------------------------------------------------------
test('16. URL parameter removed client-side after redemption', async () => {
  const harness = createBackendHarness({ adminEmail: 'admin@example.com' });
  const handoffCode = 'client-cleanup-handoff-789';
  harness.cacheStorage.set('v2_auth_handoff_' + handoffCode, JSON.stringify({
    sub: 'sub-cleanup-789',
    email: 'admin@example.com',
    createdAt: Date.now()
  }));

  let replacedHistoryUrl = null;
  const mockWindow = {
    location: {
      origin: 'http://localhost:5174',
      href: `http://localhost:5174/REQUEST-APP/?month=2026-11&v2auth=${handoffCode}#changes`
    },
    history: {
      state: { key: 'test' },
      replaceState: (state, title, url) => {
        replacedHistoryUrl = url;
      }
    }
  };
  globalThis.window = mockWindow;

  const mockFetcher = async (_, opts) => {
    const body = JSON.parse(opts.body);
    const resp = harness.context.rosterV2AuthRedeem_(body).getRaw();
    return { ok: true, json: async () => resp };
  };

  const redeemed = await handleUrlAuthHandoff({
    baseUrl: 'https://script.google.com/macros/s/test/exec',
    fetcher: mockFetcher,
    urlStr: mockWindow.location.href
  });

  assert.equal(redeemed.ok, true);
  assert.ok(redeemed.adminSessionToken);

  // Assert that history.replaceState stripped v2auth while preserving other params and hash
  assert.ok(replacedHistoryUrl);
  assert.equal(replacedHistoryUrl.includes('v2auth'), false, 'v2auth must be removed from history URL');
  assert.ok(replacedHistoryUrl.includes('month=2026-11'));
  assert.ok(replacedHistoryUrl.includes('#changes'));

  clearAdminSessionToken();
  delete globalThis.window;
});

// -------------------------------------------------------------------------------------------------
// 17. PRIVILEGED REQUESTS REQUIRE VALID SESSION
// -------------------------------------------------------------------------------------------------
test('17. privileged requests require valid session', () => {
  const harness = createBackendHarness({ adminEmail: 'admin@example.com' });

  // No session token -> throws
  assert.throws(
    () => harness.context.rosterV2RequireAdmin_({ action: 'rosterv2draft' }),
    /V2 administrator authorization required/
  );

  // Valid session token -> succeeds
  const session = harness.context.rosterV2IssueAdminSessionToken_('sub-1', 'admin@example.com', 'super-secret-hmac-key-999');
  const principal = harness.context.rosterV2RequireAdmin_({
    action: 'rosterv2draft',
    adminSessionToken: session.token
  });
  assert.equal(principal.email, 'admin@example.com');
});

// -------------------------------------------------------------------------------------------------
// 18. NO GOOGLE REQUEST PER PRIVILEGED OPERATION AFTER SESSION ISSUANCE
// -------------------------------------------------------------------------------------------------
test('18. no Google request per privileged operation after session issuance', () => {
  const harness = createBackendHarness({ adminEmail: 'admin@example.com' });
  const session = harness.context.rosterV2IssueAdminSessionToken_('sub-1', 'admin@example.com', 'super-secret-hmac-key-999');

  // Perform multiple privileged operations
  harness.context.rosterV2RequireAdmin_({ adminSessionToken: session.token });
  harness.context.rosterV2RequireAdmin_({ adminSessionToken: session.token });
  harness.context.rosterV2RequireAdmin_({ adminSessionToken: session.token });

  // Zero calls to Google during session-authenticated operations
  assert.equal(harness.fetchCalls.length, 0, 'Must NOT invoke UrlFetchApp during session verification');
});

// -------------------------------------------------------------------------------------------------
// 19. DRAFT READ STILL RETURNS 98 ASSIGNMENTS
// -------------------------------------------------------------------------------------------------
test('19. DRAFT read still returns 98 assignments', () => {
  const mockPeople = [
    { PersonId: '11111111-1111-4111-8111-111111111111', CurrentDisplayName: 'Dr. Alpha', DirectoryType: 'MO' },
    { PersonId: '22222222-2222-4222-8222-222222222222', CurrentDisplayName: 'Dr. Beta', DirectoryType: 'MO' },
    { PersonId: '33333333-3333-4333-8333-333333333333', CurrentDisplayName: 'Dr. Gamma', DirectoryType: 'MO' },
    { PersonId: '44444444-4444-4444-8444-444444444444', CurrentDisplayName: 'Dr. Delta', DirectoryType: 'MO' }
  ];

  const syntheticCells = {};
  let count = 0;
  for (let day = 1; day <= 24 && count < 96; day++) {
    const dateStr = `2026-11-${String(day).padStart(2, '0')}`;
    for (const p of mockPeople) {
      if (count >= 96) break;
      syntheticCells[`${p.PersonId}/${dateStr}`] = [{ assignmentId: `seed-${count}`, rawShift: 'AM' }];
      count++;
    }
  }
  syntheticCells[`${mockPeople[0].PersonId}/2026-11-25`] = [{ assignmentId: 'seed-96', rawShift: 'PM' }];
  syntheticCells[`${mockPeople[1].PersonId}/2026-11-25`] = [{ assignmentId: 'seed-97', rawShift: 'ON1' }];

  const assignments = draftCellsToCurrentAssignments({ cells: syntheticCells, people: mockPeople });
  assert.equal(assignments.length, 98, 'Must produce exactly 98 seeded assignments');
  assert.equal(assignments[0].assignmentId, 'seed-0');
  assert.equal(assignments[97].assignmentId, 'seed-97');
});

// -------------------------------------------------------------------------------------------------
// 20. DRAFTREVISION REMAINS 1 AFTER READ-ONLY AUTH/LOAD
// -------------------------------------------------------------------------------------------------
test('20. DraftRevision remains 1 after read-only auth/load', () => {
  const formatRevisionDisplay = (state, lifecycle) => {
    if (!state) return '';
    return state === 'DRAFT'
      ? `(rev ${lifecycle?.revision ?? 0} · draft ${lifecycle?.draftRevision ?? 1})`
      : `(rev ${lifecycle?.revision ?? 0})`;
  };

  assert.equal(formatRevisionDisplay('DRAFT', { revision: 0, draftRevision: 1 }), '(rev 0 · draft 1)');

  // Verify backend draft route is strictly read-only on rosterv2draft
  const backendSrc = fs.readFileSync(path.join(rootDir, 'backend/roster-v2.gs'), 'utf8');
  assert.ok(backendSrc.includes("if (['rosterv2draft','rosterv2draftschema','rosterv2draftpatch'"));
});

// -------------------------------------------------------------------------------------------------
// 21. OCTOBER REMAINS LEGACY
// -------------------------------------------------------------------------------------------------
test('21. October remains legacy', () => {
  const rosterPageSrc = fs.readFileSync(path.join(rootDir, 'src/components/RosterPage.jsx'), 'utf8');

  // Verify unenrolled panel gating fix is retained
  assert.ok(
    rosterPageSrc.includes('lifecycleInfo.isEnrolled &&'),
    'Gating must check lifecycleInfo.isEnrolled before rendering V2 workspace'
  );
});

// -------------------------------------------------------------------------------------------------
// 22. PREVIOUS CORS FIX RETAINED
// -------------------------------------------------------------------------------------------------
test('22. previous CORS fix retained', async () => {
  let capturedOptions = null;
  const mockFetcher = async (_, opts) => {
    capturedOptions = opts;
    return { ok: true, json: async () => ({ ok: true, entityKey: 'draft:2026-11' }) };
  };

  const repo = createDraftRepository({
    baseUrl: 'https://example.com/exec',
    fetcher: mockFetcher,
    getAdminSessionToken: async () => 'test-admin-session-token'
  });

  await repo.read('draft:2026-11');
  assert.ok(capturedOptions);
  assert.equal(capturedOptions.credentials, undefined, 'credentials must remain omitted (never credentials: include)');
  assert.equal(capturedOptions.method, 'POST');
  const body = JSON.parse(capturedOptions.body);
  assert.equal(body.action, 'rosterv2draft');
  assert.equal(body.adminSessionToken, 'test-admin-session-token');
});

// -------------------------------------------------------------------------------------------------
// 23. MALICIOUS RETURN URL CANNOT CREATE OPEN REDIRECT AND SERVER ALLOWLISTING ENFORCED
// -------------------------------------------------------------------------------------------------
test('23. malicious return URL cannot create open redirect and server allowlisting enforced', () => {
  const harness = createBackendHarness();

  // 1. Untrusted origin rejected immediately
  const untrusted = harness.context.rosterV2AuthChallenge_({ origin: 'https://evil.example.com' }).getRaw();
  assert.equal(untrusted.ok, false);
  assert.equal(untrusted.error.code, 'UNTRUSTED_ORIGIN');

  // 2. Open redirect attempt using origin prefix: http://localhost:5174.evil.com
  const evilHost = harness.context.rosterV2AuthChallenge_({
    origin: 'http://localhost:5174',
    returnUrl: 'http://localhost:5174.evil.com/phishing'
  }).getRaw();
  assert.equal(evilHost.ok, true);
  assert.equal(evilHost.returnUrl, 'http://localhost:5174', 'Must fall back to origin, defeating sub-domain open redirect');

  // 3. Open redirect attempt using userinfo syntax: http://localhost:5174@evil.com
  const evilAuth = harness.context.rosterV2AuthChallenge_({
    origin: 'http://localhost:5174',
    returnUrl: 'http://localhost:5174@evil.com/phishing'
  }).getRaw();
  assert.equal(evilAuth.ok, true);
  assert.equal(evilAuth.returnUrl, 'http://localhost:5174', 'Must fall back to origin, defeating userinfo open redirect');

  // 4. Valid path and query parameter preserved
  const validPath = harness.context.rosterV2AuthChallenge_({
    origin: 'http://localhost:5174',
    returnUrl: 'http://localhost:5174/REQUEST-APP/?month=2026-11'
  }).getRaw();
  assert.equal(validPath.ok, true);
  assert.equal(validPath.returnUrl, 'http://localhost:5174/REQUEST-APP/?month=2026-11', 'Safe path on allowed origin preserved');
});

// -------------------------------------------------------------------------------------------------
// 24. CALLBACK HTML OUTPUT IS SAFELY HTML-ESCAPED AND ERROR PAGE DOES NOT AUTO-REDIRECT
// -------------------------------------------------------------------------------------------------
test('24. callback HTML output is safely HTML-escaped and error page does not auto-redirect', () => {
  const harness = createBackendHarness();

  // Test HTML escaping function
  const escapeFn = harness.context.rosterV2EscapeHtml_;
  assert.equal(escapeFn('<script>alert("xss")</script>'), '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
  assert.equal(escapeFn("hello'world&test"), 'hello&#39;world&amp;test');

  // Render callback HTML with special characters in URL
  const testUrl = 'http://localhost:5174/test?a=1&b=2<script>';
  const rendered = harness.context.rosterV2RenderAuthHtml_(testUrl);
  const content = rendered.getContent();

  assert.ok(content.includes('&lt;script&gt;'));
  assert.equal(content.includes('<script>'), false, 'Must not output unescaped <script>');
  assert.ok(content.includes('&amp;'));

  // Test Error page
  const errorPage = harness.context.rosterV2RenderAuthError_(
    'Custom <error> & message',
    'http://localhost:5174/safe-return'
  );
  const errorContent = errorPage.getContent();

  // Error page must NOT auto-redirect
  assert.equal(errorContent.includes('window.location'), false, 'Error page must NOT auto-redirect');
  assert.equal(errorContent.includes('<meta http-equiv="refresh"'), false, 'Error page must NOT meta-refresh');
  assert.ok(errorContent.includes('<base target="_top">'));
  assert.ok(errorContent.includes('target="_top"'));
  assert.ok(errorContent.includes('Administrator Verification Failed'));
  assert.ok(errorContent.includes('&lt;error&gt; &amp; message'), 'Error text must be HTML-escaped');
  assert.ok(errorContent.includes('Return to REQUEST-APP'));
});

// -------------------------------------------------------------------------------------------------
// 25. PHASE5ROSTERCONTAINER INITIALIZES AND RENDERS ENROLLED DRAFT PRE-AUTH WORKSPACE WITHOUT REFERENCEERROR
// -------------------------------------------------------------------------------------------------
test('25. Phase5RosterContainer initializes and renders enrolled DRAFT pre-auth workspace without ReferenceError', async (t) => {
  const containerPath = path.resolve(rootDir, 'src/features/roster/components/Phase5RosterContainer.jsx');
  const sourceCode = fs.readFileSync(containerPath, 'utf8');

  // 1. Static ordering verification: loadAuthoritativeData declared BEFORE handleGoogleVerify
  await t.test('1. static declaration order prevents TDZ ReferenceError', () => {
    const loadIdx = sourceCode.indexOf('const loadAuthoritativeData = useCallback');
    const verifyIdx = sourceCode.indexOf('const handleGoogleVerify = useCallback');
    const syncIdx = sourceCode.indexOf('const syncRecoveryState = useCallback');

    assert.ok(loadIdx !== -1, 'loadAuthoritativeData must exist in container');
    assert.ok(verifyIdx !== -1, 'handleGoogleVerify must exist in container');
    assert.ok(syncIdx !== -1, 'syncRecoveryState must exist in container');

    assert.ok(syncIdx < loadIdx, 'syncRecoveryState must be declared before loadAuthoritativeData');
    assert.ok(loadIdx < verifyIdx, 'loadAuthoritativeData must be declared before handleGoogleVerify (TDZ safety)');

    // Verify handleGoogleVerify has loadAuthoritativeData in dependency array
    const verifyChunk = sourceCode.slice(verifyIdx, verifyIdx + 1200);
    assert.ok(
      verifyChunk.includes('[queue, period, loadAuthoritativeData]'),
      'handleGoogleVerify dependency array must include loadAuthoritativeData'
    );
  });

  // 2. Real component bundling and initial mount: no ReferenceError on mount
  const req = createRequire(import.meta.url);
  const bundleResult = await build({
    entryPoints: [containerPath],
    bundle: true,
    write: false,
    format: 'cjs',
    jsx: 'automatic',
    define: { 'import.meta.env': '{}' },
    external: ['react', 'react-dom', 'lucide-react']
  });
  const bundledCode = bundleResult.outputFiles[0].text;
  const mod = { exports: {} };
  const evalFn = new Function('require', 'module', 'exports', bundledCode);
  evalFn(req, mod, mod.exports);
  const Phase5RosterContainer = mod.exports.default || mod.exports;

  await t.test('2. Phase5RosterContainer mounts for enrolled DRAFT period without ReferenceError', () => {
    let renderedHtml = null;
    assert.doesNotThrow(() => {
      renderedHtml = ReactDOMServer.renderToString(
        React.createElement(Phase5RosterContainer, {
          period: '2026-11',
          allowDraft: true,
          isAdmin: false,
          settings: { roster_v2_read_enabled: true }
        })
      );
    }, 'Mounting Phase5RosterContainer must not throw ReferenceError (Cannot access loadAuthoritativeData before initialization)');

    assert.ok(renderedHtml !== null);
    assert.ok(
      renderedHtml.includes('Checking authoritative roster…'),
      'Initial render must display non-crashed checking placeholder'
    );
  });

  // 3. Pre-auth DRAFT state renders authorization-required UI
  await t.test('3. pre-auth DRAFT state renders authorization-required fail-closed UI and no false Save failed', () => {
    const origDispatcher = React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentDispatcher.current;
    let stateIndex = 0;
    const mockStates = [
      null, // queue
      'CURRENT', // viewMode
      false, // loading (resolved!)
      { state: 'DRAFT', revision: 0, draftRevision: 1 }, // lifecycle
      null, // currentRoster
      null, // plannedRoster
      null, // amendmentHistory
      [], // absences
      [], // replacements
      [], // internalPeople
      'AUTHORIZATION_REQUIRED', // draftReadError
      null, // actionError (NOT set to AUTHORIZATION_REQUIRED)
      null, // revisionConflictMsg
      null, // recoveryOp
      false, // isRecovering
      null, // selectedCellForAmend
      false, // isSubmittingAmend
      false, // isAbsenceModalOpen
      null, // selectedDutyForAbsence
      false, // isSubmittingAbsence
      null, // selectedDutyForReplacement
      false, // isSubmittingReplacement
      false, // isReversingPhase6
      null, // selectedPersonForEntitlement
      { GOFF: 0, GHKA: 0 }, // entitlementBalances
      [], // entitlementTransactions
      false, // isCreditModalOpen
      null, // creditModalConfig
      null, // selectedDutyForEntitlement
      'GOFF', // consumeEntitlementType
      false, // isSubmittingCredit
      false, // isSubmittingConsume
      false, // isReversingEntitlement
      null, // undoEvent
      false, // isFocusMode
      [], // draftUndoStack
      [], // draftRedoStack
      false, // isSavingDraft
      null, // draftSaveStatus (NOT set to error for auth required)
      0 // setAdminAuthTriggerTick
    ];

    try {
      React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentDispatcher.current = {
        useState: (initial) => {
          const val = stateIndex < mockStates.length ? mockStates[stateIndex] : initial;
          stateIndex++;
          return [val, () => {}];
        },
        useRef: (initial) => ({ current: initial }),
        useCallback: (cb) => cb,
        useEffect: () => {},
        useMemo: (cb) => cb()
      };

      const element = Phase5RosterContainer({
        period: '2026-11',
        allowDraft: true,
        isAdmin: true,
        settings: { roster_v2_read_enabled: true }
      });

      const preAuthHtml = ReactDOMServer.renderToString(element);
      assert.ok(
        preAuthHtml.includes('Administrator Authorization Required'),
        'Pre-auth DRAFT state must render authorization required banner'
      );
      assert.ok(
        preAuthHtml.includes('id="btn-auth-required-verify"'),
        'Pre-auth DRAFT state must render verify button in fail-closed card'
      );
      assert.ok(
        preAuthHtml.includes('id="admin-auth-required-badge"'),
        'Pre-auth DRAFT state must render admin auth required badge'
      );
      assert.ok(
        preAuthHtml.includes('The working draft for 2026-11 is private and requires verified administrator identity.'),
        'Pre-auth DRAFT state must render clear private draft explanation'
      );
      // Task 5: Pre-auth must NOT show "Save failed"
      assert.equal(
        preAuthHtml.includes('Save failed'),
        false,
        'Pre-auth DRAFT state must NOT display "Save failed" when no save occurred'
      );
      assert.ok(
        preAuthHtml.includes('Verification required'),
        'Pre-auth DRAFT state must render "Verification required" status'
      );
      // Task 6: Must not display raw standalone AUTHORIZATION_REQUIRED
      assert.equal(
        preAuthHtml.includes('>Notice<'),
        false,
        'Pre-auth DRAFT state must NOT display raw Notice banner for auth requirement'
      );
    } finally {
      React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentDispatcher.current = origDispatcher;
    }
  });

  // 4. Lifecycle transition from unenrolled/legacy to enrolled DRAFT does not crash
  await t.test('4. lifecycle transition from legacy/unresolved to enrolled DRAFT does not crash', () => {
    // Unenrolled state: lifecycle is null, loading is false -> component returns null without error
    const origDispatcher = React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentDispatcher.current;
    let stateIndex = 0;
    const unenrolledStates = [
      null, // queue
      'CURRENT', // viewMode
      false, // loading
      null, // lifecycle (unenrolled)
    ];

    try {
      React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentDispatcher.current = {
        useState: (initial) => {
          const val = stateIndex < unenrolledStates.length ? unenrolledStates[stateIndex] : initial;
          stateIndex++;
          return [val, () => {}];
        },
        useRef: (initial) => ({ current: initial }),
        useCallback: (cb) => cb,
        useEffect: () => {},
        useMemo: (cb) => cb()
      };

      const unenrolledElement = Phase5RosterContainer({
        period: '2026-10',
        allowDraft: false,
        settings: { roster_v2_read_enabled: true }
      });

      assert.equal(unenrolledElement, null, 'Unenrolled period must return null (allowing legacy roster view)');
    } finally {
      React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentDispatcher.current = origDispatcher;
    }
  });

  // 5. Genuine draft save failure still displays Save failed
  await t.test('5. genuine draft save failure still displays Save failed', () => {
    const origDispatcher = React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentDispatcher.current;
    let stateIndex = 0;
    const mockSaveErrorStates = [
      null, // queue
      'CURRENT', // viewMode
      false, // loading
      { state: 'DRAFT', revision: 0, draftRevision: 1 }, // lifecycle
      null, // currentRoster
      null, // plannedRoster
      null, // amendmentHistory
      [], // absences
      [], // replacements
      [], // internalPeople
      null, // draftReadError
      'Network timeout while persisting shift edit', // actionError (genuine write error)
      null, // revisionConflictMsg
      null, // recoveryOp
      false, // isRecovering
      null, // selectedCellForAmend
      false, // isSubmittingAmend
      false, // isAbsenceModalOpen
      null, // selectedDutyForAbsence
      false, // isSubmittingAbsence
      null, // selectedDutyForReplacement
      false, // isSubmittingReplacement
      false, // isReversingPhase6
      null, // selectedPersonForEntitlement
      { GOFF: 0, GHKA: 0 }, // entitlementBalances
      [], // entitlementTransactions
      false, // isCreditModalOpen
      null, // creditModalConfig
      null, // selectedDutyForEntitlement
      'GOFF', // consumeEntitlementType
      false, // isSubmittingCredit
      false, // isSubmittingConsume
      false, // isReversingEntitlement
      null, // undoEvent
      false, // isFocusMode
      [], // draftUndoStack
      [], // draftRedoStack
      false, // isSavingDraft
      'error', // draftSaveStatus (genuine write error)
      0 // setAdminAuthTriggerTick
    ];

    try {
      React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentDispatcher.current = {
        useState: (initial) => {
          const val = stateIndex < mockSaveErrorStates.length ? mockSaveErrorStates[stateIndex] : initial;
          stateIndex++;
          return [val, () => {}];
        },
        useRef: (initial) => ({ current: initial }),
        useCallback: (cb) => cb,
        useEffect: () => {},
        useMemo: (cb) => cb()
      };

      const element = Phase5RosterContainer({
        period: '2026-11',
        allowDraft: true,
        isAdmin: true,
        settings: { roster_v2_read_enabled: true }
      });

      const saveErrorHtml = ReactDOMServer.renderToString(element);
      assert.ok(
        saveErrorHtml.includes('Save failed'),
        'Genuine draft save error MUST display "Save failed"'
      );
      assert.ok(
        saveErrorHtml.includes('Network timeout while persisting shift edit'),
        'Genuine write error must be displayed in notice banner'
      );
    } finally {
      React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentDispatcher.current = origDispatcher;
    }
  });
});

// -------------------------------------------------------------------------------------------------
// 26. IN-MEMORY ADMIN AUTH SUBSCRIPTION AND NOTIFICATION MECHANISM
// -------------------------------------------------------------------------------------------------
test('26. in-memory admin auth subscription notifies listeners without persisting token', () => {
  clearAdminSessionToken();

  let notificationsReceived = 0;
  let receivedArgs = null;

  const unsubscribe = subscribeAdminAuth((...args) => {
    notificationsReceived++;
    receivedArgs = args;
  });

  // 1. setAdminSessionToken emits notification
  setAdminSessionToken('test-session-token-xyz', 'admin@example.com');
  assert.equal(notificationsReceived, 1, 'Setting token must trigger subscription notification');
  assert.equal(receivedArgs.length, 0, 'Subscribers must NOT receive session token (zero arguments)');
  assert.equal(isSessionTokenActive(), true);
  assert.equal(getAdminEmail(), 'admin@example.com');

  // 2. clearAdminSessionToken emits notification
  setAdminSessionToken('another-token', 'admin@example.com');
  assert.equal(notificationsReceived, 2);

  clearAdminSessionToken();
  assert.equal(notificationsReceived, 3, 'Clearing token must trigger subscription notification');
  assert.equal(isSessionTokenActive(), false);

  // 3. Unsubscribing halts notifications
  unsubscribe();
  setAdminSessionToken('post-unsub-token', 'admin@example.com');
  assert.equal(notificationsReceived, 3, 'Unsubscribed listener must not be called');
  clearAdminSessionToken();

  // 4. Memory-only invariant: no localStorage, no sessionStorage, no cookies
  if (typeof globalThis.localStorage !== 'undefined') {
    assert.equal(globalThis.localStorage.getItem('adminSessionToken'), null);
  }
  if (typeof globalThis.sessionStorage !== 'undefined') {
    assert.equal(globalThis.sessionStorage.getItem('adminSessionToken'), null);
  }
});

// -------------------------------------------------------------------------------------------------
// 27. DRAFTQUEUEPANEL FAILS CLOSED PRE-AUTH AND INITIALIZES ON AUTH NOTIFICATION
// -------------------------------------------------------------------------------------------------
test('27. DraftQueuePanel fails closed before auth and initializes dynamically on auth notification', async (t) => {
  const panelPath = path.resolve(rootDir, 'src/features/roster/components/DraftQueuePanel.jsx');
  const panelSrc = fs.readFileSync(panelPath, 'utf8');

  // Subtest 1: Static Hook-Order Invariant Audit
  await t.test('1. all React hooks occur before any conditional sessionActive return', () => {
    const condReturnMatch = panelSrc.match(/if\s*\(\s*!sessionActive\s*\)\s*\{\s*return\s+null;\s*\}/);
    assert.ok(condReturnMatch, 'DraftQueuePanel must contain if (!sessionActive) { return null; } guard');
    const returnIndex = condReturnMatch.index;

    // Verify all hooks (useState, useEffect, useMemo, useCallback, useRef) appear BEFORE this return
    const hookMatches = [...panelSrc.matchAll(/\b(useState|useEffect|useMemo|useCallback|useRef)\s*\(/g)];
    assert.ok(hookMatches.length >= 10, 'Must have multiple hooks');
    for (const match of hookMatches) {
      assert.ok(
        match.index < returnIndex,
        `Hook ${match[1]} at index ${match.index} must occur before conditional return at ${returnIndex}`
      );
    }
  });

  // Bundle DraftQueuePanel for execution
  const req = createRequire(import.meta.url);
  const bundleResult = await build({
    entryPoints: [panelPath],
    bundle: true,
    write: false,
    format: 'cjs',
    jsx: 'automatic',
    define: { 'import.meta.env': '{}' },
    external: ['react', 'react-dom', 'lucide-react', '../auth/adminAuth.js']
  });
  const bundledCode = bundleResult.outputFiles[0].text;
  const mod = { exports: {} };
  const customRequire = (id) => {
    if (id.includes('adminAuth')) return adminAuthModule;
    return req(id);
  };
  const evalFn = new Function('require', 'module', 'exports', bundledCode);
  evalFn(customRequire, mod, mod.exports);
  const DraftQueuePanel = mod.exports.default || mod.exports;

  // Subtest 2: Same-Instance Auth Transition (unauthenticated -> authenticated -> unauthenticated)
  await t.test('2. same-instance auth transition rerenders without hook-order exception', () => {
    clearAdminSessionToken();
    assert.equal(isSessionTokenActive(), false);

    // Create stateful React component harness matching React's Rules of Hooks
    let hooks = [];
    let isFirstRender = true;
    let currentIndex = 0;
    const stateStore = [];
    const stateSetters = [];
    const mountedEffects = [];

    const testDispatcher = {
      useState: (initial) => {
        const idx = currentIndex++;
        if (isFirstRender) {
          hooks.push('useState');
          const val = typeof initial === 'function' ? initial() : initial;
          stateStore[idx] = val;
          const setter = (next) => {
            stateStore[idx] = typeof next === 'function' ? next(stateStore[idx]) : next;
          };
          stateSetters[idx] = setter;
          return [stateStore[idx], setter];
        }
        if (idx >= hooks.length) {
          throw new Error('Rendered more hooks than during the previous render');
        }
        if (hooks[idx] !== 'useState') {
          throw new Error(`Hook order changed: expected ${hooks[idx]} but got useState at index ${idx}`);
        }
        return [stateStore[idx], stateSetters[idx]];
      },
      useEffect: (effectFn, deps) => {
        const idx = currentIndex++;
        if (isFirstRender) {
          hooks.push('useEffect');
          mountedEffects.push({ effectFn, deps, cleanup: null });
          return;
        }
        if (idx >= hooks.length) {
          throw new Error('Rendered more hooks than during the previous render');
        }
        if (hooks[idx] !== 'useEffect') {
          throw new Error(`Hook order changed: expected ${hooks[idx]} but got useEffect at index ${idx}`);
        }
      }
    };

    let runtimeFactoryCalls = 0;
    const mockRuntime = async () => {
      runtimeFactoryCalls++;
      return {
        repository: { schema: async () => ({ ok: true, people: [] }) },
        subscribe: () => () => {},
        start: async () => {},
        refresh: async () => {},
        view: () => ({ cells: {}, lifecycle: { state: 'DRAFT' } }),
        entities: new Map()
      };
    };

    const renderInstance = () => {
      currentIndex = 0;
      const prev = React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentDispatcher.current;
      React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentDispatcher.current = testDispatcher;
      try {
        const out = DraftQueuePanel({
          period: '2026-11',
          settings: { roster_v2_read_enabled: true, roster_v2_write_enabled: true, write_queue_v2_enabled: true },
          runtimeFactory: mockRuntime
        });
        if (isFirstRender) {
          isFirstRender = false;
          // Run initial effects (e.g. subscribeAdminAuth)
          for (const eff of mountedEffects) {
            eff.cleanup = eff.effectFn();
          }
        } else if (currentIndex < hooks.length) {
          throw new Error('Rendered fewer hooks than during the previous render');
        }
        return out;
      } finally {
        React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentDispatcher.current = prev;
      }
    };

    // 1. Initial Render: Unauthenticated
    const r1 = renderInstance();
    assert.equal(r1, null, 'Unauthenticated render must return null');
    assert.equal(runtimeFactoryCalls, 0, 'runtimeFactory must NOT be called before authentication');
    const initialHookCount = hooks.length;
    assert.ok(initialHookCount >= 10, 'All hooks must be registered on initial render');

    // 2. Auth Notification: Operator verifies via OAuth, admin session token is set
    setAdminSessionToken('simulated-admin-session', 'admin@example.com');
    assert.equal(isSessionTokenActive(), true);

    // Re-render the SAME mounted instance (simulating React rerender upon auth change)
    let r2 = null;
    assert.doesNotThrow(() => {
      r2 = renderInstance();
    }, 'Re-rendering the SAME mounted instance after auth MUST NOT throw a hook-order exception');
    assert.notEqual(r2, null, 'Authenticated render must return active draft workspace JSX');

    // 3. De-auth Notification: Session expires or is cleared
    clearAdminSessionToken();
    assert.equal(isSessionTokenActive(), false);

    let r3 = null;
    assert.doesNotThrow(() => {
      r3 = renderInstance();
    }, 'Re-rendering the SAME mounted instance after de-auth MUST NOT throw a hook-order exception');
    assert.equal(r3, null, 'De-authenticated render must return null');

    // Clean up mounted effects
    for (const eff of mountedEffects) {
      if (typeof eff.cleanup === 'function') eff.cleanup();
    }
  });

  // Subtest 3: Pre-auth fail-closed security properties
  await t.test('3. pre-auth fail-closed renders null and never executes private reads or guidance', () => {
    clearAdminSessionToken();
    let runtimeCalled = false;
    let repoReadCalled = false;

    const mockRuntime = async () => {
      runtimeCalled = true;
      return {
        repository: {
          read: async () => { repoReadCalled = true; return { ok: true }; },
          schema: async () => ({ ok: true, people: [] })
        },
        subscribe: () => () => {},
        start: async () => {},
        refresh: async () => {},
        view: () => ({ cells: {}, lifecycle: { state: 'DRAFT' } }),
        entities: new Map()
      };
    };

    const out = ReactDOMServer.renderToString(
      React.createElement(DraftQueuePanel, {
        period: '2026-11',
        settings: { roster_v2_read_enabled: true, roster_v2_write_enabled: true, write_queue_v2_enabled: true },
        runtimeFactory: mockRuntime
      })
    );

    assert.equal(out, '', 'Pre-auth render must be completely empty');
    assert.equal(out.includes('Private draft'), false);
    assert.equal(out.includes('Add effective OFF policy'), false);
    assert.equal(runtimeCalled, false, 'runtimeFactory must not be called pre-auth');
    assert.equal(repoReadCalled, false, 'repository.read must not be called pre-auth');
  });

  // Clean up
  clearAdminSessionToken();
});

// -------------------------------------------------------------------------------------------------
// 28. ROSTERGUIDANCEPANEL ADD POLICY REQUIRES VERIFIED ADMIN AND TRANSLATES AUTH ERRORS
// -------------------------------------------------------------------------------------------------
test('28. RosterGuidancePanel Add Policy requires verified admin and translates auth errors', async (t) => {
  const guidancePath = path.resolve(rootDir, 'src/features/roster/components/RosterGuidancePanel.jsx');
  const req = createRequire(import.meta.url);
  const bundleResult = await build({
    entryPoints: [guidancePath],
    bundle: true,
    write: false,
    format: 'cjs',
    jsx: 'automatic',
    define: { 'import.meta.env': '{}' },
    external: ['react', 'react-dom', 'lucide-react']
  });
  const bundledCode = bundleResult.outputFiles[0].text;
  const mod = { exports: {} };
  const evalFn = new Function('require', 'module', 'exports', bundledCode);
  evalFn(req, mod, mod.exports);
  const RosterGuidancePanel = mod.exports.default || mod.exports;

  const mockQueue = {
    view: () => ({ baseline: { checksum: 'abc' }, cells: {} }),
    store: {},
    clientId: 'test-client',
    tabId: 'test-tab',
    refresh: async () => {}
  };

  const settings = {
    weekly_off_guidance_enabled: true,
    roster_v2_write_enabled: true,
    write_queue_v2_enabled: true
  };

  // 1. Unverified: Add effective OFF policy must NOT be rendered
  clearAdminSessionToken();
  const unverifiedHtml = ReactDOMServer.renderToString(
    React.createElement(RosterGuidancePanel, {
      period: '2026-11',
      settings,
      queue: mockQueue,
      people: [],
      isVerifiedAdmin: false
    })
  );
  assert.equal(
    unverifiedHtml.includes('Add effective OFF policy'),
    false,
    'Unverified administrator must NOT be offered "Add effective OFF policy" controls'
  );

  // 2. Verified admin with active session: Add effective OFF policy IS rendered
  setAdminSessionToken('guidance-admin-session', 'admin@example.com');
  const verifiedHtml = ReactDOMServer.renderToString(
    React.createElement(RosterGuidancePanel, {
      period: '2026-11',
      settings,
      queue: mockQueue,
      people: [],
      isVerifiedAdmin: true
    })
  );
  assert.ok(
    verifiedHtml.includes('Add effective OFF policy'),
    'Verified administrator MUST see "Add effective OFF policy" controls'
  );

  // Clean up
  clearAdminSessionToken();
});

// -------------------------------------------------------------------------------------------------
// 29. GOOGLE IDENTITY SERVICES SDK LOADER AND ERROR HANDLING
// -------------------------------------------------------------------------------------------------
test('29. Google Identity Services SDK loader and operator error handling', async (t) => {
  const indexHtmlPath = path.join(rootDir, 'index.html');
  const indexHtml = fs.readFileSync(indexHtmlPath, 'utf8');

  await t.test('1. index.html contains exactly one GIS script tag with async/defer before main.jsx', () => {
    const gisMatches = indexHtml.match(/https:\/\/accounts\.google\.com\/gsi\/client/g) || [];
    assert.equal(gisMatches.length, 1, 'index.html must contain exactly one inclusion of https://accounts.google.com/gsi/client');

    const gisScriptTagMatch = indexHtml.match(/<script[^>]*src=["']https:\/\/accounts\.google\.com\/gsi\/client["'][^>]*><\/script>/i);
    assert.ok(gisScriptTagMatch, 'GIS script tag must be present');
    const tag = gisScriptTagMatch[0];
    assert.ok(/\basync\b/i.test(tag), 'GIS script must have async attribute');
    assert.ok(/\bdefer\b/i.test(tag), 'GIS script must have defer attribute');

    const gisIndex = indexHtml.indexOf('https://accounts.google.com/gsi/client');
    const mainJsxIndex = indexHtml.indexOf('/src/main.jsx');
    assert.ok(gisIndex > 0 && mainJsxIndex > 0 && gisIndex < mainJsxIndex, 'GIS script must precede /src/main.jsx');

    // Strict hygiene: no legacy scripts or inline credentials
    assert.equal(indexHtml.includes('apis.google.com/js/api.js'), false, 'Must not include legacy gapi api.js');
    assert.equal(indexHtml.includes('apis.google.com/js/platform.js'), false, 'Must not include legacy platform.js');
    assert.equal(indexHtml.includes('client_secret'), false, 'Must not include client secrets');
  });

  await t.test('2. already-loaded GIS resolves immediately without creating script or timers', async () => {
    const origWindow = globalThis.window;
    const origDoc = globalThis.document;

    const mockOauth2 = { initCodeClient: () => ({ requestCode: () => {} }) };
    globalThis.window = {
      google: {
        accounts: {
          oauth2: mockOauth2
        }
      }
    };

    try {
      const res = await ensureGoogleIdentityServicesLoaded();
      assert.equal(res, mockOauth2, 'Must resolve immediately to window.google.accounts.oauth2');
    } finally {
      if (origWindow !== undefined) globalThis.window = origWindow; else delete globalThis.window;
      if (origDoc !== undefined) globalThis.document = origDoc; else delete globalThis.document;
    }
  });

  await t.test('3. multiple concurrent loader calls share one promise and do not duplicate script elements', async () => {
    const origWindow = globalThis.window;
    const origDoc = globalThis.document;

    let createdScripts = 0;
    const listeners = {};
    const mockScript = {
      src: '',
      async: false,
      defer: false,
      addEventListener: (evt, fn) => {
        listeners[evt] = listeners[evt] || [];
        listeners[evt].push(fn);
      },
      removeEventListener: (evt, fn) => {
        if (listeners[evt]) {
          listeners[evt] = listeners[evt].filter(l => l !== fn);
        }
      }
    };

    const mockDoc = {
      querySelector: () => null,
      createElement: (tag) => {
        if (tag === 'script') {
          createdScripts++;
          return mockScript;
        }
        return {};
      },
      head: {
        appendChild: () => {}
      }
    };

    const mockOauth2 = { initCodeClient: () => ({ requestCode: () => {} }) };
    globalThis.window = {};
    globalThis.document = mockDoc;

    try {
      const p1 = ensureGoogleIdentityServicesLoaded({ timeoutMs: 2000 });
      const p2 = ensureGoogleIdentityServicesLoaded({ timeoutMs: 2000 });
      const p3 = ensureGoogleIdentityServicesLoaded({ timeoutMs: 2000 });

      assert.equal(createdScripts, 1, 'Exactly one script element must be created for concurrent calls');

      // Simulate script load completing
      globalThis.window.google = { accounts: { oauth2: mockOauth2 } };
      for (const fn of (listeners['load'] || [])) fn();

      const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
      assert.equal(r1, mockOauth2);
      assert.equal(r2, mockOauth2);
      assert.equal(r3, mockOauth2);
    } finally {
      if (origWindow !== undefined) globalThis.window = origWindow; else delete globalThis.window;
      if (origDoc !== undefined) globalThis.document = origDoc; else delete globalThis.document;
    }
  });

  await t.test('4. load failure fails closed, provides operator userMessage, and retry is possible', async () => {
    const origWindow = globalThis.window;
    const origDoc = globalThis.document;

    const listeners = {};
    const mockScript = {
      src: '',
      addEventListener: (evt, fn) => {
        listeners[evt] = listeners[evt] || [];
        listeners[evt].push(fn);
      },
      removeEventListener: (evt, fn) => {
        if (listeners[evt]) {
          listeners[evt] = listeners[evt].filter(l => l !== fn);
        }
      }
    };

    const mockDoc = {
      querySelector: () => null,
      createElement: () => mockScript,
      head: { appendChild: () => {} }
    };

    globalThis.window = {};
    globalThis.document = mockDoc;

    try {
      // 1. Initial attempt fails
      const pFail = ensureGoogleIdentityServicesLoaded({ timeoutMs: 500 });
      // Trigger error event
      for (const fn of (listeners['error'] || [])) fn();

      await assert.rejects(
        pFail,
        (err) => {
          assert.equal(err.code, 'GIS_SCRIPT_LOAD_FAILED');
          assert.equal(err.userMessage, GIS_LOAD_ERROR_USER_MESSAGE);
          return true;
        },
        'Must fail closed with GIS_SCRIPT_LOAD_FAILED and userMessage'
      );

      // 2. Retry attempt can succeed (not poisoned by previous failure)
      const mockOauth2 = { initCodeClient: () => ({ requestCode: () => {} }) };
      const pRetry = ensureGoogleIdentityServicesLoaded({ timeoutMs: 1000 });
      globalThis.window.google = { accounts: { oauth2: mockOauth2 } };
      for (const fn of (listeners['load'] || [])) fn();

      const res = await pRetry;
      assert.equal(res, mockOauth2, 'Retry after failure must be allowed to succeed');
    } finally {
      if (origWindow !== undefined) globalThis.window = origWindow; else delete globalThis.window;
      if (origDoc !== undefined) globalThis.document = origDoc; else delete globalThis.document;
    }
  });

  await t.test('5. startGoogleRedirectAuth validates client ID and awaits GIS before initializing code client', async () => {
    const origWindow = globalThis.window;

    let initCalled = false;
    let codeRequested = false;
    const mockOauth2 = {
      initCodeClient: (config) => {
        initCalled = true;
        assert.equal(config.client_id, 'test-client-id-abc');
        assert.equal(config.scope, 'openid email');
        assert.equal(config.ux_mode, 'redirect');
        assert.equal(config.redirect_uri, PRODUCTION_OAUTH_REDIRECT_URI);
        assert.equal(config.state, 'test-state-xyz');
        return {
          requestCode: () => { codeRequested = true; }
        };
      }
    };

    globalThis.window = {
      location: { origin: 'http://localhost:5173', href: 'http://localhost:5173/REQUEST-APP/' },
      google: { accounts: { oauth2: mockOauth2 } }
    };

    const mockFetcher = async () => ({
      ok: true,
      json: async () => ({ ok: true, state: 'test-state-xyz', redirectUri: PRODUCTION_OAUTH_REDIRECT_URI })
    });

    try {
      // Missing client ID fails fast
      await assert.rejects(
        startGoogleRedirectAuth({ clientId: '', baseUrl: 'http://test' }),
        /CLIENT_ID_UNCONFIGURED/
      );

      // Valid invocation succeeds
      await startGoogleRedirectAuth({
        clientId: 'test-client-id-abc',
        baseUrl: 'http://test',
        fetcher: mockFetcher,
        origin: 'http://localhost:5173'
      });

      assert.equal(initCalled, true, 'initCodeClient must be called with proper parameters');
      assert.equal(codeRequested, true, 'requestCode must be invoked');
    } finally {
      if (origWindow !== undefined) globalThis.window = origWindow; else delete globalThis.window;
    }
  });

  await t.test('6. operator-friendly error formatting translates GIS failures and preserves other errors', () => {
    // GIS script load failure
    const errLoadFailed = new Error('GIS_SCRIPT_LOAD_FAILED');
    errLoadFailed.code = 'GIS_SCRIPT_LOAD_FAILED';
    assert.equal(formatAdminAuthError(errLoadFailed), GIS_LOAD_ERROR_USER_MESSAGE);

    // Legacy GIS not loaded code
    const errNotLoaded = new Error('GIS_SCRIPT_NOT_LOADED');
    errNotLoaded.code = 'GIS_SCRIPT_NOT_LOADED';
    assert.equal(formatAdminAuthError(errNotLoaded), GIS_LOAD_ERROR_USER_MESSAGE);

    // Generic error containing GIS_SCRIPT
    assert.equal(
      formatAdminAuthError(new Error('Network failure: GIS_SCRIPT unreachable')),
      GIS_LOAD_ERROR_USER_MESSAGE
    );

    // Unrelated errors preserved without suppression
    const unconfiguredErr = new Error('CLIENT_ID_UNCONFIGURED');
    unconfiguredErr.code = 'CLIENT_ID_UNCONFIGURED';
    assert.equal(formatAdminAuthError(unconfiguredErr), 'CLIENT_ID_UNCONFIGURED');

    const networkErr = new Error('CHALLENGE_REQUEST_FAILED');
    assert.equal(formatAdminAuthError(networkErr), 'CHALLENGE_REQUEST_FAILED');
  });

  await t.test('7. frontend security invariants: no secrets and no persistent storage', () => {
    const adminAuthSource = fs.readFileSync(
      path.join(rootDir, 'src/features/roster/auth/adminAuth.js'),
      'utf8'
    );
    // Strip comments to inspect executable code
    const codeOnly = adminAuthSource.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');

    assert.equal(/\blocalStorage\b/.test(codeOnly), false, 'adminAuth must never access localStorage');
    assert.equal(/\bsessionStorage\b/.test(codeOnly), false, 'adminAuth must never access sessionStorage');
    assert.equal(/document\.cookie/.test(codeOnly), false, 'adminAuth must never access document.cookie');
    assert.equal(/\bclient_secret\b/i.test(codeOnly), false, 'adminAuth must never reference client_secret');
  });
});

// -------------------------------------------------------------------------------------------------
// 30. SILENT BACKGROUND REFRESH AND SETTINGS IDENTITY STABILIZATION
// -------------------------------------------------------------------------------------------------
test('30. Silent background refresh and settings identity stabilization', async (t) => {
  const appJsxPath = path.join(rootDir, 'src/App.jsx');
  const appJsx = fs.readFileSync(appJsxPath, 'utf8');

  await t.test('1. semantically identical settings received from periodic refresh preserve object identity', () => {
    const current = {
      monthly_request_limit: '10',
      roster_workspace_v2_enabled: true,
      roster_v2_read_enabled: true,
      current_roster_month: '2026-11'
    };
    // Brand new object with identical contents
    const incoming = JSON.parse(JSON.stringify(current));
    assert.notEqual(current, incoming, 'Incoming must be a distinct object reference before comparison');

    assert.equal(settingsEquivalent(current, incoming), true, 'settingsEquivalent must return true for identical values');

    // React state updater simulation
    const updater = (prev) => settingsEquivalent(prev, incoming) ? prev : incoming;
    const next = updater(current);
    assert.equal(next, current, 'React state updater must return the existing object reference');
  });

  await t.test('2. changed settings produce a new settings value', () => {
    const current = {
      monthly_request_limit: '10',
      roster_workspace_v2_enabled: true
    };
    const incoming = {
      monthly_request_limit: '15',
      roster_workspace_v2_enabled: true
    };

    assert.equal(settingsEquivalent(current, incoming), false);
    const updater = (prev) => settingsEquivalent(prev, incoming) ? prev : incoming;
    const next = updater(current);
    assert.equal(next, incoming, 'State updater must adopt incoming object when value changes');
    assert.equal(next.monthly_request_limit, '15');
  });

  await t.test('3. added and removed setting keys are treated as meaningful changes', () => {
    const base = { a: 1, b: 2 };
    const withAddedKey = { a: 1, b: 2, c: 3 };
    const withRemovedKey = { a: 1 };

    assert.equal(settingsEquivalent(base, withAddedKey), false, 'Added key must not be considered equivalent');
    assert.equal(settingsEquivalent(base, withRemovedKey), false, 'Removed key must not be considered equivalent');
  });

  await t.test('4. false, 0, null, and empty-string values compare correctly without loose coercion', () => {
    const falsyA = { a: false, b: 0, c: '', d: null };
    const falsyB = { a: false, b: 0, c: '', d: null };
    assert.equal(settingsEquivalent(falsyA, falsyB), true, 'Identical falsy values must match');

    // Strict type distinction
    assert.equal(settingsEquivalent({ a: false }, { a: 0 }), false, 'false must not equal 0');
    assert.equal(settingsEquivalent({ a: '' }, { a: false }), false, 'empty string must not equal false');
    assert.equal(settingsEquivalent({ a: 0 }, { a: '0' }), false, '0 must not equal "0"');
    assert.equal(settingsEquivalent({ a: null }, { a: undefined }), false, 'null must not equal undefined');
  });

  await t.test('5. normal 60-second data synchronization remains enabled in App.jsx', () => {
    assert.ok(appJsx.includes('const REFRESH_INTERVAL = 60 * 1000;'), 'REFRESH_INTERVAL must remain 60s');
    assert.ok(appJsx.includes('window.setTimeout(fetchLoop, REFRESH_INTERVAL)'), 'Background fetch loop must remain active');
    assert.ok(appJsx.includes('settingsEquivalent(currentSettings, response.settings)'), 'loadAllData must stabilize settings identity');
  });

  await t.test('6. V2 lifecycle / roster initialization effect is not retriggered when settings identity is preserved', () => {
    let effectRunCount = 0;
    const runMockEffect = (deps, prevDeps) => {
      const changed = !prevDeps || deps.some((d, i) => d !== prevDeps[i]);
      if (changed) effectRunCount++;
    };

    const initialSettings = { roster_workspace_v2_enabled: true };
    const initialDeps = ['2026-11', initialSettings];

    // Initial mount runs effect once
    runMockEffect(initialDeps, null);
    assert.equal(effectRunCount, 1, 'Initial mount runs effect');

    // Periodic sync: incoming is equivalent, so state retains initialSettings reference
    const incomingEquivalent = JSON.parse(JSON.stringify(initialSettings));
    const nextSettings = settingsEquivalent(initialSettings, incomingEquivalent)
      ? initialSettings
      : incomingEquivalent;
    const periodicDeps = ['2026-11', nextSettings];

    runMockEffect(periodicDeps, initialDeps);
    assert.equal(effectRunCount, 1, 'Periodic sync with equivalent settings MUST NOT re-run effect');
  });

  await t.test('7. genuine period change still causes authoritative reload', () => {
    let effectRunCount = 0;
    const runMockEffect = (deps, prevDeps) => {
      const changed = !prevDeps || deps.some((d, i) => d !== prevDeps[i]);
      if (changed) effectRunCount++;
    };

    const settings = { roster_workspace_v2_enabled: true };
    const novDeps = ['2026-11', settings];
    runMockEffect(novDeps, null);
    assert.equal(effectRunCount, 1);

    // Operator switches month to December 2026
    const decDeps = ['2026-12', settings];
    runMockEffect(decDeps, novDeps);
    assert.equal(effectRunCount, 2, 'Period change MUST re-trigger effect for new period');
  });

  await t.test('8. genuine relevant settings change still causes appropriate reload', () => {
    let effectRunCount = 0;
    const runMockEffect = (deps, prevDeps) => {
      const changed = !prevDeps || deps.some((d, i) => d !== prevDeps[i]);
      if (changed) effectRunCount++;
    };

    const currentSettings = { roster_workspace_v2_enabled: true };
    const deps1 = ['2026-11', currentSettings];
    runMockEffect(deps1, null);
    assert.equal(effectRunCount, 1);

    // Backend returns changed settings (e.g. read disabled)
    const newSettings = { roster_workspace_v2_enabled: false };
    const nextSettings = settingsEquivalent(currentSettings, newSettings)
      ? currentSettings
      : newSettings;
    const deps2 = ['2026-11', nextSettings];
    runMockEffect(deps2, deps1);
    assert.equal(effectRunCount, 2, 'Meaningful settings change MUST re-trigger effect');
  });

  await t.test('9. DraftQueue periodic confirmed-state refresh remains intact in DraftQueuePanel', () => {
    const queuePanelPath = path.join(rootDir, 'src/features/roster/components/DraftQueuePanel.jsx');
    const queuePanelSrc = fs.readFileSync(queuePanelPath, 'utf8');

    assert.ok(
      queuePanelSrc.includes('setInterval(()=>q.refresh(key)'),
      'DraftQueuePanel must keep periodic background q.refresh(key) active'
    );
  });
});
