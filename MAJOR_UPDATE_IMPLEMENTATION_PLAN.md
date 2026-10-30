# Major Roster Update — Implementation Plan

> **Status:** Phase 0 PASSED with owner approval on 2026-09-07. Phase 1 implemented and locally verified; no deployment or Phase 2+ work.\
> **Source baseline inspected:** `C:\Users\DR-AFIF\Documents\GitHub\REQUEST-APP`, commit `a852f0a` (2026-09-04), `main` branch. Before this revision, Git reported only this plan and `MAJOR_UPDATE_SPEC.md` as untracked files.\
> **Original documentation scope:** This plan and `MAJOR_UPDATE_SPEC.md` only. No application code, configuration, dependency, deployed Apps Script, or production Google Sheets data was changed. The subsequent Phase 0 assessment is maintained in `docs/MAJOR_UPDATE_PHASE_0_READINESS.md`.

## Current implementation record

Phase 0 closure and its owner-supplied evidence supersede historical evidence gaps below; see docs/MAJOR_UPDATE_PHASE_0_READINESS.md. Phase 1 architecture, minimum additive headers, generated shared frontend/Apps Script contract, disabled defaults, opt-in shadow endpoints, administrator boundary and exact checks are in docs/MAJOR_UPDATE_PHASE_1_HANDOFF.md. The immutable Version 1 baseline remains the legacy contract oracle; current appscript.txt is an undeployed development change.

Apply the 2026-09-07 owner-approved semantics/identity/anomaly clarifications recorded at the start of MAJOR_UPDATE_SPEC.md. In particular COURT is worked without ED coverage, EPs are excluded from MO rules, multiple assignments remain separate, and historical anomalies are never automatically repaired. All eight new v2 switches are OFF; the separate legacy-upload permission retains legacy availability only while no enrollment exists. Phase 1 effective workflow flags remain disabled regardless of configured values; explicit read-only shadow diagnostics are available. No remote tabs were created or periods enrolled. Stop after Phase 1.

## 1. Executive summary

The safest implementation is additive and journaled:

1. keep the current `MasterRoster` sheet and current viewer contract as a compatibility projection;
2. introduce stable person IDs and new versioned records for drafts, planned snapshots, lifecycle/amendment events, weekly policy snapshots, and GOFF transactions;
3. establish one configurable semantic shift-classification layer before OFF, staffing, night-bundle, consecutive-work, replacement, or GOFF logic, with `PN` classified as Policy-B-qualifying, transparent for consecutive work, non-staffing, and eligible to displace OFF;
4. make new records canonical only for explicitly enrolled roster periods while allowing each month to publish independently and share provisional/complete week records by `weekStart`;
5. protect every official write with a script lock, client operation ID, expected period revision, and a durable operation journal;
6. move the write queue/recovery foundation earlier than the originally suggested sequence because all later lifecycle and ledger phases depend on it; and
7. rehearse against a copy of the workbook, reconcile projections, and enable features separately.

Relative sizing uses **S / M / L / XL**. These are complexity/risk indicators, not time promises.

## 2. Evidence reviewed and boundaries

### 2.1 Repository materials reviewed

- `README.md`, `plan.md`, `docs/PROJECT_NOTES.md`, and `docs/GHKA_MEMO_EXPORT.md`.
- All current `src/` file names and responsibilities, with detailed inspection of roster, navigation, state/API orchestration, analytics/tally, PH/GHKA, leave, cache, normalization, and admin flows.
- `appscript.txt`, including all actions, sheet creation/header contracts, full-roster replacement, Settings behavior, and the limited uses of `LockService`.
- Existing utility tests, `package.json`, Vite/Tailwind setup, service worker, and Pages workflow.
- Recent Git history and current working-tree state.

No applicable `AGENTS.md` exists in the source repository. There is no product specification, architecture specification, data-model document, acceptance-test document, or changelog beyond the materials listed above.

### 2.2 Production and copied-test Sheets boundary

The bundled Apps Script contract is verified; the production workbook contents are not. Calling the current `alldata` endpoint is not guaranteed read-only: getters create missing sheets, and `getActivityHistoryData()` can mark past rows Archived. The initial documentation task did not query it. During the approved Phase 0 continuation on 2026-09-04, the test-only deployment connected to a copied test workbook was queried. Its API-visible fields, row counts, date representations, real shift codes, directory state, Settings JSON, and duplicate/multiple-assignment groups are recorded in `docs/MAJOR_UPDATE_PHASE_0_READINESS.md`; the production endpoint was not called.

Before implementation, finish the evidence unavailable from that endpoint by using a read-only copied-workbook view/export and deployment records:

- exact tab names and header order;
- extra/manual columns not represented by `appscript.txt`;
- date display/storage types and timezone;
- duplicate person/date/shift rows;
- all shift codes and modifiers actually in use;
- deployment version versus repository `appscript.txt`;
- row counts, formulas, protections, named ranges, and manual workflows; and
- whether old months remain present in `MasterRoster` despite the current global-clear upload behavior.

## 3. Current architecture

```text
Browser / GitHub Pages (Vite + React)
  App.jsx
    ├─ cache-first localStorage hydration
    ├─ one-minute fetchAllData refresh
    ├─ optimistic whole-array mutations + toasts
    └─ page/component props
          ↓
  api.js (GET query actions; POST text/plain JSON actions)
          ↓
Google Apps Script web app (appscript.txt)
          ↓
Google Sheets tabs (system of record)
```

The PWA service worker caches static GET responses using stale-while-revalidate behavior. It does not persist a mutation outbox.

### 3.1 Relevant files and current responsibilities

| File | Verified responsibility and relevance |
|---|---|
| `src/App.jsx` | Root state, localStorage cache, refresh loop, page routing, optimistic mutation/rollback, all-data adaptation. Primary integration point for a queue/data layer. |
| `src/api.js` | Thin Apps Script HTTP wrapper and action-specific calls. No operation ID, revision, timeout, retry policy, or cancellation. |
| `appscript.txt` | Backend router and direct Sheets operations. `uploadmasterroster` clears all roster rows. Only PH and leave writes currently use `LockService`. |
| `src/components/RosterPage.jsx` | 3,000+ line roster UI. Month construction, edit grids, save, calendar/table modes, tally, thresholds, comments, export, keyboard/paste editing. |
| `src/components/AppNavigation.jsx` | Fixed 16rem desktop rail and established mobile top/bottom navigation. No desktop collapse or focus mode. |
| `src/utils/rosterAnalytics.js` | Month-only normalized roster analytics, coverage issues, fairness, and health signals. Reusable pure logic, but no weekly-OFF/consecutive/rest engine; current active-shift logic includes `PN` and must not be reused as the new worked/staffing definition. |
| `src/utils/publicHolidayTracker.js` | Derived PH-credit/GHKA-use matching, synthetic opening credits, FIFO matching, summaries, warnings. Useful concepts, not a durable GOFF ledger. |
| `src/components/PublicHolidayTrackerPage.jsx` | PH/GHKA views and editing of opening-balance JSON in Settings/localStorage. Current update fires on input changes. |
| `src/utils/leaveTracking.js` | Derives MC/EL/AL episodes from `MasterRoster` and reconciles separate form metadata. Demonstrates a useful “roster facts + additive metadata” compatibility pattern. |
| `src/components/LeaveTracker.jsx` | Admin-only form-status workflow; explicitly warns against clinical details. Useful privacy copy/pattern. |
| `src/utils/adapters.js` | Response compatibility and validation helpers, including name alias mapping. Natural home for legacy-to-v2 adapters only if kept pure and small. |
| `src/utils/cache.js` | Safe localStorage access. Suitable for last-known reads/preferences, not sufficient for a durable ordered outbox. |
| `src/components/ToastNotification.jsx` | Per-operation toast stack. Must be reduced for routine queue activity in favor of persistent status. |
| `src/components/AdminPinModal.jsx` | Client-side admin PIN gate; not a secure backend authorization boundary. |
| `src/utils/rosterPdfExport.js` | Exports current derived roster and includes OFF/GOFF/HKA/GHKA legend text. Must select planned/current source explicitly after v2. |

