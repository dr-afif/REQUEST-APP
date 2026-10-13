// Apps Script I/O boundary. Reads below never call legacy getters/bootstrap helpers.
var ROSTER_V2_YEAR_MONTH_HEADERS_ = {
  PeriodId: true,
  PolicyLockedByPeriodId: true,
  SourcePeriodId: true
};

var ROSTER_V2_LOCAL_DATE_HEADERS_ = {
  Date: true,
  EffectiveMonday: true,
  WeekStart: true,
  WeekEnd: true,
  StartDate: true,
  EndDate: true,
  EffectiveDate: true,
  PublicHolidayDate: true
};

var ROSTER_V2_TIMESTAMP_HEADERS_ = {
  CreatedAt: true,
  UpdatedAt: true,
  CompletedAt: true,
  PublishedAt: true,
  ClosedAt: true,
  EnrolledAt: true,
  ExpiresAt: true
};

function rosterV2TimeZone_() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    if (ss && ss.getSpreadsheetTimeZone) {
      var tz = ss.getSpreadsheetTimeZone();
      if (tz) return tz;
    }
  } catch (e) {}
  try {
    if (typeof Session !== 'undefined' && Session.getScriptTimeZone) {
      var stz = Session.getScriptTimeZone();
      if (stz) return stz;
    }
  } catch (e) {}
  return 'Asia/Kuala_Lumpur';
}

function rosterV2CanonicalCellValue_(val, header, timeZone) {
  if (val === null || val === undefined || val === '') return '';
  var isDate = (Object.prototype.toString.call(val) === '[object Date]') || (val instanceof Date);
  if (isDate) {
    if (ROSTER_V2_YEAR_MONTH_HEADERS_[header]) {
      var formatted = Utilities.formatDate(val, timeZone, 'yyyy-MM');
      return formatted ? formatted.slice(0, 7) : '';
    }
    if (ROSTER_V2_LOCAL_DATE_HEADERS_[header]) {
      var formattedDate = Utilities.formatDate(val, timeZone, 'yyyy-MM-dd');
      return formattedDate ? formattedDate.slice(0, 10) : '';
    }
    if (ROSTER_V2_TIMESTAMP_HEADERS_[header]) {
      return val.toISOString();
    }
    return val.toISOString();
  }
  return val;
}

function rosterV2ReadTable_(name) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sheet) return { headers: [], rows: [], exists: false };
  const values = sheet.getDataRange().getValues();
  const headers = values[0] || [];
  const rawRows = values.slice(1);
  if (name === 'MasterRoster' || !headers.length) {
    return { headers: headers, rows: rawRows, exists: true };
  }
  const tz = rosterV2TimeZone_();
  const normalizedRows = rawRows.map(function(row) {
    return row.map(function(val, colIdx) {
      const header = headers[colIdx];
      return rosterV2CanonicalCellValue_(val, header, tz);
    });
  });
  return { headers: headers, rows: normalizedRows, exists: true };
}

function rosterV2Records_(table, requiredHeaders, preserveBlankRows) {
  if (!table.exists) return [];
  requiredHeaders.forEach(function(header) {
    if (table.headers.filter(function(h) { return h === header; }).length !== 1) throw new Error('Ambiguous or missing v2 source header: ' + header);
  });
  return table.rows.filter(function(row) { return preserveBlankRows || row.some(function(v) { return v !== '' && v !== null; }); }).map(function(row) {
    const record = {};
    requiredHeaders.forEach(function(header) { record[header] = row[table.headers.indexOf(header)]; });
    return record;
  });
}

function rosterV2Settings_() {
  const table = rosterV2ReadTable_('Settings');
  const settings = {};
  if (!table.exists) return settings;
  // Match the legacy positional key/value contract, but return only reserved switch values.
  table.rows.forEach(function(row) {
    const key = String(row[0] || '').trim();
    if (RosterCompatibility.isReservedSetting(key)) settings[key] = String(row[1] || '').trim();
  });
  return settings;
}

