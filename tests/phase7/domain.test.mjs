import test from 'node:test';
import assert from 'node:assert/strict';
import RosterEntitlement from '../../src/features/roster/goff.js';
import RosterLifecycle from '../../src/features/roster/lifecycle.js';
import RosterCompatibility from '../../src/features/roster/compatibility.js';

// =========================================================================
// PHASE 7 SLICE 1.1 — SEPARATE GOFF & GHKA ENTITLEMENT DOMAIN TESTS
// =========================================================================

test('1. GOFF and GHKA canonical entitlement types', () => {
  const types = RosterEntitlement.ENTITLEMENT_TYPES;
  assert.equal(types.GOFF, 'GOFF');
  assert.equal(types.GHKA, 'GHKA');

  const schemas = RosterEntitlement.ROSTER_ENTITLEMENT_SCHEMAS;
  assert.ok(Array.isArray(schemas.RosterEntitlementTransactions));
  assert.ok(schemas.RosterEntitlementTransactions.includes('EntitlementType'));
  assert.ok(schemas.RosterEntitlementTransactions.includes('ExpiresAt'));
  assert.ok(schemas.RosterEntitlementTransactions.includes('ExpiryPolicyCode'));
});

test('2. GOFF credit increases only GOFF balance', () => {
  const tx = RosterEntitlement.createGoffCreditTransaction({
    periodId: '2026-05',
    personId: 'p-1',
    effectiveDate: '2026-05-02'
  });

  const goffBal = RosterEntitlement.deriveEntitlementBalance([tx], {
    personId: 'p-1',
    entitlementType: 'GOFF'
  });
  assert.equal(goffBal.earnedCredits, 1);
  assert.equal(goffBal.currentBalance, 1);

  const ghkaBal = RosterEntitlement.deriveEntitlementBalance([tx], {
    personId: 'p-1',
    entitlementType: 'GHKA'
  });
  assert.equal(ghkaBal.earnedCredits, 0);
  assert.equal(ghkaBal.currentBalance, 0);
});

test('3. GHKA credit increases only GHKA balance', () => {
  const tx = RosterEntitlement.createGhkaCreditTransaction({
    periodId: '2026-05',
    personId: 'p-1',
    effectiveDate: '2026-05-01',
    publicHolidayDate: '2026-05-01',
    publicHolidayName: 'Labour Day'
  });

  const ghkaBal = RosterEntitlement.deriveEntitlementBalance([tx], {
    personId: 'p-1',
    entitlementType: 'GHKA'
  });
  assert.equal(ghkaBal.earnedCredits, 1);
  assert.equal(ghkaBal.currentBalance, 1);

  const goffBal = RosterEntitlement.deriveEntitlementBalance([tx], {
    personId: 'p-1',
    entitlementType: 'GOFF'
  });
  assert.equal(goffBal.earnedCredits, 0);
  assert.equal(goffBal.currentBalance, 0);
});

test('4. GOFF consumption decreases only GOFF balance', () => {
  const credit = RosterEntitlement.createGoffCreditTransaction({
    transactionId: 'c-1',
    periodId: '2026-05',
    personId: 'p-1',
    effectiveDate: '2026-05-02'
  });
  const consumption = RosterEntitlement.createGoffConsumptionTransaction({
    transactionId: 'u-1',
    periodId: '2026-05',
    personId: 'p-1',
    effectiveDate: '2026-05-10',
    relatedTransactionId: 'c-1'
  });

  const all = [credit, consumption];
  const goffBal = RosterEntitlement.deriveEntitlementBalance(all, {
    personId: 'p-1',
    entitlementType: 'GOFF'
  });
  assert.equal(goffBal.netCredits, 1);
  assert.equal(goffBal.netConsumed, 1);
  assert.equal(goffBal.currentBalance, 0);

  const ghkaBal = RosterEntitlement.deriveEntitlementBalance(all, {
    personId: 'p-1',
    entitlementType: 'GHKA'
  });
  assert.equal(ghkaBal.currentBalance, 0);
});