### 3.2 Current Sheets contract from `appscript.txt`

| Sheet | Current/required headers | Current write behavior |
|---|---|---|
| `Requests` | `ID`, `Timestamp`, `Name`, `Date`, `Day`, `Request`, `Status`, `Comment`, `ApprovalStatus`, `SwapPartner`, `RequestType` | Append new versions; old active request becomes Old Request; delete is soft-cancel. IDs use `Date.now()`. |
| `TeamMembers` | Starts with `MemberName`, `FullName`, `Phone`, `Active`; adds `StaffId`, `Email` | Whole directory body is cleared and rewritten. |
| `EmergencyPhysicians` | Same dynamic directory structure | Whole directory body is cleared and rewritten. |
| `MasterRoster` | `Name`, `Date`, `Shift` | **All** body rows are cleared; submitted rows replace the entire sheet. No lock/revision. |
| `ShiftBlocks` | `ID`, `Date`, `ShiftType`, `MaxSlots` | Append/delete. |
| `ShiftTypes` | `ID`, `Name`, `IsPublic`, `GroupID` | Append/update/delete/reorder; reorder clears and rewrites. |
| `LimitGroups` | `ID`, `GroupName`, `DefaultLimit` | Append/update/delete. |
| `ActivityHistory` | `ID`, `Timestamp`, `CustomText`, `Name`, `RequestType`, `Request`, `SwapPartner`, `Date`, `ApprovalStatus`, `Comment`, `Status` | Append; delete archives; reads can auto-archive past rows. |
| `Settings` | `Key`, `Value` | Key/value overwrite or append; no lock/revision. |
| `PublicHolidays` | `ID`, `Date`, `Name`, `Active` | Locked upsert; physical row delete. |
| `LeaveApplications` | `ID`, `MemberName`, `LeaveType`, `StartDate`, `EndDate`, `Days`, `Status`, `SubmittedDate`, `ReferenceNo`, `Notes`, `UpdatedAt` | Locked upsert; physical delete. |

Settings known to the frontend include request limits, `phTrackerOpeningBalances`, `phTrackerMemos`, `memo_YYYY-MM`, and optional current-month keys.

## 4. Current roster and Sheets data flow

### 4.1 Read path

1. `App.jsx` synchronously loads last-known `resq_cache_*` values.
2. `fetchAllData()` requests `action=alldata`.
3. If the response is an array, the app treats it as a legacy backend and individually fetches only team members, emergency physicians, master roster, and shift blocks.
4. If it is the modern object shape, adapters normalize each collection.
5. React state and localStorage caches are replaced.
6. The loop repeats after one minute.

### 4.2 Current roster write path

```text
RosterPage editedGrid
  → flatten every represented person/date/shift row
  → App.handleUploadBaseline optimistic setMasterRoster
  → api.uploadMasterRoster
  → Apps Script clears MasterRoster body
  → Apps Script writes submitted Name/Date/Shift rows
  → wait 1.5 seconds
  → fetch all data
```

`RosterPage.handleSave()` does not await `onUploadMasterRoster`; it closes edit mode immediately. This is incompatible with lifecycle confirmation and safe recovery.

### 4.3 Current legacy behavior

- The client detects an older Apps Script only by the shape of `alldata` and falls back to four individual fetches.
- Missing modern collections become empty or last-known cached leave metadata.
- Existing roster records have no version/state markers; all are effectively legacy.
- Current normalization/tally paths can treat `PN` as active alongside worked shifts. The new model must preserve raw legacy values but must not carry that classification into staffing, consecutive-work, or GOFF rules.
- Name normalization includes a hard-coded `SYU → SYUHADA` alias, showing why stable person IDs are needed.
- For future months, active Approved/Pending Admin requests may visually fill blank roster cells even before those values exist in `MasterRoster`.

## 5. Existing optimistic behavior and gaps

### 5.1 Reusable behavior

- Immediate React updates provide low perceived latency.
- Optimistic rows have an `isOptimistic` marker in some request views.
- Toasts can be updated from saving to success/failure.
- Most flows refresh authoritative data after confirmation.
- PH and leave handlers rethrow failures to allow local forms to remain open.

### 5.2 Gaps to correct

- Whole-array rollback can erase later local changes.
- Background IIFEs mean many `async` handlers return before the write completes.
- Writes are neither ordered nor coalesced.
- No idempotency/replay protection; `Date.now()` is not a sufficient distributed operation ID.
- No expected revision or conflict response.
- Full refresh can overwrite optimistic edits or move scroll/selection state.
- A fixed 1.5-second sleep assumes Sheets consistency instead of verifying a revision/checksum.
- Pending changes are not durably restored after refresh.
- No per-cell confirmed baseline or error state.
- Global sync status reports refresh connectivity, not mutation-queue health.
- Routine writes generate repetitive toasts.
- Critical Settings changes, including current PH opening-balance JSON, update optimistically even though the new requirements prohibit unconfirmed success for accounting changes.

## 6. Existing PH/opening-balance pattern: reuse and replacement

### 6.1 Reuse

- Pure normalization of roster rows and shift modifiers.
- Per-person grouping and clear summary vocabulary.
- FIFO is a reasonable **display allocation** for the source/age of outstanding credits when no explicit credit allocation is selected.
- Opening-balance source notes and timestamps are useful concepts.
- Existing HKA/GHKA memo workflow and leave-tracker privacy text demonstrate progressive disclosure and non-clinical notes.
- The leave tracker’s pattern—derive facts from the roster while storing additive administrative metadata separately—is suitable for the compatibility phase.

### 6.2 Do not reuse as the GOFF accounting source

- Inference from mutable `MasterRoster` cannot preserve original planned OFF.
- Synthetic opening credits have no transaction IDs.
- A single JSON Settings cell has lost-update, size, audit, and concurrency risks.
- FIFO matching can change when older roster rows are edited.
- Current calculations exclude future months and do not reserve future use.
- There is no cancellation/reversal/adjustment event model.
- Existing PH/GHKA and new OFF/GOFF are different entitlements.

## 7. Recommended additive data model

This is the least disruptive robust model found for the verified storage design. It avoids changing the meaning of `MasterRoster`, keeps old clients readable, and uses append-only records for official history. Final names/header order must be validated against a copied workbook.

### 7.1 `RosterPeople`

Stable identity mapping without requiring the legacy directory sheets to preserve a new column immediately.

| Field | Purpose |
|---|---|
| `PersonId` | Client/server UUID; immutable primary identifier. |
| `DirectoryType` | `MO` or `EP`. |
| `CurrentDisplayName` | Current UI label. |
| `NormalizedName` | Migration/matching key; indexed in memory and unique per directory while active. |
| `LegacyNamesJson` | Previous aliases for import/projector matching. |
| `Active` | Directory status. |
| `CreatedAt`, `UpdatedAt` | Audit timestamps. |
| `OperationId` | Idempotent originating operation. |

**Reason:** Existing records and ledger history cannot safely be linked by mutable name strings. A separate mapping avoids old directory writers blanking a new ID column during phased rollout.

### 7.2 `RosterPeriods`

One mutable current-state row per monthly period, with all transitions duplicated in append-only `RosterEvents`.

| Field | Purpose |
|---|---|
| `PeriodId` | Stable `YYYY-MM` key. |
| `State` | `DRAFT`, `PUBLISHED`, `AMENDED`, `CLOSED`. |
| `Revision` | Monotonic official revision for conflict detection. |
| `DraftRevision` | Monotonic draft revision. |
| `PlannedSnapshotId` | Current immutable publication snapshot pointer. |
| `PublishedAt`, `PublishedBy` | Confirmed publication metadata. |
| `ClosedAt`, `ClosedBy` | Confirmed close metadata. |
| `ProjectionChecksum` | Expected `MasterRoster` compatibility projection checksum. |
| `SchemaVersion` | Record contract version. |
| `LastOperationId`, `UpdatedAt` | Idempotency/debug metadata. |

Reopen reason/history belongs in `RosterEvents`, not only in this mutable row.

