# Major Update — Phase 9 Production Cutover Checklist & Rollback Architecture

**Document Version**: 1.1.0
**Phase**: Phase 9 Slice 1.1 — Production Cutover Preflight & Non-Production Migration Rehearsal Hardening
**Execution Context**: Strict Non-Production Rehearsal (Zero Live Mutations, Zero Deployments)
**Authoritative Baseline**:
- `main` / `origin/main`: `17712a4f7e177771ff3cf44d02d7ba570f567d21`
- Legacy Deployed Frontend (`origin/gh-pages`): `4ec7843`
- Production Backend: Legacy V1.1 Apps Script with MasterRoster month-safety hotfix.
- Phase 8 Certified Checkpoint: `dab0d8acf40c184b138d1d237a20f897d8bf277a`

---

## 1. Staged Production Cutover Checklist (Stages A–G)

Execute in strict sequential order. No out-of-order execution permitted.

### Stage A — Immutable Baseline
- [ ] **Maintenance Announcement**: Users notified of scheduled cutover window; legacy roster edits frozen.
- [ ] **Workbook Snapshot / Backup**: Production Google Sheet fully duplicated with immutable timestamped name (e.g. `REQUEST-APP_PROD_BACKUP_YYYYMMDD_HHMMSS`).
- [ ] **Baseline Row Counts Recorded**:
  - `MasterRoster` total row count recorded: `___________`
  - `MasterRoster` distinct historical months counted: `___________`
  - `Requests` total row count recorded: `___________`
  - `LeaveApplications` total row count recorded: `___________`
  - `TeamMembers` total MO staff count recorded: `___________`
  - `EmergencyPhysicians` total EP staff count recorded: `___________`
  - `ActivityHistory` total row count recorded: `___________`
- [ ] **Record Rollback References**:
  - Apps Script current deployment version: `___________`
  - Frontend `gh-pages` commit SHA recorded: `4ec7843`
  - Git `main` commit SHA recorded: `17712a4f7e177771ff3cf44d02d7ba570f567d21`
*Zero mutations allowed during Stage A.*

### Stage B — Compatible Backend Deployment
- [ ] **Deploy Apps Script Bundle**: Deploy certified Phase 8 Apps Script code (`appscript.txt`) to production Apps Script project while V2 features remain disabled.
- [ ] **Set Initial Safe Feature Flags** in `Settings`:
  - `roster_workspace_v2_enabled = false`
  - `roster_v2_read_enabled = false`
  - `roster_v2_write_enabled = false`
  - `legacy_upload_enabled = true`
- [ ] **Smoke-Test Legacy API Endpoints**:
  - `getRequests` returns valid JSON matching baseline.
  - `getLeaveApplications` returns valid JSON matching baseline.
  - Legacy roster views respond normally.
- [ ] **Verify V2 Write & Read Rejection**:
  - V2 write endpoint returns `FEATURE_DISABLED`.
  - V2 read endpoint returns `FEATURE_DISABLED`.

### Stage C — Additive Provisioning & Reference Data Seeding
- [ ] **Run Schema Provisioning**: Execute `rosterProvisionAllSchemas_()` via Apps Script editor.
- [ ] **Verify Provisioned Sheets**: Verify all 12 V2 sheets exist with canonical header rows:
  - `RosterPeople` (7 columns)
  - `ShiftSemantics` (11 columns)
  - `OperationLog` (13 columns)
  - `RosterDraftPatches` (6 columns)
  - `OffPolicies` (11 columns)
  - `RosterPeriods` (13 columns)
  - `RosterAssignments` (15 columns)
  - `WeeklyOffSnapshots` (20 columns)
  - `RosterEvents` (21 columns)
  - `RosterAbsences` (13 columns)
  - `RosterReplacements` (11 columns)
  - `RosterEntitlementTransactions` (24 columns)
- [ ] **Verify Pre-Existing Sheet Preservation**:
  - Confirm `MasterRoster`, `Requests`, `LeaveApplications`, `TeamMembers`, `EmergencyPhysicians` row counts match baseline exactly.
- [ ] **Test Idempotency**: Run `rosterProvisionAllSchemas_()` a second time; verify zero diff.
- [ ] **Seed Mandatory Reference Data**:
  - **Seed `ShiftSemantics`**: Populate catalog shift rules via `rosterV2CatalogRows_()`.
  - **Seed `OffPolicies`**: Insert active weekly-off Policy A (`aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`, `A`, `2026-10-26`, `1`, `guidance.policyRuleJson('A')`, `true`, ...).
  - **Seed `Settings`**: Verify default keys initialized.

### Stage D — Identity Registry & Reconciliation Report
- [ ] **Run Dry-Run Identity Utility**: Execute `planIdentityMigration` on `TeamMembers` and `EmergencyPhysicians`.
- [ ] **Verify Zero Ambiguities**: Check reconciliation report:
  - `AMBIGUOUS`: must be `0`
  - `MISSING_STABLE_ID`: must be `0`
  - `canProceed`: must be `true`
