import assert from 'node:assert/strict';
import {
  adaptRequestsResponse,
  normalizeActivities,
  validateLimitGroups,
  validateMasterRoster,
  validateShiftBlocks,
  validateShiftTypes,
} from './adapters.js';

assert.deepEqual(
  adaptRequestsResponse({
    rows: [
      {
        ID: 'r1',
        Name: 'Amy',
        Date: '2026-06-06',
        Day: 'Saturday',
        Request: 'AL',
        Status: 'Active',
        Comment: 'family',
        ApprovalStatus: 'Pending',
        SwapPartner: 'Bob',
        RequestType: 'Swap',
        Timestamp: '2026-05-26T00:00:00Z',
      },
    ],
  }),
  [
    {
      id: 'r1',
      timestamp: '2026-05-26T00:00:00Z',
      name: 'Amy',
      Name: 'Amy',
      date: '2026-06-06',
      Date: '2026-06-06',
      day: 'Saturday',
      Day: 'Saturday',
      request: 'AL',
      Request: 'AL',
      status: 'Active',
      Status: 'Active',
      comment: 'family',
      Comment: 'family',
      ApprovalStatus: 'Pending',
      approvalStatus: 'Pending',
      SwapPartner: 'Bob',
      swapPartner: 'Bob',
      RequestType: 'Swap',
      requestType: 'Swap',
    },
  ]
);

assert.deepEqual(
  adaptRequestsResponse([{ id: 'r2', name: 'Bob', date: '2026-06-07', request: 'AM' }]),
  [
    {
      id: 'r2',
      timestamp: undefined,
      name: 'Bob',
      Name: 'Bob',
      date: '2026-06-07',
      Date: '2026-06-07',
      day: '',
      Day: '',
      request: 'AM',
      Request: 'AM',
      status: '',
      Status: '',
      comment: '',
      Comment: '',
      ApprovalStatus: 'Approved',
      approvalStatus: 'Approved',
      SwapPartner: '',
      swapPartner: '',
      RequestType: 'Leave',
      requestType: 'Leave',
    },
  ]
);

assert.deepEqual(validateMasterRoster([{ Shift: 'AM' }, { name: 'not roster' }, { shift: 'PM' }]), [
  { Shift: 'AM' },
  { shift: 'PM' },
]);

assert.deepEqual(validateShiftBlocks([{ MaxSlots: 1 }, { ShiftType: 'leave' }, { maxSlots: 2 }]), [
  { MaxSlots: 1 },
  { maxSlots: 2 },
]);

assert.deepEqual(validateShiftTypes([{ Name: 'AL' }, { GroupID: 'leave' }, { name: 'AM' }]), [
  { Name: 'AL' },
  { name: 'AM' },
]);

assert.deepEqual(validateLimitGroups([{ GroupName: 'Leaves' }, { DefaultLimit: 3 }, { groupName: 'Duty' }]), [
  { GroupName: 'Leaves' },
  { groupName: 'Duty' },
]);

assert.deepEqual(
  normalizeActivities([
    { ID: 'id' },
    { id: 'a1', customText: 'Bulletin' },
    { Id: 'a2', name: 'Amy', requestType: 'Off-Duty', date: '2026-06-06' },
    { id: 'a3' },
  ]),
  [
    {
      ID: 'a1',
      Timestamp: '',
      CustomText: 'Bulletin',
      Name: '',
      RequestType: '',
      Request: '',
      SwapPartner: '',
      Date: '',
      ApprovalStatus: 'Approved',
      Comment: '',
      Status: 'Active',
    },
    {
      ID: 'a2',
      Timestamp: '',
      CustomText: '',
      Name: 'Amy',
      RequestType: 'Off-Duty',
      Request: '',
      SwapPartner: '',
      Date: '2026-06-06',
      ApprovalStatus: 'Approved',
      Comment: '',
      Status: 'Active',
    },
  ]
);

console.log('adapter helper tests passed');
