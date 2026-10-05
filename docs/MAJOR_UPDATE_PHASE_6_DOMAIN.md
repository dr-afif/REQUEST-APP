# Major Update Phase 6 — Absence & Replacement Domain Foundation

Authoritative Document  
Repository: `C:\Dev\REQUEST-APP`  
Branch: `feature/phase-6-absence-replacement`  
Baseline Phase 5 Checkpoint: `25ddb3fae13b50695ca198b20f9ffde3ee9eaa59`  
Slice 1: Domain / Schemas / Contracts / Pure Tests

---

## 1. Executive Summary & Objective

Phase 5 answered:
> *What amendment changed the published roster?*

Phase 6 answers:
> *Why is the originally assigned person unavailable, who is covering the duty, and what operational relationship exists between those records?*

In Phase 6 Slice 1, we establish the domain models, canonical enums, validation contracts, dependency graph, reversal rules, privacy boundaries, and resolver extensions for:
- Operational absences (`MC`, `EL`, `AL`, `COURSE`);
- Operational replacement and duty coverage (`ReplacementId`, `AbsenceId`, `OriginalAssignmentId`, `ReplacementPersonId`);
- Reconciled Current roster resolution and MasterRoster projections.

All changes preserve the immutable Planned baseline and the append-only event architecture established in Phase 4 and Phase 5.

---

## 2. Separation of Concerns & Architecture: Table vs Event Log

We evaluated two architectural patterns for representing absences:
- **Option A**: Dedicated tables/entities (`RosterAbsences` and `RosterReplacements`).
- **Option B**: Strongly typed Phase 6 events packed purely inside `RosterEvents`.

### Decision: Option A (Dedicated Record Entities + Event Journaling)
We adopted **Option A** with the following strict rationale:

1. **Absence Facts vs Cell Mutations**:
   - `RosterEvents` is a point-in-time, date-specific, single-assignment mutation log (`Date`, `ShiftBefore`, `ShiftAfter`, `BaseRevision`, `ResultRevision`).
   - An **Absence** is a multi-day operational fact / episode with a start date, end date, leave type, and administrative note. Forcing a multi-day absence into single-cell `RosterEvents` rows fragments the episode across disparate daily rows and destroys the coherent multi-day entity lifecycle.
2. **Replacement Relationships**:
   - A **Replacement** is an explicit relational bridge between the absent person's original assignment and the covering person's replacement assignment. Storing replacement relationships in a dedicated entity model (`RosterReplacements`) preserves explicit lineage (`ReplacementId`, `AbsenceId`, `OriginalAssignmentId`, `ReplacementPersonId`) without brittle heuristics or JSON packing.
3. **Privacy & Security Boundaries**:
   - Medical details, sensitive diagnostic reasons, and private administrative notes belong strictly in `RosterAbsences.AdminNote`. Keeping them in a dedicated absence entity allows server-side viewer DTO transforms to strip private notes before sending data to non-admin viewers.
4. **Append-Only Revision Integrity**:
   - When an absence or replacement is confirmed, the state change is journaled into `RosterEvents` (with `PublicReasonCode: 'DUTY_COVERAGE'`, `ShortageAccepted`, etc.), while the absence and replacement records remain durable, queryable entities.

---

## 3. Canonical Enums & Reason Codes

### 3.1 Canonical Absence Enum
The domain defines a strictly validated, frozen enum of canonical absence types:
- `MC`: Medical Certificate / Sick Leave
- `EL`: Emergency Leave
- `AL`: Annual Leave
- `COURSE`: Course / Training

> [!IMPORTANT]
> `GOFF` is NOT part of Phase 6. GOFF remains strictly reserved for Phase 7.
> Absence types are NOT inferred from free-text notes. They must be explicitly provided from the canonical enum.

### 3.2 Phase 5 Public Amendment Reasons Unchanged
Absence type is independent of public amendment reasons. Phase 5 reason codes in `PUBLIC_REASON_CODES` remain strictly unchanged:
- `SHIFT_SWAP`
- `ADMIN_CORRECTION`
- `DUTY_COVERAGE`
- `OPERATIONAL_CHANGE`
- `OTHER`

