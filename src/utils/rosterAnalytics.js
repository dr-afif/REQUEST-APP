import { normalizeForComparison, toIsoDate } from './normalise';
import { mapName } from './adapters';
import { getHolidayName } from './holidays';

// Helper to parse standby status and extended shift status from a shift name string
export const parseShiftValue = (rawVal) => {
  if (!rawVal) return { cleanShift: '', isStandby: false, isExtended: false };
  const rawStr = String(rawVal).trim();
  const upStr = rawStr.toUpperCase();
  const isStandby = upStr.endsWith('(S)') || upStr.endsWith('-S') || upStr.includes('(S)');
  let isExtended = upStr.endsWith('(X)') || upStr.endsWith('-X') || upStr.includes('(X)');
  
  if (!isExtended && upStr.length > 1 && upStr.endsWith('X')) {
    isExtended = true;
  }

  // Remove standby and extended modifiers in a case-insensitive way
  let cleanShift = rawStr
    .replace(/\(s\)/i, '')
    .replace(/-s/i, '')
    .replace(/\(x\)/i, '')
    .replace(/-x/i, '')
    .trim();
    
  if (isExtended && !upStr.endsWith('(X)') && !upStr.endsWith('-X') && upStr.endsWith('X')) {
    cleanShift = cleanShift.slice(0, -1);
  }
  
  return { cleanShift, isStandby, isExtended };
};

export const normalizeShiftType = (shiftType) => {
  const up = String(shiftType || '').trim().toUpperCase();
  if (up === 'ON' || up === 'ON1' || up === 'ON2' || up === 'N' || up === 'NIGHT') {
    return 'NIGHT';
  }
  return up;
};

export const getDaysInMonth = (rosterMonth) => {
  if (!rosterMonth) return [];
  const [year, month] = rosterMonth.split('-').map(Number);
  const date = new Date(year, month - 1, 1);
  const list = [];
  while (date.getMonth() === month - 1) {
    const dayNum = date.getDate();
    const dayName = date.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase();
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
    const isWeekend = dayName === 'SAT' || dayName === 'SUN';
    const holidayName = getHolidayName(dateStr);
    const isHoliday = !!holidayName;
    list.push({ dayNum, dayName, dateStr, isWeekend, isHoliday, holidayName });
    date.setDate(date.getDate() + 1);
  }
  return list;
};

export const getDoctorRosterMap = (masterRoster) => {
  const map = new Map();
  if (!Array.isArray(masterRoster)) return map;
  masterRoster.forEach((row) => {
    const rawDate = row.Date || row.date;
    const dateStr = toIsoDate(rawDate);
    const nameRaw = mapName(row.Name || row.name || '');
    const shiftVal = row.Shift || row.shift;

    if (!dateStr || !nameRaw || !shiftVal) return;
    const nameKey = normalizeForComparison(nameRaw);
    const shiftRaw = String(shiftVal).trim().toUpperCase();

    if (!map.has(nameKey)) {
      map.set(nameKey, new Map());
    }
    map.get(nameKey).set(dateStr, shiftRaw);
  });
  return map;
};

export const getRequestsRosterMap = (requests, rosterMonth) => {
  const map = new Map();
  if (!Array.isArray(requests)) return map;
  
  requests.forEach((r) => {
    if (!r || typeof r !== 'object') return;
    const status = String(r.Status || r.status || '').toLowerCase();
    if (status !== 'active') return;
    
    const appStatus = r.ApprovalStatus || r.approvalStatus || '';
    const rType = r.RequestType || r.requestType || 'Leave';
    const isCustom = String(rType).toLowerCase() === 'admincomment';
    
    if (!isCustom && appStatus !== 'Approved' && appStatus !== 'Pending Admin') return;
    
    const rawDate = r.Date || r.date;
    const dateStr = toIsoDate(rawDate);
    if (!dateStr) return;
    if (!dateStr.startsWith(rosterMonth)) return;
    
    const nameRaw = mapName(r.Name || r.name || '');
    if (!nameRaw) return;
    const nameKey = normalizeForComparison(nameRaw);
    
    if (!map.has(nameKey)) {
      map.set(nameKey, new Map());
    }
    
    const requestedShift = String(r.Request || r.request || '').trim().toUpperCase();
    map.get(nameKey).set(dateStr, {
      shift: requestedShift,
    });
  });
  return map;
};

export const getMemberTallyColumns = (shiftTypes) => {
  const dropdownShifts = shiftTypes && shiftTypes.length > 0
    ? shiftTypes.filter(s => s && s.Name).map(s => String(s.Name).toUpperCase())
    : ['AM', 'PM', 'NIGHT', 'OFF', 'AL', 'MC', 'HKA', 'GHKA', 'COURSE', 'EL'];

  const core = ['AM', 'PM', 'NIGHT'];
  const others = [];
  dropdownShifts.forEach((s) => {
    if (!s) return;
    const norm = normalizeShiftType(s);
    if (!core.includes(norm) && !others.includes(norm)) {
      others.push(norm);
    }
  });
  return { dropdownShifts, dynamicShiftColumns: [...core, ...others] };
};

