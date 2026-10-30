# Incident Record: Production MasterRoster Data Loss

- **Incident Date**: 2026-10-02
- **Last Known Complete MasterRoster**: 2026-10-02 09:16 MYT
- **First Observed October-Only Version**: 2026-10-02 11:04 MYT
- **Impacted Resource**: Google Sheets `MasterRoster` tab
- **Unaffected Resources**: `Requests` tab (and all other application tabs remained fully intact and isolated)

---

## 1. Timeline & Incident Description

On the morning of 2026-10-02, a user performed routine shift assignments for the October 2026 roster via the web frontend. Shortly thereafter, historical roster records for previous months (January through September 2026) disappeared from the `MasterRoster` sheet, leaving only October 2026 entries.

- **09:16 MYT**: Google Sheets Version History recorded the last known complete `MasterRoster` dataset containing January through October 2026.
- **11:04 MYT**: Version History recorded the first corrupted state where all pre-October data was missing.

---

## 2. Root Cause Analysis

1. **Frontend Contract Evolution**:
   Commit `77eeedb14525a2e04944e1706f5ada4678c5cdac` (2026-09-30) optimized MasterRoster uploads to be month-scoped:
   ```json
   { "action": "uploadmasterroster", "rows": [ ...octoberRowsOnly ], "targetMonth": "2026-10" }
   ```
   The frontend functioned as designed, sending only the active month's rows along with the required `targetMonth` property.

2. **Production Backend Lag**:
   Production Google Apps Script deployment was manual and had not been updated from the May 2026 legacy `Code.gs`. The deployed backend implementation of `handleUploadMasterRoster` completely ignored `targetMonth`:
   ```javascript
   // Legacy production Code.gs behavior
   const lastRow = sheet.getLastRow();
   if (lastRow > 1) {
     sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).clearContent(); // Wiped entire sheet
   }
   if (Array.isArray(rows) && rows.length > 0) {
     sheet.getRange(2, 1, values.length, 3).setValues(values); // Wrote only October payload
   }
   ```
   Consequently, every month-scoped save or shift reassignment triggered a complete sheet wipe followed by writing only the selected month.

3. **Local Reproduction**:
   The exact October-only data-loss signature was reproduced locally using production payload fixtures against the legacy script.

---

## 3. Disassociation from Phase 5 Development

Phase 5 feature development was **NOT** directly responsible for the production spreadsheet mutation:
- Antigravity development runs, tests, and builds execute strictly in local environments.
- Feature branch pushes (`origin/feature/phase-5-amendments`) deploy static assets to GitHub Pages only; they never deploy Google Apps Script code.
- Google Apps Script deployments are entirely manual and decoupled from git pushes.
- The root cause was an un-deployed contract discrepancy between the deployed frontend and the legacy production backend.

---

## 4. Emergency Legacy Safety Hotfix

To resolve the vulnerability without destabilizing production with unfinished Phase 5 features, an emergency legacy hotfix was developed and hardened:

- **Initial hotfix commit**: `2ccf548bec1fe34fd4b1c5f1e2912e050ae834f0`
- **Hardened V1.1 commit**: `8943ffb50426b46e204c0e336ce6cf8f503ea9e8`

### V1.1 Protections:
1. **Mandatory Strict `targetMonth`**: Fails closed if `targetMonth` is missing, blank, or not formatted as strict `YYYY-MM`.
2. **Month-Scoped Preservation**: Preserves all non-target month rows, unparseable historical records, and blank entries byte-for-byte.
3. **Strict Inbound Row Validation**: Rejects incoming payloads containing missing dates, malformed dates, or cross-month entries (e.g., September dates in an October upload).
4. **Missing MasterRoster Fail-Closed**: Fails closed if the `MasterRoster` sheet is missing rather than silently creating an empty sheet.
5. **Serialization via ScriptLock**: Uses `LockService.getScriptLock()` to serialize concurrent executions.
6. **Write-Before-Cleanup**: Primary replacement rows (`setValues`) are written and flushed starting at row 2 **before** any surplus trailing rows are cleared, eliminating the clear-before-write data-loss window.
7. **Elimination of Implicit/Override Full Replacements**: Removed `allowFullReplacement` and `authorizeFullReplacement` flags; all uploads must be strictly month-scoped.
8. **Comprehensive Regression Coverage**: 19 automated failure-window and preservation tests in `tests/phase1/legacy-roster-hotfix.test.mjs`.

---

## 5. Production Remediation & Verification

Production remediation was executed manually:
1. **Hotfix Deployed**: The minimal V1.1 hotfix functions (`handleUploadMasterRoster`, `formatCellDate_`, `getMonthFromValue_`, `handleLegacyMasterRosterUpload_`) were manually deployed to the existing production Google Apps Script Web App.
2. **Data Restoration**: Historical `MasterRoster` rows (January through September 2026) were restored from Google Sheets Version History (snapshot at 09:16 MYT).
3. **Verification**: Controlled live shift reassignment and roster saving for October 2026 were tested. All pre-October records remained intact byte-for-byte, confirming month-scoped preservation in production.
4. **Data Isolation Confirmed**: The `Requests` sheet remained completely unaffected throughout the incident.
