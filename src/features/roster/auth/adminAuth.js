/**
 * Production-Grade Google Identity Services (GIS) Redirect Mode Flow
 * and Apps-Script-Issued In-Memory HMAC Admin Session Token Manager.
 *
 * Security Invariants:
 * - Browser uses GIS initCodeClient({ ux_mode: 'redirect' }) with minimal scope ('openid email').
 * - Browser NEVER receives client secret, refresh token, or signing secret.
 * - Redirect URI is strictly the Apps Script web-app callback URI (never frontend origin, never postmessage).
 * - OAuth state is server-generated, time-limited, and single-use (CSRF defense).
 * - Apps Script exchanges code, verifies administrator identity via Google UserInfo (never tokeninfo),
 *   and issues a one-time handoff code (120s TTL).
 * - Apps Script redirects back to safe frontend return URL with '?v2auth=<handoff-code>'.
 * - Frontend redeems handoff code via POST rosterv2authredeem, immediately strips '?v2auth='
 *   from URL/history via history.replaceState, and receives the short-lived HMAC-SHA256 session token.
 * - Session token is kept in MEMORY ONLY (never in localStorage, sessionStorage, or URL).
 * - Page refresh requires re-authentication (fails closed).
 */

export const PRODUCTION_OAUTH_REDIRECT_URI =
  'https://script.google.com/macros/s/AKfycbwFNXKmohkgla4JKB819RZSwh7YIsiff87B-mGCZuEJXEe5H_bk5RWHew7VAMWWtv_5jA/exec';

let inMemorySessionToken = null;
let inMemoryAdminEmail = null;
let inMemoryExpiresAt = null;
let inMemoryExpiryTimer = null;

const authListeners = new Set();

export function subscribeAdminAuth(listener) {
  if (typeof listener !== 'function') return () => {};
  authListeners.add(listener);
  return () => {
    authListeners.delete(listener);
  };
}

function notifyAdminAuth() {
  for (const listener of authListeners) {
    try {
      listener();
    } catch (_) {}
  }
}

export function getGoogleClientId() {
  return (import.meta.env?.VITE_GOOGLE_CLIENT_ID || '').trim();
}

export function getAdminSessionToken() {
  if (inMemorySessionToken && inMemoryExpiresAt) {
    const now = Math.floor(Date.now() / 1000);
    if (inMemoryExpiresAt > now) {
      return inMemorySessionToken;
    }
    clearAdminSessionToken();
    return null;
  }
  return inMemorySessionToken || null;
}

export function setAdminSessionToken(token, emailOrExpires = null, maybeExpiresAt = null) {
  if (inMemoryExpiryTimer) {
    clearTimeout(inMemoryExpiryTimer);
    inMemoryExpiryTimer = null;
  }

  let email = null;
  let expiresAt = null;
  if (typeof emailOrExpires === 'number') {
    expiresAt = emailOrExpires;
  } else if (typeof emailOrExpires === 'string') {
    email = emailOrExpires;
    if (typeof maybeExpiresAt === 'number') {
      expiresAt = maybeExpiresAt;
    }
  }

  inMemorySessionToken = token || null;
  inMemoryAdminEmail = email || null;

  const nowSec = Math.floor(Date.now() / 1000);
  if (typeof expiresAt === 'number') {
    if (expiresAt < 1000000000) {
      inMemoryExpiresAt = nowSec + expiresAt;
    } else {
      inMemoryExpiresAt = expiresAt;
    }
  } else {
    inMemoryExpiresAt = token ? nowSec + 900 : null;
  }

  if (inMemorySessionToken && inMemoryExpiresAt) {
    const remainingMs = Math.max(1, (inMemoryExpiresAt - nowSec) * 1000);
    inMemoryExpiryTimer = setTimeout(() => {
      clearAdminSessionToken();
    }, remainingMs);
    if (inMemoryExpiryTimer && typeof inMemoryExpiryTimer.unref === 'function') {
      inMemoryExpiryTimer.unref();
    }
  }
  notifyAdminAuth();
}

let authRevocationEpoch = 0;