Do NOT conflate them:
- **Absence Type**: `MC` (the operational reason the doctor cannot work).
- **Public Amendment Reason**: `DUTY_COVERAGE` (the public explanation for the roster change).

---

## 4. Entity Schemas & Models

### 4.1 `RosterAbsences` Schema
| Field | Type | Description |
|---|---|---|
| `AbsenceId` | UUID | Authoritative unique identifier for the absence record. |
| `PeriodId` | String | Target monthly period (`YYYY-MM`). |
| `PersonId` | String | Stable person identifier from `RosterPeople`. |
| `PersonNameSnapshot` | String | Snapshot of person's display name at record creation. |
| `AbsenceType` | String | One of `MC`, `EL`, `AL`, `COURSE`. |
| `StartDate` | String | Inclusive start date (`YYYY-MM-DD`). |
| `EndDate` | String | Inclusive end date (`YYYY-MM-DD`), `StartDate <= EndDate`. |
| `DutyDomain` | String | `MO` or `EP`. Domain isolation is strictly enforced. |
| `PublicReason` | String | Public-safe reason code or description (e.g. `DUTY_COVERAGE`). |
| `AdminNote` | String | Private, administrator-only operational/medical note. |
| `Status` | String | `ACTIVE` or `REVERSED`. |
| `OperationId` | UUID | Operation batch identifier. |
| `CreatedAt` | ISO Date | Timestamp of record creation. |
| `CreatedBy` | String | User principal or admin actor. |

### 4.2 `RosterReplacements` Schema
| Field | Type | Description |
|---|---|---|
| `ReplacementId` | UUID | Authoritative unique identifier for the replacement coverage. |
| `AbsenceId` | UUID | Reference to the active parent `RosterAbsence`. |
| `OriginalAssignmentId` | String | ID of the absent person's planned/current assignment being covered. |
| `ReplacementPersonId` | String | Stable person identifier of the covering staff (`RosterPeople`). |
| `ReplacementAssignmentId` | String | Unique assignment ID for the covering duty in Current. |
| `DutyDomain` | String | `MO` or `EP`. Must match the parent absence DutyDomain. |
| `Date` | String | Date of duty coverage (`YYYY-MM-DD`). Must fall within `[StartDate, EndDate]`. |
| `ShiftCode` | String | Operational shift code (e.g. `PM`, `AM`, `NIGHT`). |
| `Status` | String | `ACTIVE` or `REVERSED`. |
| `OperationId` | UUID | Operation batch identifier. |
| `CreatedAt` | ISO Date | Timestamp of record creation. |
| `CreatedBy` | String | User principal or admin actor. |

---

## 5. Canonical Identity, Multi-Day Semantics & Overlap Rules

1. **Identity by `PersonId`**:
   - Absence identity and coverage strictly use `PersonId`, never display names.
   - Two doctors with identical display names (e.g. two doctors named "Dr Siti") maintain distinct `PersonId`s (`p-siti-1` and `p-siti-2`). An absence on `p-siti-1` never affects `p-siti-2`.
2. **DutyDomain Isolation**:
   - Medical Officer (`MO`) and Emergency Physician (`EP`) duties for the same person on the same date are completely segregated. An absence in `MO` leaves `EP` assignments intact.
3. **Multi-Day Date Range Semantics**:
   - An absence covers calendar dates where `StartDate <= Date <= EndDate`.
   - Roster effects apply **only to relevant rostered duties** within that date range.
   - Non-working days (e.g. OFF days or days without assignments) do **NOT** have artificial working assignments invented.
   - Coverage operates per affected duty assignment. One multi-day absence can have multiple affected duties, each with independent coverage status.
4. **No Overlap Ambiguity (Fail-Closed)**:
   - Overlapping active absences for the same `PersonId` and `DutyDomain` are strictly rejected with error `OVERLAPPING_ABSENCE`.
   - If an absence needs to be superseded, the earlier active absence must be explicitly reversed first.

