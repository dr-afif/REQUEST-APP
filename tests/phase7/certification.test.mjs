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
    [`${person1}/${periodId}-01`]: [{ rawShift: 'AM' }], // Ali works holiday duty
    [`${person2}/${periodId}-01`]: [{ rawShift: 'OFF' }], // Siti planned OFF
    [`${person3}/${periodId}-01`]: [{ rawShift: 'PM' }],
    [`${personEp}/${periodId}-01`]: [{ rawShift: 'AM' }], // EP works holiday
    [`${person1}/${periodId}-02`]: [{ rawShift: 'OFF' }], // Ali planned OFF
    [`${person2}/${periodId}-02`]: [{ rawShift: 'AM' }],
    [`${person3}/${periodId}-02`]: [{ rawShift: 'PM' }],
    [`${personEp}/${periodId}-02`]: [{ rawShift: 'OFF' }],
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
    payload: meaning.payload,
    ...meaning.payload,
    payloadHash,
    ...rest
  };
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

function errorText(res) {
  if (!res) return '';
  if (typeof res === 'string') return res;
  return `${res.code || ''} ${res.message || ''} ${typeof res.error === 'string' ? res.error : (res.error?.code || res.error?.message || '')} ${JSON.stringify(res.details || '')}`;
}

// ============================================================================
// PHASE 7 SLICE 4 CERTIFICATION SCENARIOS
// ============================================================================

test('Certification Scenario A: GOFF earn / use / reverse complete lifecycle', () => {
  const { h, periodId } = setupPublished();

  // 1. Displace Dr. Ali from Planned OFF on 2026-05-02 with AM shift
  const amendRes = h.post(makeAmendOp({ periodId, personId: person1, date: '2026-05-02', shiftCode: 'AM', expectedRevision: 1 }));
  assert.equal(amendRes.ok, true);
  assert.equal(amendRes.revision, 2);

  // 2. Earn GOFF for displaced weekly OFF
  const earnRes = h.post(makeEarnGoffOp({ periodId, personId: person1, date: '2026-05-02' }));
  assert.equal(earnRes.ok, true);
  assert.equal(earnRes.entitlementType, 'GOFF');
  assert.equal(earnRes.amount, 1);

  // 3. Credit-only operation leaves roster revision unchanged (remains 2 from step 1)
  const lifeRes = h.get('rosterv2periodlifecycle', { periodId });
  assert.equal(lifeRes.period.Revision, 2, 'Credit-only operation does not increment revision');

  // Check balance: GOFF = 1, GHKA = 0
  let balRes = h.get('rosterv2entitlementbalances', { personId: person1 });
  assert.equal(balRes.balances.GOFF, 1);
  assert.equal(balRes.balances.GHKA, 0);

  // 4. Consume GOFF on 2026-05-03 (Planned AM)
  const consumeRes = h.post(makeConsumeOp({
    periodId,
    personId: person1,
    entitlementType: 'GOFF',
    date: '2026-05-03',
    expectedRevision: 2
  }));
  assert.equal(consumeRes.ok, true);
  assert.equal(consumeRes.revision, 3);
  assert.equal(consumeRes.state, 'AMENDED');

  // Verify Current duty became GOFF
  const currRes = h.get('rosterv2current', { periodId });
  const dutyCell = currRes.assignments.find(a => a.personId === person1 && a.date === '2026-05-03');
  assert.equal(dutyCell.shiftCode, 'GOFF');

  // Verify Planned remains unchanged (AM)
  const planRes = h.get('rosterv2planned', { periodId });
  const planCell = planRes.assignments.find(a => a.personId === person1 && a.date === '2026-05-03');
  assert.equal(planCell.shiftCode, 'AM');

  // Balance after consumption: GOFF = 0, GHKA = 0
  balRes = h.get('rosterv2entitlementbalances', { personId: person1 });
  assert.equal(balRes.balances.GOFF, 0);
  assert.equal(balRes.balances.GHKA, 0);

  // 5. Reverse consumption
  const revConsumeRes = h.post(makeConsumeReverseOp({
    periodId,
    transactionId: consumeRes.transactionId,
    expectedRevision: 3
  }));
  assert.equal(revConsumeRes.ok, true);
  assert.equal(revConsumeRes.revision, 4);

  // Balance restored: GOFF = 1
  balRes = h.get('rosterv2entitlementbalances', { personId: person1 });
  assert.equal(balRes.balances.GOFF, 1);

  // 6. Reverse credit
  const revCreditRes = h.post(makeCreditReverseOp({
    periodId,
    transactionId: earnRes.transactionId
  }));
  assert.equal(revCreditRes.ok, true);

  // Balance returned to 0
  balRes = h.get('rosterv2entitlementbalances', { personId: person1 });
  assert.equal(balRes.balances.GOFF, 0);

  // Ledger history retained (compensating transactions appended, original untouched)
  const txRes = h.get('rosterv2entitlementtransactions', { personId: person1 });
  assert.equal(txRes.count, 4); // CREDIT_EARNED, CONSUMPTION, CONSUMPTION_REVERSAL, CREDIT_REVERSAL
  const origCredit = txRes.transactions.find(t => t.TransactionId === earnRes.transactionId);
  assert.ok(origCredit, 'Original credit transaction must remain in immutable ledger');
});

