# Major Update — Phase 9 Production Migration Manifest

**Document Version**: 1.0.0  
**Phase**: Phase 9 Slice 1 — Production Cutover Preflight & Non-Production Migration Rehearsal  
**Execution Context**: Strict Non-Production Rehearsal (Zero Live Mutations, Zero Deployments)  
**Authoritative Baseline**:  
- `main` / `origin/main`: `17712a4f7e177771ff3cf44d02d7ba570f567d21`  
- Deployed Frontend (`origin/gh-pages`): `4ec7843` (legacy SPA)  
- Production Backend: Manually managed Apps Script V1.1 backend containing the historical MasterRoster month-safety fix.  
- Phase 8 Certified Checkpoint: `dab0d8acf40c184b138d1d237a20f897d8bf277a`  

---

## 1. Executive Migration Charter

The objective of this manifest is to govern the transition of the Google Sheets persistence tier from the legacy schema (Phases 0–1 legacy) to the certified Phase 8 enterprise medical officer roster architecture without data loss, downtime, or disruption to operational hospital scheduling.

### Fundamental Tenets:
1. **Non-Destructive by Default**: No existing table, column, or row is cleared, truncated, or dropped.
2. **Strict Additive Schema Evolution**: New tables are created on demand. Existing tables receive missing columns appended at the end of the header row.
3. **Preservation Invariance**: Historical `MasterRoster` data (all previous months), pending `Requests`, historical leave applications, and unknown custom columns must survive byte-for-byte and row-for-row.
4. **Decoupled Identity & Accounting**: Medical Officer (MO) and Emergency Physician (EP) domains are strictly separated. Identity is resolved through canonical `PersonId`s from `RosterPeople`. Ambiguous names fail closed.
5. **No Automatic Balance Invention**: Legacy `GOFF*` markers remain `GOFF_STAR_SEMANTICS_UNRESOLVED`. Historical duty shifts do not generate opening entitlement balances automatically.

---

## 2. Complete Persistent Data Structure Inventory

The certified architecture requires 23 distinct Google Sheet tables across legacy operations, Phase 1 identity/semantics, Phase 2 drafting, Phase 3 guidance, Phase 4 lifecycle, Phase 5 amendments, Phase 6 operational coverage, and Phase 7 entitlement accounting.

