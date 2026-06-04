import { HOLIDAYS } from './holidays';

/**
 * Classifies a shift on a public holiday.
 * @param {String} shift
 * @returns {Object}
 */
export const classifyPublicHolidayShift = (shift) => {
  if (!shift) {
    return {
      normalizedShift: '', category: 'empty', isWorkedPublicHoliday: false, isPublicHolidayOff: false, earnsCredit: false
    };
  }
  
  const cleanShiftRaw = shift.replace(/\s*\([SX]\)$/i, '').trim();
  const s = cleanShiftRaw.toUpperCase();
  let normalizedShift = s;
  
  if (['NIGHT', 'N', 'ON', 'ON1', 'ON2'].includes(s)) {
    normalizedShift = 'NIGHT';
  }

  if (['AM', 'PM', 'NIGHT', 'PN'].includes(normalizedShift)) {
    return {
      normalizedShift, category: 'worked', isWorkedPublicHoliday: true, isPublicHolidayOff: false, earnsCredit: true
    };
  }

  if (s === 'HKA') {
    return {
      normalizedShift, category: 'official_ph_off', isWorkedPublicHoliday: false, isPublicHolidayOff: true, earnsCredit: false
    };
  }

  // AL, MC, EL, OFF, COURSE, etc.
  return {
    normalizedShift, category: 'other_non_working', isWorkedPublicHoliday: false, isPublicHolidayOff: true, earnsCredit: false
  };
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
      const classification = classifyPublicHolidayShift(shiftRaw);

      if (classification.earnsCredit) {
        credits.push({
          doctorName: docName,
          holidayDate: dateStr,
          holidayName: holidayName,
          workedShift: classification.normalizedShift, // Store normalized shift
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
 * @param {Array} masterRoster - The full master roster array to extract HKA and other non-working shifts
 * @returns {Array} List of rows (holidays) with column data for each doctor
 */
export const buildTrackerMatrix = (matchedRecords, names, activeMonth, masterRoster = []) => {
  const holidaysMap = {}; // Key: YYYY-MM-DD
  
  // 1. Initialize all holidays for the active month
  Object.keys(HOLIDAYS).forEach(dateStr => {
    if (dateStr.startsWith(activeMonth)) {
      holidaysMap[dateStr] = {
        date: dateStr,
        name: HOLIDAYS[dateStr],
        doctors: {}
      };
    }
  });

  const nameSet = new Set(names.map(n => n.toLowerCase()));

  // 2. Populate all shifts for these holiday dates from master roster
  masterRoster.forEach(row => {
    const docName = row.name || row.Name;
    const dateStr = row.date || row.Date;
    const shiftRaw = row.shift || row.Shift;

    if (holidaysMap[dateStr] && docName && nameSet.has(docName.toLowerCase())) {
      const classification = classifyPublicHolidayShift(shiftRaw);
      holidaysMap[dateStr].doctors[docName.toLowerCase()] = {
        classification,
        originalShift: shiftRaw,
        matchedRecord: null // To be filled below if earned
      };
    }
  });
  
  // 3. Inject matched records
  matchedRecords.forEach(record => {
    if (record.holidayDate.startsWith(activeMonth) && holidaysMap[record.holidayDate]) {
      const docEntry = holidaysMap[record.holidayDate].doctors[record.doctorName.toLowerCase()];
      if (docEntry) {
        docEntry.matchedRecord = record;
      }
    }
  });

  const matrixRows = Object.values(holidaysMap).sort((a, b) => a.date.localeCompare(b.date));

  return matrixRows;
};