export const calculateRosterAnalytics = ({
  names = [],
  masterRoster = [],
  requests = [],
  teamMembers = [],
  shiftTypes = [],
  rosterMonth = '',
  includeInactive = false,
}) => {
  const { dynamicShiftColumns } = getMemberTallyColumns(shiftTypes);

  // 1. Build maps
  const doctorRosterMap = getDoctorRosterMap(masterRoster);
  const requestsRosterMap = getRequestsRosterMap(requests, rosterMonth);
  const days = getDaysInMonth(rosterMonth);

  const todayStr = toIsoDate(new Date());
  const currentMonthStr = todayStr.substring(0, 7);
  const isUpcomingMonth = rosterMonth > currentMonthStr;

  // 2. Identify inactive members
  const inactiveNames = new Set(
    teamMembers
      .filter(m => typeof m === 'object' && (m.active === false || m.Active === false))
      .map(m => normalizeForComparison(m.name || m.MemberName || ''))
  );

  // 3. Filter names list
  const filteredNames = names.filter((name) => {
    const nameKey = normalizeForComparison(mapName(name));
    return includeInactive || !inactiveNames.has(nameKey);
  });

  // 4. Initialize doctor list structure
  const doctorList = filteredNames.map((name) => {
    const nameMapped = mapName(name);
    const nameKey = normalizeForComparison(nameMapped);

    const counts = {};
    dynamicShiftColumns.forEach((col) => {
      counts[col] = 0;
    });
    counts.TOTAL_LEAVE = 0;

    return {
      name: nameMapped,
      nameKey,
      counts,
      activeShiftsCount: 0,
      leaveShiftsCount: 0,
      weekendShiftsCount: 0,
      holidayShiftsCount: 0,
      isInactive: inactiveNames.has(nameKey),
    };
  });

  const doctorMap = new Map(doctorList.map((d) => [d.nameKey, d]));

  // 5. Initialize overview counts
  let totalActiveShifts = 0;
  let totalAmShifts = 0;
  let totalPmShifts = 0;
  let totalNightShifts = 0;
  let totalLeaveDays = 0;
  let totalEmptyCells = 0;

  const ACTIVE_SHIFTS = new Set(['AM', 'PM', 'NIGHT', 'PN', 'OH']);

  // 6. Iterate and compute tallies
  days.forEach((day) => {
    filteredNames.forEach((name) => {
      const nameMapped = mapName(name);
      const nameKey = normalizeForComparison(nameMapped);
      const docEntry = doctorMap.get(nameKey);
      if (!docEntry) return;

      let val = doctorRosterMap.get(nameKey)?.get(day.dateStr) || '';
      if (!val && isUpcomingMonth) {
        const reqData = requestsRosterMap.get(nameKey)?.get(day.dateStr);
        if (reqData) {
          val = reqData.shift;
        }
      }

      if (val) {
        const { cleanShift } = parseShiftValue(val);
        const shiftType = normalizeShiftType(cleanShift);

        // Record metrics
        if (ACTIVE_SHIFTS.has(shiftType)) {
          // Increment overview counts
          totalActiveShifts++;
          if (shiftType === 'AM') totalAmShifts++;
          else if (shiftType === 'PM') totalPmShifts++;
          else if (shiftType === 'NIGHT') totalNightShifts++;

          // Increment doctor stats
          docEntry.activeShiftsCount++;
          if (docEntry.counts[shiftType] !== undefined) {
            docEntry.counts[shiftType]++;
          }

          if (day.isWeekend) {
            docEntry.weekendShiftsCount++;
          }
          if (day.isHoliday) {
            docEntry.holidayShiftsCount++;
          }
        } else {
          // Leave shifts
          totalLeaveDays++;
          docEntry.leaveShiftsCount++;
          docEntry.counts.TOTAL_LEAVE++;

          if (docEntry.counts[shiftType] !== undefined) {
            docEntry.counts[shiftType]++;
          }
        }
      } else {
        totalEmptyCells++;
      }
    });
  });

  // Calculate ranks
  const sortedByNights = [...doctorList].sort((a, b) => (b.counts.NIGHT || 0) - (a.counts.NIGHT || 0));
  const mostNights = sortedByNights.slice(0, 5).filter(d => (d.counts.NIGHT || 0) > 0);
  
  const leastNights = [...doctorList]
    .filter(d => !d.isInactive) // Least nights usually only makes sense for active members
    .sort((a, b) => (a.counts.NIGHT || 0) - (b.counts.NIGHT || 0))
    .slice(0, 5);

  const mostActive = [...doctorList].sort((a, b) => b.activeShiftsCount - a.activeShiftsCount).slice(0, 5).filter(d => d.activeShiftsCount > 0);
  const mostLeave = [...doctorList].sort((a, b) => b.counts.TOTAL_LEAVE - a.counts.TOTAL_LEAVE).slice(0, 5).filter(d => d.counts.TOTAL_LEAVE > 0);
  const mostWeekend = [...doctorList].sort((a, b) => b.weekendShiftsCount - a.weekendShiftsCount).slice(0, 5).filter(d => d.weekendShiftsCount > 0);

  return {
    overview: {
      totalMembers: filteredNames.length,
      totalActiveShifts,
      totalAmShifts,
      totalPmShifts,
      totalNightShifts,
      totalLeaveDays,
      totalEmptyCells,
    },
    doctorSummaries: doctorList,
    rankings: {
      mostNights,
      leastNights,
      mostActive,
      mostLeave,
      mostWeekend,
    },
    dynamicShiftColumns,
    daysList: days,
  };
};