function rosterV2Schema_() {
  const headers = {};
  Object.keys(RosterCompatibility.schemas).forEach(function(name) {
    const table = rosterV2ReadTable_(name);
    if (table.exists) headers[name] = table.headers;
  });
  return { schemaVersion: 2, foundationVersion: 1, semanticRuleVersion: 1,
    timezone: 'Asia/Kuala_Lumpur', capabilities: { discovery: true, shadowPeriodRead: true,
      officialWrites: false, privateNotes: false, automaticEnrollment: false },
    featureDefaults: RosterCompatibility.featureDefaults,
    configuredFeatures: RosterCompatibility.featureSwitches(rosterV2Settings_()),
    // Keep the Phase 1 discovery contract stable. Phase 2 draft capability discovery is private.
    effectiveFeatures: RosterCompatibility.featureDefaults,
    legacyUploadPolicy: 'Allowed only while no RosterPeriods enrollment exists',
    schemas: RosterCompatibility.schemaPlan(headers), catalog: RosterCompatibility.catalog,
    staffingDefaults: RosterCompatibility.staffingDefaults };
}

function rosterV2Directory_(name) {
  const table = rosterV2ReadTable_(name);
  if (!table.exists) return [];
  const fields = ['MemberName'];
  if (table.headers.indexOf('Active') >= 0) fields.push('Active');
  return rosterV2Records_(table, fields);
}

function rosterV2Period_(parameters) {
  const periodId = RosterCompatibility.validatePeriod(String(parameters.period || ''));
  if (parameters.mode !== 'shadow') throw new Error('Phase 1 period reads require mode=shadow; official v2 reads are disabled.');
  const rosterTable = rosterV2ReadTable_('MasterRoster');
  const rows = rosterV2Records_(rosterTable, ['Name', 'Date', 'Shift'], true);
  const people = rosterV2Records_(rosterV2ReadTable_('RosterPeople'), ['PersonId', 'DirectoryType', 'CurrentDisplayName', 'LegacyNamesJson', 'Active']);
  const periods = rosterV2Records_(rosterV2ReadTable_('RosterPeriods'), ['PeriodId', 'SchemaVersion', 'EnrolledAt', 'EnrolledBy']);
  const resolvePerson = RosterCompatibility.personIndex(people, {
    MO: rosterV2Directory_('TeamMembers'), EP: rosterV2Directory_('EmergencyPhysicians')
  });
  const result = RosterCompatibility.projectPeriod(periodId, rows, resolvePerson, periods);
  const expected = rows.filter(function(row) { const date = RosterCompatibility.localDate(row.Date); return date && date.slice(0,7) === periodId; });
  result.reconciliation = RosterCompatibility.reconcileRows(RosterCompatibility.legacyTransportRows(expected), RosterCompatibility.legacyProjection(result));
  result.reconciliation.complete = result.unplaced.length === 0;
  result.checksum = rosterV2Digest_(RosterCompatibility.canonicalJson(RosterCompatibility.legacyProjection(result)));
  result.semanticCatalogStatus = rosterV2CatalogStatus_();
  // Only Name/Date/Shift and safe identity fields are projected. Never return raw Settings,
  // Requests/LeaveApplications notes, arbitrary extra columns or administrator properties.
  return result;
}

function rosterV2CatalogStatus_() {
  const table = rosterV2ReadTable_('ShiftSemantics');
  if (!table.exists) return { source: 'BUNDLED_RULE_1', storedCatalogPresent: false, differences: [] };
  const expected = rosterV2CatalogRows_();
  const differences = RosterCompatibility.reconcileRows(expected, table.rows);
  // This status is public. Report drift without echoing arbitrary stored cell values.
  const summary = { match: differences.match, multisetEqual: differences.multisetEqual,
    orderChanged: differences.orderChanged,
    missingCount: differences.missing.reduce(function(n, item) { return n + item.count; }, 0),
    extraCount: differences.extra.reduce(function(n, item) { return n + item.count; }, 0) };
  return { source: 'BUNDLED_RULE_1', storedCatalogPresent: true,
    headerMatch: RosterCompatibility.canonicalJson(table.headers) === RosterCompatibility.canonicalJson(RosterCompatibility.schemas.ShiftSemantics),
    reconciliation: summary };
}

function rosterV2CatalogRows_() {
  return Object.keys(RosterCompatibility.catalog).map(function(raw) {
    const s = RosterCompatibility.resolveShift(raw);
    return [raw, 1, s.directoryType, s.worked, s.consecutive, s.staffingBucket || '', s.policyBQualifier,
      s.normalOff, s.canDisplaceOffEarnGoff, JSON.stringify(s.expectedPredecessors), JSON.stringify(s.expectedFollowers)];
  });
}

function rosterV2Digest_(text) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8)
    .map(function(byte) { return ('0' + ((byte + 256) % 256).toString(16)).slice(-2); }).join('');
}

