-- ==============================================================================
-- Google Sheets Staging Tables for Dry-Run Migrations
-- ==============================================================================
-- These tables exist entirely to swallow raw CSV dumps (where everything is a string)
-- safely without crashing the database on type-mismatches. Once data is imported here,
-- a separate PL/pgSQL script or Edge Function can validate and map the text fields
-- to proper UUIDs and Enums in the production schema.

CREATE TABLE public.google_sheets_users_import_staging (
    raw_id SERIAL PRIMARY KEY,
    import_batch_id UUID,
    source_sheet_name TEXT,
    source_file_name TEXT,
    raw_row_number INTEGER,
    validation_status TEXT,
    validation_errors JSONB,
    member_name TEXT,
    full_name TEXT,
    phone TEXT,
    active TEXT,
    staff_id TEXT,
    email TEXT,
    member_type TEXT, -- Used to map 'MO' or 'EP' depending on the source sheet
    imported_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.google_sheets_shift_types_import_staging (
    raw_id SERIAL PRIMARY KEY,
    import_batch_id UUID,
    source_sheet_name TEXT,
    source_file_name TEXT,
    raw_row_number INTEGER,
    validation_status TEXT,
    validation_errors JSONB,
    shift_id TEXT,
    name TEXT,
    is_public TEXT,
    group_id TEXT,
    imported_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.google_sheets_limit_groups_import_staging (
    raw_id SERIAL PRIMARY KEY,
    import_batch_id UUID,
    source_sheet_name TEXT,
    source_file_name TEXT,
    raw_row_number INTEGER,
    validation_status TEXT,
    validation_errors JSONB,
    group_id TEXT,
    group_name TEXT,
    default_limit TEXT,
    imported_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.google_sheets_shift_blocks_import_staging (
    raw_id SERIAL PRIMARY KEY,
    import_batch_id UUID,
    source_sheet_name TEXT,
    source_file_name TEXT,
    raw_row_number INTEGER,
    validation_status TEXT,
    validation_errors JSONB,
    block_id TEXT,
    date TEXT,
    shift_type TEXT,
    max_slots TEXT,
    imported_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.google_sheets_roster_import_staging (
    raw_id SERIAL PRIMARY KEY,
    import_batch_id UUID,
    source_sheet_name TEXT,
    source_file_name TEXT,
    raw_row_number INTEGER,
    validation_status TEXT,
    validation_errors JSONB,
    member_name TEXT,
    date TEXT,
    shifts TEXT, -- e.g., "AM, PM" (needs splitting in processing)
    imported_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.google_sheets_requests_import_staging (
    raw_id SERIAL PRIMARY KEY,
    import_batch_id UUID,
    source_sheet_name TEXT,
    source_file_name TEXT,
    raw_row_number INTEGER,
    validation_status TEXT,
    validation_errors JSONB,
    request_id TEXT,
    timestamp TEXT,
    member_name TEXT,
    date TEXT,
    day TEXT,
    request_shift TEXT,
    status TEXT,
    comment TEXT,
    approval_status TEXT,
    swap_partner TEXT,
    request_type TEXT,
    imported_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.google_sheets_settings_import_staging (
    raw_id SERIAL PRIMARY KEY,
    import_batch_id UUID,
    source_sheet_name TEXT,
    source_file_name TEXT,
    raw_row_number INTEGER,
    validation_status TEXT,
    validation_errors JSONB,
    setting_key TEXT,
    setting_value TEXT,
    imported_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS on staging tables but lock them strictly to super admins
DO $$ 
DECLARE
    tbl text;
BEGIN
    FOR tbl IN SELECT unnest(ARRAY[
        'google_sheets_users_import_staging',
        'google_sheets_shift_types_import_staging',
        'google_sheets_limit_groups_import_staging',
        'google_sheets_shift_blocks_import_staging',
        'google_sheets_roster_import_staging',
        'google_sheets_requests_import_staging',
        'google_sheets_settings_import_staging'
    ]) 
    LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', tbl);
        EXECUTE format('CREATE POLICY "Super admins can manage staging %I" ON public.%I FOR ALL TO authenticated USING (public.get_user_role() = ''super_admin'');', tbl, tbl);
    END LOOP;
END $$;
