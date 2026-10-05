# Phase 5 — Amendment Workflows, Read Models, 10-Second Undo & End-to-End Certification

**Verdict: PASS for local Phase 5 implementation, end-to-end certification, and handoff. Ready for Phase 6.**

Implementation baseline on branch `feature/phase-5-amendments` with starting checkpoint `5a51c6c980a541b13f163c59bee354517e3bd54d`, incorporating frontend compatibility fix `2943569971f795321ced51300c78e61e939647c1`. All Phase 5 slices (Slice 1, Slice 2, Slice 3.1, Slice 3.2, Slice 4, and Slice 5) have been verified and certified in the authoritative workspace `C:\Dev\REQUEST-APP`.

---

## 1. Scope Completed

1. **Phase 5 Data Model & Event Schemas (`backend/roster-lifecycle.gs`, `src/features/roster/lifecycle.js`)**:
   - Event types: `ADMIN_CORRECTION`, `SWAP`, `REVERSAL` in addition to Phase 4 `PUBLISH`, `CLOSE`, `REOPEN`.
   - Multi-line atomic operations: A `SWAP` produces two `RosterEvents` lines sharing a single `EventId`, incrementing `Revision` once, and committing atomically.
   - PublicReasonCode catalogue: `DUTY_ROSTER_AMENDMENT`, `DUTY_SWAP`, `SCHEDULE_OPTIMIZATION`, `CORRECTION_TYPO`, `ADMIN_OVERRIDE`.
   - Privacy boundary: `AdminNote` is preserved in `RosterEvents` for administrative audit, but is strictly stripped from all viewer-facing DTOs.
2. **Authoritative Three-Layer Roster Architecture**:
   - **Planned (`GET rosterv2planned?periodId=YYYY-MM`)**: Read model sourced directly from `RosterAssignments` where `Layer='PLANNED'`. Frozen at publication, immutable across amendments and reversals.
   - **Current (`GET rosterv2current?periodId=YYYY-MM`)**: Authoritative read model resolving `Planned` snapshot plus confirmed amendment events in strict revision order. Identifies assignments by `PersonId + Date + DutyDomain`. Never reconstructs from `MasterRoster` or reverse-maps display names.
   - **Changes (`GET rosterv2amendmenthistory?periodId=YYYY-MM`)**: Append-only log of confirmed amendment events grouped by `EventId`. Multi-line swaps presented as single logical entries; reversals recorded as compensating events without deleting original history.
   - **MasterRoster Projection**: Compatibility layer synchronized from resolved `Current` state with verified checksums. Remains a passive consumer, never the source of truth.
3. **Phase 5 Lifecycle State Machine**:
   - `DRAFT -> PUBLISHED`: Publication freezes immutable Planned snapshot, initializes Current, projects to MasterRoster.
   - `PUBLISHED -> AMENDED`: First confirmed amendment advances state to `AMENDED` and increments period revision.
   - `AMENDED -> AMENDED`: Subsequent amendments advance revision monotonically.
   - `AMENDED -> PUBLISHED`: Compensating reversal of the final remaining active amendment cleanly returns effective lifecycle state to `PUBLISHED`.
   - `PUBLISHED -> CLOSED` and `AMENDED -> CLOSED`: Supported closing transitions.
   - `CLOSED -> AMENDED` or `CLOSED -> PUBLISHED`: Reopening dynamically evaluates whether active amendments remain in history.
   - Forbidden transitions: `DRAFT -> CLOSED` (forbidden), `PUBLISHED/AMENDED -> DRAFT` (forbidden).
4. **Client Queue & Durability (`draftQueue.js`, `draftRepository.js`)**:
   - Endpoints integrated: `queue.amend(payload)`, `queue.reverse(payload)`, `queue.getHistory(periodId)`.
   - Deterministic stable `operationId` preserved across timeouts, retries, and page reloads.
   - Monotonic revision checks preventing stale writes (`REVISION_CONFLICT`).
   - Web Locks coordination preventing concurrent multi-tab mutation races.
   - Outbox recovery: Unsettled operations reconciled before re-enqueuing.
