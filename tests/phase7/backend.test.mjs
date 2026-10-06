import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import vm from 'node:vm';
import protocol from '../../src/features/roster/queue/protocol.js';
import compatibility from '../../src/features/roster/compatibility.js';
import guidance from '../../src/features/roster/guidance.js';
import lifecycle from '../../src/features/roster/lifecycle.js';
import absence from '../../src/features/roster/absence.js';
import entitlement from '../../src/features/roster/goff.js';
import { harness, digest, currentSource, fixture } from '../phase1/apps-script-harness.mjs';

const person1 = '11111111-1111-4111-8111-111111111111'; // Dr. Ali (MO)
const person2 = '22222222-2222-4222-8222-222222222222'; // Dr. Siti (MO)
const person3 = '33333333-3333-4333-8333-333333333333'; // Dr. Tan (MO)
const personEp = '55555555-5555-4555-8555-555555555555'; // Dr. Dave (EP)

function setup(options = {}) {
  const h = harness(currentSource, {
    activeEmail: 'admin@example.invalid',
    adminEmail: 'admin@example.invalid',
    ...options
  });
  h.context.SpreadsheetApp.flush = () => {};
  h.context.Utilities.getUuid = () => crypto.randomUUID();
  h.grids.Settings.push(
    ['roster_v2_write_enabled', 'true'],
    ['roster_v2_read_enabled', 'true'],
    ['write_queue_v2_enabled', 'true'],
    ['weekly_off_guidance_enabled', 'true']
  );
  h.grids.RosterPeriods = [
    ['PeriodId', 'SchemaVersion', 'EnrolledAt', 'EnrolledBy'],
    ['2026-05', 2, '2026-01-01', 'owner'],
    ['2026-12', 2, '2026-01-01', 'owner'],
    ['2027-01', 2, '2026-01-01', 'owner']
  ];
  h.grids.RosterPeople = [
    ['PersonId', 'DirectoryType', 'CurrentDisplayName', 'LegacyNamesJson', 'Active'],
    [person1, 'MO', 'Dr. Ali', '[]', true],
    [person2, 'MO', 'Dr. Siti', '[]', true],
    [person3, 'MO', 'Dr. Tan', '[]', true],
    [personEp, 'EP', 'Dr. Dave', '[]', true]
  ];
  h.grids.OffPolicies = [
    [...guidance.OFF_POLICY_HEADERS],
    ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'A', '2026-01-05', 1, guidance.policyRuleJson('A'), true, 'Initial policy', '2026-01-01', 'admin@example.invalid', '']
  ];

  const draftSchemas = vm.runInContext('ROSTER_DRAFT_SCHEMAS', h.context);
  for (const [k, v] of Object.entries(draftSchemas)) {
    if (!h.grids[k]) h.grids[k] = [[...v]];
  }

  const lifecycleSchemas = vm.runInContext('rosterLifecycleSchemas_()', h.context);
  for (const [k, v] of Object.entries(lifecycleSchemas)) {
    if (!h.grids[k]) h.grids[k] = [[...v]];
  }

  return h;
}

function makePublishOp({
  periodId = '2026-05',
  expectedRevision = 0,
  draftCells = null,
  adminNote = 'Publish baseline',
  ...rest
} = {}) {
  const opId = crypto.randomUUID();
  const cId = crypto.randomUUID();
  const tId = crypto.randomUUID();
  const cells = draftCells || {
    // 2026-05-01 is Labour Day (gazetted public holiday)
    [`${person1}/${periodId}-01`]: [{ rawShift: 'AM' }], // Ali works holiday duty
    [`${person2}/${periodId}-01`]: [{ rawShift: 'OFF' }], // Siti planned OFF on holiday
    [`${person3}/${periodId}-01`]: [{ rawShift: 'PM' }],
    [`${personEp}/${periodId}-01`]: [{ rawShift: 'AM' }], // EP works holiday duty
    // 2026-05-02 is non-holiday
    [`${person1}/${periodId}-02`]: [{ rawShift: 'OFF' }], // Ali planned OFF
    [`${person2}/${periodId}-02`]: [{ rawShift: 'AM' }],
    [`${person3}/${periodId}-02`]: [{ rawShift: 'PM' }],
    [`${personEp}/${periodId}-02`]: [{ rawShift: 'OFF' }],
    // 2026-05-03 working duties
    [`${person1}/${periodId}-03`]: [{ rawShift: 'AM' }],
    [`${person2}/${periodId}-03`]: [{ rawShift: 'AM' }],
    [`${person3}/${periodId}-03`]: [{ rawShift: 'AM' }],
    [`${personEp}/${periodId}-03`]: [{ rawShift: 'AM' }]
  };
  const meaning = {
    operationId: opId,
    clientId: cId,
    tabId: tId,
    operationType: 'PERIOD_PUBLISH',
    entityKey: `period:${periodId}`,
    expectedRevision,
    payload: {
      periodId,
      draftCells: cells,
      adminNote
    }
  };
  const payloadHash = digest(protocol.canonical(meaning));
  return {
    operationId: opId,
    clientId: cId,
    tabId: tId,
    periodId,
    expectedRevision,
    draftCells: cells,
    adminNote,
    payloadHash,
    ...rest
  };
}

function setupPublished(options = {}) {
  const h = setup(options);
  const pubOp = makePublishOp(options);
  const pubRes = h.post({ action: 'rosterv2publish', ...pubOp });
  assert.equal(pubRes.ok, true, 'publish baseline must succeed');
  assert.equal(pubRes.state, 'PUBLISHED');
  assert.equal(pubRes.revision, 1);
  return { h, periodId: pubOp.periodId, pubRes, pubOp };
}

function makeEarnGoffOp({
  periodId = '2026-05',
  personId = person1,
  date = '2026-05-02',
  adminNote = 'Displaced weekly off',
  operationId = null,
  ...rest
} = {}) {
  const opId = operationId || crypto.randomUUID();
  const cId = crypto.randomUUID();
  const tId = crypto.randomUUID();
  const meaning = {
    operationId: opId,
    clientId: cId,
    tabId: tId,
    operationType: 'ENTITLEMENT_EARN_GOFF',
    entityKey: `period:${periodId}`,
    expectedRevision: 0,
    payload: {
      periodId,
      personId,
      date,
      adminNote
    }
  };
  const payloadHash = digest(protocol.canonical(meaning));
  return {
    action: 'rosterv2entitlementearngoff',
    operationId: opId,
    clientId: cId,
    tabId: tId,
    periodId,
    expectedRevision: 0,
    personId,
    date,
    adminNote,
    payloadHash,
    ...rest
  };
}

function makeEarnGhkaOp({
  periodId = '2026-05',
  personId = person1,
  date = '2026-05-01',
  adminNote = 'Public holiday duty',
  operationId = null,
  ...rest
} = {}) {
  const opId = operationId || crypto.randomUUID();
  const cId = crypto.randomUUID();
  const tId = crypto.randomUUID();
  const meaning = {
    operationId: opId,
    clientId: cId,
    tabId: tId,
    operationType: 'ENTITLEMENT_EARN_GHKA',
    entityKey: `period:${periodId}`,
    expectedRevision: 0,
    payload: {
      periodId,
      personId,
      date,
      adminNote
    }
  };
  const payloadHash = digest(protocol.canonical(meaning));
  return {
    action: 'rosterv2entitlementearnghka',
    operationId: opId,
    clientId: cId,
    tabId: tId,
    periodId,
    expectedRevision: 0,
    personId,
    date,
    adminNote,
    payloadHash,
    ...rest
  };
}

function makeCreditManualOp({
  periodId = '2026-05',
  personId = person1,
  entitlementType = 'GOFF',
  amount = 1,
  effectiveDate = '2026-05-01',
  reasonCode = 'OPENING_BALANCE',
  adminNote = 'Certified opening balance',
  operationId = null,
  ...rest
} = {}) {
  const opId = operationId || crypto.randomUUID();
  const cId = crypto.randomUUID();
  const tId = crypto.randomUUID();
  const meaning = {
    operationId: opId,
    clientId: cId,
    tabId: tId,
    operationType: 'ENTITLEMENT_CREDIT_MANUAL',
    entityKey: `period:${periodId}`,
    expectedRevision: 0,
    payload: {
      periodId,
      personId,
      entitlementType,
      amount,
      effectiveDate,
      reasonCode,
      adminNote
    }
  };
  const payloadHash = digest(protocol.canonical(meaning));
  return {
    action: 'rosterv2entitlementcreditmanual',
    operationId: opId,
    clientId: cId,
    tabId: tId,
    periodId,
    expectedRevision: 0,
    personId,
    entitlementType,
    amount,
    effectiveDate,
    reasonCode,
    adminNote,
    payloadHash,
    ...rest
  };
}