// Editor/internal utility only: no route, no network, no sheet creation or repair.
// Caller supplies dataset tables to retain exact header order/duplicates and raw values.
function rosterV2Snapshot_(datasets) {
  return RosterCompatibility.snapshotDatasets(datasets, rosterV2Digest_);
}

function rosterV2GetAllowedOrigins_() {
  var defaultOrigins = [
    'http://localhost:5174',
    'http://localhost:5173',
    'https://dr-afif.github.io'
  ];
  try {
    var configured = PropertiesService.getScriptProperties().getProperty('ROSTER_V2_ALLOWED_ORIGINS');
    if (configured && typeof configured === 'string') {
      var custom = configured.split(',').map(function(s) { return s.trim(); }).filter(Boolean);
      if (custom.length > 0) return custom;
    }
  } catch (_) {}
  return defaultOrigins;
}

function rosterV2ValidateOrigin_(origin) {
  if (!origin || typeof origin !== 'string') return null;
  var normalized = origin.trim().replace(/\/+$/, '');
  var allowed = rosterV2GetAllowedOrigins_();
  for (var i = 0; i < allowed.length; i++) {
    if (allowed[i].toLowerCase() === normalized.toLowerCase()) {
      return allowed[i];
    }
  }
  return null;
}

function rosterV2DecodeBase64WebSafeString_(base64Str) {
  var b64 = base64Str.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  var bytes = Utilities.base64Decode(b64);
  return Utilities.newBlob(bytes).getDataAsString();
}