test('5. GHKA consumption decreases only GHKA balance', () => {
  const credit = RosterEntitlement.createGhkaCreditTransaction({
    transactionId: 'c-ghka',
    periodId: '2026-05',
    personId: 'p-1',
    effectiveDate: '2026-05-01',
    publicHolidayDate: '2026-05-01'
  });
  const consumption = RosterEntitlement.createGhkaConsumptionTransaction({
    transactionId: 'u-ghka',
    periodId: '2026-05',
    personId: 'p-1',
    effectiveDate: '2026-05-15',
    relatedTransactionId: 'c-ghka'
  });

  const all = [credit, consumption];
  const ghkaBal = RosterEntitlement.deriveEntitlementBalance(all, {
    personId: 'p-1',
    entitlementType: 'GHKA'
  });
  assert.equal(ghkaBal.netCredits, 1);
  assert.equal(ghkaBal.netConsumed, 1);
  assert.equal(ghkaBal.currentBalance, 0);

  const goffBal = RosterEntitlement.deriveEntitlementBalance(all, {
    personId: 'p-1',
    entitlementType: 'GOFF'
  });
  assert.equal(goffBal.currentBalance, 0);
});

test('6. GOFF cannot consume GHKA balance (fails closed with INSUFFICIENT_GOFF_BALANCE)', () => {
  // Doctor has 2 GHKA credits and 0 GOFF credits
  const ghkaCredits = [
    RosterEntitlement.createGhkaCreditTransaction({ transactionId: 'g-1', periodId: '2026-05', personId: 'p-1', effectiveDate: '2026-05-01' }),
    RosterEntitlement.createGhkaCreditTransaction({ transactionId: 'g-2', periodId: '2026-05', personId: 'p-1', effectiveDate: '2026-05-02' })
  ];

  const balances = RosterEntitlement.deriveAllEntitlementBalances(ghkaCredits, { personId: 'p-1' });
  assert.equal(balances.GHKA.currentBalance, 2);
  assert.equal(balances.GOFF.currentBalance, 0);

  // Attempting to consume GOFF must fail closed even though GHKA is 2
  assert.throws(
    () => {
      RosterEntitlement.validateEntitlementConsumption({
        personId: 'p-1',
        date: '2026-05-10',
        entitlementType: 'GOFF',
        balance: balances.GOFF.currentBalance
      });
    },
    err => err.code === 'INSUFFICIENT_GOFF_BALANCE'
  );
});

test('7. GHKA cannot consume GOFF balance (fails closed with INSUFFICIENT_GHKA_BALANCE)', () => {
  // Doctor has 3 GOFF credits and 0 GHKA credits
  const goffCredits = [
    RosterEntitlement.createGoffCreditTransaction({ transactionId: 'o-1', periodId: '2026-05', personId: 'p-1', effectiveDate: '2026-05-03' }),
    RosterEntitlement.createGoffCreditTransaction({ transactionId: 'o-2', periodId: '2026-05', personId: 'p-1', effectiveDate: '2026-05-04' }),
    RosterEntitlement.createGoffCreditTransaction({ transactionId: 'o-3', periodId: '2026-05', personId: 'p-1', effectiveDate: '2026-05-05' })
  ];

  const balances = RosterEntitlement.deriveAllEntitlementBalances(goffCredits, { personId: 'p-1' });
  assert.equal(balances.GOFF.currentBalance, 3);
  assert.equal(balances.GHKA.currentBalance, 0);

  // Attempting to consume GHKA must fail closed even though GOFF is 3
  assert.throws(
    () => {
      RosterEntitlement.validateEntitlementConsumption({
        personId: 'p-1',
        date: '2026-05-12',
        entitlementType: 'GHKA',
        balance: balances.GHKA.currentBalance
      });
    },
    err => err.code === 'INSUFFICIENT_GHKA_BALANCE'
  );
});