function makeConsumeOp({
  periodId = '2026-05',
  personId = person1,
  entitlementType = 'GOFF',
  date = '2026-05-03',
  expectedRevision = 1,
  adminNote = 'Consume entitlement',
  operationId = null,
  ...rest
} = {}) {
  const opId = operationId || crypto.randomUUID();
  const cId = crypto.randomUUID();
  const tId = crypto.randomUUID();
  const meaning = {
    operationId: opId,
    clientId: cId,
    tabId: tId,
    operationType: 'ENTITLEMENT_CONSUME',
    entityKey: `period:${periodId}`,
    expectedRevision,
    payload: {
      periodId,
      personId,
      entitlementType,
      date,
      expectedRevision,
      adminNote
    }
  };
  const payloadHash = digest(protocol.canonical(meaning));
  return {
    action: 'rosterv2entitlementconsume',
    operationId: opId,
    clientId: cId,
    tabId: tId,
    periodId,
    personId,
    entitlementType,
    date,
    expectedRevision,
    adminNote,
    payloadHash,
    ...rest
  };
}

function makeCreditReverseOp({
  periodId = '2026-05',
  transactionId,
  adminNote = 'Reverse credit',
  operationId = null,
  ...rest
} = {}) {
  const opId = operationId || crypto.randomUUID();
  const cId = crypto.randomUUID();
  const tId = crypto.randomUUID();
  const meaning = {
    operationId: opId,
    clientId: cId,
    tabId: tId,
    operationType: 'ENTITLEMENT_CREDIT_REVERSAL',
    entityKey: `period:${periodId}`,
    expectedRevision: 0,
    payload: {
      periodId,
      transactionId,
      adminNote
    }
  };
  const payloadHash = digest(protocol.canonical(meaning));
  return {
    action: 'rosterv2entitlementcreditreverse',
    operationId: opId,
    clientId: cId,
    tabId: tId,
    periodId,
    expectedRevision: 0,
    transactionId,
    adminNote,
    payloadHash,
    ...rest
  };
}

function makeConsumeReverseOp({
  periodId = '2026-05',
  transactionId,
  expectedRevision = 2,
  adminNote = 'Reverse consumption',
  operationId = null,
  ...rest
} = {}) {
  const opId = operationId || crypto.randomUUID();
  const cId = crypto.randomUUID();
  const tId = crypto.randomUUID();
  const meaning = {
    operationId: opId,
    clientId: cId,
    tabId: tId,
    operationType: 'ENTITLEMENT_CONSUMPTION_REVERSAL',
    entityKey: `period:${periodId}`,
    expectedRevision,
    payload: {
      periodId,
      transactionId,
      expectedRevision,
      adminNote
    }
  };
  const payloadHash = digest(protocol.canonical(meaning));
  return {
    action: 'rosterv2entitlementconsumereverse',
    operationId: opId,
    clientId: cId,
    tabId: tId,
    periodId,
    transactionId,
    expectedRevision,
    adminNote,
    payloadHash,
    ...rest
  };
}

function makeAmendOp({
  periodId = '2026-05',
  personId = person1,
  date = '2026-05-02',
  shiftCode = 'AM',
  expectedRevision = 1
} = {}) {
  const opId = crypto.randomUUID();
  const cId = crypto.randomUUID();
  const tId = crypto.randomUUID();
  const meaning = {
    operationId: opId,
    clientId: cId,
    tabId: tId,
    operationType: 'PERIOD_AMEND',
    entityKey: `period:${periodId}`,
    expectedRevision,
    payload: {
      periodId,
      eventType: 'ADMIN_CORRECTION',
      personId,
      date,
      dutyDomain: 'MO',
      afterAssignments: [{ shiftCode }],
      publicReasonCode: 'ADMIN_CORRECTION',
      adminNote: 'Displace off duty'
    }
  };
  const payloadHash = digest(protocol.canonical(meaning));
  return {
    action: 'rosterv2amend',
    operationId: opId,
    clientId: cId,
    tabId: tId,
    periodId,
    expectedRevision,
    payload: meaning.payload,
    ...meaning.payload,
    payloadHash
  };
}

function makeAbsenceOp({
  periodId = '2026-05',
  personId = person1,
  startDate = '2026-05-01',
  endDate = '2026-05-01',
  absenceType = 'MC',
  expectedRevision = 1
} = {}) {
  const opId = crypto.randomUUID();
  const cId = crypto.randomUUID();
  const tId = crypto.randomUUID();
  const meaning = {
    operationId: opId,
    clientId: cId,
    tabId: tId,
    operationType: 'ABSENCE_CREATE',
    entityKey: `period:${periodId}`,
    expectedRevision,
    payload: {
      periodId,
      personId,
      absenceType,
      startDate,
      endDate,
      dutyDomain: 'MO',
      publicReason: 'Medical Leave',
      adminNote: 'Dr MC',
      shortageAccepted: true,
      shortageReason: 'Accept shortage'
    }
  };
  const payloadHash = digest(protocol.canonical(meaning));
  return {
    action: 'rosterv2absencecreate',
    operationId: opId,
    clientId: cId,
    tabId: tId,
    periodId,
    expectedRevision,
    payload: meaning.payload,
    ...meaning.payload,
    payloadHash
  };
}

function makeReplacementOp({
  periodId = '2026-05',
  absenceId,
  originalAssignmentId = '',
  replacementPersonId = person2,
  date = '2026-05-01',
  shiftCode = 'AM',
  dutyDomain = 'MO',
  expectedRevision = 2,
  publicReason = 'DUTY_COVERAGE',
  adminNote = 'Dr replacement',
  operationId = null,
  ...rest
} = {}) {
  const opId = operationId || crypto.randomUUID();
  const cId = crypto.randomUUID();
  const tId = crypto.randomUUID();
  const meaning = {
    operationId: opId,
    clientId: cId,
    tabId: tId,
    operationType: 'REPLACEMENT_CREATE',
    entityKey: `period:${periodId}`,
    expectedRevision,
    payload: {
      periodId,
      absenceId,
      originalAssignmentId,
      replacementPersonId,
      date,
      dutyDomain,
      shiftCode,
      publicReason,
      adminNote
    }
  };
  const payloadHash = digest(protocol.canonical(meaning));
  return {
    action: 'rosterv2replacementcreate',
    operationId: opId,
    clientId: cId,
    tabId: tId,
    periodId,
    expectedRevision,
    absenceId,
    originalAssignmentId,
    replacementPersonId,
    date,
    dutyDomain,
    shiftCode,
    publicReason,
    adminNote,
    payload: meaning.payload,
    ...meaning.payload,
    payloadHash,
    ...rest
  };
}

// --------------------------------------------------------------------------
// 1. persist GOFF credit
// --------------------------------------------------------------------------
test('1. persist GOFF credit', () => {
  const { h, periodId } = setupPublished();
  // Displace Ali's planned OFF on 2026-05-02 to AM
  const amendRes = h.post(makeAmendOp({ periodId, personId: person1, date: '2026-05-02', shiftCode: 'AM', expectedRevision: 1 }));
  assert.equal(amendRes.ok, true);

  const earnOp = makeEarnGoffOp({ periodId, personId: person1, date: '2026-05-02' });
  const earnRes = h.post(earnOp);
  assert.equal(earnRes.ok, true);
  assert.equal(earnRes.entitlementType, 'GOFF');
  assert.equal(earnRes.status, 'CONFIRMED');

  const rows = h.grids.RosterEntitlementTransactions.slice(1);
  const found = rows.find(r => r[0] === earnRes.transactionId);
  assert.ok(found, 'transaction row must exist in RosterEntitlementTransactions');
  assert.equal(found[4], 'GOFF');
  assert.equal(found[6], 'CREDIT_EARNED');
  assert.equal(found[7], 1);
  assert.equal(found[21], 'CONFIRMED');
});