---

## 6. Coverage States & Shortage Semantics

### 6.1 Coverage Status
- **Assignment Level**:
  - `UNCOVERED`: Assigned doctor is absent; no covering replacement assigned.
  - `COVERED`: Duty is covered by an active replacement doctor.
- **Absence Level** (aggregate across all affected duties in the absence range):
  - `UNCOVERED`: 0 affected duties covered.
  - `PARTIALLY_COVERED`: Some, but not all, affected duties covered.
  - `COVERED`: All affected duties covered (or 0 duties affected).

### 6.2 Shortage Semantics
- When an absence leaves duties uncovered or partially covered, the system reuses Phase 5 fields:
  - `ShortageAccepted`: boolean
  - `ShortageReason`: string
- If operational policy requires shortage acknowledgement for uncovered duties, `ShortageAccepted: true` and a non-empty `ShortageReason` must be explicitly provided.

---

## 7. Reversal & Dependency Rules

1. **Replacement Reversal**:
   - An active replacement can be reversed independently.
   - Reversing the replacement marks it `Status: REVERSED`.
   - The parent absence remains `ACTIVE`.
   - The original duty assignment reverts to `CoverageStatus: UNCOVERED`.
2. **Absence Reversal with Dependent Replacements**:
   - Attempting to reverse an absence while active dependent replacements exist is **blocked** by dependency protection, throwing `REPLACEMENT_DEPENDENCY_CONFLICT`.
   - All dependent replacements must be reversed before the parent absence can be reversed.
3. **Full Dependency Reversal Chain**:
   - When all replacements are reversed and the absence is reversed, the resolver restores the Current roster state back to the original Planned baseline.
   - All reversal records remain append-only in history.

---

## 8. Current Resolver & Planned Immutability

### 8.1 Unified Resolution Order
We extend the certified Phase 5 resolver architecture rather than creating an independent engine. The single canonical resolution pipeline executes in this deterministic order:
1. **Baseline Planned Assignments**: Immutable baseline loaded from snapshot.
2. **Confirmed Phase 5 Amendments**: `ADMIN_CORRECTION`, `SWAP`, and `REVERSAL` events applied.
3. **Confirmed Active Absences**: Active absences for target period and domain match working duties, changing `ShiftCode` to the `AbsenceType` (e.g. `MC`), setting `CoverageStatus: UNCOVERED`, and preserving `OriginalShiftCode` and `OriginalAssignmentId`.
4. **Confirmed Active Replacements**: Validates active parent absence, updates absent assignment to `CoverageStatus: COVERED`, and inserts the replacement doctor's working assignment with full lineage (`CoveringForPersonId`, `AbsenceId`, `ReplacementId`, `OriginalAssignmentId`).
5. **Canonical Sorting**: Flattens and canonically sorts all assignments by `Date`, `DutyDomain`, `PersonId`, `ShiftCode`, `AssignmentId`.

### 8.2 Planned Immutability
- Planned assignments are strictly read-only and immutable.
- Byte-for-byte SHA-256 digest of Planned assignments matches before and after all absence and replacement operations.

---

## 9. MasterRoster & Existing Requests Compatibility

### 9.1 MasterRoster Legacy Projection
Investigation of legacy behavior in `src/utils/leaveTracking.js`, `src/utils/rosterAnalytics.js`, and `src/components/RosterPage.jsx` revealed:
- In legacy MasterRoster, an absent doctor's shift is written as `MC`, `AL`, `EL`, or `COURSE`.
- When a doctor covers the shift, their row has the working shift (e.g. `PM`).
- `LeaveTracker` derives leave episodes by inspecting MasterRoster for rows with `Shift: 'MC' | 'EL' | 'AL'`.
- Analytics counts `MC, EL, AL, COURSE` as non-working shifts (`staffingBucket: null`), correctly decrementing working tallies.