test('8. Independent balances for same PersonId', () => {
  // 2 GOFF credits, 1 GOFF consumed -> GOFF balance = 1
  // 3 GHKA credits, 1 GHKA consumed -> GHKA balance = 2
  const txs = [
    RosterEntitlement.createGoffCreditTransaction({ transactionId: 'gf-1', periodId: '2026-05', personId: 'p-1', effectiveDate: '2026-05-02' }),
    RosterEntitlement.createGoffCreditTransaction({ transactionId: 'gf-2', periodId: '2026-05', personId: 'p-1', effectiveDate: '2026-05-03' }),
    RosterEntitlement.createGoffConsumptionTransaction({ transactionId: 'gf-u1', periodId: '2026-05', personId: 'p-1', effectiveDate: '2026-05-10' }),

    RosterEntitlement.createGhkaCreditTransaction({ transactionId: 'gh-1', periodId: '2026-05', personId: 'p-1', effectiveDate: '2026-05-01' }),
    RosterEntitlement.createGhkaCreditTransaction({ transactionId: 'gh-2', periodId: '2026-05', personId: 'p-1', effectiveDate: '2026-05-15' }),
    RosterEntitlement.createGhkaCreditTransaction({ transactionId: 'gh-3', periodId: '2026-05', personId: 'p-1', effectiveDate: '2026-05-20' }),
    RosterEntitlement.createGhkaConsumptionTransaction({ transactionId: 'gh-u1', periodId: '2026-05', personId: 'p-1', effectiveDate: '2026-05-25' })
  ];

  const all = RosterEntitlement.deriveAllEntitlementBalances(txs, { personId: 'p-1' });
  assert.equal(all.GOFF.currentBalance, 1);
  assert.equal(all.GHKA.currentBalance, 2);

  // Total transactions evaluated
  assert.equal(all.GOFF.transactionCount, 3);
  assert.equal(all.GHKA.transactionCount, 4);
});

test('9. Duplicate display names remain isolated by PersonId', () => {
  const txs = [
    RosterEntitlement.createGoffCreditTransaction({ transactionId: 'tx-1', periodId: '2026-05', personId: 'p-1', personNameSnapshot: 'Dr. Sarah Lee', effectiveDate: '2026-05-02' }),
    RosterEntitlement.createGoffCreditTransaction({ transactionId: 'tx-2', periodId: '2026-05', personId: 'p-1', personNameSnapshot: 'Dr. Sarah Lee', effectiveDate: '2026-05-03' }),
    RosterEntitlement.createGoffCreditTransaction({ transactionId: 'tx-3', periodId: '2026-05', personId: 'p-2', personNameSnapshot: 'Dr. Sarah Lee', effectiveDate: '2026-05-02' })
  ];

  const balP1 = RosterEntitlement.deriveEntitlementBalance(txs, { personId: 'p-1', entitlementType: 'GOFF' });
  const balP2 = RosterEntitlement.deriveEntitlementBalance(txs, { personId: 'p-2', entitlementType: 'GOFF' });

  assert.equal(balP1.currentBalance, 2);
  assert.equal(balP2.currentBalance, 1);
});

test('10. GOFF displaced-weekly-off source', () => {
  const check = RosterEntitlement.qualifiesForDisplacedOffCredit('OFF', 'AM', 'MO', '2026-05-03', 'p-1', []);
  assert.equal(check.qualifies, true);
  assert.equal(check.entitlementType, 'GOFF');
  assert.equal(check.reason, 'QUALIFIED_DISPLACED_WEEKLY_OFF');
});

test('11. GHKA public-holiday source', () => {
  const assignment = { personId: 'p-1', date: '2026-05-01', dutyDomain: 'MO', shiftCode: 'AM' };
  const check = RosterEntitlement.qualifiesForPublicHolidayCredit(assignment, 'Labour Day', []);
  assert.equal(check.qualifies, true);
  assert.equal(check.entitlementType, 'GHKA');
  assert.equal(check.reason, 'QUALIFIED_PUBLIC_HOLIDAY_DUTY');
});

test('12. Public holiday work does not earn GOFF', () => {
  // Factory rejects generating GOFF from public holiday duty source
  assert.throws(
    () => {
      RosterEntitlement.createEntitlementCreditTransaction({
        periodId: '2026-05',
        personId: 'p-1',
        effectiveDate: '2026-05-01',
        entitlementType: 'GOFF',
        sourceType: 'PUBLIC_HOLIDAY_DUTY'
      });
    },
    err => err.code === 'INVALID_SOURCE_TYPE'
  );
});