function rosterV2ConstantTimeEquals_(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  var result = 0;
  for (var i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

function rosterV2IssueAdminSessionToken_(sub, email, sessionSecret) {
  var now = Math.floor(Date.now() / 1000);
  var exp = now + 900; // 15 minutes TTL
  var headerObj = { alg: 'HS256', typ: 'JWT' };
  var payloadObj = {
    v: 1,
    sub: sub,
    email: email,
    iat: now,
    exp: exp,
    jti: Utilities.getUuid()
  };
  var headerStr = Utilities.base64EncodeWebSafe(JSON.stringify(headerObj)).replace(/=+$/, '');
  var payloadStr = Utilities.base64EncodeWebSafe(JSON.stringify(payloadObj)).replace(/=+$/, '');
  var dataToSign = headerStr + '.' + payloadStr;
  var sigBytes = Utilities.computeHmacSha256Signature(dataToSign, sessionSecret);
  var sigStr = Utilities.base64EncodeWebSafe(sigBytes).replace(/=+$/, '');
  return {
    token: dataToSign + '.' + sigStr,
    expiresAt: exp,
    email: email
  };
}

function rosterV2VerifyAdminSessionToken_(token, sessionSecret, expectedAdminEmail) {
  if (!token || typeof token !== 'string') return null;
  var parts = token.trim().split('.');
  if (parts.length !== 3) return null;
  var headerStr = parts[0];
  var payloadStr = parts[1];
  var sigStr = parts[2];

  var dataToSign = headerStr + '.' + payloadStr;
  var expectedSigBytes = Utilities.computeHmacSha256Signature(dataToSign, sessionSecret);
  var expectedSigStr = Utilities.base64EncodeWebSafe(expectedSigBytes).replace(/=+$/, '');

  if (!rosterV2ConstantTimeEquals_(sigStr, expectedSigStr)) {
    return null;
  }

  var claims = null;
  try {
    claims = JSON.parse(rosterV2DecodeBase64WebSafeString_(payloadStr));
  } catch (_) {
    return null;
  }

  if (!claims || typeof claims !== 'object') return null;
  if (claims.v !== 1) return null;
  if (!claims.sub || typeof claims.sub !== 'string') return null;
  if (!claims.email || typeof claims.email !== 'string') return null;
  if (!claims.exp || typeof claims.exp !== 'number') return null;

  var now = Math.floor(Date.now() / 1000);
  if (claims.exp <= now) return null;

  var email = claims.email.trim().toLowerCase();
  if (email !== expectedAdminEmail.toLowerCase()) return null;

  return { email: email, sub: claims.sub, exp: claims.exp, jti: claims.jti };
}

function rosterV2RequireAdmin_(data) {
  // The principal is established by Apps-Script-issued HMAC admin session token or direct Apps Script Session.
  // Never established by a request field, frontend PIN, tokeninfo, or getEffectiveUser.
  let allowed = '', caller = '';
  try {
    allowed = String(PropertiesService.getScriptProperties().getProperty('ROSTER_V2_ADMIN_EMAIL') || '').trim().toLowerCase();
  } catch (error) { throw new Error('V2 administrator authorization required.'); }
  if (!allowed) throw new Error('V2 administrator authorization required.');

  // 1. Apps-Script-issued HMAC session token verification for cross-origin web app callers
  const sessionToken = data && (data.adminSessionToken || (data.auth && data.auth.adminSessionToken));
  if (sessionToken && typeof sessionToken === 'string') {
    let sessionSecret = '';
    try {
      sessionSecret = String(PropertiesService.getScriptProperties().getProperty('ROSTER_V2_SESSION_SECRET') || '').trim();
    } catch (_) {}
    if (!sessionSecret) throw new Error('V2 administrator authorization required.');

    const claims = rosterV2VerifyAdminSessionToken_(sessionToken, sessionSecret, allowed);
    if (claims && claims.email === allowed) {
      return { email: claims.email, sub: claims.sub };
    }
    throw new Error('V2 administrator authorization required.');
  }

  // 2. Direct Apps Script execution Session identity (for IDE console / CutoverRunner)
  try {
    caller = String(Session.getActiveUser().getEmail() || '').trim().toLowerCase();
  } catch (error) { throw new Error('V2 administrator authorization required.'); }
  if (!caller || allowed !== caller) throw new Error('V2 administrator authorization required.');
  return { email: caller };
}

var ROSTER_V2_DEFAULT_REDIRECT_URI_ = 'https://script.google.com/macros/s/AKfycbwFNXKmohkgla4JKB819RZSwh7YIsiff87B-mGCZuEJXEe5H_bk5RWHew7VAMWWtv_5jA/exec';

function rosterV2GetOAuthRedirectUri_() {
  var configured = '';
  try {
    configured = PropertiesService.getScriptProperties().getProperty('ROSTER_V2_OAUTH_REDIRECT_URI');
  } catch (_) {}
  if (configured && typeof configured === 'string' && configured.trim()) {
    var trimmed = configured.trim();
    if (trimmed !== ROSTER_V2_DEFAULT_REDIRECT_URI_) {
      throw new Error('Configured ROSTER_V2_OAUTH_REDIRECT_URI does not match expected deployment URI.');
    }
    return trimmed;
  }
  return ROSTER_V2_DEFAULT_REDIRECT_URI_;
}

function rosterV2EscapeHtml_(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function rosterV2ValidateReturnUrl_(returnUrl, origin) {
  if (!returnUrl || typeof returnUrl !== 'string' || !origin) return origin;
  var trimmed = returnUrl.trim();
  var normOrigin = origin.toLowerCase().replace(/\/+$/, '');
  var normReturn = trimmed.toLowerCase();
  if (normReturn === normOrigin) return trimmed;
  if (normReturn.indexOf(normOrigin + '/') === 0 || normReturn.indexOf(normOrigin + '?') === 0 || normReturn.indexOf(normOrigin + '#') === 0) {
    return trimmed;
  }
  return origin;
}

function rosterV2RenderAuthHtml_(redirectUrl) {
  var safeUrl = rosterV2EscapeHtml_(redirectUrl);
  var html = '<!DOCTYPE html><html><head><meta charset="utf-8">' +
    '<base target="_top">' +
    '<title>Administrator Verification Successful</title>' +
    '<style>' +
    'body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 1.5rem; box-sizing: border-box; }' +
    '.card { background: #1e293b; border: 1px solid #334155; border-radius: 1rem; padding: 2.5rem; max-width: 440px; width: 100%; text-align: center; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5); }' +
    '.icon-wrap { width: 56px; height: 56px; margin: 0 auto 1.5rem; border-radius: 50%; background: #064e3b; display: flex; align-items: center; justify-content: center; color: #34d399; font-size: 28px; font-weight: bold; }' +
    'h1 { font-size: 1.25rem; font-weight: 700; margin: 0 0 0.75rem; color: #ffffff; }' +
    'p { color: #94a3b8; font-size: 0.9375rem; line-height: 1.5; margin: 0 0 2rem; }' +
    '.btn { display: inline-block; width: 100%; padding: 0.875rem 1.25rem; background: #2563eb; color: #ffffff; text-decoration: none; font-weight: 600; font-size: 0.9375rem; border-radius: 0.5rem; box-sizing: border-box; transition: background 0.15s ease; }' +
    '.btn:hover { background: #1d4ed8; }' +
    '</style>' +
    '</head><body>' +
    '<div class="card">' +
    '<div class="icon-wrap">&#10003;</div>' +
    '<h1>Administrator Verification Successful</h1>' +
    '<p>Your Google administrator identity has been confirmed. Click below to return to REQUEST-APP and continue.</p>' +
    '<a href="' + safeUrl + '" target="_top" class="btn">Continue to REQUEST-APP</a>' +
    '</div>' +
    '</body></html>';
  return HtmlService.createHtmlOutput(html);
}

function rosterV2RenderAuthError_(message, returnUrl) {
  var safeMsg = rosterV2EscapeHtml_(message || 'Administrator verification failed. Return to REQUEST-APP and try again.');
  var safeLinkHtml = '';
  if (returnUrl) {
    var safeReturnUrl = rosterV2EscapeHtml_(returnUrl);
    safeLinkHtml = '<a href="' + safeReturnUrl + '" target="_top" class="btn">Return to REQUEST-APP</a>';
  }
  var html = '<!DOCTYPE html><html><head><meta charset="utf-8">' +
    '<base target="_top">' +
    '<title>Administrator Verification Failed</title>' +
    '<style>' +
    'body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 1.5rem; box-sizing: border-box; }' +
    '.card { background: #1e293b; border: 1px solid #334155; border-radius: 1rem; padding: 2.5rem; max-width: 440px; width: 100%; text-align: center; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5); }' +
    '.icon-wrap { width: 56px; height: 56px; margin: 0 auto 1.5rem; border-radius: 50%; background: #4c0519; display: flex; align-items: center; justify-content: center; color: #fb7185; font-size: 28px; font-weight: bold; }' +
    'h1 { font-size: 1.25rem; font-weight: 700; margin: 0 0 0.75rem; color: #fda4af; }' +
    'p { color: #94a3b8; font-size: 0.9375rem; line-height: 1.5; margin: 0 0 2rem; }' +
    '.btn { display: inline-block; width: 100%; padding: 0.875rem 1.25rem; background: #334155; color: #ffffff; text-decoration: none; font-weight: 600; font-size: 0.9375rem; border-radius: 0.5rem; box-sizing: border-box; transition: background 0.15s ease; }' +
    '.btn:hover { background: #475569; }' +
    '</style>' +
    '</head><body>' +
    '<div class="card">' +
    '<div class="icon-wrap">&#10007;</div>' +
    '<h1>Administrator Verification Failed</h1>' +
    '<p>' + safeMsg + '</p>' +
    safeLinkHtml +
    '</div>' +
    '</body></html>';
  return HtmlService.createHtmlOutput(html);
}

function rosterV2AuthChallenge_(params) {
  var origin = rosterV2ValidateOrigin_(params && params.origin);
  if (!origin) {
    return createJsonResponse({ ok: false, error: { code: 'UNTRUSTED_ORIGIN', message: 'Untrusted frontend origin.' } });
  }

  var redirectUri;
  try {
    redirectUri = rosterV2GetOAuthRedirectUri_();
  } catch (err) {
    return createJsonResponse({ ok: false, error: { code: 'REDIRECT_URI_MISMATCH', message: err.message || String(err) } });
  }

  var returnUrl = origin;
  if (params && params.returnUrl && typeof params.returnUrl === 'string') {
    returnUrl = rosterV2ValidateReturnUrl_(params.returnUrl, origin);
  }

  var state = Utilities.getUuid();
  var challengeData = {
    state: state,
    origin: origin,
    returnUrl: returnUrl,
    createdAt: Date.now()
  };

  try {
    var cache = CacheService.getScriptCache();
    cache.put('v2_auth_challenge_' + state, JSON.stringify(challengeData), 300);
  } catch (err) {
    return createJsonResponse({ ok: false, error: { code: 'CACHE_UNAVAILABLE', message: 'Unable to store authentication challenge.' } });
  }

  return createJsonResponse({
    ok: true,
    state: state,
    origin: origin,
    returnUrl: returnUrl,
    redirectUri: redirectUri,
    expiresIn: 300
  });
}

function rosterV2HandleOAuthCallback_(params) {
  if (!params || !params.state || !params.code) {
    return rosterV2RenderAuthError_('Missing authorization code or state parameter.');
  }

  var state = String(params.state).trim();
  var code = String(params.code).trim();
  var cache = CacheService.getScriptCache();
  var cacheKey = 'v2_auth_challenge_' + state;
  var cachedRaw = cache.get(cacheKey);

  if (!cachedRaw) {
    return rosterV2RenderAuthError_('Authentication challenge expired or invalid.');
  }

  // Single-use: immediately remove state from cache before exchanging code
  cache.remove(cacheKey);

  var challenge = null;
  try {
    challenge = JSON.parse(cachedRaw);
  } catch (_) {
    return rosterV2RenderAuthError_('Malformed authentication challenge.');
  }

  var origin = rosterV2ValidateOrigin_(challenge && challenge.origin);
  if (!origin) {
    return rosterV2RenderAuthError_('Untrusted frontend return origin.');
  }

  var rawReturn = (challenge && challenge.returnUrl) || origin;
  var returnUrl = rosterV2ValidateReturnUrl_(rawReturn, origin);

  var props = PropertiesService.getScriptProperties();
  var clientId = String(props.getProperty('ROSTER_V2_OAUTH_CLIENT_ID') || '').trim();
  var clientSecret = String(props.getProperty('ROSTER_V2_OAUTH_CLIENT_SECRET') || '').trim();
  var adminEmail = String(props.getProperty('ROSTER_V2_ADMIN_EMAIL') || '').trim().toLowerCase();
  var sessionSecret = String(props.getProperty('ROSTER_V2_SESSION_SECRET') || '').trim();
  var hostedDomain = String(props.getProperty('ROSTER_V2_ADMIN_HOSTED_DOMAIN') || '').trim();
  var redirectUri;
  try {
    redirectUri = rosterV2GetOAuthRedirectUri_();
  } catch (err) {
    return rosterV2RenderAuthError_(err.message || 'Redirect URI mismatch.', returnUrl);
  }

  if (!clientId || !clientSecret || !adminEmail || !sessionSecret) {
    return rosterV2RenderAuthError_('OAuth or session configuration is incomplete on server.', returnUrl);
  }

  // Exchange code using exact Apps Script redirect URI
  // FAIL CLOSED on mismatch: NO postmessage fallback!
  var tokenPayload = {
    code: code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code'
  };

  var tokenResp = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
    method: 'post',
    payload: tokenPayload,
    muteHttpExceptions: true
  });

  if (tokenResp.getResponseCode() !== 200) {
    return rosterV2RenderAuthError_('Failed to exchange authorization code with Google.', returnUrl);
  }

  var tokenJson = JSON.parse(tokenResp.getContentText());
  var accessToken = tokenJson.access_token;
  if (!accessToken) {
    return rosterV2RenderAuthError_('Google did not return an access token.', returnUrl);
  }

  // Google UserInfo verification (never tokeninfo)
  var userInfoResp = UrlFetchApp.fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    method: 'get',
    headers: { Authorization: 'Bearer ' + accessToken },
    muteHttpExceptions: true
  });

  if (userInfoResp.getResponseCode() !== 200) {
    return rosterV2RenderAuthError_('Failed to verify identity with Google UserInfo.', returnUrl);
  }

  var userInfo = JSON.parse(userInfoResp.getContentText());
  var sub = String(userInfo.sub || '').trim();
  var email = String(userInfo.email || '').trim().toLowerCase();
  var emailVerified = userInfo.email_verified === true || String(userInfo.email_verified) === 'true';

  if (!sub || !email || !emailVerified) {
    return rosterV2RenderAuthError_('Google email is unverified or missing.', returnUrl);
  }
  if (email !== adminEmail) {
    return rosterV2RenderAuthError_('Google identity does not match configured administrator email.', returnUrl);
  }
  if (hostedDomain) {
    var hd = String(userInfo.hd || '').trim().toLowerCase();
    if (hd !== hostedDomain.toLowerCase()) {
      return rosterV2RenderAuthError_('Google identity domain does not match configured hosted domain.', returnUrl);
    }
  }

  // Generate one-time handoff code (TTL: 120 seconds)
  var handoffCode = Utilities.getUuid();
  var handoffData = {
    sub: sub,
    email: email,
    createdAt: Date.now()
  };
  cache.put('v2_auth_handoff_' + handoffCode, JSON.stringify(handoffData), 120);

  // Return browser to safe return URL with ?v2auth=<handoff-code>
  var separator = returnUrl.indexOf('?') === -1 ? '?' : '&';
  var finalDestination = returnUrl + separator + 'v2auth=' + encodeURIComponent(handoffCode);

  return rosterV2RenderAuthHtml_(finalDestination);
}

