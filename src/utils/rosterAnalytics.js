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

export const calculateFairnessScores = (memberStats) => {
  if (!Array.isArray(memberStats) || memberStats.length === 0) return [];
  
  const activeMembers = memberStats.filter(m => !m.isInactive);
  const avgDivisor = activeMembers.length || memberStats.length || 1;
  const targetGroup = activeMembers.length > 0 ? activeMembers : memberStats;

  let totalActive = 0;
  let totalNight = 0;
  let totalWeekend = 0;
  let totalHoliday = 0;
  let totalLeave = 0;

  targetGroup.forEach((m) => {
    totalActive += m.activeShiftsCount || 0;
    totalNight += m.counts?.NIGHT || 0;
    totalWeekend += m.weekendShiftsCount || 0;
    totalHoliday += m.holidayShiftsCount || 0;
    totalLeave += m.counts?.TOTAL_LEAVE || 0;
  });

  const avgActive = totalActive / avgDivisor;
  const avgNight = totalNight / avgDivisor;
  const avgWeekend = totalWeekend / avgDivisor;
  const avgHoliday = totalHoliday / avgDivisor;
  const avgLeave = totalLeave / avgDivisor;

  const result = memberStats.map((member) => {
    const active = member.activeShiftsCount || 0;
    const night = member.counts?.NIGHT || 0;
    const weekend = member.weekendShiftsCount || 0;
    const holiday = member.holidayShiftsCount || 0;
    const leave = member.counts?.TOTAL_LEAVE || 0;

    let score = 100;
    score -= Math.abs(night - avgNight) * 6;
    score -= Math.abs(weekend - avgWeekend) * 5;
    score -= Math.abs(holiday - avgHoliday) * 5;
    score -= Math.abs(active - avgActive) * 2;
    score -= Math.abs(leave - avgLeave) * 1;

    score = Math.max(0, Math.min(100, Math.round(score)));

    let status = 'Balanced';
    if (score >= 85) {
      status = 'Balanced';
    } else if (score >= 70) {
      status = 'Watch';
    } else {
      status = 'Imbalanced';
    }

    return {
      ...member,
      activeShifts: active,
      nightShifts: night,
      weekendShifts: weekend,
      publicHolidayShifts: holiday,
      totalLeave: leave,
      fairnessScore: score,
      fairnessStatus: status,
    };
  });

  result.averages = {
    activeShifts: Number(avgActive.toFixed(1)),
    nightShifts: Number(avgNight.toFixed(1)),
    weekendShifts: Number(avgWeekend.toFixed(1)),
    publicHolidayShifts: Number(avgHoliday.toFixed(1)),
    totalLeave: Number(avgLeave.toFixed(1)),
  };

  return result;
};

export const calculateCoverageIssues = (dayStats, thresholds = {}) => {
  if (!Array.isArray(dayStats)) return [];

  const amMin = thresholds.amMin !== undefined ? Number(thresholds.amMin) : 1;
  const pmMin = thresholds.pmMin !== undefined ? Number(thresholds.pmMin) : 1;
  const nightMin = thresholds.nightMin !== undefined ? Number(thresholds.nightMin) : 1;
  const nightMax = thresholds.nightMax !== undefined ? Number(thresholds.nightMax) : 2;
  const totalLeaveMax = thresholds.totalLeaveMax !== undefined ? Number(thresholds.totalLeaveMax) : 4;

  const result = [];

  dayStats.forEach((day) => {
    const issues = [];
    let severity = 'low';

    const amCount = day.amCount || 0;
    if (amCount < amMin) {
      issues.push(`AM below minimum (${amCount}/${amMin})`);
      severity = 'high';
    }

    const pmCount = day.pmCount || 0;
    if (pmCount < pmMin) {
      issues.push(`PM below minimum (${pmCount}/${pmMin})`);
      severity = 'high';
    }

    const nightCount = day.nightCount || 0;
    if (nightCount < nightMin) {
      issues.push(`Night below minimum (${nightCount}/${nightMin})`);
      severity = 'high';
    } else if (nightCount > nightMax) {
      issues.push(`Night above maximum (${nightCount}/${nightMax})`);
      severity = 'high';
    }

    const leaveCount = day.leaveCount || 0;
    if (leaveCount > totalLeaveMax) {
      issues.push(`Leave above maximum (${leaveCount}/${totalLeaveMax})`);
      if (severity !== 'high') {
        severity = 'medium';
      }
    }

    const emptyCount = day.emptyCount || 0;
    if (emptyCount > 0) {
      issues.push(`Empty slots (${emptyCount})`);
      if (severity !== 'high') {
        severity = 'medium';
      }
    }

    if (issues.length > 0) {
      let label = day.dateStr;
      if (day.dateStr) {
        try {
          const d = new Date(day.dateStr);
          if (!isNaN(d.getTime())) {
            const formattedMonth = d.toLocaleDateString('en-US', { month: 'short' });
            const dayOfMonth = d.getDate();
            const dayOfWeek = day.dayName || d.toLocaleDateString('en-US', { weekday: 'short' });
            label = `${formattedMonth} ${dayOfMonth} (${dayOfWeek})`;
          }
        } catch (e) {
          // ignore
        }
      }

      result.push({
        date: day.dateStr,
        label,
        severity,
        issues,
      });
    }
  });

  return result;
};

