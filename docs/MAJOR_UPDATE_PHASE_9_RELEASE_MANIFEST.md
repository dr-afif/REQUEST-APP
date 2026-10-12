# Major Update — Phase 9 Production Release Manifest

**Manifest Version**: 1.0.0  
**Release Stage**: Phase 9 Slice 2 — Production Preparation Package & Cutover Operator Runbook  
**Generated At**: 2026-10-12T00:00:00.000Z  
**Classification**: Authoritative Production Release Baseline  

---

## 1. Release Source & Artifact Coordinates

| Parameter | Authoritative Value / Reference | Status |
|---|---|:---:|
| **Source Branch** | `feature/phase-9-cutover` | Verified |
| **Certified Runtime Checkpoint** | `e6970ad6dd7d2afef0130cc9bb1de65be33f2205` | Certified Baseline |
| **Release Package Source Checkpoint** | `5ba7441a0cc1c6a2248834d164bcac56efbe34f7` | Verified |
| **Apps Script Bundle SHA-256** | `b97f903155ef69bb72f9fcfbb38d57050c5fbe7b02c57424a9d5605669a98b47` | Verified |
| **Apps Script Bundle Path** | `appscript.txt` (built via `npm run build:appscript`) | Synchronized |
| **Frontend Source Checkpoint** | `e6970ad6dd7d2afef0130cc9bb1de65be33f2205` | Certified Runtime |
| **Frontend Build Output** | Vite production bundle (`dist/assets/index-*.js`, `dist/assets/index-*.css`) | Clean Build |
| **Production Baseline `main` SHA** | `17712a4f7e177771ff3cf44d02d7ba570f567d21` | Untouched |
| **Production Baseline `gh-pages` SHA**| `4ec7843f992fa0e05540274085a83464470f262e` | Untouched |

---

## 2. Persistent Schema Specifications

### Target Schema Version: Phase 8 Enterprise Architecture
- Total Persistent Tables: **23 tables** (11 legacy operational tables + 12 canonical V2 enterprise tables).
- Non-Destructive Invariant: **Strictly additive**. Pre-existing sheets and columns are never dropped or modified.

### Canonical Inventory of 12 V2 Tables:
1. `RosterPeople`: `PersonId, DirectoryType, CurrentDisplayName, LegacyNamesJson, Active, CreatedAt, UpdatedAt`
2. `ShiftSemantics`: `ShiftCode, RuleVersion, DirectoryType, CountsAsWorked, ConsecutiveBehavior, StaffingBucket, PolicyBQualifier, NormalOff, CanDisplaceOffEarnGoff, ExpectedPredecessorsJson, ExpectedFollowersJson`
3. `OperationLog`: `OperationId, ClientId, TabId, OperationType, EntityKey, ExpectedRevision, ResultRevision, PayloadHash, Status, ResultJson, ErrorCode, CreatedAt, CompletedAt`
4. `RosterDraftPatches`: `OperationId, EntityKey, BaseRevision, ResultRevision, PayloadJson, ResultChecksum`
5. `OffPolicies`: `PolicyId, PolicyCode, EffectiveMonday, RuleVersion, RuleJson, Active, Reason, Revision, OperationId, CreatedAt, CreatedBy`
6. `RosterPeriods`: `PeriodId, State, Revision, DraftRevision, PlannedSnapshotId, PublishedAt, PublishedBy, ClosedAt, ClosedBy, ProjectionChecksum, SchemaVersion, LastOperationId, UpdatedAt`
7. `RosterAssignments`: `AssignmentId, PeriodId, Layer, SnapshotId, PersonId, PersonNameSnapshot, Date, DutyDomain, ShiftCode, ModifiersJson, DraftRevision, Source, OperationId, CreatedAt, CreatedBy`
8. `WeeklyOffSnapshots`: `WeekSnapshotId, WeekStart, WeekEnd, PolicyLockedByPeriodId, PublishedPeriodIdsJson, PublishedDateMask, EvaluationState, PlannedSnapshotIdsJson, PlannedWeekChecksum, PersonId, PersonNameSnapshot, PolicyId, PolicyCode, RuleVersion, HasQualifyingPlannedNight, RequiredOffCount, AssignedOffCountAtPublish, Revision, OperationId, CreatedAt, CompletedAt`
9. `RosterEvents`: `EventId, LineId, EventType, OperationId, PeriodId, BaseRevision, ResultRevision, PersonId, LinkedPersonIdsJson, Date, DutyDomain, PlannedAssignmentJson, BeforeCurrentJson, AfterCurrentJson, PublicReasonCode, AdminNote, ShortageAccepted, ShortageReason, GoffTransactionIdsJson, ReversesEventId, CreatedAt, CreatedBy`
10. `RosterAbsences`: `AbsenceId, PeriodId, PersonId, PersonNameSnapshot, AbsenceType, StartDate, EndDate, DutyDomain, PublicReason, AdminNote, Status, OperationId, CreatedAt, CreatedBy`
11. `RosterReplacements`: `ReplacementId, AbsenceId, OriginalAssignmentId, ReplacementPersonId, ReplacementAssignmentId, DutyDomain, Date, ShiftCode, Status, OperationId, CreatedAt, CreatedBy`
12. `RosterEntitlementTransactions`: `TransactionId, PeriodId, PersonId, PersonNameSnapshot, EntitlementType, DutyDomain, TransactionType, Amount, EffectiveDate, SourceType, SourceId, SourceAssignmentId, SourcePeriodId, PublicHolidayDate, PublicHolidayName, RosterAssignmentId, RelatedTransactionId, ReasonCode, AdminNote, ExpiresAt, ExpiryPolicyCode, Status, OperationId, CreatedAt, CreatedBy`

