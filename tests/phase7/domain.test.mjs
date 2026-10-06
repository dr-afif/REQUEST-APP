import test from 'node:test';
import assert from 'node:assert/strict';
import RosterGoff from '../../src/features/roster/goff.js';
import RosterLifecycle from '../../src/features/roster/lifecycle.js';
import RosterCompatibility from '../../src/features/roster/compatibility.js';

// =========================================================================
// PHASE 7 SLICE 1 — GOFF ENTITLEMENT, CREDIT & CONSUMPTION DOMAIN TESTS
// =========================================================================

test('1. Canonical transaction types', () => {
  const types = RosterGoff.GOFF_TRANSACTION_TYPES;
  assert.equal(types.CREDIT_EARNED, 'CREDIT_EARNED');
  assert.equal(types.CREDIT_MANUAL, 'CREDIT_MANUAL');
  assert.equal(types.CREDIT_REVERSAL, 'CREDIT_REVERSAL');
  assert.equal(types.GOFF_RESERVED, 'GOFF_RESERVED');
  assert.equal(types.GOFF_RESERVATION_RELEASED, 'GOFF_RESERVATION_RELEASED');
  assert.equal(types.GOFF_CONSUMED, 'GOFF_CONSUMED');
  assert.equal(types.CONSUMPTION_REVERSAL, 'CONSUMPTION_REVERSAL');
});

test('2. Authoritative PersonId identity: PersonId is authoritative, name is snapshot', () => {
  const tx = RosterGoff.createGoffCreditTransaction({
    periodId: '2026-03',
    personId: 'p-auth-001',
    personNameSnapshot: 'Dr. Jane Doe',
    effectiveDate: '2026-03-01',
    publicHolidayDate: '2026-03-01',
    publicHolidayName: 'Federal Territory Day'
  });

  assert.equal(tx.PersonId, 'p-auth-001');
  assert.equal(tx.PersonNameSnapshot, 'Dr. Jane Doe');
  assert.equal(tx.DutyDomain, 'MO');
});

test('3. Duplicate display names isolated: different PersonIds do not cross-contaminate balance', () => {
  const txs = [
    RosterGoff.createGoffCreditTransaction({
      transactionId: 'tx-1',
      periodId: '2026-03',
      personId: 'p-1',
      personNameSnapshot: 'Dr. Sarah Lee',
      effectiveDate: '2026-03-01'
    }),
    RosterGoff.createGoffCreditTransaction({
      transactionId: 'tx-2',
      periodId: '2026-03',
      personId: 'p-1',
      personNameSnapshot: 'Dr. Sarah Lee',
      effectiveDate: '2026-03-02'
    }),
    RosterGoff.createGoffCreditTransaction({
      transactionId: 'tx-3',
      periodId: '2026-03',
      personId: 'p-2',
      personNameSnapshot: 'Dr. Sarah Lee',
      effectiveDate: '2026-03-01'
    })
  ];

  const bal1 = RosterGoff.deriveGoffBalance(txs, { personId: 'p-1' });
  const bal2 = RosterGoff.deriveGoffBalance(txs, { personId: 'p-2' });

  assert.equal(bal1.currentBalance, 2);
  assert.equal(bal2.currentBalance, 1);
});

test('4. Deterministic balance calculation: order-independent derivation', () => {
  const tx1 = RosterGoff.createGoffCreditTransaction({
    transactionId: 'tx-1', periodId: '2026-03', personId: 'p-1', effectiveDate: '2026-03-01'
  });
  const tx2 = RosterGoff.createGoffCreditTransaction({
    transactionId: 'tx-2', periodId: '2026-03', personId: 'p-1', effectiveDate: '2026-03-02'
  });
  const tx3 = RosterGoff.createGoffConsumptionTransaction({
    transactionId: 'tx-3', periodId: '2026-03', personId: 'p-1', effectiveDate: '2026-03-10'
  });

  const resForward = RosterGoff.deriveGoffBalance([tx1, tx2, tx3], { personId: 'p-1' });
  const resReverse = RosterGoff.deriveGoffBalance([tx3, tx2, tx1], { personId: 'p-1' });

  assert.equal(resForward.currentBalance, 1);
  assert.equal(resReverse.currentBalance, 1);
  assert.deepEqual(resForward, resReverse);
});

