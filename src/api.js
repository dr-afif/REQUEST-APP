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