function rosterV2AuthRedeem_(data) {
  try {
    var code = data && (data.handoffCode || data.code);
    if (!code || typeof code !== 'string') {
      return createJsonResponse({ ok: false, error: { code: 'INVALID_REQUEST', message: 'Missing handoff code.' } });
    }

    var cache = CacheService.getScriptCache();
    var cacheKey = 'v2_auth_handoff_' + String(code).trim();
    var cachedRaw = cache.get(cacheKey);

    if (!cachedRaw) {
      return createJsonResponse({ ok: false, error: { code: 'INVALID_HANDOFF', message: 'Authentication handoff expired or invalid.' } });
    }

    // Single-use: immediately remove from cache
    cache.remove(cacheKey);

    var handoff = null;
    try {
      handoff = JSON.parse(cachedRaw);
    } catch (_) {
      return createJsonResponse({ ok: false, error: { code: 'MALFORMED_HANDOFF', message: 'Malformed authentication handoff.' } });
    }

    var props = PropertiesService.getScriptProperties();
    var sessionSecret = String(props.getProperty('ROSTER_V2_SESSION_SECRET') || '').trim();
    var adminEmail = String(props.getProperty('ROSTER_V2_ADMIN_EMAIL') || '').trim().toLowerCase();

    if (!sessionSecret || !adminEmail) {
      return createJsonResponse({ ok: false, error: { code: 'CONFIG_INCOMPLETE', message: 'Session secret configuration incomplete.' } });
    }

    if (String(handoff.email || '').trim().toLowerCase() !== adminEmail) {
      return createJsonResponse({ ok: false, error: { code: 'UNAUTHORIZED_EMAIL', message: 'Handoff email does not match admin email.' } });
    }

    // Issue short-lived HMAC admin session token
    var session = rosterV2IssueAdminSessionToken_(handoff.sub, handoff.email, sessionSecret);
    return createJsonResponse({
      ok: true,
      adminSessionToken: session.token,
      expiresAt: session.expiresAt,
      email: session.email
    });
  } catch (err) {
    return createJsonResponse({ ok: false, error: { code: 'AUTH_ERROR', message: err.message || String(err) } });
  }
}