test('Certification Scenario B: GHKA holiday coverage (Dr A MC, Dr B covers)', () => {
  const { h, periodId } = setupPublished();

  // 1. Dr. Ali Planned on 2026-05-01 (Labour Day) takes MC
  const absRes = h.post(makeAbsenceOp({
    periodId,
    personId: person1,
    startDate: '2026-05-01',
    endDate: '2026-05-01',
    absenceType: 'MC',
    expectedRevision: 1
  }));
  assert.equal(absRes.ok, true);

  // 2. Dr. Siti (planned OFF) replaces Dr. Ali
  const replRes = h.post(makeReplacementOp({
    periodId,
    absenceId: absRes.absenceId,
    replacementPersonId: person2,
    date: '2026-05-01',
    shiftCode: 'AM',
    expectedRevision: 2
  }));
  assert.equal(replRes.ok, true);

  // 3. Dr Ali absent on holiday cannot earn GHKA
  const failAli = h.post(makeEarnGhkaOp({ periodId, personId: person1, date: '2026-05-01' }));
  assert.equal(failAli.ok, false);
  assert.match(errorText(failAli), /ABSENT_ON_PUBLIC_HOLIDAY|ELIGIBLE_HOLIDAY_SOURCE_NOT_FOUND|NOT_QUALIFYING_DUTY/);

  // 4. Dr Siti actually worked holiday -> earns +1 GHKA
  const earnSiti = h.post(makeEarnGhkaOp({ periodId, personId: person2, date: '2026-05-01' }));
  assert.equal(earnSiti.ok, true);
  assert.equal(earnSiti.entitlementType, 'GHKA');

  // Balances: Ali = 0 GHKA, Siti = 1 GHKA
  const balAli = h.get('rosterv2entitlementbalances', { personId: person1 });
  const balSiti = h.get('rosterv2entitlementbalances', { personId: person2 });
  assert.equal(balAli.balances.GHKA, 0);
  assert.equal(balSiti.balances.GHKA, 1);

  // 5. Consume Siti GHKA on 2026-05-02
  const consumeSiti = h.post(makeConsumeOp({
    periodId,
    personId: person2,
    entitlementType: 'GHKA',
    date: '2026-05-02',
    expectedRevision: 3
  }));
  assert.equal(consumeSiti.ok, true);
  assert.equal(consumeSiti.revision, 4);

  // Siti balance drops to 0
  const balSitiAfter = h.get('rosterv2entitlementbalances', { personId: person2 });
  assert.equal(balSitiAfter.balances.GHKA, 0);

  // 6. Reverse consumption
  const revSiti = h.post(makeConsumeReverseOp({
    periodId,
    transactionId: consumeSiti.transactionId,
    expectedRevision: 4
  }));
  assert.equal(revSiti.ok, true);
  const balSitiRestored = h.get('rosterv2entitlementbalances', { personId: person2 });
  assert.equal(balSitiRestored.balances.GHKA, 1);
});