| # | Table / Sheet Name | Phase | Required Columns (Canonical Order) | In Prod Now? | Create at Cutover? | Additive Migration? | Preserve Rows? | Classification |
|---|-------------------|-------|------------------------------------|--------------|--------------------|---------------------|----------------|----------------|
| 1 | `Requests` | Legacy | `ID`, `Timestamp`, `Name`, `Date`, `Day`, `Request`, `Status`, `Comment`, `ApprovalStatus`, `SwapPartner`, `RequestType` | Yes | No | N/A | **Yes (All)** | **KEEP AS-IS** |
| 2 | `TeamMembers` | Legacy | `MemberName`, `FullName`, `Phone`, `Active`, `StaffId`, `Email` | Yes | No | N/A | **Yes (All)** | **KEEP AS-IS** |
| 3 | `EmergencyPhysicians` | Legacy | `MemberName`, `FullName`, `Phone`, `Active`, `StaffId`, `Email` | Yes | No | N/A | **Yes (All)** | **KEEP AS-IS** |
| 4 | `MasterRoster` | Legacy / P1 Hotfix | `Name`, `Date`, `Shift` | Yes | No | Yes (Projection) | **Yes (All historical)** | **COMPATIBILITY ONLY** |
| 5 | `ShiftBlocks` | Legacy | `ID`, `Date`, `ShiftType`, `MaxSlots` | Yes | No | N/A | **Yes (All)** | **KEEP AS-IS** |
| 6 | `ShiftTypes` | Legacy | `ID`, `Name`, `IsPublic`, `GroupID` | Yes | No | N/A | **Yes (All)** | **KEEP AS-IS** |
| 7 | `LimitGroups` | Legacy | `ID`, `GroupName`, `DefaultLimit` | Yes | No | N/A | **Yes (All)** | **KEEP AS-IS** |
| 8 | `ActivityHistory` | Legacy | `ID`, `Timestamp`, `CustomText`, `Name`, `RequestType`, `Request`, `SwapPartner`, `Date`, `ApprovalStatus`, `Comment`, `Status` | Yes | No | N/A | **Yes (All)** | **KEEP AS-IS** |
| 9 | `PublicHolidays` | Legacy | `ID`, `Date`, `Name`, `Active` | Yes | No | N/A | **Yes (All)** | **KEEP AS-IS** |
| 10 | `LeaveApplications` | Legacy | `ID`, `MemberName`, `LeaveType`, `StartDate`, `EndDate`, `Days`, `Status`, `SubmittedDate`, `ReferenceNo`, `Notes`, `UpdatedAt` | Yes | No | N/A | **Yes (All)** | **KEEP AS-IS** |
| 11 | `Settings` | Legacy / P1 | `Key`, `Value` | Yes | No | Yes (Append keys) | **Yes (All)** | **ADD COLUMNS / ROWS** |
| 12 | `RosterPeople` | Phase 1 | `PersonId`, `DirectoryType`, `CurrentDisplayName`, `LegacyNamesJson`, `Active`, `CreatedAt`, `UpdatedAt` | No | **Yes** | Yes | **Yes** | **CREATE / MIGRATE** |
| 13 | `ShiftSemantics` | Phase 1 | `ShiftCode`, `RuleVersion`, `DirectoryType`, `CountsAsWorked`, `ConsecutiveBehavior`, `StaffingBucket`, `PolicyBQualifier`, `NormalOff`, `CanDisplaceOffEarnGoff`, `ExpectedPredecessorsJson`, `ExpectedFollowersJson` | No | **Yes** | Yes | **Yes** | **CREATE** |
| 14 | `OperationLog` | Phase 2 | `OperationId`, `ClientId`, `TabId`, `OperationType`, `EntityKey`, `ExpectedRevision`, `ResultRevision`, `PayloadHash`, `Status`, `ResultJson`, `ErrorCode`, `CreatedAt`, `CompletedAt` | No | **Yes** | Yes | **Yes (Append-only)** | **CREATE** |
| 15 | `RosterDraftPatches` | Phase 2 | `OperationId`, `EntityKey`, `BaseRevision`, `ResultRevision`, `PayloadJson`, `ResultChecksum` | No | **Yes** | Yes | **Yes (Append-only)** | **CREATE** |
| 16 | `OffPolicies` | Phase 3 | `PolicyId`, `PolicyCode`, `EffectiveMonday`, `RuleVersion`, `RuleJson`, `Active`, `Reason`, `Revision`, `OperationId`, `CreatedAt`, `CreatedBy` | No | **Yes** | Yes | **Yes** | **CREATE** |
| 17 | `RosterPeriods` | Phase 4 (upg P1) | `PeriodId`, `State`, `Revision`, `DraftRevision`, `PlannedSnapshotId`, `PublishedAt`, `PublishedBy`, `ClosedAt`, `ClosedBy`, `ProjectionChecksum`, `SchemaVersion`, `LastOperationId`, `UpdatedAt` | No / P1 Staging | **Yes** | Yes (Additive) | **Yes** | **CREATE / ADD COLUMNS** |
| 18 | `RosterAssignments` | Phase 4 | `AssignmentId`, `PeriodId`, `Layer`, `SnapshotId`, `PersonId`, `PersonNameSnapshot`, `Date`, `DutyDomain`, `ShiftCode`, `ModifiersJson`, `DraftRevision`, `Source`, `OperationId`, `CreatedAt`, `CreatedBy` | No | **Yes** | Yes | **Yes (Append-only)** | **CREATE** |
| 19 | `WeeklyOffSnapshots` | Phase 4 | `WeekSnapshotId`, `WeekStart`, `WeekEnd`, `PolicyLockedByPeriodId`, `PublishedPeriodIdsJson`, `PublishedDateMask`, `EvaluationState`, `PlannedSnapshotIdsJson`, `PlannedWeekChecksum`, `PersonId`, `PersonNameSnapshot`, `PolicyId`, `PolicyCode`, `RuleVersion`, `HasQualifyingPlannedNight`, `RequiredOffCount`, `AssignedOffCountAtPublish`, `Revision`, `OperationId`, `CreatedAt`, `CompletedAt` | No | **Yes** | Yes | **Yes** | **CREATE** |
| 20 | `RosterEvents` | Phase 5 | `EventId`, `LineId`, `EventType`, `OperationId`, `PeriodId`, `BaseRevision`, `ResultRevision`, `PersonId`, `LinkedPersonIdsJson`, `Date`, `DutyDomain`, `PlannedAssignmentJson`, `BeforeCurrentJson`, `AfterCurrentJson`, `PublicReasonCode`, `AdminNote`, `ShortageAccepted`, `ShortageReason`, `GoffTransactionIdsJson`, `ReversesEventId`, `CreatedAt`, `CreatedBy` | No | **Yes** | Yes | **Yes (Append-only)** | **CREATE** |
| 21 | `RosterAbsences` | Phase 6 | `AbsenceId`, `PeriodId`, `PersonId`, `PersonNameSnapshot`, `AbsenceType`, `StartDate`, `EndDate`, `DutyDomain`, `PublicReason`, `AdminNote`, `Status`, `OperationId`, `CreatedAt`, `CreatedBy` | No | **Yes** | Yes | **Yes (Append-only)** | **CREATE** |
| 22 | `RosterReplacements` | Phase 6 | `ReplacementId`, `AbsenceId`, `OriginalAssignmentId`, `ReplacementPersonId`, `ReplacementAssignmentId`, `DutyDomain`, `Date`, `ShiftCode`, `Status`, `OperationId`, `CreatedAt`, `CreatedBy` | No | **Yes** | Yes | **Yes (Append-only)** | **CREATE** |
| 23 | `RosterEntitlementTransactions` | Phase 7 | `TransactionId`, `PeriodId`, `PersonId`, `PersonNameSnapshot`, `EntitlementType`, `DutyDomain`, `TransactionType`, `Amount`, `EffectiveDate`, `SourceType`, `SourceId`, `SourceAssignmentId`, `SourcePeriodId`, `PublicHolidayDate`, `PublicHolidayName`, `RosterAssignmentId`, `RelatedTransactionId`, `ReasonCode`, `AdminNote`, `ExpiresAt`, `ExpiryPolicyCode`, `Status`, `OperationId`, `CreatedAt`, `CreatedBy` | No | **Yes** | Yes | **Yes (Append-only)** | **CREATE** |