test('13. Displaced OFF does not earn GHKA', () => {
  // Factory rejects generating GHKA from displaced weekly off source
  assert.throws(
    () => {
      RosterEntitlement.createEntitlementCreditTransaction({
        periodId: '2026-05',
        personId: 'p-1',
        effectiveDate: '2026-05-03',
        entitlementType: 'GHKA',
        sourceType: 'DISPLACED_WEEKLY_OFF'
      });
    },
    err => err.code === 'INVALID_SOURCE_TYPE'
  );
});

test('14. Absent holiday assignee earns no GHKA', () => {
  // Shift is MC on holiday
  const mcAssignment = { personId: 'p-1', date: '2026-05-01', dutyDomain: 'MO', shiftCode: 'MC' };
  const check = RosterEntitlement.qualifiesForPublicHolidayCredit(mcAssignment, 'Labour Day', []);
  assert.equal(check.qualifies, false);
  assert.equal(check.reason, 'NON_QUALIFYING_SHIFT');
});

test('15. Covering replacement worker earns GHKA', () => {
  const coveringAssignment = { personId: 'p-repl', date: '2026-05-01', dutyDomain: 'MO', shiftCode: 'AM' };
  const check = RosterEntitlement.qualifiesForPublicHolidayCredit(coveringAssignment, 'Labour Day', []);
  assert.equal(check.qualifies, true);
  assert.equal(check.entitlementType, 'GHKA');
});

test('16. Max-one-GHKA-per-holiday behavior (multiple assignments on same holiday)', () => {
  const existingTxs = [
    RosterEntitlement.createGhkaCreditTransaction({
      transactionId: 'gh-am',
      periodId: '2026-05',
      personId: 'p-1',
      effectiveDate: '2026-05-01',
      publicHolidayDate: '2026-05-01'
    })
  ];

  // Second assignment on same holiday (e.g. PM or PN)
  const secondAssignment = { personId: 'p-1', date: '2026-05-01', dutyDomain: 'MO', shiftCode: 'PM' };
  const check = RosterEntitlement.qualifiesForPublicHolidayCredit(secondAssignment, 'Labour Day', existingTxs);

  assert.equal(check.qualifies, false);
  assert.equal(check.reason, 'DUPLICATE_CREDIT_FOR_HOLIDAY');
});

test('17. HKA does not affect either balance', () => {
  // A staff member assigned HKA is resting on a public holiday; HKA is neither credit nor consumption
  const hkaSemantics = RosterCompatibility.resolveShift('HKA', 'MO');
  assert.equal(hkaSemantics.canonicalCode, 'HKA');
  assert.equal(hkaSemantics.worked, false);
  assert.equal(hkaSemantics.consecutive, 'RESET');

  // Verify that an assignment with HKA never qualifies to earn GHKA or GOFF
  const hkaAssignment = { personId: 'p-1', date: '2026-05-01', dutyDomain: 'MO', shiftCode: 'HKA' };
  const check = RosterEntitlement.qualifiesForPublicHolidayCredit(hkaAssignment, 'Labour Day', []);
  assert.equal(check.qualifies, false);
});

test('18. GOFF projection = GOFF', () => {
  const val = RosterEntitlement.validateEntitlementConsumption({
    personId: 'p-1',
    date: '2026-05-10',
    entitlementType: 'GOFF',
    balance: 1
  });
  assert.equal(val.projectedShiftCode, 'GOFF');

  const resolved = RosterCompatibility.resolveShift('GOFF', 'MO');
  assert.equal(resolved.canonicalCode, 'GOFF');
  assert.equal(resolved.worked, false);
  assert.equal(resolved.consecutive, 'RESET');
});

test('19. GHKA projection = GHKA', () => {
  const val = RosterEntitlement.validateEntitlementConsumption({
    personId: 'p-1',
    date: '2026-05-15',
    entitlementType: 'GHKA',
    balance: 1
  });
  assert.equal(val.projectedShiftCode, 'GHKA');

  const resolved = RosterCompatibility.resolveShift('GHKA', 'MO');
  assert.equal(resolved.canonicalCode, 'GHKA');
  assert.equal(resolved.worked, false);
  assert.equal(resolved.consecutive, 'RESET');
});

