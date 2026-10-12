# Major Update — Phase 9 Production Cutover Operator Runbook

**Document Version**: 2.0.0  
**Phase**: Phase 9 Slice 2 — Production Preparation Package & Cutover Operator Runbook  
**Target Environment**: Production Google Sheets & Google Apps Script Infrastructure  
**Authoritative Baseline**:
- `main` / `origin/main`: `17712a4f7e177771ff3cf44d02d7ba570f567d21`
- Deployed Frontend (`origin/gh-pages`): `4ec7843f992fa0e05540274085a83464470f262e`
- Certified Release Branch: `feature/phase-9-cutover`
- Backend Bundle SHA-256: `b97f903155ef69bb72f9fcfbb38d57050c5fbe7b02c57424a9d5605669a98b47`

---

## 1. Executive Protocol & Operating Rules

1. **Strict Gate Discipline**: Cutover is divided into 11 execution stages (Stages A through K) punctuated by 9 formal Human Approval Gates (GATES 0 through 8). An operator **must never** proceed across a gate without satisfying and recording the explicit evidence required.
2. **Measurable Verification Only**: Every step requires concrete, measurable validation (CLI command, HTTP response code, checksum match, or exact row count). Subjective checks like "verify data looks good" are prohibited.
3. **Hard Blocker Enforcement**: If any validation check fails or a STOP condition is triggered, execution halts immediately. Execute the designated rollback procedure.
4. **Preservation Invariance**: All historical `MasterRoster` months, pending `Requests`, and historical `LeaveApplications` must survive byte-for-byte and row-for-row.

---

## 2. Feature-Flag Transition Matrix

The table below governs the exact state of all 9 system feature switches in the `Settings` Google Sheet across every stage of the migration:

| Stage | `roster_workspace_v2_enabled` | `roster_v2_read_enabled` | `roster_v2_write_enabled` | `shift_semantics_v2_enabled` | `weekly_off_guidance_enabled` | `night_safety_guidance_enabled` | `goff_ledger_enabled` | `write_queue_v2_enabled` | `legacy_upload_enabled` | State Rationale |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|---|
| **Legacy Production** | `false` / unset | `false` / unset | `false` / unset | `false` / unset | `false` / unset | `false` / unset | `false` / unset | `false` / unset | `true` / unset | Baseline legacy operation |
| **Stage B: Backend Deployed** | `false` | `false` | `false` | `false` | `false` | `false` | `false` | `false` | `true` | New bundle deployed; all V2 endpoints guarded; legacy routes active |
| **Stage E: Hidden V2 Init** | `false` | `true` | `true` | `true` | `true` | `true` | `true` | `false` | `true` | Admin initializes cutover period; V2 workspace remains hidden from all users |
| **Stage H: Frontend Deployed** | `false` | `true` | `true` | `true` | `true` | `true` | `true` | `false` | `true` | New client code live; workspace gate `false` renders certified legacy UI |
| **Stage I: V2 Activated** | `true` | `true` | `true` | `true` | `true` | `true` | `true` | `true` | `false` | Full Phase 4–8 unified workspace live; legacy upload disabled |
| **Tier 1 Rollback** | `false` | `false` | `false` | `false` | `false` | `false` | `false` | `false` | `true` | Instant runtime fallback; legacy UI restored; audit structures preserved |

---

## 3. Human Approval Gates Inventory

| Gate | Title | Pre-Requisite Stage | Evidence Required for Sign-Off | Sign-Off Authority |
|---|---|---|---|---|
| **GATE 0** | Production Freeze Approved | Pre-Cutover | Maintenance window announced to hospital clinical leads; emergency schedule frozen; on-duty admin operator assigned. | Clinical Lead & Lead Engineer |
| **GATE 1** | Backup & Baseline Approved | Stage A | Complete Sheet copy ID confirmed; baseline manifest generated via `scripts/phase9-production-baseline.mjs`; checksums recorded; git SHAs logged. | Systems Operator |
| **GATE 2** | Backend Legacy-Compatibility Approved | Stage B | New Apps Script deployment live; `getRequests`, `getLeaveApplications`, and legacy roster GET return identical JSON to baseline; V2 write endpoints return `FEATURE_DISABLED`. | Systems Operator |
| **GATE 3** | Schema & Reference Reconciliation Approved | Stage C & D | `scripts/phase9-reconcile-baseline.mjs` returns `PASS` for `STAGE_C_SCHEMA`; 12 V2 tables created; `ShiftSemantics` contains 19 catalog rows; `OffPolicies` contains verified hospital policy. | Database Admin / Operator |
| **GATE 4** | Identity Reconciliation Approved | Stage E | `scripts/phase9-identity-plan.mjs` validation produces `AMBIGUOUS = 0` and `MISSING_STABLE_ID = 0`; all doctors have deterministic `PersonId`s; review CSV approved by HOD/Admin. | Head of Department / HR Admin |
| **GATE 5** | Hidden V2 Baseline Approved | Stage F & G | Target period enrolled and published; Planned snapshot created; Current derived; historical MasterRoster months byte-for-byte identical; opening credits verified. | Lead Engineer |
| **GATE 6** | Frontend Legacy-Compatible Mode Approved | Stage H | New frontend bundle live on `gh-pages`; browser smoke test verifies legacy calendar/table views render with zero V2 controls when `roster_workspace_v2_enabled = false`. | QA / Test Operator |
| **GATE 7** | Final V2 Activation Approved | Stage I | Readiness check clean; `roster_workspace_v2_enabled` set to `true`; `write_queue_v2_enabled` set to `true`; `legacy_upload_enabled` set to `false`. | Clinical Director & Engineering Lead |
| **GATE 8** | Post-Cutover Sign-Off | Stage J | Post-cutover certification checklist complete; draft, amendment, and absence workflows operational; zero production errors; cutover window closed. | Clinical Director & Systems Operator |

