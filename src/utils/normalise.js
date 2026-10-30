export function normalizeForComparison(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export function toIsoDate(dateLike) {
  if (!dateLike) return null;
  if (typeof dateLike === 'string' && dateLike.includes('/')) {
    const [day, month, year] = dateLike.split(/[\\/]/);
    if (day && month && year) {
      const mm = month.padStart(2, '0');
      const dd = day.padStart(2, '0');
      return `${year}-${mm}-${dd}`;
    }
  }
  const date = new Date(dateLike);
  if (Number.isNaN(date.getTime())) return null;
  const mm = `${date.getMonth() + 1}`.padStart(2, '0');
  const dd = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${mm}-${dd}`;
}

export function toWeekdayName(dateLike, locale = 'en-US') {
  const date = new Date(dateLike);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(locale, { weekday: 'long' });
}

/**
 * Deterministic deep comparison for plain JSON-compatible settings objects.
 * Preserves object identity across routine background syncs when values are unchanged.
 *
 * Requirements:
 * - preserves existing reference when values are unchanged;
 * - updates when any setting value changes;
 * - handles added or removed keys;
 * - compares false, 0, null, and empty-string accurately (strict equality);
 * - supports nested objects/arrays if present;
 * - non-mutating.
 */
export function settingsEquivalent(a, b) {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') {
    return false;
  }
  const isArrA = Array.isArray(a);
  const isArrB = Array.isArray(b);
  if (isArrA !== isArrB) return false;

  if (isArrA) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!settingsEquivalent(a[i], b[i])) return false;
    }
    return true;
  }

  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;

  for (let i = 0; i < keysA.length; i++) {
    const key = keysA[i];
    if (!Object.prototype.hasOwnProperty.call(b, key)) {
      return false;
    }
    const valA = a[key];
    const valB = b[key];
    if (valA === valB) continue;
    if (typeof valA === 'object' && valA !== null && typeof valB === 'object' && valB !== null) {
      if (!settingsEquivalent(valA, valB)) return false;
    } else {
      return false;
    }
  }

  return true;
}