export const calculateShiftMix = (memberStats, totalCountedDays = 30) => {
  if (!Array.isArray(memberStats) || totalCountedDays <= 0) return [];

  return memberStats.map((member) => {
    const activePct = Math.round(((member.activeShiftsCount || 0) / totalCountedDays) * 100);
    const leavePct = Math.round(((member.counts?.TOTAL_LEAVE || 0) / totalCountedDays) * 100);
    const nightPct = Math.round(((member.counts?.NIGHT || 0) / totalCountedDays) * 100);
    const weekendPct = Math.round(((member.weekendShiftsCount || 0) / totalCountedDays) * 100);

    const perShiftPercentages = {};
    if (member.counts) {
      Object.keys(member.counts).forEach((shiftKey) => {
        perShiftPercentages[shiftKey] = Math.round(((member.counts[shiftKey] || 0) / totalCountedDays) * 100);
      });
    }

    return {
      ...member,
      totalCountedDays,
      activePercentage: activePct,
      leavePercentage: leavePct,
      nightPercentage: nightPct,
      weekendPercentage: weekendPct,
      perShiftPercentages,
    };
  });
};

export const calculateYearToDateStats = (monthlyRosterData, names = [], teamMembers = [], shiftTypes = [], rosterMonth = '') => {
  const activeYear = rosterMonth ? rosterMonth.split('-')[0] : String(new Date().getFullYear());
  
  const defaultEmptyState = {
    totalActiveShifts: 0,
    totalNightShifts: 0,
    totalLeaveDays: 0,
    totalWeekendShifts: 0,
    totalWeekendLeaves: 0,
    perMemberYtdStats: [],
    perMonthTotals: [],
  };

  if (!Array.isArray(monthlyRosterData) || monthlyRosterData.length === 0) {
    return defaultEmptyState;
  }

  const inactiveNames = new Set(
    (teamMembers || [])
      .filter(m => typeof m === 'object' && (m.active === false || m.Active === false))
      .map(m => normalizeForComparison(m.name || m.MemberName || ''))
  );

  const filteredNames = (names || []).filter((name) => {
    const nameKey = normalizeForComparison(mapName(name));
    return !inactiveNames.has(nameKey);
  });

  if (filteredNames.length === 0) {
    const uniqueNames = new Set();
    monthlyRosterData.forEach(row => {
      const name = mapName(row.Name || row.name || '');
      if (name) uniqueNames.add(name);
    });
    filteredNames.push(...Array.from(uniqueNames).filter(name => !inactiveNames.has(normalizeForComparison(name))));
  }

  const months = ['01', '02', '03', '04', '05', '06'];
  const monthNames = {
    '01': 'Jan',
    '02': 'Feb',
    '03': 'Mar',
    '04': 'Apr',
    '05': 'May',
    '06': 'Jun'
  };

  const monthlyStats = {};
  months.forEach(mo => {
    monthlyStats[mo] = {
      monthKey: `${activeYear}-${mo}`,
      monthName: monthNames[mo],
      active: 0,
      night: 0,
      leave: 0,
      weekend: 0,
      weekendLeaves: 0
    };
  });

  const doctorStats = {};
  filteredNames.forEach(name => {
    const key = normalizeForComparison(mapName(name));
    doctorStats[key] = {
      name: mapName(name),
      activeShifts: 0,
      nightShifts: 0,
      weekendShifts: 0,
      publicHolidayShifts: 0,
      leaveDays: 0,
      weekendLeaves: 0,
      shiftTallies: {},
    };
  });

  const ACTIVE_SHIFTS = new Set(['AM', 'PM', 'NIGHT', 'PN', 'OH']);

  const daysByMonth = {};
  months.forEach(mo => {
    const monthKey = `${activeYear}-${mo}`;
    daysByMonth[monthKey] = getDaysInMonth(monthKey);
  });

  const dateMetaMap = new Map();
  Object.keys(daysByMonth).forEach(monthKey => {
    daysByMonth[monthKey].forEach(day => {
      dateMetaMap.set(day.dateStr, day);
    });
  });

  const activeMonthsWithData = new Set();

  monthlyRosterData.forEach(row => {
    const rawDate = row.Date || row.date;
    const dateStr = toIsoDate(rawDate);
    if (!dateStr) return;
    const [yr, mo] = dateStr.split('-');
    if (yr !== activeYear || !months.includes(mo)) return;

    activeMonthsWithData.add(mo);

    const nameRaw = mapName(row.Name || row.name || '');
    const nameKey = normalizeForComparison(nameRaw);
    
    if (!doctorStats[nameKey]) return;

    const shiftVal = row.Shift || row.shift;
    if (!shiftVal) return;

    const { cleanShift } = parseShiftValue(shiftVal);
    const shiftType = normalizeShiftType(cleanShift);

    const dayMeta = dateMetaMap.get(dateStr);
    const isWeekend = dayMeta ? dayMeta.isWeekend : false;
    const isHoliday = dayMeta ? dayMeta.isHoliday : false;

    if (ACTIVE_SHIFTS.has(shiftType)) {
      doctorStats[nameKey].activeShifts++;
      monthlyStats[mo].active++;
      if (shiftType === 'NIGHT') {
        doctorStats[nameKey].nightShifts++;
        monthlyStats[mo].night++;
      }
      if (isWeekend) {
        doctorStats[nameKey].weekendShifts++;
        monthlyStats[mo].weekend++;
      }
      if (isHoliday) {
        doctorStats[nameKey].publicHolidayShifts++;
      }
    } else {
      doctorStats[nameKey].leaveDays++;
      monthlyStats[mo].leave++;
      if (isWeekend) {
        doctorStats[nameKey].weekendLeaves++;
        monthlyStats[mo].weekendLeaves++;
      }
    }

    if (!doctorStats[nameKey].shiftTallies[shiftType]) {
      doctorStats[nameKey].shiftTallies[shiftType] = 0;
    }
    doctorStats[nameKey].shiftTallies[shiftType]++;
  });

  if (activeMonthsWithData.size === 0) {
    return defaultEmptyState;
  }

  let totalActiveShifts = 0;
  let totalNightShifts = 0;
  let totalLeaveDays = 0;
  let totalWeekendShifts = 0;
  let totalWeekendLeaves = 0;

  Object.keys(doctorStats).forEach(key => {
    const d = doctorStats[key];
    totalActiveShifts += d.activeShifts;
    totalNightShifts += d.nightShifts;
    totalLeaveDays += d.leaveDays;
    totalWeekendShifts += d.weekendShifts;
    totalWeekendLeaves += d.weekendLeaves || 0;
  });

  const perMemberYtdStats = Object.values(doctorStats);

  const perMonthTotals = months
    .filter(mo => activeMonthsWithData.has(mo))
    .map(mo => ({
      month: monthNames[mo],
      active: monthlyStats[mo].active,
      night: monthlyStats[mo].night,
      leave: monthlyStats[mo].leave,
      weekend: monthlyStats[mo].weekend,
      weekendLeaves: monthlyStats[mo].weekendLeaves
    }));

  return {
    totalActiveShifts,
    totalNightShifts,
    totalLeaveDays,
    totalWeekendShifts,
    totalWeekendLeaves,
    perMemberYtdStats,
    perMonthTotals
  };
};

