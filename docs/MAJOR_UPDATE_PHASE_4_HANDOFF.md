# Phase 4 — Roster Lifecycle, Planned Snapshots, MasterRoster Projection, and Edit Locks

**Verdict: PASS for local Phase 4 implementation, end-to-end certification, and handoff. No Phase 5 scope.**

Implementation started on branch `feature/phase-4-lifecycle` from commit baseline `894b04e85f565f5c0aee77cc84494f02fe289a79`. All Phase 4 slices (Slice 1, Slice 1.1, Slice 2, Slice 3, Slice 4, and Slice 5) and intermediate audit/correction checkpoints were completed in the authoritative workspace `C:\Dev\REQUEST-APP`.

---

## 1. Scope Completed

1. **Pure Lifecycle State Machine (`src/features/roster/lifecycle.js`)**:
   - Canonical states: `DRAFT`, `PUBLISHED`, `CLOSED`.
   - Transitions permitted: `DRAFT -> PUBLISHED` (Publish), `PUBLISHED -> CLOSED` (Close), `CLOSED -> PUBLISHED` (Reopen).
   - `AMENDED` reserved strictly for Phase 5 (`validateTransition` rejects with `AMENDED_RESERVED_PHASE5`).
   - Operation classes: `LIFECYCLE` distinct from `DRAFT_PATCH`.
   - All state transitions require an authenticated actor. Reopen strictly requires a non-empty audit reason (`REOPEN_REASON_REQUIRED`).
2. **Canonical Data Schemas**:
   - `RosterPeriods`: `PeriodId`, `State`, `Revision`, `PlannedSnapshotId`, `ProjectionChecksum`, `PublishedAt`, `PublishedBy`, `ClosedAt`, `ClosedBy`, `ReopenedAt`, `ReopenedBy`, `LastOperationId`, `SchemaVersion`, `EnrolledAt`, `EnrolledBy`, `UpdatedAt`.
   - `RosterAssignments`: `AssignmentId`, `PeriodId`, `PersonId`, `Date`, `ShiftCode`, `Layer` (`PLANNED`), `SnapshotId`, `CreatedAt`, `CreatedBy`.
   - `RosterEvents`: `EventId`, `PeriodId`, `EventType` (`PUBLISH`, `CLOSE`, `REOPEN`), `StateBefore`, `StateAfter`, `RevisionBefore`, `RevisionAfter`, `OperationId`, `Actor`, `AdminNote`, `Timestamp`.
   - `WeeklyOffSnapshots`: `WeekSnapshotId`, `WeekStart`, `WeekEnd`, `PersonId`, `EvaluationState` (`PROVISIONAL` or `COMPLETE`), `PolicyCode`, `PolicyLockedByPeriodId`, `RequiredOffCount`, `AssignedOffCountAtPublish`, `HasQualifyingPlannedNight`, `PlannedWeekChecksum`, `PublishedPeriodIdsJson`, `PublishedDateMask`, `Revision`, `OperationId`, `CreatedAt`, `CompletedAt`.
3. **Deterministic Planned Snapshot & Projection**:
   - `generatePlannedSnapshot`: Deterministic assignment generation, canonical ID generation (`asn:<hash>`), immutable snapshot ID (`snp:<period>:<hash>`), strictly month-bounded dates and registered person IDs.
   - `generateMasterRosterProjection`: Projections adhering to the Version 1 legacy row contract (`Name`, `Date`, `Shift`).
   - `computeProjectionChecksum`: Canonical SHA-256 digest over sorted, whitespace-significant, type-normalized projection rows.
   - `mergeMasterRosterProjection`: Atomically isolates the target monthly slice while byte-preserving all non-target months in `MasterRoster`.
4. **WeeklyOffSnapshots Boundary Aggregation**:
   - Monday–Sunday cross-month weeks: first touching month locks the applicable policy.
   - Boundary weeks remain `PROVISIONAL` until all 7 days are represented; publishing the adjacent month completes the week without replacing the locked policy.
   - EP identities and assignments are strictly excluded from MO weekly entitlement snapshots.
5. **Apps Script Backend Engine (`backend/roster-lifecycle.gs`)**:
   - Endpoints: `rosterv2publish`, `rosterv2close`, `rosterv2reopen`, `rosterv2lifecyclerecover`, `rosterv2periodlifecycle`, `rosterv2lifecycleschema`.
   - Serialized `ScriptLock` (10s timeout), transactional journal logging (`OperationLog`), idempotency verification (`payloadHash`), and expected revision checks (`REVISION_CONFLICT`).
   - Readback verification of persisted `MasterRoster` rows: immediately calculates projection checksum on persisted cells and aborts with `CHECKSUM_MISMATCH / RECOVERY_REQUIRED` if corrupted.