### 7.3 `RosterAssignments`

Stores draft rows and immutable planned snapshot rows. Current state is derived from planned rows plus confirmed events.

| Field | Purpose |
|---|---|
| `AssignmentId` | UUID; supports more than one assignment per person/date. |
| `PeriodId` | Owning calendar period. |
| `Layer` | `DRAFT` or `PLANNED`. |
| `SnapshotId` | Empty for current draft; immutable publication snapshot for planned rows. |
| `PersonId`, `PersonNameSnapshot` | Stable link plus human-readable historical label. |
| `Date` | ISO local roster date. |
| `DutyDomain` | `MO`, `EP`, or future explicit domain. |
| `ShiftCode` | Raw configured base code. |
| `ModifiersJson` | Standby/extended and future modifiers without overloading the shift code. |
| `DraftRevision` | Draft batch revision when applicable. |
| `Source` | `NEW` or `LEGACY_IMPORT`; cross-boundary assignments remain owned by their own monthly period. |
| `OperationId`, `CreatedAt`, `CreatedBy` | Provenance. |

Planned rows are append-only. Draft rows may be replaced only within their scoped period and expected draft revision.

### 7.4 `RosterEvents`

One row per affected line; linked rows share `EventId`. Lifecycle events may have no person/date line.

| Field | Purpose |
|---|---|
| `EventId`, `LineId` | UUID event and line identifiers. |
| `EventType` | `PUBLISH`, `AMEND_ABSENCE`, `AMEND_REPLACEMENT`, `SWAP`, `ADMIN_CORRECTION`, `REVERSAL`, `CLOSE`, `REOPEN`. |
| `OperationId` | Idempotency link. |
| `PeriodId`, `BaseRevision`, `ResultRevision` | Concurrency boundary. |
| `PersonId`, `LinkedPersonIdsJson` | Affected people. |
| `Date`, `DutyDomain` | Affected cell. |
| `PlannedAssignmentJson` | Original assignment set used in preview/audit. |
| `BeforeCurrentJson`, `AfterCurrentJson` | Exact state transition, including multi-shift cases. |
| `PublicReasonCode` | Viewer-visible operational category such as `MC`, `EL`, `COVERAGE`, or `SHIFT_SWAP`. |
| `AdminNote` | Optional administrator-only free text; excluded from viewer payloads and protected by server authorization. |
| `ShortageAccepted`, `ShortageReason` | Explicit override evidence. |
| `GoffTransactionIdsJson` | Linked ledger effects. |
| `ReversesEventId` | Target for reversal; originals remain immutable. |
| `CreatedAt`, `CreatedBy` | Audit metadata. |

Reads include only events whose `OperationId` is confirmed in `OperationLog` and resolve reversals in event order.

### 7.5 `ShiftSemantics`

Add an effective/versioned semantic mapping separate from current `ShiftTypes`. A separate structure is safer during rollout because legacy shift-type writers are not designed to preserve new semantic columns.

| Field | Purpose |
|---|---|
| `SemanticId` | UUID/version identifier. |
| `ShiftCode`, `CanonicalCode` | Raw configured code and normalized semantic code. |
| `CountsAsWorked` | Whether the day is duty work. |
| `PolicyBQualifier` | Whether a planned value selects Policy B’s one-OFF branch. |
| `ConsecutiveBehavior` | `INCREMENT`, `TRANSPARENT`, `RESET`, or `UNKNOWN`. |
| `ProvidesStaffingCoverage` | Whether the value counts toward staffing/tally coverage. |
| `CanDisplaceOffEarnGoff` | Whether replacing a planned OFF with this value creates GOFF; true for worked duty and specifically `PN`. |
| `ExpectedPredecessorsJson`, `ExpectedFollowersJson` | Night-bundle relationship codes. |
| `EffectiveFrom`, `RuleVersion`, `Active` | Version/effective control. |
| `CreatedAt`, `CreatedBy`, `OperationId` | Audit and idempotency. |

Initial mapping:

| Codes | Worked | Policy B | Consecutive | Staffing | Displaces OFF / earns GOFF | Bundle expectation |
|---|---:|---:|---|---:|---:|---|
| `AM`, `PM`, `AMX`, `PMX`, `OH` | Yes | No | Increment | Yes | Yes | None |
| `ON1` | Yes | Yes | Increment | Yes | Yes | Followed by `ON2` or `PN` |
| `ON2` | Yes | Yes | Increment | Yes | Yes | Preceded by `ON1`; followed by `PN` |
| `ON`, `N`, `NIGHT` | Yes | Yes | Increment | Yes | Yes | Followed by `PN` |
| `PN` | **No** | **Yes** | **Transparent** | **No** | **Yes** | Preceded by `ON1`, `ON2`, or a legacy night alias |
| `OFF`, `GOFF`, `AL`, `MC`, `EL`, `HKA`, `GHKA`, `COURSE`, blank | No | No | Reset | No | No | None |
| Unknown code | Unknown | Unknown | Unknown | Unknown | Unknown | Preserve and flag for mapping |

Standby/extended modifiers inherit the base code. All domain consumers call this layer; none maintains a competing list. Existing historical values are not retroactively reclassified for official historical outcomes.

### 7.6 `OffPolicies`

| Field | Purpose |
|---|---|
| `PolicyId` | UUID. |
| `PolicyCode` | `A` or `B`. |
| `EffectiveMonday` | ISO date; backend validates Monday. |
| `RuleVersion` | Version of evaluation semantics. |
| `RuleJson` | Required-OFF rule and referenced semantic `RuleVersion`; Policy-B qualifiers resolve through `ShiftSemantics`. |
| `Active` | Whether available for future publication. |
| `Reason`, `CreatedAt`, `CreatedBy`, `OperationId` | Audit/provenance. |

Policies are not edited in place after use; a change appends a new effective version.

### 7.7 `WeeklyOffSnapshots`

One shared person/week record keyed by Monday `WeekStart`. The effective policy locks when the first touching monthly period publishes, while assignment completeness and results advance from Provisional to Complete when both owning periods have supplied all seven published dates.

| Field | Purpose |
|---|---|
| `WeekSnapshotId` | Stable UUID for person + `WeekStart`. |
| `WeekStart`, `WeekEnd` | Monday and Sunday. |
| `PolicyLockedByPeriodId` | First touching period; locks policy only, not adjacent assignments. |
| `PublishedPeriodIdsJson`, `PublishedDateMask` | Which monthly owners have supplied which dates. |
| `EvaluationState` | `PROVISIONAL` or `COMPLETE`; no compliance result while provisional. |
| `PlannedSnapshotIdsJson`, `PlannedWeekChecksum` | Immutable sources from each monthly owner and checksum once complete. |
| `PersonId`, `PersonNameSnapshot` | Subject. |
| `PolicyId`, `PolicyCode`, `RuleVersion` | Frozen policy. |
| `HasQualifyingPlannedNight` | Null while provisional; frozen from all seven planned dates when complete. |
| `RequiredOffCount`, `AssignedOffCountAtPublish` | Null while provisional; auditable complete-week result. |
| `Revision`, `OperationId`, `CreatedAt`, `CompletedAt` | Concurrency and provenance. |

Every assignment remains owned by its calendar-month `PeriodId`. The second publication can fill only its own dates and cannot overwrite the first period. Duplicate/incompatible ownership is rejected. `CurrentAssignedOffCount` is derived at read time from confirmed amendments rather than stored in the snapshot; current guidance may change, but the complete planned count, required count, and qualification remain frozen.

### 7.8 `GoffLedger`

Append-only transactions. Totals sum confirmed non-reversed effects rather than editing balances.