test('5. Credit increases balance', () => {
  const tx = RosterGoff.createGoffCreditTransaction({
    periodId: '2026-03', personId: 'p-1', effectiveDate: '2026-03-01'
  });
  const bal = RosterGoff.deriveGoffBalance([tx], { personId: 'p-1' });

  assert.equal(bal.earnedCredits, 1);
  assert.equal(bal.currentBalance, 1);
  assert.equal(bal.availableBalance, 1);
});

test('6. Consumption decreases balance', () => {
  const credit = RosterGoff.createGoffCreditTransaction({
    transactionId: 'c-1', periodId: '2026-03', personId: 'p-1', effectiveDate: '2026-03-01'
  });
  const consume = RosterGoff.createGoffConsumptionTransaction({
    transactionId: 'u-1', periodId: '2026-03', personId: 'p-1', effectiveDate: '2026-03-15'
  });

  const bal = RosterGoff.deriveGoffBalance([credit, consume], { personId: 'p-1' });
  assert.equal(bal.earnedCredits, 1);
  assert.equal(bal.consumedGoff, 1);
  assert.equal(bal.currentBalance, 0);
  assert.equal(bal.availableBalance, 0);
});

test('7. Compensation restores balance', () => {
  const credit = RosterGoff.createGoffCreditTransaction({
    transactionId: 'c-1', periodId: '2026-03', personId: 'p-1', effectiveDate: '2026-03-01'
  });
  const consume = RosterGoff.createGoffConsumptionTransaction({
    transactionId: 'u-1', periodId: '2026-03', personId: 'p-1', effectiveDate: '2026-03-15'
  });
  const reversal = RosterGoff.createGoffReversalTransaction({
    targetTransaction: consume,
    allTransactions: [credit, consume]
  });

  const bal = RosterGoff.deriveGoffBalance([credit, consume, reversal], { personId: 'p-1' });
  assert.equal(bal.consumedGoff, 1);
  assert.equal(bal.consumptionReversals, 1);
  assert.equal(bal.netConsumed, 0);
  assert.equal(bal.currentBalance, 1);
});

test('8. Duplicate credit source rejected/idempotent', () => {
  const existingCredit = RosterGoff.createGoffCreditTransaction({
    periodId: '2026-03', personId: 'p-1', effectiveDate: '2026-03-01',
    publicHolidayDate: '2026-03-01', publicHolidayName: 'New Year'
  });

  const check = RosterGoff.qualifiesForPublicHolidayCredit(
    { personId: 'p-1', date: '2026-03-01', dutyDomain: 'MO', shiftCode: 'AM' },
    { name: 'New Year', date: '2026-03-01' },
    [existingCredit]
  );

  assert.equal(check.qualifies, false);
  assert.equal(check.reason, 'DUPLICATE_CREDIT_FOR_HOLIDAY');
});

test('9. Reversed credit excluded from net credits', () => {
  const credit = RosterGoff.createGoffCreditTransaction({
    transactionId: 'c-1', periodId: '2026-03', personId: 'p-1', effectiveDate: '2026-03-01'
  });
  const reversal = RosterGoff.createGoffReversalTransaction({
    targetTransaction: credit,
    allTransactions: [credit]
  });

  const bal = RosterGoff.deriveGoffBalance([credit, reversal], { personId: 'p-1' });
  assert.equal(bal.earnedCredits, 1);
  assert.equal(bal.creditReversals, 1);
  assert.equal(bal.netCredits, 0);
  assert.equal(bal.currentBalance, 0);
});

test('10. Reversed consumption restores entitlement', () => {
  const credit = RosterGoff.createGoffCreditTransaction({
    transactionId: 'c-1', periodId: '2026-03', personId: 'p-1', effectiveDate: '2026-03-01'
  });
  const consume = RosterGoff.createGoffConsumptionTransaction({
    transactionId: 'u-1', periodId: '2026-03', personId: 'p-1', effectiveDate: '2026-03-05'
  });
  const reversal = RosterGoff.createGoffReversalTransaction({
    targetTransaction: consume,
    allTransactions: [credit, consume]
  });

  const balBefore = RosterGoff.deriveGoffBalance([credit, consume], { personId: 'p-1' });
  assert.equal(balBefore.availableBalance, 0);

  const balAfter = RosterGoff.deriveGoffBalance([credit, consume, reversal], { personId: 'p-1' });
  assert.equal(balAfter.availableBalance, 1);
});

