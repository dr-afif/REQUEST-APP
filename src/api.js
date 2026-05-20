const rawBaseUrl = import.meta.env.VITE_APPS_SCRIPT_URL ?? '';
const APP_SCRIPT_BASE_URL = rawBaseUrl.trim().replace(/\/$/, '');

function buildUrl(query) {
  if (!APP_SCRIPT_BASE_URL) {
    throw new Error('Apps Script URL is not configured. Set VITE_APPS_SCRIPT_URL in your .env file.');
  }

  const url = new URL(APP_SCRIPT_BASE_URL);

  if (query && typeof query === 'object') {
    Object.entries(query).forEach(([key, value]) => {
      if (value === undefined || value === null || value === '') return;
      url.searchParams.set(key, value);
    });
  }

  return url.toString();
}

async function request({ method = 'GET', body, headers, query } = {}) {
  const url = buildUrl(query);
  const options = {
    method,
    headers: {
      Accept: 'application/json',
      ...headers,
    },
  };

  if (body !== undefined) {
    options.body = JSON.stringify(body);
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

export async function uploadMasterRoster(rows) {
  return request({ method: 'POST', body: { action: 'uploadmasterroster', rows } });
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