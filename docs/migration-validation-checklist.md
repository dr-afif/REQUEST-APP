# Migration Validation Checklist

Before flipping the switch from Google Sheets to the Supabase Postgres database, perform a "Dry Run" import and execute this checklist to guarantee data integrity and application safety.

## 1. Staging Import Validation
*   [ ] Verify all 7 Google Sheets have been exported to CSV.
*   [ ] Verify the CSVs were successfully inserted into the `_import_staging` tables in Supabase.
*   [ ] Note the `import_batch_id` UUID generated for this batch of inserts.

## 2. Run Automated ETL Validation
Before running any production inserts, execute the strict gatekeeper script:
```bash
npx ts-node scripts/migration/validate-staging-data.ts --batch <uuid> --department <name>
```
*   [ ] Verify `migration-summary.json` outputs `"pass": true`.
*   [ ] If errors exist, fix them in Google Sheets, re-export, and run again. Do not bypass this script.

## 3. Relational Integrity Checks (Post-Import)
After running the transformation script (moving data from staging to production tables), run the following checks:
*   [ ] **Shift Types**: Do all Shift Types in `shift_types` have a valid UUID and correct `department_id`?
*   [ ] **Roster Entries**: Did the "AM, PM" string from Google Sheets successfully split into two separate rows in `roster_entries`?
*   [ ] **Foreign Keys**: Run a test query: `SELECT * FROM roster_entries WHERE user_id IS NULL OR shift_type_id IS NULL;`. This MUST return 0 rows.
*   [ ] **Cross-Department Leakage**: Run `SELECT * FROM roster_entries re JOIN user_profiles up ON re.user_id = up.id WHERE re.department_id != up.department_id;`. This MUST return 0 rows (the database composite keys should have enforced this anyway).

## 4. Security & Access Control Validation
Log into the application (or Supabase Studio impersonation) as a standard Staff user:
*   [ ] Verify you can view the Roster (SELECT works).
*   [ ] Verify you **cannot** update your `role` to `admin` via the API (should return a 403 or fail silently depending on RPC).
*   [ ] Verify you **cannot** update a `request` approval status directly via the API.
*   [ ] Verify you **cannot** insert an Audit Log directly via the API.

Log in as an Admin user:
*   [ ] Verify you can see all users in your department.
*   [ ] Verify you can trigger the `admin_approve_request` RPC and it successfully updates the request AND writes an audit log.

## 5. Clean Up
*   [ ] Once validation is complete and successful, truncate the staging tables or leave them for historical reference. DO NOT drop them if you plan to do continuous syncing.
