import { HOLIDAYS } from './holidays';
import { toIsoDate, normalizeForComparison } from './normalise';
import { mapName } from './adapters';

/**
 * Normalizes roster row data explicitly to ensure date matching works and names are consistent.
 */
export const normalizeRosterEntry = (row) => {
  if (!row) return null;
  
  const rawName = row.name || row.Name || row.MemberName || row.Doctor || row.doctor;
  const rawDate = row.date || row.Date || row.DutyDate || row.RosterDate;
  const shiftRaw = row.shift || row.Shift || row.Request || row.Duty || row.RosterShift;

  if (!rawName || !rawDate || !shiftRaw) return null;

  const doctorName = mapName(rawName);
  const doctorKey = normalizeForComparison(doctorName);
  const dateStr = toIsoDate(rawDate);

  if (!dateStr || !doctorKey) return null;

  return {
    doctorName,
    doctorKey,
    dateStr,
    shiftRaw
  };
};

/**
 * Gets the holiday name, handling both object and array formats of HOLIDAYS.
 */
export const getHolidayNameByDate = (dateStr) => {
  if (!dateStr) return null;
  if (Array.isArray(HOLIDAYS)) {
    const h = HOLIDAYS.find(x => 
      (x.date || x.Date || x.holidayDate) === dateStr
    );
    return h ? (h.name || h.Name || h.holidayName) : null;
  }
  return HOLIDAYS[dateStr] || null;
};

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
  const nameSet = new Set(names.map(n => normalizeForComparison(mapName(n))));

  masterRoster.forEach(row => {
    const entry = normalizeRosterEntry(row);
    if (!entry) return;

    if (!nameSet.has(entry.doctorKey)) return;

    // Check if date is a public holiday
    const holidayName = getHolidayNameByDate(entry.dateStr);
    if (holidayName) {
      const classification = classifyPublicHolidayShift(entry.shiftRaw);

      if (classification.earnsCredit) {
        credits.push({
          doctorName: entry.doctorName,
          doctorKey: entry.doctorKey,
          holidayDate: entry.dateStr,
          holidayName: holidayName,
          workedShift: classification.normalizedShift, // Store normalized shift
          originalShift: entry.shiftRaw,
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
  const nameSet = new Set(names.map(n => normalizeForComparison(mapName(n))));

  masterRoster.forEach(row => {
    const entry = normalizeRosterEntry(row);
    if (!entry) return;

    if (!nameSet.has(entry.doctorKey)) return;

    const s = entry.shiftRaw.toUpperCase().trim();
    if (s === 'GHKA') {
      usages.push({
        doctorName: entry.doctorName,
        doctorKey: entry.doctorKey,
        ghkaDate: entry.dateStr
      });
    }
  });

  return usages.sort((a, b) => a.ghkaDate.localeCompare(b.ghkaDate));
};

/**
 * Generates synthetic credits from opening balances.
 * @param {Object} openingBalances - Object keyed by doctorKey
 * @param {Array} names - Array of active doctor names
 * @returns {Array} List of synthetic opening balance credits
 */
export const buildOpeningBalanceCredits = (openingBalances, names) => {
  const syntheticCredits = [];
  const nameSet = new Set(names.map(n => normalizeForComparison(mapName(n))));

  Object.entries(openingBalances || {}).forEach(([doctorKey, data]) => {
    if (nameSet.has(doctorKey) && data.openingBalance > 0) {
      for (let i = 0; i < data.openingBalance; i++) {
        syntheticCredits.push({
          doctorName: data.doctorName || data.name || doctorKey, // fallback if doctorName missing
          doctorKey: doctorKey,
          holidayDate: null,
          holidayName: "Carry-forward GHKA credit",
          workedShift: "CARRY_FORWARD",
          creditEarned: true,
          source: "opening_balance",
          sequence: i + 1
        });
      }
    }
  });

  return syntheticCredits;
};

/**
 * Step 3 & 4: Match earned credits to GHKA usages using chronological FIFO.
 * Prepares the output schema for Phase 5B (manual overrides support).
 * @param {Array} credits - Earned PH credits
 * @param {Array} usages - GHKA usages
 * @param {Object} openingBalances - Opening balances
 * @param {Array} names - Array of active doctor names
 * @returns {Object} { matchedRecords, unmatchedUsages }
 */
export const matchGhkaToCredits = (credits, usages, openingBalances = {}, names = []) => {
  const syntheticCredits = buildOpeningBalanceCredits(openingBalances, names);

  // Group by doctor
  const creditsByDoc = {};
  const usagesByDoc = {};

  // Prioritize synthetic credits (opening balances) before real credits
  const allCredits = [...syntheticCredits, ...credits];

  allCredits.forEach(c => {
    const key = c.doctorKey || normalizeForComparison(c.doctorName);
    if (!creditsByDoc[key]) creditsByDoc[key] = [];
    creditsByDoc[key].push({ ...c });
  });

  usages.forEach(u => {
    const key = u.doctorKey || normalizeForComparison(u.doctorName);
    if (!usagesByDoc[key]) usagesByDoc[key] = [];
    usagesByDoc[key].push({ ...u });
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
        doctorName: credit.doctorName,
        doctorKey: docName, // this is actually the key we grouped by
        holidayDate: credit.holidayDate,
        holidayName: credit.holidayName,
        workedShift: credit.workedShift,
        matchedGhkaDate: matchedGhkaDate,
        status: status,
        source: credit.source || 'auto' // Important for Phase 5B
      });
    });

    // Any remaining usages are unmatched (GHKA taken without a corresponding PH credit)
    while (usageIdx < docUsages.length) {
      unmatchedUsages.push({
        doctorName: docUsages[usageIdx].doctorName,
        doctorKey: docName,
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
 * @param {Object} openingBalances
 * @returns {Array} Summaries per doctor
 */
export const buildDoctorSummary = (matchedRecords, unmatchedUsages, names, openingBalances = {}) => {
  const summaries = names.map(name => {
    const doctorKey = normalizeForComparison(mapName(name));
    return {
      name,
      doctorKey,
      openingBalance: openingBalances[doctorKey]?.openingBalance || 0,
      phWorked: 0,
      ghkaUsed: 0,
      usedFromOpeningBalance: 0,
      usedFromCurrentYearCredit: 0,
      outstanding: 0,
      excessGhkaUsed: 0
    };
  });

  const sumMap = {};
  summaries.forEach(s => { sumMap[s.doctorKey] = s; });

  matchedRecords.forEach(record => {
    const s = sumMap[record.doctorKey];
    if (s) {
      if (record.source === 'auto') {
        s.phWorked++;
      }
      
      if (record.status === 'USED') {
        s.ghkaUsed++;
        if (record.source === 'opening_balance') {
          s.usedFromOpeningBalance++;
        } else {
          s.usedFromCurrentYearCredit++;
        }
      }
    }
  });

  unmatchedUsages.forEach(u => {
    const s = sumMap[u.doctorKey];
    if (s) {
      s.ghkaUsed++;
    }
  });

  summaries.forEach(s => {
    const totalAvailable = s.openingBalance + s.phWorked;
    s.outstanding = Math.max(0, totalAvailable - s.ghkaUsed);
    s.excessGhkaUsed = Math.max(0, s.ghkaUsed - totalAvailable);
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

    if (s.excessGhkaUsed > 0) {
      warnings.push({
        doctorName: s.name,
        type: 'EXCESS_GHKA',
        message: `${s.name} has taken ${s.excessGhkaUsed} GHKA shift(s) exceeding their available opening and earned credits.`,
        severity: 'high',
        count: s.excessGhkaUsed
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
  const activeKeys = Array.isArray(HOLIDAYS) 
    ? HOLIDAYS.filter(h => {
        const d = h.date || h.Date || h.holidayDate;
        return d && d.startsWith(activeMonth);
      }).map(h => ({ date: h.date || h.Date || h.holidayDate, name: h.name || h.Name || h.holidayName }))
    : Object.keys(HOLIDAYS).filter(d => d.startsWith(activeMonth)).map(d => ({ date: d, name: HOLIDAYS[d] }));

  activeKeys.forEach(({ date, name }) => {
    holidaysMap[date] = {
      date: date,
      name: name,
      doctors: {}
    };
  });

  const nameSet = new Set(names.map(n => normalizeForComparison(mapName(n))));

  // 2. Populate all shifts for these holiday dates from master roster
  masterRoster.forEach(row => {
    const entry = normalizeRosterEntry(row);
    if (!entry) return;

    if (holidaysMap[entry.dateStr] && nameSet.has(entry.doctorKey)) {
      const classification = classifyPublicHolidayShift(entry.shiftRaw);
      holidaysMap[entry.dateStr].doctors[entry.doctorKey] = {
        classification,
        originalShift: entry.shiftRaw,
        matchedRecord: null // To be filled below if earned
      };
    }
  });
  
  // 3. Inject matched records
  matchedRecords.forEach(record => {
    if (record.holidayDate && record.holidayDate.startsWith(activeMonth) && holidaysMap[record.holidayDate]) {
      const docEntry = holidaysMap[record.holidayDate].doctors[record.doctorKey];
      if (docEntry) {
        docEntry.matchedRecord = record;
      }
    }
  });

  const matrixRows = Object.values(holidaysMap).sort((a, b) => a.date.localeCompare(b.date));

  return matrixRows;
};