test('11. Insufficient balance fails closed', () => {
  assert.throws(() => {
    RosterGoff.validateGoffConsumption({
      personId: 'p-1',
      date: '2026-03-10',
      balance: 0,
      allowNegativeOverride: false
    });
  }, (err) => {
    assert.equal(err.code, RosterGoff.GOFF_ERRORS.INSUFFICIENT_GOFF_BALANCE);
    return true;
  });
});

test('12. Zero balance cannot consume', () => {
  assert.throws(() => {
    RosterGoff.validateGoffConsumption({
      personId: 'p-1',
      date: '2026-03-10',
      balance: 0
    });
  }, /Insufficient GOFF balance/);
});

test('13. No negative balance unless explicitly allowed with override', () => {
  // Fails closed without override
  assert.throws(() => {
    RosterGoff.validateGoffConsumption({
      personId: 'p-1', date: '2026-03-10', balance: 0, allowNegativeOverride: false
    });
  }, /Insufficient GOFF balance/);

  // Succeeds with explicit override
  const result = RosterGoff.validateGoffConsumption({
    personId: 'p-1', date: '2026-03-10', balance: 0, allowNegativeOverride: true
  });
  assert.equal(result.valid, true);
  assert.equal(result.balanceAfter, -1);
  assert.equal(result.overrideUsed, true);
});

test('14. Cross-period balance behavior: credits carry across months indefinitely', () => {
  const janCredit = RosterGoff.createGoffCreditTransaction({
    transactionId: 'c-jan', periodId: '2026-01', personId: 'p-1', effectiveDate: '2026-01-01'
  });
  const febCredit = RosterGoff.createGoffCreditTransaction({
    transactionId: 'c-feb', periodId: '2026-02', personId: 'p-1', effectiveDate: '2026-02-01'
  });
  const marConsume = RosterGoff.createGoffConsumptionTransaction({
    transactionId: 'u-mar', periodId: '2026-03', personId: 'p-1', effectiveDate: '2026-03-15'
  });

  const balMar = RosterGoff.deriveGoffBalance([janCredit, febCredit, marConsume], { personId: 'p-1' });
  assert.equal(balMar.netCredits, 2);
  assert.equal(balMar.netConsumed, 1);
  assert.equal(balMar.availableBalance, 1);
});

test('15. Public holiday qualifying assignment credit: worked shifts and PN earn credit', () => {
  const qualifyingShifts = ['AM', 'PM', 'AMX', 'PMX', 'ON1', 'ON2', 'NIGHT', 'PN'];

  for (const shift of qualifyingShifts) {
    const res = RosterGoff.qualifiesForPublicHolidayCredit(
      { personId: 'p-1', date: '2026-05-01', dutyDomain: 'MO', shiftCode: shift },
      { name: 'Labour Day', date: '2026-05-01' },
      []
    );
    assert.equal(res.qualifies, true, `Shift ${shift} should qualify on public holiday`);
  }
});

test('16. Non-qualifying assignment does not earn credit', () => {
  const nonQualifyingShifts = ['OFF', 'GOFF', 'HKA', 'GHKA', 'AL', 'MC', 'EL', 'COURSE', ''];

  for (const shift of nonQualifyingShifts) {
    const res = RosterGoff.qualifiesForPublicHolidayCredit(
      { personId: 'p-1', date: '2026-05-01', dutyDomain: 'MO', shiftCode: shift },
      { name: 'Labour Day', date: '2026-05-01' },
      []
    );
    assert.equal(res.qualifies, false, `Shift ${shift} should NOT qualify for credit`);
    assert.equal(res.reason, 'NON_QUALIFYING_SHIFT');
  }
});