| Field | Purpose |
|---|---|
| `TransactionId` | UUID. |
| `OperationId` | Idempotency/atomic event link. |
| `PersonId`, `PersonNameSnapshot` | Owner. |
| `TransactionType` | `OPENING`, `PENDING_EARN`, `EARN`, `RESERVE`, `RELEASE`, `USE`, `ADJUSTMENT`, `REVERSAL`. |
| `BalanceDelta` | Signed whole-day balance effect. |
| `ReservedDelta` | Signed whole-day active-reservation effect. |
| `EffectiveDate` | Accounting date. |
| `SourceType`, `SourceId` | Opening declaration, assignment, amendment, close, or adjustment source. |
| `PeriodId`, `AmendmentEventId` | Roster linkage. |
| `RelatedTransactionId` | Credit allocation or reversed/released transaction. |
| `SourceUniquenessKey` | Unique person/date/source-amendment entitlement key preventing duplicate `OFF → duty/PN` earn. |
| `EarnBasis` | `OFF_DISPLACED_BY_DUTY`, `OFF_DISPLACED_BY_PN`, or reasoned manual exception. |
| `Reason` | Required for opening/adjustment/override. |
| `IsNegativeOverride` | Explicit exceptional state. |
| `CreatedAt`, `CreatedBy` | Audit metadata. |

Recommended effects:

| Type | `BalanceDelta` | `ReservedDelta` |
|---|---:|---:|
| `OPENING` / `EARN` | positive units | 0 |
| `PENDING_EARN` | 0 | 0 (projection only) |
| `RESERVE` | 0 | positive units |
| `RELEASE` | 0 | negative units |
| `USE` | negative units | negative units when consuming a reservation |
| `ADJUSTMENT` | signed units | normally 0 |
| `REVERSAL` | exact compensating deltas | exact compensating deltas |

GOFF commencement is the first day of the first lifecycle-enrolled monthly period. Store that immutable deployment record with its opening-balance batch/reconciliation status. The exact period and per-person values may be supplied after implementation, but `goff_ledger_enabled` cannot become effective until every applicable opening row is confirmed and the batch reconciles. Historical rosters never generate ledger rows.

An amendment from planned `OFF` to a configured duty or `PN` creates one `PENDING_EARN`; `PN` uses `OFF_DISPLACED_BY_PN` despite `CountsAsWorked=false`. Reversal appends exact compensating rows. Planned `OFF → MC/EL/AL` creates no automatic earn. Planned `GOFF` worked/replaced releases or preserves the reservation without a new earn.

### 7.9 `OperationLog`

A transaction journal and idempotency index.

| Field | Purpose |
|---|---|
| `OperationId` | Client UUID; unique. |
| `ClientId`, `TabId` | Diagnostic source, not authorization. |
| `OperationType`, `EntityKey` | Routing and per-entity ordering. |
| `ExpectedRevision`, `ResultRevision` | Conflict control. |
| `PayloadHash` | Reject reuse of an ID with different content. |
| `Status` | `PENDING`, `CONFIRMED`, `FAILED`, `RECOVERY_REQUIRED`. |
| `ResultJson`, `ErrorCode` | Idempotent replay response. |
| `CreatedAt`, `CompletedAt` | Audit/recovery timing. |

This extra sheet is justified because Apps Script/Sheets does not provide multi-sheet transactions. Canonical reads ignore rows attached to an unconfirmed operation.

## 8. Backward compatibility strategy

### 8.1 Period enrollment

- Every period is initially `LEGACY` by absence of a `RosterPeriods` row.
- Legacy adapter returns planned=current from `MasterRoster`.
- A period is enrolled only through an explicit v2 draft/import action behind a feature switch.
- Pre-cutoff periods remain read-only unless deliberately migrated.

### 8.2 `MasterRoster` compatibility projection

- Continue to expose `Name`, `Date`, `Shift` exactly as old clients expect.
- For legacy periods, preserve existing rows byte-for-byte where feasible.
- For enrolled periods, project confirmed current assignments only.
- Never reuse the current global `uploadmasterroster` handler for v2 saves.
- Generate a complete proposed projection in memory under a script lock, preserve all out-of-scope periods, write/verify it, and store a checksum.
- If projection verification fails, do not confirm the operation or lifecycle transition. Restore the pre-write backup and flag recovery if restoration cannot be verified.

### 8.3 Old frontend compatibility

- Keep current action names and response fields during rollout.
- Add v2 endpoints/actions rather than changing legacy action meaning.
- Avoid placing large v2 datasets into `alldata`; fetch roster-v2 data by period and revision.
- Do not allow old full-roster writes after v2 write enablement. The backend should reject `uploadmasterroster` for enrolled/locked periods, and the deployment checklist must prevent a stale old frontend from erasing official data.

### 8.4 Stable cache keys

Keep all existing `resq_cache_*` keys. Add versioned keys for v2 data/outbox. Cache migrations must be tolerant and reversible.

## 9. Feature-switch strategy

Store switches as additive `Settings` keys initially; backend enforcement must not rely only on frontend switches.

| Switch | Purpose | Initial state |
|---|---|---|
| `roster_v2_read_enabled` | Read adapters/views without enabling new writes. | Off |
| `roster_v2_write_enabled` | Draft/lifecycle/amendment backend actions. | Off |
| `shift_semantics_v2_enabled` | Shared semantic classification for new validators and ledger rules. | Off |
| `weekly_off_guidance_enabled` | Complete-week guidance. | Off |
| `night_safety_guidance_enabled` | Bundle, consecutive-work, and post-night-rest guidance. | Off |
| `goff_ledger_enabled` | Ledger read/write and reservation checks. | Off |
| `write_queue_v2_enabled` | Ordered/persistent client mutation queue. | Off |
| `roster_workspace_v2_enabled` | Sidebar/focus/density workspace. | Off |
| `legacy_upload_enabled` | Emergency kill switch for old upload path. | On, then Off before first enrolled publication |
| `goff_commencement_period` | First enrolled `YYYY-MM`; commencement date is its first day. | Unset deployment input |
| `goff_opening_batch_status` | Blocks GOFF enablement until every applicable balance is confirmed/reconciled. | Unset deployment input |
| `legacy_read_only_before` | Default historical read-only boundary. | Unset |

Roll switches out to copied data, then administrator-only production, then viewers. A kill switch disables new writes without deleting canonical records.

## 10. Data-integrity and concurrency design

### 10.1 Official write protocol

For publish, amendment, reversal, close/reopen, opening balance, and adjustment:

1. Client generates `OperationId` with `crypto.randomUUID()` and sends `ExpectedRevision`.
2. Backend acquires `LockService.getScriptLock()` with bounded wait.
3. Backend finds `OperationLog.OperationId`:
   - same payload hash + Confirmed → return stored result;
   - same ID + different hash → reject `IDEMPOTENCY_MISMATCH`;
   - Pending/Recovery → resume or return review state.
4. Backend verifies period revision/state and all domain rules.
5. Backend appends operation-scoped canonical rows as not-yet-visible through the Pending operation journal.
6. Backend generates and verifies `MasterRoster` compatibility projection where required.
7. Backend updates `RosterPeriods`, appends lifecycle/event/ledger rows, and marks operation Confirmed with result revision. Readers now include those rows.
8. On failure, mark Failed or Recovery Required and restore/verify projection backup.
9. Release the lock in `finally`.

Sheets has no true multi-tab transaction. Visibility through a confirmed operation journal plus deterministic recovery is therefore mandatory.

### 10.2 Invariants

- One `RosterPeriods` row per `PeriodId`.
- Revisions increase by exactly one per confirmed official event.
- One confirmed payload per `OperationId`.
- Planned rows never change after publication.
- Every amendment/reversal line resolves to an existing stable person and date.
- Reversal points to a confirmed, unreversed compatible event.
- Ledger units are integers.
- Active reservations never reduce available balance below zero unless the confirming operation is a reasoned override.
- Every ledger effect references a confirmed source.
- Every shift validator/ledger reducer resolves the same effective `ShiftSemantics.RuleVersion`; unknown codes fail closed to an explicit mapping issue.
- `PN` is Policy-B-qualifying, consecutive-transparent, non-staffing, non-worked, and GOFF-earning only when it displaces planned `OFF`.
- One shared person/week record has one locked policy/rule version; it has no compliance result until all seven monthly-owned planned dates are published.
- No monthly publication writes an assignment outside its period or overwrites another period’s date.
- A source amendment/person/date has at most one active GOFF earn entitlement.
- A closed period has no pending/failed official operation and reconciles its ledger effects.
- Close is initiated only by explicit administrator confirmation after a reconciliation preview; no timer/prompt can close automatically.
- Viewer responses never contain `AdminNote`; private note access requires server-side administrator authorization.
- Projection checksum matches confirmed current assignments for enrolled periods.

