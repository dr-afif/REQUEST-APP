# ETL Import Workflow

This document explains exactly how to run the automated ETL pipeline to migrate your Google Sheets data into Supabase.

## 1. Prerequisites
1. Ensure your staging tables in Supabase (`google_sheets_*_import_staging`) are populated with your CSV data.
2. Note the UUID you used for the `import_batch_id` column when you uploaded the CSVs.
3. Open a terminal in the root of this repository.
4. Copy `scripts/migration/.env.example` to `scripts/migration/.env.local` and add your Supabase URL and Service Role Key.
5. Run `npm install` inside the `scripts/migration` folder if you haven't already.

## 2. Step 1: Run Validation (Read-Only)
The validation script acts as a strict gatekeeper. It checks your staging data against the production rules (unique emails, valid shift codes, matching names) without modifying the database.

**Command:**
```bash
npx ts-node scripts/migration/validate-staging-data.ts --batch <your_import_batch_uuid> --department "Emergency Dept"
```

**Outcome:**
*   It generates `migration-summary.json` and `migration-errors.json`.
*   If errors exist, the script fails. You **must** fix the data in your Google Sheets and re-upload the CSV to the staging tables. Do not proceed until validation passes 100%.

## 3. Step 2: Dry-Run Import (Read-Only)
Once validation passes, you can test the production script logic without actually inserting the data into Supabase.

**Command:**
```bash
npx ts-node scripts/migration/import-staging-to-production.ts --batch <your_import_batch_uuid> --department "Emergency Dept" --dry-run
```

**Outcome:**
*   The script processes the staging data (creating auth user mappings, splitting double shifts) but skips the actual Supabase database insertion commands.
*   It outputs `migration-result.json` showing exactly what *would* have been inserted.

## 4. Step 3: Real Production Import (Mutates Database)
Once you are confident in the dry-run results, run the real import.

**Command:**
```bash
npx ts-node scripts/migration/import-staging-to-production.ts --batch <your_import_batch_uuid> --department "Emergency Dept"
```

**Outcome:**
*   The script will explicitly prompt you: `⚠️ WARNING: This will mutate production tables... Are you sure? (y/N)`.
*   Type `y` to proceed.
*   It will create the Supabase Auth users via the Admin API, and upsert data into the production tables in the strict relational order required to satisfy all foreign key constraints.

## 5. Post-Import Checklist
After a successful run, open Supabase Studio and verify:
1. Users appear in the Authentication tab.
2. Roster entries look correct (double shifts are split into separate rows).
3. Requests have their partner UUIDs correctly resolved.
