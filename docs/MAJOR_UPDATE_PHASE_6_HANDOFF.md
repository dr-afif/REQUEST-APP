# Major Update Phase 6 — Absence, Coverage & Replacement End-to-End Certification & Handoff

**Verdict: PASS for local Phase 6 implementation, end-to-end certification, and handoff. Ready for Phase 7.**

- **Repository**: `C:\Dev\REQUEST-APP`
- **Branch**: `feature/phase-6-absence-replacement`
- **Starting Phase 5 Lineage**: `25ddb3fae13b50695ca198b20f9ffde3ee9eaa59`
- **Certification Checkpoint**: `60d718d`
- **Production Status**: Production `main` remains isolated on `17712a4` (legacy frontend safety hotfix). Production Apps Script remains on V1.1 legacy safety backend. Zero Phase 6 code deployed.

---

## 1. Executive Summary & Objective

Phase 5 delivered the authoritative three-layer roster (`Planned`, `Current`, `Changes`), lifecycle state machines, and assignment amendment/swap workflows.

Phase 6 answers the essential clinical roster operational question:
> *Why is the originally assigned person unavailable, who is covering the duty, and what operational relationship exists between those records?*

Phase 6 introduces first-class operational absences (`MC`, `EL`, `AL`, `COURSE`), duty replacements, coverage state tracking, dedicated recovery pipelines, and context-aware UI workflows while preserving:
1. **Planned Immutability**: The originally published roster snapshot is never mutated by absences, replacements, reversals, or recovery.
2. **Deterministic Current Derivation**: `Current` is computed deterministically from `Planned` + active Phase 5 amendments + active Phase 6 absences + active Phase 6 replacements.
3. **Audit Trail Integrity**: Append-only journaling in `RosterEvents` and durable entities in `RosterAbsences` and `RosterReplacements`.
4. **Compatibility Projection**: `MasterRoster` remains a backward-compatible projection and is never the source of truth for identity or state.

---

## 2. Architecture & Layer Separation

```text
                               +-----------------------------+
                               |     Draft / Pre-Publish     |
                               +-----------------------------+
                                              |
                                              | Publish (Phase 4)
                                              v
+---------------------------------------------------------------------------------------------------------+
|                                        Authoritative Backend                                            |
|                                                                                                         |
|   +-----------------------+   +-------------------+   +--------------------+   +--------------------+   |
|   |   RosterAssignments   |   |   RosterEvents    |   |   RosterAbsences   |   | RosterReplacements |   |
|   |    (Layer='PLANNED')  |   | (Amendments/Ops)  |   | (Absence Episodes) |   | (Coverage Bridges) |   |
|   +-----------------------+   +-------------------+   +--------------------+   +--------------------+   |
|               |                         |                       |                        |              |
|               | (Frozen Snapshot)       | (Confirmed Only)      | (Active Only)          | (Active Only)|
|               v                         v                       v                        v              |
|     +-------------------+     +-------------------------------------------------------------+           |
|     |  rosterv2planned  |     |                      Phase 6 Resolver                       |           |
|     +-------------------+     +-------------------------------------------------------------+           |
|               |                                       |                         |                       |
|               |                                       v                         v                       |
|               |                           +-----------------------+   +--------------------+            |
|               |                           |    rosterv2current    |   | Operational /      |            |
|               |                           +-----------------------+   | Amendment History  |            |
|               |                                       |               +--------------------+            |
|               |                                       v                                                 |
|               |                           +-----------------------+                                     |
|               |                           | MasterRoster (Sheet)  |                                     |
|               |                           | (Legacy Projection)   |                                     |
+---------------+---------------------------------------+-------------------------------------------------+
                |                                       |
                v                                       v
+---------------------------------------------------------------------------------------------------------+
|                                         Frontend Application                                            |
|                                                                                                         |
|      +---------------------+          +----------------------+          +---------------------+         |
|      |    Planned View     |          |     Current View     |          |    Changes View     |         |
|      |  (Read-Only Baseline)          |  (Working/Abs/Repl)  |          | (Amendments & Ops)  |         |
|      +---------------------+          +----------------------+          +---------------------+         |
+---------------------------------------------------------------------------------------------------------+
```