### 10.3 Multi-tab/device conflicts

- `BroadcastChannel` (with storage-event fallback) announces local pending/confirmed period revisions across tabs.
- Backend revision is authoritative across devices.
- A stale write receives `REVISION_CONFLICT` plus current revision/checksum; it never silently wins.
- UI fetches changed cells/events, preserves the user’s draft separately, and offers review/rebase or revert.

## 11. Google Sheets latency and ordered write queue

### 11.1 Client queue model

Create a dedicated data/mutation layer rather than extending `App.jsx` background IIFEs.

Suggested modules:

```text
src/features/roster/domain/        pure lifecycle, week, amendment, GOFF rules
src/features/roster/data/          adapters, API repository, projection mapping
src/features/roster/queue/         outbox, scheduler, retry, conflict handling
src/features/roster/components/    workspace, grid, issues, dialogs, status
```

Each queued record contains:

- operation ID, client/tab ID, entity key, operation class;
- base/expected revision;
- payload and payload hash;
- optimistic patch and inverse patch/last-confirmed value;
- local sequence number;
- status, attempt count, next retry time, and last error; and
- created/updated timestamps.

### 11.2 Ordering and batching

- Serialize operations for the same period/entity key.
- Allow independent preferences and safe reads to continue.
- Coalesce unsent edits to the same draft cell.
- Batch draft cell patches by period after a short configurable debounce; **500 ms is an engineering starting recommendation**, not a confirmed product rule.
- Never batch separate critical confirmations into one ambiguous UI action.
- Official linked amendment lines are one atomic payload with one event/operation ID.

### 11.3 Persistence and recovery

- Use IndexedDB for the outbox and per-cell last-confirmed baselines; keep localStorage for small preferences and existing caches.
- Restore safe queued draft edits at startup and label them local/pending.
- Do not automatically replay a critical operation after an ambiguous response without first checking `OperationLog` by ID.
- Register `beforeunload` only while unsafe/non-persisted changes exist.
- Provide **Retry** for transient errors and **Revert** for user-abandoned optimistic changes.
- Use bounded exponential backoff with jitter and a visible manual recovery path.

### 11.4 UI state integration

- Keep queue status outside the roster grid render model to avoid replacing all cell objects.
- Derive per-cell badges from operation IDs.
- A persistent save-status control summarizes queue health and opens the issues panel.
- Confirmed background refresh merges by revision; it must not replace a newer optimistic patch.
- Preserve selection and scroll through stable person/date keys, not DOM indexes.

## 12. Validation architecture

### 12.1 Shared pure domain rules

Extract and unit-test:

- shift-code normalization and modifiers;
- one versioned semantic resolver for worked, Policy-B qualification, consecutive `INCREMENT`/`TRANSPARENT`/`RESET`, staffing coverage, OFF displacement/GOFF earn, and night-bundle relationships;
- Monday/week range generation in the configured timezone;
- planned/current resolution from events;
- weekly-OFF entitlement from planned snapshots;
- current assigned-OFF and shortfall calculation;
- staffing before/after using existing threshold semantics;
- duplicate/double-assignment checks;
- six-day configurable consecutive-work calculation with advisory warning on the proposed seventh worked day;
- night-bundle integrity for `ON1 → ON2 → PN`, `ON1 → PN`, and legacy `ON`/`N`/`NIGHT → PN` across month/year boundaries;
- post-night-rest checks that distinguish a non-working reset without `PN` from an unsafe worked continuation without `PN`, while accepting `ON1 → ON2` as a valid bundled continuation and applying recovery after `ON2`;
- GOFF balance/reservation/projection calculations;
- replacement candidate exclusion/reason ranking with `Eligibility not checked` and no initial skill/role filter; and
- reversal dependency resolution.

The frontend runs these for responsive previews. The backend reruns authoritative validation under lock for official writes.

### 12.2 Current logic to reuse carefully

- Shift parsing from `RosterPage.jsx` and `rosterAnalytics.js` should become one canonical helper; the duplicate implementations currently differ subtly.
- `calculateCoverageIssues()` provides current AM/PM/night/leave threshold semantics.
- Current active-shift sets include `AM`, `PM`, normalized `NIGHT`, `PN`, and `OH`. This set must be retired as a domain source: under the resolved model `PN` does not count as worked or staffing, is transparent for consecutive work, qualifies for Policy B, and can earn GOFF only by displacing planned `OFF`.
- `getDaysInMonth()` must not be used for weekly rules; create a full-week/date-range engine.
- Current local tally thresholds must be moved to authoritative configuration if they drive official amendment previews.

### 12.3 Validation levels

| Level | Behavior |
|---|---|
| Blocking invariant | Invalid state transition, stale revision, malformed date, duplicate ID, ledger corruption, unauthorized critical action. Reject. |
| Default block with override | Negative GOFF; explicit administrator override and reason required. |
| Advisory with recorded acknowledgement | Staffing shortage, weekly OFF shortfall, seventh consecutive worked day, night-bundle integrity, insufficient post-night rest. Warn; do not auto-edit or block. |
| Informational | Fairness/equity suggestion and non-critical density hints. |

## 13. UI/component changes

### 13.1 Refactor before feature expansion

Split `RosterPage.jsx` into independently testable components/hooks while preserving current behavior:

- `RosterWorkspaceShell`
- `RosterToolbar`
- `RosterGrid`
- `RosterCell`
- `RosterIssuesPanel`
- `WeeklyOffGuide`
- `RosterSafetyGuidance`
- `RosterTallies`
- `AmendmentActionSheet/Dialog`
- `AmendmentImpactPreview`
- `RosterSaveStatus`
- `RosterHistoryPanel`
- `useRosterViewModel`
- `useRosterSelection`
- `useRosterPreferences`

Keep export concerns separate. The current alternate `RosterTable.jsx` is request-oriented and should not become the v2 official grid without an explicit consolidation decision.

### 13.2 Lifecycle UI

- Replace “official finalized” and generic **Save Changes** language with state badge, **Save Draft**, **Publish Roster**, **Amend Roster**, **Close Month**, and deliberate **Reopen**.
- Disable direct overwrite after publication.
- Current/Original/Changes view switch must not lose selection or scroll.
- Critical actions use confirmation dialogs with revision and impact summaries.
- Close may be prompted after month-end, but always opens a reconciliation preview and requires explicit confirmation; it is blocked by pending/failed official writes or ledger mismatch.

### 13.3 Amendment UI

- Desktop: anchored context panel/dialog from selected cell.
- Mobile: reuse the existing bottom-sheet pattern.
- Progressive action-specific fields.
- Preview combines staffing, OFF, GOFF, rest, consecutive-work, and conflicts.
- After confirmation, Immediate Undo remains prominent for 10 seconds and appends a reversal; afterward history retains Reverse Amendment permanently.
- Viewer payloads expose only operational categories (`MC`, `EL`, `Coverage`, `Shift swap`). Administrator notes require a separately authorized server response and include a “no clinical details” reminder.
- Replacement suggestions state `Eligibility not checked`; the initial release performs no automated skill/role filtering and requires administrator suitability confirmation.

### 13.4 Workspace density/navigation

- Add controlled desktop sidebar expanded/collapsed state in `AppNavigation.jsx` and update the content inset in `App.jsx`.
- Store sidebar and density preferences in versioned local preferences.
- Focus Mode hides nonessential chrome but retains an obvious, labeled exit.
- Fit Month measures container width minus sticky name column and divides by visible day count.
- Fit Entire Roster additionally considers available height/member count.
- Enforce an absolute 10 px roster-cell minimum in Fit modes, preferring larger compact text when space permits; fall back to controlled scrolling before crossing it.
- Use approximately 13–14 px roster-cell text in Comfortable mode.
- Use sticky date headers and name column, selected row/column highlight, week boundaries, weekends, searchable staff, collapsible guidance/tallies, and an accessible legend.
- Preserve established mobile top/bottom navigation unless test evidence supports change.