---

## 4. Staged Execution Checklist

### Stage A — Freeze & Backup
*Objective: Create immutable recovery snapshot of production data and software state before any mutation.*

- [ ] **Step A.1: Declare Cutover Freeze**
  - **Action**: Post freeze announcement in departmental communication channel; restrict edit permissions on production spreadsheet to cutover admin account.
  - **Expected Result**: No external edits occur during the cutover window.
  - **Validation**: Inspect Google Drive revision history; confirm zero concurrent user edits.
  - **STOP Condition**: Concurrent user edits detected.
  - **Rollback Action**: Re-issue warning; wait until active sessions cease.
  - **Reversibility**: Reversible (unfreeze permissions).
- [ ] **Step A.2: Create Full Google Sheets Backup Copy**
  - **Action**: In Google Drive, create a full copy of the production spreadsheet named `PROD_BACKUP_YYYYMMDD_HHMMSS`. Record the new file ID.
  - **Expected Result**: Exact standalone copy created in Google Drive.
  - **Validation**: Check Google Drive API/UI; confirm backup file size and row counts match production.
  - **STOP Condition**: Copy creation fails or produces truncated file.
  - **Rollback Action**: Delete partial copy and re-try.
  - **Reversibility**: Non-destructive.
- [ ] **Step A.3: Generate Pre-Cutover Baseline Manifest**
  - **Action**: Export workbook snapshot JSON and execute:
    ```bash
    node scripts/phase9-production-baseline.mjs snapshot-pre.json baseline-pre.json
    ```
  - **Expected Result**: Manifest `baseline-pre.json` generated containing sheet inventory, monthly MasterRoster counts, identity metrics, and SHA-256 checksums.
  - **Validation**: Inspect `baseline-pre.json`:
    - Confirm `checksums.MasterRoster` is non-empty.
    - Confirm all historical months have individual SHA-256 hashes.
    - Confirm `Requests` and `LeaveApplications` data row counts match Google Sheets.
  - **STOP Condition**: Script throws or generates empty checksums.
  - **Rollback Action**: Re-export snapshot and re-run.
  - **Reversibility**: Read-only / Non-destructive.
- [ ] **Step A.4: Record Baseline Software References**
  - **Action**: Record the following baseline identifiers:
    - Current Production `main` Git SHA: `17712a4f7e177771ff3cf44d02d7ba570f567d21`
    - Current Production `gh-pages` Git SHA: `4ec7843f992fa0e05540274085a83464470f262e`
    - Current Production Apps Script Deployment Version ID
  - **Expected Result**: All rollback coordinates documented in deployment log.
  - **Validation**: `git rev-parse HEAD` on relevant branches matches exact hashes.
  - **STOP Condition**: Uncommitted or unknown local commits on deployment runner.
  - **Rollback Action**: Abort cutover until clean baseline established.
  - **Reversibility**: Read-only.

> **GATE 1 APPROVAL REQUIRED BEFORE PROCEEDING TO STAGE B**

---

### Stage B — Deploy Compatible Backend
*Objective: Deploy Phase 8 Apps Script backend bundle while keeping all V2 features disabled.*

- [ ] **Step B.1: Verify Local Apps Script Deployment Bundle**
  - **Action**: Run bundle verification command:
    ```bash
    npm run build:appscript
    node scripts/build-appscript.mjs --check
    ```
  - **Expected Result**: Check passes with exit code 0.
  - **Validation**: Compute SHA-256 of `appscript.txt`; confirm it matches certified hash `b97f903155ef69bb72f9fcfbb38d57050c5fbe7b02c57424a9d5605669a98b47`.
  - **STOP Condition**: Hash mismatch or `--check` failure.
  - **Rollback Action**: Re-run build script from clean git checkout.
  - **Reversibility**: Non-destructive.
- [ ] **Step B.2: Deploy Bundle to Apps Script Production Project**
  - **Action**: In Google Apps Script production project, update code files with `appscript.txt` contents (or clasp push) and deploy as a new version.
  - **Expected Result**: New Apps Script deployment version active.
  - **Validation**: Query `?action=version` or health endpoint; confirm response reflects new version.
  - **STOP Condition**: Deployment fails with syntax or quota error.
  - **Rollback Action**: (Tier 3) Revert Apps Script deployment version to pre-cutover version recorded in Step A.4.
  - **Reversibility**: Reversible.