5. **Phase 5 UI Experience (`Phase5RosterContainer.jsx`, `PlannedRosterView.jsx`, `CurrentRosterView.jsx`, `AmendmentHistoryPanel.jsx`, `UndoToast.jsx`)**:
   - View mode switcher: `Current` (default), `Planned` (read-only baseline with locked badge), `Changes` (confirmed audit trail).
   - Dynamic comparison indicators: `CurrentRosterView` highlights modified cells with visual diff badges against Planned baseline.
   - Amendment & Swap Modals: Form with required `PublicReasonCode`, role-gated `AdminNote`, and authoritative identity selection.
   - 10-Second Undo: Dismissible floating toast with countdown bar shown upon successful amendment/swap, invoking genuine compensating reversal via queue without timer leaks.
6. **Legacy Roster Safety & Compatibility (`src/api.js`, `src/App.jsx`, `src/components/RosterPage.jsx`)**:
   - Fail-closed client-side validation on `uploadMasterRoster(rows, targetMonth)` requiring canonical `YYYY-MM`.
   - Historical month saves strictly scoped to target month without cross-month grid contamination.
   - Fully backward-compatible with legacy requests, shift blocks, and holiday management.

---

## 2. Architecture & Data Flow

```text
                               +-----------------------------+
                               |     Draft / Pre-Publish     |
                               +-----------------------------+
                                              |
                                              | Publish
                                              v
+-----------------------------------------------------------------------------------------+
|                                 Authoritative Backend                                   |
|                                                                                         |
|   +-----------------------+              +------------------------------------------+   |
|   |   RosterAssignments   |              |               RosterEvents               |   |
|   |    (Layer='PLANNED')  |              |        (Append-Only Mutation Log)        |   |
|   +-----------------------+              +------------------------------------------+   |
|               |                                       |                                 |
|               | (Frozen Snapshot)                     | (Confirmed Operations Only)     |
|               v                                       v                                 |
|     +-------------------+                 +------------------------+                    |
|     |  rosterv2planned  |                 |     Phase 5 Resolver   |                    |
|     +-------------------+                 +------------------------+                    |
|               |                                       |                                 |
|               |                                       +----------------+                |
|               |                                       |                |                |
|               |                                       v                v                |
|               |                           +------------------+   +-------------------+  |
|               |                           |  rosterv2current |   | rosterv2amendment |  |
|               |                           +------------------+   |     history       |  |
|               |                                    |             +-------------------+  |
|               |                                    v                                    |
|               |                         +----------------------+                        |
|               |                         | MasterRoster (Sheet) |                        |
|               |                         | (Legacy Projection)  |                        |
|               |                         +----------------------+                        |
+---------------|------------------------------------|------------------------------------+
                |                                    |
                v                                    v
+-----------------------------------------------------------------------------------------+
|                                    Frontend UI Views                                    |
|                                                                                         |
|   [ Planned View ]                 [ Current View (Default) ]          [ Changes View ] |
|   - Read-only                      - Live duty assignments             - Audit trail    |
|   - Baseline reference             - Visual diff vs Planned            - Grouped swaps  |
|   - Zero edit controls             - Admin amendment & swap actions    - Reversal notes |
|                                    - 10-Second Undo Toast                               |
+-----------------------------------------------------------------------------------------+
```

---

## 3. Data Structures & Entities

### `RosterEvents` (Phase 5 Amendments)
| Field | Type | Description |
| :--- | :--- | :--- |
| `EventId` | string | Canonical UUID shared across all lines of a logical event (e.g. SWAP) |
| `LineId` | string | Sub-operation identifier (`line:1`, `line:2`) |
| `PeriodId` | string | ISO month format `YYYY-MM` |
| `EventType` | string | `ADMIN_CORRECTION`, `SWAP`, `REVERSAL`, `PUBLISH`, `CLOSE`, `REOPEN` |
| `PersonId` | string | Authoritative employee identifier |
| `PersonNameSnapshot` | string | Human display name at the time of amendment |
| `Date` | string | Target assignment date (`YYYY-MM-DD`) |
| `DutyDomain` | string | Assignment domain (`MO`, `EP`) |
| `ShiftBefore` | string | Shift code prior to event resolution |
| `ShiftAfter` | string | New shift code applied by event |
| `PublicReasonCode` | string | Enumerated audit reason |
| `AdminNote` | string | Optional administrative context (Private to Admins) |
| `ResultRevision` | number | Resulting period revision after this event commit |
| `OperationId` | string | Client-supplied UUID for idempotency and recovery |
| `Status` | string | `ACTIVE` or `REVERSED` |
| `ReversedByEventId` | string | EventId of the compensating reversal (if reversed) |
| `CreatedAt` | string | ISO 8601 creation timestamp |
| `CreatedBy` | string | Email/username of the mutating actor |