## 14. Phased implementation

The requested optimistic-write phase is moved ahead of lifecycle work. Repository evidence supports this reorder: current whole-array rollback, unawaited roster save, no revisioning, and a destructive full-sheet upload make it unsafe to build official snapshots/ledger transactions on the existing mutation path.

### Phase 0 — Evidence freeze and migration rehearsal setup (**M**)

- Obtain a no-side-effect live workbook export or copied workbook.
- Record deployed Apps Script version/hash.
- Inventory tabs, headers, data types, formulas, protections, row counts, duplicates, and real shift codes.
- Capture full backup and checksums.
- Create anonymized/copy-based fixtures for representative legacy months.
- Inventory production-only/unknown shift codes for explicit semantic mapping.
- Track, without blocking software implementation, the rollout inputs for the first enrolled period and per-person GOFF opening balances.

**Exit gate:** Signed data inventory and restorable copy; no unresolved schema assumption that could alter existing rows.

### Phase 1 — Compatibility foundation and feature switches (**L**)

- Add backend schema-version discovery without changing legacy actions.
- Add `RosterPeople`, `RosterPeriods`, and disabled switches.
- Add `ShiftSemantics` plus one frontend/backend pure semantic resolver with the resolved initial mapping, including `PN` as transparent/non-staffing/non-worked but Policy-B-qualifying and OFF-displacement eligible.
- Build stable person mapping and legacy adapters.
- Add v2 period read endpoint and compatibility response fixtures.
- Prevent enrolled periods from using legacy full upload.
- Add backup/checksum/projection utilities.
- Establish server-side single-administrator authorization boundaries before any private-note or official v2 endpoint can be enabled.

**Depends on:** Phase 0.\
**Exit gate:** With all switches off, production behavior and payloads are unchanged; v2 reads can shadow-compare legacy data; every known initial code has one tested semantic result and unknown codes remain explicit.

### Phase 2 — Ordered write queue, operation journal, and recovery (**XL**)

- Add `OperationLog`, UUID operation IDs, payload hashing, expected revisions, locks, and error codes.
- Implement IndexedDB outbox, per-entity ordering, debounce/batch for drafts, last-confirmed patches, and startup recovery.
- Add persistent global/per-cell state, Retry/Revert, unload warning, and multi-tab signaling.
- Replace roster upload IIFE path for v2 drafts only; do not change official production path yet.
- Add recovery tooling for Pending/Recovery Required operations.

**Depends on:** Phase 1.\
**Exit gate:** Fault-injection tests prove no duplicate operations, stale overwrite, or whole-array rollback.

### Phase 3 — Weekly OFF, night bundles, consecutive work, and rest guidance (**XL**)

- Add `OffPolicies` and full Monday–Sunday date engine.
- Implement Policy A/B through the shared semantics, including `ON1`, `ON2`, `PN`, `ON`, `N`, and `NIGHT` qualification.
- Implement independently published monthly ownership plus shared `weekStart` records: lock policy only, remain Provisional until all seven published dates exist, then evaluate complete guidance.
- Load adjacent dates across months/years and never show false compliance for incomplete context.
- Add six-day configurable consecutive-work logic with `PN` transparency and advisory acknowledgement on the seventh worked day.
- Add cross-boundary night-bundle and post-night-rest validators, distinguishing protected reset statuses from unsafe worked continuation without `PN`.
- Add draft weekly guide and consolidated issues integration.
- Add policy editor validating Monday effective dates.
- Keep enforcement advisory.

**Depends on:** Phases 1–2 and the Phase 1 semantic resolver.\
**Exit gate:** Cross-month/year OFF and night-sequence fixtures pass; `PN` tri-state semantics pass; no historical roster is recalculated.

### Phase 4 — Draft/published/amended/closed lifecycle (**XL**)

- Add `RosterAssignments`, `RosterEvents`, and Provisional/Complete `WeeklyOffSnapshots` without cross-month assignment ownership.
- Implement scoped autosaved drafts and **Save Draft**.
- Implement atomic journaled Publish with immutable planned and policy snapshots.
- Add state badge and transition guards.
- Implement always-manual close/reopen shell with explicit reconciliation preview, pending/failure blockers, and no GOFF posting until Phase 7.
- Build verified `MasterRoster` projection for enrolled periods.

**Depends on:** Phases 1–3.\
**Exit gate:** Planned snapshot cannot be mutated; lifecycle and projection reconcile after simulated failures.

### Phase 5 — Planned/current model and amendment history (**XL**)

- Implement event resolver and Current/Original/Changes views.
- Add contextual action framework, impact preview, history, Undo, and reversal dependency checks.
- Keep confirmed-amendment Undo prominent for 10 seconds, then retain permanent Reverse Amendment in history.
- Separate viewer-safe `PublicReasonCode` from server-authorized administrator-only notes.
- Implement administrative correction and shift swap.
- Add event-linked audit display and revision conflicts.

**Depends on:** Phase 4.\
**Exit gate:** Multi-line event applies all-or-none and reversal never deletes history.

### Phase 6 — Absence and replacement workflow (**L**)

- Implement absence-only and absence+replacement event types.
- Reuse staffing thresholds; move authoritative threshold configuration out of local-only storage.
- Add shortage recommendation/acceptance reason.
- Add replacement suggestions with explainable exclusions.
- Exclude skill/role filtering from the initial release; label every candidate `Eligibility not checked` and require administrator suitability confirmation.
- Enforce privacy-safe MC display and note guidance.

**Depends on:** Phase 5.\
**Exit gate:** Before/after staffing and linked Siti/Ahmad scenario pass end-to-end.

### Phase 7 — GOFF ledger and opening balances (**XL**)

- Add `GoffLedger` and server-side balance/reservation reducer.
- Derive commencement as the first day of the first enrolled monthly period; import only administrator-confirmed opening balances and reconcile every applicable person before production enablement.
- Link pending earn/reserve/release/use/reversal to roster operations, including one unique `OFF → PN` earn entitlement and its compensating reversal.
- Use semantic `CanDisplaceOffEarnGoff`; do not infer automatic earn for `OFF → MC/EL/AL` or any pre-commencement roster.
- Add negative default block and reasoned override.
- Extend Close to reconcile pending earns and reservations atomically.
- Add audit, age/source display, totals, and reconciliation report.
- Keep GHKA tracker separate.

**Depends on:** Phases 1 and 4–6. Exact commencement period and balances are rollout inputs that gate GOFF production enablement, not implementation.\
**Exit gate:** Ledger recomputation equals stored summaries/projections; retry/reversal cannot duplicate units.

### Phase 8 — Desktop roster workspace refinements (**L**)

- Collapsible sidebar and responsive content inset.
- Focus Mode.
- Fit Month and Fit Entire Roster with a hard 10 px roster-cell floor and controlled-scroll fallback; Comfortable at approximately 13–14 px.
- Sticky headers/name, week boundaries, selection highlight, staff search, collapsible panels, legend/details, scroll restoration, keyboard commands, Undo/Redo.
- Preserve mobile navigation; test bottom-sheet amendment flow.

**Depends on:** Stable components from Phases 4–6; can partially parallel shadow-mode verification after Phase 5.\
**Exit gate:** Accessibility and viewport matrix passes with no color-only state.

### Phase 9 — Verification, migration rehearsal, and production rollout (**XL**)

- Run unit, contract, integration, browser, concurrency, accessibility, migration, and rollback tests.
- Rehearse import/projection/close on copied production data.
- Reconcile row counts, per-person/date assignments, weekly snapshots, and GOFF balances.
- Deploy backend first with switches off; verify version.
- Deploy frontend read-only shadow mode.
- Enable administrator v2 drafts, then lifecycle, amendments, and workspace in separate checkpoints. Enable GOFF only after the recorded first enrolled period and complete opening-balance batch reconcile; enable viewer reads separately.
- Monitor OperationLog failures, projection checksum, queue age, conflicts, and ledger reconciliation.