### Core Invariants:
1. **Planned**: Sourced from `RosterAssignments (Layer='PLANNED')`. Frozen upon publication, byte-for-byte immutable across all subsequent absence, replacement, reversal, or recovery operations.
2. **Current**: Evaluated dynamically by applying confirmed active amendments, active absences, and active replacements to the Planned baseline.
3. **Changes / Operational History**: Combines Phase 5 assignment amendments with Phase 6 operational absence and replacement histories. All reversal actions are compensating append-only mutations; history is never deleted.
4. **MasterRoster Projection**: Synchronized projection for legacy readers and compatibility consumers. Never supplies identity, revision, or state back to Phase 6.

---

## 3. Persistent Schemas

### 3.1 RosterAbsences (`ROSTER_ABSENCES`)
Durable operational records representing an absence episode:
- `AbsenceId`: Unique deterministic identifier (`abs-<timestamp>-<rand>`).
- `PeriodId`: Target monthly period (`YYYY-MM`).
- `PersonId`: Authoritative staff identifier.
- `PersonNameSnapshot`: Display name at time of recording (presentation only).
- `AbsenceType`: Canonical enum (`MC`, `EL`, `AL`, `COURSE`).
- `StartDate`: Start date in ISO format (`YYYY-MM-DD`).
- `EndDate`: End date in ISO format (`YYYY-MM-DD`).
- `DutyDomain`: Staff duty domain (`MO`, `EP`, etc.).
- `PublicReason`: Sanitized public reason string (matches `AbsenceType`).
- `AdminNote`: Administrative context (accessible only to authorized admins).
- `Status`: Operational status (`ACTIVE` or `REVERSED`).
- `OperationId`: Idempotency tracking identifier matching `OperationLog`.
- `CreatedAt`, `CreatedBy`, `ReversedAt`, `ReversedBy`: Audit timestamps and user identifiers.

### 3.2 RosterReplacements (`ROSTER_REPLACEMENTS`)
Durable relational bridges connecting an uncovered absent duty to a covering staff member:
- `ReplacementId`: Unique deterministic identifier (`repl-<timestamp>-<rand>`).
- `AbsenceId`: Foreign key to parent `RosterAbsences` record.
- `OriginalAssignmentId`: ID of the original working assignment affected by absence.
- `ReplacementPersonId`: Authoritative staff identifier of the covering person.
- `ReplacementAssignmentId`: Synthetic assignment ID representing the covering duty.
- `DutyDomain`: Staff duty domain (`MO`, `EP`).
- `Date`: Assignment date (`YYYY-MM-DD`).
- `ShiftCode`: Shift code being worked by the replacement (e.g., `AM`, `PM`, `ND`).
- `Status`: Operational status (`ACTIVE` or `REVERSED`).
- `OperationId`: Idempotency tracking identifier matching `OperationLog`.
- `CreatedAt`, `CreatedBy`, `ReversedAt`, `ReversedBy`: Audit fields.

### 3.3 Additive Schema Behavior
All Sheet and database adapters preserve unknown extra columns on read and write, ensuring backward and forward compatibility.

---

## 4. Resolver Order & State Derivation

When resolving `rosterv2current`:
1. **Base Baseline**: Load immutable Planned assignments (`Layer='PLANNED'`).
2. **Apply Active Phase 5 Amendments**: Apply confirmed non-reversed amendment lines in monotonic revision order.
3. **Apply Active Phase 6 Absences**: For every `ACTIVE` absence in `RosterAbsences` where the operation is `CONFIRMED`:
   - Match working assignments where `personId === absence.PersonId && dutyDomain === absence.DutyDomain && date >= absence.StartDate && date <= absence.EndDate`.
   - Mutate assignment: `source = 'ABSENCE'`, `originalShiftCode = assignment.shiftCode`, `shiftCode = absence.AbsenceType`, `coverageStatus = 'UNCOVERED'`, `absenceId = absence.AbsenceId`.
4. **Apply Active Phase 6 Replacements**: For every `ACTIVE` replacement in `RosterReplacements` where the operation is `CONFIRMED`:
   - Locate absent assignment by `absenceId` and matching `date` and `dutyDomain`. Mark `coverageStatus = 'COVERED'`, `replacementId = replacement.ReplacementId`.
   - Create or update the replacement person's assignment: `source = 'REPLACEMENT'`, `shiftCode = replacement.ShiftCode`, `coverageStatus = 'COVERED'`, `coveringForPersonId = absentAssignment.personId`, `replacementId = replacement.ReplacementId`.