---

## 4. Endpoints Certified

1. **`GET rosterv2planned?periodId=YYYY-MM`**:
   - Returns immutable Planned assignments (`Layer='PLANNED'`).
   - Sorted canonically by `Date ASC, ShiftCode ASC, PersonId ASC`.
   - Viewer safe; excludes draft rows and unconfirmed operations.
2. **`GET rosterv2current?periodId=YYYY-MM`**:
   - Returns authoritative current assignments resolved from Planned + active confirmed amendments.
   - Includes `diffStatus`: `UNCHANGED`, `MODIFIED`, `ADDED`, `REMOVED` relative to Planned.
   - Reports `effectiveState`: `DRAFT`, `PUBLISHED`, `AMENDED`, `CLOSED`.
3. **`GET rosterv2amendmenthistory?periodId=YYYY-MM`**:
   - Returns reverse-chronological confirmed event groups.
   - Strips `AdminNote` when requested by non-admin roles.
4. **`POST rosterv2amend`**:
   - Executes atomic `ADMIN_CORRECTION` or `SWAP`.
   - Validates `expectedRevision`, `DutyDomain`, and required `PublicReasonCode`.
   - Updates `MasterRoster` projection atomically with checksum readback verification.
5. **`POST rosterv2reversal`**:
   - Creates append-only compensating reversal for an active amendment.
   - Rejects dependency conflicts if newer active amendments touched the same cell.
   - Dynamically transitions period to `PUBLISHED` if 0 active amendments remain.

---

## 5. Certification Test Results

All regression and certification suites pass 100%:

| Test Suite | Files | Tests/Subtests | Status |
| :--- | :---: | :---: | :---: |
| **Legacy Helpers** (`npm run test:legacy`) | 5 | 5 | **PASS** |
| **Phase 1 Foundations** (`npm run test:phase1`) | 5 | 95 | **PASS** |
| **Phase 2 Ordered Recovery** (`npm run test:phase2`) | 4 | 72 | **PASS** |
| **Phase 3 Roster Guidance** (`npm run test:phase3`) | 4 | 76 | **PASS** |
| **Phase 4 Lifecycle & Snapshots** (`npm run test:phase4`) | 4 | 91 | **PASS** |
| **Phase 5 Amendments & Read Models** (`npm run test:phase5`) | 4 | 132 | **PASS** |
| **Total Test Execution** (`npm test`) | **26 files** | **471 subtests** | **PASS (0 failures)** |

### Build & Integrity Validations
- `npm run build:appscript`: Succeeded; local `appscript.txt` regenerated.
- `node scripts/build-appscript.mjs --check`: Succeeded; bundle matches shared contract.
- `npm run build`: Succeeded; production bundle compiled cleanly (1,896 modules transformed).
- `git diff --check`: Succeeded; zero whitespace or line-ending anomalies.

---

## 6. Production Separation & Isolation

- **Production Deployments**:
  - Live GitHub Pages site runs `main` at commit `17712a4f7e177771ff3cf44d02d7ba570f567d21`.
  - Production Google Apps Script runs the isolated V1.1 legacy safety hotfix.
  - Zero Phase 5 features, endpoints, or UI controls are deployed to production.
- **Branch Isolation**:
  - Phase 5 remains isolated on `feature/phase-5-amendments`.
  - No merge to `main` has occurred.

---

## 7. Deferred Work Boundaries

The following scopes are intentionally deferred to future phases:

### Deferred to Phase 6 (Absence & Operational Coverage):
- Absence workflows: Medical Certificate (`MC`), Emergency Leave (`EL`), Annual Leave (`AL`), Course (`COURSE`).
- Locum / relief doctor coverage assignments.
- Absence balance reconciliation.

### Deferred to Phase 7 (GOFF Accounting & Entitlements):
- Guaranteed Off (`GOFF`) ledger and replacement calculations.
- Public holiday shift credits tracking.

### Deferred to Later Phases:
- Desktop spreadsheet refinements and batch keyboard editing for Current view.
- Final cutover and production migration plan for V2 backend deployment.

---

**Certified by Antigravity IDE Automation Agent.**
**Phase 5 Slice 5 complete. System ready for Phase 6.**