export function clearAdminSessionToken() {
  authRevocationEpoch += 1;
  resetAuthHandoffState();
  if (inMemoryExpiryTimer) {
    clearTimeout(inMemoryExpiryTimer);
    inMemoryExpiryTimer = null;
  }
  const hadSession = Boolean(inMemorySessionToken);
  inMemorySessionToken = null;
  inMemoryAdminEmail = null;
  inMemoryExpiresAt = null;
  if (hadSession) {
    notifyAdminAuth();
  }
}

export function getAdminEmail() {
  return inMemoryAdminEmail;
}

export function isSessionTokenActive() {
  return Boolean(getAdminSessionToken());
}

/**
 * Request single-use cryptographically random challenge/state bound to the frontend origin.
 */
export async function requestAuthChallenge({
  baseUrl = import.meta.env?.VITE_APPS_SCRIPT_URL,
  fetcher = globalThis.fetch,
  origin = (typeof window !== 'undefined' && window.location ? window.location.origin : ''),
  returnUrl = (typeof window !== 'undefined' && window.location ? window.location.href : '')
} = {}) {
  if (!baseUrl) throw new Error('BACKEND_URL_UNCONFIGURED');
  const url = new URL(baseUrl);
  url.searchParams.set('action', 'rosterv2authchallenge');
  url.searchParams.set('origin', origin);
  if (returnUrl) {
    url.searchParams.set('returnUrl', returnUrl);
  }
  const response = await fetcher(url.toString(), {
    method: 'GET',
    cache: 'no-store',
    headers: { Accept: 'application/json' }
  });
  if (!response.ok) throw new Error('CHALLENGE_REQUEST_FAILED');
  const data = await response.json();
  if (!data.ok || !data.state) {
    throw new Error(data.error?.message || 'INVALID_CHALLENGE_RESPONSE');
  }
  return {
    state: data.state,
    origin: data.origin,
    returnUrl: data.returnUrl,
    redirectUri: data.redirectUri || PRODUCTION_OAUTH_REDIRECT_URI,
    expiresIn: data.expiresIn || 300
  };
}

let inFlightHandoffPromise = null;
let inFlightHandoffCode = null;
let lastRedeemedHandoff = null;
let lastHandoffError = null;
const failedHandoffCodes = new Set();

export function isAuthHandoffPending() {
  return inFlightHandoffPromise !== null;
}

export function getActiveAuthHandoff() {
  return inFlightHandoffPromise;
}

export function hasRecentAuthHandoff() {
  return Boolean(lastRedeemedHandoff && (Date.now() - lastRedeemedHandoff.timestamp < 30000));
}

export function resetAuthHandoffState() {
  inFlightHandoffPromise = null;
  inFlightHandoffCode = null;
  lastRedeemedHandoff = null;
  lastHandoffError = null;
  failedHandoffCodes.clear();
}

/**
 * Redeem one-time authentication handoff code for short-lived HMAC admin session token.
 * On success, stores the returned HMAC admin session token in memory only.
 */