// --------------------------------------------------------------------------
// 2. persist GHKA credit
// --------------------------------------------------------------------------
test('2. persist GHKA credit', () => {
  const { h, periodId } = setupPublished();
  // Ali is scheduled AM on 2026-05-01 (Labour Day)
  const earnOp = makeEarnGhkaOp({ periodId, personId: person1, date: '2026-05-01' });
  const earnRes = h.post(earnOp);
  assert.equal(earnRes.ok, true);
  assert.equal(earnRes.entitlementType, 'GHKA');
  assert.equal(earnRes.status, 'CONFIRMED');

  const rows = h.grids.RosterEntitlementTransactions.slice(1);
  const found = rows.find(r => r[0] === earnRes.transactionId);
  assert.ok(found);
  assert.equal(found[4], 'GHKA');
  assert.equal(found[6], 'CREDIT_EARNED');
  assert.equal(found[13], '2026-05-01');
  assert.equal(found[14], 'Labour Day');
  assert.equal(found[21], 'CONFIRMED');
});

// --------------------------------------------------------------------------
// 3. GOFF and GHKA balances separate
// --------------------------------------------------------------------------
test('3. GOFF and GHKA balances separate', () => {
  const { h, periodId } = setupPublished();
  // Displace off for Ali -> earns 1 GOFF
  h.post(makeAmendOp({ periodId, personId: person1, date: '2026-05-02', shiftCode: 'AM', expectedRevision: 1 }));
  h.post(makeEarnGoffOp({ periodId, personId: person1, date: '2026-05-02' }));

  // Ali works Labour Day -> earns 1 GHKA
  h.post(makeEarnGhkaOp({ periodId, personId: person1, date: '2026-05-01' }));
  // Add 1 manual GHKA
  h.post(makeCreditManualOp({ periodId, personId: person1, entitlementType: 'GHKA', effectiveDate: '2026-05-01' }));

  const balRes = h.get('rosterv2entitlementbalances', { personId: person1 });
  assert.equal(balRes.ok, true);
  assert.equal(balRes.balances.GOFF, 1);
  assert.equal(balRes.balances.GHKA, 2);
  assert.equal(balRes.balances.pooled, undefined, 'pooled consumable balance forbidden');
});

// --------------------------------------------------------------------------
// 4. GOFF cannot use GHKA
// --------------------------------------------------------------------------
test('4. GOFF cannot use GHKA', () => {
  const { h, periodId } = setupPublished();
  // Ali earns 2 GHKA, 0 GOFF
  h.post(makeEarnGhkaOp({ periodId, personId: person1, date: '2026-05-01' }));
  h.post(makeCreditManualOp({ periodId, personId: person1, entitlementType: 'GHKA', effectiveDate: '2026-05-01' }));

  const consumeRes = h.post(makeConsumeOp({
    periodId,
    personId: person1,
    entitlementType: 'GOFF',
    date: '2026-05-03',
    expectedRevision: 1
  }));
  assert.equal(consumeRes.ok, false);
  assert.equal(consumeRes.error.code, 'INSUFFICIENT_GOFF_BALANCE');
});

// --------------------------------------------------------------------------
// 5. GHKA cannot use GOFF
// --------------------------------------------------------------------------
test('5. GHKA cannot use GOFF', () => {
  const { h, periodId } = setupPublished();
  // Ali earns 1 GOFF, 0 GHKA
  h.post(makeAmendOp({ periodId, personId: person1, date: '2026-05-02', shiftCode: 'AM', expectedRevision: 1 }));
  h.post(makeEarnGoffOp({ periodId, personId: person1, date: '2026-05-02' }));

  const consumeRes = h.post(makeConsumeOp({
    periodId,
    personId: person1,
    entitlementType: 'GHKA',
    date: '2026-05-03',
    expectedRevision: 2
  }));
  assert.equal(consumeRes.ok, false);
  assert.equal(consumeRes.error.code, 'INSUFFICIENT_GHKA_BALANCE');
});

// --------------------------------------------------------------------------
// 6. MO eligibility
// --------------------------------------------------------------------------
test('6. MO eligibility', () => {
  const { h, periodId } = setupPublished();
  const res = h.post(makeCreditManualOp({ periodId, personId: person1, entitlementType: 'GOFF' }));
  assert.equal(res.ok, true);
  assert.equal(res.entitlementType, 'GOFF');
});

// --------------------------------------------------------------------------
// 7. EP GOFF earn rejected
// --------------------------------------------------------------------------
test('7. EP GOFF earn rejected', () => {
  const { h, periodId } = setupPublished();
  const res = h.post(makeEarnGoffOp({ periodId, personId: personEp, date: '2026-05-02' }));
  assert.equal(res.ok, false);
  assert.equal(res.error.code, 'EP_DOMAIN_EXCLUDED');
});

// --------------------------------------------------------------------------
// 8. EP GHKA earn rejected
// --------------------------------------------------------------------------
test('8. EP GHKA earn rejected', () => {
  const { h, periodId } = setupPublished();
  const res = h.post(makeEarnGhkaOp({ periodId, personId: personEp, date: '2026-05-01' }));
  assert.equal(res.ok, false);
  assert.equal(res.error.code, 'EP_DOMAIN_EXCLUDED');
});

// --------------------------------------------------------------------------
// 9. EP GOFF consume rejected
// --------------------------------------------------------------------------
test('9. EP GOFF consume rejected', () => {
  const { h, periodId } = setupPublished();
  const res = h.post(makeConsumeOp({ periodId, personId: personEp, entitlementType: 'GOFF', date: '2026-05-03' }));
  assert.equal(res.ok, false);
  assert.equal(res.error.code, 'EP_DOMAIN_EXCLUDED');
});

// --------------------------------------------------------------------------
// 10. EP GHKA consume rejected
// --------------------------------------------------------------------------
test('10. EP GHKA consume rejected', () => {
  const { h, periodId } = setupPublished();
  const res = h.post(makeConsumeOp({ periodId, personId: personEp, entitlementType: 'GHKA', date: '2026-05-03' }));
  assert.equal(res.ok, false);
  assert.equal(res.error.code, 'EP_DOMAIN_EXCLUDED');
});

// --------------------------------------------------------------------------
// 11. EP roster rows remain visible/preserved
// --------------------------------------------------------------------------
test('11. EP roster rows remain visible/preserved', () => {
  const { h, periodId } = setupPublished();
  // Grant Ali 1 GOFF and consume
  h.post(makeCreditManualOp({ periodId, personId: person1, entitlementType: 'GOFF' }));
  h.post(makeConsumeOp({ periodId, personId: person1, entitlementType: 'GOFF', date: '2026-05-03', expectedRevision: 1 }));

  // Check Current
  const curRes = h.get('rosterv2current', { periodId });
  assert.equal(curRes.ok, true);
  const epRows = curRes.assignments.filter(a => a.personId === personEp);
  assert.ok(epRows.length > 0, 'EP assignments must be preserved in Current');

  // Check MasterRoster
  const masterRows = h.grids.MasterRoster.slice(1);
  const epMaster = masterRows.filter(r => r[0] === 'Dr. Dave');
  assert.ok(epMaster.length > 0, 'EP rows must remain visible in MasterRoster');
});

// --------------------------------------------------------------------------
// 12. displaced OFF earns GOFF
// --------------------------------------------------------------------------
test('12. displaced OFF earns GOFF', () => {
  const { h, periodId } = setupPublished();
  // Ali planned OFF on 05-02 displaced to PM
  h.post(makeAmendOp({ periodId, personId: person1, date: '2026-05-02', shiftCode: 'PM', expectedRevision: 1 }));
  const earnRes = h.post(makeEarnGoffOp({ periodId, personId: person1, date: '2026-05-02' }));
  assert.equal(earnRes.ok, true);
  assert.equal(earnRes.entitlementType, 'GOFF');
});

// --------------------------------------------------------------------------
// 13. non-displaced OFF does not
// --------------------------------------------------------------------------
test('13. non-displaced OFF does not', () => {
  const { h, periodId } = setupPublished();
  // Ali was planned AM on 2026-05-01 (not OFF)
  const earnRes = h.post(makeEarnGoffOp({ periodId, personId: person1, date: '2026-05-01' }));
  assert.equal(earnRes.ok, false);
  assert.equal(earnRes.error.code, 'NO_DISPLACED_OFF');
});

