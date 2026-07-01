# Data Cleaning Before Import

Google Sheets allows free-form text entry, which often results in messy data. Before exporting your Sheets to CSV for the staging tables, you **MUST** perform the following data cleaning steps directly in Google Sheets. Failure to do so will result in migration errors.

## 1. User Consolidation & Emails
**Target Sheets**: `TeamMembers`, `EmergencyPhysicians`
*   **Mandatory Emails**: Supabase requires an email to create an authentication account. Go through every single staff member and ensure they have a valid, unique email address in the `Email` column.
*   **Merge Sheets**: Decide if you want to export these as two separate CSVs or merge them into one `Users.csv` before import. The staging table `google_sheets_users_import_staging` accepts a `member_type` column, so if you keep them separate, you will need to add a static `member_type` column (with values `MO` or `EP`) to the CSV before importing.
*   **Unique Names**: The `MemberName` column MUST be unique. Ensure there are no two doctors with the exact same `MemberName` string, as this string is used as the `legacy_member_name` foreign key mapping during import.

## 2. Shift Type Normalization
**Target Sheet**: `ShiftTypes`
*   **Remove Duplicates**: Ensure there are no duplicate Shift Names (e.g., two rows for "AM").
*   **Standardize Casing**: Ensure Shift Names are consistent (e.g., all uppercase like "AM", "PM", "AL"). The database constraint is unique, so "am" and "AM" might clash or cause confusion during the Master Roster join.

## 3. Date Formatting
**Target Sheets**: `MasterRoster`, `ShiftBlocks`, `Requests`
*   **Standardize Dates**: Google Sheets often formats dates visually (e.g., "01-Jan-2026"). You must format the entire Date column in all sheets to **`YYYY-MM-DD`** before exporting to CSV. 
*   *How to do this in Sheets*: Highlight the column -> Format -> Number -> Custom date and time -> `1930-08-05` format.

## 4. Master Roster Shifts
**Target Sheet**: `MasterRoster`
*   **Comma Separation**: If a doctor is doing a double shift (e.g., "AM, PM"), ensure it is separated by a comma. The migration script will split the string at the comma. 
*   **No Typos**: The shift names in the `Shift` column MUST exactly match the `Name` column in the `ShiftTypes` sheet. If a roster entry says "A M" (with a space) but the shift type is "AM", the migration will fail to find the foreign key.

## 5. Requests Cleanup
**Target Sheet**: `Requests`
*   **Valid Statuses**: Ensure all rows in the `Status` column strictly equal `Active`, `Old Request`, or `Cancelled`. 
*   **Valid Approval Statuses**: Ensure all rows in `ApprovalStatus` strictly equal `Pending Partner`, `Pending Admin`, `Approved`, or `Rejected`. Fix any typos.
*   **Valid Request Types**: Ensure `RequestType` is either `Leave` or `Swap`.
*   **Name Matching**: Ensure every name in `Name` and `SwapPartner` perfectly matches a `MemberName` in the Users sheet.