export const calculateRosterAnalytics = ({
  names = [],
  masterRoster = [],
  requests = [],
  teamMembers = [],
  shiftTypes = [],
  rosterMonth = '',
  includeInactive = false,
  tallyThresholds = {},
}) => {
  const { dynamicShiftColumns } = getMemberTallyColumns(shiftTypes);

  const doctorRosterMap = getDoctorRosterMap(masterRoster);
  const requestsRosterMap = getRequestsRosterMap(requests, rosterMonth);
  const days = getDaysInMonth(rosterMonth);

  const todayStr = toIsoDate(new Date());
  const currentMonthStr = todayStr.substring(0, 7);
  const isUpcomingMonth = rosterMonth > currentMonthStr;

  const inactiveNames = new Set(
    teamMembers
      .filter(m => typeof m === 'object' && (m.active === false || m.Active === false))
      .map(m => normalizeForComparison(m.name || m.MemberName || ''))
  );

  const filteredNames = names.filter((name) => {
    const nameKey = normalizeForComparison(mapName(name));
    return includeInactive || !inactiveNames.has(nameKey);
  });

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
      weekendLeavesCount: 0,
      isInactive: inactiveNames.has(nameKey),
    };
  });

  const doctorMap = new Map(doctorList.map((d) => [d.nameKey, d]));

  let totalActiveShifts = 0;
  let totalAmShifts = 0;
  let totalPmShifts = 0;
  let totalNightShifts = 0;
  let totalLeaveDays = 0;
  let totalWeekendLeaves = 0;
  let totalEmptyCells = 0;

  const ACTIVE_SHIFTS = new Set(['AM', 'PM', 'NIGHT', 'PN', 'OH']);
  const dayStatsList = [];

  days.forEach((day) => {
    let amCount = 0;
    let pmCount = 0;
    let nightCount = 0;
    let leaveCount = 0;
    let emptyCount = 0;

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

        if (ACTIVE_SHIFTS.has(shiftType)) {
          totalActiveShifts++;
          if (shiftType === 'AM') {
            totalAmShifts++;
            amCount++;
          } else if (shiftType === 'PM') {
            totalPmShifts++;
            pmCount++;
          } else if (shiftType === 'NIGHT') {
            totalNightShifts++;
            nightCount++;
          }

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
          totalLeaveDays++;
          leaveCount++;
          docEntry.leaveShiftsCount++;
          docEntry.counts.TOTAL_LEAVE++;

          if (docEntry.counts[shiftType] !== undefined) {
            docEntry.counts[shiftType]++;
          }

          if (day.isWeekend) {
            docEntry.weekendLeavesCount++;
            totalWeekendLeaves++;
          }
        }
      } else {
        totalEmptyCells++;
        emptyCount++;
      }
    });

    dayStatsList.push({
      dateStr: day.dateStr,
      dayName: day.dayName,
      isWeekend: day.isWeekend,
      isHoliday: day.isHoliday,
      holidayName: day.holidayName,
      amCount,
      pmCount,
      nightCount,
      leaveCount,
      emptyCount,
    });
  });

  const sortedByNights = [...doctorList].sort((a, b) => (b.counts.NIGHT || 0) - (a.counts.NIGHT || 0));
  const mostNights = sortedByNights.slice(0, 5).filter(d => (d.counts.NIGHT || 0) > 0);
  
  const leastNights = [...doctorList]
    .filter(d => !d.isInactive)
    .sort((a, b) => (a.counts.NIGHT || 0) - (b.counts.NIGHT || 0))
    .slice(0, 5);

  const mostActive = [...doctorList].sort((a, b) => b.activeShiftsCount - a.activeShiftsCount).slice(0, 5).filter(d => d.activeShiftsCount > 0);
  const mostLeave = [...doctorList].sort((a, b) => b.counts.TOTAL_LEAVE - a.counts.TOTAL_LEAVE).slice(0, 5).filter(d => d.counts.TOTAL_LEAVE > 0);
  const mostWeekend = [...doctorList].sort((a, b) => b.weekendShiftsCount - a.weekendShiftsCount).slice(0, 5).filter(d => d.weekendShiftsCount > 0);
  const mostWeekendLeaves = [...doctorList].sort((a, b) => (b.weekendLeavesCount || 0) - (a.weekendLeavesCount || 0)).slice(0, 5).filter(d => (d.weekendLeavesCount || 0) > 0);

  const doctorListWithScores = calculateFairnessScores(doctorList);
  const doctorListWithMix = calculateShiftMix(doctorListWithScores, days.length);

  const coverageIssues = calculateCoverageIssues(dayStatsList, tallyThresholds);
  const ytdStats = calculateYearToDateStats(masterRoster, names, teamMembers, shiftTypes, rosterMonth);

  return {
    overview: {
      totalMembers: filteredNames.length,
      totalActiveShifts,
      totalAmShifts,
      totalPmShifts,
      totalNightShifts,
      totalLeaveDays,
      totalWeekendLeaves,
      totalEmptyCells,
    },
    doctorSummaries: doctorListWithMix,
    rankings: {
      mostNights,
      leastNights,
      mostActive,
      mostLeave,
      mostWeekend,
      mostWeekendLeaves,
    },
    dynamicShiftColumns,
    daysList: days,
    dayStatsList,
    coverageIssues,
    ytdStats,
    averages: doctorListWithScores.averages,
  };
};