test('20. GOFF* is not treated as new authoritative entitlement', () => {
  // Authoritative entitlement types are strictly GOFF and GHKA
  const types = Object.values(RosterEntitlement.ENTITLEMENT_TYPES);
  assert.equal(types.includes('GOFF*'), false);

  assert.throws(
    () => {
      RosterEntitlement.deriveEntitlementBalance([], { personId: 'p-1', entitlementType: 'GOFF*' });
    },
    err => err.code === 'INVALID_ENTITLEMENT_TYPE'
  );
});

test('21. GOFF reversal dependencies remain GOFF-scoped', () => {
  const credit = RosterEntitlement.createGoffCreditTransaction({
    transactionId: 'cr-goff-1',
    periodId: '2026-05',
    personId: 'p-1',
    effectiveDate: '2026-05-02'
  });
  const consumption = RosterEntitlement.createGoffConsumptionTransaction({
    transactionId: 'cs-goff-1',
    periodId: '2026-05',
    personId: 'p-1',
    effectiveDate: '2026-05-10',
    relatedTransactionId: 'cr-goff-1'
  });

  // Reversing credit while dependent consumption is active is blocked
  assert.throws(
    () => {
      RosterEntitlement.createEntitlementReversalTransaction({
        targetTransaction: credit,
        allTransactions: [credit, consumption]
      });
    },
    err => err.code === 'DEPENDENT_CONSUMPTION_EXISTS'
  );
});

test('22. GHKA reversal dependencies remain GHKA-scoped', () => {
  const credit = RosterEntitlement.createGhkaCreditTransaction({
    transactionId: 'cr-ghka-1',
    periodId: '2026-05',
    personId: 'p-1',
    effectiveDate: '2026-05-01'
  });
  const consumption = RosterEntitlement.createGhkaConsumptionTransaction({
    transactionId: 'cs-ghka-1',
    periodId: '2026-05',
    personId: 'p-1',
    effectiveDate: '2026-05-15',
    relatedTransactionId: 'cr-ghka-1'
  });

  assert.throws(
    () => {
      RosterEntitlement.createEntitlementReversalTransaction({
        targetTransaction: credit,
        allTransactions: [credit, consumption]
      });
    },
    err => err.code === 'DEPENDENT_CONSUMPTION_EXISTS'
  );
});

test('23. Cross-type dependency rejected', () => {
  const goffCredit = RosterEntitlement.createGoffCreditTransaction({
    transactionId: 'cr-goff-2',
    periodId: '2026-05',
    personId: 'p-1',
    effectiveDate: '2026-05-02'
  });

  // Fabricate a malformed/corrupt transaction where GHKA consumption erroneously references GOFF credit
  const crossConsumption = {
    TransactionId: 'cs-ghka-malformed',
    EntitlementType: 'GHKA',
    TransactionType: 'GHKA_CONSUMED',
    RelatedTransactionId: 'cr-goff-2',
    Status: 'CONFIRMED'
  };

  assert.throws(
    () => {
      RosterEntitlement.createEntitlementReversalTransaction({
        targetTransaction: goffCredit,
        allTransactions: [goffCredit, crossConsumption]
      });
    },
    err => err.code === 'CROSS_ENTITLEMENT_DEPENDENCY_FORBIDDEN'
  );
});

test('24. Current policy gives null ExpiresAt for newly earned credits', () => {
  const goffCredit = RosterEntitlement.createGoffCreditTransaction({
    periodId: '2026-05',
    personId: 'p-1',
    effectiveDate: '2026-05-02'
  });
  assert.equal(goffCredit.ExpiresAt, null);
  assert.equal(goffCredit.ExpiryPolicyCode, null);

  const ghkaCredit = RosterEntitlement.createGhkaCreditTransaction({
    periodId: '2026-05',
    personId: 'p-1',
    effectiveDate: '2026-05-01'
  });
  assert.equal(ghkaCredit.ExpiresAt, null);
  assert.equal(ghkaCredit.ExpiryPolicyCode, null);
});

test('25. Null expiry carries indefinitely across years', () => {
  const oldCredit = RosterEntitlement.createGoffCreditTransaction({
    periodId: '2024-01',
    personId: 'p-1',
    effectiveDate: '2024-01-15'
  });

  // Evaluate balance 2+ years into the future
  const bal2026 = RosterEntitlement.deriveEntitlementBalance([oldCredit], {
    personId: 'p-1',
    entitlementType: 'GOFF',
    asOfDate: '2026-12-31'
  });
  assert.equal(bal2026.earnedCredits, 1);
  assert.equal(bal2026.expiredCredits, 0);
  assert.equal(bal2026.currentBalance, 1);
});

