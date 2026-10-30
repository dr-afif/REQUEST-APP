import { getAdminSessionToken } from './features/roster/auth/adminAuth.js';

let devMockChecker = null;
let devMockDispatcher = null;

export function registerDevMock({ isActive, handler } = {}) {
  devMockChecker = typeof isActive === 'function' ? isActive : null;
  devMockDispatcher = typeof handler === 'function' ? handler : null;
}

export const LEGACY_ADMIN_MUTATION_ACTIONS = new Set([
  'uploadmasterroster',
  'updaterequestapproval',
  'addshiftblock',
  'deleteshiftblock',
  'addshifttype',
  'updateshifttype',
  'deleteshifttype',
  'reordershifttypes',
  'addlimitgroup',
  'updatelimitgroup',
  'deletelimitgroup',
  'addactivity',
  'deleteactivity',
  'updatesetting',
  'updateteammembers',
  'updateemergencyphysicians',
  'upsertpublicholiday',
  'deletepublicholiday',
  'upsertleaveapplication',
  'deleteleaveapplication',
]);

export const SIMPLIFIED_ADMIN_MUTATION_ACTIONS = new Set([
  'savemasterrosterdraft',
  'appendrosteramendments',
  'appendamendroster',
]);

export function getActiveBackendUrl() {
  const rawBaseUrl = import.meta.env.VITE_APPS_SCRIPT_URL ?? '';
  const prodUrl = rawBaseUrl.trim().replace(/\/$/, '');

  if (typeof window !== 'undefined') {
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const stagingParam = (urlParams.get('stagingUrl') || urlParams.get('staging_url') || '').trim().replace(/\/$/, '');
      if (stagingParam && stagingParam.startsWith('https://script.google.com/')) {
        if (!prodUrl || stagingParam !== prodUrl) {
          return stagingParam;
        }
      }
      const storedStaging = (window.localStorage?.getItem('resq_staging_api_url') || '').trim().replace(/\/$/, '');
      if (storedStaging && storedStaging.startsWith('https://script.google.com/')) {
        if (!prodUrl || storedStaging !== prodUrl) {
          return storedStaging;
        }
      }
    } catch (_) {}
  }
  return prodUrl;
}

function buildUrl(query) {
  const baseUrl = getActiveBackendUrl();
  if (!baseUrl) {
    throw new Error('Apps Script URL is not configured. Set VITE_APPS_SCRIPT_URL in your .env file or supply ?stagingUrl=...');
  }

  const url = new URL(baseUrl);

  if (query && typeof query === 'object') {
    Object.entries(query).forEach(([key, value]) => {
      if (value === undefined || value === null || value === '') return;
      url.searchParams.set(key, value);
    });
  }

  return url.toString();
}

async function request({ method = 'GET', body, headers, query } = {}) {
  if (devMockChecker && devMockChecker() && devMockDispatcher) {
    return devMockDispatcher({ method, body, headers, query });
  }
  const url = buildUrl(query);
  const options = {
    method,
    headers: {
      Accept: 'application/json',
      ...headers,
    },
  };

  if (body !== undefined) {
    let finalBody = body;
    const action = typeof body?.action === 'string' ? body.action.trim().toLowerCase() : '';
    if (LEGACY_ADMIN_MUTATION_ACTIONS.has(action) || SIMPLIFIED_ADMIN_MUTATION_ACTIONS.has(action)) {
      const token = getAdminSessionToken() || body.adminSessionToken;
      if (!token) {
        throw new Error('Administrator session required for this operation.');
      }
      finalBody = { ...body, adminSessionToken: token };
    }
    options.body = JSON.stringify(finalBody);
    // Apps Script receives write actions from the JSON body while reads use query params.
    if (!options.headers['Content-Type']) {
      options.headers['Content-Type'] = 'text/plain;charset=UTF-8';
    }
  }

  const response = await fetch(url, options);
  const contentType = response.headers.get('content-type') ?? '';

  const payload = contentType.includes('application/json')
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    const message = typeof payload === 'string' ? payload : payload?.message;
    throw new Error(message || 'Request failed');
  }

  if (payload && typeof payload === 'object' && !Array.isArray(payload) && payload.result === 'error') {
    throw new Error(payload.message || 'Request failed');
  }

  return payload;
}

export async function fetchAllRequests() {
  return request();
}

export async function fetchTeamMembers() {
  const response = await request({ query: { action: 'teamMembers' } });
  if (Array.isArray(response)) {
    return response;
  }
  if (Array.isArray(response?.rows)) {
    return response.rows;
  }
  return [];
}

export async function fetchEmergencyPhysicians() {
  const response = await request({ query: { action: 'emergencyPhysicians' } });
  if (Array.isArray(response)) {
    return response;
  }
  if (Array.isArray(response?.rows)) {
    return response.rows;
  }
  return [];
}