// ─── Roster Health Intelligence ──────────────────────────────────────────────

/**
 * calculateEquitySignals
 * Analyses how evenly night shifts, weekend duties, public holidays,
 * and active shifts are distributed across all active members.
 */
export const calculateEquitySignals = (memberStats) => {
  const empty = { average: 0, min: 0, max: 0, spread: 0, highest: [], lowest: [], severity: 'low' };
  if (!Array.isArray(memberStats) || memberStats.length === 0) {
    return {
      nightEquity: { ...empty },
      weekendEquity: { ...empty },
      publicHolidayEquity: { ...empty },
      activeShiftEquity: { ...empty },
    };
  }

  const active = memberStats.filter(m => !m.isInactive);
  const pool = active.length > 0 ? active : memberStats;

  const buildSignal = (values, members) => {
    if (values.length === 0) return { ...empty };
    const sum = values.reduce((a, b) => a + b, 0);
    const average = Number((sum / values.length).toFixed(1));
    const min = Math.min(...values);
    const max = Math.max(...values);
    const spread = max - min;

    let severity = 'low';
    if (spread > 3) severity = 'high';
    else if (spread > 1) severity = 'medium';

    const sorted = [...members].sort((a, b) => (b._val || 0) - (a._val || 0));
    const highest = sorted.slice(0, 3).filter(m => (m._val || 0) > 0).map(m => ({ name: m.name, value: m._val }));
    const lowest = [...members].sort((a, b) => (a._val || 0) - (b._val || 0)).slice(0, 3).map(m => ({ name: m.name, value: m._val }));

    return { average, min, max, spread, highest, lowest, severity };
  };

  const nightPool = pool.map(m => ({ ...m, _val: m.counts?.NIGHT || m.nightShifts || 0 }));
  const weekendPool = pool.map(m => ({ ...m, _val: m.weekendShiftsCount || m.weekendShifts || 0 }));
  const holidayPool = pool.map(m => ({ ...m, _val: m.holidayShiftsCount || m.publicHolidayShifts || 0 }));
  const activePool = pool.map(m => ({ ...m, _val: m.activeShiftsCount || m.activeShifts || 0 }));

  return {
    nightEquity: buildSignal(nightPool.map(m => m._val), nightPool),
    weekendEquity: buildSignal(weekendPool.map(m => m._val), weekendPool),
    publicHolidayEquity: buildSignal(holidayPool.map(m => m._val), holidayPool),
    activeShiftEquity: buildSignal(activePool.map(m => m._val), activePool),
  };
};

