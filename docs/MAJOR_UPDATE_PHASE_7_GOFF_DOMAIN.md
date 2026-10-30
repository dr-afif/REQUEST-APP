# Phase 7 Slice 1.1 — GOFF & GHKA Entitlement, Credit & Consumption Domain Foundation

## 1. Overview & Certified Baseline

This document specifies the canonical domain foundation for **GOFF (Guaranteed Off / Displaced Rest Day)** and **GHKA (Ganti Hari Kelepasan Am / Replacement Public Holiday)** accounting, credit generation, consumption, balance derivation, lineage, and append-only compensating reversals in REQUEST APP.

- **Certified Baseline**: `aa3d819033c689e7d49db5f9d869244687d5b5ba` (Phase 7 Slice 1 checkpoint).
- **Domain Module**: [`src/features/roster/goff.js`](file:///C:/Dev/REQUEST-APP/src/features/roster/goff.js).
- **Domain Test Suite**: [`tests/phase7/domain.test.mjs`](file:///C:/Dev/REQUEST-APP/tests/phase7/domain.test.mjs).
- **Branch**: `feature/phase-7-goff-ledger`.
- **Authoritative Table / Sheet**: `RosterEntitlementTransactions` (append-only ledger).

---

## 2. Git Lineage Forensic Verification

Prior reporting identified commit `17712a4f7e177771ff3cf44d02d7ba570f567d21` with conflicting descriptions:
1. "legacy historical-roster frontend hotfix" (`fix(roster): backport safe historical month uploads`).
2. "hotfix(pwa): register service worker without scope restriction".

### Forensic Result:
Execution of `git show --no-patch --format=fuller 17712a4f7e177771ff3cf44d02d7ba570f567d21` verified:
- **Commit**: `17712a4f7e177771ff3cf44d02d7ba570f567d21`
- **Author/Commit Date**: 2026-03-31T09:47:11+08:00
- **Commit Message**: `fix(roster): backport safe historical month uploads`
- **Lineage**: Identical on `main` and `origin/main`.
- **Verdict**: The phrase referring to PWA service worker registration was an accidental copy-paste typo in documentation. Git history is 100% valid, uncorrupted, and immutable.

---

## 3. Confirmed Business Rules: Separate Entitlement Domains

### A. GOFF (Guaranteed Off / Replacement Day Off)
- **Concept**: Entitlement earned when a normal weekly rest day (`OFF`) is displaced by an administrative or operational working duty (e.g. working `AM`, `PM`, `ON1`, `ON2`, or required `PN` on an originally planned `OFF`).
- **Source**: `DISPLACED_WEEKLY_OFF`.
- **Earning Rule**: Evaluated via `qualifiesForDisplacedOffCredit`. Changing a planned `OFF` to an ordinary absence (`MC`, `EL`, `AL`, `COURSE`) or remaining `OFF`/`HKA` earns **zero** GOFF.
- **Independence**: Working a public holiday does **NOT** earn GOFF.

### B. GHKA ("Ganti Hari Kelepasan Am")
- **Concept**: Entitlement earned by actually working an eligible duty on a gazetted public holiday.
- **Source**: `PUBLIC_HOLIDAY_DUTY`.
- **Earning Rule**: Evaluated via `qualifiesForPublicHolidayCredit`. A doctor performing an active clinical duty (`AM`, `PM`, `ON1`, `ON2`, `NIGHT`, `PN`, etc.) on a gazetted holiday earns **1 GHKA credit**. Non-working statuses (`OFF`, `HKA`, `GHKA`, `MC`, `AL`, `EL`, `COURSE`) earn **zero** GHKA.
- **Single Credit Limit**: Maximum **1 GHKA** per person per holiday date, even if assigned multiple shifts (e.g. `AM` + `PM`).
- **Coverage**: An absent doctor earns zero GHKA; the covering/replacement worker earns the GHKA credit.
- **Independence**: A displaced weekly rest day does **NOT** earn GHKA.

### C. Entitlement Separation & Anti-Pooling
- `GOFF` and `GHKA` are **strictly separate entitlement balances**.
- They are **NOT** pooled.
- A GOFF credit cannot satisfy a GHKA consumption.
- A GHKA credit cannot satisfy a GOFF consumption.
- If a doctor has 0 GOFF credits and 5 GHKA credits, attempting a GOFF consumption fails closed with `INSUFFICIENT_GOFF_BALANCE`.
- If a doctor has 5 GOFF credits and 0 GHKA credits, attempting a GHKA consumption fails closed with `INSUFFICIENT_GHKA_BALANCE`.

### D. HKA Semantics
- **HKA ("Hari Kelepasan Am")**: Roster status for a doctor off/resting on a gazetted public holiday.
- HKA is **neither** a credit nor a consumption.
- HKA has **zero impact** on both GOFF and GHKA balances.
- In `RosterCompatibility.resolveShift`, `HKA` resolves to `worked: false`, `consecutive: 'RESET'`.

### E. GOFF* ("GOFF Star") Semantics
- Marked as `GOFF_STAR_SEMANTICS_UNRESOLVED`.
- Historical inspection shows zero algorithmic or business calculation tied to `GOFF*`; it was an informal legacy visual marker.
- `GOFF*` is **not** an authoritative entitlement type.
- Authoritative ledger transactions strictly use `GOFF` or `GHKA`.

---

## 4. Carry-Forward and Future Expiry Architecture

### Current Expiry Policy:
- **GOFF**: Carries forward indefinitely across months and calendar years.
- **GHKA**: Carries forward indefinitely across months and calendar years.
- Neither expires.
- For all current credits, `ExpiresAt = null`.

### Future-Proofing Architecture:
- The ledger schema includes explicit per-credit metadata: `ExpiresAt` (ISO date string or `null`) and `ExpiryPolicyCode` (string or `null`).
- A `null` or empty `ExpiresAt` represents **non-expiring under the governing policy at credit issuance**.
- The pure balance derivation function `deriveEntitlementBalance(transactions, { personId, entitlementType, asOfDate })` checks:
  - If `asOfDate` is provided and a credit has `ExpiresAt !== null` where `ExpiresAt <= asOfDate`, the credit is considered **EXPIRED** and excluded from `netCredits`.
  - Credits with `ExpiresAt === null` never expire.
- If a hospital policy change introduces an expiry rule in the future, newly generated credits will receive an explicit `ExpiresAt` without rewriting or migrating historical ledger rows.

---

## 5. Canonical Table Schema & Identity (Strict Append-Only Immutability)

### Authoritative Ledger Name:
`RosterEntitlementTransactions` (100% append-only accounting ledger).

### Append-Only Invariant Contract (Option A):
1. **Completely Immutable After Append**:
   - A row appended to `RosterEntitlementTransactions` is **never edited, updated, or deleted**.
   - Zero columns are permitted to mutate after insertion.
   - There are zero in-place row writes (`rosterLifecycleWriteRow_`) executed against `RosterEntitlementTransactions` across the entire codebase.
2. **Authoritative Confirmation State**:
   - Transaction validity and confirmation are derived strictly from `OperationLog.Status === 'CONFIRMED'`.
   - The `Status` column in `RosterEntitlementTransactions` is static metadata assigned upon creation (`CONFIRMED`).
   - If an operation fails or enters `RECOVERY_REQUIRED`, its transaction row exists in the grid but is excluded from balances, `Current` roster projections, and user history because `OperationLog.Status !== 'CONFIRMED'`.
   - Recovery updates `OperationLog.Status` to `CONFIRMED` upon validating roster projection; it **never** mutates the ledger row.
3. **Compensating Transactions for Corrections & Reversals**:
   - Corrections and reversals are strictly represented by appending new compensating transactions (`CREDIT_REVERSAL`, `CONSUMPTION_REVERSAL`) referencing `RelatedTransactionId = <originalTxId>`.
   - The original transaction row remains untouched byte-for-byte; its `Status` is **never** mutated to `REVERSED`.
   - Active accounting effect is derived dynamically from the transaction graph.
4. **Tamper Detection (Fail Closed)**:
   - Recovery executes cryptographic tamper detection by comparing persisted transaction fields against canonical expectations computed via SHA-256 (`rosterV2Digest_`).
   - If any accounting-semantic field (`EntitlementType`, `PersonId`, `Amount`, `SourceId`, `RelatedTransactionId`, etc.) has been altered, recovery immediately aborts with `CORRUPT_DATA` and sets `OperationLog.Status = 'RECOVERY_REQUIRED'`.
   - Recovery **never** repairs or rewrites corrupt accounting rows in place.

### Record Fields:
| Field Name | Type | Immutability | Description |
| :--- | :--- | :--- | :--- |
| `TransactionId` | `string` | Immutable | Deterministic SHA-256 digest (`etx-...`) |
| `PeriodId` | `string` | Immutable | Monthly period context (`YYYY-MM`) |
| `PersonId` | `string` | Immutable | Authoritative doctor UUID |
| `PersonNameSnapshot` | `string` | Immutable | Display snapshot at transaction time |
| `EntitlementType` | `string` | Immutable | `'GOFF'` \| `'GHKA'` (strictly typed) |
| `DutyDomain` | `string` | Immutable | Must be `'MO'` (EP strictly excluded) |
| `TransactionType` | `string` | Immutable | `CREDIT_EARNED`, `CREDIT_MANUAL`, `GOFF_CONSUMED`, `GHKA_CONSUMED`, `CREDIT_REVERSAL`, `CONSUMPTION_REVERSAL` |
| `Amount` | `number` | Immutable | Integer amount (+1 for credit/reversal, -1 for consumption/reversal) |
| `EffectiveDate` | `string` | Immutable | ISO date (`YYYY-MM-DD`) |
| `SourceType` | `string` | Immutable | `DISPLACED_WEEKLY_OFF`, `PUBLIC_HOLIDAY_DUTY`, `OPENING_BALANCE`, `ADMIN_ADJUSTMENT`, `ROSTER_ASSIGNMENT` |
| `SourceId` | `string` | Immutable | Lineage reference |
| `SourceAssignmentId` | `string` | Immutable | Authoritative source assignment ID if applicable |
| `SourcePeriodId` | `string` | Immutable | Source roster month |
| `PublicHolidayDate` | `string` | Immutable | Qualifying holiday date if applicable |
| `PublicHolidayName` | `string` | Immutable | Holiday title if applicable |
| `RosterAssignmentId` | `string` | Immutable | Target assignment where entitlement is taken |
| `RelatedTransactionId` | `string` | Immutable | Target TransactionId for reversals |
| `ReasonCode` | `string` | Immutable | Public reason code |
| `AdminNote` | `string` | Immutable | Confidential managerial note |
| `ExpiresAt` | `string` \| `null` | Immutable | Expiry date (`null` for current policy) |
| `ExpiryPolicyCode` | `string` \| `null` | Immutable | Expiry policy identifier (`null` for current policy) |
| `Status` | `string` | Immutable | Static creation metadata (`CONFIRMED`) |
| `OperationId` | `string` | Immutable | Operation UUID; authoritative confirmation derived from `OperationLog` |
| `CreatedAt` | `string` | Immutable | ISO 8601 timestamp |
| `CreatedBy` | `string` | Immutable | Operator identifier / email |

---

## 6. Separate Balance Derivation Formula

Balance derivation is implemented by the pure function `deriveEntitlementBalance(transactions, { personId, entitlementType, asOfDate })`:

$$\text{Active Net Credits} = \sum (\text{CONFIRMED Non-Expired Credits}) - \sum (\text{CONFIRMED Credit Reversals})$$
$$\text{Active Net Consumptions} = \sum (\text{CONFIRMED Consumptions}) - \sum (\text{CONFIRMED Consumption Reversals})$$
$$\text{Current Balance} = \text{Active Net Credits} - \text{Active Net Consumptions}$$

- Evaluated strictly per `EntitlementType`.
- Convenience method `deriveAllEntitlementBalances(transactions, { personId, asOfDate })` returns:
  ```json
  {
    "GOFF": { "currentBalance": 1, ... },
    "GHKA": { "currentBalance": 2, ... }
  }
  ```
- **EP Domain Exclusion**: EP staff members do not earn or consume entitlements (`EP_DOMAIN_EXCLUDED`).

---

## 7. Consumption Semantics & Roster Projections

1. **GOFF Consumption**:
   - Requires `GOFF balance >= 1`.
   - Projects as `ShiftCode = 'GOFF'`.
   - Decreases GOFF balance by 1.
2. **GHKA Consumption**:
   - Requires `GHKA balance >= 1`.
   - Projects as `ShiftCode = 'GHKA'`.
   - Decreases GHKA balance by 1.
3. **Phase 6 Operational Conflicts**:
   - Fails closed if the doctor has an active absence (`MC`, `EL`, `AL`, `COURSE`) on that date (`INCOMPATIBLE_OPERATIONAL_STATUS`).
4. **Lifecycle Impact**:
   - Earning a credit does **not** alter roster assignments $\rightarrow$ period remains `PUBLISHED`.
   - Consuming a credit alters Current assignments $\rightarrow$ period becomes `AMENDED`.
   - The immutable Planned layer remains untouched.

---

## 8. Reversal & Dependency Rules (Compensating Transactions)

Compensating reversal transactions append to `RosterEntitlementTransactions`:
- **Original Row Untouched**:
  - The original transaction row remains completely immutable. It is **never** mutated to `Status = 'REVERSED'`.
  - The reversal is represented solely by appending a new compensating transaction (`CREDIT_REVERSAL` or `CONSUMPTION_REVERSAL`) with `RelatedTransactionId = <originalTxId>`.
  - Balances, available entitlements, and active status are derived directly from the transaction graph.
- **Scoped Dependencies**:
  - A GOFF credit cannot be reversed if an active GOFF consumption depends upon it (`DEPENDENT_CONSUMPTION_EXISTS`).
  - A GHKA credit cannot be reversed if an active GHKA consumption depends upon it (`DEPENDENT_CONSUMPTION_EXISTS`).
- **Cross-Type Dependency Rejection**:
  - Cross-entitlement dependencies (e.g. a GHKA consumption referencing a GOFF credit) are strictly rejected with `CROSS_ENTITLEMENT_DEPENDENCY_FORBIDDEN`.

---

## 9. MasterRoster, Requests, and Privacy Boundaries

- **MasterRoster Projections**:
  - Consumed GOFF $\rightarrow$ `ShiftCode = 'GOFF'`.
  - Consumed GHKA $\rightarrow$ `ShiftCode = 'GHKA'`.
  - Rest on Public Holiday $\rightarrow$ `ShiftCode = 'HKA'`.
- **Requests Boundary**:
  - Staff requests for "GOFF" or "GHKA" represent administrative requests/preferences. They do **not** automatically execute ledger transactions during Slice 1.1.
- **Privacy Scrubber**:
  - `scrubEntitlementViewerDto(transaction)` strips confidential notes (`AdminNote`), client IDs (`OperationId`), and audit tracking (`CreatedBy`, `CreatedAt`, `SourceId`).
  - Public viewers receive only operational metadata and `EntitlementType`.

---

## 10. Summary of Slice 1.1 Verification

- **Domain Test Suite**: **39/39** tests passed in [`tests/phase7/domain.test.mjs`](file:///C:/Dev/REQUEST-APP/tests/phase7/domain.test.mjs).
- **Full Test Suite**: All test suites pass (legacy + phases 1–7) with 0 errors.
- **Build Checks**: Apps Script `--check` and Vite build succeeded.
- **Working Tree**: Clean.