5. **Compute Effective State**:
   - If period is `DRAFT` or `CLOSED`, state remains `DRAFT` or `CLOSED`.
   - If period is `PUBLISHED`, but active Phase 5 amendments or active working-duty Phase 6 absences exist, effective state is `AMENDED`.
   - If all working-duty absences and amendments are reversed, effective state is `PUBLISHED`.
   - Administrative no-duty absences leave the effective state as `PUBLISHED`.

---

## 5. Canonical Absence Semantics

### 5.1 Absence Types
Four canonical operational types are supported:
- `MC`: Medical Leave.
- `EL`: Emergency Leave.
- `AL`: Annual Leave.
- `COURSE`: Training / Continuing Medical Education.

> [!NOTE]
> Canonical absence types are completely distinct from Phase 5 `PublicReasonCode`s.
> `GOFF` (Guaranteed Day Off) is strictly reserved for Phase 7.
> Absence types are strictly validated and never inferred from free-text notes.

### 5.2 Context Awareness & Zero-Duty Administrative Absences
- When creating an absence, the system projects affected working duties across the date range.
- **Working-duty absence**: Leaves duties uncovered, increments revision, transitions period to `AMENDED`, requires shortage acknowledgement.
- **Zero-duty administrative absence**: Recorded for dates where staff have no rostered duties (or are already `OFF`).
  - Persists durably in `RosterAbsences` and `OperationLog`.
  - Zero mutations to `Current` or `MasterRoster`.
  - Period revision is NOT bumped.
  - Lifecycle state remains `PUBLISHED` (or unchanged).
  - Closed period reopen resolves to `PUBLISHED` if this is the sole Phase 6 record.

---

## 6. Duty Shortage Workflow

When an absence leaves one or more rostered duties uncovered:
1. System displays: `"This absence leaves N duty uncovered."`
2. Requires explicit acknowledgement (`shortageAccepted = true`).
3. Requires non-empty administrative justification (`shortageReason`).
4. Both client and backend enforce shortage validation; client cannot bypass backend shortage checks.
5. If zero duties are affected, shortage acknowledgement is not required and omitted from UI.

---

## 7. Replacement Workflows & Collision Rules

### 7.1 Authoritative Identity
Replacements strictly bind authoritative `PersonId`s. Name matching, partial strings, or synthetic locum names are strictly prohibited.

### 7.2 Collision Matrix
| Candidate Status on Date | Same DutyDomain | Different DutyDomain (e.g. EP) | Backend Authority |
| :--- | :--- | :--- | :--- |
| **Scheduled OFF** | Allowed | Allowed | Permitted |
| **Working Shift** | **BLOCKED (Collision)** | Allowed (if domain permit) | Fails closed |
| **Active Absence** | **BLOCKED (Absent)** | **BLOCKED** | Fails closed |
| **Absent Person (Self)** | **BLOCKED (Self-replacement)**| **BLOCKED** | Fails closed |

---

## 8. Reversal Workflows

All reversals are append-only compensating operations:
1. **Replacement Reversal**:
   - Reverses `RosterReplacements` (`Status='REVERSED'`).
   - Absence record remains `ACTIVE`.
   - Duty returns to `UNCOVERED`.
   - Shortage acknowledgement is required.
   - MasterRoster projection updates covering doctor back to original shift (`OFF`) and absent doctor remains `MC`.
2. **Absence Reversal**:
   - **Dependency check**: If active replacements exist for the absence, reversal is blocked (`REPLACEMENT_DEPENDENCY_CONFLICT`).
   - Displays clear error: `"Reverse the active replacement first before reversing this absence."`
   - Once all dependent replacements are reversed, absence reversal succeeds (`Status='REVERSED'`).
   - Duty restores original shift code.
   - If no other active Phase 5 or Phase 6 changes remain, lifecycle returns to `PUBLISHED`.

---

## 9. Lifecycle State Machine Matrix