---

## 3. Sheet Transformation Classifications

### KEEP AS-IS
- `Requests`, `LeaveApplications`, `TeamMembers`, `EmergencyPhysicians`, `ShiftBlocks`, `ShiftTypes`, `LimitGroups`, `PublicHolidays`, `ActivityHistory`.
- **Transformation**: Zero structure changes. Legacy rows, column order, formulas, and extra columns remain completely untouched. Read compatibility guaranteed for legacy endpoints.

### ADD COLUMNS / ROWS
- `Settings`: Existing rows preserved. New reserved V2 configuration switches are appended if missing:
  - `roster_v2_read_enabled: 'false'`
  - `roster_v2_write_enabled: 'false'`
  - `shift_semantics_v2_enabled: 'false'`
  - `weekly_off_guidance_enabled: 'false'`
  - `night_safety_guidance_enabled: 'false'`
  - `goff_ledger_enabled: 'false'`
  - `write_queue_v2_enabled: 'false'`
  - `roster_workspace_v2_enabled: 'false'`
  - `legacy_upload_enabled: 'true'` (set to `'false'` after successful baseline verification)
- `RosterPeriods`: If an earlier Phase 1 4-column iteration exists (`PeriodId`, `SchemaVersion`, `EnrolledAt`, `EnrolledBy`), missing columns are appended in canonical order while retaining `EnrolledAt`, `EnrolledBy`, and any custom columns at the end. Existing rows receive default values (`State: 'DRAFT'`, `Revision: 0`, `DraftRevision: 0`).