- [ ] **Step B.3: Set Initial Safe Flags in Settings**
  - **Action**: In production `Settings` sheet, ensure the following keys are set:
    - `roster_workspace_v2_enabled`: `false`
    - `roster_v2_read_enabled`: `false`
    - `roster_v2_write_enabled`: `false`
    - `shift_semantics_v2_enabled`: `false`
    - `weekly_off_guidance_enabled`: `false`
    - `night_safety_guidance_enabled`: `false`
    - `goff_ledger_enabled`: `false`
    - `write_queue_v2_enabled`: `false`
    - `legacy_upload_enabled`: `true`
  - **Expected Result**: Flags written in `Settings`.
  - **Validation**: Re-read `Settings` sheet; confirm exact key/value pairs.
  - **STOP Condition**: Cannot write to `Settings` sheet.
  - **Rollback Action**: Revert Apps Script deployment.
  - **Reversibility**: Reversible.
- [ ] **Step B.4: Smoke-Test Legacy API Endpoints**
  - **Action**: Execute GET requests against production web app:
    - `?action=getRequests`
    - `?action=getLeaveApplications`
    - `?action=getTeamMembers`
    - `?action=rosterv2current` (expected: error `V2 read endpoints are currently disabled.`)
    - `POST` to `rosterv2publish` (expected: error `V2 write operations are currently disabled.`)
  - **Expected Result**: Legacy endpoints return 200 with data matching baseline; V2 endpoints fail closed with feature disabled errors.
  - **Validation**: Compare row counts returned by `getRequests` with `baseline-pre.json`; confirm exact match.
  - **STOP Condition**: Legacy endpoint returns 500 error or V2 write endpoint executes.
  - **Rollback Action**: (Tier 3) Revert Apps Script deployment version.
  - **Reversibility**: Non-destructive.

> **GATE 2 APPROVAL REQUIRED BEFORE PROCEEDING TO STAGE C**

---

### Stage C — Provision Additive Schemas
*Objective: Create the 12 canonical V2 Google Sheets tables without modifying existing legacy sheets.*

- [ ] **Step C.1: Execute Schema Provisioning**
  - **Action**: In Apps Script editor or admin endpoint, execute `rosterProvisionAllSchemas_()`.
  - **Expected Result**: All 12 V2 tables created if not existing; missing columns appended to existing headers; zero rows deleted or truncated.
  - **Validation**: Inspect spreadsheet tab bar; confirm presence of all 12 tables: `RosterPeople`, `ShiftSemantics`, `OperationLog`, `RosterDraftPatches`, `OffPolicies`, `RosterPeriods`, `RosterAssignments`, `WeeklyOffSnapshots`, `RosterEvents`, `RosterAbsences`, `RosterReplacements`, `RosterEntitlementTransactions`.
  - **STOP Condition**: Script throws runtime exception or attempts to drop a legacy sheet.
  - **Rollback Action**: (Tier 1) Disable flags in Settings; restore Sheet from backup if any legacy sheet was altered.
  - **Reversibility**: Additive / Non-destructive.
- [ ] **Step C.2: Reconcile Schema Provisioning Non-Destructive Invariant**
  - **Action**: Export workbook snapshot JSON and execute:
    ```bash
    node scripts/phase9-production-baseline.mjs snapshot-post-prov.json baseline-post-prov.json
    node scripts/phase9-reconcile-baseline.mjs baseline-pre.json baseline-post-prov.json STAGE_C_SCHEMA
    ```
  - **Expected Result**: Reconciliation tool outputs `status: 'PASS'`, `UNEXPECTED_CHANGE: []`, `errors: []`.
  - **Validation**:
    - `Requests` checksum identical.
    - `LeaveApplications` checksum identical.
    - Historical `MasterRoster` months checksums 100% identical.
  - **STOP Condition**: Reconciliation tool reports `UNEXPECTED_CHANGE` or `status: 'BLOCKER'`.
  - **Rollback Action**: Restore production spreadsheet from `PROD_BACKUP_YYYYMMDD_HHMMSS`.
  - **Reversibility**: Non-destructive.
- [ ] **Step C.3: Verify Provisioning Idempotency**
  - **Action**: Execute `rosterProvisionAllSchemas_()` a second time.
  - **Expected Result**: Zero additional columns added; zero sheet errors; idempotent completion.
  - **Validation**: Run `node scripts/phase9-reconcile-baseline.mjs baseline-post-prov.json baseline-post-prov2.json STAGE_C_SCHEMA`; confirm zero diff.
  - **STOP Condition**: New columns or duplicate sheets created.
  - **Rollback Action**: Restore from backup.
  - **Reversibility**: Non-destructive.

---

### Stage D — Seed Reference Data
*Objective: Seed canonical ShiftSemantics catalog and confirmed OffPolicies into V2 tables.*