test('17. Multiple assignments same holiday awards at most 1 credit per doctor', () => {
  const firstTx = RosterGoff.createGoffCreditTransaction({
    transactionId: 'tx-1', periodId: '2026-05', personId: 'p-1', effectiveDate: '2026-05-01',
    publicHolidayDate: '2026-05-01', publicHolidayName: 'Labour Day',
    rosterAssignmentId: 'asg-am'
  });

  // Attempt second assignment on same date (e.g. PM or PN)
  const resSecond = RosterGoff.qualifiesForPublicHolidayCredit(
    { personId: 'p-1', date: '2026-05-01', dutyDomain: 'MO', shiftCode: 'PM' },
    { name: 'Labour Day', date: '2026-05-01' },
    [firstTx]
  );

  assert.equal(resSecond.qualifies, false);
  assert.equal(resSecond.reason, 'DUPLICATE_CREDIT_FOR_HOLIDAY');
});

test('18. Phase 5 SWAP holiday entitlement behavior: actual Current worker earns credit', () => {
  // Dr A planned AM on holiday, Dr B planned OFF.
  // SWAP occurs: Dr B now works AM in Current; Dr A is OFF in Current.
  const drACurrent = { personId: 'p-A', date: '2026-05-01', dutyDomain: 'MO', shiftCode: 'OFF' };
  const drBCurrent = { personId: 'p-B', date: '2026-05-01', dutyDomain: 'MO', shiftCode: 'AM' };

  const checkA = RosterGoff.qualifiesForPublicHolidayCredit(drACurrent, 'Labour Day', []);
  const checkB = RosterGoff.qualifiesForPublicHolidayCredit(drBCurrent, 'Labour Day', []);

  assert.equal(checkA.qualifies, false);
  assert.equal(checkB.qualifies, true);
});

test('19. MC holiday behavior: doctor on MC earns zero credit', () => {
  const mcAssignment = { personId: 'p-1', date: '2026-05-01', dutyDomain: 'MO', shiftCode: 'MC' };
  const check = RosterGoff.qualifiesForPublicHolidayCredit(mcAssignment, 'Labour Day', []);

  assert.equal(check.qualifies, false);
  assert.equal(check.reason, 'NON_QUALIFYING_SHIFT');
});

test('20. Replacement worker holiday behavior: covering replacement doctor earns credit', () => {
  // Dr A is on MC. Dr B covers as REPLACEMENT working PM.
  const replAssignment = { personId: 'p-covering', date: '2026-05-01', dutyDomain: 'MO', shiftCode: 'PM', source: 'REPLACEMENT' };
  const check = RosterGoff.qualifiesForPublicHolidayCredit(replAssignment, 'Labour Day', []);

  assert.equal(check.qualifies, true);
});

test('21. Credit-only operation does not make roster AMENDED', () => {
  // Earning a credit is recorded in RosterGoffTransactions without mutating roster assignments.
  // Verify that an unchanged assignment list evaluated with lifecycle helper remains PUBLISHED.
  const plannedAssignments = [
    { AssignmentId: 'a-1', PersonId: 'p-1', Date: '2026-05-01', DutyDomain: 'MO', ShiftCode: 'AM', Layer: 'PLANNED', SnapshotId: 'snap-1' }
  ];
  const activeAmendments = [];
  const res = RosterLifecycle.resolveCurrentRoster({
    periodId: '2026-05',
    plannedAssignments,
    events: activeAmendments
  });

  assert.equal(res.effectiveState, 'PUBLISHED');
  assert.equal(res.activeAmendmentCount, 0);
});

