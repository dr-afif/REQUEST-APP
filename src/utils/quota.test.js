import assert from 'node:assert/strict';
import {
  buildLimitGroupById,
  buildLimitGroupIdByShiftType,
  buildLimitOverridesByDateAndGroup,
  buildUsageByDateAndGroup,
  buildUserMonthlyUsage,
  getLimitStatusForType,
  getMonthlyRequestCount,
  getMonthlyStatsForUser,
  getMonthlyWeekendRequestCount,
} from './quota.js';

const requests = [
  { id: '1', name: 'Amy', status: 'Active', date: '2026-06-06', request: 'AL' },
  { id: '2', name: 'Amy', status: 'Active', date: '2026-06-07', request: 'AM' },
  { id: '3', name: 'Amy', status: 'Cancelled', date: '2026-06-08', request: 'AL' },
  { id: '4', name: 'Bob', status: 'Active', date: '2026-06-06', request: 'AL' },
  { id: '5', name: 'Amy', status: 'Active', date: '2026-07-04', request: 'AL' },
];

const shiftTypes = [
  { ID: 'st1', Name: 'AL', GroupID: 'leave' },
  { ID: 'st2', Name: 'AM', GroupID: 'duty' },
];

const limitGroups = [
  { ID: 'leave', GroupName: 'Leaves', DefaultLimit: 3 },
  { ID: 'duty', GroupName: 'Duty', DefaultLimit: 2 },
];

const shiftBlocks = [
  { Date: '2026-06-06', ShiftType: 'leave', MaxSlots: 1 },
];

const limitGroupIdByShiftType = buildLimitGroupIdByShiftType(shiftTypes);

assert.equal(
  getMonthlyRequestCount({ requests, targetName: 'Amy', dateString: '2026-06-15' }),
  2
);

assert.equal(
  getMonthlyRequestCount({ requests, targetName: 'Amy', dateString: '2026-06-15', initialRequestId: '1' }),
  1
);

assert.equal(
  getMonthlyWeekendRequestCount({
    requests,
    targetName: 'Amy',
    dateString: '2026-06-15',
    weekendLimitGroupId: 'leave',
    limitGroupIdByShiftType,
  }),
  1
);

assert.deepEqual(buildUsageByDateAndGroup(requests, limitGroupIdByShiftType), {
  '2026-06-06': { leave: 2 },
  '2026-06-07': { duty: 1 },
  '2026-07-04': { leave: 1 },
});

assert.deepEqual(
  getLimitStatusForType({
    type: 'AL',
    date: '2026-06-06',
    limitGroupIdByShiftType,
    limitGroupById: buildLimitGroupById(limitGroups),
    limitOverridesByDateAndGroup: buildLimitOverridesByDateAndGroup(shiftBlocks),
    usageByDateAndGroup: buildUsageByDateAndGroup(requests, limitGroupIdByShiftType),
    initialValues: { id: '1', date: '2026-06-06', request: 'AL' },
  }),
  {
    isLimited: true,
    groupName: 'Leaves',
    limit: 1,
    usage: 1,
    isAtLimit: true,
  }
);

assert.deepEqual(
  buildUserMonthlyUsage({
    requests,
    names: ['Amy', 'Bob'],
    settings: { monthly_request_limit: '10', monthly_weekend_limit: '4', weekend_limit_group_id: 'leave' },
    quotaOverviewMonth: '2026-06',
    shiftTypes,
  }).data,
  {
    Amy: { '2026-06': { count: 2, weekendCount: 1 }, '2026-07': { count: 1, weekendCount: 1 } },
    Bob: { '2026-06': { count: 1, weekendCount: 1 } },
  }
);

assert.deepEqual(
  getMonthlyStatsForUser({
    requests,
    selectedName: 'Amy',
    settings: { monthly_request_limit: '10', monthly_weekend_limit: '4', weekend_limit_group_id: 'leave' },
    shiftTypes,
    limitGroups,
    calendarMonth: new Date(2026, 5, 1),
  }),
  [
    {
      key: '2026-06',
      label: 'June 2026',
      count: 2,
      limit: 10,
      weekendCount: 1,
      weekendLimit: 4,
      weekendLabel: 'Weekend Leaves',
    },
  ]
);

console.log('quota helper tests passed');