### CREATE
- Newly provisioned sheets created with canonical headers:
  - `RosterPeople`, `ShiftSemantics`, `OperationLog`, `RosterDraftPatches`, `OffPolicies`, `RosterAssignments`, `WeeklyOffSnapshots`, `RosterEvents`, `RosterAbsences`, `RosterReplacements`, `RosterEntitlementTransactions`.
- Ensured idempotently via `rosterProvisionAllSchemas_()`. If sheet already exists, no destructive changes are made.

### MIGRATE
- `RosterPeople`: Deterministic population from `TeamMembers` (MO) and `EmergencyPhysicians` (EP).
  - Every active/inactive staff member receives a durable RFC 4122 UUIDv4 `PersonId`.
  - Name variants and known aliases populated in `LegacyNamesJson`.
  - Ambiguous duplicate names fail closed and require admin review before seeding.

### COMPATIBILITY ONLY
- `MasterRoster`: Authoritative status transferred to `RosterPeriods` / `RosterAssignments`.
  - `MasterRoster` acts as a month-scoped compatibility projection sheet for legacy viewers, external systems, and CSV exports.
  - When a V2 period is published or amended, only rows matching the target month (`YYYY-MM`) are rewritten. Non-target months, unparseable dates, and blank rows are preserved.
  - Full-roster uploads are blocked once any V2 period is enrolled.

---

## 4. Preservation Invariants

1. **Historical Month Survival**:
   - `MasterRoster` contains historical roster schedules (e.g. July, August, September, October). Under no circumstances may rows with dates outside the active cutover month be modified or truncated.
2. **Legacy Intent Preservation**:
   - `Requests` and `LeaveApplications` contain historical administrative submissions. They must not be converted into V2 amendments, operational absences, or entitlement transactions automatically. They remain historical intent records.
3. **Unknown Column Survival**:
   - If spreadsheet administrators or legacy add-ons added custom columns to `RosterPeriods`, `TeamMembers`, or `Requests`, additive schema provisioning retains those columns at the end of the header row, and preserves all cell values.
4. **Blank & Unparseable Row Survival**:
   - Blank rows, delimiter rows, and notes present in legacy `MasterRoster` or `Requests` must not be pruned or dropped by parsers.
5. **Emergency Physician Isolation**:
   - EP rows in `MasterRoster` and directory listings survive, but are assigned `DirectoryType: 'EP'` and `DutyDomain: 'EP'`. They are strictly excluded from MO weekly-off guidance, shortage evaluations, and MO entitlement ledger accounting.
6. **Canonical PersonId Authority**:
   - Display names in Google Sheets are mutable presentation strings. All V2 mutations, events, and audit logs must reference the immutable `PersonId`.

---

## 5. Production Roster Baseline Strategy

### Explicit Architectural Answers:

1. **Which month becomes the first enrolled V2 period?**
   - The upcoming roster month scheduled for live cutover (e.g. `2026-11` or target production month).
2. **How is its Planned snapshot established?**
   - Roster administrators draft duty assignments in the V2 UI or staging draft. Upon review, the admin triggers `rosterv2publish`.
   - The backend creates an immutable Planned snapshot:
     - `Layer: 'PLANNED'`
     - `SnapshotId: 'planned:<periodId>'`
     - Computes SHA-256 `PlannedWeekChecksum` and `ProjectionChecksum`.
     - Records initial weekly-off guidance snapshots in `WeeklyOffSnapshots`.
3. **What becomes its initial lifecycle state?**
   - Period is enrolled in `DRAFT` (`State: 'DRAFT'`, `Revision: 0`, `DraftRevision: 0`).
   - Transitioned to `PUBLISHED` upon cutover publish (`State: 'PUBLISHED'`, `Revision: 1`, `DraftRevision: 1`).