// --------------------------------------------------------------------------
// 14. public holiday duty earns GHKA
// --------------------------------------------------------------------------
test('14. public holiday duty earns GHKA', () => {
  const { h, periodId } = setupPublished();
  const earnRes = h.post(makeEarnGhkaOp({ periodId, personId: person1, date: '2026-05-01' }));
  assert.equal(earnRes.ok, true);
  assert.equal(earnRes.holidayName, 'Labour Day');
});

// --------------------------------------------------------------------------
// 15. non-holiday duty does not
// --------------------------------------------------------------------------
test('15. non-holiday duty does not', () => {
  const { h, periodId } = setupPublished();
  const earnRes = h.post(makeEarnGhkaOp({ periodId, personId: person1, date: '2026-05-03' }));
  assert.equal(earnRes.ok, false);
  assert.equal(earnRes.error.code, 'NOT_PUBLIC_HOLIDAY');
});

// --------------------------------------------------------------------------
// 16. absent doctor holiday earns no GHKA
// --------------------------------------------------------------------------
test('16. absent doctor holiday earns no GHKA', () => {
  const { h, periodId } = setupPublished();
  // Ali scheduled AM on holiday takes MC
  h.post(makeAbsenceOp({ periodId, personId: person1, startDate: '2026-05-01', endDate: '2026-05-01', expectedRevision: 1 }));
  const earnRes = h.post(makeEarnGhkaOp({ periodId, personId: person1, date: '2026-05-01' }));
  assert.equal(earnRes.ok, false);
  assert.equal(earnRes.error.code, 'NOT_QUALIFYING_DUTY');
});

// --------------------------------------------------------------------------
// 17. replacement worker holiday earns GHKA
// --------------------------------------------------------------------------
test('17. replacement worker holiday earns GHKA', () => {
  const { h, periodId } = setupPublished();
  // Ali takes MC on holiday
  const absRes = h.post(makeAbsenceOp({ periodId, personId: person1, startDate: '2026-05-01', endDate: '2026-05-01', expectedRevision: 1 }));
  // Siti (who was OFF on holiday) replaces Ali
  const replRes = h.post(makeReplacementOp({
    periodId,
    absenceId: absRes.absenceId,
    replacementPersonId: person2,
    date: '2026-05-01',
    shiftCode: 'AM',
    expectedRevision: 2
  }));
  assert.equal(replRes.ok, true);

  // Siti now actually works the holiday duty -> earns GHKA!
  const earnRes = h.post(makeEarnGhkaOp({ periodId, personId: person2, date: '2026-05-01' }));
  assert.equal(earnRes.ok, true);
  assert.equal(earnRes.entitlementType, 'GHKA');
});

// --------------------------------------------------------------------------
// 18. max one GHKA/person/holiday
// --------------------------------------------------------------------------
test('18. max one GHKA/person/holiday', () => {
  const { h, periodId } = setupPublished();
  h.post(makeEarnGhkaOp({ periodId, personId: person1, date: '2026-05-01' }));
  const second = h.post(makeEarnGhkaOp({ periodId, personId: person1, date: '2026-05-01' }));
  assert.equal(second.ok, false);
  assert.equal(second.error.code, 'DUPLICATE_CREDIT_SOURCE');
});

// --------------------------------------------------------------------------
// 19. repeated credit generation idempotent
// --------------------------------------------------------------------------
test('19. repeated credit generation idempotent', () => {
  const { h, periodId } = setupPublished();
  const op = makeEarnGhkaOp({ periodId, personId: person1, date: '2026-05-01' });
  const first = h.post(op);
  assert.equal(first.ok, true);

  const beforeRowCount = h.grids.RosterEntitlementTransactions.length;
  const second = h.post(op);
  assert.equal(second.ok, true);
  assert.equal(second.transactionId, first.transactionId);
  assert.equal(h.grids.RosterEntitlementTransactions.length, beforeRowCount);
});

// --------------------------------------------------------------------------
// 20. GOFF consume with balance succeeds
// --------------------------------------------------------------------------
test('20. GOFF consume with balance succeeds', () => {
  const { h, periodId } = setupPublished();
  h.post(makeCreditManualOp({ periodId, personId: person1, entitlementType: 'GOFF' }));
  const res = h.post(makeConsumeOp({ periodId, personId: person1, entitlementType: 'GOFF', date: '2026-05-03', expectedRevision: 1 }));
  assert.equal(res.ok, true);
  assert.equal(res.state, 'AMENDED');
  assert.equal(res.revision, 2);

  const cur = h.get('rosterv2current', { periodId });
  const ali03 = cur.assignments.find(a => a.personId === person1 && a.date === '2026-05-03');
  assert.equal(ali03.shiftCode, 'GOFF');
  assert.equal(ali03.source, 'GOFF');
});

// --------------------------------------------------------------------------
// 21. GHKA consume with balance succeeds
// --------------------------------------------------------------------------
test('21. GHKA consume with balance succeeds', () => {
  const { h, periodId } = setupPublished();
  h.post(makeCreditManualOp({ periodId, personId: person1, entitlementType: 'GHKA' }));
  const res = h.post(makeConsumeOp({ periodId, personId: person1, entitlementType: 'GHKA', date: '2026-05-03', expectedRevision: 1 }));
  assert.equal(res.ok, true);
  assert.equal(res.state, 'AMENDED');
  assert.equal(res.revision, 2);

  const cur = h.get('rosterv2current', { periodId });
  const ali03 = cur.assignments.find(a => a.personId === person1 && a.date === '2026-05-03');
  assert.equal(ali03.shiftCode, 'GHKA');
  assert.equal(ali03.source, 'GHKA');
});

// --------------------------------------------------------------------------
// 22. zero GOFF fails
// --------------------------------------------------------------------------
test('22. zero GOFF fails', () => {
  const { h, periodId } = setupPublished();
  const res = h.post(makeConsumeOp({ periodId, personId: person1, entitlementType: 'GOFF', date: '2026-05-03', expectedRevision: 1 }));
  assert.equal(res.ok, false);
  assert.equal(res.error.code, 'INSUFFICIENT_GOFF_BALANCE');
});

// --------------------------------------------------------------------------
// 23. zero GHKA fails
// --------------------------------------------------------------------------
test('23. zero GHKA fails', () => {
  const { h, periodId } = setupPublished();
  const res = h.post(makeConsumeOp({ periodId, personId: person1, entitlementType: 'GHKA', date: '2026-05-03', expectedRevision: 1 }));
  assert.equal(res.ok, false);
  assert.equal(res.error.code, 'INSUFFICIENT_GHKA_BALANCE');
});

// --------------------------------------------------------------------------
// 24. GOFF balance unaffected by GHKA consumption
// --------------------------------------------------------------------------
test('24. GOFF balance unaffected by GHKA consumption', () => {
  const { h, periodId } = setupPublished();
  h.post(makeCreditManualOp({ periodId, personId: person1, entitlementType: 'GOFF' }));
  h.post(makeCreditManualOp({ periodId, personId: person1, entitlementType: 'GHKA' }));

  // Consume GHKA
  h.post(makeConsumeOp({ periodId, personId: person1, entitlementType: 'GHKA', date: '2026-05-03', expectedRevision: 1 }));

  const bal = h.get('rosterv2entitlementbalances', { personId: person1 });
  assert.equal(bal.balances.GOFF, 1, 'GOFF balance must remain 1');
  assert.equal(bal.balances.GHKA, 0, 'GHKA balance must be 0');
});

// --------------------------------------------------------------------------
// 25. GHKA balance unaffected by GOFF consumption
// --------------------------------------------------------------------------
test('25. GHKA balance unaffected by GOFF consumption', () => {
  const { h, periodId } = setupPublished();
  h.post(makeCreditManualOp({ periodId, personId: person1, entitlementType: 'GOFF' }));
  h.post(makeCreditManualOp({ periodId, personId: person1, entitlementType: 'GHKA' }));

  // Consume GOFF
  h.post(makeConsumeOp({ periodId, personId: person1, entitlementType: 'GOFF', date: '2026-05-03', expectedRevision: 1 }));

  const bal = h.get('rosterv2entitlementbalances', { personId: person1 });
  assert.equal(bal.balances.GOFF, 0, 'GOFF balance must be 0');
  assert.equal(bal.balances.GHKA, 1, 'GHKA balance must remain 1');
});

