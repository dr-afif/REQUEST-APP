# Major Update — Phase 9 Production Cutover Checklist & Rollback Architecture

**Document Version**: 1.0.0  
**Phase**: Phase 9 Slice 1 — Production Cutover Preflight & Non-Production Migration Rehearsal  
**Execution Context**: Strict Non-Production Rehearsal (Zero Live Mutations, Zero Deployments)  
**Authoritative Baseline**:  
- `main` / `origin/main`: `17712a4f7e177771ff3cf44d02d7ba570f567d21`  
- Legacy Deployed Frontend (`origin/gh-pages`): `4ec7843`  
- Production Backend: Legacy V1.1 Apps Script with MasterRoster month-safety hotfix.  
- Phase 8 Certified Checkpoint: `dab0d8acf40c184b138d1d237a20f897d8bf277a`  

---

## 1. Pre-Cutover Verification Checklist (Before Mutation)

Every item in this pre-cutover checklist must be verified and checked off prior to any live change:

- [ ] **Maintenance Announcement**: Users notified of scheduled cutover window; legacy roster edits frozen.
- [ ] **Workbook Snapshot / Backup**: Production Google Sheet fully duplicated with immutable timestamped name (e.g. `REQUEST-APP_PROD_BACKUP_YYYYMMDD_HHMMSS`).
- [ ] **Baseline Row Counts Recorded**:
  - `MasterRoster` total row count recorded: `___________`
  - `MasterRoster` distinct historical months counted: `___________`
  - `Requests` total row count recorded: `___________`
  - `LeaveApplications` total row count recorded: `___________`
  - `TeamMembers` active MO staff count recorded: `___________`
  - `EmergencyPhysicians` active EP staff count recorded: `___________`
  - `ActivityHistory` total row count recorded: `___________`
- [ ] **Identity Audit Verification**:
  - `TeamMembers` list verified against canonical staff roster.
  - Zero unresolvable duplicate names detected.
  - EP staff identified and separated from MO registry.
- [ ] **Apps Script Baseline Health Check**:
  - Legacy `doGet` endpoint responds with valid JSON for legacy requests.
  - Legacy `MasterRoster` returns expected historical shifts.

---

## 2. Cutover Execution Step-by-Step Checklist

Execute in strict sequential order. No concurrent or out-of-order steps permitted.

### Phase A: Schema Provisioning (Additive Only)
- [ ] **Run Schema Provisioning**: Execute `rosterProvisionAllSchemas_()` in Google Apps Script editor.
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
- [ ] **Verify Settings Sheet**: Ensure V2 switch keys exist with initial safe defaults (`false`).
- [ ] **Verify Pre-Existing Sheet Preservation**:
  - Confirm `MasterRoster`, `Requests`, `LeaveApplications`, `TeamMembers`, `EmergencyPhysicians` row counts match baseline exactly.

### Phase B: Identity Registry Seeding
- [ ] **Seed `RosterPeople`**: Populate `RosterPeople` from `TeamMembers` and `EmergencyPhysicians` using deterministic RFC 4122 UUIDv4 identifiers.
- [ ] **Verify Zero Ambiguities**: Check that every active doctor maps 1-to-1 without duplicate `PersonId`s or alias collisions.

### Phase C: Backend Deployment (V2 Flags Inactive)
- [ ] **Deploy Apps Script Bundle**: Update Apps Script code with certified Phase 8 bundle (`appscript.txt`).
- [ ] **Verify Script Properties**: Confirm `ROSTER_V2_ADMIN_EMAIL` is configured to the authorized administrator Google account.
- [ ] **Smoke-Test Legacy API**: Confirm legacy requests, leave applications, and legacy roster views function normally.

### Phase D: Baseline Cutover Period Enrollment & Publish
- [ ] **Enroll Target Cutover Period**: Set up target month (e.g. `2026-11`) in `RosterPeriods` with initial `State: 'DRAFT'`.
- [ ] **Execute Initial Publish**: Run `rosterv2publish` with planned duty assignments.
  - Verify `RosterPeriods.State` transitions to `PUBLISHED` (Revision 1).
  - Verify Planned assignments written to `RosterAssignments` (`Layer: 'PLANNED'`).
  - Verify Current assignments match Planned (`Layer: 'CURRENT'`).
  - Verify `ProjectionChecksum` computed and verified.
  - Verify month-scoped `MasterRoster` projection updated for target month ONLY.
  - Verify historical months in `MasterRoster` remain completely unchanged.

### Phase E: Opening Balance Import
- [ ] **Import Verified Entitlement Balances**: Admin imports verified GOFF and GHKA opening balances via `rosterv2entitlementcreditmanual` with `ReasonCode: 'OPENING_BALANCE'`.
- [ ] **Verify Entitlement Ledger**: Confirm transactions logged in `RosterEntitlementTransactions` with correct `BalanceAfter`.

### Phase F: Enable V2 Backend Switches
- [ ] **Update Settings Flags**:
  - `roster_v2_read_enabled: 'true'`
  - `roster_v2_write_enabled: 'true'`
  - `shift_semantics_v2_enabled: 'true'`
  - `weekly_off_guidance_enabled: 'true'`
  - `night_safety_guidance_enabled: 'true'`
  - `goff_ledger_enabled: 'true'`
  - `write_queue_v2_enabled: 'true'`
  - `roster_workspace_v2_enabled: 'true'`
  - `legacy_upload_enabled: 'false'`

