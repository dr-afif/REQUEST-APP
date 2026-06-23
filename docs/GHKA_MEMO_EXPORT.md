# GHKA Memo Export

This document explains the foundation for generating official DOCX memos for GHKA (Gantian Hari Kelepasan Am) replacements.

## Template File
The base template for DOCX generation is located at:
`public/templates/ghka-memo-template.docx`

This exact file must be used as the base template because it contains the required official memo layout. It is the source template for all future GHKA memo DOCX generation.

## Monthly Selection Logic
The GHKA memo is submitted **monthly**. 
When generating the memo, the rows should normally be selected and grouped based on the month of the `matchedGhkaDate` (the date the replacement was taken), **not** by the original public holiday date.

## Required Placeholders & Data Mapping
When implementing the DOCX generation, the frontend will need to map the selected user data to the following placeholders inside the DOCX template.

### Fixed Applicant Fields
These fields represent the user applying for the memo:
- `{NAME}`: The full name of the user.
- `{DATE}`: The date the memo is generated/submitted.
- `{ID}`: The user's Staff ID.
- `{PHONE}`: The user's phone number.
- `{EMAIL}`: The user's email address.

### Memo Table Fields
These fields are required for each row of the GHKA replacement table. 
The DOCX template now uses `docxtemplater` dynamic loop tags (`{#rows}` ... `{/rows}`) so it can successfully render any number of selected GHKA records without leaving blank rows.
- `{#rows}` (Loop start)
- `{no}`
- `{phDate}`
- `{phName}`
- `{ghkaDate}`
- `{ghkaDay}`
- `{/rows}` (Loop end)

---

## Planned Export Phases

### Phase 1: Foundation (Completed)
- Store the official DOCX template in the repository (`public/templates/ghka-memo-template.docx`).
- Document required placeholders and data mapping in this file.

### Phase 2: Frontend Generation (Completed)
- **Dependencies**: Added `pizzip`, `docxtemplater`, and `file-saver` to handle client-side DOCX compilation.
- **Utility**: `src/utils/ghkaMemoExport.js` handles loading the template, rendering data, and downloading.
- Generates a DOCX file using the selected export rows from the user-mode export modal.
- The template has been updated to use the dynamic `{#rows}` repeat-row feature, safely supporting any number of selected rows without leaving extra empty rows.
- Keeps staff ID, phone, and email blank/empty since profiles are not yet implemented.
- **Note**: Memo submission status is purely a manual admin-managed workflow and is not automatically updated by generating this export.

### Phase 3: User Profiles (Completed)
- Add team member profile fields for staff ID, phone, and email in `appscript.txt` and `AdminPanel.jsx`.
- Auto-fill these applicant details dynamically into the `{ID}`, `{PHONE}`, and `{EMAIL}` placeholders.
- If profile fields are missing, export is still allowed but fields will be blank and a warning is shown.
- Memo names are formatted in title case and strip out leading "Dr." or "DR" prefixes, because the DOCX template already contains the "DR. " prefix before the `{NAME}` placeholder.

### Phase 4: Status Tracking
- Optionally mark exported rows as "memo submitted" within the application state after a successful export to help users track their completed applications.