- [ ] **Populate `RosterPeople`**: Populate rows with deterministic RFC 4122 UUIDv4 `PersonId`s derived from immutable source keys (`MO:staffId:...` or `MO:email:...`).
- [ ] **Verify Inactive Staff Handling**: Former staff marked with `Active: false`.
- [ ] **Verify EP Isolation**: EP doctors assigned `DirectoryType: 'EP'`.

### Stage E — Hidden V2 Initialization
- [ ] **Configure Temporary Initialization Flag State**:
  - `roster_workspace_v2_enabled: false` (workspace remains hidden from all users)
  - `roster_v2_write_enabled: true` (permits backend enrollment/publish/credit)
  - `roster_v2_read_enabled: true` (permits verification readback)
  - `legacy_upload_enabled: true` (legacy upload remains permitted until cutover)
  - `goff_ledger_enabled: true`
  - `weekly_off_guidance_enabled: true`
- [ ] **Enroll Target Cutover Period**: Insert row in `RosterPeriods` for cutover month (e.g. `2026-11`) with `State: 'DRAFT'`.
- [ ] **Load DRAFT Duty Assignments**: Populate draft duty cells.
- [ ] **Execute Baseline Publish**: Call `rosterv2publish` with expected revision 0:
  - Verify `State: 'PUBLISHED'` (Revision 1).
  - Verify physical `RosterAssignments` contains **ONLY** `Layer: 'PLANNED'` rows (zero `CURRENT` physical rows).
  - Verify derived Current output via `rosterv2current` matches Planned.
  - Verify `MasterRoster` projection updated for cutover month only.
  - Verify historical months in `MasterRoster` remain completely untouched.
- [ ] **Import Verified Opening Balances**: Admin imports reviewed opening credit transactions via `rosterv2entitlementcreditmanual` with `reasonCode: 'OPENING_BALANCE'`.
- [ ] **Verify Entitlement Readback**: Verify `rosterv2entitlementbalances` returns expected opening balances.

### Stage F — Frontend Compatibility Deployment
- [ ] **Deploy Frontend Release**: Push certified build bundle to `gh-pages` while `roster_workspace_v2_enabled = false`.
- [ ] **Verify Safe Legacy Experience**:
  - Open live application.
  - Verify `RosterPage` renders legacy calendar and table views.
  - Verify zero V2 workspace controls (`LifecycleControls`, `Phase5RosterContainer`) are visible.

### Stage G — Activation
- [ ] **Enable Queue Switch**: Set `write_queue_v2_enabled = true`.
- [ ] **Disable Legacy Upload**: Set `legacy_upload_enabled = false` (legacy upload no longer authoritative).
- [ ] **Activate Unified Workspace**: Set `roster_workspace_v2_enabled = true` as the final cutover switch.
- [ ] **Complete Post-Cutover Verification**:
  - Verify desktop and mobile V2 workspace rendering.
  - Verify fast entry, keyboard shortcuts, and draft queue.
  - Verify operational absence and replacement creation.
  - Verify audit logging in `OperationLog` and `RosterEvents`.

---

## 2. Multi-Tier Rollback Architecture

### Tier 1 — Instant Feature Flag Rollback (Immediate Runtime Protection)
- **Execution Time**: < 1 minute (via Google Sheets `Settings` sheet).
- **Trigger**: Any operational anomaly, workflow confusion, or user-reported issue during cutover.
- **Action**:
  In `Settings` sheet, set:
  - `roster_workspace_v2_enabled = false`
  - `roster_v2_write_enabled = false`
  - `roster_v2_read_enabled = false`
  - `legacy_upload_enabled = true`
- **Result**:
  - Frontend instantly hides V2 workspace and shows legacy calendar/table views.
  - All V2 write mutations fail closed (`FEATURE_DISABLED`).
  - Legacy endpoints continue functioning normally.
  - Audit logs (`OperationLog`, `RosterEvents`, `RosterAssignments`, `RosterEntitlementTransactions`) remain completely preserved.

### Tier 2 — Frontend Asset Rollback (Client-Side Regression)
- **Execution Time**: ~5 minutes.
- **Trigger**: Client-side JavaScript bundle error, stylesheet breakage, or browser crash.
- **Action**:
  1. Revert `gh-pages` branch to pre-cutover commit `4ec7843`.
  2. Invalidate CDN cache.

### Tier 3 — Backend Deployment Rollback (Backend Logic Regression)
- **Execution Time**: ~5 minutes.
- **Trigger**: Apps Script runtime failure or quota exhaustion.
- **Action**:
  1. Open Apps Script project deployment management.
  2. Revert deployment version to pre-cutover version recorded in Stage A.