---

## 3. Required Reference Data Seeding

### A. ShiftSemantics (Rule Version 1)
- Populated via `rosterV2CatalogRows_()`.
- Exactly 19 canonical shift codes: `AM`, `PM`, `OH`, `COURT`, `ON1`, `ON2`, `ON`, `N`, `NIGHT`, `PN`, `OFF`, `GOFF`, `HKA`, `GHKA`, `AL`, `MC`, `EL`, `COURSE`, `EP_OFFICE_HOUR`, `EP_ONCALL`.

### B. OffPolicies (Rule Version 1)
- Requires at least 1 active policy row whose `EffectiveMonday` covers the cutover period's weeks.
- Canonical specification defined in `config/phase9-reference-seed.json`.

### C. Settings (Feature Flag Matrix Version 1.0.0)
- Governs 9 feature keys: `roster_workspace_v2_enabled`, `roster_v2_read_enabled`, `roster_v2_write_enabled`, `shift_semantics_v2_enabled`, `weekly_off_guidance_enabled`, `night_safety_guidance_enabled`, `goff_ledger_enabled`, `write_queue_v2_enabled`, `legacy_upload_enabled`.

---

## 4. Migration & Verification Tooling Inventory

| Tool / Script | Location | Purpose & Guarantees |
|---|---|---|
| **Baseline Generator** | `scripts/phase9-production-baseline.mjs` | Read-only analysis of workbook data; produces sheet inventories, monthly MasterRoster counts, identity metrics, and SHA-256 checksums. Zero credentials needed. |
| **Post-Step Reconciler** | `scripts/phase9-reconcile-baseline.mjs` | Compares PRE and POST manifests. Enforces `MUST_BE_IDENTICAL` preservation on legacy structures and validates `EXPECTED_CHANGE` on target structures. |
| **Identity Planner** | `scripts/phase9-identity-plan.mjs` | Dry-run migration of legacy staff into canonical `RosterPeople`. Enforces hard release blockers: `AMBIGUOUS = 0` and `MISSING_STABLE_ID = 0`. Produces review CSV. |
| **Entitlement Validator** | `scripts/phase9-entitlement-validator.mjs` | Enforces rules on opening balances: atomic +1 amount, reason `OPENING_BALANCE`, EP exclusion, approved MO person verification. |
| **Cutover Validator** | `scripts/phase9-cutover-validator.mjs` | Validates `CUTOVER_PERIOD = YYYY-MM` contract, OffPolicy week coverage, registered doctor presence, and shift semantics coverage before enrollment. |

---

## 5. Certification & Regression Baseline

| Test Suite | Total Tests | Pass Count | Status |
|---|:---:|:---:|:---:|
| **Phase 1 Regression** | 95 | 95 | PASS |
| **Phase 2 Regression** | 72 | 72 | PASS |
| **Phase 3 Regression** | 76 | 76 | PASS |
| **Phase 4 Regression** | 91 | 91 | PASS |
| **Phase 5 Regression** | 132 | 132 | PASS |
| **Phase 6 Regression** | 130 | 130 | PASS |
| **Phase 7 Regression** | 176 | 176 | PASS |
| **Phase 8 Regression** | 75 | 75 | PASS |
| **Phase 9 Rehearsal & Prep** | 24+ | 24+ | PASS |
| **Node:Test Total** | **871+** | **871+** | **100% PASS** |
| **Legacy Utility Suites** | 5 | 5 | 5/5 PASS |

---

## 6. Multi-Tier Rollback Coordinates

- **Tier 1 (Instant Settings Reversion)**: In `Settings`, set all 9 feature switches to baseline: `roster_workspace_v2_enabled = false`, `roster_v2_read_enabled = false`, `roster_v2_write_enabled = false`, `shift_semantics_v2_enabled = false`, `weekly_off_guidance_enabled = false`, `night_safety_guidance_enabled = false`, `goff_ledger_enabled = false`, `write_queue_v2_enabled = false`, `legacy_upload_enabled = true`. All V2 audit tables remain physically preserved.
- **Tier 2 (Frontend Asset Reversion)**: Revert `gh-pages` branch to commit `4ec7843f992fa0e05540274085a83464470f262e`.
- **Tier 3 (Backend Deployment Reversion)**: In Apps Script Deployments, redeploy pre-cutover version recorded during Stage A backup.