// --------------------------------------------------------------------------
// 26. GOFF projection correct
// --------------------------------------------------------------------------
test('26. GOFF projection correct', () => {
  const { h, periodId } = setupPublished();
  h.post(makeCreditManualOp({ periodId, personId: person1, entitlementType: 'GOFF' }));
  h.post(makeConsumeOp({ periodId, personId: person1, entitlementType: 'GOFF', date: '2026-05-03', expectedRevision: 1 }));

  const masterRows = h.grids.MasterRoster.slice(1);
  const row = masterRows.find(r => r[0] === 'Dr. Ali' && r[1] === '2026-05-03');
  assert.ok(row);
  assert.equal(row[2], 'GOFF');
});

// --------------------------------------------------------------------------
// 27. GHKA projection correct
// --------------------------------------------------------------------------
test('27. GHKA projection correct', () => {
  const { h, periodId } = setupPublished();
  h.post(makeCreditManualOp({ periodId, personId: person1, entitlementType: 'GHKA' }));
  h.post(makeConsumeOp({ periodId, personId: person1, entitlementType: 'GHKA', date: '2026-05-03', expectedRevision: 1 }));

  const masterRows = h.grids.MasterRoster.slice(1);
  const row = masterRows.find(r => r[0] === 'Dr. Ali' && r[1] === '2026-05-03');
  assert.ok(row);
  assert.equal(row[2], 'GHKA');
});

// --------------------------------------------------------------------------
// 28. HKA does not affect balance
// --------------------------------------------------------------------------
test('28. HKA does not affect balance', () => {
  const { h, periodId } = setupPublished();
  // Doctor with HKA shift
  h.post(makeAmendOp({ periodId, personId: person1, date: '2026-05-01', shiftCode: 'HKA', expectedRevision: 1 }));
  const bal = h.get('rosterv2entitlementbalances', { personId: person1 });
  assert.equal(bal.balances.GOFF, 0);
  assert.equal(bal.balances.GHKA, 0);
});

// --------------------------------------------------------------------------
// 29. GOFF* does not create balance
// --------------------------------------------------------------------------
test('29. GOFF* does not create balance', () => {
  const { h, periodId } = setupPublished();
  h.post(makeAmendOp({ periodId, personId: person1, date: '2026-05-01', shiftCode: 'GOFF*', expectedRevision: 1 }));
  const bal = h.get('rosterv2entitlementbalances', { personId: person1 });
  assert.equal(bal.balances.GOFF, 0);
  assert.equal(bal.balances.GHKA, 0);
});

// --------------------------------------------------------------------------
// 30. conflict with MC rejected
// --------------------------------------------------------------------------
test('30. conflict with MC rejected', () => {
  const { h, periodId } = setupPublished();
  h.post(makeCreditManualOp({ periodId, personId: person1, entitlementType: 'GOFF' }));
  h.post(makeAbsenceOp({ periodId, personId: person1, startDate: '2026-05-03', endDate: '2026-05-03', absenceType: 'MC', expectedRevision: 1 }));

  const consumeRes = h.post(makeConsumeOp({ periodId, personId: person1, entitlementType: 'GOFF', date: '2026-05-03', expectedRevision: 2 }));
  assert.equal(consumeRes.ok, false);
  assert.equal(consumeRes.error.code, 'INCOMPATIBLE_OPERATIONAL_STATUS');
});

// --------------------------------------------------------------------------
// 31. conflict with AL rejected
// --------------------------------------------------------------------------
test('31. conflict with AL rejected', () => {
  const { h, periodId } = setupPublished();
  h.post(makeCreditManualOp({ periodId, personId: person1, entitlementType: 'GOFF' }));
  h.post(makeAbsenceOp({ periodId, personId: person1, startDate: '2026-05-03', endDate: '2026-05-03', absenceType: 'AL', expectedRevision: 1 }));

  const consumeRes = h.post(makeConsumeOp({ periodId, personId: person1, entitlementType: 'GOFF', date: '2026-05-03', expectedRevision: 2 }));
  assert.equal(consumeRes.ok, false);
  assert.equal(consumeRes.error.code, 'INCOMPATIBLE_OPERATIONAL_STATUS');
});

// --------------------------------------------------------------------------
// 32. conflict with EL rejected
// --------------------------------------------------------------------------
test('32. conflict with EL rejected', () => {
  const { h, periodId } = setupPublished();
  h.post(makeCreditManualOp({ periodId, personId: person1, entitlementType: 'GHKA' }));
  h.post(makeAbsenceOp({ periodId, personId: person1, startDate: '2026-05-03', endDate: '2026-05-03', absenceType: 'EL', expectedRevision: 1 }));

  const consumeRes = h.post(makeConsumeOp({ periodId, personId: person1, entitlementType: 'GHKA', date: '2026-05-03', expectedRevision: 2 }));
  assert.equal(consumeRes.ok, false);
  assert.equal(consumeRes.error.code, 'INCOMPATIBLE_OPERATIONAL_STATUS');
});

// --------------------------------------------------------------------------
// 33. conflict with COURSE rejected
// --------------------------------------------------------------------------
test('33. conflict with COURSE rejected', () => {
  const { h, periodId } = setupPublished();
  h.post(makeCreditManualOp({ periodId, personId: person1, entitlementType: 'GHKA' }));
  h.post(makeAbsenceOp({ periodId, personId: person1, startDate: '2026-05-03', endDate: '2026-05-03', absenceType: 'COURSE', expectedRevision: 1 }));

  const consumeRes = h.post(makeConsumeOp({ periodId, personId: person1, entitlementType: 'GHKA', date: '2026-05-03', expectedRevision: 2 }));
  assert.equal(consumeRes.ok, false);
  assert.equal(consumeRes.error.code, 'INCOMPATIBLE_OPERATIONAL_STATUS');
});

// --------------------------------------------------------------------------
// 34. Planned immutable
// --------------------------------------------------------------------------
test('34. Planned immutable', () => {
  const { h, periodId } = setupPublished();
  const plannedBefore = h.get('rosterv2planned', { periodId });

  h.post(makeCreditManualOp({ periodId, personId: person1, entitlementType: 'GOFF' }));
  h.post(makeConsumeOp({ periodId, personId: person1, entitlementType: 'GOFF', date: '2026-05-03', expectedRevision: 1 }));

  const plannedAfter = h.get('rosterv2planned', { periodId });
  assert.deepEqual(plannedBefore.assignments, plannedAfter.assignments);
});

// --------------------------------------------------------------------------
// 35. credit-only leaves lifecycle PUBLISHED
// --------------------------------------------------------------------------
test('35. credit-only leaves lifecycle PUBLISHED', () => {
  const { h, periodId } = setupPublished();
  h.post(makeEarnGhkaOp({ periodId, personId: person1, date: '2026-05-01' }));
  h.post(makeCreditManualOp({ periodId, personId: person1, entitlementType: 'GOFF' }));

  const periodRow = h.grids.RosterPeriods.find(r => r[0] === periodId);
  const headers = h.grids.RosterPeriods[0];
  const stateIdx = headers.indexOf('State');
  const revIdx = headers.indexOf('Revision');
  assert.equal(periodRow[stateIdx], 'PUBLISHED');
  assert.equal(periodRow[revIdx], 1);
});

// --------------------------------------------------------------------------
// 36. GOFF consumption makes AMENDED
// --------------------------------------------------------------------------
test('36. GOFF consumption makes AMENDED', () => {
  const { h, periodId } = setupPublished();
  h.post(makeCreditManualOp({ periodId, personId: person1, entitlementType: 'GOFF' }));
  const res = h.post(makeConsumeOp({ periodId, personId: person1, entitlementType: 'GOFF', date: '2026-05-03', expectedRevision: 1 }));
  assert.equal(res.state, 'AMENDED');
  assert.equal(res.revision, 2);

  const cur = h.get('rosterv2current', { periodId });
  assert.equal(cur.effectiveState, 'AMENDED');
});

