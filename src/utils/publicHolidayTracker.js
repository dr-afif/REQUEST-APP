import { HOLIDAYS } from './holidays';

/**
 * Normalizes night shift variants to a standard "NIGHT" representation.
 */
const normalizeShift = (shift) => {
  if (!shift) return '';
  const s = shift.toUpperCase().trim();
  if (['NIGHT', 'N', 'ON', 'ON1', 'ON2'].includes(s)) return 'NIGHT';
  return s;
};

/**
 * Checks if a shift is a qualifying working shift for PH credits.
 */
const isWorkingShift = (shift) => {
  if (!shift) return false;
  const s = normalizeShift(shift);
  return ['AM', 'PM', 'NIGHT', 'PN'].includes(s);
};

/**
 * Step 1: Find all PH credits earned by doctors.
 * @param {Array} masterRoster - The full master roster array
 * @param {Array} names - Array of active doctor names
 * @returns {Array} List of earned PH credits
 */
export const getPublicHolidayCredits = (masterRoster, names) => {
  const credits = [];
  const nameSet = new Set(names.map(n => n.toLowerCase()));

  masterRoster.forEach(row => {
    const docName = row.name || row.Name;
    const dateStr = row.date || row.Date;
    const shiftRaw = row.shift || row.Shift;

    if (!docName || !dateStr || !shiftRaw) return;
    if (!nameSet.has(docName.toLowerCase())) return;

    // Check if date is a public holiday
    const holidayName = HOLIDAYS[dateStr];
    if (holidayName) {
      // Clean shift (remove standby/extended suffixes for logic matching)
      const cleanShiftRaw = shiftRaw.replace(/\s*\([SX]\)$/i, '').trim();
      const normShift = normalizeShift(cleanShiftRaw);

      if (isWorkingShift(normShift)) {
        credits.push({
          doctorName: docName,
          holidayDate: dateStr,
          holidayName: holidayName,
          workedShift: normShift, // Store normalized shift (e.g. NIGHT instead of ON1)
          originalShift: shiftRaw,
          creditEarned: true
        });
      }
    }
  });

  return credits.sort((a, b) => a.holidayDate.localeCompare(b.holidayDate));
};

/**
 * Step 2: Find all GHKA replacements taken by doctors.
 * @param {Array} masterRoster - The full master roster array
 * @param {Array} names - Array of active doctor names
 * @returns {Array} List of GHKA usages
 */
export const getGhkaUsage = (masterRoster, names) => {
  const usages = [];
  const nameSet = new Set(names.map(n => n.toLowerCase()));

  masterRoster.forEach(row => {
    const docName = row.name || row.Name;
    const dateStr = row.date || row.Date;
    const shiftRaw = row.shift || row.Shift;

    if (!docName || !dateStr || !shiftRaw) return;
    if (!nameSet.has(docName.toLowerCase())) return;

    const s = shiftRaw.toUpperCase().trim();
    if (s === 'GHKA') {
      usages.push({
        doctorName: docName,
        ghkaDate: dateStr
      });
    }
  });

  return usages.sort((a, b) => a.ghkaDate.localeCompare(b.ghkaDate));
};

/**
 * Step 3 & 4: Match earned credits to GHKA usages using chronological FIFO.
 * Prepares the output schema for Phase 5B (manual overrides support).
 * @param {Array} credits - Earned PH credits
 * @param {Array} usages - GHKA usages
 * @returns {Object} { matchedRecords, unmatchedUsages }
 */
export const matchGhkaToCredits = (credits, usages) => {
  // Group by doctor
  const creditsByDoc = {};
  const usagesByDoc = {};

  credits.forEach(c => {
    if (!creditsByDoc[c.doctorName]) creditsByDoc[c.doctorName] = [];
    creditsByDoc[c.doctorName].push({ ...c });
  });

  usages.forEach(u => {
    if (!usagesByDoc[u.doctorName]) usagesByDoc[u.doctorName] = [];
    usagesByDoc[u.doctorName].push({ ...u });
  });

  const matchedRecords = [];
  const unmatchedUsages = [];

  // Perform FIFO matching per doctor
  Object.keys(creditsByDoc).forEach(docName => {
    const docCredits = creditsByDoc[docName];
    const docUsages = usagesByDoc[docName] || [];

    // docCredits and docUsages are already sorted chronologically
    let usageIdx = 0;

    docCredits.forEach(credit => {
      let matchedGhkaDate = null;
      let status = 'PENDING';

      if (usageIdx < docUsages.length) {
        matchedGhkaDate = docUsages[usageIdx].ghkaDate;
        status = 'USED';
        usageIdx++;
      }

      matchedRecords.push({
        doctorName: docName,
        holidayDate: credit.holidayDate,
        holidayName: credit.holidayName,
        workedShift: credit.workedShift,
        matchedGhkaDate: matchedGhkaDate,
        status: status,
        source: 'auto' // Important for Phase 5B
      });
    });

    // Any remaining usages are unmatched (GHKA taken without a corresponding PH credit)
    while (usageIdx < docUsages.length) {
      unmatchedUsages.push({
        doctorName: docName,
        ghkaDate: docUsages[usageIdx].ghkaDate
      });
      usageIdx++;
    }
  });

  return { matchedRecords, unmatchedUsages };
};

