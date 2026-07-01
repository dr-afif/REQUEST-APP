# Supabase ETL Migration Pipeline

This folder contains the validation-first ETL pipeline designed to move data safely from Google Sheets staging tables (`google_sheets_*_import_staging`) into the strictly-typed production Supabase tables.

## 1. Setup

1. Copy `.env.example` to `.env.local`
2. Fill in your `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. 
   > **Note**: The service role key is required because the migration script needs to bypass RLS and create accounts directly in the `auth.users` schema.

Install dependencies:
```bash
npm install @supabase/supabase-js dotenv
```

## 2. Validation (`validate-staging-data.ts`)

Run this script **first**. It does not write any data to production. It reads the staging tables and verifies all 11 integrity constraints (emails, duplicate names, shift splits, etc.).

```bash
npx ts-node scripts/migration/validate-staging-data.ts --batch <your_import_batch_uuid> --department <department_name>
```

It will produce `migration-errors.json` and `migration-summary.json`. 
**If there are any errors, fix them in your CSVs and re-import into the staging tables.**

## 3. Production Import (`import-staging-to-production.ts`)

Once validation passes, run the import script.

```bash
# Dry run first to see what it plans to do:
npx ts-node scripts/migration/import-staging-to-production.ts --batch <your_import_batch_uuid> --department <department_name> --dry-run

# Real run:
npx ts-node scripts/migration/import-staging-to-production.ts --batch <your_import_batch_uuid> --department <department_name>
```

You will be prompted to confirm before the script modifies the production tables. It will generate `migration-result.json` upon completion.