/**
 * calculateLeaveClustering
 * Flags dates where total leave count meets or exceeds the configured threshold.
 */
export const calculateLeaveClustering = (dayStats, thresholds = {}) => {
  if (!Array.isArray(dayStats)) return [];

  const threshold = thresholds.totalLeaveMax !== undefined ? Number(thresholds.totalLeaveMax) : 4;
  const result = [];

  dayStats.forEach(day => {
    const totalLeave = day.leaveCount || 0;
    if (totalLeave < threshold) return;

    let severity = 'low';
    if (totalLeave >= threshold + 2) severity = 'high';
    else if (totalLeave >= threshold + 1) severity = 'medium';

    let label = day.dateStr || '';
    try {
      const d = new Date(day.dateStr);
      if (!isNaN(d.getTime())) {
        const mo = d.toLocaleDateString('en-US', { month: 'short' });
        label = `${mo} ${d.getDate()} (${day.dayName || d.toLocaleDateString('en-US', { weekday: 'short' })})`;
      }
    } catch (_) { /* ignore */ }

    result.push({
      date: day.dateStr,
      label,
      dayName: day.dayName || '',
      totalLeave,
      threshold,
      severity,
      leaveBreakdown: { total: totalLeave },
      message: `${totalLeave} members on leave (threshold: ${threshold})`,
    });
  });

  return result;
};