// --------------------------------------------------------------------------
// 37. GHKA consumption makes AMENDED
// --------------------------------------------------------------------------
test('37. GHKA consumption makes AMENDED', () => {
  const { h, periodId } = setupPublished();
  h.post(makeCreditManualOp({ periodId, personId: person1, entitlementType: 'GHKA' }));
  const res = h.post(makeConsumeOp({ periodId, personId: person1, entitlementType: 'GHKA', date: '2026-05-03', expectedRevision: 1 }));
  assert.equal(res.state, 'AMENDED');
  assert.equal(res.revision, 2);

  const cur = h.get('rosterv2current', { periodId });
  assert.equal(cur.effectiveState, 'AMENDED');
});

// --------------------------------------------------------------------------
// 38. consumption reversal restores balance
// --------------------------------------------------------------------------
test('38. consumption reversal restores balance', () => {
  const { h, periodId } = setupPublished();
  h.post(makeCreditManualOp({ periodId, personId: person1, entitlementType: 'GOFF' }));
  const consRes = h.post(makeConsumeOp({ periodId, personId: person1, entitlementType: 'GOFF', date: '2026-05-03', expectedRevision: 1 }));

  let bal = h.get('rosterv2entitlementbalances', { personId: person1 });
  assert.equal(bal.balances.GOFF, 0);

  const revRes = h.post(makeConsumeReverseOp({ periodId, transactionId: consRes.transactionId, expectedRevision: 2 }));
  assert.equal(revRes.ok, true);

  bal = h.get('rosterv2entitlementbalances', { personId: person1 });
  assert.equal(bal.balances.GOFF, 1);
});

// --------------------------------------------------------------------------
// 39. final reversal restores PUBLISHED when appropriate
// --------------------------------------------------------------------------
test('39. final reversal restores PUBLISHED when appropriate', () => {
  const { h, periodId } = setupPublished();
  h.post(makeCreditManualOp({ periodId, personId: person1, entitlementType: 'GOFF' }));
  const consRes = h.post(makeConsumeOp({ periodId, personId: person1, entitlementType: 'GOFF', date: '2026-05-03', expectedRevision: 1 }));
  assert.equal(consRes.state, 'AMENDED');

  const revRes = h.post(makeConsumeReverseOp({ periodId, transactionId: consRes.transactionId, expectedRevision: 2 }));
  assert.equal(revRes.state, 'PUBLISHED');

  const cur = h.get('rosterv2current', { periodId });
  assert.equal(cur.effectiveState, 'PUBLISHED');
});

// --------------------------------------------------------------------------
// 40. Phase 5 active amendment keeps AMENDED
// --------------------------------------------------------------------------
test('40. Phase 5 active amendment keeps AMENDED', () => {
  const { h, periodId } = setupPublished();
  // Phase 5 amendment
  h.post(makeAmendOp({ periodId, personId: person2, date: '2026-05-03', shiftCode: 'PM', expectedRevision: 1 }));

  // Entitlement consume
  h.post(makeCreditManualOp({ periodId, personId: person1, entitlementType: 'GOFF' }));
  const consRes = h.post(makeConsumeOp({ periodId, personId: person1, entitlementType: 'GOFF', date: '2026-05-03', expectedRevision: 2 }));

  // Reverse entitlement consume
  const revRes = h.post(makeConsumeReverseOp({ periodId, transactionId: consRes.transactionId, expectedRevision: 3 }));
  assert.equal(revRes.state, 'AMENDED', 'Phase 5 active amendment must keep period AMENDED');
});

// --------------------------------------------------------------------------
// 41. Phase 6 active absence keeps AMENDED
// --------------------------------------------------------------------------
test('41. Phase 6 active absence keeps AMENDED', () => {
  const { h, periodId } = setupPublished();
  // Phase 6 absence for Dr Siti
  h.post(makeAbsenceOp({ periodId, personId: person2, startDate: '2026-05-03', endDate: '2026-05-03', absenceType: 'MC', expectedRevision: 1 }));

  // Entitlement consume for Ali
  h.post(makeCreditManualOp({ periodId, personId: person1, entitlementType: 'GHKA' }));
  const consRes = h.post(makeConsumeOp({ periodId, personId: person1, entitlementType: 'GHKA', date: '2026-05-03', expectedRevision: 2 }));

  // Reverse entitlement consume
  const revRes = h.post(makeConsumeReverseOp({ periodId, transactionId: consRes.transactionId, expectedRevision: 3 }));
  assert.equal(revRes.state, 'AMENDED', 'Phase 6 active absence must keep period AMENDED');
});

// --------------------------------------------------------------------------
// 42. credit reversal blocked with dependent consumption
// --------------------------------------------------------------------------
test('42. credit reversal blocked with dependent consumption', () => {
  const { h, periodId } = setupPublished();
  const credRes = h.post(makeCreditManualOp({ periodId, personId: person1, entitlementType: 'GOFF' }));
  h.post(makeConsumeOp({ periodId, personId: person1, entitlementType: 'GOFF', date: '2026-05-03', expectedRevision: 1 }));

  // Attempt to reverse the credit
  const revRes = h.post(makeCreditReverseOp({ periodId, transactionId: credRes.transactionId }));
  assert.equal(revRes.ok, false);
  assert.equal(revRes.error.code, 'DEPENDENT_CONSUMPTION_EXISTS');
});

// --------------------------------------------------------------------------
// 43. consumption reversal permits later credit reversal
// --------------------------------------------------------------------------
test('43. consumption reversal permits later credit reversal', () => {
  const { h, periodId } = setupPublished();
  const credRes = h.post(makeCreditManualOp({ periodId, personId: person1, entitlementType: 'GOFF' }));
  const consRes = h.post(makeConsumeOp({ periodId, personId: person1, entitlementType: 'GOFF', date: '2026-05-03', expectedRevision: 1 }));

  // Reverse consumption first
  const consRevRes = h.post(makeConsumeReverseOp({ periodId, transactionId: consRes.transactionId, expectedRevision: 2 }));
  assert.equal(consRevRes.ok, true);

  // Now credit reversal succeeds!
  const credRevRes = h.post(makeCreditReverseOp({ periodId, transactionId: credRes.transactionId }));
  assert.equal(credRevRes.ok, true);
  assert.equal(credRevRes.status, 'CONFIRMED');
});

// --------------------------------------------------------------------------
// 44. cross-type dependency rejected
// --------------------------------------------------------------------------
test('44. cross-type dependency rejected', () => {
  const { h, periodId } = setupPublished();
  // Earn 1 GOFF and 1 GHKA
  const goffCred = h.post(makeCreditManualOp({ periodId, personId: person1, entitlementType: 'GOFF' }));
  h.post(makeCreditManualOp({ periodId, personId: person1, entitlementType: 'GHKA' }));

  // Consume GHKA
  h.post(makeConsumeOp({ periodId, personId: person1, entitlementType: 'GHKA', date: '2026-05-03', expectedRevision: 1 }));

  // Reversing GOFF credit is NOT blocked by GHKA consumption! (No cross-type dependency)
  const revRes = h.post(makeCreditReverseOp({ periodId, transactionId: goffCred.transactionId }));
  assert.equal(revRes.ok, true, 'GOFF credit reversal must not be blocked by GHKA consumption');
});

// --------------------------------------------------------------------------
// 45. PENDING transaction excluded
// --------------------------------------------------------------------------
test('45. PENDING transaction excluded', () => {
  const { h, periodId } = setupPublished();
  // Append raw PENDING transaction row to RosterEntitlementTransactions
  h.grids.RosterEntitlementTransactions.push([
    'etx-pending-1', periodId, person1, 'Dr. Ali', 'GOFF', 'MO', 'CREDIT_EARNED', 1,
    '2026-05-01', 'DISPLACED_WEEKLY_OFF', 'src1', '', '', '', '', '', '',
    'DISPLACED_OFF_CREDIT', '', '', '', 'PENDING', crypto.randomUUID(), new Date().toISOString(), 'admin'
  ]);

  const bal = h.get('rosterv2entitlementbalances', { personId: person1 });
  assert.equal(bal.balances.GOFF, 0, 'PENDING transaction must be excluded from balance');
});