6. **Client Queue Integration (`draftQueue.js`, `draftRepository.js`)**:
   - Stable `operationId` preserved across timeout, retry, reload, and recovery.
   - Pre-publish flush: flushes debounced draft writes, verifies preceding draft operations are confirmed before dispatching `PERIOD_PUBLISH`.
   - Lifecycle revision separation: Concurrency revision uses `current.lifecycle.revision` (not draft revision).
   - Write guards: Enqueuing draft edits against `PUBLISHED` or `CLOSED` periods immediately throws `SNAPSHOT_IMMUTABLE` or `INVALID_STATE`.
   - Multi-tab and out-of-order reconciliation: monotonic non-decreasing revision guarantees older delayed server responses cannot regress state.
7. **UI Lifecycle Controls & Editing Locks (`LifecycleControls.jsx`, `RosterPage.jsx`, `DraftQueuePanel.jsx`)**:
   - Canonical UI administrator detection (`selectedName?.trim().toLowerCase() === 'admin'`) guarded by `AdminPinModal`.
   - Modals for Publish, Close, and Reopen with terms, confirmation warnings, and audit reason inputs.
   - Status badges (`Draft`, `Published`, `Closed`, `Recovery Required`, in-flight pending indicators).
   - Comprehensive lock coverage: Standard edit mode, copy/paste edit mode, standby edit mode, extended edit mode, direct cell popover reassignment, EP painter, batch fill, save handlers, and `DraftQueuePanel` are completely disabled and replaced with locked indicators when `isPeriodLocked`.

---

## 2. Lifecycle State Contract

```text
               +----------------------------------+
               |              DRAFT               |
               +----------------------------------+
                                |
                                | PERIOD_PUBLISH (generates planned snapshot & projection)
                                v
               +----------------------------------+
               |            PUBLISHED             | <---------------+
               +----------------------------------+                 |
                     |                      ^                       |
                     | PERIOD_CLOSE         | PERIOD_REOPEN         |
                     v                      | (audit reason req'd)  |
               +----------------------------------+                 |
               |              CLOSED              | ----------------+
               +----------------------------------+
```

- **`DRAFT`**: Draft editing permitted in private queue; unenrolled legacy periods remain unmanaged.
- **`PUBLISHED`**: Planned snapshot and `MasterRoster` projection committed and immutable. Normal draft editing is locked.
- **`CLOSED`**: Period historically closed after reconciliation. UI and queue are fully read-only.
- **`AMENDED`**: Reserved for Phase 5. Any attempt to transition to `AMENDED` in Phase 4 is rejected with `AMENDED_RESERVED_PHASE5`.

---

## 3. Data Structures

### `RosterPeriods`
| Column | Description |
| :--- | :--- |
| `PeriodId` | ISO month format `YYYY-MM` (Primary Key) |
| `State` | `DRAFT`, `PUBLISHED`, or `CLOSED` |
| `Revision` | Monotonically increasing integer revision counter |
| `PlannedSnapshotId` | Deterministic snapshot identifier (`snp:<periodId>:<hash>`) |
| `ProjectionChecksum` | SHA-256 digest of the persisted `MasterRoster` rows for this period |
| `PublishedAt` | ISO timestamp of publication |
| `PublishedBy` | Administrator email who published the roster |
| `ClosedAt` | ISO timestamp of closing |
| `ClosedBy` | Administrator email who closed the period |
| `ReopenedAt` | ISO timestamp of the latest reopening |
| `ReopenedBy` | Administrator email who reopened the period |
| `LastOperationId` | UUID of the most recent mutating lifecycle operation |
| `SchemaVersion` | Always `2` for Phase 4+ |
| `EnrolledAt` | Preserved Phase 1 enrollment timestamp |
| `EnrolledBy` | Preserved Phase 1 enrollment identity |
| `UpdatedAt` | ISO timestamp of the last record update |

### `RosterAssignments`
| Column | Description |
| :--- | :--- |
| `AssignmentId` | Canonical deterministic ID (`asn:<hash>`) |
| `PeriodId` | ISO month `YYYY-MM` |
| `PersonId` | UUID of the registered person |
| `Date` | ISO date `YYYY-MM-DD` |
| `ShiftCode` | Semantic canonical shift code |
| `Layer` | Always `PLANNED` in Phase 4 |
| `SnapshotId` | References `RosterPeriods.PlannedSnapshotId` |
| `CreatedAt` | ISO timestamp |
| `CreatedBy` | Administrator email |