function rosterV2AuthStatus_(data) {
  try {
    var admin = rosterV2RequireAdmin_(data);
    return createJsonResponse({ ok: true, authenticated: true, email: admin.email });
  } catch (err) {
    return createJsonResponse({ ok: false, authenticated: false, error: { code: 'UNAUTHORIZED', message: 'V2 administrator authorization required.' } });
  }
}

function rosterV2DispatchGet_(parameters) {
  if (parameters && parameters.code && parameters.state) return rosterV2HandleOAuthCallback_(parameters);
  const action = String(parameters.action || '').toLowerCase();
  if (action === 'rosterv2oauthcallback') return rosterV2HandleOAuthCallback_(parameters);
  if (action === 'rosterv2authchallenge') return rosterV2AuthChallenge_(parameters);
  if (action === 'rosterv2authstatus') return rosterV2AuthStatus_(parameters);
  if (['rosterv2draft','rosterv2operation','rosterv2draftschema'].includes(action)) return rosterDraftRoute_(action, parameters);
  if (['rosterv2offpolicies','rosterv2guidanceschema'].includes(action)) return rosterGuidanceRoute_(action, parameters);
  if (['rosterv2lifecycleschema','rosterv2periodlifecycle','rosterv2amendmenthistory','rosterv2planned','rosterv2current','rosterv2absences','rosterv2replacements','rosterv2entitlementbalances','rosterv2entitlementtransactions'].includes(action)) return rosterLifecycleRoute_(action, parameters);
  if (action === 'rosterv2schema') return createJsonResponse(rosterV2Schema_());
  if (action === 'rosterv2period') return createJsonResponse(rosterV2Period_(parameters));
  // Reserve the namespace: private/unknown v2 reads cannot fall through to legacy Requests.
  rosterV2RequireAdmin_(parameters);
  throw new Error('Phase 1 does not expose private v2 data or official operations.');
}