### Phase G: Frontend Release Deployment
- [ ] **Deploy Frontend Release**: Push certified build bundle to `gh-pages`.
- [ ] **Verify CDN Cache Invalidation**: Confirm deployed site loads current bundle version.

---

## 3. Post-Cutover Verification Matrix (Before / After Comparison)

| Verification Item | Baseline (Pre-Cutover) | Target (Post-Cutover) | Actual Result | Status |
| :--- | :--- | :--- | :--- | :--- |
| **`MasterRoster` Historical Rows** | N historical rows | Exactly N rows preserved | | [ ] PASS |
| **`MasterRoster` Cutover Month** | Legacy or empty | Matches V2 projection | | [ ] PASS |
| **Active MO Staff Count** | Count in `TeamMembers` | Equal in `RosterPeople` | | [ ] PASS |
| **Active EP Staff Count** | Count in `EmergencyPhysicians` | Equal in `RosterPeople` | | [ ] PASS |
| **`Requests` Sheet Row Count** | M records | Exactly M records | | [ ] PASS |
| **`LeaveApplications` Row Count** | K records | Exactly K records | | [ ] PASS |
| **Enrolled V2 Period** | None | 1 period (`PUBLISHED`) | | [ ] PASS |
| **Planned Assignment Count** | 0 | Matches planned schedule | | [ ] PASS |
| **Current Assignment Count** | 0 | Matches planned schedule | | [ ] PASS |
| **Projection Checksum** | N/A | Matches SHA-256 digest | | [ ] PASS |
| **Apps Script Health** | OK | OK (V2 endpoints active) | | [ ] PASS |
| **Admin Authentication** | Legacy PIN / direct | Google Session check OK | | [ ] PASS |
| **Desktop Roster Workspace** | Legacy table | Phase 8 Sticky Pinning OK | | [ ] PASS |
| **Roving Focus & Fast Entry** | None | Arrow navigation active | | [ ] PASS |
| **Viewer Privacy** | N/A | Non-admin notes redacted | | [ ] PASS |
| **Entitlements Ledger Panel** | None | Balances display cleanly | | [ ] PASS |

---

## 4. Rollback Architecture

If an unexpected condition arises during cutover, execute rollback following these decoupled tiers:

### Tier 1: Feature Rollback (Zero Data Loss)
- In the `Settings` sheet, set:
  - `roster_v2_read_enabled: 'false'`
  - `roster_v2_write_enabled: 'false'`
  - `goff_ledger_enabled: 'false'`
  - `legacy_upload_enabled: 'true'`
- **Effect**: Instantly returns the backend and frontend to pure legacy behavior.
- **Data Impact**: Zero. All newly created sheets and audit entries remain intact.

### Tier 2: Frontend Rollback
- Revert the `gh-pages` branch to commit `4ec7843`:
  ```bash
  git push origin 4ec7843:gh-pages --force
  ```
- **Effect**: Re-serves the legacy single-page application.

### Tier 3: Backend Rollback
- If the Apps Script deployment exhibits unexpected runtime failures, revert the Google Apps Script deployment to the previous version / V1.1 checkpoint.

### Tier 4: Data Preservation Invariant on Rollback
Under NO circumstance should newly created audit structures be deleted or truncated during rollback:
- **`OperationLog`**: NEVER DELETE.
- **`RosterEvents`**: NEVER DELETE.
- **`RosterAssignments`**: NEVER DELETE.
- **`WeeklyOffSnapshots`**: NEVER DELETE.
- **`RosterAbsences` & `RosterReplacements`**: NEVER DELETE.
- **`RosterEntitlementTransactions`**: NEVER DELETE.
- **`OffPolicies`**: NEVER DELETE.

Retaining audit sheets ensures that any changes initiated during the cutover attempt remain traceable for forensic post-mortem analysis.

---

## 5. Objective Rollback Trigger Criteria

Cutover operations must be **HALTED IMMEDIATELY** and rollback initiated if ANY of the following 10 objective criteria are met:

1. **Historical MasterRoster Row Loss**: Any non-target month row in `MasterRoster` is deleted, corrupted, or shifted.
2. **Unexpected Mutation of Non-Target Months**: Any mutation occurs outside the explicitly enrolled cutover month.
3. **Identity Ambiguity / Collisions**: An ambiguous identity causes an assignment to link to the wrong staff member or fail closed during clinical operations.
4. **Destructive Schema Diff**: Schema provisioning alters existing column orders or wipes cell content in legacy tables.
5. **Frontend Compatibility Regression**: The frontend fails to load or cannot parse existing production records.
6. **Backend V1 Compatibility Failure**: Legacy `Requests` or `LeaveApplications` endpoints fail or reject legitimate submissions.
7. **Authorization or Privacy Regression**: Non-administrative users gain visibility into private notes, administrative remarks, or audit logs.
8. **Planned / Current State Corruption**: Checksum verification fails or Planned snapshot diverges from approved schedule.
9. **Persistent Queue Synchronization Failure**: Draft operations repeatedly fail with unrecoverable conflict errors.
10. **Elevated Production Error Rate**: Any system error rate exceeding 1% during post-cutover smoke-testing.
