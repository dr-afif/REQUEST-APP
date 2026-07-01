# Google Sheets to Supabase Migration Map

This document outlines how existing data from the Google Sheets backend will be mapped, cleaned, and migrated into the new normalized Supabase Postgres schema.

**Migration Architecture**: We do not insert raw CSVs directly into the production tables. We import them into `_staging` tables (e.g. `google_sheets_users_import_staging`) where all columns are strings, and then use the automated TypeScript ETL scripts (`scripts/migration/`) to map them to the typed tables described below.

## 1. Users / Staff Mapping
**Source Sheets**: `TeamMembers`, `EmergencyPhysicians`
**Staging Table**: `google_sheets_users_import_staging`
**Target Table**: `user_profiles` (and Supabase Auth)

| Google Sheet Column | Supabase `user_profiles` Column | Transformation Required |
| :--- | :--- | :--- |
| `MemberName` | `legacy_member_name` | **CRITICAL**: Used as a mapping key for other sheets during migration. Must match EXACTLY across sheets. |
| `FullName` | `full_name` | Direct copy. |
| `Email` | `email` | **CRITICAL**: Required to generate Supabase Auth accounts (`auth.users`). Cannot be empty. |
| `Phone` | `phone` | Direct copy. |
| `StaffId` | `staff_id` | Direct copy. |
| `Active` | `is_active` | Convert string/boolean to boolean (`true`/`false`). |
| *(Sheet Origin)* | `member_type` | If from `TeamMembers`, map to `'MO'`. If from `EmergencyPhysicians`, map to `'EP'`. |
| *(New)* | `role` | Set default to `'staff'`, manually promote admins to `'admin'` or `'super_admin'`. |

**Cleaning Required Before Migration**:
1.  Ensure **every** user has a unique email address.
2.  Ensure `MemberName` is perfectly consistent (no trailing spaces, identical casing) because it will be used to look up the new `user_id` (UUID) when migrating the Roster and Requests.

---

## 2. Shift Types & Limit Groups Mapping
**Source Sheets**: `ShiftTypes`, `LimitGroups`
**Staging Tables**: `google_sheets_shift_types_import_staging`, `google_sheets_limit_groups_import_staging`
**Target Tables**: `limit_groups`, `shift_types`

### Limit Groups
| Google Sheet Column | Supabase `limit_groups` Column | Transformation Required |
| :--- | :--- | :--- |
| `ID` | - | Discard string IDs, use generated UUIDs. |
| `GroupName` | `name` | Direct copy. |
| `DefaultLimit` | `default_limit` | Convert to Integer. |

### Shift Types
| Google Sheet Column | Supabase `shift_types` Column | Transformation Required |
| :--- | :--- | :--- |
| `ID` | - | Discard string IDs, use generated UUIDs. |
| `Name` | `name` | Direct copy. |
| `IsPublic` | `is_public` | Convert to Boolean. |
| `GroupID` | `limit_group_id` | Map the old string `GroupID` to the new UUID of the corresponding `limit_groups` row. |

---

## 3. Shift Blocks Mapping
**Source Sheet**: `ShiftBlocks`
**Staging Table**: `google_sheets_shift_blocks_import_staging`
**Target Table**: `shift_blocks`

| Google Sheet Column | Supabase `shift_blocks` Column | Transformation Required |
| :--- | :--- | :--- |
| `Date` | `date` | Parse to standard ISO Date (`YYYY-MM-DD`). |
| `ShiftType` | `shift_type_id` | Map the string shift name (e.g., "AM") to the new UUID of that shift in the `shift_types` table. |
| `MaxSlots` | `max_slots` | Convert to Integer. |

---

## 4. Master Roster Mapping
**Source Sheet**: `MasterRoster`
**Staging Table**: `google_sheets_roster_import_staging`
**Target Table**: `roster_entries`

| Google Sheet Column | Supabase `roster_entries` Column | Transformation Required |
| :--- | :--- | :--- |
| `Name` | `user_id` | Lookup the string name against the migrated `user_profiles` to find the UUID. |
| `Date` | `date` | Parse to standard ISO Date (`YYYY-MM-DD`). |
| `Shift` | `shift_type_id` | **CRITICAL**: Google Sheets currently allows comma-separated shifts (e.g., "AM, PM"). During migration, this string must be split, and **multiple rows** must be inserted into `roster_entries` for that user/date, mapping each shift string to its corresponding `shift_types` UUID. |

**Cleaning Required Before Migration**:
1.  Ensure all names in the `Name` column exactly match a `MemberName` in the users sheets. Any mismatch will result in a failed foreign key lookup.

---

## 5. Requests Mapping
**Source Sheet**: `Requests`
**Staging Table**: `google_sheets_requests_import_staging`
**Target Table**: `requests`

| Google Sheet Column | Supabase `requests` Column | Transformation Required |
| :--- | :--- | :--- |
| `Name` | `user_id` | Lookup UUID via string name. |
| `Date` | `date` | Parse to standard ISO Date. |
| `Request` | `shift_type_id` | Lookup UUID via string shift name. |
| `Status` | `status` | Map string to enum: `'active'`, `'old'`, or `'cancelled'`. |
| `ApprovalStatus` | `approval_status` | Map string to enum: `'pending_partner'`, `'pending_admin'`, `'approved'`, `'rejected'`. |
| `RequestType` | `req_type` | Map string to enum: `'Leave'`, `'Swap'`. |
| `SwapPartner` | `swap_partner_id` | Lookup UUID via string name (if it's a swap). |
| `Comment` | `comment` | Direct copy. |

**Cleaning Required Before Migration**:
1.  Similar to the Master Roster, ensure all names in `Name` and `SwapPartner` exactly match existing users.

---

## 6. App Settings Mapping
**Source Sheet**: `Settings`
**Staging Table**: `google_sheets_settings_import_staging`
**Target Table**: `settings`

| Google Sheet Column | Supabase `settings` Column | Transformation Required |
| :--- | :--- | :--- |
| `Key` | `key` | Direct copy. |
| `Value` | `value` | Convert string/boolean to JSONB format. |
