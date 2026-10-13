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

export function getGoogleClientId() {
  return (import.meta.env?.VITE_GOOGLE_CLIENT_ID || '').trim();
}

export function getAdminSessionToken() {
  if (inMemorySessionToken && inMemoryExpiresAt) {
    const now = Math.floor(Date.now() / 1000);
    if (inMemoryExpiresAt > (now + 10)) {
      return inMemorySessionToken;
    }
    clearAdminSessionToken();
    return null;
  }
  return inMemorySessionToken || null;
}

export function setAdminSessionToken(token, email = null, expiresAt = null) {
  inMemorySessionToken = token || null;
  inMemoryAdminEmail = email || null;
  inMemoryExpiresAt = typeof expiresAt === 'number' ? expiresAt : (token ? Math.floor(Date.now() / 1000) + 900 : null);
}

export function clearAdminSessionToken() {
  inMemorySessionToken = null;
  inMemoryAdminEmail = null;
  inMemoryExpiresAt = null;
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
  origin = (typeof window !== 'undefined' ? window.location.origin : ''),
  returnUrl = (typeof window !== 'undefined' ? window.location.href : '')
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

/**
 * Redeem one-time authentication handoff code for short-lived HMAC admin session token.
 * On success, stores the returned HMAC admin session token in memory only.
 */
export async function redeemAuthHandoff({
  handoffCode,
  baseUrl = import.meta.env?.VITE_APPS_SCRIPT_URL,
  fetcher = globalThis.fetch
} = {}) {
  if (!baseUrl) throw new Error('BACKEND_URL_UNCONFIGURED');
  if (!handoffCode || typeof handoffCode !== 'string') {
    throw new Error('MISSING_HANDOFF_CODE');
  }

  const response = await fetcher(baseUrl, {
    method: 'POST',
    cache: 'no-store',
    headers: {
      'Content-Type': 'text/plain;charset=UTF-8',
      Accept: 'application/json'
    },
    body: JSON.stringify({
      action: 'rosterv2authredeem',
      handoffCode: handoffCode.trim()
    })
  });

  if (!response.ok) throw new Error('AUTH_REDEEM_HTTP_FAILED');
  const data = await response.json();
  if (!data.ok || !data.adminSessionToken) {
    throw new Error(data.error?.message || 'AUTH_REDEEM_REJECTED');
  }

  setAdminSessionToken(data.adminSessionToken, data.email, data.expiresAt);
  return {
    ok: true,
    adminSessionToken: data.adminSessionToken,
    email: data.email,
    expiresAt: data.expiresAt
  };
}

/**
 * Check window location for incoming '?v2auth=<handoff-code>', immediately remove it from URL
 * history via history.replaceState, and redeem it for an HMAC admin session token.
 */
export async function handleUrlAuthHandoff({
  baseUrl = import.meta.env?.VITE_APPS_SCRIPT_URL,
  fetcher = globalThis.fetch,
  urlStr = (typeof window !== 'undefined' ? window.location.href : '')
} = {}) {
  if (typeof window === 'undefined' || !urlStr) return null;

  try {
    const currentUrl = new URL(urlStr, 'http://localhost');
    const handoffCode = currentUrl.searchParams.get('v2auth');
    if (!handoffCode) return null;

    // Remove ?v2auth= immediately from URL bar and browser history before making network call
    currentUrl.searchParams.delete('v2auth');
    const cleanSearch = currentUrl.searchParams.toString();
    const cleanPath = currentUrl.pathname + (cleanSearch ? `?${cleanSearch}` : '') + currentUrl.hash;
    if (window.history && typeof window.history.replaceState === 'function') {
      const docTitle = typeof document !== 'undefined' ? document.title : '';
      window.history.replaceState(window.history.state, docTitle, cleanPath);
    }

    return await redeemAuthHandoff({
      handoffCode,
      baseUrl,
      fetcher
    });
  } catch (err) {
    throw err;
  }
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

/**
 * Trigger the Google Identity Services redirect authorization code flow.
 * Redirects the browser directly to Google with state bound to Apps Script callback URI.
 */
export async function startGoogleRedirectAuth({
  clientId = getGoogleClientId(),
  baseUrl = import.meta.env?.VITE_APPS_SCRIPT_URL,
  fetcher = globalThis.fetch,
  origin = (typeof window !== 'undefined' ? window.location.origin : ''),
  returnUrl = (typeof window !== 'undefined' ? window.location.href : ''),
  onError
} = {}) {
  if (!clientId) {
    const err = new Error('CLIENT_ID_UNCONFIGURED');
    onError?.(err);
    throw err;
  }

  if (typeof window === 'undefined' || !window.google?.accounts?.oauth2?.initCodeClient) {
    const err = new Error('GIS_SCRIPT_NOT_LOADED');
    onError?.(err);
    throw err;
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