export async function submitRequest(payload) {
  return request({ method: 'POST', body: { action: 'submit', ...payload } });
}

export async function updateRequest(id, payload) {
  return request({ method: 'POST', body: { action: 'update', id, ...payload } });
}

export async function deleteRequest(id) {
  return request({ method: 'POST', body: { action: 'delete', id } });
}

export async function fetchMasterRoster() {
  return request({ query: { action: 'masterroster' } });
}

export async function fetchShiftBlocks() {
  return request({ query: { action: 'shiftblocks' } });
}

export async function fetchAllData() {
  return request({ query: { action: 'alldata' } });
}

export async function uploadMasterRoster(rows, targetMonth) {
  const trimmedMonth = typeof targetMonth === 'string' ? targetMonth.trim() : '';
  if (!trimmedMonth || !/^\d{4}-(0[1-9]|1[0-2])$/.test(trimmedMonth) || trimmedMonth.startsWith('0000')) {
    throw new Error('targetMonth is required in YYYY-MM format for roster upload.');
  }
  const payload = { action: 'uploadmasterroster', rows, targetMonth: trimmedMonth };
  return request({ method: 'POST', body: payload });
}

export async function updateRequestApproval(id, approvalStatus) {
  return request({ method: 'POST', body: { action: 'updaterequestapproval', id, approvalStatus } });
}

export async function submitShiftBlock(payload) {
  return request({ method: 'POST', body: { action: 'addshiftblock', ...payload } });
}

export async function deleteShiftBlock(id) {
  return request({ method: 'POST', body: { action: 'deleteshiftblock', id } });
}

export async function submitShiftType(payload) {
  return request({ method: 'POST', body: { action: 'addshifttype', ...payload } });
}

export async function updateShiftType(id, payload) {
  return request({ method: 'POST', body: { action: 'updateshifttype', id, ...payload } });
}

export async function deleteShiftType(id) {
  return request({ method: 'POST', body: { action: 'deleteshifttype', id } });
}

export async function reorderShiftTypes(ids) {
  return request({ method: 'POST', body: { action: 'reordershifttypes', ids } });
}


export async function submitLimitGroup(payload) {
  return request({ method: 'POST', body: { action: 'addlimitgroup', ...payload } });
}

export async function updateLimitGroup(id, payload) {
  return request({ method: 'POST', body: { action: 'updatelimitgroup', id, ...payload } });
}

export async function deleteLimitGroup(id) {
  return request({ method: 'POST', body: { action: 'deletelimitgroup', id } });
}

export async function submitActivity(payload) {
  return request({ method: 'POST', body: { action: 'addactivity', ...payload } });
}

export async function deleteActivity(id) {
  return request({ method: 'POST', body: { action: 'deleteactivity', id } });
}

export async function updateSetting(key, value) {
  return request({ method: 'POST', body: { action: 'updatesetting', key, value } });
}

export async function updateTeamMembers(members) {
  return request({ method: 'POST', body: { action: 'updateteammembers', members } });
}

export async function updateEmergencyPhysicians(members) {
  return request({ method: 'POST', body: { action: 'updateemergencyphysicians', members } });
}

export async function upsertPublicHoliday(payload) {
  return request({ method: 'POST', body: { action: 'upsertpublicholiday', ...payload } });
}

export async function deletePublicHoliday(date) {
  return request({ method: 'POST', body: { action: 'deletepublicholiday', date } });
}

export async function fetchLeaveApplications() {
  return request({ query: { action: 'leaveapplications' } });
}

export async function upsertLeaveApplication(payload) {
  return request({ method: 'POST', body: { action: 'upsertleaveapplication', ...payload } });
}

export async function deleteLeaveApplication(id) {
  return request({ method: 'POST', body: { action: 'deleteleaveapplication', id } });
}

// Phase 1 diagnostics are opt-in; the legacy application never calls these automatically.
export async function fetchRosterSchema() {
  return request({ query: { action: 'rosterv2schema' } });
}

export async function fetchRosterPeriodShadow(period) {
  return request({ query: { action: 'rosterv2period', period, mode: 'shadow' } });
}

export async function verifyAdminPinRemote(pin) {
  const cleanPin = String(pin ?? '').trim();
  if (!cleanPin) {
    throw new Error('Security PIN is required.');
  }
  return request({
    method: 'POST',
    body: {
      action: 'verifyadminpin',
      pin: cleanPin,
    },
  });
}

export async function fetchRosterAmendments(month) {
  const response = await request({
    query: {
      action: 'amendroster',
      ...(month ? { month: String(month).trim() } : {}),
    },
  });
  if (!Array.isArray(response)) return [];
  // Guard against un-deployed legacy Apps Script returning Requests rows for unknown GET actions
  return response.filter(
    (row) =>
      row &&
      typeof row === 'object' &&
      ('AmendmentId' in row ||
        'amendmentId' in row ||
        'NewValue' in row ||
        'newValue' in row ||
        'IsCleared' in row ||
        'isCleared' in row ||
        'RosterMonth' in row ||
        'rosterMonth' in row)
  );
}

