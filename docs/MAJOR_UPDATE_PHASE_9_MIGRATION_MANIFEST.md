# Major Update — Phase 9 Production Migration Manifest

**Document Version**: 1.1.0
**Phase**: Phase 9 Slice 1.1 — Production Cutover Preflight & Non-Production Migration Rehearsal Hardening
**Execution Context**: Strict Non-Production Rehearsal (Zero Live Mutations, Zero Deployments)
**Authoritative Baseline**:
- `main` / `origin/main`: `17712a4f7e177771ff3cf44d02d7ba570f567d21`
- Deployed Frontend (`origin/gh-pages`): `4ec7843f992fa0e05540274085a83464470f262e` (legacy SPA)
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
| 13 | `ShiftSemantics` | Phase 1 | `ShiftCode`, `RuleVersion`, `DirectoryType`, `CountsAsWorked`, `ConsecutiveBehavior`, `StaffingBucket`, `PolicyBQualifier`, `NormalOff`, `CanDisplaceOffEarnGoff`, `ExpectedPredecessorsJson`, `ExpectedFollowersJson` | No | **Yes** | Yes | **Yes** | **CREATE / SEED** |
| 14 | `OperationLog` | Phase 2 | `OperationId`, `ClientId`, `TabId`, `OperationType`, `EntityKey`, `ExpectedRevision`, `ResultRevision`, `PayloadHash`, `Status`, `ResultJson`, `ErrorCode`, `CreatedAt`, `CompletedAt` | No | **Yes** | Yes | **Yes (Append-only)** | **CREATE** |
| 15 | `RosterDraftPatches` | Phase 2 | `OperationId`, `EntityKey`, `BaseRevision`, `ResultRevision`, `PayloadJson`, `ResultChecksum` | No | **Yes** | Yes | **Yes (Append-only)** | **CREATE** |
| 16 | `OffPolicies` | Phase 3 | `PolicyId`, `PolicyCode`, `EffectiveMonday`, `RuleVersion`, `RuleJson`, `Active`, `Reason`, `Revision`, `OperationId`, `CreatedAt`, `CreatedBy` | No | **Yes** | Yes | **Yes** | **CREATE / SEED** |
| 17 | `RosterPeriods` | Phase 4 (upg P1) | `PeriodId`, `State`, `Revision`, `DraftRevision`, `PlannedSnapshotId`, `PublishedAt`, `PublishedBy`, `ClosedAt`, `ClosedBy`, `ProjectionChecksum`, `SchemaVersion`, `LastOperationId`, `UpdatedAt` | No / P1 Staging | **Yes** | Yes (Additive) | **Yes** | **CREATE / ADD COLUMNS** |
| 18 | `RosterAssignments` | Phase 4 | `AssignmentId`, `PeriodId`, `Layer`, `SnapshotId`, `PersonId`, `PersonNameSnapshot`, `Date`, `DutyDomain`, `ShiftCode`, `ModifiersJson`, `DraftRevision`, `Source`, `OperationId`, `CreatedAt`, `CreatedBy` | No | **Yes** | Yes | **Yes (Append-only)** | **CREATE** |
| 19 | `WeeklyOffSnapshots` | Phase 4 | `WeekSnapshotId`, `WeekStart`, `WeekEnd`, `PolicyLockedByPeriodId`, `PublishedPeriodIdsJson`, `PublishedDateMask`, `EvaluationState`, `PlannedSnapshotIdsJson`, `PlannedWeekChecksum`, `PersonId`, `PersonNameSnapshot`, `PolicyId`, `PolicyCode`, `RuleVersion`, `HasQualifyingPlannedNight`, `RequiredOffCount`, `AssignedOffCountAtPublish`, `Revision`, `OperationId`, `CreatedAt`, `CompletedAt` | No | **Yes** | Yes | **Yes** | **CREATE** |
| 20 | `RosterEvents` | Phase 5 | `EventId`, `LineId`, `EventType`, `OperationId`, `PeriodId`, `BaseRevision`, `ResultRevision`, `PersonId`, `LinkedPersonIdsJson`, `Date`, `DutyDomain`, `PlannedAssignmentJson`, `BeforeCurrentJson`, `AfterCurrentJson`, `PublicReasonCode`, `AdminNote`, `ShortageAccepted`, `ShortageReason`, `GoffTransactionIdsJson`, `ReversesEventId`, `CreatedAt`, `CreatedBy` | No | **Yes** | Yes | **Yes (Append-only)** | **CREATE** |
| 21 | `RosterAbsences` | Phase 6 | `AbsenceId`, `PeriodId`, `PersonId`, `PersonNameSnapshot`, `AbsenceType`, `StartDate`, `EndDate`, `DutyDomain`, `PublicReason`, `AdminNote`, `Status`, `OperationId`, `CreatedAt`, `CreatedBy` | No | **Yes** | Yes | **Yes (Append-only)** | **CREATE** |
| 22 | `RosterReplacements` | Phase 6 | `ReplacementId`, `AbsenceId`, `OriginalAssignmentId`, `ReplacementPersonId`, `ReplacementAssignmentId`, `DutyDomain`, `Date`, `ShiftCode`, `Status`, `OperationId`, `CreatedAt`, `CreatedBy` | No | **Yes** | Yes | **Yes (Append-only)** | **CREATE** |
| 23 | `RosterEntitlementTransactions` | Phase 7 | `TransactionId`, `PeriodId`, `PersonId`, `PersonNameSnapshot`, `EntitlementType`, `DutyDomain`, `TransactionType`, `Amount`, `EffectiveDate`, `SourceType`, `SourceId`, `SourceAssignmentId`, `SourcePeriodId`, `PublicHolidayDate`, `PublicHolidayName`, `RosterAssignmentId`, `RelatedTransactionId`, `ReasonCode`, `AdminNote`, `ExpiresAt`, `ExpiryPolicyCode`, `Status`, `OperationId`, `CreatedAt`, `CreatedBy` | No | **Yes** | Yes | **Yes (Append-only)** | **CREATE** |