| Prior State | Mutation / Event | Resulting State | Revision Bump | Notes |
| :--- | :--- | :--- | :--- | :--- |
| `PUBLISHED` | Working-duty Absence Created | `AMENDED` | Yes (+1) | Duty becomes uncovered |
| `PUBLISHED` | Zero-duty Administrative Absence | `PUBLISHED` | No (+0) | Roster unaffected |
| `AMENDED` | Replacement Assigned | `AMENDED` | Yes (+1) | Duty covered |
| `AMENDED` | Replacement Reversed | `AMENDED` | Yes (+1) | Duty returns to uncovered |
| `AMENDED` | Final Phase 6 Absence Reversed | `PUBLISHED` | Yes (+1) | Assumes zero active Phase 5 amendments |
| `AMENDED` | Final Phase 6 Reversed (Phase 5 Active) | `AMENDED` | Yes (+1) | Phase 5 amendment keeps AMENDED |
| `PUBLISHED` | Close Period | `CLOSED` | Yes (+1) | Frozen |
| `AMENDED` | Close Period | `CLOSED` | Yes (+1) | Frozen |
| `CLOSED` | Attempt Absence / Replacement | `CLOSED` | No (Rejected) | CLOSED rejects mutations |
| `CLOSED` | Reopen (Active Amendments / Absences) | `AMENDED` | Yes (+1) | Restores AMENDED |
| `CLOSED` | Reopen (Zero Active Changes) | `PUBLISHED` | Yes (+1) | Restores PUBLISHED |

---

## 10. OperationLog & Recovery State Machine

### 10.1 Mutation Types
- `ABSENCE_CREATE`
- `REPLACEMENT_CREATE`
- `ABSENCE_REVERSE`
- `REPLACEMENT_REVERSE`

### 10.2 Transition Life Cycle
```text
[New Mutation] -> PENDING
                   |
     +-------------+-------------+
     |                           |
     v                           v
Pre-Persistence Failure     Domain Entity Persisted
     |                           |
     v                           +-------------------+
  FAILED                         |                   |
                            Success              Ambiguous / Timeout / Partial
                                 |                   |
                                 v                   v
                             CONFIRMED       RECOVERY_REQUIRED
                                                     |
                                            [Dedicated Recovery]
                                                     |
                                                     v
                                                 CONFIRMED
```

### 10.3 Failure-Window Classification
- **Pre-domain-persistence failures**: Operation log marked `FAILED`. Safe to abandon.
- **Post-domain-persistence failures**: If network drops, timeout occurs, or projection fails after entity insertion, operation is marked `RECOVERY_REQUIRED`.
- Never mark `FAILED` if authoritative domain state may have escaped to disk/sheets.

### 10.4 Dedicated Recovery Endpoints
- `rosterv2absencerecover`: Dedicated recovery for `ABSENCE_CREATE` and `ABSENCE_REVERSE`.
- `rosterv2replacementrecover`: Dedicated recovery for `REPLACEMENT_CREATE` and `REPLACEMENT_REVERSE`.
- **Invariance**: Preserves original `operationId`, prevents duplicate records, prevents double revision bumps, verifies payload hash idempotently.

### 10.5 Confirmed-Operation Boundary
Read models (`rosterv2current`, `rosterv2amendmenthistory`, `MasterRoster`) include **only CONFIRMED** operations. Operations in `PENDING`, `RECOVERY_REQUIRED`, or `FAILED` are completely invisible to regular readers.

---

## 11. Privacy & Boundary Rules

1. **DTO Scrubbing**:
   - `AdminNote`, confidential sick leave explanations, and administrative logs are delivered **only** when `isAdmin === true`.
   - Viewer DTOs strictly omit `AdminNote` and private internal fields.
2. **Medical Privacy**:
   - Viewers see only the operational code (`MC`, `EL`, `AL`, `COURSE`) and covering staff identity. No medical diagnoses or narrative text are exposed.
3. **No Cross-Role Cache Leakage**:
   - Admin responses are never cached in shared stores where viewer mode could read them.
4. **Requests Boundary**:
   - `Request` / `LeaveApplication` != Operational `Absence`.
   - No automatic conversion exists in Phase 6. Administrative leave approvals remain separate from operational roster absences.
5. **Locum Boundary**:
   - All replacements require authoritative registered `PersonId`s. Unregistered external locums are deferred until formal directory integration.

---

## 12. End-to-End Scenarios Certified

- **Scenario A (Uncovered MC)**:
  Published roster → Create MC on working PM duty with shortage accepted → Current reflects `MC (Uncovered)` → MasterRoster shows `MC` → Reverse MC → Current restored to `PM` → Period returns to `PUBLISHED`.