/**
 * calculateRosterHealthScore
 * Computes a weighted 0-100 health score from 6 sub-components with deduction explanations.
 */
export const calculateRosterHealthScore = ({
  fairnessScores = [],
  coverageIssues = [],
  memberStats = [],
  dayStats = [],
  thresholds = {},
}) => {
  const safeDefault = {
    score: 100,
    status: 'Excellent',
    severity: 'green',
    components: { fairness: 100, coverage: 100, weekendEquity: 100, publicHolidayEquity: 100, leaveClustering: 100, nightEquity: 100 },
    deductions: [],
  };

  // ── Fairness component (30%) ────────────────────────────────────────────────
  let fairnessScore = 100;
  const deductions = [];

  const activeFairness = Array.isArray(fairnessScores)
    ? fairnessScores.filter(m => !m.isInactive)
    : [];
  if (activeFairness.length > 0) {
    const imbalanced = activeFairness.filter(m => m.fairnessStatus === 'Imbalanced').length;
    const watch = activeFairness.filter(m => m.fairnessStatus === 'Watch').length;
    if (imbalanced > 0) {
      const pts = Math.min(imbalanced * 10, 50);
      fairnessScore -= pts;
      deductions.push({ label: 'Fairness imbalance', points: pts, severity: imbalanced >= 3 ? 'high' : 'medium', reason: `${imbalanced} member(s) have an Imbalanced fairness status` });
    }
    if (watch > 0) {
      const pts = Math.min(watch * 4, 20);
      fairnessScore -= pts;
      deductions.push({ label: 'Members under watch', points: pts, severity: 'low', reason: `${watch} member(s) are in Watch status` });
    }
  }
  fairnessScore = Math.max(0, Math.min(100, fairnessScore));

  // ── Coverage component (25%) ────────────────────────────────────────────────
  let coverageScore = 100;
  const highCoverage = coverageIssues.filter(i => i.severity === 'high').length;
  const medCoverage = coverageIssues.filter(i => i.severity === 'medium').length;
  if (highCoverage > 0) {
    const pts = Math.min(highCoverage * 8, 60);
    coverageScore -= pts;
    deductions.push({ label: 'High severity coverage issues', points: pts, severity: 'high', reason: `${highCoverage} date(s) have critical staffing shortfalls` });
  }
  if (medCoverage > 0) {
    const pts = Math.min(medCoverage * 3, 20);
    coverageScore -= pts;
    deductions.push({ label: 'Medium coverage alerts', points: pts, severity: 'medium', reason: `${medCoverage} date(s) have medium coverage warnings` });
  }
  coverageScore = Math.max(0, Math.min(100, coverageScore));

  // ── Night equity component (15%) ────────────────────────────────────────────
  let nightEquityScore = 100;
  const activePool = Array.isArray(memberStats) ? memberStats.filter(m => !m.isInactive) : [];
  if (activePool.length > 1) {
    const nights = activePool.map(m => m.counts?.NIGHT || m.nightShifts || 0);
    const spread = Math.max(...nights) - Math.min(...nights);
    if (spread > 3) {
      const pts = Math.min(spread * 5, 50);
      nightEquityScore -= pts;
      deductions.push({ label: 'Night shift spread is uneven', points: pts, severity: spread > 5 ? 'high' : 'medium', reason: `Night shift range spans ${spread} (max: ${Math.max(...nights)}, min: ${Math.min(...nights)})` });
    } else if (spread > 1) {
      nightEquityScore -= 10;
      deductions.push({ label: 'Night shift minor imbalance', points: 10, severity: 'low', reason: `Night shift range spans ${spread}` });
    }
  }
  nightEquityScore = Math.max(0, Math.min(100, nightEquityScore));

  // ── Weekend equity component (10%) ──────────────────────────────────────────
  let weekendEquityScore = 100;
  if (activePool.length > 1) {
    const weekends = activePool.map(m => m.weekendShiftsCount || m.weekendShifts || 0);
    const spread = Math.max(...weekends) - Math.min(...weekends);
    if (spread > 3) {
      const pts = Math.min(spread * 4, 40);
      weekendEquityScore -= pts;
      deductions.push({ label: 'Weekend duties clustered among few members', points: pts, severity: spread > 5 ? 'high' : 'medium', reason: `Weekend duty range spans ${spread}` });
    } else if (spread > 1) {
      weekendEquityScore -= 8;
      deductions.push({ label: 'Weekend minor imbalance', points: 8, severity: 'low', reason: `Weekend duty range spans ${spread}` });
    }
  }
  weekendEquityScore = Math.max(0, Math.min(100, weekendEquityScore));

  // ── Public holiday equity component (10%) ───────────────────────────────────
  let phEquityScore = 100;
  if (activePool.length > 1) {
    const holidays = activePool.map(m => m.holidayShiftsCount || m.publicHolidayShifts || 0);
    const spread = Math.max(...holidays) - Math.min(...holidays);
    if (spread > 3) {
      const pts = Math.min(spread * 4, 40);
      phEquityScore -= pts;
      deductions.push({ label: 'Public holiday duties uneven', points: pts, severity: 'medium', reason: `Holiday range spans ${spread}` });
    } else if (spread > 1) {
      phEquityScore -= 6;
      deductions.push({ label: 'Public holiday minor imbalance', points: 6, severity: 'low', reason: `Holiday range spans ${spread}` });
    }
  }
  phEquityScore = Math.max(0, Math.min(100, phEquityScore));

  // ── Leave clustering component (10%) ────────────────────────────────────────
  let leaveClusterScore = 100;
  const leaveClusters = calculateLeaveClustering(dayStats, thresholds);
  const highLeave = leaveClusters.filter(d => d.severity === 'high').length;
  const medLeave = leaveClusters.filter(d => d.severity === 'medium').length;
  const lowLeave = leaveClusters.filter(d => d.severity === 'low').length;
  if (highLeave > 0) {
    const pts = Math.min(highLeave * 8, 40);
    leaveClusterScore -= pts;
    deductions.push({ label: 'High leave concentration detected', points: pts, severity: 'high', reason: `${highLeave} date(s) exceed the leave threshold by 2+` });
  }
  if (medLeave > 0) {
    const pts = Math.min(medLeave * 4, 20);
    leaveClusterScore -= pts;
    deductions.push({ label: 'Multiple high-leave days detected', points: pts, severity: 'medium', reason: `${medLeave} date(s) exceed the leave threshold by 1` });
  }
  if (lowLeave > 0) {
    leaveClusterScore -= Math.min(lowLeave * 2, 10);
  }
  leaveClusterScore = Math.max(0, Math.min(100, leaveClusterScore));

  // ── Weighted overall score ───────────────────────────────────────────────────
  const weighted =
    fairnessScore * 0.30 +
    coverageScore * 0.25 +
    nightEquityScore * 0.15 +
    weekendEquityScore * 0.10 +
    phEquityScore * 0.10 +
    leaveClusterScore * 0.10;

  const score = Math.max(0, Math.min(100, Math.round(weighted)));

  let status = 'Excellent';
  let severity = 'green';
  if (score >= 90) { status = 'Excellent'; severity = 'green'; }
  else if (score >= 80) { status = 'Good'; severity = 'blue'; }
  else if (score >= 65) { status = 'Needs Review'; severity = 'amber'; }
  else { status = 'High Risk'; severity = 'red'; }

  // Sort deductions by points descending
  deductions.sort((a, b) => b.points - a.points);

  return {
    score,
    status,
    severity,
    components: {
      fairness: fairnessScore,
      coverage: coverageScore,
      nightEquity: nightEquityScore,
      weekendEquity: weekendEquityScore,
      publicHolidayEquity: phEquityScore,
      leaveClustering: leaveClusterScore,
    },
    deductions,
  };
};