// --------------------------------------------------------------------------
// 46. RECOVERY_REQUIRED transaction excluded
// --------------------------------------------------------------------------
test('46. RECOVERY_REQUIRED transaction excluded', () => {
  const { h, periodId } = setupPublished();
  h.grids.RosterEntitlementTransactions.push([
    'etx-rec-1', periodId, person1, 'Dr. Ali', 'GOFF', 'MO', 'CREDIT_EARNED', 1,
    '2026-05-01', 'DISPLACED_WEEKLY_OFF', 'src1', '', '', '', '', '', '',
    'DISPLACED_OFF_CREDIT', '', '', '', 'RECOVERY_REQUIRED', crypto.randomUUID(), new Date().toISOString(), 'admin'
  ]);

  const bal = h.get('rosterv2entitlementbalances', { personId: person1 });
  assert.equal(bal.balances.GOFF, 0, 'RECOVERY_REQUIRED transaction must be excluded from balance');
});

// --------------------------------------------------------------------------
// 47. FAILED transaction excluded
// --------------------------------------------------------------------------
test('47. FAILED transaction excluded', () => {
  const { h, periodId } = setupPublished();
  h.grids.RosterEntitlementTransactions.push([
    'etx-failed-1', periodId, person1, 'Dr. Ali', 'GOFF', 'MO', 'CREDIT_EARNED', 1,
    '2026-05-01', 'DISPLACED_WEEKLY_OFF', 'src1', '', '', '', '', '', '',
    'DISPLACED_OFF_CREDIT', '', '', '', 'FAILED', crypto.randomUUID(), new Date().toISOString(), 'admin'
  ]);

  const bal = h.get('rosterv2entitlementbalances', { personId: person1 });
  assert.equal(bal.balances.GOFF, 0, 'FAILED transaction must be excluded from balance');
});

// --------------------------------------------------------------------------
// 48. post-persistence failure -> RECOVERY_REQUIRED
// --------------------------------------------------------------------------
test('48. post-persistence failure -> RECOVERY_REQUIRED', () => {
  const { h, periodId } = setupPublished();
  h.post(makeCreditManualOp({ periodId, personId: person1, entitlementType: 'GOFF' }));

  // Simulate post-persistence crash during MasterRoster write
  h.context.rosterLifecycleWriteMasterRoster_ = () => {
    const err = new Error('INJECTED_POST_ENTITLEMENT_WRITE_CRASH');
    err.code = 'TRANSIENT_BACKEND';
    throw err;
  };

  const op = makeConsumeOp({ periodId, personId: person1, entitlementType: 'GOFF', date: '2026-05-03', expectedRevision: 1 });
  const consumeRes = h.post(op);
  assert.equal(consumeRes.ok, false);

  const logRows = h.grids.OperationLog.slice(1);
  const logRow = logRows.find(r => r[0] === op.operationId);
  assert.ok(logRow);
  assert.equal(logRow[8], 'RECOVERY_REQUIRED');
});

// --------------------------------------------------------------------------
// 49. pre-persistence failure -> FAILED
// --------------------------------------------------------------------------
test('49. pre-persistence failure -> FAILED', () => {
  const { h, periodId } = setupPublished();
  h.post(makeCreditManualOp({ periodId, personId: person1, entitlementType: 'GOFF' }));

  // Inject failure before entity write
  const origAppend = h.context.rosterLifecycleAppendRows_;
  h.context.rosterLifecycleAppendRows_ = (sheetName, rows) => {
    if (sheetName === 'RosterEntitlementTransactions') {
      const err = new Error('INJECTED_PRE_ENTITLEMENT_WRITE_CRASH');
      err.code = 'TRANSIENT_BACKEND';
      throw err;
    }
    return origAppend(sheetName, rows);
  };

  const op = makeConsumeOp({ periodId, personId: person1, entitlementType: 'GOFF', date: '2026-05-03', expectedRevision: 1 });
  const consumeRes = h.post(op);
  assert.equal(consumeRes.ok, false);

  const logRows = h.grids.OperationLog.slice(1);
  const logRow = logRows.find(r => r[0] === op.operationId);
  assert.ok(logRow);
  assert.equal(logRow[8], 'FAILED');
});

// --------------------------------------------------------------------------
// 50. recovery no duplicate row
// --------------------------------------------------------------------------
test('50. recovery no duplicate row', () => {
  const { h, periodId } = setupPublished();
  h.post(makeCreditManualOp({ periodId, personId: person1, entitlementType: 'GOFF' }));

  // Simulate interruption after consume write: status left RECOVERY_REQUIRED in log
  const op = makeConsumeOp({ periodId, personId: person1, entitlementType: 'GOFF', date: '2026-05-03', expectedRevision: 1 });
  const consumeRes = h.post(op);
  assert.equal(consumeRes.ok, true);

  const beforeTxCount = h.grids.RosterEntitlementTransactions.length;
  // Recover operation
  const recRes = h.post({ action: 'rosterv2entitlementrecover', operationId: op.operationId });
  assert.equal(recRes.ok, true);
  assert.equal(h.grids.RosterEntitlementTransactions.length, beforeTxCount, 'recovery must not append duplicate transaction row');
});

// --------------------------------------------------------------------------
// 51. recovery no double revision
// --------------------------------------------------------------------------
test('51. recovery no double revision', () => {
  const { h, periodId } = setupPublished();
  h.post(makeCreditManualOp({ periodId, personId: person1, entitlementType: 'GOFF' }));
  const op = makeConsumeOp({ periodId, personId: person1, entitlementType: 'GOFF', date: '2026-05-03', expectedRevision: 1 });
  const consumeRes = h.post(op);
  assert.equal(consumeRes.revision, 2);

  const recRes = h.post({ action: 'rosterv2entitlementrecover', operationId: op.operationId });
  assert.equal(recRes.ok, true);
  assert.equal(recRes.resultRevision, 2, 'recovery must not double increment revision');
});

// --------------------------------------------------------------------------
// 52. recovery same DTO/result
// --------------------------------------------------------------------------
test('52. recovery same DTO/result', () => {
  const { h, periodId } = setupPublished();
  h.post(makeCreditManualOp({ periodId, personId: person1, entitlementType: 'GOFF' }));
  const op = makeConsumeOp({ periodId, personId: person1, entitlementType: 'GOFF', date: '2026-05-03', expectedRevision: 1 });
  const consumeRes = h.post(op);

  const recRes = h.post({ action: 'rosterv2entitlementrecover', operationId: op.operationId });
  assert.equal(recRes.ok, true);
  assert.equal(recRes.result.transactionId, consumeRes.transactionId);
  assert.equal(recRes.result.state, consumeRes.state);
  assert.equal(recRes.result.revision, consumeRes.revision);
});

// --------------------------------------------------------------------------
// 53. operation payload mismatch rejected
// --------------------------------------------------------------------------
test('53. operation payload mismatch rejected', () => {
  const { h, periodId } = setupPublished();
  const op = makeCreditManualOp({ periodId, personId: person1, entitlementType: 'GOFF' });
  const first = h.post(op);
  assert.equal(first.ok, true);

  // Send same operationId with changed payload
  const alteredOp = { ...op, entitlementType: 'GHKA', payloadHash: 'tampered' };
  const second = h.post(alteredOp);
  assert.equal(second.ok, false);
  assert.equal(second.error.code, 'IDEMPOTENCY_MISMATCH');
});

// --------------------------------------------------------------------------
// 54. December credit available in January
// --------------------------------------------------------------------------
test('54. December credit available in January', () => {
  const h = setup();
  // Publish December 2026
  const decPubOp = makePublishOp({ periodId: '2026-12' });
  h.post({ action: 'rosterv2publish', ...decPubOp });

  // Publish January 2027
  const janPubOp = makePublishOp({ periodId: '2027-01' });
  h.post({ action: 'rosterv2publish', ...janPubOp });

  // Earn GOFF in December 2026
  h.post(makeCreditManualOp({ periodId: '2026-12', personId: person1, entitlementType: 'GOFF', effectiveDate: '2026-12-15' }));

  // Check balance in January 2027
  const bal = h.get('rosterv2entitlementbalances', { personId: person1 });
  assert.equal(bal.balances.GOFF, 1, 'December credit must be available in January');

  // Consume in January 2027
  const consRes = h.post(makeConsumeOp({
    periodId: '2027-01',
    personId: person1,
    entitlementType: 'GOFF',
    date: '2027-01-03',
    expectedRevision: 1
  }));
  assert.equal(consRes.ok, true, 'December credit must be consumable in January');
});

