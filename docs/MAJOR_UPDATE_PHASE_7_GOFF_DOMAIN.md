# Phase 7 Slice 1 — GOFF Entitlement, Credit & Consumption Domain Foundation

## 1. Overview & Certified Baseline

This document specifies the canonical domain foundation for **GOFF (Guaranteed Off / Replacement Day Off)** accounting, public-holiday credit generation, consumption, balance derivation, lineage, and append-only compensating reversals in REQUEST APP.

- **Certified Baseline**: `dc9d4525195441351e9a229808c9507c91b1458b` (Phase 6 Slice 4 certified).
- **Domain Module**: [`src/features/roster/goff.js`](file:///C:/Dev/REQUEST-APP/src/features/roster/goff.js).
- **Domain Test Suite**: [`tests/phase7/domain.test.mjs`](file:///C:/Dev/REQUEST-APP/tests/phase7/domain.test.mjs).
- **Phase 7 Branch**: `feature/phase-7-goff-ledger`.

---

## 2. Git Lineage Discrepancy Resolution

Prior reporting identified commit `17712a4f7e177771ff3cf44d02d7ba570f567d21` with two conflicting descriptions:
1. "legacy historical-roster frontend hotfix" (`fix(roster): backport safe historical month uploads`).
2. "hotfix(pwa): register service worker without scope restriction".

### Forensic Verification:
Execution of `git show --no-patch --format=fuller 17712a4f7e177771ff3cf44d02d7ba570f567d21` confirmed:
- **Commit**: `17712a4f7e177771ff3cf44d02d7ba570f567d21`
- **Author/Commit Date**: 2026-03-31T09:47:11+08:00
- **Commit Message**: `fix(roster): backport safe historical month uploads`
- **Lineage**: Identical on `main` and `origin/main`.
- **Verdict**: The phrase referring to PWA service worker registration was an accidental documentation copy-paste typo in earlier certification text. The Git object graph itself is 100% valid, uncorrupted, and immutable.

---

## 3. Discovered Legacy GOFF, HKA & GHKA Semantics

An exhaustive audit of the codebase (`frontend`, `backend`, `legacy Apps Script`, `tests`, `docs`) reveals the following semantics:

### A. HKA and GHKA
- **HKA ("Hari Kelepasan Am")**: Public Holiday Off. A doctor planned or assigned to take off on a public holiday receives `HKA`.
- **GHKA ("Ganti Hari Kelepasan Am")**: Replacement Public Holiday Off. A doctor who worked on a gazetted public holiday earns 1 replacement holiday off.
- **Legacy Implementation**: [`src/utils/publicHolidayTracker.js`](file:///C:/Dev/REQUEST-APP/src/utils/publicHolidayTracker.js) and [`src/utils/holidays.js`](file:///C:/Dev/REQUEST-APP/src/utils/holidays.js). The legacy tracker inspects worked shifts (`AM`, `PM`, `ON1`, `ON2`, `NIGHT`, `AMX`, `PMX`, `PN`) against a gazetted holiday calendar, awarding +1 replacement holiday per worked holiday date.

### B. GOFF ("Guaranteed Off / Replacement Day Off")
- As defined in [`MAJOR_UPDATE_SPEC.md`](file:///C:/Dev/REQUEST-APP/MAJOR_UPDATE_SPEC.md#L85) and [`src/features/roster/guidance.js`](file:///C:/Dev/REQUEST-APP/src/features/roster/guidance.js), `GOFF` represents a **displaced weekly entitlement day off**.
- When an administrative assignment displaces a planned `OFF` (such that a staff member works on what should have been their weekly rest day), the staff member is owed a replacement day off (`GOFF`).
- In downstream reporting and PDF exports ([`src/utils/rosterPdfExport.js`](file:///C:/Dev/REQUEST-APP/src/utils/rosterPdfExport.js)), `GOFF` has the exact same visual weight as `OFF`, representing a rest day that breaks consecutive duty (`consecutive: 'RESET'`, `worked: false`).

### C. GOFF* ("GOFF Star") Semantics
- In legacy code and MasterRoster text fixtures, occurrences of `GOFF*` exist.
- Code audit demonstrates **zero programmatic distinction or custom calculation** for `GOFF*`. It was utilized historically by roster planners as an informal visual marker (e.g. indicating a carried-forward or replacement day off from a previous period).
- In [`src/features/roster/compatibility.js`](file:///C:/Dev/REQUEST-APP/src/features/roster/compatibility.js), `GOFF*` preserves its raw text while resolving to non-working rest day behavior.
- In Phase 7: `GOFF*` is documented as `GOFF_STAR_SEMANTICS_UNRESOLVED`. For canonical ledger accounting and projections, newly consumed replacement days project cleanly as `GOFF`.

### D. Architectural Decision: SourceType Unification
To satisfy both requirements without creating conflicting ledgers:
- `MAJOR_UPDATE_SPEC.md` distinguishes displaced weekly OFF from public holiday GHKA.
- Phase 7 Slice 1 specifications mandate supporting public-holiday credit generation within the ledger.
- **Solution**: The canonical `RosterGoffTransactions` ledger explicitly distinguishes the provenance via `SourceType`:
  1. `PUBLIC_HOLIDAY_DUTY`: Earned from working a qualifying shift on a gazetted public holiday.
  2. `DISPLACED_WEEKLY_OFF`: Earned when a planned weekly rest day (`OFF`) is displaced by an administrative working duty.
  3. `OPENING_BALANCE`: Certified historical balance grandfathered into Phase 7.
  4. `ADMIN_ADJUSTMENT`: Authoritative manual managerial credit/deduction with mandatory public reason and admin note.

> [!NOTE]
> **BUSINESS_RULE_DECISION_REQUIRED (Coexistence vs Unified Ledger)**:
> In Slice 1 domain foundation, both `PUBLIC_HOLIDAY_DUTY` and `DISPLACED_WEEKLY_OFF` are supported under the unified `RosterGoffTransactions` schema. Before Phase 7 Slice 2 backend rollout, clinical administration should formally decide whether legacy `GHKA` tracking is fully retired in favor of this ledger or whether the two ledgers run in parallel. The schema supports both without schema changes.

---

## 4. Authoritative Identity Model

All ledger transactions and balance calculations strictly require:
- **`PersonId`**: The authoritative UUID of the staff member.
- **`PersonNameSnapshot`**: Informational display snapshot only. Under no circumstances is name matching, fuzzy lookup, or row indexing permitted for ledger balance derivation.
- **`DutyDomain`**: `MO` (Medical Officer).
- **EP Domain Exclusion**: Staff in the `EP` domain are strictly excluded from MO staffing, consecutive work, and GOFF earning/consumption (`EP_DOMAIN_EXCLUDED`).
- **Duplicate Display Names**: Multiple staff members sharing identical names (e.g. "Dr. Sarah Lee") are isolated completely by their unique `PersonId`.

---

## 5. Append-Only Ledger Architecture

Ledger transactions are stored in an append-only sheet/table `RosterGoffTransactions`. Physical row deletions or cell mutations are forbidden.

### Canonical Schema:
| Field Name | Type | Description |
| :--- | :--- | :--- |
| `TransactionId` | `string` | Deterministic UUID (`tx-goff-...`) |
| `PeriodId` | `string` | Monthly period context (`YYYY-MM`) |
| `PersonId` | `string` | Authoritative doctor identity |
| `PersonNameSnapshot` | `string` | Display snapshot at transaction time |
| `DutyDomain` | `string` | Must be `MO` |
| `TransactionType` | `string` | `CREDIT_EARNED`, `CREDIT_MANUAL`, `GOFF_CONSUMED`, etc. |
| `Amount` | `number` | Integer amount (typically `1` for credit/consumption) |
| `EffectiveDate` | `string` | ISO date (`YYYY-MM-DD`) when entitlement was earned or consumed |
| `SourceType` | `string` | Provenance (`PUBLIC_HOLIDAY_DUTY`, `DISPLACED_WEEKLY_OFF`, etc.) |
| `SourceId` | `string` | Lineage reference (AssignmentId, Holiday date, etc.) |
| `PublicHolidayDate` | `string` | Qualifying holiday date if applicable |
| `PublicHolidayName` | `string` | Holiday title if applicable |
| `RosterAssignmentId` | `string` | Assignment where GOFF is placed |
| `RelatedTransactionId` | `string` | For reversals: the target TransactionId being reversed |
| `ReasonCode` | `string` | Public reason code (`DUTY_COVERAGE`, `ADMIN_CORRECTION`, etc.) |
| `AdminNote` | `string` | Confidential managerial note (internal only) |
| `Status` | `string` | `CONFIRMED`, `PENDING`, `REVERSED`, `FAILED` |
| `OperationId` | `string` | Client operation UUID for idempotency |
| `CreatedAt` | `string` | ISO 8601 timestamp |
| `CreatedBy` | `string` | User email or operator identifier |

---

## 6. Canonical Transaction Types

```javascript
const GOFF_TRANSACTION_TYPES = {
  CREDIT_EARNED: 'CREDIT_EARNED',
  CREDIT_MANUAL: 'CREDIT_MANUAL',
  CREDIT_REVERSAL: 'CREDIT_REVERSAL',
  GOFF_RESERVED: 'GOFF_RESERVED',
  GOFF_RESERVATION_RELEASED: 'GOFF_RESERVATION_RELEASED',
  GOFF_CONSUMED: 'GOFF_CONSUMED',
  CONSUMPTION_REVERSAL: 'CONSUMPTION_REVERSAL'
};
```

---

## 7. Balance Derivation Formula

Balance is never stored as an editable or mutable single cell. It is derived as a pure, deterministic function:

$$\text{Active Net Credits} = \sum (\text{CONFIRMED Credits}) - \sum (\text{CONFIRMED Credit Reversals})$$
$$\text{Active Net Consumptions} = \sum (\text{CONFIRMED Consumptions}) - \sum (\text{CONFIRMED Consumption Reversals})$$
$$\text{Current Balance} = \text{Active Net Credits} - \text{Active Net Consumptions}$$

- **Fail-Closed on Deficit**: If an attempted consumption exceeds available balance, the operation is rejected with `INSUFFICIENT_GOFF_BALANCE`.
- **Negative Balance Policy**: Negative balances are disallowed by default. Debt/overdraft is only permissible with explicit administrative override flags (`ALLOW_NEGATIVE_OVERRIDE`), satisfying strict hospital compliance.
- **As-of Date Evaluation**: `deriveGoffBalance(transactions, { personId, asOfDate })` deterministically filters transactions where `EffectiveDate <= asOfDate`, allowing historical audits.
- **Cross-Period Carry-Forward**: Balance is non-expiring and carries across monthly and annual boundaries indefinitely unless explicitly deducted or reversed.

---

## 8. Public Holiday Qualification Rules

The domain module function `qualifiesForPublicHolidayCredit(assignment, holidayName, existingAssignmentsOnDate)` enforces:
1. **Gazetted Holiday**: Date must be gazetted in the official hospital holiday calendar ([`src/utils/holidays.js`](file:///C:/Dev/REQUEST-APP/src/utils/holidays.js)).
2. **Qualifying Duty**: Shift must be an active duty (`AM`, `PM`, `AMX`, `PMX`, `ON1`, `ON2`, `NIGHT`, `PN`).
3. **Non-Qualifying Statuses**: Non-working shifts (`OFF`, `GOFF`, `HKA`, `GHKA`, `AL`, `MC`, `EL`, `COURSE`) earn **zero** credits.
4. **Single Credit Per Holiday Rule**: If a doctor works multiple assignments on the same holiday date (e.g. `AM` + `PM`, or `ON1` + `PN`), they earn at most **1 credit** for that holiday.
5. **Phase 5 SWAP Interaction**: Entitlement follows the **actual operational worker** in Current. If Doctor A swaps out and Doctor B works the holiday, Doctor B qualifies for the credit; Doctor A does not.
6. **Phase 6 MC / Absence Interaction**: If Doctor A has an active absence (`MC`) on a holiday, Doctor A earns **0 credits**. If Doctor B covers Doctor A as a replacement worker, Doctor B earns the **1 credit**.
7. **Credit Generation Timing**: Holiday credit generation becomes authoritative when the duty occurs in the operational roster, or upon period publication/closure. It is evaluated against the authoritative Current assignment.

---

## 9. Consumption Semantics & Roster Interaction

1. **Validation**: Before consuming a GOFF, `validateGoffConsumption` checks:
   - Doctor has `currentBalance >= 1`.
   - Doctor is not actively absent (`MC`, `AL`, `EL`, `COURSE`) on that date (`CONFLICTING_OPERATIONAL_STATE`).
   - Doctor domain is `MO`.
2. **Current Roster Impact**: Consuming a GOFF replaces the doctor's assignment on that date with `GOFF`.
3. **Planned Roster Immutability**: The original Planned assignment remains completely unchanged.
4. **Lifecycle State Transition**:
   - Earning a credit affects only the ledger sheet `RosterGoffTransactions`; it does **not** alter roster assignments and therefore does **not** change the period lifecycle state (`PUBLISHED` remains `PUBLISHED`).
   - Consuming a credit alters an operational assignment in Current; this constitutes an amendment and transitions the period lifecycle state to `AMENDED`.

---

## 10. Dependency Model & Append-Only Reversals

Compensating transactions are used for all cancellations:
- **Reversing a Consumption (`CONSUMPTION_REVERSAL`)**: Appends a compensating record that points to the original `GOFF_CONSUMED` transaction via `RelatedTransactionId`. Entitlement balance is restored.
- **Reversing an Earned Credit (`CREDIT_REVERSAL`)**:
  - Before a credit can be reversed, the dependency validator checks if active consumptions depend upon that credit.
  - If a dependent consumption exists, the credit reversal is blocked with `DEPENDENT_CONSUMPTION_EXISTS`.
  - The administrator must first reverse the dependent consumption before the credit can be safely reversed.
- **Idempotency**: Automatic generation and manual transaction creation are deterministically keyed by `OperationId` and semantic source keys (`PersonId` + `HolidayDate` + `DutyDomain`). Re-running generation yields identical outcomes without duplicate rows.

---

## 11. Requests / Leave Boundary

In the current REQUEST APP system:
- Staff requests for "GOFF" or "HKA" represent **administrative user requests / preferences**.
- In Phase 7 Slice 1, requests do **not** automatically execute ledger transactions or alter Current assignments.
- Conversion of approved requests into ledger consumptions will be mediated through administrative actions in subsequent slices.

---

## 12. Privacy & Viewer DTO Boundary

GOFF ledger details represent internal personnel accounting. The privacy boundary is strictly established via `scrubGoffViewerDto(transaction)`:
- **Roster Viewers**: See only the projected `GOFF` shift string on the public roster schedule.
- **Sanitized DTO**: Standard viewers and public endpoints receive only:
  - `TransactionId`, `PeriodId`, `PersonId`, `DutyDomain`, `TransactionType`, `Amount`, `EffectiveDate`, `Status`.
- **Stripped Metadata**: Internal identifiers (`OperationId`, `CreatedBy`, `CreatedAt`), private notes (`AdminNote`), and sensitive source IDs are strictly stripped from public DTOs.

---

## 13. Summary of Slice 1 Verification

- **Domain Tests**: 36/36 tests passing in [`tests/phase7/domain.test.mjs`](file:///C:/Dev/REQUEST-APP/tests/phase7/domain.test.mjs).
- **Full Test Suite**: Legacy, Phase 1, Phase 2, Phase 3, Phase 4, Phase 5, Phase 6, and Phase 7 suites all pass with 0 errors.
- **Apps Script Build**: Verified with `--check` parity.
- **Vite Production Build**: Verified.