### `RosterEvents`
| Column | Description |
| :--- | :--- |
| `EventId` | UUID event identifier |
| `PeriodId` | ISO month `YYYY-MM` |
| `EventType` | `PUBLISH`, `CLOSE`, or `REOPEN` |
| `StateBefore` | Lifecycle state prior to mutation |
| `StateAfter` | Lifecycle state following mutation |
| `RevisionBefore` | Lifecycle revision prior to mutation |
| `RevisionAfter` | Lifecycle revision following mutation |
| `OperationId` | UUID of the operation producing this event |
| `Actor` | Authenticated administrator email |
| `AdminNote` | Reason or note supplied with the action |
| `Timestamp` | ISO timestamp |

### `WeeklyOffSnapshots`
| Column | Description |
| :--- | :--- |
| `WeekSnapshotId` | Unique weekly snapshot UUID |
| `WeekStart` | Monday ISO date `YYYY-MM-DD` |
| `WeekEnd` | Sunday ISO date `YYYY-MM-DD` |
| `PersonId` | UUID of registered doctor |
| `EvaluationState` | `PROVISIONAL` (boundary week partially published) or `COMPLETE` |
| `PolicyCode` | `A` or `B` |
| `PolicyLockedByPeriodId`| First touching period that locked this policy |
| `RequiredOffCount` | Target OFF count under active policy |
| `AssignedOffCountAtPublish` | Planned OFF count present in the snapshot |
| `HasQualifyingPlannedNight`| Boolean indicator for night bundle qualification |
| `PlannedWeekChecksum` | Deterministic SHA-256 digest of the weekly assignments |
| `PublishedPeriodIdsJson`| JSON array of periods contributing to this week |
| `PublishedDateMask` | Boolean array of length 7 indicating covered days |
| `Revision` | Integer snapshot revision |
| `OperationId` | Mutating operation UUID |
| `CreatedAt` | ISO timestamp |
| `CompletedAt` | ISO timestamp when transition to `COMPLETE` occurred |

---

## 4. Publish Semantics

1. **Validation & Locking**:
   - ScriptLock acquired.
   - Feature switches `roster_v2_write_enabled` and `write_queue_v2_enabled` verified before and after lock acquisition.
   - `expectedRevision` validated against `RosterPeriods.Revision`.
2. **Deterministic Generation**:
   - `generatePlannedSnapshot` builds planned assignments and assigns stable IDs.
   - `aggregateWeeklyOffSnapshots` evaluates weekly off rules and locks policies.
   - `generateMasterRosterProjection` maps assignments to legacy `{ Name, Date, Shift }`.
   - `mergeMasterRosterProjection` merges target month while preserving all other months.
3. **Idempotent Storage & Verification**:
   - Existing assignments for the snapshot ID are deduplicated prior to append.
   - `WeeklyOffSnapshots` matched by `(WeekStart, PersonId)` and updated in-place.
   - `MasterRoster` overwritten with merged matrix.
   - `MasterRoster` persisted cells are read back and the checksum verified against expected checksum.
   - If checksum mismatches, period remains in `DRAFT`, operation status is set to `RECOVERY_REQUIRED`, and `CHECKSUM_MISMATCH` is thrown.
4. **Completion**:
   - `RosterPeriods` updated to `PUBLISHED` with new snapshot ID, checksum, and incremented revision.
   - Audit event appended to `RosterEvents`.
   - `OperationLog` updated to `CONFIRMED`.

---

## 5. Recovery Semantics

Phase 4 defines two distinct recovery workflows:

1. **Publish Operation Retry (Incomplete / Mismatched Publish Repair)**:
   - When a publish operation fails mid-flight (e.g. timeout, partial assignment write, partial `WeeklyOffSnapshots` write, or `CHECKSUM_MISMATCH`), the period remains `DRAFT` (or enters `RECOVERY_REQUIRED`).
   - The client retries the **exact same `operationId`** with the identical payload.
   - The backend detects the existing journal row, re-runs the snapshot generation, deduplicates existing rows in `RosterAssignments`, updates `WeeklyOffSnapshots` in-place, writes `MasterRoster`, validates the readback checksum, and completes the transition without creating duplicate records.
2. **Canonical State Recovery (`rosterv2lifecyclerecover`)**:
   - When a mutation (Publish, Close, or Reopen) was fully committed in `RosterPeriods` on the server, but network loss prevented the client from receiving the HTTP response, the client calls `recover(operationId)`.
   - `rosterv2lifecyclerecover` reads the canonical state from `RosterPeriods` / `OperationLog`, confirms that the operation took effect, and returns `{ ok: true, status: 'CONFIRMED', state, revision }`.
   - This prevents redundant replay of state transitions and resolves stuck client outboxes safely.

---

## 6. Compatibility & Safeguards

- **Phase 1 Metadata Preservation**:
  - The additive schema upgrade preserves `EnrolledAt`, `EnrolledBy`, and any unknown custom columns in `RosterPeriods`.
  - Upgrades are strictly idempotent; compatibility readers (`rosterV2Period_`, `rosterDraftEnrollment_`, `periodInfo`) work seamlessly across Phase 1, Phase 2, and Phase 4 schemas.