4. **How is Current initialized?**
   - On publish, the `Current` working layer matches `Planned` exactly. In `RosterAssignments`, Current assignments mirror Planned assignments with `Layer: 'CURRENT'`.
5. **How are historical months handled?**
   - Historical months (all months prior to the cutover month) remain in `MasterRoster` as legacy read-only tabular data.
6. **Are historical months enrolled into V2 or left legacy/read-only?**
   - **Left legacy/read-only.** Historical months are NOT enrolled into V2 and NOT retroactively synthesized into fake V2 lifecycle events.
7. **How is MasterRoster retained as compatibility projection rather than authority?**
   - `MasterRoster` is retained as a downstream projection sink. Whenever a V2 period publishes or amends, `RosterLifecycle.mergeMasterRosterProjection()` merges the new month's projection into `MasterRoster` while leaving all historical months untouched.

---

## 6. GOFF / GHKA Opening Balance Strategy

### Critical Safety Invariant:
Legacy `MasterRoster` contains historical shift notations such as `GOFF*`, `GOFF`, `GHKA`, and `OFF`.
- The certified domain contract specifies:
  `GOFF*` remains `GOFF_STAR_SEMANTICS_UNRESOLVED`.
- Historical `GOFF*` markers and past roster assignments **MUST NEVER** generate automatic entitlement balances.
- Auto-crediting balances from unverified legacy sheet history is strictly forbidden.

### Safe Opening Balance Import Approach:
Opening balances must be established strictly via authorized, admin-reviewed manual credit transactions using the certified backend endpoint:
- Endpoint: `rosterv2entitlementcreditmanual`
- Provenance / Attributes:
  - `TransactionType`: `'CREDIT_MANUAL'`
  - `ReasonCode`: `'OPENING_BALANCE'`
  - `EntitlementType`: `'GOFF'` or `'GHKA'`
  - `SourceType`: `'MANUAL'`
  - `AdminNote`: `'Verified opening balance as of cutover date by Head of Department'`

### Proposed Opening Balance Import Specification:
```json
[
  {
    "personId": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
    "personNameSnapshot": "Dr. Sarah Lee",
    "entitlementType": "GOFF",
    "amount": 2,
    "effectiveDate": "2026-11-01",
    "reasonCode": "OPENING_BALANCE",
    "adminNote": "Verified opening balance as of 2026-11-01 cutover"
  },
  {
    "personId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
    "personNameSnapshot": "Dr. Ahmad Farhan",
    "entitlementType": "GHKA",
    "amount": 1,
    "effectiveDate": "2026-11-01",
    "reasonCode": "OPENING_BALANCE",
    "adminNote": "Verified opening balance as of 2026-11-01 cutover"
  }
]
```

---

## 7. Identity Migration Audit & Mapping Contract

### Resolution Rules (`RosterCompatibility.personIndex`):
1. **Exact Directory Match**: Staff names matching `TeamMembers.MemberName` map directly to `RosterPeople`.
2. **Legacy Aliases**: Alternative spellings, nicknames, or historical name variations are cataloged in `RosterPeople.LegacyNamesJson` as a JSON array of strings (e.g. `["Dr. Ali", "Ali B."]` for canonical `Dr. Ali bin Hassan`).
3. **Fail-Closed on Duplicate / Ambiguous Identity**:
   - If two distinct individuals share the same display name or alias, resolution throws an error.
   - If a name exists in both MO (`TeamMembers`) and EP (`EmergencyPhysicians`) without an explicit domain, resolution returns `identityStatus: 'AMBIGUOUS_DOMAIN'`, `personId: null`. The system never guesses.