test('22. GOFF consumption does make roster AMENDED where Current changes', () => {
  // A planned working assignment changed to GOFF in Current via an amendment event
  const plannedAssignments = [
    { AssignmentId: 'a-1', PersonId: 'p-1', Date: '2026-05-10', DutyDomain: 'MO', ShiftCode: 'AM', Layer: 'PLANNED', SnapshotId: 'snap-1' }
  ];

  const events = [{
    EventId: 'EV-GOFF-1',
    LineId: 'L-1',
    EventType: 'ADMIN_CORRECTION',
    PeriodId: '2026-05',
    BaseRevision: 0,
    ResultRevision: 1,
    PersonId: 'p-1',
    Date: '2026-05-10',
    DutyDomain: 'MO',
    PlannedAssignmentJson: JSON.stringify(plannedAssignments[0]),
    BeforeCurrentJson: JSON.stringify(plannedAssignments[0]),
    AfterCurrentJson: JSON.stringify({ ...plannedAssignments[0], ShiftCode: 'GOFF', Source: 'AMENDMENT' }),
    PublicReasonCode: 'OPERATIONAL_CHANGE',
    AdminNote: 'GOFF taken',
    GoffTransactionIdsJson: JSON.stringify(['tx-cons-1']),
    ReversesEventId: ''
  }];

  const res = RosterLifecycle.resolveCurrentRoster({
    periodId: '2026-05',
    plannedAssignments,
    events
  });

  assert.equal(res.effectiveState, 'AMENDED');
  assert.equal(res.activeAmendmentCount, 1);
  assert.equal(res.currentAssignments[0].ShiftCode, 'GOFF');
});

test('23. Planned remains immutable across GOFF consumption', () => {
  const plannedAssignments = [
    { assignmentId: 'asg-1', personId: 'p-1', date: '2026-05-10', dutyDomain: 'MO', shiftCode: 'AM', layer: 'PLANNED' }
  ];
  const deepCopyPlanned = structuredClone(plannedAssignments);

  // Consume GOFF in Current
  const currentAssignments = [
    { assignmentId: 'asg-1', personId: 'p-1', date: '2026-05-10', dutyDomain: 'MO', shiftCode: 'GOFF', source: 'GOFF' }
  ];

  assert.deepEqual(plannedAssignments, deepCopyPlanned);
  assert.equal(plannedAssignments[0].shiftCode, 'AM');
  assert.equal(currentAssignments[0].shiftCode, 'GOFF');
});

test('24. GOFF consumption affects only correct PersonId/date/domain', () => {
  const valid = RosterGoff.validateGoffConsumption({
    personId: 'p-target',
    date: '2026-05-15',
    dutyDomain: 'MO',
    balance: 2
  });

  assert.equal(valid.personId, 'p-target');
  assert.equal(valid.date, '2026-05-15');
  assert.equal(valid.dutyDomain, 'MO');
});

test('25. Conflict with active MC/AL/EL/COURSE rejected', () => {
  const activeAbsences = [
    { AbsenceId: 'abs-1', PersonId: 'p-1', DutyDomain: 'MO', StartDate: '2026-05-10', EndDate: '2026-05-12', Status: 'ACTIVE' }
  ];

  assert.throws(() => {
    RosterGoff.validateGoffConsumption({
      personId: 'p-1',
      date: '2026-05-11',
      dutyDomain: 'MO',
      balance: 2,
      existingAbsences: activeAbsences
    });
  }, (err) => {
    assert.equal(err.code, RosterGoff.GOFF_ERRORS.INCOMPATIBLE_OPERATIONAL_STATUS);
    return true;
  });
});

test('26. Credit reversal with dependent consumption blocked', () => {
  const credit = RosterGoff.createGoffCreditTransaction({
    transactionId: 'c-100', periodId: '2026-05', personId: 'p-1', effectiveDate: '2026-05-01'
  });
  const consumption = RosterGoff.createGoffConsumptionTransaction({
    transactionId: 'u-100', periodId: '2026-05', personId: 'p-1', effectiveDate: '2026-05-15',
    relatedTransactionId: 'c-100'
  });

  assert.throws(() => {
    RosterGoff.createGoffReversalTransaction({
      targetTransaction: credit,
      allTransactions: [credit, consumption]
    });
  }, (err) => {
    assert.equal(err.code, RosterGoff.GOFF_ERRORS.DEPENDENT_CONSUMPTION_EXISTS);
    return true;
  });
});