---

## 3. Required Reference Data Seeding

Provisioning schemas creates empty canonical tables. However, **empty tables are insufficient for V2 operations**. Publishing or operating a V2 period will strictly fail unless the following mandatory prerequisite tables are seeded prior to first period publish:

### A. `ShiftSemantics`
- **Requirement**: Must be pre-populated with catalog rules for all operational shift codes (`AM`, `PM`, `OH`, `COURT`, `ON1`, `ON2`, `ON`, `N`, `NIGHT`, `PN`, `OFF`, `GOFF`, `HKA`, `GHKA`, `AL`, `MC`, `EL`, `COURSE`, `EP_OFFICE_HOUR`, `EP_ONCALL`).
- **Provisioning Action**: Created during schema provisioning.
- **Seeding Action**: Populate canonical rows (`rosterV2CatalogRows_()`).

### B. `OffPolicies`
- **Requirement**: Must contain at least one valid, active weekly-off policy (`PolicyCode: 'A'`, `RuleVersion: 1`, `Active: true`) whose `EffectiveMonday` covers the cutover period's weeks.
- **Critical Risk**: If `OffPolicies` is empty when `rosterv2publish` executes, `aggregateWeeklyOffSnapshots` throws `INVALID_OFF_POLICY`. Because Planned assignments were already written, the publish halts and transitions the operation to `RECOVERY_REQUIRED`.
- **Seeding Action**: Seed canonical Policy A row (`aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`, `A`, `2026-10-26`, `1`, `guidance.policyRuleJson('A')`, `true`, ...).

### C. `Settings`
- **Requirement**: Must have all reserved feature switch keys initialized to safe defaults:
  - `roster_v2_read_enabled: 'false'`
  - `roster_v2_write_enabled: 'false'`
  - `shift_semantics_v2_enabled: 'false'`
  - `weekly_off_guidance_enabled: 'true'`
  - `night_safety_guidance_enabled: 'true'`
  - `goff_ledger_enabled: 'true'`
  - `write_queue_v2_enabled: 'false'`
  - `roster_workspace_v2_enabled: 'false'`
  - `legacy_upload_enabled: 'true'`

### D. `RosterPeople`
- **Requirement**: Must contain canonical entries for all medical staff appearing in the cutover period's draft assignments.
- **Critical Risk**: If an assigned doctor is not in `RosterPeople`, `generatePlannedSnapshot` fails with `VALIDATION_FAILED` (`PersonId not found in registered people`).

---

## 4. Production Identity Migration Contract

Identity migration transitions legacy `TeamMembers` (MO) and `EmergencyPhysicians` (EP) records into canonical `RosterPeople` rows. Display names are mutable presentation strings and **must never** be used as the sole basis for canonical identity.

### A. Canonical Source Identity Priority
1. **Priority 1**: `DirectoryType + StaffId` (Primary immutable identifier, e.g. `MO:staffId:MO-101`).
2. **Priority 2**: `DirectoryType + Email` (Secondary unique identifier where StaffId is absent, e.g. `MO:email:doctor@hospital.gov.my`).
3. **Priority 3**: Explicit reviewed manual mapping (For records missing both StaffId and Email).

### B. Deterministic RFC 4122 UUIDv4 Derivation
- To ensure idempotency (rerunning migration produces identical `PersonId`s without duplicating or regenerating UUIDs), `PersonId` is deterministically derived from the canonical source key:
  ```
  sourceKey = "${directoryType}:${identifierType}:${identifierValue}"
  UUID = deterministicUuid("person:" + sourceKey, digestFn)
  ```