/**
 * generateHealthInsights
 * Converts health analytics into human-readable, actionable insight cards.
 */
export const generateHealthInsights = ({
  healthScore = null,
  fairnessScores = [],
  coverageIssues = [],
  leaveClusters = [],
  equitySignals = null,
}) => {
  const insights = [];

  // Coverage
  if (coverageIssues.length > 0) {
    const high = coverageIssues.filter(i => i.severity === 'high').length;
    const severity = high >= 3 ? 'high' : high >= 1 ? 'medium' : 'low';
    insights.push({
      type: 'coverage',
      severity,
      title: 'Coverage needs review',
      description: `There are ${coverageIssues.length} date(s) with staffing issues, including ${high} high-severity day(s).`,
      recommendation: high > 0
        ? 'Review high-severity dates before finalising the roster.'
        : 'Check medium-severity dates to ensure adequate coverage.',
    });
  }

  // Night equity
  if (equitySignals?.nightEquity) {
    const ne = equitySignals.nightEquity;
    if (ne.severity !== 'low') {
      insights.push({
        type: 'night',
        severity: ne.severity,
        title: 'Night shift imbalance detected',
        description: `Highest night count is ${ne.max} while lowest is ${ne.min} (spread: ${ne.spread}).`,
        recommendation: 'Consider assigning future night duties to members with a lower count.',
      });
    }
  }

  // Weekend equity
  if (equitySignals?.weekendEquity) {
    const we = equitySignals.weekendEquity;
    if (we.severity !== 'low') {
      insights.push({
        type: 'weekend',
        severity: we.severity,
        title: 'Weekend duty imbalance detected',
        description: `Weekend duty range spans ${we.spread} (max: ${we.max}, min: ${we.min}).`,
        recommendation: 'Redistribute upcoming weekend assignments to members with fewer weekend duties.',
      });
    }
  }

  // Public holiday equity
  if (equitySignals?.publicHolidayEquity) {
    const phe = equitySignals.publicHolidayEquity;
    if (phe.severity !== 'low' && phe.max > 0) {
      insights.push({
        type: 'holiday',
        severity: phe.severity,
        title: 'Public holiday duty imbalance',
        description: `Public holiday spread is ${phe.spread} (max: ${phe.max}, min: ${phe.min}).`,
        recommendation: 'Ensure holiday duties are spread more evenly in future months.',
      });
    }
  }

  // Leave clustering
  if (leaveClusters.length > 0) {
    const high = leaveClusters.filter(d => d.severity === 'high').length;
    insights.push({
      type: 'leave',
      severity: high > 0 ? 'high' : leaveClusters.length > 2 ? 'medium' : 'low',
      title: 'Leave clustering detected',
      description: `${leaveClusters.length} date(s) exceed the configured leave threshold.`,
      recommendation: 'Review whether leave approvals are concentrated on the same days.',
    });
  }

  // Fairness
  if (Array.isArray(fairnessScores)) {
    const imbalanced = fairnessScores.filter(m => !m.isInactive && m.fairnessStatus === 'Imbalanced').length;
    if (imbalanced > 0) {
      insights.push({
        type: 'fairness',
        severity: imbalanced >= 3 ? 'high' : 'medium',
        title: 'Roster fairness imbalance',
        description: `${imbalanced} member(s) have an Imbalanced fairness status.`,
        recommendation: 'Check the Fairness Scoring table to identify which members need rebalancing.',
      });
    }
  }

  // Overall health — positive signal
  if (healthScore && healthScore.score >= 90 && insights.length === 0) {
    insights.push({
      type: 'fairness',
      severity: 'info',
      title: 'Roster is in excellent health',
      description: `Overall health score is ${healthScore.score}/100 with no major issues detected.`,
      recommendation: 'Continue monitoring as the month progresses.',
    });
  }

  return insights;
};
