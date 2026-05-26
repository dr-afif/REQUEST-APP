import { toIsoDate } from './normalise.js';

// Shared by the form, user summary, and admin overview; keep current count semantics stable.
export function buildLimitGroupById(limitGroups = []) {
  return limitGroups.reduce((acc, group) => {
    acc[group.ID] = group;
    return acc;
  }, {});
}

export function buildLimitGroupIdByShiftType(shiftTypes = []) {
  return shiftTypes.reduce((acc, shiftType) => {
    if (shiftType.GroupID) {
      acc[shiftType.Name.toUpperCase()] = shiftType.GroupID;
    }
    return acc;
  }, {});
}

export function buildLimitOverridesByDateAndGroup(shiftBlocks = []) {
  return shiftBlocks.reduce((acc, block) => {
    if (!acc[block.Date]) acc[block.Date] = {};
    acc[block.Date][block.ShiftType] = block.MaxSlots;
    return acc;
  }, {});
}

export function buildUsageByDateAndGroup(requests = [], limitGroupIdByShiftType = {}) {
  return (requests ?? []).reduce((acc, request) => {
    const status = (request?.status ?? '').toLowerCase();
    if (status && status !== 'active') return acc;

    const requestType = (request?.request ?? '').toString().trim().toUpperCase();
    const groupId = limitGroupIdByShiftType[requestType];
    if (!groupId) return acc;

    const dateKey = toIsoDate(request?.date);
    if (!dateKey) return acc;

    if (!acc[dateKey]) acc[dateKey] = {};
    acc[dateKey][groupId] = (acc[dateKey][groupId] ?? 0) + 1;
    return acc;
  }, {});
}

export function getLimitStatusForType({
  type,
  date,
  limitGroupIdByShiftType = {},
  limitGroupById = {},
  limitOverridesByDateAndGroup = {},
  usageByDateAndGroup = {},
  initialValues,
}) {
  const groupId = limitGroupIdByShiftType[(type || '').toUpperCase()];
  if (!groupId) return { isLimited: false };

  const group = limitGroupById[groupId];
  if (!group) return { isLimited: false };

  const override = limitOverridesByDateAndGroup[date]?.[groupId];
  const limit = override !== undefined ? override : group.DefaultLimit;
  const usage = usageByDateAndGroup[date]?.[groupId] ?? 0;

  let effectiveUsage = usage;
  if (initialValues?.id) {
    const editingDateKey = toIsoDate(initialValues?.date);
    const editingType = (initialValues?.request ?? '').toUpperCase();
    const editingGroupId = limitGroupIdByShiftType[editingType];
    if (editingDateKey === date && editingGroupId === groupId) {
      effectiveUsage = Math.max(0, usage - 1);
    }
  }

  return {
    isLimited: true,
    groupName: group.GroupName,
    limit,
    usage: effectiveUsage,
    isAtLimit: effectiveUsage >= limit,
  };
}

export function getMonthlyRequestCount({ requests = [], targetName, dateString, initialRequestId } = {}) {
  if (!targetName || !dateString) return 0;
  const targetDate = new Date(dateString);
  if (isNaN(targetDate.getTime())) return 0;

  const targetYear = targetDate.getFullYear();
  const targetMonth = targetDate.getMonth();
  const normalizedTargetName = targetName.trim().toLowerCase();

  const userActiveRequests = (requests ?? []).filter((request) => {
    const isUser = request.name && request.name.trim().toLowerCase() === normalizedTargetName;
    const isActive = request.status?.toLowerCase() === 'active';
    if (!isUser || !isActive || !request.date) return false;

    const requestDate = new Date(request.date);
    if (isNaN(requestDate.getTime())) return false;

    return requestDate.getFullYear() === targetYear && requestDate.getMonth() === targetMonth;
  });

  let count = userActiveRequests.length;
  if (initialRequestId) {
    const isEditingInSameMonth = userActiveRequests.some((request) => request.id === initialRequestId);
    if (isEditingInSameMonth) {
      count = Math.max(0, count - 1);
    }
  }
  return count;
}

export function getMonthlyWeekendRequestCount({
  requests = [],
  targetName,
  dateString,
  weekendLimitGroupId = 'ALL',
  limitGroupIdByShiftType = {},
  initialRequestId,
} = {}) {
  if (!targetName || !dateString) return 0;
  const targetDate = new Date(dateString);
  if (isNaN(targetDate.getTime())) return 0;

  const targetYear = targetDate.getFullYear();
  const targetMonth = targetDate.getMonth();
  const normalizedTargetName = targetName.trim().toLowerCase();

  const userActiveWeekendRequests = (requests ?? []).filter((request) => {
    const isUser = request.name && request.name.trim().toLowerCase() === normalizedTargetName;
    const isActive = request.status?.toLowerCase() === 'active';
    if (!isUser || !isActive || !request.date) return false;

    const requestDate = new Date(request.date);
    if (isNaN(requestDate.getTime())) return false;
    const day = requestDate.getDay();
    const isWeekend = day === 0 || day === 6;

    if (!isWeekend) return false;

    if (weekendLimitGroupId !== 'ALL') {
      const requestType = (request.request ?? '').toString().trim().toUpperCase();
      const requestGroupId = limitGroupIdByShiftType[requestType];
      if (requestGroupId !== weekendLimitGroupId) return false;
    }

    return requestDate.getFullYear() === targetYear && requestDate.getMonth() === targetMonth;
  });

  let count = userActiveWeekendRequests.length;
  if (initialRequestId) {
    const isEditingInSameMonth = userActiveWeekendRequests.some((request) => request.id === initialRequestId);
    if (isEditingInSameMonth) {
      count = Math.max(0, count - 1);
    }
  }
  return count;
}