- **Algorithm**: Compute SHA-256 hash of `person:${sourceKey}`. Format first 16 bytes as UUIDv4:
  - Byte 6 set to `(byte & 0x0f) | 0x40` (UUID version 4)
  - Byte 8 set to `(byte & 0x3f) | 0x80` (RFC 4122 variant 1)
  - Output format: `xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx`

### C. Dry-Run Planning Categories
The identity migration utility (`planIdentityMigration`) inspects directories without modifying Sheets and classifies each entry into one of 6 categories:
1. `CREATE`: New staff with valid stable ID (`StaffId` or `Email`) not currently in `RosterPeople`.
2. `REUSE`: Existing person in `RosterPeople` with matching `PersonId` and identical display name.
3. `ALIAS_UPDATE`: Existing person whose display name changed. Former name is automatically preserved in `LegacyNamesJson`.
4. `INACTIVE`: Staff member with `Active: false`. Retained in `RosterPeople` with `Active: false`.
5. `AMBIGUOUS`: Fails closed immediately on:
   - Duplicate `StaffId` or `Email` within a directory.
   - Cross-domain collision (same `StaffId` or `Email` present in both MO and EP).
6. `MISSING_STABLE_ID`: Record lacks both `StaffId` and valid `Email`. Cannot derive durable ID; manual admin mapping required before migration can proceed (`canProceed: false`).

---

## 5. Baseline Planned vs Current Persistence Semantics

### Physical Persisted Rows vs Resolved Current Output:
- **`RosterAssignments` Table**:
  - Physically persists **ONLY** rows with `Layer: 'PLANNED'`.
  - **Zero rows** with `Layer: 'CURRENT'` are written to Google Sheets upon publish or amendment.
- **Dynamic Current Resolution**:
  - `Current` roster assignments are dynamically derived in memory by `RosterLifecycle.resolveCurrentRoster()` by folding confirmed lifecycle events (`RosterEvents`), operational absences (`RosterAbsences`), replacements (`RosterReplacements`), and entitlement transactions (`RosterEntitlementTransactions`) on top of the immutable Planned snapshot.
  - Immediately upon publish (with zero events), derived `Current` assignments match `PLANNED` assignments exactly, and are projected into `MasterRoster` for downstream legacy compatibility.
  - Client endpoint `rosterv2current` returns client DTOs reflecting this resolved Current state.

---

## 6. GOFF / GHKA Opening Balance Contract

1. **No Automatic Inference**: Past roster notations (including `GOFF*`, `GOFF`, `GHKA`) generate zero automatic entitlement balance.
2. **Reviewed Opening Balances Only**: Opening balances must be established via authorized manual credit transactions using the certified backend action `rosterv2entitlementcreditmanual`.
3. **Accepted ReasonCode**: The backend strictly validates `reasonCode`. `reasonCode: 'OPENING_BALANCE'` is natively accepted by the backend.
4. **Transaction Constraints**:
   - `amount`: must be atomic `+1` (multi-balance credits require individual atomic transactions).
   - `effectiveDate`: first day of cutover period (e.g. `2026-11-01`).
   - `adminNote`: mandatory reference to admin sign-off document.
   - Guard: requires `roster_v2_write_enabled: 'true'`.

### Opening Balance Non-Production Review & Import Template:
```json
[
  {
    "personId": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
    "displayName": "Dr. Sarah Lee",
    "directoryType": "MO",
    "entitlementType": "GOFF",
    "amount": 1,
    "effectiveDate": "2026-11-01",
    "reasonCode": "OPENING_BALANCE",
    "adminNote": "October 2026 manual ledger reconciliation sign-off ref #GOFF-2026-10",
    "reviewerSignOff": "Dr. Head of Department, MD"
  }
]
```

---

## 7. Technologically Sound Staged Cutover Sequence (Stages A–G)

The cutover sequence must execute in the following strict staged order:

### Stage A — Immutable Baseline
1. **Maintenance & Freeze Window**: Announce scheduled cutover window; freeze all legacy roster edits.
2. **Full Production Sheet Backup**: Create full copy of production Google Sheet (e.g. `PROD_BACKUP_YYYYMMDD_HHMMSS`).
3. **Record Baseline Row Counts & Checksums**: Record row counts for `MasterRoster`, `Requests`, `LeaveApplications`, `TeamMembers`, `EmergencyPhysicians`.
4. **Record Rollback References**: Record current Git commits for Apps Script and `gh-pages` (`17712a4f7e177771ff3cf44d02d7ba570f567d21`, `4ec7843f992fa0e05540274085a83464470f262e`).
*Zero sheet mutations permitted in Stage A.*

