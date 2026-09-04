import assert from 'node:assert/strict';
import {
  buildIndividualRosterTracking,
  deriveLeaveEpisodes,
  filterLeaveItemsByPeriod,
  reconcileLeaveEpisodes,
  summarizeLeaveItems,
} from './leaveTracking.js';

const roster = [
  { Name: 'Dr. A', Date: '2026-01-03', Shift: 'AL' },
  { Name: 'Dr. A', Date: '2026-01-04', Shift: 'AL' },
  { Name: 'Dr. A', Date: '2026-01-05', Shift: 'AL' },
  { Name: 'Dr. A', Date: '2026-02-10', Shift: 'MC' },
  { Name: 'Dr. A', Date: '2026-02-12', Shift: 'EL' },
  { Name: 'Dr. A', Date: '2026-02-13', Shift: 'EL' },
  { Name: 'Dr. A', Date: '2026-02-14', Shift: 'AM' },
  { Name: 'Dr. B', Date: '2026-01-03', Shift: 'MC' },
];

const episodes = deriveLeaveEpisodes(roster);
assert.equal(episodes.length, 4);
const annualLeave = episodes.find((episode) => episode.memberName === 'Dr. A' && episode.leaveType === 'AL');
assert.equal(annualLeave.days, 3);
assert.equal(annualLeave.startDate, '2026-01-03');
assert.equal(annualLeave.endDate, '2026-01-05');

const records = [{
  ID: annualLeave.id,
  MemberName: 'Dr. A',
  LeaveType: 'AL',
  StartDate: '2026-01-03',
  EndDate: '2026-01-05',
  Days: 3,
  Status: 'Submitted',
  SubmittedDate: '2026-01-06',
}];
const reconciled = reconcileLeaveEpisodes(episodes, records);
assert.equal(reconciled.find((item) => item.id === annualLeave.id).status, 'Submitted');
assert.equal(summarizeLeaveItems(reconciled).pending, 3);
assert.equal(summarizeLeaveItems(reconciled).submitted, 1);

const january = filterLeaveItemsByPeriod(reconciled, { mode: 'month', value: '2026-01' });
assert.equal(january.length, 2);

const tracking = buildIndividualRosterTracking({ masterRoster: roster, memberName: 'Dr. A', year: '2026' });
assert.equal(tracking.totals.AL, 3);
assert.equal(tracking.totals.MC, 1);
assert.equal(tracking.totals.EL, 2);
assert.equal(tracking.totals.totalLeave, 6);
assert.equal(tracking.months[1].activeShifts, 1);

const withOrphan = reconcileLeaveEpisodes([], records);
assert.equal(withOrphan[0].isRosterMatch, false);

const crossMonth = filterLeaveItemsByPeriod([{
  ...annualLeave,
  startDate: '2026-01-30',
  endDate: '2026-02-02',
  days: 4,
  status: 'Pending',
  isRosterMatch: true,
}], { mode: 'month', value: '2026-02' });
assert.equal(crossMonth.length, 1);
assert.equal(crossMonth[0].daysInPeriod, 2);
assert.equal(summarizeLeaveItems(crossMonth).AL, 2);

console.log('leave tracking helper tests passed');