- [ ] **Step D.1: Seed ShiftSemantics Catalog**
  - **Action**: In Apps Script, execute catalog row population (`rosterV2CatalogRows_()`).
  - **Expected Result**: `ShiftSemantics` populated with exactly 19 canonical shift code rows (AM, PM, OH, COURT, ON1, ON2, ON, N, NIGHT, PN, OFF, GOFF, HKA, GHKA, AL, MC, EL, COURSE, EP_OFFICE_HOUR, EP_ONCALL).
  - **Validation**: Query `ShiftSemantics` sheet; confirm row count = 20 (1 header + 19 data rows). Confirm `AM` has `CountsAsWorked: true`, `OFF` has `NormalOff: true`.
  - **STOP Condition**: Row count != 20 or shift codes missing.
  - **Rollback Action**: Clear `ShiftSemantics` data rows (leaving header) and re-seed from `config/phase9-reference-seed.json`.
  - **Reversibility**: Reversible.
- [ ] **Step D.2: Seed Confirmed Production OffPolicy (DO NOT USE TEST FIXTURE)**
  - **Action**: Insert confirmed hospital weekly-off policy row into `OffPolicies` sheet (matching `productionRequiredInput` specification, NOT the test fixture).
    - `PolicyId`: RFC 4122 UUIDv4
    - `PolicyCode`: Confirmed hospital code (e.g. `A`)
    - `EffectiveMonday`: Confirmed Monday date covering the cutover period (e.g. `2026-10-26`)
    - `RuleVersion`: `1`
    - `RuleJson`: Confirmed hospital rule definition JSON (e.g. `minOffPerWeek`, `maxNightPerWeek`)
    - `Active`: `TRUE`
  - **Expected Result**: Exactly 1 active approved production policy row in `OffPolicies`.
  - **Validation**: Confirm `EffectiveMonday <= first Monday of cutover period`. Confirm `Active = TRUE`. Confirm policy is NOT marked `exampleOnly: true`.
  - **STOP Condition**: Missing policy, ineffective date range, or attempt to seed test fixture without hospital approval.
  - **Rollback Action**: Correct row in `OffPolicies`.
  - **Reversibility**: Reversible.

> **GATE 3 APPROVAL REQUIRED BEFORE PROCEEDING TO STAGE E**

---

### Stage E — Seed Identity Registry
*Objective: Transition legacy TeamMembers and EmergencyPhysicians into canonical RosterPeople entries.*

- [ ] **Step E.1: Generate Dry-Run Identity Plan**
  - **Action**: Run identity migration dry-run script against current snapshot:
    ```bash
    node scripts/phase9-identity-plan.mjs snapshot-post-prov.json manual-mappings.json identity-review.csv identity-plan.json
    ```
  - **Expected Result**: Plan generates complete classification across all records.
  - **Validation**: Check summary output:
    - Confirm `AMBIGUOUS = 0`.
    - Confirm `MISSING_STABLE_ID = 0`.
    - Confirm `Release Ready: YES`.
  - **STOP Condition**: `AMBIGUOUS > 0` or `MISSING_STABLE_ID > 0`.
  - **Rollback Action**: Do NOT write `RosterPeople`. Provide explicit approved manual mappings in `manual-mappings.json` with HOD sign-off, then re-run.
  - **Reversibility**: Non-destructive / Read-only.
- [ ] **Step E.2: HOD Review & Sign-Off of Identity Review CSV**
  - **Action**: Clinical Director / HR Admin inspects `identity-review.csv` and approves proposed `PersonId`s and directory assignments.
  - **Expected Result**: Formal approval recorded for Gate 4.
  - **Validation**: Signed approval form referencing `identity-review.csv` checksum.
  - **STOP Condition**: Disputed doctor identity or unverified alias.
  - **Rollback Action**: Halt cutover until HR clarifies doctor record.
  - **Reversibility**: Non-destructive.
- [ ] **Step E.3: Populate RosterPeople Table**
  - **Action**: In Apps Script, write approved identity plan rows into `RosterPeople` sheet:
    - Columns: `PersonId, DirectoryType, CurrentDisplayName, LegacyNamesJson, Active, CreatedAt, UpdatedAt`.
  - **Expected Result**: `RosterPeople` populated with canonical identities.
  - **Validation**: Count data rows in `RosterPeople`; confirm it matches total approved entries from `identity-plan.json`.
  - **STOP Condition**: Row count mismatch or duplicate `PersonId` detected.
  - **Rollback Action**: Clear `RosterPeople` data rows (leaving header); re-apply.
  - **Reversibility**: Reversible.

> **GATE 4 APPROVAL REQUIRED BEFORE PROCEEDING TO STAGE F**

---

### Stage F — Hidden V2 Initialization
*Objective: Enroll and publish cutover month baseline in V2 while UI remains hidden from users.*