function rosterV2DispatchPost_(data) {
  const action = String(data.action || '').toLowerCase();
  if (action === 'rosterv2authchallenge') return rosterV2AuthChallenge_(data);
  if (action === 'rosterv2authredeem') return rosterV2AuthRedeem_(data);
  if (action === 'rosterv2authstatus') return rosterV2AuthStatus_(data);
  if (['rosterv2draft','rosterv2draftschema','rosterv2draftpatch','rosterv2draftrecover','rosterv2draftabandon'].includes(action)) return rosterDraftRoute_(action, data);
  if (['rosterv2offpolicies','rosterv2guidanceschema','rosterv2offpolicy','rosterv2offpolicyrecover'].includes(action)) return rosterGuidanceRoute_(action, data);
  if (['rosterv2publish','rosterv2close','rosterv2reopen','rosterv2lifecyclerecover','rosterv2amend','rosterv2amendreversal','rosterv2absencecreate','rosterv2replacementcreate','rosterv2absencereverse','rosterv2replacementreverse','rosterv2absencerecover','rosterv2replacementrecover','rosterv2entitlementearngoff','rosterv2entitlementearnghka','rosterv2entitlementcreditmanual','rosterv2entitlementconsume','rosterv2entitlementcreditreverse','rosterv2entitlementconsumereverse','rosterv2entitlementrecover'].includes(action)) return rosterLifecycleRoute_(action, data);
  rosterV2RequireAdmin_(data);
  throw new Error('Official v2 writes are disabled in Phase 1.');
}