- **Scenario B (Covered MC)**:
  Published roster → Create MC on working PM duty → Assign Dr B as replacement → Current reflects Dr A `MC (Covered by Dr B)` and Dr B `PM (Covering Dr A)` → MasterRoster shows both → Reverse replacement → Duty returns to uncovered → Reverse MC → Baseline restored.
- **Scenario C (Multi-Day Absence)**:
  Doctor rostered on 10 Mar and 12 Mar (off on 11 Mar) → Record absence for 10–12 Mar → Exactly 2 duties affected → Zero fake duties invented for 11 Mar.
- **Scenario D (Zero-Duty Absence)**:
  Doctor with zero rostered duties → Record MC → Absence persisted in `RosterAbsences` → Current unchanged → MasterRoster unchanged → Revision unchanged → Period remains `PUBLISHED`.
- **Scenario E (Existing Phase 5 Amendment)**:
  Roster has active Phase 5 amendment (`EV-1`) → Create Phase 6 MC → Assign replacement → Reverse replacement → Reverse MC → Roster remains `AMENDED` due to surviving Phase 5 amendment.
- **Scenario F (Recovery Pipeline)**:
  Inject post-entity failure → UI transitions to `Recovery Required` with preserved `operationId` → User clicks `Retry / Reconcile` → Dedicated endpoint reconciles operation → Operation confirmed without duplicate records or revision divergence.

---

## 13. Regression & Test Accounting

### 13.1 Phase 6 Test Suite (`npm run test:phase6`)
- **Test Files**: 3
  - `tests/phase6/domain.test.mjs`
  - `tests/phase6/backend.test.mjs`
  - `tests/phase6/ui.test.mjs`
- **Total Tests**: 130
  - Backend & Domain tests: 87
  - Deterministic Puppeteer UI tests: 43
- **Passed**: 130
- **Failed**: 0
- **Skipped**: 0

### 13.2 Full Regression Suite (`npm test`)
- **Legacy Suite** (`npm run test:legacy`): 5 test files, all passed.
  - `src/utils/adapters.test.js`
  - `src/utils/cache.test.js`
  - `src/utils/quota.test.js`
  - `src/utils/holidays.test.js`
  - `src/utils/leaveTracking.test.js`
- **Phase 1** (`npm run test:phase1`): 5 test files, 95 tests passed, 0 failed.
- **Phase 2** (`npm run test:phase2`): 2 test files, 72 tests passed, 0 failed.
- **Phase 3** (`npm run test:phase3`): 4 test files, 76 tests passed, 0 failed.
- **Phase 4** (`npm run test:phase4`): 4 test files, 91 tests passed, 0 failed.
- **Phase 5** (`npm run test:phase5`): 4 test files, 132 tests passed, 0 failed.
- **Phase 6** (`npm run test:phase6`): 3 test files, 130 tests passed, 0 failed.
- **Total Node Test Runner Tests**: 596 tests passed, 0 failed, 0 skipped across 22 test files.
- **Combined Test Files**: 27 test files (5 legacy + 22 node:test).

### 13.3 Build Verification
- `npm run build:appscript`: Succeeded (`Generated local appscript.txt; nothing deployed.`).
- `node scripts/build-appscript.mjs --check`: Succeeded (`Apps Script bundle matches shared frontend contract and backend adapter.`).
- `npm run build`: Succeeded (Vite bundle built in 10.31s).
- `git diff --check`: Clean (0 whitespace/formatting errors).

---

## 14. Production Separation & Isolation

- **Production Git Branch**: `origin/main` remains at `17712a4` (legacy frontend safety hotfix).
- **Production Apps Script**: Remains V1.1 legacy safety backend.
- **Zero Deployment**: No Phase 6 code deployed to production.
- **Zero Production Sheet Mutations**: All testing and verification executed against isolated mocks and local fixtures.

---

## 15. Deferred Work

### Deferred to Phase 7
1. **GOFF Ledger**: Guaranteed Off-Day tracking, credit generation, and consumption accounting.
2. **Public Holiday Credit Accounting**: Entitlement tracking for working on gazetted public holidays.
3. **Leave Tracking Harmonization**: Entitlement debiting connected to operational absences.

### Deferred to Later Phases
1. **Locum Directory Integration**: Registration and authoritative ID assignment for external relief doctors.
2. **Desktop UI Polish**: High-density desktop roster views and keyboard shortcuts.
3. **Production Migration & Cutover**: Formal cutover plan from V1.1 to V2 backend.