Our Current resolver projection to MasterRoster strictly mirrors this discovered legacy convention:
- **Uncovered Absence**: Dr Alice row on `2026-11-10` has `Shift: 'MC'`.
- **Covered Absence**: Dr Alice row on `2026-11-10` has `Shift: 'MC'` AND Dr Bob row on `2026-11-10` has `Shift: 'PM'`.

### 9.2 Relationship to Requests & LeaveApplications
- In legacy, `Requests` (shift/leave requests) and `LeaveApplications` (administrative leave forms) exist as pre-operational forms.
- Submitting or approving a request in `Requests` or `LeaveApplications` does **NOT** automatically mutate the operational roster.
- Only confirmed operational absences (`RosterAbsence`) affect Current assignments.
- Pending or submitted leave requests remain outside the operational Current resolver boundary.

---

## 10. Privacy & Viewer DTO

To prevent leaking sensitive medical details or internal administrative explanations:
- `toPublicAbsenceDto(absence)` strictly strips `AdminNote` and any sensitive metadata.
- Non-admin roster viewers only receive public-safe fields: `AbsenceId`, `PeriodId`, `PersonId`, `PersonNameSnapshot`, `AbsenceType`, `StartDate`, `EndDate`, `DutyDomain`, `PublicReason`, `Status`, `CreatedAt`.

---

## 11. Locum & Relief Coverage Recommendation

- Current staff identity requires all rostered participants to have an authoritative `PersonId` in `RosterPeople`.
- We recommend that locum and external relief doctors be enrolled into `RosterPeople` with valid UUID `PersonId`s and `DirectoryType: 'MO'` (or an additive `DirectoryType: 'LOCUM'`).
- We must **never** weaken `PersonId` by encoding names or text into synthetic IDs (e.g. `"locum:Dr Smith"`).

---

## 12. Verification & Regression Results

### 12.1 Phase 6 Domain Tests (`tests/phase6/domain.test.mjs`)
All 26 mandatory domain requirements plus extra shortage/coverage tests pass (27/27 subtests):
1. Canonical absence enum validation and Phase 5 code preservation.
2. Valid single-day absence record creation.
3. Valid multi-day absence record creation and inverted date rejection.
4. Absence identity strictly by `PersonId`.
5. Duplicate display names segregation.
6. DutyDomain isolation (`MO` vs `EP`).
7. Overlapping active absence fails closed.
8. Absence does not mutate Planned.
9. Absence with no affected roster assignment does not invent one.
10. Absence maps only to assignments inside date range.
11. Uncovered absence assignment produces deterministic `UNCOVERED` state.
12. Replacement links to active parent absence.
13. Replacement uses authoritative `PersonId` and rejects self-replacement.
14. Replacement preserves lineage back to original planned assignment.
15. Replacement across wrong DutyDomain rejected.
16. Replacement against nonexistent absence rejected.
17. Replacement reversal leaves absence active and assignment uncovered.
18. Absence reversal with dependent active replacement blocked.
19. Final dependency reversal chain restores original Current state.
20. Multiple replacements remain append-only in history.
21. Unconfirmed / draft absence is invisible to Current.
22. Failed / recovery-required operations invisible.
23. Deterministic replay and idempotency.
24. MasterRoster projection legacy compatibility.
25. Viewer DTO privacy strips sensitive `AdminNote`.
26. Planned remains byte-for-byte semantically immutable.
27. Extra: Shortage acceptance validation and coverage status derivation.

### 12.2 Full Regression Suite
- `npm run test:legacy`: Passed (5/5 helper suites).
- `npm run test:phase1`: Passed (95/95 tests).
- `npm run test:phase2`: Passed (72/72 tests).
- `npm run test:phase3`: Passed (76/76 tests).
- `npm run test:phase4`: Passed (91/91 tests).
- `npm run test:phase5`: Passed (132/132 tests).
- `npm run test:phase6`: Passed (27/27 tests).
- `npm test`: Passed (493 total tests).
- `node scripts/build-appscript.mjs --check`: Passed.
- `npm run build`: Passed.
- `git diff --check`: Passed (clean tree).