function rosterV2GuardSetting_(key) {
  if (!RosterCompatibility.isReservedSetting(String(key || '').trim())) return;
  rosterV2RequireAdmin_();
  throw new Error('V2 configuration writes are disabled in Phase 1.');
}

function rosterV2GuardLegacyUpload_(data) {
  const settings = rosterV2Settings_();
  if (settings.legacy_upload_enabled === 'false') {
    throw new Error('Legacy roster upload is disabled.');
  }

  const table = rosterV2ReadTable_('RosterPeriods');
  if (!table.exists || !table.rows.some(function(row) { return row.some(function(v) { return v !== '' && v !== null; }); })) {
    return; // No RosterPeriods table or no rows -> all periods are legacy
  }

  const periodIdIdx = table.headers.indexOf('PeriodId');
  const stateIdx = table.headers.indexOf('State');
  const statusIdx = table.headers.indexOf('Status');
  const schemaVerIdx = table.headers.indexOf('SchemaVersion');

  const protectedPeriods = new Set();
  table.rows.forEach(function(row) {
    if (!row || !row.some(function(v) { return v !== '' && v !== null; })) return;
    const pid = periodIdIdx >= 0 ? String(row[periodIdIdx] || '').trim() : '';
    if (!pid) {
      protectedPeriods.add('__ANY__');
      return;
    }

    const state = stateIdx >= 0 ? String(row[stateIdx] || '').trim().toUpperCase() : '';
    const status = statusIdx >= 0 ? String(row[statusIdx] || '').trim().toUpperCase() : '';
    const schemaVer = schemaVerIdx >= 0 ? Number(row[schemaVerIdx]) : 0;

    const isProtected = (schemaVer >= 2) || (status === 'ENROLLED') ||
      ['DRAFT', 'PUBLISHED', 'CLOSED', 'AMENDED'].includes(state) ||
      (schemaVerIdx >= 0 && statusIdx === -1 && stateIdx === -1);

    if (isProtected) {
      protectedPeriods.add(pid);
    }
  });

  if (protectedPeriods.size === 0) return;

  const isMonthScoped = data && typeof data === 'object' && Boolean(data.targetMonth);

  if (!isMonthScoped) {
    // Full roster upload without targetMonth clears the entire sheet.
    // If any enrollment exists, block the full upload to protect enrolled months.
    throw new Error('Legacy full-roster upload is blocked because RosterPeriods contains enrollment data.');
  }

  // Month-scoped upload: identify touched periods
  const targetMonth = String(data.targetMonth).trim().slice(0, 7);
  const touchedPeriods = new Set();
  if (/^\d{4}-\d{2}$/.test(targetMonth)) touchedPeriods.add(targetMonth);

  const rows = Array.isArray(data.rows) ? data.rows : [];
  rows.forEach(function(r) {
    const dateStr = typeof r === 'object' && r ? (r.date || r.Date || (Array.isArray(r) ? r[1] : '')) : '';
    const m = typeof dateStr === 'string' && /^\d{4}-\d{2}/.test(dateStr) ? dateStr.slice(0, 7) : '';
    if (m) touchedPeriods.add(m);
  });

  const blocked = [];
  touchedPeriods.forEach(function(p) {
    if (protectedPeriods.has(p) || protectedPeriods.has('__ANY__')) blocked.push(p);
  });

  if (blocked.length > 0) {
    throw new Error('Legacy roster upload is blocked because RosterPeriods contains enrollment data for protected period(s): ' + blocked.join(', '));
  }
}
