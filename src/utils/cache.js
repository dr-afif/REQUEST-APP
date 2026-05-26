// App.jsx owns cache key names and defaults; these helpers only isolate safe localStorage access.
export function readCache(key, fallbackValue) {
  try {
    const cached = localStorage.getItem(key);
    return cached ? JSON.parse(cached) : fallbackValue;
  } catch {
    return fallbackValue;
  }
}

export function hasCacheValue(key) {
  try {
    return Boolean(localStorage.getItem(key));
  } catch {
    return false;
  }
}

export function writeCacheEntries(entries) {
  entries.forEach(([key, value]) => {
    localStorage.setItem(key, JSON.stringify(value));
  });
}