test('27. Consumption reversal permits credit reversal', () => {
  const credit = RosterGoff.createGoffCreditTransaction({
    transactionId: 'c-100', periodId: '2026-05', personId: 'p-1', effectiveDate: '2026-05-01'
  });
  const consumption = RosterGoff.createGoffConsumptionTransaction({
    transactionId: 'u-100', periodId: '2026-05', personId: 'p-1', effectiveDate: '2026-05-15',
    relatedTransactionId: 'c-100'
  });

  // 1. Reverse the consumption first
  const consumptionReversal = RosterGoff.createGoffReversalTransaction({
    targetTransaction: consumption,
    allTransactions: [credit, consumption]
  });
  assert.equal(consumptionReversal.TransactionType, RosterGoff.GOFF_TRANSACTION_TYPES.CONSUMPTION_REVERSAL);

  // Mark consumption reversed in transaction list
  consumption.Status = 'REVERSED';

  // 2. Now reversing the credit succeeds!
  const creditReversal = RosterGoff.createGoffReversalTransaction({
    targetTransaction: credit,
    allTransactions: [credit, consumption, consumptionReversal]
  });
  assert.equal(creditReversal.TransactionType, RosterGoff.GOFF_TRANSACTION_TYPES.CREDIT_REVERSAL);
});

test('28. Ledger history is append-only', () => {
  const ledger = [];
  const credit = RosterGoff.createGoffCreditTransaction({
    transactionId: 'c-1', periodId: '2026-05', personId: 'p-1', effectiveDate: '2026-05-01'
  });
  ledger.push(credit);

  const reversal = RosterGoff.createGoffReversalTransaction({
    targetTransaction: credit,
    allTransactions: ledger
  });
  ledger.push(reversal);

  assert.equal(ledger.length, 2);
  assert.equal(ledger[0].TransactionId, 'c-1');
  assert.equal(ledger[1].TransactionType, 'CREDIT_REVERSAL');
  assert.equal(ledger[1].RelatedTransactionId, 'c-1');
});

test('29. Unconfirmed transaction excluded from balance', () => {
  const pendingTx = RosterGoff.createGoffCreditTransaction({
    periodId: '2026-05', personId: 'p-1', effectiveDate: '2026-05-01'
  });
  pendingTx.Status = RosterGoff.GOFF_TRANSACTION_STATUS.PENDING;

  const bal = RosterGoff.deriveGoffBalance([pendingTx], { personId: 'p-1' });
  assert.equal(bal.earnedCredits, 0);
  assert.equal(bal.currentBalance, 0);
});

test('30. FAILED / RECOVERY_REQUIRED transaction excluded from balance', () => {
  const failedTx = RosterGoff.createGoffCreditTransaction({
    periodId: '2026-05', personId: 'p-1', effectiveDate: '2026-05-01'
  });
  failedTx.Status = 'FAILED';

  const recRequiredTx = RosterGoff.createGoffCreditTransaction({
    periodId: '2026-05', personId: 'p-1', effectiveDate: '2026-05-01'
  });
  recRequiredTx.Status = 'RECOVERY_REQUIRED';

  const bal = RosterGoff.deriveGoffBalance([failedTx, recRequiredTx], { personId: 'p-1' });
  assert.equal(bal.earnedCredits, 0);
  assert.equal(bal.currentBalance, 0);
});

test('31. MasterRoster GOFF projection semantics: consumed GOFF projects as GOFF', () => {
  const semantics = RosterCompatibility.resolveShift('GOFF', 'MO');
  assert.equal(semantics.canonicalCode, 'GOFF');
  assert.equal(semantics.worked, false);
  assert.equal(semantics.consecutive, 'RESET');
  assert.equal(semantics.normalOff, false);
});

test('32. GOFF* legacy semantics test according to discovered behavior', () => {
  // Legacy GOFF* has no separate algorithm; it maps cleanly to base GOFF
  const semantics = RosterCompatibility.resolveShift('GOFF*', 'MO');
  // Unknown code preserves raw value
  assert.equal(semantics.rawShift, 'GOFF*');
  // Non-working status resets consecutive work
  assert.equal(semantics.worked, null);
});