/**
 * Step 5: Build doctor summary totals.
 * @param {Array} matchedRecords - Output from matchGhkaToCredits
 * @param {Array} names - Array of active doctor names
 * @returns {Array} Summaries per doctor
 */
export const buildDoctorSummary = (matchedRecords, unmatchedUsages, names) => {
  const summaries = names.map(name => ({
    name,
    phWorked: 0,
    ghkaUsed: 0,
    ghkaUsedWithoutCredit: 0,
    outstanding: 0
  }));

  const sumMap = {};
  summaries.forEach(s => { sumMap[s.name.toLowerCase()] = s; });

  matchedRecords.forEach(record => {
    const s = sumMap[record.doctorName.toLowerCase()];
    if (s) {
      s.phWorked++;
      if (record.status === 'USED') {
        s.ghkaUsed++;
      } else if (record.status === 'PENDING') {
        s.outstanding++;
      }
    }
  });

  unmatchedUsages.forEach(u => {
    const s = sumMap[u.doctorName.toLowerCase()];
    if (s) {
      s.ghkaUsed++;
      s.ghkaUsedWithoutCredit++;
      // Outstanding remains unchanged (it's PH Worked - Valid GHKA Used)
    }
  });

  return summaries.sort((a, b) => b.outstanding - a.outstanding || b.phWorked - a.phWorked || a.name.localeCompare(b.name));
};

/**
 * Step 6: Build warnings.
 * @param {Array} summaries - Output from buildDoctorSummary
 * @returns {Array} Warning objects
 */
export const buildWarnings = (summaries) => {
  const warnings = [];

  summaries.forEach(s => {
    if (s.outstanding > 0) {
      warnings.push({
        doctorName: s.name,
        type: 'OUTSTANDING_GHKA',
        message: `${s.name} has ${s.outstanding} outstanding GHKA replacement(s) to claim.`,
        severity: s.outstanding >= 3 ? 'high' : 'medium',
        count: s.outstanding
      });
    }

    if (s.ghkaUsedWithoutCredit > 0) {
      warnings.push({
        doctorName: s.name,
        type: 'UNMATCHED_GHKA',
        message: `${s.name} has taken ${s.ghkaUsedWithoutCredit} GHKA shift(s) without earning corresponding PH credits.`,
        severity: 'high',
        count: s.ghkaUsedWithoutCredit
      });
    }
  });

  // Sort: High severity first
  return warnings.sort((a, b) => {
    if (a.severity === 'high' && b.severity !== 'high') return -1;
    if (a.severity !== 'high' && b.severity === 'high') return 1;
    return b.count - a.count;
  });
};

/**
 * Step 7: Build tracker matrix for table display.
 * @param {Array} matchedRecords - Output from matchGhkaToCredits
 * @param {Array} names - Array of active doctor names
 * @param {String} activeMonth - YYYY-MM
 * @returns {Array} List of rows (holidays) with column data for each doctor
 */
export const buildTrackerMatrix = (matchedRecords, names, activeMonth) => {
  // Extract all unique holidays worked by anyone in the active month
  // Or actually, just all holidays that occurred in the active month that ANYONE worked.
  const holidaysMap = {}; // Key: YYYY-MM-DD
  
  matchedRecords.forEach(record => {
    if (record.holidayDate.startsWith(activeMonth)) {
      if (!holidaysMap[record.holidayDate]) {
        holidaysMap[record.holidayDate] = {
          date: record.holidayDate,
          name: record.holidayName,
          doctors: {}
        };
      }
      // Assuming a doctor only works one shift per PH date
      holidaysMap[record.holidayDate].doctors[record.doctorName.toLowerCase()] = record;
    }
  });

  const matrixRows = Object.values(holidaysMap).sort((a, b) => a.date.localeCompare(b.date));

  return matrixRows;
};