### Stage B — Compatible Backend Deployment
5. **Deploy Certified Apps Script Backend**: Deploy Phase 8 Apps Script bundle (`appscript.txt`) to production Apps Script project while V2 features remain disabled.
6. **Set Initial Safe Flags**:
   - `roster_workspace_v2_enabled: false`
   - `roster_v2_read_enabled: false`
   - `roster_v2_write_enabled: false`
   - `legacy_upload_enabled: true`
7. **Smoke-Test Legacy API**: Verify `getRequests`, `getLeaveApplications`, and legacy roster endpoints operate identically against the new backend bundle.

### Stage C — Additive Provisioning & Seed Audit
8. **Run Schema Provisioning**: Execute `rosterProvisionAllSchemas_()`.
9. **Verify Non-Destructive Invariant**: Confirm all legacy rows and checksums remain 100% intact.
10. **Verify Idempotency**: Run provisioning a second time; confirm zero destructive diff.
11. **Seed Mandatory Reference Tables**:
    - Seed `ShiftSemantics` with catalog rows (`rosterV2CatalogRows_()`).
    - Seed `OffPolicies` with active Policy A covering cutover month.
    - Seed `Settings` with standard feature keys.

### Stage D — Identity Registry
12. **Run Identity Migration Utility**: Execute `planIdentityMigration` in dry-run mode against `TeamMembers` and `EmergencyPhysicians`.
13. **Fail-Closed on Ambiguity**: Halt immediately if any record is categorized as `AMBIGUOUS` or `MISSING_STABLE_ID`.
14. **Populate `RosterPeople`**: Once clean, populate `RosterPeople` with deterministic `PersonId`s.

### Stage E — Hidden V2 Initialization
15. **Enable Temporary Initialization Flag Combination**:
    While `roster_workspace_v2_enabled` remains `false` (workspace hidden from all users) and legacy frontend remains active:
    - `roster_v2_write_enabled: true`
    - `roster_v2_read_enabled: true`
    - `legacy_upload_enabled: true`
    - `goff_ledger_enabled: true`
    - `weekly_off_guidance_enabled: true`
16. **Enroll Cutover Period**: Enroll cutover month in `RosterPeriods` (`State: 'DRAFT'`).
17. **Load DRAFT Assignments**: Populate draft duty cells.
18. **Publish Baseline Period**: Execute `rosterv2publish`.
19. **Verify Projections & Preservation**: Verify Planned snapshot created, Current derived, `MasterRoster` projection updated for cutover month only, and historical months preserved byte-for-byte.
20. **Import Opening Credits**: Admin executes manual credit transactions with `reasonCode: 'OPENING_BALANCE'`.

### Stage F — Frontend Compatibility Deployment
21. **Deploy Certified Frontend Release**: Push certified build bundle to `gh-pages` while `roster_workspace_v2_enabled = false`.
22. **Verify Legacy User Experience**: Confirm that with workspace flag disabled, the new frontend provides the intended safe legacy calendar/table views with zero V2 controls displayed.

### Stage G — Activation
23. **Enable V2 Feature Switches**: Set `write_queue_v2_enabled = true`.
24. **Disable Legacy Upload**: Set `legacy_upload_enabled = false` (legacy upload no longer authoritative).
25. **Activate Unified Workspace**: Set `roster_workspace_v2_enabled = true` as the final user-facing switch.
26. **Post-Cutover Verification**: Verify full V2 desktop/mobile views, amendment workflows, and audit trail.

---

## 8. Multi-Tier Rollback Architecture

Disabling feature flags alone provides immediate runtime safety, but does not rollback client code assets. The verified rollback architecture operates across three explicit tiers:

### Tier 1 — Instant Feature Flag Rollback (Runtime Isolation)
- **Action**: In `Settings` sheet, set:
  - `roster_workspace_v2_enabled: false`
  - `roster_v2_write_enabled: false`
  - `roster_v2_read_enabled: false`
  - `legacy_upload_enabled: true`
- **Result**:
  - Frontend immediately hides V2 workspace and displays legacy calendar/table views.
  - V2 write mutations fail closed (`FEATURE_DISABLED`).
  - Legacy endpoints (`getRequests`, `getLeaveApplications`) continue functioning.
  - Audit structures (`OperationLog`, `RosterEvents`, `RosterAssignments`, `RosterEntitlementTransactions`) remain completely preserved.

### Tier 2 — Frontend Asset Rollback (Asset Regression)
- **Trigger**: Client-side JavaScript bundle crash, browser compatibility defect, or CSS corruption.
- **Action**: Re-deploy previous certified commit (`4ec7843f992fa0e05540274085a83464470f262e`) to `gh-pages`.

### Tier 3 — Backend Deployment Rollback (Backend Logic Defect)
- **Trigger**: Severe Google Apps Script runtime exception or quota exhaustion.
- **Action**: Revert Apps Script deployment version to the pre-cutover version recorded in Stage A.