- [ ] **Step F.1: Enable Temporary Initialization Flag State**
  - **Action**: In `Settings` sheet, set:
    - `roster_workspace_v2_enabled`: `false` (CRITICAL: workspace remains hidden from users)
    - `roster_v2_write_enabled`: `true` (enables backend enrollment & publish)
    - `roster_v2_read_enabled`: `true` (enables backend readback)
    - `shift_semantics_v2_enabled`: `true`
    - `legacy_upload_enabled`: `true`
  - **Expected Result**: Backend V2 endpoints accept admin operations; frontend still renders legacy UI.
  - **Validation**: Verify `Settings` values. Confirm frontend in incognito browser still renders legacy calendar.
  - **STOP Condition**: Frontend renders V2 workspace while `roster_workspace_v2_enabled = false`.
  - **Rollback Action**: Set `roster_v2_write_enabled: false`, `roster_v2_read_enabled: false`.
  - **Reversibility**: Reversible.
- [ ] **Step F.2: Validate Cutover Period Contract**
  - **Action**: Run cutover period validator:
    ```bash
    node -e "import('./scripts/phase9-cutover-validator.mjs').then(m => console.log(m.validateCutoverPeriod({ periodId: 'CUTOVER_MONTH', enrolledPeriods: [], offPolicies: [...], rosterPeople: [...], shiftSemantics: [...] })))"
    ```
  - **Expected Result**: Validation returns `isValid: true`, `errors: []`.
  - **Validation**: All checks pass.
  - **STOP Condition**: Validation fails (e.g. missing policy coverage or unregistered doctor).
  - **Rollback Action**: Resolve prerequisite before enrollment.
  - **Reversibility**: Non-destructive.
- [ ] **Step F.3: Enroll Cutover Period**
  - **Action**: Issue admin `POST` to `rosterv2enroll` with `{ periodId: 'YYYY-MM' }`.
  - **Expected Result**: Row added to `RosterPeriods` with `State: 'DRAFT'`, `Revision: 0`.
  - **Validation**: Query `?action=rosterv2periodlifecycle&periodId=YYYY-MM`; confirm `state: 'DRAFT'`.
  - **STOP Condition**: Enrollment fails or period already exists in `PUBLISHED` state.
  - **Rollback Action**: Delete draft row in `RosterPeriods`.
  - **Reversibility**: Reversible.
- [ ] **Step F.4: Load DRAFT Duty Cells**
  - **Action**: Load approved schedule cells for cutover month via draft queue protocol.
  - **Expected Result**: Draft cells stored in memory / draft table.
  - **Validation**: Query `?action=rosterv2draft&periodId=YYYY-MM`; confirm cell count matches schedule.
  - **STOP Condition**: Unrecognized shift code or unknown `PersonId`.
  - **Rollback Action**: Correct draft cell input.
  - **Reversibility**: Reversible.
- [ ] **Step F.5: Publish Cutover Period Baseline**
  - **Action**: Issue admin `POST` to `rosterv2publish` with `{ periodId: 'YYYY-MM', expectedRevision: 0, adminNote: 'Phase 9 cutover publish' }`.
  - **Expected Result**:
    - `RosterPeriods` transitions to `State: 'PUBLISHED'`.
    - `RosterAssignments` receives Planned rows (`Layer: 'PLANNED'`).
    - `WeeklyOffSnapshots` populated.
    - `MasterRoster` target month projection updated.
  - **Validation**:
    - Query `?action=rosterv2planned&periodId=YYYY-MM`; confirm planned snapshot returned.
    - Query `?action=rosterv2current&periodId=YYYY-MM`; confirm resolved current matches planned.
    - Inspect `RosterAssignments` sheet; confirm **zero rows** with `Layer: 'CURRENT'` were written.
  - **STOP Condition**: Publish halts in `RECOVERY_REQUIRED` or throws `INVALID_OFF_POLICY`.
  - **Rollback Action**: Inspect `OperationLog` for error code; if unrecoverable, restore sheet from backup.
  - **Reversibility**: Non-destructive.
- [ ] **Step F.6: Reconcile Historical MasterRoster Preservation**
  - **Action**: Export snapshot and run:
    ```bash
    node scripts/phase9-reconcile-baseline.mjs baseline-pre.json baseline-post-pub.json STAGE_E_PUBLISH YYYY-MM
    ```
  - **Expected Result**: `status: 'PASS'`, all non-target MasterRoster months match baseline byte-for-byte.
  - **Validation**: Only `MasterRoster:YYYY-MM` appears under `EXPECTED_CHANGE`; historical months under `MUST_BE_IDENTICAL`.
  - **STOP Condition**: Any historical month reported under `UNEXPECTED_CHANGE`.
  - **Rollback Action**: Restore from backup immediately.
  - **Reversibility**: Non-destructive.

---

### Stage G — Opening Entitlement Balances
*Objective: Import verified opening GOFF/GHKA balances into V2 entitlement ledger.*