- **Legacy Period Protection**:
  - Non-enrolled periods return `period: null` from `rosterLifecycleFindPeriod_`.
  - Viewing a legacy period does NOT auto-enroll it.
  - `LifecycleControls` renders `null` (no badges or action buttons).
  - Legacy editing modes and upload handlers function with zero behavioral changes.
- **Period-Aware Upload Protection**:
  - `handleUploadMasterRoster_` checks each month represented in an uploaded CSV/JSON payload.
  - If any month in the upload is enrolled in V2 (`RosterPeriods` exists), the global upload is blocked atomically before modifying any data.
  - Legacy uploads containing only non-enrolled months continue to work normally when `legacy_upload_enabled = true`.
- **Feature Switches**:
  - `roster_v2_read_enabled`: Required for lifecycle status retrieval.
  - `roster_v2_write_enabled` AND `write_queue_v2_enabled`: Both strictly required for lifecycle mutations. Disabling either turns off mutation buttons and returns `FEATURE_DISABLED` from the backend.

---

## 7. Test Results & Regression Matrix

All tests run cleanly with zero failures.

| Test Command | Scope | Result | Details |
| :--- | :--- | :---: | :--- |
| `npm run test:legacy` | Legacy helper adapters | **PASS** | 5 test files passed |
| `npm run test:phase1` | Phase 1 schema, projection, foundation | **PASS** | 66 passed, 0 failed |
| `npm run test:phase2` | Phase 2 queue, IndexedDB, recovery | **PASS** | 72 passed, 0 failed |
| `npm run test:phase3` | Phase 3 guidance, policies, night rules | **PASS** | 76 passed, 0 failed |
| `npm run test:phase4` | Phase 4 lifecycle, backend, client, UI | **PASS** | **91 passed**, 0 failed |
| `npm test` | Complete sequential regression run | **PASS** | **305 passed** (plus 5 legacy test files) |
| `npm run build:appscript` | Apps Script bundle generation | **PASS** | Generated `appscript.txt` cleanly |
| `node scripts/build-appscript.mjs --check` | Bundle parity validation | **PASS** | Apps Script bundle matches shared contract |
| `npm run build` | Vite production build | **PASS** | 1,889 modules transformed cleanly |
| `git diff --check` | Whitespace & syntax lint | **PASS** | Zero whitespace or format errors |

### Phase 4 Test Breakdown (91 tests):
- `tests/phase4/lifecycle.test.mjs`: **21 passed** (state machine, deterministic planned snapshot, projection checksum, merge logic, weekly off boundary evaluation).
- `tests/phase4/backend.test.mjs`: **37 passed** (schema upgrades, publish, close, reopen, retry after partial assignment persistence, retry after partial `WeeklyOffSnapshots` persistence, critical retry window, MasterRoster write failure recovery, checksum mismatch recovery, legacy upload protection, idempotency mismatch guards, expected revision conflict checks).
- `tests/phase4/client.test.mjs`: **14 passed** across 9 sub-suites (transport mapping, stable operation identity, draft flush & ordering, write guards, checksum mismatch retry repair, close/reopen client behavior, out-of-order monotonic reconciliation, multi-tab coordination, legacy compatibility).
- `tests/phase4/ui.test.mjs`: **19 passed** in real headless Puppeteer browser (draft/published/closed badges, modal terms, double-click suppression, revision conflict dialogs, DraftQueuePanel lock banners, close/reopen modals, in-flight pending spinners, recovery required badges, non-admin button hiding, switch gating, month switching isolation, unenrolled period suppression).

---

## 8. Known Limitations & Deferred Work

The following features were intentionally excluded from Phase 4 and remain scheduled for future phases:

- **Phase 5**: Amendments workflow (`AMENDED` state), Current vs Planned delta tracking, amendment reason capture, operational shift edits after publication.
- **Phase 5**: Operational undo and audit trail extensions.
- **Phase 6**: Absence & replacement workflow (MC/EL/AL leave cover requests, replacement linkage).
- **Phase 7**: Guaranteed OFF (`GOFF`) ledger, debt accounting, entitlement expiration.
- **Phase 8**: Desktop workspace layout refinements, drag-and-drop enhancements.
- **Phase 9**: Production migration, dual-write verification, and final cutover.

---

## 9. Final Phase 4 Certification Decision

**PHASE_4_CERTIFIED**

Phase 4 meets all functional, architectural, safety, and compatibility requirements. All unit, integration, fault-injection, and browser-driven regression tests pass. The branch `feature/phase-4-lifecycle` is certified and ready to be merged into `major-update-v2`.