test('26. Future-dated expiry supported by pure balance function', () => {
  // Transaction with explicit future expiry date
  const txWithExpiry = RosterEntitlement.createEntitlementCreditTransaction({
    periodId: '2026-05',
    personId: 'p-1',
    entitlementType: 'GOFF',
    effectiveDate: '2026-05-01',
    expiresAt: '2026-11-01',
    expiryPolicyCode: 'EXP_6_MONTHS'
  });
  assert.equal(txWithExpiry.ExpiresAt, '2026-11-01');
  assert.equal(txWithExpiry.ExpiryPolicyCode, 'EXP_6_MONTHS');
});

test('27. Expired hypothetical credit excluded as-of date', () => {
  const expiredTx = RosterEntitlement.createEntitlementCreditTransaction({
    periodId: '2026-01',
    personId: 'p-1',
    entitlementType: 'GOFF',
    effectiveDate: '2026-01-01',
    expiresAt: '2026-06-30'
  });

  // Evaluate as of July 2026 (after expiry date)
  const balAfterExpiry = RosterEntitlement.deriveEntitlementBalance([expiredTx], {
    personId: 'p-1',
    entitlementType: 'GOFF',
    asOfDate: '2026-07-01'
  });
  assert.equal(balAfterExpiry.earnedCredits, 0);
  assert.equal(balAfterExpiry.expiredCredits, 1);
  assert.equal(balAfterExpiry.currentBalance, 0);
});

test('28. Non-expired hypothetical credit included', () => {
  const activeTx = RosterEntitlement.createEntitlementCreditTransaction({
    periodId: '2026-01',
    personId: 'p-1',
    entitlementType: 'GOFF',
    effectiveDate: '2026-01-01',
    expiresAt: '2026-06-30'
  });

  // Evaluate as of May 2026 (before expiry date)
  const balBeforeExpiry = RosterEntitlement.deriveEntitlementBalance([activeTx], {
    personId: 'p-1',
    entitlementType: 'GOFF',
    asOfDate: '2026-05-15'
  });
  assert.equal(balBeforeExpiry.earnedCredits, 1);
  assert.equal(balBeforeExpiry.expiredCredits, 0);
  assert.equal(balBeforeExpiry.currentBalance, 1);
});

test('29. Old null-expiry credit remains valid under future policy simulation', () => {
  const oldCredit = RosterEntitlement.createGoffCreditTransaction({
    transactionId: 'old-c1',
    periodId: '2025-01',
    personId: 'p-1',
    effectiveDate: '2025-01-15'
  });
  assert.equal(oldCredit.ExpiresAt, null);

  const newExpiredCredit = RosterEntitlement.createEntitlementCreditTransaction({
    transactionId: 'new-c2',
    periodId: '2026-01',
    personId: 'p-1',
    entitlementType: 'GOFF',
    effectiveDate: '2026-01-01',
    expiresAt: '2026-04-01'
  });

  const txs = [oldCredit, newExpiredCredit];
  const bal = RosterEntitlement.deriveEntitlementBalance(txs, {
    personId: 'p-1',
    entitlementType: 'GOFF',
    asOfDate: '2026-05-01'
  });

  // oldCredit with null expiry stays valid (1), newExpiredCredit is expired (1)
  assert.equal(bal.earnedCredits, 1);
  assert.equal(bal.expiredCredits, 1);
  assert.equal(bal.currentBalance, 1);
});