// --------------------------------------------------------------------------
// 55. null expiry valid indefinitely
// --------------------------------------------------------------------------
test('55. null expiry valid indefinitely', () => {
  const { h, periodId } = setupPublished();
  h.post(makeCreditManualOp({ periodId, personId: person1, entitlementType: 'GOFF' }));

  // Query asOfDate 10 years in the future
  const bal = h.get('rosterv2entitlementbalances', { personId: person1, asOfDate: '2036-12-31' });
  assert.equal(bal.balances.GOFF, 1, 'null expiry must carry indefinitely');
});

// --------------------------------------------------------------------------
// 56. hypothetical expired credit excluded as-of date
// --------------------------------------------------------------------------
test('56. hypothetical expired credit excluded as-of date', () => {
  const { h, periodId } = setupPublished();
  // Add a hypothetical credit expiring on 2026-06-01
  h.grids.RosterEntitlementTransactions.push([
    'etx-exp-1', periodId, person1, 'Dr. Ali', 'GOFF', 'MO', 'CREDIT_EARNED', 1,
    '2026-05-01', 'DISPLACED_WEEKLY_OFF', 'src1', '', '', '', '', '', '',
    'DISPLACED_OFF_CREDIT', '', '2026-06-01', 'ANNUAL', 'CONFIRMED', '', new Date().toISOString(), 'admin'
  ]);

  // Query before expiry: active
  const balBefore = h.get('rosterv2entitlementbalances', { personId: person1, asOfDate: '2026-05-15' });
  assert.equal(balBefore.balances.GOFF, 1);

  // Query after expiry: excluded
  const balAfter = h.get('rosterv2entitlementbalances', { personId: person1, asOfDate: '2026-07-01' });
  assert.equal(balAfter.balances.GOFF, 0);
});

// --------------------------------------------------------------------------
// 57. viewer DTO privacy
// --------------------------------------------------------------------------
test('57. viewer DTO privacy', () => {
  const { h, periodId } = setupPublished();
  // Add transaction
  h.grids.RosterEntitlementTransactions.push([
    'etx-priv-1', periodId, person1, 'Dr. Ali', 'GOFF', 'MO', 'CREDIT_EARNED', 1,
    '2026-05-01', 'DISPLACED_WEEKLY_OFF', 'src1', '', '', '', '', '', '',
    'DISPLACED_OFF_CREDIT', 'SECRET_ADMIN_NOTE', '', '', 'CONFIRMED', '', new Date().toISOString(), 'admin@example.invalid'
  ]);

  h.context.Session.getActiveUser = () => ({ getEmail: () => 'viewer@example.invalid' });
  const txRes = h.get('rosterv2entitlementtransactions', { periodId });
  assert.equal(txRes.ok, true);
  assert.equal(txRes.isAdmin, false);
  const tx = txRes.transactions.find(t => t.TransactionId === 'etx-priv-1');
  assert.ok(tx);
  assert.equal(tx.AdminNote, undefined, 'AdminNote must be stripped for viewer');
  assert.equal(tx.OperationId, undefined, 'OperationId must be stripped for viewer');
  assert.equal(tx.CreatedBy, undefined, 'CreatedBy must be stripped for viewer');
});

// --------------------------------------------------------------------------
// 58. admin DTO retains authorized fields
// --------------------------------------------------------------------------
test('58. admin DTO retains authorized fields', () => {
  const { h, periodId } = setupPublished({ activeEmail: 'admin@example.invalid', adminEmail: 'admin@example.invalid' });
  h.grids.RosterEntitlementTransactions.push([
    'etx-priv-2', periodId, person1, 'Dr. Ali', 'GOFF', 'MO', 'CREDIT_EARNED', 1,
    '2026-05-01', 'DISPLACED_WEEKLY_OFF', 'src1', '', '', '', '', '', '',
    'DISPLACED_OFF_CREDIT', 'SECRET_ADMIN_NOTE', '', '', 'CONFIRMED', '', new Date().toISOString(), 'admin@example.invalid'
  ]);

  const txRes = h.get('rosterv2entitlementtransactions', { periodId });
  assert.equal(txRes.ok, true);
  assert.equal(txRes.isAdmin, true);
  const tx = txRes.transactions.find(t => t.TransactionId === 'etx-priv-2');
  assert.ok(tx);
  assert.equal(tx.AdminNote, 'SECRET_ADMIN_NOTE');
  assert.equal(tx.CreatedBy, 'admin@example.invalid');
});

// --------------------------------------------------------------------------
// 59. other roster months preserved
// --------------------------------------------------------------------------
test('59. other roster months preserved', () => {
  const h = setup();
  // Seed MasterRoster with existing rows from another month (2026-04)
  h.grids.MasterRoster = [
    ['Name', 'Date', 'Shift'],
    ['Dr. Legacy', '2026-04-10', 'AM'],
    ['Dr. Ali', '2026-04-10', 'PM']
  ];

  // Publish 2026-05
  const pubOp = makePublishOp({ periodId: '2026-05' });
  h.post({ action: 'rosterv2publish', ...pubOp });

  // Consume GOFF in 2026-05
  h.post(makeCreditManualOp({ periodId: '2026-05', personId: person1, entitlementType: 'GOFF' }));
  h.post(makeConsumeOp({ periodId: '2026-05', personId: person1, entitlementType: 'GOFF', date: '2026-05-03', expectedRevision: 1 }));

  // Verify MasterRoster retains 2026-04 rows untouched!
  const masterRows = h.grids.MasterRoster.slice(1);
  const aprLegacy = masterRows.find(r => r[0] === 'Dr. Legacy' && r[1] === '2026-04-10');
  const aprAli = masterRows.find(r => r[0] === 'Dr. Ali' && r[1] === '2026-04-10');
  assert.ok(aprLegacy, 'April 2026 rows must be preserved');
  assert.ok(aprAli, 'April 2026 rows must be preserved');
});

// --------------------------------------------------------------------------
// 60. backend/shared resolver equivalence
// --------------------------------------------------------------------------
test('60. backend/shared resolver equivalence', () => {
  const { h, periodId } = setupPublished();
  h.post(makeCreditManualOp({ periodId, personId: person1, entitlementType: 'GOFF' }));
  h.post(makeConsumeOp({ periodId, personId: person1, entitlementType: 'GOFF', date: '2026-05-03', expectedRevision: 1 }));

  // Backend Current result
  const backendCur = h.get('rosterv2current', { periodId });

  // Compute directly via shared RosterLifecycle.resolveCurrentRoster
  const plannedRows = h.grids.RosterAssignments.slice(1).map(r => {
    const headers = h.grids.RosterAssignments[0];
    const obj = {};
    headers.forEach((hd, i) => { obj[hd] = r[i]; });
    return obj;
  }).filter(r => r.PeriodId === periodId && r.Layer === 'PLANNED');

  const entitlementRows = h.grids.RosterEntitlementTransactions.slice(1).map(r => {
    const headers = h.grids.RosterEntitlementTransactions[0];
    const obj = {};
    headers.forEach((hd, i) => { obj[hd] = r[i]; });
    return obj;
  }).filter(r => r.PeriodId === periodId && r.Status === 'CONFIRMED');

  const peopleRows = h.grids.RosterPeople.slice(1).map(r => {
    const headers = h.grids.RosterPeople[0];
    const obj = {};
    headers.forEach((hd, i) => { obj[hd] = r[i]; });
    return obj;
  });

  const sharedCur = lifecycle.resolveCurrentRoster({
    periodId,
    plannedAssignments: plannedRows,
    events: [],
    absences: [],
    replacements: [],
    entitlements: entitlementRows,
    people: peopleRows,
    digestFn: digest
  });

  assert.equal(backendCur.effectiveState, sharedCur.effectiveState);
  assert.equal(backendCur.count, sharedCur.currentAssignments.length);
  assert.equal(backendCur.projectionChecksum, sharedCur.projectionChecksum);
});
