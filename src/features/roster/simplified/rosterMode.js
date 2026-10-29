export const SIMPLIFIED_TIMEZONE = 'Asia/Kuala_Lumpur';

/**
 * Returns the current calendar month in YYYY-MM format using Malaysia timezone (Asia/Kuala_Lumpur).
 * @param {Date|number|string} [now=new Date()]
 * @returns {string} YYYY-MM
 */
export function getCurrentMonthMalaysia(now = new Date()) {
  const dateObj = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(dateObj.getTime())) {
    const fallback = new Date();
    return formatMalaysiaYearMonth(fallback);
  }
  return formatMalaysiaYearMonth(dateObj);
}

function formatMalaysiaYearMonth(dateObj) {
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: SIMPLIFIED_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
    });
    const parts = formatter.formatToParts(dateObj);
    const year = parts.find((p) => p.type === 'year')?.value;
    const month = parts.find((p) => p.type === 'month')?.value;
    if (year && month && /^\d{4}$/.test(year) && /^(0[1-9]|1[0-2])$/.test(month)) {
      return `${year}-${month}`;
    }
  } catch (_) {
    // Fallback to UTC+8 manual offset if Intl timeZone is unavailable
  }
  const utc8Ms = dateObj.getTime() + 8 * 60 * 60 * 1000;
  const utc8Date = new Date(utc8Ms);
  const y = utc8Date.getUTCFullYear();
  const m = String(utc8Date.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

/**
 * Validates a YYYY-MM month string.
 * @param {string} month
 * @returns {string} trimmed YYYY-MM
 */
export function validateRosterMonth(month) {
  const trimmed = String(month || '').trim();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(trimmed) || trimmed.startsWith('0000')) {
    throw new Error(`Invalid roster month "${month}". Expected YYYY-MM.`);
  }
  return trimmed;
}

/**
 * Automatic Draft vs Amend routing based on Malaysia calendar month (Asia/Kuala_Lumpur):
 * - Future months (rosterMonth > currentMonth) -> DRAFT (writes target MAIN / MasterRoster)
 * - Current and past months (rosterMonth <= currentMonth) -> AMEND (writes target AMEND / RosterAmendments)
 *
 * @param {string} rosterMonth YYYY-MM
 * @param {Date|number|string} [now=new Date()]
 */
export function resolveSimplifiedRosterMode(rosterMonth, now = new Date()) {
  const validRosterMonth = validateRosterMonth(rosterMonth);
  const currentMonth = getCurrentMonthMalaysia(now);
  const isFutureMonth = validRosterMonth > currentMonth;

  if (isFutureMonth) {
    return {
      mode: 'DRAFT',
      target: 'MAIN',
      targetSheet: 'MasterRoster',
      rosterMonth: validRosterMonth,
      currentMonth,
      isFutureMonth: true,
      badgeText: 'DRAFT MODE (Future Month — Saves to Main Roster)',
      shortLabel: 'DRAFT MODE',
      saveButtonLabel: 'Save Changes to Main Roster',
    };
  }

  return {
    mode: 'AMEND',
    target: 'AMEND',
    targetSheet: 'RosterAmendments',
    rosterMonth: validRosterMonth,
    currentMonth,
    isFutureMonth: false,
    badgeText: 'AMEND MODE (Current/Past Month — Saves to Amendments)',
    shortLabel: 'AMEND MODE',
    saveButtonLabel: 'Save Changes to Amendments',
  };
}