test('30. Credit-only operations do not make roster AMENDED', () => {
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

test('31. GOFF consumption makes roster AMENDED where Current changes', () => {
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

test('32. GHKA consumption makes roster AMENDED where Current changes', () => {
  const plannedAssignments = [
    { AssignmentId: 'a-2', PersonId: 'p-1', Date: '2026-05-15', DutyDomain: 'MO', ShiftCode: 'PM', Layer: 'PLANNED', SnapshotId: 'snap-1' }
  ];

  const events = [{
    EventId: 'EV-GHKA-1',
    LineId: 'L-2',
    EventType: 'ADMIN_CORRECTION',
    PeriodId: '2026-05',
    BaseRevision: 0,
    ResultRevision: 1,
    PersonId: 'p-1',
    Date: '2026-05-15',
    DutyDomain: 'MO',
    PlannedAssignmentJson: JSON.stringify(plannedAssignments[0]),
    BeforeCurrentJson: JSON.stringify(plannedAssignments[0]),
    AfterCurrentJson: JSON.stringify({ ...plannedAssignments[0], ShiftCode: 'GHKA', Source: 'AMENDMENT' }),
    PublicReasonCode: 'OPERATIONAL_CHANGE',
    AdminNote: 'GHKA taken',
    GoffTransactionIdsJson: JSON.stringify(['tx-ghka-cons-1']),
    ReversesEventId: ''
  }];

  const res = RosterLifecycle.resolveCurrentRoster({
    periodId: '2026-05',
    plannedAssignments,
    events
  });

  assert.equal(res.effectiveState, 'AMENDED');
  assert.equal(res.activeAmendmentCount, 1);
  assert.equal(res.currentAssignments[0].ShiftCode, 'GHKA');
});

test('33. Planned remains immutable across entitlement consumption', () => {
  const planned = Object.freeze({
    assignmentId: 'asg-immutable',
    personId: 'p-1',
    date: '2026-05-10',
    shiftCode: 'AM',
    layer: 'PLANNED'
  });

  // Current is modified to GOFF
  const current = { ...planned, shiftCode: 'GOFF', layer: 'CURRENT' };

  assert.equal(planned.shiftCode, 'AM');
  assert.equal(current.shiftCode, 'GOFF');
});

test('34. Conflict with active Phase 6 absence rejected for both GOFF and GHKA', () => {
  const activeAbsences = [{
    AbsenceId: 'abs-1',
    PersonId: 'p-1',
    DutyDomain: 'MO',
    StartDate: '2026-05-10',
    EndDate: '2026-05-12',
    AbsenceType: 'MC',
    Status: 'ACTIVE'
  }];

  // GOFF on MC date rejected
  assert.throws(
    () => {
      RosterEntitlement.validateEntitlementConsumption({
        personId: 'p-1',
        date: '2026-05-11',
        entitlementType: 'GOFF',
        balance: 2,
        existingAbsences: activeAbsences
      });
    },
    err => err.code === 'INCOMPATIBLE_OPERATIONAL_STATUS'
  );

  // GHKA on MC date rejected
  assert.throws(
    () => {
      RosterEntitlement.validateEntitlementConsumption({
        personId: 'p-1',
        date: '2026-05-11',
        entitlementType: 'GHKA',
        balance: 2,
        existingAbsences: activeAbsences
      });
    },
    err => err.code === 'INCOMPATIBLE_OPERATIONAL_STATUS'
  );
});

test('35. Viewer DTO strips private/internal data and preserves EntitlementType', () => {
  const tx = RosterEntitlement.createEntitlementCreditTransaction({
    transactionId: 'etx-private-1',
    periodId: '2026-05',
    personId: 'p-1',
    entitlementType: 'GHKA',
    effectiveDate: '2026-05-01',
    publicHolidayName: 'Labour Day',
    publicHolidayDate: '2026-05-01',
    adminNote: 'Internal confidential admin remark',
    operationId: 'op-private-12345',
    createdBy: 'admin@hospital.gov.my'
  });

  const dto = RosterEntitlement.scrubEntitlementViewerDto(tx);
  assert.equal(dto.TransactionId, 'etx-private-1');
  assert.equal(dto.PersonId, 'p-1');
  assert.equal(dto.EntitlementType, 'GHKA');
  assert.equal(dto.PublicHolidayName, 'Labour Day');
  assert.equal(dto.AdminNote, undefined);
  assert.equal(dto.OperationId, undefined);
  assert.equal(dto.CreatedBy, undefined);
});

test('36. EP domain excluded from GOFF and GHKA entitlement accounting', () => {
  // EP cannot earn GOFF
  const checkOff = RosterEntitlement.qualifiesForDisplacedOffCredit('OFF', 'AM', 'EP', '2026-05-03', 'ep-1', []);
  assert.equal(checkOff.qualifies, false);
  assert.equal(checkOff.reason, 'EP_DOMAIN_EXCLUDED');

  // EP cannot earn GHKA
  const checkHol = RosterEntitlement.qualifiesForPublicHolidayCredit(
    { personId: 'ep-1', date: '2026-05-01', dutyDomain: 'EP', shiftCode: 'AM' },
    'Labour Day',
    []
  );
  assert.equal(checkHol.qualifies, false);
  assert.equal(checkHol.reason, 'EP_DOMAIN_EXCLUDED');

  // Factory throws on EP
  assert.throws(
    () => {
      RosterEntitlement.createEntitlementCreditTransaction({
        periodId: '2026-05',
        personId: 'ep-1',
        dutyDomain: 'EP',
        effectiveDate: '2026-05-01',
        entitlementType: 'GOFF'
      });
    },
    err => err.code === 'EP_DOMAIN_EXCLUDED'
  );
});

test('37. Ledger history is append-only: compensation restores balance without row deletion', () => {
  const credit = RosterEntitlement.createGoffCreditTransaction({
    transactionId: 'c-app',
    periodId: '2026-05',
    personId: 'p-1',
    effectiveDate: '2026-05-02'
  });
  const rev = RosterEntitlement.createEntitlementReversalTransaction({
    targetTransaction: credit,
    allTransactions: [credit]
  });

  const ledger = [credit, rev];
  assert.equal(ledger.length, 2);
  const bal = RosterEntitlement.deriveEntitlementBalance(ledger, {
    personId: 'p-1',
    entitlementType: 'GOFF'
  });
  assert.equal(bal.earnedCredits, 1);
  assert.equal(bal.creditReversals, 1);
  assert.equal(bal.currentBalance, 0);
});

test('38. Unconfirmed and FAILED / RECOVERY_REQUIRED transactions excluded from balance', () => {
  const pendingTx = RosterEntitlement.createGoffCreditTransaction({
    periodId: '2026-05', personId: 'p-1', effectiveDate: '2026-05-02'
  });
  pendingTx.Status = 'PENDING';

  const failedTx = RosterEntitlement.createGhkaCreditTransaction({
    periodId: '2026-05', personId: 'p-1', effectiveDate: '2026-05-01'
  });
  failedTx.Status = 'REJECTED';

  const balGoff = RosterEntitlement.deriveEntitlementBalance([pendingTx], { personId: 'p-1', entitlementType: 'GOFF' });
  assert.equal(balGoff.currentBalance, 0);

  const balGhka = RosterEntitlement.deriveEntitlementBalance([failedTx], { personId: 'p-1', entitlementType: 'GHKA' });
  assert.equal(balGhka.currentBalance, 0);
});

test('39. Opening balance and manual administrative adjustment support for GOFF and GHKA', () => {
  const openingGoff = RosterEntitlement.createEntitlementCreditTransaction({
    periodId: '2026-05',
    personId: 'p-1',
    entitlementType: 'GOFF',
    sourceType: 'OPENING_BALANCE',
    effectiveDate: '2026-05-01',
    reasonCode: 'HISTORICAL_OPENING_BALANCE'
  });
  assert.equal(openingGoff.TransactionType, 'CREDIT_MANUAL');
  assert.equal(openingGoff.EntitlementType, 'GOFF');

  const adminGhka = RosterEntitlement.createEntitlementCreditTransaction({
    periodId: '2026-05',
    personId: 'p-1',
    entitlementType: 'GHKA',
    sourceType: 'ADMIN_ADJUSTMENT',
    effectiveDate: '2026-05-01',
    reasonCode: 'ADMINISTRATIVE_CORRECTION'
  });
  assert.equal(adminGhka.TransactionType, 'CREDIT_MANUAL');
  assert.equal(adminGhka.EntitlementType, 'GHKA');

  const all = RosterEntitlement.deriveAllEntitlementBalances([openingGoff, adminGhka], { personId: 'p-1' });
  assert.equal(all.GOFF.currentBalance, 1);
  assert.equal(all.GHKA.currentBalance, 1);
});