test('Certification Scenario C: Separate balances and fail-closed cross-type consumption', () => {
  const { h, periodId } = setupPublished();

  // Give Ali GOFF = 2, GHKA = 1
  h.post(makeCreditManualOp({ periodId, personId: person1, entitlementType: 'GOFF', amount: 1, effectiveDate: '2026-05-01' }));
  h.post(makeCreditManualOp({ periodId, personId: person1, entitlementType: 'GOFF', amount: 1, effectiveDate: '2026-05-02' }));
  h.post(makeCreditManualOp({ periodId, personId: person1, entitlementType: 'GHKA', amount: 1, effectiveDate: '2026-05-01' }));

  let bal = h.get('rosterv2entitlementbalances', { personId: person1 });
  assert.equal(bal.balances.GOFF, 2);
  assert.equal(bal.balances.GHKA, 1);

  // Consume GHKA on 2026-05-03
  const c1 = h.post(makeConsumeOp({
    periodId,
    personId: person1,
    entitlementType: 'GHKA',
    date: '2026-05-03',
    expectedRevision: 1
  }));
  assert.equal(c1.ok, true);

  bal = h.get('rosterv2entitlementbalances', { personId: person1 });
  assert.equal(bal.balances.GOFF, 2);
  assert.equal(bal.balances.GHKA, 0);

  // Second GHKA attempt must fail closed despite GOFF > 0 (No pooling, no substitution)
  const failSecond = h.post(makeConsumeOp({
    periodId,
    personId: person1,
    entitlementType: 'GHKA',
    date: '2026-05-03',
    expectedRevision: 2
  }));
  assert.equal(failSecond.ok, false);
  assert.match(errorText(failSecond), /INSUFFICIENT_ENTITLEMENT_BALANCE|INSUFFICIENT_GHKA_BALANCE/);

  // Balances remain completely unchanged
  bal = h.get('rosterv2entitlementbalances', { personId: person1 });
  assert.equal(bal.balances.GOFF, 2);
  assert.equal(bal.balances.GHKA, 0);
});

test('Certification Scenario D: Cross-year carry-forward and null expiry', () => {
  const { h } = setupPublished();

  // Credit in Dec 2026
  h.post(makeCreditManualOp({ periodId: '2026-12', personId: person1, entitlementType: 'GOFF', amount: 1, effectiveDate: '2026-12-15' }));
  h.post(makeCreditManualOp({ periodId: '2026-12', personId: person1, entitlementType: 'GHKA', amount: 1, effectiveDate: '2026-12-25' }));

  // Query as of Jan 2027
  const balJan = h.get('rosterv2entitlementbalances', { personId: person1, asOfDate: '2027-01-31' });
  assert.equal(balJan.balances.GOFF, 1);
  assert.equal(balJan.balances.GHKA, 1);

  // Verify transactions carry null ExpiresAt
  const txRes = h.get('rosterv2entitlementtransactions', { personId: person1 });
  txRes.transactions.forEach(tx => {
    assert.equal(tx.ExpiresAt, '', 'Current policy: ExpiresAt must be empty/null');
  });
});

test('Certification Scenario E: Durable recovery with stable operationId and zero cell mutation', () => {
  const { h, periodId } = setupPublished();
  h.post(makeCreditManualOp({ periodId, personId: person1, entitlementType: 'GOFF', amount: 1, effectiveDate: '2026-05-01' }));

  const consumeOp = makeConsumeOp({
    periodId,
    personId: person1,
    entitlementType: 'GOFF',
    date: '2026-05-03',
    expectedRevision: 1
  });

  const consumeRes = h.post(consumeOp);
  assert.equal(consumeRes.ok, true);

  // Simulate an interrupted operation: OperationLog left in RECOVERY_REQUIRED
  const logHeaders = h.grids.OperationLog[0];
  const logRow = h.grids.OperationLog.slice(1).find(r => r[logHeaders.indexOf('OperationId')] === consumeOp.operationId);
  logRow[logHeaders.indexOf('Status')] = 'RECOVERY_REQUIRED';

  // Before recovery: balance still shows 1 because RECOVERY_REQUIRED is excluded
  let bal = h.get('rosterv2entitlementbalances', { personId: person1 });
  assert.equal(bal.balances.GOFF, 1);

  // Recover
  const recRes = h.post({
    action: 'rosterv2entitlementrecover',
    operationId: consumeOp.operationId
  });
  assert.equal(recRes.ok, true);
  assert.equal(recRes.operationId, consumeOp.operationId);

  // Exactly one transaction row exists in ledger for this operation
  const txHeaders = h.grids.RosterEntitlementTransactions[0];
  const txRows = h.grids.RosterEntitlementTransactions.slice(1).filter(r => r[txHeaders.indexOf('OperationId')] === consumeOp.operationId);
  assert.equal(txRows.length, 1);

  // Balance updated to 0
  bal = h.get('rosterv2entitlementbalances', { personId: person1 });
  assert.equal(bal.balances.GOFF, 0);
});