- [ ] **Step G.1: Validate Opening Entitlement CSV**
  - **Action**: Run entitlement validator on approved opening balances:
    ```bash
    node -e "import('./scripts/phase9-entitlement-validator.mjs').then(m => console.log(m.validateOpeningEntitlementRows(m.parseCsvRows(fs.readFileSync('opening-balances.csv', 'utf8')), { approvedMoPersonIds: new Set(...) })))"
    ```
  - **Expected Result**: `isValid: true`, `errors: []`.
  - **Validation**: All rows have `Approved: true`, `ReasonCode: 'OPENING_BALANCE'`, `Amount: 1`, valid MO `PersonId`.
  - **STOP Condition**: Any invalid row or unapproved credit.
  - **Rollback Action**: Correct CSV with clinical director sign-off before importing.
  - **Reversibility**: Non-destructive / Read-only.
- [ ] **Step G.2: Import Opening Credits via Manual Credit Endpoint**
  - **Action**: For each valid opening balance row, submit admin `POST` to `rosterv2entitlementcreditmanual`:
    - `personId`: canonical MO UUID
    - `entitlementType`: `GOFF` or `GHKA`
    - `amount`: `1`
    - `effectiveDate`: first day of cutover period
    - `reasonCode`: `OPENING_BALANCE`
    - `adminNote`: HOD sign-off reference
  - **Expected Result**: Transaction rows written to `RosterEntitlementTransactions`.
  - **Validation**: Query `?action=rosterv2entitlementbalances&periodId=YYYY-MM`; confirm balances match imported amounts.
  - **STOP Condition**: Transaction rejected or balance mismatch.
  - **Rollback Action**: Reverse transaction or delete imported transaction rows.
  - **Reversibility**: Reversible.

> **GATE 5 APPROVAL REQUIRED BEFORE PROCEEDING TO STAGE H**

---

### Stage H — Deploy Compatible Frontend
*Objective: Deploy certified frontend release bundle to production gh-pages while workspace flag remains disabled.*

- [ ] **Step H.1: Build and Verify Frontend Production Bundle**
  - **Action**: Run clean build verification:
    ```bash
    npm run build
    git checkout -- dist/index.html
    git diff --check
    ```
  - **Expected Result**: Build completes cleanly; 0 git diff.
  - **Validation**: Inspect `dist/`; confirm build artifacts generated.
  - **STOP Condition**: Build failure or lint error.
  - **Rollback Action**: Fix build issues on feature branch before deploy.
  - **Reversibility**: Non-destructive.
- [ ] **Step H.2: Deploy Frontend to Production `gh-pages`**
  - **Action**: Deploy to GitHub Pages (or run deployment script from certified commit):
    - Record deployed commit SHA: matches certified Phase 9 commit.
  - **Expected Result**: Deployed site updated on GitHub Pages.
  - **Validation**: Load production web application URL; inspect version/build hash in console.
  - **STOP Condition**: Deployed bundle fails to load or shows blank white screen.
  - **Rollback Action**: (Tier 2) Revert `gh-pages` branch to baseline commit `4ec7843f992fa0e05540274085a83464470f262e`.
  - **Reversibility**: Reversible.
- [ ] **Step H.3: Verify Legacy User Experience with Workspace Flag Disabled**
  - **Action**: Navigate to Roster page in production application.
  - **Expected Result**:
    - Legacy calendar and table views render normally.
    - Zero V2 mutation controls or Phase 4–8 workspace panels are displayed.
    - `getRequests` and `getLeaveApplications` continue working.
  - **Validation**: Confirm UI matches legacy production behavior exactly.
  - **STOP Condition**: V2 workspace elements visible to legacy users.
  - **Rollback Action**: Verify `roster_workspace_v2_enabled` is `false` in `Settings`. If still visible, execute Tier 2 frontend rollback.
  - **Reversibility**: Reversible.

> **GATE 6 APPROVAL REQUIRED BEFORE PROCEEDING TO STAGE I**

---

### Stage I — Activate V2
*Objective: Transition production feature flags to full V2 operational state.*

> **GATE 7 FORMAL SIGN-OFF REQUIRED IMMEDIATELY BEFORE STEP I.1**

- [ ] **Step I.1: Enable Client Write Queue**
  - **Action**: In `Settings` sheet, set `write_queue_v2_enabled = 'true'`.
  - **Expected Result**: Enables optimistic draft mutations for authenticated admins.
  - **Validation**: Re-read `Settings`.
  - **STOP Condition**: Cannot update `Settings`.
  - **Rollback Action**: Revert flag.
  - **Reversibility**: Reversible.
- [ ] **Step I.2: Disable Legacy Spreadsheet Upload**
  - **Action**: In `Settings` sheet, set `legacy_upload_enabled = 'false'`.
  - **Expected Result**: Legacy full-spreadsheet upload to `MasterRoster` is blocked (`LEGACY_UPLOAD_DISABLED`).
  - **Validation**: Attempt dummy legacy upload; confirm it fails closed with expected guard message.
  - **STOP Condition**: Legacy upload remains permitted when flag is false.
  - **Rollback Action**: Revert flag to `true`.
  - **Reversibility**: Reversible.
