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
      weekend: 0
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
      leaveDays: 0
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
    }
  });

  if (activeMonthsWithData.size === 0) {
    return defaultEmptyState;
  }

  let totalActiveShifts = 0;
  let totalNightShifts = 0;
  let totalLeaveDays = 0;
  let totalWeekendShifts = 0;

  Object.keys(doctorStats).forEach(key => {
    const d = doctorStats[key];
    totalActiveShifts += d.activeShifts;
    totalNightShifts += d.nightShifts;
    totalLeaveDays += d.leaveDays;
    totalWeekendShifts += d.weekendShifts;
  });

  const perMemberYtdStats = Object.values(doctorStats);

  const perMonthTotals = months
    .filter(mo => activeMonthsWithData.has(mo))
    .map(mo => ({
      month: monthNames[mo],
      active: monthlyStats[mo].active,
      night: monthlyStats[mo].night,
      leave: monthlyStats[mo].leave,
      weekend: monthlyStats[mo].weekend
    }));

  return {
    totalActiveShifts,
    totalNightShifts,
    totalLeaveDays,
    totalWeekendShifts,
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
      isInactive: inactiveNames.has(nameKey),
    };
  });

  const doctorMap = new Map(doctorList.map((d) => [d.nameKey, d]));

  let totalActiveShifts = 0;
  let totalAmShifts = 0;
  let totalPmShifts = 0;
  let totalNightShifts = 0;
  let totalLeaveDays = 0;
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
      totalEmptyCells,
    },
    doctorSummaries: doctorListWithMix,
    rankings: {
      mostNights,
      leastNights,
      mostActive,
      mostLeave,
      mostWeekend,
    },
    dynamicShiftColumns,
    daysList: days,
    coverageIssues,
    ytdStats,
    averages: doctorListWithScores.averages,
  };
};