export async function redeemAuthHandoff({
  handoffCode,
  baseUrl = import.meta.env?.VITE_APPS_SCRIPT_URL,
  fetcher = globalThis.fetch,
  timeoutMs = 15000
} = {}) {
  if (!baseUrl) throw new Error('BACKEND_URL_UNCONFIGURED');
  if (!handoffCode || typeof handoffCode !== 'string') {
    throw new Error('MISSING_HANDOFF_CODE');
  }

  const trimmedCode = handoffCode.trim();
  const startEpoch = authRevocationEpoch;
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  let timeoutId = null;

  try {
    const fetchPromise = (async () => {
      const response = await fetcher(baseUrl, {
        method: 'POST',
        cache: 'no-store',
        headers: {
          'Content-Type': 'text/plain;charset=UTF-8',
          Accept: 'application/json'
        },
        body: JSON.stringify({
          action: 'rosterv2authredeem',
          handoffCode: trimmedCode
        }),
        ...(controller ? { signal: controller.signal } : {})
      });

      if (!response.ok) {
        const err = new Error('AUTH_REDEEM_HTTP_FAILED');
        err.code = 'AUTH_REDEEM_HTTP_FAILED';
        throw err;
      }
      const data = await response.json();
      if (!data.ok || !data.adminSessionToken) {
        const errCode = data.error?.code || 'AUTH_REDEEM_REJECTED';
        const errMsg = data.error?.message || 'Authentication handoff expired or invalid.';
        const err = new Error(errMsg);
        err.code = errCode;
        throw err;
      }

      // Check if session was revoked / logged out while network request was in-flight
      if (authRevocationEpoch !== startEpoch) {
        const err = new Error('Session was revoked before verification completed.');
        err.code = 'AUTH_SESSION_REVOKED';
        throw err;
      }

      setAdminSessionToken(data.adminSessionToken, data.email, data.expiresAt);
      return {
        ok: true,
        adminSessionToken: data.adminSessionToken,
        email: data.email,
        expiresAt: data.expiresAt
      };
    })();

    if (timeoutMs > 0) {
      const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          if (controller) {
            try { controller.abort(); } catch (_) {}
          }
          const err = new Error('AUTH_REDEEM_TIMEOUT');
          err.code = 'AUTH_REDEEM_TIMEOUT';
          reject(err);
        }, timeoutMs);
      });
      return await Promise.race([fetchPromise, timeoutPromise]);
    }

    return await fetchPromise;
  } catch (err) {
    if (err.name === 'AbortError' || err.code === 'AUTH_REDEEM_TIMEOUT') {
      const timeoutErr = new Error('Verification timed out. Check your network connection and try again.');
      timeoutErr.code = 'AUTH_REDEEM_TIMEOUT';
      throw timeoutErr;
    }
    throw err;
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

/**
 * Check window location for incoming '?v2auth=<handoff-code>', immediately remove it from URL
 * history via history.replaceState, and redeem it for an HMAC admin session token.
 * Centralized, idempotent coordinator: deduplicates in-flight calls and caches recent results.
 */
export function handleUrlAuthHandoff({
  baseUrl = import.meta.env?.VITE_APPS_SCRIPT_URL,
  fetcher = globalThis.fetch,
  urlStr = (typeof window !== 'undefined' && window.location ? window.location.href : ''),
  timeoutMs = 15000
} = {}) {
  // If a redemption is already in-flight, reuse that exact promise (strict deduplication)
  if (inFlightHandoffPromise) {
    return inFlightHandoffPromise;
  }

  let handoffCode = null;
  if (urlStr) {
    try {
      const currentUrl = new URL(urlStr, 'http://localhost');
      handoffCode = currentUrl.searchParams.get('v2auth');
      if (handoffCode) {
        handoffCode = handoffCode.trim();
        // Remove ?v2auth= immediately from URL bar and browser history before making network call
        currentUrl.searchParams.delete('v2auth');
        const cleanSearch = currentUrl.searchParams.toString();
        const cleanPath = currentUrl.pathname + (cleanSearch ? `?${cleanSearch}` : '') + currentUrl.hash;
        if (typeof window !== 'undefined' && window.history && typeof window.history.replaceState === 'function') {
          const docTitle = typeof document !== 'undefined' ? document.title : '';
          window.history.replaceState(window.history.state, docTitle, cleanPath);
        }
      }
    } catch (_) {}
  }

  if (!handoffCode) {
    // If no code in URL, check if we recently redeemed one successfully
    if (lastRedeemedHandoff && (Date.now() - lastRedeemedHandoff.timestamp < 30000)) {
      return Promise.resolve(lastRedeemedHandoff.result);
    }
    return Promise.resolve(null);
  }

  // If this code was already successfully redeemed recently, return existing result without re-fetching
  if (lastRedeemedHandoff && lastRedeemedHandoff.code === handoffCode && (Date.now() - lastRedeemedHandoff.timestamp < 30000)) {
    return Promise.resolve(lastRedeemedHandoff.result);
  }

  // If this code previously failed, do not repeat with expired/consumed code
  if (failedHandoffCodes.has(handoffCode)) {
    if (lastHandoffError && lastHandoffError.code === handoffCode) {
      return Promise.reject(lastHandoffError.error);
    }
    const err = new Error('Authentication handoff expired or invalid.');
    err.code = 'INVALID_HANDOFF';
    return Promise.reject(err);
  }

  inFlightHandoffCode = handoffCode;
  inFlightHandoffPromise = (async () => {
    try {
      const result = await redeemAuthHandoff({
        handoffCode,
        baseUrl,
        fetcher,
        timeoutMs
      });
      lastRedeemedHandoff = {
        code: handoffCode,
        result,
        timestamp: Date.now()
      };
      lastHandoffError = null;
      return result;
    } catch (err) {
      failedHandoffCodes.add(handoffCode);
      lastHandoffError = {
        code: handoffCode,
        error: err,
        timestamp: Date.now()
      };
      throw err;
    } finally {
      inFlightHandoffPromise = null;
      inFlightHandoffCode = null;
    }
  })();

  return inFlightHandoffPromise;
}

/**
 * Check whether the current in-memory admin session token is valid on the server.
 */
export async function checkAuthStatus({
  token = getAdminSessionToken(),
  baseUrl = import.meta.env?.VITE_APPS_SCRIPT_URL,
  fetcher = globalThis.fetch
} = {}) {
  if (!token) return { ok: true, authenticated: false };
  if (!baseUrl) return { ok: false, error: 'BACKEND_URL_UNCONFIGURED' };

  try {
    const response = await fetcher(baseUrl, {
      method: 'POST',
      cache: 'no-store',
      headers: {
        'Content-Type': 'text/plain;charset=UTF-8',
        Accept: 'application/json'
      },
      body: JSON.stringify({
        action: 'rosterv2authstatus',
        adminSessionToken: token
      })
    });
    if (!response.ok) return { ok: false, authenticated: false };
    const data = await response.json();
    if (data.ok && data.authenticated) {
      return { ok: true, authenticated: true, email: data.email };
    }
    clearAdminSessionToken();
    return { ok: true, authenticated: false };
  } catch (_) {
    return { ok: false, authenticated: false };
  }
}

export const GIS_SCRIPT_URL = 'https://accounts.google.com/gsi/client';

export const GIS_LOAD_ERROR_USER_MESSAGE =
  'Google authentication could not be loaded. Check the network connection and try again.';

export function formatAdminAuthError(err) {
  if (!err) return 'Verification failed';
  const code = err.code || err.message;
  if (code === 'GIS_SCRIPT_LOAD_FAILED' || code === 'GIS_SCRIPT_NOT_LOADED' || String(err).includes('GIS_SCRIPT')) {
    return GIS_LOAD_ERROR_USER_MESSAGE;
  }
  if (code === 'AUTH_REDEEM_TIMEOUT' || String(err).includes('timed out')) {
    return 'Verification timed out. Check your network connection and try again.';
  }
  if (code === 'AUTH_SESSION_REVOKED') {
    return 'Verification was cancelled because the session was logged out.';
  }
  if (code === 'AUTH_REDEEM_HTTP_FAILED' || code === 'FETCH_ERROR') {
    return 'Could not connect to authentication service. Check your network connection and try again.';
  }
  if (code === 'INVALID_HANDOFF') {
    return 'Authentication session expired or has already been used. Please sign in again.';
  }
  if (code === 'UNAUTHORIZED_EMAIL') {
    return 'The Google account selected is not authorized as an administrator.';
  }
  if (code === 'CONFIG_INCOMPLETE') {
    return 'Server authentication configuration is incomplete.';
  }
  return err.userMessage || err.message || String(err);
}

let gisLoadPromise = null;

/**
 * Race-safe loader for the official Google Identity Services SDK.
 * Bounded, deduplicated, retryable, and resolves immediately if already present.
 */
export async function ensureGoogleIdentityServicesLoaded({
  timeoutMs = 10000,
  scriptUrl = GIS_SCRIPT_URL
} = {}) {
  if (typeof window === 'undefined') {
    const err = new Error('GIS_SCRIPT_LOAD_FAILED');
    err.code = 'GIS_SCRIPT_LOAD_FAILED';
    err.userMessage = GIS_LOAD_ERROR_USER_MESSAGE;
    throw err;
  }

  // 1. Resolve immediately if already available
  if (typeof window.google?.accounts?.oauth2?.initCodeClient === 'function') {
    return window.google.accounts.oauth2;
  }

  // 5. Multiple simultaneous calls share one module-level promise
  if (gisLoadPromise) {
    return gisLoadPromise;
  }

  gisLoadPromise = new Promise((resolve, reject) => {
    let timerId = null;
    let pollId = null;
    let scriptEl = null;
    let scriptLoadHandler = null;
    let scriptErrorHandler = null;

    const cleanup = () => {
      if (timerId !== null) {
        clearTimeout(timerId);
        timerId = null;
      }
      if (pollId !== null) {
        clearInterval(pollId);
        pollId = null;
      }
      if (scriptEl && scriptLoadHandler) {
        scriptEl.removeEventListener('load', scriptLoadHandler);
      }
      if (scriptEl && scriptErrorHandler) {
        scriptEl.removeEventListener('error', scriptErrorHandler);
      }
    };

    const fail = (errorMsg) => {
      cleanup();
      // 8. Previous failure does not permanently poison future attempts
      gisLoadPromise = null;
      const err = new Error(errorMsg || 'GIS_SCRIPT_LOAD_FAILED');
      err.code = 'GIS_SCRIPT_LOAD_FAILED';
      err.userMessage = GIS_LOAD_ERROR_USER_MESSAGE;
      reject(err);
    };

    const succeed = () => {
      if (typeof window.google?.accounts?.oauth2?.initCodeClient === 'function') {
        cleanup();
        gisLoadPromise = null;
        resolve(window.google.accounts.oauth2);
      } else {
        fail('GIS_SCRIPT_LOAD_FAILED');
      }
    };

    // 3 & 9. Bounded timeout
    timerId = setTimeout(() => {
      fail('GIS_SCRIPT_LOAD_FAILED');
    }, timeoutMs);

    // 2. Identify existing GIS script or create exactly one if absent
    scriptEl = typeof document !== 'undefined'
      ? document.querySelector(`script[src="${scriptUrl}"]`)
      : null;

    scriptLoadHandler = () => {
      if (typeof window.google?.accounts?.oauth2?.initCodeClient === 'function') {
        succeed();
      }
    };

    scriptErrorHandler = () => {
      fail('GIS_SCRIPT_LOAD_FAILED');
    };

    if (scriptEl) {
      scriptEl.addEventListener('load', scriptLoadHandler);
      scriptEl.addEventListener('error', scriptErrorHandler);
    } else if (typeof document !== 'undefined') {
      // 4. Do not insert duplicate script elements
      scriptEl = document.createElement('script');
      scriptEl.src = scriptUrl;
      scriptEl.async = true;
      scriptEl.defer = true;
      scriptEl.addEventListener('load', scriptLoadHandler);
      scriptEl.addEventListener('error', scriptErrorHandler);
      (document.head || document.body || document.documentElement).appendChild(scriptEl);
    }

    // Fast polling to catch initialization as soon as the script evaluates
    pollId = setInterval(() => {
      if (typeof window.google?.accounts?.oauth2?.initCodeClient === 'function') {
        succeed();
      }
    }, 50);
  });

  return gisLoadPromise;
}

/**
 * Trigger the Google Identity Services redirect authorization code flow.
 * Redirects the browser directly to Google with state bound to Apps Script callback URI.
 */
export async function startGoogleRedirectAuth({
  clientId = getGoogleClientId(),
  baseUrl = import.meta.env?.VITE_APPS_SCRIPT_URL,
  fetcher = globalThis.fetch,
  origin = (typeof window !== 'undefined' && window.location ? window.location.origin : ''),
  returnUrl = (typeof window !== 'undefined' && window.location ? window.location.href : ''),
  onError
} = {}) {
  if (!clientId) {
    const err = new Error('CLIENT_ID_UNCONFIGURED');
    err.code = 'CLIENT_ID_UNCONFIGURED';
    onError?.(err);
    throw err;
  }

  try {
    await ensureGoogleIdentityServicesLoaded();
  } catch (loadErr) {
    onError?.(loadErr);
    throw loadErr;
  }

  try {
    const challenge = await requestAuthChallenge({ baseUrl, fetcher, origin, returnUrl });
    const state = typeof challenge === 'string' ? challenge : challenge.state;
    const redirectUri = (challenge && challenge.redirectUri) || PRODUCTION_OAUTH_REDIRECT_URI;

    const client = window.google.accounts.oauth2.initCodeClient({
      client_id: clientId,
      scope: 'openid email',
      ux_mode: 'redirect',
      redirect_uri: redirectUri,
      state: state
    });
    client.requestCode();
  } catch (err) {
    onError?.(err);
    throw err;
  }
}

// Alias for seamless backward compatibility across UI components
export const startGoogleCodeAuth = startGoogleRedirectAuth;