- [ ] **Step I.3: Activate Unified Roster Workspace**
  - **Action**: In `Settings` sheet, set `roster_workspace_v2_enabled = 'true'`.
  - **Expected Result**: Unified Phase 4–8 enterprise roster workspace renders for all users on RosterPage.
  - **Validation**: Hard refresh production web application; confirm RosterPage renders unified workspace, shift palette, and amendment controls.
  - **STOP Condition**: UI crashes or console shows unhandled exception.
  - **Rollback Action**: (Tier 1) Instantly set `roster_workspace_v2_enabled = 'false'`.
  - **Reversibility**: Reversible (< 30 seconds).

---

### Stage J — Post-Cutover Certification
*Objective: Verify operational stability and certify successful cutover before closing migration window.*

- [ ] **Step J.1: Certify Desktop & Mobile Roster Workspace Views**
  - **Action**: Test roster navigation across multiple viewports (Desktop 1440px, Tablet 768px, Mobile 375px).
  - **Expected Result**: All views render with high visual polish, zero horizontal overflow, and responsive tables.
  - **Validation**: Visual inspection across devices.
- [ ] **Step J.2: Certify Fast-Entry & Amendment Operations**
  - **Action**: Execute an authorized test shift change on the cutover period; confirm audit log entry created.
  - **Expected Result**: `RosterEvents` records amendment; `MasterRoster` target month projection reflects update.
  - **Validation**: Query `?action=rosterv2amendmenthistory&periodId=YYYY-MM`; confirm event recorded.
- [ ] **Step J.3: Certify Entitlement Ledger & Balances**
  - **Action**: Check entitlement balance display for doctors with opening balances.
  - **Expected Result**: Opening credits display correctly in UI.
- [ ] **Step J.4: Final Post-Cutover Baseline Reconciliation**
  - **Action**: Run final reconciliation check:
    ```bash
    node scripts/phase9-reconcile-baseline.mjs baseline-pre.json baseline-final.json POST_CUTOVER YYYY-MM
    ```
  - **Expected Result**: `status: 'PASS'`. All historical data intact.

> **GATE 8 APPROVAL: MIGRATION WINDOW FORMALLY CLOSED**

---

### Stage K — Rollback Procedures (If Required)

#### Tier 1 — Instant Feature Flag Rollback (Runtime Isolation)
- **Execution Time**: < 1 minute.
- **Trigger**: Any operational anomaly, user confusion, or non-critical frontend issue.
- **Action**: In `Settings` Google Sheet, update all 9 feature switches to the safest baseline state:
  ```
  roster_workspace_v2_enabled    = false
  roster_v2_read_enabled         = false
  roster_v2_write_enabled        = false
  shift_semantics_v2_enabled     = false
  weekly_off_guidance_enabled    = false
  night_safety_guidance_enabled  = false
  goff_ledger_enabled            = false
  write_queue_v2_enabled         = false
  legacy_upload_enabled          = true
  ```
- **Result**:
  - Web application instantly hides V2 workspace and displays legacy calendar/table views upon browser refresh.
  - V2 write mutations fail closed (`FEATURE_DISABLED`).
  - Legacy endpoints (`getRequests`, `getLeaveApplications`) continue functioning without interruption.
  - All audit structures (`OperationLog`, `RosterEvents`, `RosterAssignments`, `WeeklyOffSnapshots`, `RosterPeriods`, `RosterEntitlementTransactions`) remain 100% physically preserved and untouched.

#### Tier 2 — Frontend Asset Rollback (Asset Regression)
- **Execution Time**: ~ 3 minutes.
- **Trigger**: Client bundle defect, browser crash, or CSS corruption on production devices.
- **Action**:
  1. Execute Tier 1 flag rollback first.
  2. Revert `gh-pages` branch to pre-cutover commit `4ec7843f992fa0e05540274085a83464470f262e`:
     ```bash
     git push origin 4ec7843f992fa0e05540274085a83464470f262e:gh-pages --force
     ```
- **Result**: Production users receive legacy SPA bundle.

#### Tier 3 — Backend Deployment Rollback (Backend Logic Defect)
- **Execution Time**: ~ 5 minutes.
- **Trigger**: Google Apps Script runtime defect, quota exhaustion, or unhandled backend exception.
- **Action**:
  1. In Google Apps Script dashboard, navigate to **Deployments** > **Manage Deployments**.
  2. Select active Web App deployment, click **Edit**, and change version to pre-cutover version recorded in Step A.4.
  3. Click **Deploy**.
- **Result**: Production web app executes pre-cutover backend bundle.

---

## 5. November Controlled Draft Cutover Strategy (`2026-11`)

When `CUTOVER_PERIOD = 2026-11` is selected by the operator, the preliminary 98 `MasterRoster` assignments are preserved and migrated into the initial V2 DRAFT workspace using the certified offline migration utility (`scripts/phase9-draft-seed.mjs`).

> [!IMPORTANT]
> **Seeding DRAFT does NOT modify legacy `MasterRoster`.**
> The 98 preliminary legacy rows in `MasterRoster` remain 100% physically preserved and untouched until explicit `PERIOD_PUBLISH` is authorized by the Clinical Director.

