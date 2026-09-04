import { mapName } from './adapters.js';
import { getHolidayName } from './holidays.js';
import { normalizeForComparison, toIsoDate } from './normalise.js';

export const TRACKED_LEAVE_TYPES = ['MC', 'EL', 'AL'];
export const LEAVE_APPLICATION_STATUSES = ['Pending', 'Submitted'];

const ACTIVE_SHIFT_TYPES = new Set(['AM', 'PM', 'NIGHT', 'PN', 'OH']);

const normalizeRosterShift = (value) => {
  let shift = String(value || '').trim().toUpperCase();
  shift = shift
    .replace(/\(S\)/g, '')
    .replace(/-S/g, '')
    .replace(/\(X\)/g, '')
    .replace(/-X/g, '')
    .trim();
  if (shift.length > 1 && shift.endsWith('X') && !['MC', 'EL'].includes(shift)) {
    shift = shift.slice(0, -1);
  }
  if (['ON', 'ON1', 'ON2', 'N'].includes(shift)) return 'NIGHT';
  return shift;
};

const hashString = (value) => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
};

const toUtcDayNumber = (dateString) => Math.floor(
  Date.parse(`${dateString}T00:00:00Z`) / 86400000
);

const rangesOverlap = (aStart, aEnd, bStart, bEnd) => (
  aStart <= bEnd && bStart <= aEnd
);

export const buildLeaveEpisodeId = ({ memberName, leaveType, startDate }) => {
  const identity = `${normalizeForComparison(mapName(memberName))}|${leaveType}|${startDate}`;
  return `leave_${hashString(identity)}`;
};

