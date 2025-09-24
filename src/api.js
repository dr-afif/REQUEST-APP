const APP_SCRIPT_BASE_URL = import.meta.env.VITE_APPS_SCRIPT_URL ?? '';

async function request(path, { method = 'GET', body, headers } = {}) {
  const url = `${APP_SCRIPT_BASE_URL}${path}`;
  const options = {
    method,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...headers,
    },
  };

  if (body !== undefined) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);
  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || 'Request failed');
  }

  const contentType = response.headers.get('content-type');
  if (contentType && contentType.includes('application/json')) {
    return response.json();
  }

  return response.text();
}

export async function fetchAllRequests() {
  return request('/requests');
}

export async function submitRequest(payload) {
  return request('/submit', { method: 'POST', body: payload });
}

export async function updateRequest(id, payload) {
  return request(`/requests/${id}`, { method: 'PUT', body: payload });
}

export async function deleteRequest(id) {
  return request(`/requests/${id}`, { method: 'DELETE' });
}