### 13-Step Execution Sequence

1. **Backup Production**: Complete full standalone Google Drive spreadsheet backup (`REQUEST-APP_PROD_BACKUP_YYYYMMDD_HHMMSS`) and record rollback deployment references.
2. **Verify November MasterRoster Checksum**: Verify that the November partition checksum matches the captured baseline (`0a431b41419a7c055772e06d998f7823a9e78d1c3fc2e6aa8ef62ff59ec107cc`). If any discrepancy is detected, stop immediately with `SOURCE_MASTERROSTER_CHANGED`.
3. **Provision V2 Schemas**: Additively provision V2 tables in Google Sheets while feature flags remain hidden.
4. **Seed MO & EP Identities**:
   - Seed canonical MO `RosterPeople` from `TeamMembers` (12 active MO, 1 inactive MO).
   - Seed 6 canonical EP identities into `RosterPeople` with `DirectoryType = 'EP'` via approved manual mapping review (`ep-identity-mapping-review.csv`).
   - EP identities remain strictly `EP_DIRECTORY_DISPLAY_ONLY`: excluded from MO draft patches, MO Planned assignments, weekly-OFF evaluation, Policy A/B calculations, GOFF/GHKA ledgers, and entitlement transactions.
5. **Configure Approved Effective-Dated OffPolicy (Policy B)**:
   - Insert active `OffPolicies` row for Policy B with `EffectiveMonday = 2026-10-26` (PolicyId: `b0000001-2026-4000-8000-000000000001`).
   - `EffectiveMonday = 2026-10-26` is required because November 1 is Sunday, falling in the Monday-Sunday week `2026-10-26` -> `2026-11-01`. Policy B applies to all 6 weeks of November and continues onwards until explicitly superseded.
6. **Enroll `2026-11` in DRAFT**: Create `RosterPeriods` record in state `DRAFT` (`Revision: 0`). `MasterRoster` remains completely untouched.
7. **Seed 98 Preliminary Assignments into DRAFT**: Execute `scripts/phase9-draft-seed.mjs` to apply the 98 preliminary cells via a deterministic batch `DRAFT_PATCH` operation (`draft:2026-11` reaches `Revision: 1`).
8. **Verify 98/98 Equivalence**: Run `verifyDraftSeedEquivalence` to prove that logical draft cells match the source legacy rows with zero discrepancies.
9. **Review Outstanding Requests Separately**: Inspect the operator review package (`.phase9/private/november-v2-operator-review.csv`):
   - Review the 23 requests still to apply (19 shift assignments + 4 course constraints).
   - Review the 2 safety overrides (post-night `PN` overrides requested `AM`).
   - Review the 6 preliminary roster assignments with no active request.
10. **Continue Roster Completion in V2 Workspace**: Operators edit cells, allocate remaining requests, resolve shifts, and inspect real-time weekly off/night safety guidance in the V2 workspace.
11. **Review Full Draft**: Verify complete roster draft with clinical leadership using dry-run cutover validators.
12. **Authorize Publication**: Clinical Director grants formal sign-off for `PERIOD_PUBLISH`.
13. **Publish Replaces Target-Month MasterRoster Projection**: `PERIOD_PUBLISH` creates immutable `Planned` assignments, snapshots `WeeklyOffSnapshots`, and atomistically updates the November month-partition projection in `MasterRoster`.

### Cutover Dependency Classification

| Stage | Prerequisites / Requirements |
| :--- | :--- |
| **Required Before Any Production Mutation** | - Standalone Google Drive spreadsheet backup verified (`REQUEST-APP_PROD_BACKUP_YYYYMMDD_HHMMSS`).<br>- Active Apps Script Deployment ID and numeric version recorded for rollback.<br>- Production Git refs confirmed on `feature/phase-9-cutover`.<br>- Baseline source checksums verified across all legacy tables. |
| **Required Before November DRAFT Seed** | - V2 schemas additively provisioned (12 sheets).<br>- Reference seeds populated: `ShiftSemantics` (18 codes), approved Policy B (`EffectiveMonday: 2026-10-26`), Settings.<br>- MO identities seeded (12 active, 1 inactive).<br>- Approved EP identities seeded (`DirectoryType: 'EP'`).<br>- Live November source partition checksum re-verified (`0a431b41419a7c055772e06d998f7823a9e78d1c3fc2e6aa8ef62ff59ec107cc`).<br>- `2026-11` enrolled in `RosterPeriods` as `DRAFT` (`Revision: 0`). |
| **Required Before November PUBLISH** | - 23 outstanding Requests reviewed and applied/resolved in V2 draft.<br>- 2 PN safety overrides confirmed (mandatory post-night rest retained).<br>- 6 unrequested preliminary roster duties reviewed by Clinical Director.<br>- Complete draft reviewed with zero unacknowledged safety blockers.<br>- Completed roster sign-off by Clinical Director.<br>*(Note: GOFF/GHKA opening balances do NOT technically block draft seeding or roster publish; they are required only prior to post-publish operational amendments that consume or verify balances).* |
