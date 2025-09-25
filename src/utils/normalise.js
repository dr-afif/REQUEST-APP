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