**Depends on:** All prior phases.\
**Exit gate:** Operational sign-off, backups verified, no unresolved reconciliation difference, and rollback drill completed.

## 15. Testing strategy

### 15.1 Unit tests

Continue pure Node assertion tests initially, adding focused files for:

- Monday/Sunday range and timezone-safe ISO dates;
- Policy A/B including legacy night aliases and Provisional/Complete cross-month/year examples;
- planned-night qualification unaffected by current amendments;
- only OFF satisfying entitlement;
- semantic mapping properties for every initial code and modifier inheritance;
- tri-state consecutive behavior: worked increments, `PN` preserves without incrementing, reset statuses clear the sequence;
- six-day sequence and advisory seventh-worked-day warning, including transparent `PN`;
- valid and invalid `ON1`/`ON2`/legacy-night/`PN` bundles across week, month, and year boundaries, including no false rest warning on valid `ON1 → ON2`;
- bundle-only warning for a post-night reset status versus bundle-plus-rest warnings for a post-night worked continuation;
- event ordering, reversal, and dependency resolution;
- multi-assignment/person/date handling;
- GOFF balance, reservation, pending earn, use, release, adjustment, and reversal, including `OFF → PN`;
- one earn per source amendment/person/date under duplicate submissions and retries;
- no automatic earn for `OFF → MC/EL/AL` or worked/replaced planned `GOFF`;
- negative override behavior;
- legacy adapter and stable person mapping; and
- projection checksums.

### 15.2 Backend contract tests

Use an isolated/copy spreadsheet and invoke Apps Script handlers with fixtures:

- legacy and v2 read payloads;
- duplicate operation replay;
- operation ID reused with different payload;
- expected-revision conflicts;
- lock contention;
- simulated failure after each multi-sheet step;
- operation recovery;
- projection preservation of out-of-scope legacy rows; and
- independent adjacent-month publication, locked policy reuse, provisional completion, and rejection of cross-period date overwrite;
- GOFF enablement rejected until commencement period and complete reconciled opening batch exist;
- manual close rejected with pending/failed official writes or ledger mismatch;
- viewer payload exclusion of administrator notes and unauthorized private-note access; and
- no getter with “read-only” name mutates test data unless explicitly documented.

### 15.3 Frontend integration tests

- Draft edit → queued → confirmed/failed/retried/reverted.
- Refresh while queued and restart recovery.
- Two rapid edits with reversed response order.
- Two tabs editing one period.
- Publish/close success not shown early.
- Pending amendment rendering and conflict review.
- Current/original/changes consistency.
- 10-second prominent Undo window and permanent older reversal.
- Replacement suggestions labeled `Eligibility not checked` with no automated skill filter.
- Planned OFF compliance versus displaced current operational OFF outcome.
- Manual close prompt, reconciliation preview, and blocking issues.
- Selection/scroll preservation after merge.
- Issues navigation to exact person/date.

### 15.4 Browser/accessibility tests

Test at minimum:

- 375px phone portrait and landscape;
- tablet portrait/landscape;
- 1024px and 1440px desktop;
- keyboard-only operation;
- screen-reader names/roles/live status;
- 200% browser zoom and enlarged text;
- reduced motion;
- offline/slow/failing network; and
- Fit modes with 28–31 dates and realistic/max staff counts, asserting the 10 px floor and scroll fallback;
- Comfortable mode at approximately 13–14 px; and
- public-category visibility without administrator-note disclosure.

### 15.5 Migration test cases

1. Legacy month with one row per person/date.
2. Duplicate and double-shift rows.
3. Standby/extended suffix variants.
4. Cross-month and cross-year weeks.
5. Cross-boundary night bundles and a boundary week that remains Provisional until the second month publishes.
6. Independent period ownership with duplicate/incompatible cross-month write rejected.
7. Unknown shift codes preserved and flagged.
8. Legacy `PN` preserved without retroactive tally/consecutive/GOFF reinterpretation.
9. Inactive or renamed staff with historical rows.
10. Existing `SYU` alias mapping.
11. Empty month and partially populated month.
12. Existing PH/GHKA data and Settings JSON unchanged.
13. Confirmed GOFF opening-balance batch import, missing-person block, retry, reconciliation, and rollback.
14. No inferred GOFF transaction from pre-commencement history.
15. Projection containing both untouched legacy and enrolled v2 periods.
16. Old frontend attempting `uploadmasterroster` after enrollment.
17. Close/reopen/reclose with ledger reconciliation and close blockers.
18. Workbook with extra columns/formulas/protections discovered in Phase 0.

## 16. Migration and rollout procedure

### 16.1 Backup

- Export/copy the complete workbook with formulas, formats, protections, and tab order.
- Record Apps Script deployment ID/version and repository commit.
- Export each sheet to a machine-readable snapshot and compute row/header checksums.
- Test restoring the copy before proceeding.

### 16.2 Additive schema deployment

- Deploy new backend code with all new switches off.
- Create new tabs only in the copied workbook first.
- Verify legacy `alldata` and old actions remain compatible.
- Populate `RosterPeople` mappings and resolve ambiguous names manually.
- Populate and test the initial `ShiftSemantics` mapping. Preserve unknown codes and current `PN` rows; do not retroactively alter historical calculations or create GOFF.
- Do not create v2 period rows for historical months by default.

### 16.3 Shadow reads

- Compute v2 adapters and compatibility projection without writing `MasterRoster`.
- Compare per-period row sets and checksums with legacy data.
- Exercise shared-week policy locking, Provisional state, second-period completion, and cross-year sequences without labeling historical results official.

### 16.4 GOFF commencement

- Select the exact first monthly period to enroll; derive and record GOFF commencement as its first day.
- Obtain signed/confirmed opening balances and source notes for every applicable person.
- Import with one idempotent operation per person or one atomic approved batch.
- Independently recompute totals and have the administrator reconcile the complete batch.
- Keep GOFF production switches disabled until the commencement and balance-batch gates pass. These are deployment inputs, not implementation blockers.

### 16.5 Controlled cutover

- Disable legacy upload for the first enrolled period at the backend.
- Verify server-side administrator authorization before enabling official writes or private-note reads.
- Enable administrator draft writes.
- Publish one test/next period, verify planned snapshot and `MasterRoster` projection.
- Enable amendments, then GOFF, then general viewer v2 reads.
- Keep prior periods legacy/read-only.

## 17. Rollback plan

### 17.1 Before any v2 period is published

- Disable v2 switches.
- Leave additive sheets in place but unread.
- Re-enable legacy UI/write only if no enrolled-period lock exists.
- Restore frontend/backend deployment versions if necessary.

### 17.2 After publication but before amendments/GOFF

- Disable v2 writes and viewer reads.
- Verify and retain immutable snapshots.
- Restore `MasterRoster` from the verified pre-cutover backup or last confirmed projection.
- Do not delete v2 records; mark the rollout paused through an audit event/operational record.

### 17.3 After amendments or ledger transactions

- Do not roll back by deleting rows or deploying an old backend that permits destructive upload.
- Freeze official writes.
- Rebuild current projection from the last confirmed operation revision.
- Reconcile ledger from append-only transactions.
- If a business correction is required, append compensating reversal/adjustment events with reasons.
- Keep the old viewer on the verified `MasterRoster` projection while v2 UI is disabled.

### 17.4 Recovery criteria

Rollback/recovery is complete only when:

- period state/revision is unambiguous;
- planned checksum is unchanged;
- current projection matches confirmed events;
- GOFF sums and active reservations reconcile;
- no OperationLog row remains ambiguously Pending; and
- administrator and viewer see the same confirmed operational roster.

## 18. Operational checklist

### Before build

- [ ] Obtain copied workbook and read-only inventory.
- [ ] Confirm operational timezone and Monday boundary.
- [ ] Encode and review the resolved initial semantic mapping, including the special `PN` properties.
- [ ] Inventory any additional production shift codes; keep unmapped values explicit.
- [ ] Define the server-side single-administrator authorization mechanism and protected note path.
- [ ] Track the first-enrolled-period and GOFF opening-balance deployment inputs without blocking implementation.

