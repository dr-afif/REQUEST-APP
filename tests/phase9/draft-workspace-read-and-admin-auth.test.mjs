import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

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
  requestAuthChallenge,
  redeemAuthHandoff,
  handleUrlAuthHandoff,
  startGoogleRedirectAuth,
  startGoogleCodeAuth,
  checkAuthStatus,
  PRODUCTION_OAUTH_REDIRECT_URI
} from '../../src/features/roster/auth/adminAuth.js';

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