export function getMonthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function getMonthLabel(yearMonthKey) {
  if (!yearMonthKey) return '';
  const [year, month] = yearMonthKey.split('-');
  const dateObj = new Date(parseInt(year), parseInt(month) - 1, 1);
  return dateObj.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

export function buildUserMonthlyUsage({
  requests = [],
  names = [],
  settings = {},
  quotaOverviewMonth,
  shiftTypes = [],
} = {}) {
  const usage = {};
  const globalLimit = Number(settings?.monthly_request_limit) || 10;
  const weekendLimit = settings?.monthly_weekend_limit !== undefined
    ? Number(settings.monthly_weekend_limit)
    : 4;
  const weekendLimitGroupId = settings?.weekend_limit_group_id || 'ALL';

  names.forEach((name) => {
    usage[name] = {};
  });

  const limitGroupIdByShiftType = buildLimitGroupIdByShiftType(shiftTypes);
  const activeRequests = requests.filter((request) => request.status?.toLowerCase() === 'active');

  activeRequests.forEach((request) => {
    if (!request.date || !request.name) return;
    if (!names.includes(request.name)) return;

    const requestDate = new Date(request.date);
    if (isNaN(requestDate.getTime())) return;

    const key = getMonthKey(requestDate);
    if (!usage[request.name][key]) {
      usage[request.name][key] = { count: 0, weekendCount: 0 };
    }
    usage[request.name][key].count++;

    const day = requestDate.getDay();
    if (day === 0 || day === 6) {
      let applies = true;
      if (weekendLimitGroupId !== 'ALL') {
        const requestType = (request.request ?? '').toString().trim().toUpperCase();
        if (limitGroupIdByShiftType[requestType] !== weekendLimitGroupId) {
          applies = false;
        }
      }
      if (applies) {
        usage[request.name][key].weekendCount++;
      }
    }
  });

  return {
    limit: globalLimit,
    weekendLimit,
    monthKey: quotaOverviewMonth,
    monthLabel: getMonthLabel(quotaOverviewMonth),
    data: usage,
  };
}

export function getMonthlyStatsForUser({
  requests = [],
  selectedName,
  settings = {},
  shiftTypes = [],
  limitGroups = [],
  calendarMonth,
} = {}) {
  if (!selectedName || selectedName.trim().toLowerCase() === 'admin' || selectedName.trim().toLowerCase() === 'guest' || !requests?.length) return [];

  const targetName = selectedName.trim().toLowerCase();
  const userActiveRequests = requests.filter((request) => {
    const isUser = request.name && request.name.trim().toLowerCase() === targetName;
    const isActive = request.status?.toLowerCase() === 'active';
    return isUser && isActive;
  });

  const limitGroupIdByShiftType = buildLimitGroupIdByShiftType(shiftTypes || []);
  const counts = {};
  const weekendCounts = {};
  const weekendLimitGroupId = settings?.weekend_limit_group_id || 'ALL';

  userActiveRequests.forEach((request) => {
    if (!request.date) return;
    const requestDate = new Date(request.date);
    if (isNaN(requestDate.getTime())) return;

    const key = getMonthKey(requestDate);
    counts[key] = (counts[key] || 0) + 1;

    const day = requestDate.getDay();
    if (day === 0 || day === 6) {
      let applies = true;
      if (weekendLimitGroupId !== 'ALL') {
        const requestType = (request.request ?? '').toString().trim().toUpperCase();
        if (limitGroupIdByShiftType[requestType] !== weekendLimitGroupId) {
          applies = false;
        }
      }
      if (applies) {
        weekendCounts[key] = (weekendCounts[key] || 0) + 1;
      }
    }
  });

  const targetMonth = calendarMonth || new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1);
  const targetKey = getMonthKey(targetMonth);
  const limit = Number(settings?.monthly_request_limit) || 10;
  const weekendLimit = settings?.monthly_weekend_limit !== undefined
    ? Number(settings.monthly_weekend_limit)
    : 4;
  const weekendTargetName = weekendLimitGroupId === 'ALL'
    ? 'Weekend'
    : `Weekend ${(limitGroups || []).find((group) => group.ID === weekendLimitGroupId)?.GroupName || ''}`.trim();

  return [
    {
      key: targetKey,
      label: getMonthLabel(targetKey),
      count: counts[targetKey] || 0,
      limit,
      weekendCount: weekendCounts[targetKey] || 0,
      weekendLimit,
      weekendLabel: weekendTargetName,
    },
  ];
}