### Before backend deployment

- [ ] Backup/restore drill complete.
- [ ] New tabs/headers validated on copy.
- [ ] All official actions lock, deduplicate, revision-check, and audit.
- [ ] Legacy action contract tests pass.
- [ ] Enrolled periods reject legacy destructive upload.
- [ ] Recovery Required tooling tested.
- [ ] Viewer endpoints exclude administrator notes; unauthorized private-note tests pass.

### Before frontend enablement

- [ ] Queue/outbox fault tests pass.
- [ ] Persistent status and issues navigation work.
- [ ] Current/original/changes reconcile.
- [ ] PDF/export source selection is explicit.
- [ ] Mobile navigation remains unchanged and usable.
- [ ] Accessibility/viewport checks pass.
- [ ] Fit modes preserve the 10 px floor; Comfortable mode uses approximately 13–14 px.
- [ ] Amendment Undo remains prominent for 10 seconds and permanent reversal remains available.

### Before production publication

- [ ] Shadow comparison has zero unexplained differences.
- [ ] Boundary-week policy is locked from `weekStart`; incomplete adjacent context is correctly Provisional rather than falsely complete.
- [ ] Staffing/OFF/GOFF issues reviewed.
- [ ] Night-bundle, seventh-day, and post-night-rest issues reviewed/acknowledged.
- [ ] Projection checksum verified.
- [ ] No unsafe pending/failed operations.
- [ ] Rollback owner and procedure confirmed.

### Before GOFF production enablement

- [ ] Exact first enrolled monthly period recorded; commencement equals its first day.
- [ ] Administrator supplied an opening balance and source note for every applicable person.
- [ ] Opening-balance batch reconciles independently with no missing/duplicate person.
- [ ] `OFF → PN`, reversal, and duplicate-prevention contract tests pass.
- [ ] No pre-commencement historical roster generated inferred GOFF.

### Before close/reopen

- [ ] All amendment operations confirmed.
- [ ] GOFF pending earns/reservations reviewed.
- [ ] Negative overrides explained.
- [ ] Close reconciliation preview approved.
- [ ] Close was explicitly confirmed by the administrator; no automatic close path exists.
- [ ] Post-close ledger/projection report archived.

## 19. Risks and mitigations

| Risk | Evidence/impact | Mitigation |
|---|---|---|
| Destructive roster overwrite | Current handler clears all `MasterRoster` rows. | New scoped v2 actions; enrolled-period rejection of legacy upload; backup/checksum projection. |
| Apps Script lacks transactions | Multi-sheet amendment+ledger can partially write. | Operation journal, Pending invisibility, lock, deterministic recovery, projection verification. |
| Deployment drift | Backend is manually deployed from `appscript.txt`. | Version endpoint/hash, backend-first deployment checklist, contract tests. |
| Client PIN is not authorization | Critical endpoints could be called directly and private administrative notes could leak. | Add server-side single-admin authorization before official writes or private-note reads; omit notes from viewer payloads. |
| Names are mutable identifiers | Current records link by strings and alias mapping. | Add `RosterPeople` stable IDs and snapshot display names. |
| Cache/out-of-order overwrite | Current full refresh/whole-array rollback. | Revision-aware merge, per-cell inverse patch, ordered queue, stale-response rejection. |
| Settings JSON lost update | Opening balances currently share one JSON cell. | Append-only GOFF ledger; critical confirmation; lock/revision. |
| Cross-month ambiguity | Current calculations build only selected month. | Monthly assignment ownership plus shared `weekStart` policy record; Provisional until all seven published dates exist; reject cross-period overwrite. |
| `PN` semantic drift | Current active-shift logic groups `PN` with worked duties, contradicting the resolved staffing/consecutive rules. | One versioned semantic resolver consumed by every validator/ledger; migration fixtures prove no retroactive reinterpretation. |
| Duplicate `OFF → PN` earn | Retries or linked amendment lines could grant multiple credits. | Unique source key plus operation idempotency and compensating reversal tests. |
| No skill/role source | Automated candidate filtering could falsely imply eligibility. | No initial skill filtering; label `Eligibility not checked`; administrator confirms suitability. |
| GOFF rollout data incomplete | Exact first period or a person’s opening balance may be missing. | Treat as production-enablement inputs; block GOFF switch until complete batch reconciliation, not code implementation. |
| Unknown full sheet shape | The copied test endpoint now provides API-visible fields and rows, but not physical tab metadata, formulas, protections, triggers, properties, timezone, backup provenance, or proof of production equivalence. | Complete the remaining Phase 0 copied-workbook/deployment inventory; no production schema action before sign-off. |
| Service-worker staleness | Static assets can remain cached. | Versioned cache and deployment verification; stale-client backend guards. |
| Sheet scale/latency | More append-only records and period reads. | Period-scoped endpoints, batch reads/writes, in-memory indexes, archive only after retention decision, measure before optimizing. |
| Privacy leakage | MC is public while free-text notes are private. | Separate public category from server-authorized admin note; omit note fields from viewer responses; copy guidance and tests. |
| New UI density harms access | Fit modes may make text/touch targets too small. | Minimum type/target guard, controlled scroll fallback, zoom/text-size tests. |

## 20. Assumptions

- Google Sheets remains the system of record and Apps Script remains the write authority.
- There is one administrator, but general viewers may access the deployed site.
- `MasterRoster` must remain readable by the current viewer during transition.
- Roster dates are whole local dates, not instants; ISO `YYYY-MM-DD` is the canonical transport form.
- Existing HKA/GHKA behavior remains separate from GOFF.
- `PN` follows the resolved special semantics and must not be folded into a generic active/worked set.
- Historical roster rows remain uninterpreted legacy facts; new semantic mappings do not create retrospective compliance or GOFF outcomes.
- New official records may use UUIDs even though legacy records use timestamps.
- Relative complexity may change after live/copy workbook inspection.

## 21. Deployment inputs and technical gates

These items do not represent unresolved product architecture:

- **GOFF rollout inputs:** exact first lifecycle-enrolled `YYYY-MM`, its derived first-day commencement, and administrator-confirmed opening balance/source for every applicable person. They block only GOFF production enablement until reconciled.
- **Production evidence:** no-side-effect workbook inventory, deployed Apps Script version, operational timezone, and any codes beyond the resolved initial semantic mapping.
- **Security gate:** selected server-side single-administrator authorization mechanism and verified private-note response separation. This blocks production official writes/private-note reads.
- **Staffing input:** authoritative thresholds replacing the current device-local configuration.

No technical contradiction was found. The material implementation hazard is refactoring all current code paths that treat `PN` as active without accidentally altering legacy historical display/data.

## 22. Cross-document consistency map

| Specification concept | Implementation phase/data owner |
|---|---|
| Shared shift semantics and special `PN` treatment | Phase 1; `ShiftSemantics` and one pure resolver |
| Policy A/B and independent cross-month Monday–Sunday weeks | Phase 3; `OffPolicies`, Provisional/Complete `WeeklyOffSnapshots` |
| Draft → Published → Amended → Closed | Phase 4; `RosterPeriods`, `RosterEvents` |
| Immutable planned versus current | Phases 4–5; `RosterAssignments` + confirmed event resolver |
| Absence/replacement/swap/correction/reversal | Phases 5–6; linked `RosterEvents` rows |
| GOFF commencement/opening and OFF displacement including `OFF → PN` | Phase 7; `GoffLedger` and rollout gate |
| Optimistic pending/confirmed/failed/conflict | Phase 2; client outbox + `OperationLog` |
| Night bundles, six-day sequence/seventh-day warning, rest | Phases 1 and 3; shared semantics and validators |
| Issues panel and smart suggestions without initial eligibility filtering | Phases 3, 5, 6, 7; shared validators |
| Collapsible desktop sidebar, focus, fit modes | Phase 8; workspace components/preferences |
| Legacy planned=current/read-only | Phase 1; legacy adapter and period enrollment |
| Backup, rollback, reconciliation | Phases 0 and 9; checksums, operation recovery, runbooks |