export const deriveLeaveEpisodes = (masterRoster = []) => {
  const uniqueEntries = new Map();

  (Array.isArray(masterRoster) ? masterRoster : []).forEach((row) => {
    const memberName = mapName(row?.Name || row?.name || '');
    const memberKey = normalizeForComparison(memberName);
    const date = toIsoDate(row?.Date || row?.date);
    const leaveType = normalizeRosterShift(row?.Shift || row?.shift);
    if (!memberKey || !date || !TRACKED_LEAVE_TYPES.includes(leaveType)) return;

    uniqueEntries.set(`${memberKey}|${leaveType}|${date}`, {
      memberName,
      memberKey,
      leaveType,
      date,
    });
  });

  const grouped = new Map();
  Array.from(uniqueEntries.values()).forEach((entry) => {
    const key = `${entry.memberKey}|${entry.leaveType}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(entry);
  });

  const episodes = [];
  grouped.forEach((entries) => {
    entries.sort((a, b) => a.date.localeCompare(b.date));
    let current = null;

    entries.forEach((entry) => {
      const isConsecutive = current
        && toUtcDayNumber(entry.date) === toUtcDayNumber(current.endDate) + 1;

      if (!current || !isConsecutive) {
        if (current) episodes.push(current);
        current = {
          id: buildLeaveEpisodeId({
            memberName: entry.memberName,
            leaveType: entry.leaveType,
            startDate: entry.date,
          }),
          memberName: entry.memberName,
          memberKey: entry.memberKey,
          leaveType: entry.leaveType,
          startDate: entry.date,
          endDate: entry.date,
          dates: [entry.date],
          days: 1,
        };
      } else {
        current.endDate = entry.date;
        current.dates.push(entry.date);
        current.days = current.dates.length;
      }
    });

    if (current) episodes.push(current);
  });

  return episodes.sort((a, b) => (
    b.startDate.localeCompare(a.startDate)
    || a.memberName.localeCompare(b.memberName)
    || a.leaveType.localeCompare(b.leaveType)
  ));
};

const normalizeStatus = (value) => (
  String(value || '').trim().toLowerCase() === 'submitted' ? 'Submitted' : 'Pending'
);

export const normalizeLeaveApplications = (records = []) => (
  (Array.isArray(records) ? records : [])
    .map((record) => {
      const memberName = mapName(record?.MemberName || record?.memberName || '');
      const leaveType = normalizeRosterShift(record?.LeaveType || record?.leaveType);
      const startDate = toIsoDate(record?.StartDate || record?.startDate);
      const endDate = toIsoDate(record?.EndDate || record?.endDate) || startDate;
      if (!memberName || !TRACKED_LEAVE_TYPES.includes(leaveType) || !startDate || !endDate) return null;

      return {
        ID: String(record?.ID || record?.id || buildLeaveEpisodeId({ memberName, leaveType, startDate })),
        MemberName: memberName,
        MemberKey: normalizeForComparison(memberName),
        LeaveType: leaveType,
        StartDate: startDate,
        EndDate: endDate,
        Days: Math.max(1, Number(record?.Days || record?.days) || 1),
        Status: normalizeStatus(record?.Status || record?.status),
        SubmittedDate: toIsoDate(record?.SubmittedDate || record?.submittedDate) || '',
        ReferenceNo: String(record?.ReferenceNo || record?.referenceNo || '').trim(),
        Notes: String(record?.Notes || record?.notes || '').trim(),
        UpdatedAt: record?.UpdatedAt || record?.updatedAt || '',
      };
    })
    .filter(Boolean)
);

export const reconcileLeaveEpisodes = (episodes = [], applicationRecords = []) => {
  const records = normalizeLeaveApplications(applicationRecords);
  const usedRecordIds = new Set();

  const matched = episodes.map((episode) => {
    let record = records.find((candidate) => candidate.ID === episode.id);
    if (!record) {
      record = records.find((candidate) => (
        !usedRecordIds.has(candidate.ID)
        && candidate.MemberKey === episode.memberKey
        && candidate.LeaveType === episode.leaveType
        && rangesOverlap(candidate.StartDate, candidate.EndDate, episode.startDate, episode.endDate)
      ));
    }
    if (record) usedRecordIds.add(record.ID);

    return {
      ...episode,
      recordId: record?.ID || episode.id,
      status: record?.Status || 'Pending',
      submittedDate: record?.SubmittedDate || '',
      referenceNo: record?.ReferenceNo || '',
      notes: record?.Notes || '',
      updatedAt: record?.UpdatedAt || '',
      hasTrackingRecord: Boolean(record),
      isRosterMatch: true,
    };
  });

  const orphaned = records
    .filter((record) => !usedRecordIds.has(record.ID))
    .map((record) => ({
      id: record.ID,
      recordId: record.ID,
      memberName: record.MemberName,
      memberKey: record.MemberKey,
      leaveType: record.LeaveType,
      startDate: record.StartDate,
      endDate: record.EndDate,
      dates: [],
      days: record.Days,
      status: record.Status,
      submittedDate: record.SubmittedDate,
      referenceNo: record.ReferenceNo,
      notes: record.Notes,
      updatedAt: record.UpdatedAt,
      hasTrackingRecord: true,
      isRosterMatch: false,
    }));

  return [...matched, ...orphaned].sort((a, b) => b.startDate.localeCompare(a.startDate));
};

export const filterLeaveItemsByPeriod = (items = [], { mode = 'month', value = '' } = {}) => {
  if (!value) return items;
  const selectedYear = value.slice(0, 4);
  const periodStart = mode === 'year' ? `${selectedYear}-01-01` : `${value.slice(0, 7)}-01`;
  let periodEnd;
  if (mode === 'year') {
    periodEnd = `${selectedYear}-12-31`;
  } else {
    const [year, month] = value.slice(0, 7).split('-').map(Number);
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    periodEnd = `${value.slice(0, 7)}-${String(lastDay).padStart(2, '0')}`;
  }

  return items
    .filter((item) => rangesOverlap(item.startDate, item.endDate, periodStart, periodEnd))
    .map((item) => {
      const clippedStart = item.startDate > periodStart ? item.startDate : periodStart;
      const clippedEnd = item.endDate < periodEnd ? item.endDate : periodEnd;
      return {
        ...item,
        daysInPeriod: toUtcDayNumber(clippedEnd) - toUtcDayNumber(clippedStart) + 1,
      };
    });
};

export const summarizeLeaveItems = (items = []) => {
  const matched = items.filter((item) => item.isRosterMatch !== false);
  return matched.reduce((summary, item) => {
    const countedDays = item.daysInPeriod ?? item.days ?? 0;
    summary.episodes += 1;
    summary.days += countedDays;
    summary[item.leaveType] += countedDays;
    if (item.status === 'Submitted') summary.submitted += 1;
    else summary.pending += 1;
    return summary;
  }, { episodes: 0, days: 0, MC: 0, EL: 0, AL: 0, pending: 0, submitted: 0 });
};

const createMonthStats = (year, month) => ({
  monthKey: `${year}-${month}`,
  monthLabel: new Date(Number(year), Number(month) - 1, 1).toLocaleDateString('en-MY', { month: 'short' }),
  AM: 0,
  PM: 0,
  NIGHT: 0,
  activeShifts: 0,
  weekendShifts: 0,
  publicHolidayShifts: 0,
  MC: 0,
  EL: 0,
  AL: 0,
  totalLeave: 0,
});

export const buildIndividualRosterTracking = ({ masterRoster = [], memberName = '', year } = {}) => {
  const memberKey = normalizeForComparison(mapName(memberName));
  const selectedYear = String(year || new Date().getFullYear());
  const months = Array.from({ length: 12 }, (_, index) => (
    createMonthStats(selectedYear, String(index + 1).padStart(2, '0'))
  ));
  const monthMap = new Map(months.map((month) => [month.monthKey, month]));

  (Array.isArray(masterRoster) ? masterRoster : []).forEach((row) => {
    const rowMemberKey = normalizeForComparison(mapName(row?.Name || row?.name || ''));
    const date = toIsoDate(row?.Date || row?.date);
    if (!memberKey || rowMemberKey !== memberKey || !date?.startsWith(selectedYear)) return;

    const monthStats = monthMap.get(date.slice(0, 7));
    if (!monthStats) return;
    const shiftType = normalizeRosterShift(row?.Shift || row?.shift);

    if (ACTIVE_SHIFT_TYPES.has(shiftType)) {
      monthStats.activeShifts += 1;
      if (['AM', 'PM', 'NIGHT'].includes(shiftType)) monthStats[shiftType] += 1;
      const day = new Date(`${date}T00:00:00Z`).getUTCDay();
      if (day === 0 || day === 6) monthStats.weekendShifts += 1;
      if (getHolidayName(date)) monthStats.publicHolidayShifts += 1;
    }

    if (TRACKED_LEAVE_TYPES.includes(shiftType)) {
      monthStats[shiftType] += 1;
      monthStats.totalLeave += 1;
    }
  });

  const totals = months.reduce((summary, month) => {
    Object.keys(summary).forEach((key) => { summary[key] += month[key]; });
    return summary;
  }, {
    AM: 0,
    PM: 0,
    NIGHT: 0,
    activeShifts: 0,
    weekendShifts: 0,
    publicHolidayShifts: 0,
    MC: 0,
    EL: 0,
    AL: 0,
    totalLeave: 0,
  });

  return { memberName: mapName(memberName), memberKey, year: selectedYear, months, totals };
};