export async function saveMasterRosterDraft({
  changes,
  rows,
  targetMonth,
  operationId,
  expectedCellBaselines,
  expectedMonthCellCount,
} = {}) {
  const trimmedMonth = typeof targetMonth === 'string' ? targetMonth.trim() : '';
  if (!trimmedMonth || !/^\d{4}-(0[1-9]|1[0-2])$/.test(trimmedMonth) || trimmedMonth.startsWith('0000')) {
    throw new Error('targetMonth is required in YYYY-MM format for draft roster save.');
  }
  const payload = {
    action: 'savemasterrosterdraft',
    ...(Array.isArray(changes) ? { changes } : {}),
    rows: Array.isArray(rows) ? rows : [],
    targetMonth: trimmedMonth,
    ...(operationId ? { operationId: String(operationId).trim() } : {}),
    ...(Array.isArray(expectedCellBaselines) ? { expectedCellBaselines } : {}),
    ...(typeof expectedMonthCellCount === 'number' ? { expectedMonthCellCount } : {}),
  };
  return request({ method: 'POST', body: payload });
}

export async function appendRosterAmendments({
  targetMonth,
  operationId,
  amendments,
} = {}) {
  const trimmedMonth = typeof targetMonth === 'string' ? targetMonth.trim() : '';
  if (!trimmedMonth || !/^\d{4}-(0[1-9]|1[0-2])$/.test(trimmedMonth) || trimmedMonth.startsWith('0000')) {
    throw new Error('targetMonth is required in YYYY-MM format for roster amendments.');
  }
  const trimmedOpId = typeof operationId === 'string' ? operationId.trim() : '';
  if (!trimmedOpId) {
    throw new Error('operationId is required for idempotent amendment saves.');
  }
  if (!Array.isArray(amendments) || amendments.length === 0) {
    throw new Error('At least one amendment record is required.');
  }
  return request({
    method: 'POST',
    body: {
      action: 'appendrosteramendments',
      targetMonth: trimmedMonth,
      operationId: trimmedOpId,
      amendments,
    },
  });

}

export const fetchAmendRoster = fetchRosterAmendments;
export const appendAmendRoster = appendRosterAmendments;

export async function verifyStagingBackendIdentity(targetUrl, { knownProductionUrl, fetchFn = (typeof fetch !== 'undefined' ? fetch : null) } = {}) {
  const cleanUrl = String(targetUrl || '').trim().replace(/\/$/, '');
  if (!cleanUrl || !cleanUrl.startsWith('https://script.google.com/macros/s/')) {
    return {
      verified: false,
      reason: 'INVALID_URL',
      message: 'Staging URL must be a valid Google Apps Script Web App URL.',
    };
  }

  // Reject known production URL immediately
  const prodUrl = (
    knownProductionUrl ||
    (typeof process !== 'undefined' && process.env?.VITE_APPS_SCRIPT_URL) ||
    import.meta.env?.VITE_APPS_SCRIPT_URL ||
    ''
  ).trim().replace(/\/$/, '');
  if (prodUrl && cleanUrl === prodUrl) {
    return {
      verified: false,
      reason: 'PRODUCTION_URL_BLOCKED',
      message: 'Safety lockout: The provided URL matches the production backend URL.',
    };
  }

  if (typeof fetchFn !== 'function') {
    return {
      verified: false,
      reason: 'FETCH_UNAVAILABLE',
      message: 'Network fetch is not available in current environment.',
    };
  }

  try {
    const url = new URL(cleanUrl);
    url.searchParams.set('action', 'stagingidentity');
    const res = await fetchFn(url.toString(), {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
      return {
        verified: false,
        reason: 'HTTP_ERROR',
        message: `HTTP ${res.status} from staging identity endpoint.`,
      };
    }
    const data = await res.json();
    if (data && data.isStaging === true && data.result === 'success' && data.appEnvironment === 'staging' && data.spreadsheetId) {
      return {
        verified: true,
        spreadsheetId: data.spreadsheetId,
        spreadsheetName: data.spreadsheetName || '',
        stagingInitializedAt: data.stagingInitializedAt || '',
      };
    }
    return {
      verified: false,
      reason: 'UNVERIFIED_BACKEND',
      message: data?.message || 'Target backend does not identify as an authorized staging environment.',
    };
  } catch (err) {
    return {
      verified: false,
      reason: 'NETWORK_ERROR',
      message: err.message || 'Failed to reach staging identity endpoint.',
    };
  }
}