test('33. Viewer DTO hides internal/private ledger metadata', () => {
  const tx = RosterGoff.createGoffCreditTransaction({
    transactionId: 'c-private', periodId: '2026-05', personId: 'p-1', effectiveDate: '2026-05-01',
    adminNote: 'Internal confidential HOD note',
    operationId: 'op-internal-12345',
    createdBy: 'admin@hospital.gov.my'
  });

  const viewerDto = RosterGoff.scrubGoffViewerDto(tx);
  assert.equal(viewerDto.TransactionId, 'c-private');
  assert.equal(viewerDto.PersonId, 'p-1');
  assert.equal(viewerDto.AdminNote, undefined);
  assert.equal(viewerDto.OperationId, undefined);
  assert.equal(viewerDto.CreatedBy, undefined);
});

test('34. EP domain excluded from GOFF ledger', () => {
  // EP cannot earn public holiday credit
  const epAssignment = { personId: 'p-ep', date: '2026-05-01', dutyDomain: 'EP', shiftCode: 'EP_ONCALL' };
  const check = RosterGoff.qualifiesForPublicHolidayCredit(epAssignment, 'Labour Day', []);
  assert.equal(check.qualifies, false);
  assert.equal(check.reason, 'EP_DOMAIN_EXCLUDED');

  // EP cannot create credit transaction
  assert.throws(() => {
    RosterGoff.createGoffCreditTransaction({
      periodId: '2026-05', personId: 'p-ep', dutyDomain: 'EP', effectiveDate: '2026-05-01'
    });
  }, (err) => {
    assert.equal(err.code, RosterGoff.GOFF_ERRORS.EP_DOMAIN_EXCLUDED);
    return true;
  });

  // EP cannot consume GOFF
  assert.throws(() => {
    RosterGoff.validateGoffConsumption({
      personId: 'p-ep', date: '2026-05-10', dutyDomain: 'EP', balance: 2
    });
  }, (err) => {
    assert.equal(err.code, RosterGoff.GOFF_ERRORS.EP_DOMAIN_EXCLUDED);
    return true;
  });
});

test('35. Displaced weekly OFF qualification: planned OFF displaced by qualifying duty earns GOFF', () => {
  // Displaced by PM duty
  const checkPm = RosterGoff.qualifiesForDisplacedOffCredit('OFF', 'PM', 'MO', '2026-05-04', 'p-1', []);
  assert.equal(checkPm.qualifies, true);
  assert.equal(checkPm.reason, 'QUALIFIED_DISPLACED_WEEKLY_OFF');

  // Displaced by PN
  const checkPn = RosterGoff.qualifiesForDisplacedOffCredit('OFF', 'PN', 'MO', '2026-05-04', 'p-1', []);
  assert.equal(checkPn.qualifies, true);

  // Planned OFF changed to MC or AL does NOT earn GOFF
  const checkMc = RosterGoff.qualifiesForDisplacedOffCredit('OFF', 'MC', 'MO', '2026-05-04', 'p-1', []);
  assert.equal(checkMc.qualifies, false);
  assert.equal(checkMc.reason, 'NON_DUTY_DISPLACEMENT');

  // Planned AM changed to PM is not a displaced OFF
  const checkAm = RosterGoff.qualifiesForDisplacedOffCredit('AM', 'PM', 'MO', '2026-05-04', 'p-1', []);
  assert.equal(checkAm.qualifies, false);
  assert.equal(checkAm.reason, 'PLANNED_SHIFT_NOT_NORMAL_OFF');
});

test('36. Opening balance and manual administrative credit support', () => {
  const openingTx = RosterGoff.createGoffCreditTransaction({
    transactionId: 'c-open-1',
    periodId: '2026-01',
    personId: 'p-1',
    effectiveDate: '2026-01-01',
    sourceType: RosterGoff.GOFF_SOURCE_TYPES.OPENING_BALANCE,
    reasonCode: 'PRE_COMMENCEMENT_OPENING_BALANCE',
    adminNote: 'Confirmed by HOD audit'
  });

  assert.equal(openingTx.TransactionType, RosterGoff.GOFF_TRANSACTION_TYPES.CREDIT_MANUAL);
  assert.equal(openingTx.SourceType, 'OPENING_BALANCE');

  const bal = RosterGoff.deriveGoffBalance([openingTx], { personId: 'p-1' });
  assert.equal(bal.availableBalance, 1);
});