test('Certification Scenario F: EP excluded from entitlement domain but visible in roster', () => {
  const { h, periodId } = setupPublished();

  // EP cannot earn GOFF
  const earnGoff = h.post(makeEarnGoffOp({ periodId, personId: personEp, date: '2026-05-01' }));
  assert.equal(earnGoff.ok, false);
  assert.match(errorText(earnGoff), /EP_DOMAIN_EXCLUDED/);

  // EP cannot earn GHKA
  const earnGhka = h.post(makeEarnGhkaOp({ periodId, personId: personEp, date: '2026-05-01' }));
  assert.equal(earnGhka.ok, false);
  assert.match(errorText(earnGhka), /EP_DOMAIN_EXCLUDED/);

  // EP cannot receive manual credit
  const creditManual = h.post(makeCreditManualOp({ periodId, personId: personEp, entitlementType: 'GOFF' }));
  assert.equal(creditManual.ok, false);
  assert.match(errorText(creditManual), /EP_DOMAIN_EXCLUDED/);

  // EP cannot consume
  const consume = h.post(makeConsumeOp({ periodId, personId: personEp, entitlementType: 'GOFF', date: '2026-05-01' }));
  assert.equal(consume.ok, false);
  assert.match(errorText(consume), /EP_DOMAIN_EXCLUDED/);

  // EP balance query rejected
  const balRes = h.get('rosterv2entitlementbalances', { personId: personEp });
  assert.equal(balRes.ok, false);
  assert.match(errorText(balRes), /EP_DOMAIN_EXCLUDED/);

  // EP remains visible in Planned and Current
  const planRes = h.get('rosterv2planned', { periodId });
  const epPlan = planRes.assignments.find(a => a.personId === personEp && a.date === '2026-05-01');
  assert.ok(epPlan, 'EP must remain in Planned roster');

  const currRes = h.get('rosterv2current', { periodId });
  const epCurr = currRes.assignments.find(a => a.personId === personEp && a.date === '2026-05-01');
  assert.ok(epCurr, 'EP must remain in Current roster');
});

test('Certification Scenario G: Privacy boundary rejects non-admin balance/history browsing', () => {
  const { h, periodId } = setupPublished();

  // Ordinary viewer cannot query entitlement balances
  h.context.Session.getActiveUser = () => ({ getEmail: () => 'viewer@example.invalid' });
  const balRes = h.get('rosterv2entitlementbalances', { personId: person1 });
  assert.equal(balRes.ok, false);
  assert.match(errorText(balRes), /AUTHORIZATION_REQUIRED/);

  // Ordinary viewer cannot query individual person entitlement history
  const txRes = h.get('rosterv2entitlementtransactions', { personId: person1 });
  assert.equal(txRes.ok, false);
  assert.match(errorText(txRes), /AUTHORIZATION_REQUIRED/);

  // Ordinary viewer can view Current roster with shift badges
  const currRes = h.get('rosterv2current', { periodId });
  assert.equal(currRes.ok, true);
});

test('Certification Scenario H: Phase 6 absence conflicts fail closed', () => {
  const { h, periodId } = setupPublished();
  h.post(makeCreditManualOp({ periodId, personId: person1, entitlementType: 'GOFF', amount: 1, effectiveDate: '2026-05-01' }));

  // Create MC on 2026-05-03
  h.post(makeAbsenceOp({
    periodId,
    personId: person1,
    startDate: '2026-05-03',
    endDate: '2026-05-03',
    absenceType: 'MC',
    expectedRevision: 1
  }));

  // Attempting to consume GOFF over active MC must fail closed
  const failConsume = h.post(makeConsumeOp({
    periodId,
    personId: person1,
    entitlementType: 'GOFF',
    date: '2026-05-03',
    expectedRevision: 2
  }));
  assert.equal(failConsume.ok, false);
  assert.match(errorText(failConsume), /CONFLICT_WITH_ABSENCE|INCOMPATIBLE_OPERATIONAL_STATUS/);
});

test('Certification Scenario I: HKA and GOFF* semantic non-interference', () => {
  const { h, periodId } = setupPublished();

  // Create HKA duty shift via amendment
  h.post(makeAmendOp({
    periodId,
    personId: person1,
    date: '2026-05-02',
    shiftCode: 'HKA',
    expectedRevision: 1
  }));

  // HKA has zero balance effect
  const bal = h.get('rosterv2entitlementbalances', { personId: person1 });
  assert.equal(bal.balances.GOFF, 0);
  assert.equal(bal.balances.GHKA, 0);

  // Cannot earn GOFF from HKA
  const failEarn = h.post(makeEarnGoffOp({ periodId, personId: person1, date: '2026-05-02' }));
  assert.equal(failEarn.ok, false);
  assert.match(errorText(failEarn), /HKA_DOES_NOT_EARN_GOFF|CURRENT_SHIFT_NOT_WORK|NO_DISPLACED_OFF/);
});