4. **Renamed Staff**: The canonical current display name is stored in `CurrentDisplayName`; former names are preserved in `LegacyNamesJson`.
5. **Inactive Staff**: Former staff members are retained in `RosterPeople` with `Active: false` to ensure historical assignments remain linked.
6. **EP Staff**: Emergency Physicians are tagged `DirectoryType: 'EP'`. They cannot participate in MO shift swaps, shortage acceptance, or MO entitlement accounting.
7. **Unmapped Staff**: Records missing from `RosterPeople` receive `identityStatus: 'UNREGISTERED'`, `personId: null`.

---

## 8. Feature Flag Inventory

All V2 feature switches reside in the `Settings` sheet and are read via `rosterV2Settings_()`:

| Switch Key | System Default | Pre-Cutover Value | Safe Cutover Value | Rollback Value | Architectural Purpose |
|------------|----------------|-------------------|--------------------|----------------|-----------------------|
| `roster_v2_read_enabled` | `false` | `false` | `true` | `false` | Gates official V2 period and read endpoints for clients. |
| `roster_v2_write_enabled` | `false` | `false` | `true` | `false` | Gates V2 lifecycle mutations (publish, close, reopen, amend). |
| `shift_semantics_v2_enabled` | `false` | `false` | `true` | `false` | Enables V2 shift semantic catalog validation and rules. |
| `weekly_off_guidance_enabled`| `false` | `false` | `true` | `false` | Enables weekly-off policy evaluation and warnings. |
| `night_safety_guidance_enabled`| `false` | `false` | `true` | `false` | Enforces consecutive night shift safety alerts. |
| `goff_ledger_enabled` | `false` | `false` | `true` (post-import) | `false` | Enables Phase 7 GOFF/GHKA entitlement ledger operations. |
| `write_queue_v2_enabled` | `false` | `false` | `true` | `false` | Activates client-side offline-first draft persistence queue. |
| `roster_workspace_v2_enabled`| `false` | `false` | `true` | `false` | Activates unified Phase 8 desktop/mobile roster workspace. |
| `legacy_upload_enabled` | `true` (unset) | `true` | `false` | `true` | Blocks full legacy CSV uploads to prevent overwriting V2 data. |

---

## 9. Proposed Production Cutover Sequence

The production cutover must be executed in 12 strictly decoupled, verifiable phases:

1. **Pre-Cutover Freeze & Announcement**: Announce maintenance window; freeze legacy roster edits.
2. **Authoritative Spreadsheet Backup**: Make an immutable copy of the production Google Sheet workbook.
3. **Record Baseline Checksums**: Record row counts, column counts, and hash digests of `MasterRoster`, `Requests`, `LeaveApplications`, `TeamMembers`, `EmergencyPhysicians`.
4. **Run Additive Schema Provisioning**: Execute `rosterProvisionAllSchemas_()` via Apps Script harness/editor to ensure all 12 V2 tables and default settings exist.
5. **Populate Identity Registry (`RosterPeople`)**: Seed `RosterPeople` from `TeamMembers` and `EmergencyPhysicians`, resolving all ambiguities.
6. **Deploy Compatible Apps Script Backend**: Deploy Phase 8 Apps Script bundle with all V2 flags set to `false`.
7. **Legacy Compatibility Smoke-Test**: Verify legacy `Requests`, `LeaveApplications`, and `MasterRoster` endpoints respond identically to baseline.
8. **Initialize Cutover Roster Period**: In V2 backend, enroll and publish the cutover month (`DRAFT` -> `PUBLISHED` planned snapshot).
9. **Import Verified Opening Balances**: Admin imports verified GOFF/GHKA opening balance transactions (`CREDIT_MANUAL`).
10. **Enable V2 Backend Feature Flags**: In `Settings`, set `roster_v2_read_enabled: 'true'`, `roster_v2_write_enabled: 'true'`, `goff_ledger_enabled: 'true'`, `legacy_upload_enabled: 'false'`.
11. **Deploy Frontend Release**: Push certified build bundle to `gh-pages`.
12. **Post-Cutover Verification & Sign-off**: Verify desktop workspace, roving focus, audit log appending, privacy redaction, and projection synchronization.
