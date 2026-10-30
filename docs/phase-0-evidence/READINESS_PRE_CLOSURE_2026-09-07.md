# Major Update Phase 0 Readiness Assessment

## Assessment status

**Phase 0 result: OPEN / NOT PASSED. Local evidence review and synthetic fixtures updated on 2026-09-07; physical workbook, deployment, restore and owner-sign-off evidence remain incomplete.**

The safe repository review has been completed for the materials available. The source contract, local data flows, mutation behavior, shift semantics, deployment path, and existing validation coverage have been inspected. On 2026-09-04, the user approved a test-only Apps Script deployment connected to a copied test workbook. Its normal `alldata` path was inspected; the production endpoint and production workbook were not accessed.

The API-exposed test data inventory is complete, but the physical workbook inventory remains **Awaiting copied-workbook URL/export and metadata evidence**. Phase 1 must not begin until the remaining workbook, deployed-source, timezone, backup/restore, and sign-off gates are satisfied.

## Evidence freeze and baseline

| Item | Frozen value |
| --- | --- |
| Assessment date | 2026-09-04 16:47:40 +08:00 (Asia/Kuala_Lumpur) |
| Test-endpoint continuation | 2026-09-04 17:29:29–17:33:23 +08:00 |
| Repository | `C:\Users\DR-AFIF\Documents\GitHub\REQUEST-APP` |
| Branch | `main` |
| HEAD | `a852f0ace8966c8fcbce88166e4dfc3081f5476c` |
| HEAD timestamp | 2026-09-04T09:11:24+08:00 |
| HEAD subject | `feat: simplify analytics and track leave forms` |
| Initial worktree state | Only `MAJOR_UPDATE_SPEC.md` and `MAJOR_UPDATE_IMPLEMENTATION_PLAN.md` were untracked. No tracked modification was present. |
| Repository Apps Script Git object ID | `b9601899509b276742f516dc237d00af40a8b026` |
| Repository Apps Script SHA-256 | `82554B83BDE2E9D111C2A3749F9C1E6C1B750AC11138B18F7BE18982BB045538` |
| Repository Apps Script size | 47,260 bytes |
| Governing documents | `MAJOR_UPDATE_SPEC.md`; `MAJOR_UPDATE_IMPLEMENTATION_PLAN.md` |

The governing documents were checked against the implementation. Their material current-state claims are supported by the repository, including the global `MasterRoster` replacement, cache-first full refresh, whole-collection rollback risk, name-based identity, manual Apps Script deployment risk, and inconsistent `PN` classification (`MAJOR_UPDATE_SPEC.md:31-61`; `MAJOR_UPDATE_IMPLEMENTATION_PLAN.md:69-157`). Their historical evidence-boundary text was updated to record the approved copied-test endpoint inspection; no approved product decision was changed.

## Non-mutation statement

- No production web app, Apps Script deployment, Google Sheet, or Drive item was called or opened.
- The only remote target was the exact user-approved test-only deployment. Three `GET?action=alldata` requests were required: the first exposed a parser-incompatible empty field name, the second produced the broad inventory, and the third produced a compact non-truncated inventory with raw date strings. No other action and no POST request was used.
- No application source, backend source, configuration, dependency, or deployment was changed. No deliberate spreadsheet write was sent. Incidental copied-test workbook effects inherent in the GET path remain possible as documented below.
- No package installation, dependency update, staging, commit, or push was performed.
- The existing test suite and production build were run locally. The build-generated tracked `dist/index.html` hash change was reverted immediately; generated asset files remained ignored.
- The accepted test-workbook side-effect boundary is verified in source: `alldata` invokes every getter (`appscript.txt:142-155`), while getters can create sheets and headers (`appscript.txt:162-174`, `appscript.txt:202-261`, `appscript.txt:1136-1161`), seed missing configuration (`appscript.txt:346-364`, `appscript.txt:767-776`), and archive past activity rows (`appscript.txt:1177-1239`).

## Approved test-endpoint inspection

### Exact requests and response stability

All three requests used the same URL and method:

```text
GET https://script.google.com/macros/s/AKfycbwqO8lCJGLaZtCZWb7ucWVGM3r_UOIrT8MHPW8EG4WLk6jLVkX4N7nl1Srat8ToUhfbIg/exec?action=alldata
```

| Request | Local time (+08:00) | HTTP | Response length | Response SHA-256 | Purpose |
| --- | --- | ---: | ---: | --- | --- |
| 1 | 17:29:29–17:29:38 | 200 | 950,326 characters | `D993665C57C52195466713B0F64486FAAE5C5FA6B59319356352BFC924900624` | Initial minimum read; local default parser rejected the response because it contains an empty-string property name. |
| 2 | 17:31:16–17:31:23 | 200 | 950,326 characters | Same | Hashtable-aware parse and broad inventory. |
| 3 | 17:33:17–17:33:23 | 200 | 950,326 characters | Same | Compact follow-up to preserve raw date strings and recover details truncated from the broad diagnostic output. |

The byte-equivalent response across all three calls establishes that there was no response-visible change between them. It does not prove that the first call caused no workbook mutation: the getter can mutate before serializing its response, and there was no pre-call workbook snapshot.

### Observed side effects

- No POST, append action, delete action, roster upload, directory rewrite, setting update, migration, publication, amendment, close, or ledger action was called.
- No response-visible data change occurred: all three response hashes and lengths are identical.
- `ActivityHistory` returned 11 `Archived` rows and one `Active` row. The API cannot establish whether any of the 11 were archived by the first inspection because `getActivityHistoryData()` performs that update before returning data (`appscript.txt:1200-1239`).
- The response cannot establish whether the first request created a missing tab, added a header, or seeded a default. The returned nonempty datasets show that the principal data structures existed after the first request, but only workbook change history or a pre-call snapshot can distinguish pre-existing state from incidental initialization.
- Existing GET code does not append activity rows. No activity append was observed or requested.

### Dataset and response-field inventory

The response is the modern object envelope expected by `src/App.jsx`, with all 11 top-level keys in repository order: `requests`, `teamMembers`, `emergencyPhysicians`, `masterRoster`, `shiftBlocks`, `shiftTypes`, `limitGroups`, `activityHistory`, `settings`, `publicHolidays`, and `leaveApplications` (`appscript.txt:142-155`; `src/App.jsx:269-325`).

| Dataset | Returned rows/keys | Returned field order from first row |
| --- | ---: | --- |
| `requests` | 2,805 rows | `ID`, `Timestamp`, `Name`, `Date`, `Day`, `Request`, `Status`, `Comment`, `ApprovalStatus`, `SwapPartner`, `RequestType`, **blank field name** |
| `teamMembers` | 13 rows | `name`, `fullName`, `phone`, `staffId`, `email`, `active` |
| `emergencyPhysicians` | 6 rows | `name`, `fullName`, `phone`, `staffId`, `email`, `active` |
| `masterRoster` | 3,859 rows | `Name`, `Date`, `Shift` |
| `shiftBlocks` | 12 rows | `ID`, `Date`, `ShiftType`, `MaxSlots` |
| `shiftTypes` | 15 rows | `ID`, `Name`, `IsPublic`, `GroupID` |
| `limitGroups` | 2 rows | `ID`, `GroupName`, `DefaultLimit` |
| `activityHistory` | 12 rows | `ID`, `Timestamp`, `CustomText`, `Name`, `RequestType`, `Request`, `SwapPartner`, `Date`, `ApprovalStatus`, `Comment`, `Status` |
| `settings` | 8 keys | `monthly_request_limit`, `monthly_weekend_limit`, `weekend_limit_group_id`, `memo_2026-07`, `memo_2026-08`, `memo_2026-09`, `phTrackerOpeningBalances`, `phTrackerMemos` |
| `publicHolidays` | 1 row | `ID`, `Date`, `Name`, `Active` |
| `leaveApplications` | 2 rows | `ID`, `MemberName`, `LeaveType`, `StartDate`, `EndDate`, `Days`, `Status`, `SubmittedDate`, `ReferenceNo`, `Notes`, `UpdatedAt` |

The blank Requests field is the only returned field beyond the repository contract. It appears in the first row/object order after `RequestType`; one of 2,805 rows contains the numeric value `12.0833333333333` under it. This is a verified schema/data anomaly requiring inspection in the copied workbook. It also explains why the first PowerShell JSON parse failed: the response is valid JSON, but the default parser rejects empty property names.

### Date representations exposed by the API

These are response representations, not proof of cell number formats or workbook timezone settings.

| Dataset/field | Returned representation | Observed range/examples |
| --- | --- | --- |
| Requests `Date` | ISO UTC date-time representing apparent local midnight at UTC+08 | Local-date range inferred as 2025-10-03 through 2027-01-31; example `2025-10-31T16:00:00.000Z` corresponds to 2025-11-01 at +08. |
| Requests `Timestamp` | ISO UTC date-time | 2025-09-26T23:01:23.989Z through 2026-09-03T15:09:49.476Z. |
| MasterRoster `Date` | ISO UTC date-time representing apparent local midnight at UTC+08 | Local-date range 2026-01-01 through 2026-09-30; example `2026-04-30T16:00:00.000Z` corresponds to 2026-05-01 at +08. |
| ShiftBlocks `Date` | ISO UTC date-time representing apparent local midnight at UTC+08 | Local-date range 2026-06-08 through 2026-08-19. |
| Activity `Date` / `Timestamp` | ISO UTC date-time; seven activity dates are blank | Nonblank activity local dates 2026-05-20 through 2026-05-26. |
| PublicHolidays `Date` | Text `YYYY-MM-DD` | `2026-09-01`. |
| Leave start/end/submitted dates | Text `YYYY-MM-DD` | Two start/end dates: 2026-09-04 and 2026-09-11; one submitted date is blank. |
| Leave `UpdatedAt` | Slash-formatted date/time string | `04/09/2026 09:25:15` and `04/09/2026 09:26:31`; day/month ordering is not independently proven by the API. |

The repeated UTC-to-local-midnight pattern is evidence consistent with UTC+08 storage/serialization, but it is not a substitute for the spreadsheet and Apps Script project timezone values.

### Shift inventory

`MasterRoster` contains the following exact raw values and counts:

| Raw shift | Count | Raw shift | Count | Raw shift | Count |
| --- | ---: | --- | ---: | --- | ---: |
| `AM` | 391 | `PM` | 552 | `ON1` | 274 |
| `ON2` | 272 | `PN` | 274 | `OH` | 151 |
| `AMX` | 27 | `PMX` | 20 | `AM (X)` | 168 |
| `PM (X)` | 236 | `AM (S)` | 3 | `PM (S)` | 5 |
| `OFF` | 548 | `OFF (S)` | 83 | `GOFF` | 46 |
| `GOFF (S)` | 8 | `AL` | 114 | `MC` | 29 |
| `EL` | 2 | `HKA` | 98 | `HKA (S)` | 6 |
| `GHKA` | 124 | `GHKA (S)` | 4 | `COURSE` | 109 |
| `COURSE (S)` | 2 | `COURT` | 5 | `EP_OFFICE_HOUR` | 155 |
| `EP_ONCALL` | 153 |  |  |  |  |

The configured `ShiftTypes` are, in returned order: `AM`, `PM`, `ON1`, `ON2`, `PN`, `OFF`, `GOFF`, `AL`, `HKA`, `GHKA`, `COURSE`, `COURT`, `MC`, `EL`, and `OH`. Public flags are true for `AM`, `PM`, `ON1`, `OFF`, `AL`, `HKA`, `GHKA`, `COURSE`, and `COURT`; they are false for `ON2`, `PN`, `GOFF`, `MC`, `EL`, and `OH`. `ON1` belongs to a custom `ON 1` limit group; `OFF`, `AL`, `HKA`, `GHKA`, `COURSE`, and `COURT` belong to `LEAVES`. The two returned limit groups are `LEAVES / Leaves & Offs / 3` and `ON 1 / 1`.

Against the approved initial semantic map, the explicit unmapped values are:

- `COURT`, which is configured and occurs five times;
- `EP_OFFICE_HOUR`, which occurs 155 times and is a dedicated EP roster column in the current UI (`src/components/RosterPage.jsx:767-793`); and
- `EP_ONCALL`, which occurs 153 times and is likewise handled as a dedicated EP column (`src/components/RosterPage.jsx:767-793`).

Modifiers are materially present on both worked and reset-status codes. The semantic resolver and migration fixtures must cover `AMX` versus `AM (X)`, `PMX` versus `PM (X)`, and `(S)` on `OFF`, `GOFF`, `HKA`, `GHKA`, and `COURSE`; these are not hypothetical edge cases. Legacy request values are: AM 702, OFF 649, AL 509, ON 319, COURSE 144, GHKA 143, PM 123, ON1 117, HKA 60, GOFF 32, ON2 4, PN 2, and EL 1. The current roster uses `ON1`/`ON2` and contains no returned `ON`, `N`, or `NIGHT` rows.

### Duplicates and multiple assignments

- Exact case-normalized person/date/shift duplicate groups: **0**.
- Person/date groups with more than one roster row: **58**.
- Of these, 56 are `EP_OFFICE_HOUR + EP_ONCALL` pairs and appear consistent with the current EP dual-column model.
- Two are non-EP multiple assignments requiring explicit review: Najmi has `AM + PM` on the local date 2026-07-28, and Adli has `AM + PN` on the local date 2026-07-29. The raw UTC values are respectively `2026-07-27T16:00:00.000Z` and `2026-07-28T16:00:00.000Z`.

The response therefore validates the requirement that v2 assignments support more than one assignment per person/date, while also confirming that domain-aware distinction between an intentional double duty and a conflict is mandatory.

### People, aliases, and activity state

- MO directory: 12 active display names—Adi, Azrul, Afiq, Muaz, Syuhada, Najmi, Aiman, Shafa, Asyraaf, Adli, Iema, and Syifa—and one inactive name, Afif. All 13 returned records have `staffId` and `email` values.
- EP directory: Iskasymar, Luqman, Hafizah, Hayati, Syakirah, and Suhaimi; all six are active, and none has a returned `staffId` or `email` value.
- The roster contains both `Syuhada` and `SYUHADA`. The Settings memos use `SYU`, corroborating the repository's hard-coded `SYU → SYUHADA` compatibility alias (`src/utils/adapters.js:14-18`).
- Eleven returned roster name strings do not exactly match a returned directory display name under the current trim/lowercase comparison. All are title/case variants of EP names, such as `DR HAFIZAH` and `Dr. Hafizah`; this is evidence for explicit stable-person alias mapping, not proof of 11 distinct people.
- Request states: 1,870 Active, 661 Cancelled, and 274 Old Request. Approval status is blank on 1,761 legacy rows and Pending Admin on 1,044; request type is blank on 1,761, Leave on 961, and AdminComment on 83.
- Activity states: 11 Archived and one Active; five rows are `Swap`, and seven have blank request type.

### Settings, PH/GHKA, and supporting datasets

- Settings values include `monthly_request_limit=15`, `monthly_weekend_limit=2`, and `weekend_limit_group_id=LEAVES`.
- `phTrackerOpeningBalances` is valid JSON with 11 person-keyed objects. Each object has `doctorName`, `openingBalance`, `note`, and `updatedAt`; all notes are blank. Returned balances total 24: Adi 1, Azrul 2, Afiq 1, Syuhada 4, Muaz 1, Najmi 2, Asyraaf 1, Adli 1, Shafa 3, Iema 1, and Aiman 7. Active Syifa has no returned entry; inactive Afif has none.
- These are existing PH/GHKA tracker opening balances. They are not evidence for, and must not be imported as, the future GOFF ledger opening balances without separate administrator confirmation.
- `phTrackerMemos` is valid JSON with 82 person/date keys and Boolean values. Separate `memo_2026-07`, `memo_2026-08`, and `memo_2026-09` text values exist and contain legacy operational GOFF notes. These structures remain Settings JSON, not a transaction ledger.
- `PublicHolidays` returns one active row: 2026-09-01, `Cuti Peristiwa Khas (SUKMA)`.
- `LeaveApplications` returns two rows: one AL and one MC; one Pending and one Submitted.
- All 12 `ShiftBlocks` target `LEAVES`; 11 have `MaxSlots=2` and one has `MaxSlots=1`.

### Compatibility conclusion

The test deployment **appears compatible with the repository's modern frontend response baseline**:

- all expected top-level keys and all required dataset fields are present;
- the returned field casing matches the frontend adapters;
- Settings JSON parses successfully;
- date values are in forms the existing frontend currently consumes; and
- the response is byte-stable across repeated GETs.

Compatibility is qualified, not complete. The blank Requests header/value is an extra live shape; several real shift codes require semantic mapping; person aliases require stable-ID resolution; and multi-assignment rows cannot be flattened or deduplicated generically. The endpoint exposes neither backend source/version identity nor workbook metadata, so it cannot prove that the deployed script equals `appscript.txt` or that formulas/protections/triggers/properties/timezones are safe.

## Phase 0 continuation — 2026-09-07

### Scope, evidence search and baseline comparison

The current user authorization permits local anonymized evidence fixtures and documentation only, accepts incidental effects of the approved copied-test GET path, and prohibits production access and deliberate remote writes. No Phase 1–9 work was started.

- Local review timestamp (UTC): `2026-09-07T01:45:48.554Z`; local calendar date: 2026-09-07, Asia/Kuala_Lumpur.
- Git remains on `main` at `a852f0ace8966c8fcbce88166e4dfc3081f5476c`. There are no tracked differences from that baseline and the index is empty. At entry the two governing documents and this readiness report were the only untracked files. Relative to the original recorded entry state, the readiness report has been added; all three are preserved. No older frozen bytes for the two untracked governing documents are available for a historical text diff.
- Repository-scoped file enumeration included hidden and ignored evidence candidates, excluding Git internals, dependency/build outputs and bundled skill contents. No applicable `AGENTS.md` was found in the repository (including docs descendants) or its ancestor chain. No unrelated personal directory was searched.
- No new workbook export, copied-workbook link/identity record, deployment source/version export, Apps Script manifest, metadata screenshots, backup manifest or restore result was found. Existing images are application icons/logo; the DOCX is the existing GHKA memo template. Ignored environment files, temporary CSS files and a package backup are not workbook/deployment attestations; secret values were not printed or copied. No user file attachment is available in this conversation.
- The previous API response itself is not retained in this repository. Its recorded observations/hash are secondary evidence reused here, not a newly parsed or independently rehashed response. Repeating `alldata` would not close the missing metadata or intent gates, so no repeat was necessary.

| Re-fingerprinted local source | SHA-256 before this continuation |
| --- | --- |
| `appscript.txt` (47,260 bytes; unchanged Git object `b9601899509b276742f516dc237d00af40a8b026`) | `82554B83BDE2E9D111C2A3749F9C1E6C1B750AC11138B18F7BE18982BB045538` |
| `MAJOR_UPDATE_SPEC.md` | `D0F435E3AB678671E7F3E99BA40A6309EE301C5BF1106B8D44048CD5C90B523A` |
| `MAJOR_UPDATE_IMPLEMENTATION_PLAN.md` | `84CCEE48AA69349C1823B2D745B933BA92D7FFF6C3A91A00429586DFA2627AD0` |
| This report before update | `AD100127A52F5D557630B88299A277A588FF1B10E137DE195181047AD5E5AF43` |

The two governing documents remain byte-for-byte unchanged: no verified factual correction requiring an edit was identified. Their approved requirements remain intact. `docs/phase-0-evidence/evidence-manifest.json` records these input hashes, relevant source-file hashes, final report/fixture hashes, sizes, collection timestamp, and explicit missing evidence. This is a **local evidence manifest, not a workbook backup or proof of restorability**. It deliberately excludes its own hash to avoid a circular digest.

### Metadata findings and limits

| Required evidence | Established now | Still required |
| --- | --- | --- |
| Copy identity, provenance, timestamp | User attests that the supplied deployment is intended to target a copied test workbook. The endpoint ID identifies a deployment, not its bound spreadsheet. | Copy spreadsheet ID/read-only URL, binding evidence, source-baseline provenance and copy timestamp with timezone. Source identity may be an owner-attested identifier; no production access is needed. |
| Physical workbook inventory | Only the prior 11 API datasets and source-derived contracts are available. Directory getters deduplicate rows before return. | Physical tabs/order/IDs, exact headers/used ranges/types, formulas and errors, formatting/date formats, validations, named ranges, protections, hidden tabs/rows/columns, filters/filter views, frozen and merged ranges; export omissions covered by metadata/screenshots. |
| Timezones | Recorded raw timestamps remain consistent with UTC+08; source calls `Session.getScriptTimeZone()` at `appscript.txt:1025`. | Spreadsheet timezone, Apps Script project timezone and intended operational timezone. No setting value is established by that function call or by `alldata`. |
| Deployed immutable source | Local source hash still matches the frozen baseline. | Deployment version number/update time plus that version's source and manifest, tied to the approved test deployment; raw source checksum and any explained text-normalized comparison with `appscript.txt`. A current editor export alone does not prove deployed-version contents. |
| Script properties | No `PropertiesService`, `getProperty`, `getProperties` or `setProperty` reference occurs in local `appscript.txt`. Returned `Settings` keys are sheet data, not script properties. | Owner-supplied property names and purposes with all secret values replaced by `[REDACTED]`, or explicit evidence of an empty inventory. Local absence of references does not establish an empty deployed store. |
| Triggers, execution/access | Local web handlers `doGet`/`doPost` exist (lines 22/61); no `ScriptApp`/`newTrigger` or conventional `onOpen`/`onEdit`/`onInstall`/`onFormSubmit`/`onChange` function occurs in that file. | Deployed project files and trigger inventory: handler, event source/type, schedule/timezone, owner, enabled state; execution identity/access audience and deployment settings. A successful historical GET does not prove either audience or executing identity. |
| Backup and restore | No workbook backup/checksum package or completed restore evidence is present. Existing plans describe a future procedure only. | Backup owner/location/capture time, complete file and per-tab checksum/count manifest, and existing dated restore result identifying isolated destination, operator, comparisons and reviewer. If no completed drill exists, record that gap; a new drill requires separate authorization. |

### Concrete preservation and issue-disposition proposals

All proposals below are evidence-review decisions only. They authorize no source-data rewrite. Status **confirmed** refers to existing approved product requirements or the current user's preservation instruction; it does not imply a signed workbook inventory.

| Issue | Evidence and proposed disposition | Status / exact remaining decision |
| --- | --- | --- |
| P0-REQ-01: blank Requests field | Recorded 12th distinct JSON key is blank; one value is `12.0833333333333`. `getRequestsData` reads the physical data range, walks headers in order and assigns `record[header]` (`appscript.txt:162-183`); `ensureHeaders` may append missing names (1146–1161). **L (12) is only a conditional candidate**, if the deployed source matches and the 11 required headers occupy A:K without intervening/duplicate headers. Duplicate blank/name keys can collapse, so API key position cannot verify a physical column or row. Preserve the entire unknown column and numeric value; no unit, formula, duration, balance or deletion is inferred. | **Open evidence + purpose.** Supply Requests header row with physical column letters, affected cell address, formula-bar/value/number-format evidence and owner-described purpose/dependencies. Column, row and purpose remain unverified. |
| P0-CODE-01: `COURT` (5 rows) | The prior inventory places this request type in `LEAVES`. That grouping and current aggregate leave tally are not an authoritative work/coverage classification. Preserve raw code; proposed unresolved semantic record keeps worked, staffing bucket, Policy B, consecutive behavior, OFF-displacement and bundle rules explicitly unknown. | **Owner decision required:** define those properties and duty meaning; do not infer that COURT is leave or worked duty. |
| P0-CODE-02/03: EP codes (155 office-hour; 153 on-call rows) | Source provides separate EP columns and export fields (`RosterPage.jsx:767-793`, 2184–2185). Propose duty domain EP with distinct canonical codes identical to the raw values. Do not equate office-hour to MO `AM`/`OH`, or on-call to `ON1`/`NIGHT`. Both codes retain unknown semantic properties pending confirmation. | **Owner decision required:** worked/consecutive classification, coverage bucket/weight, Policy-B qualification, OFF-displacement eligibility, night/recovery rules and whether/how weekly OFF/GOFF applies to EPs. Column labels alone settle none of these. |
| P0-MOD-01: standby/extended | Preserve all 11 observed modified spellings. Propose `AMX` and `AM (X)` → base AM + extended, `PMX` and `PM (X)` → base PM + extended, preserving original spelling. `AM/PM/OFF/GOFF/HKA/GHKA/COURSE (S)` retain standby separately. Source parser supports these forms (`RosterPage.jsx:210-246`); spec §§3/11.1 mandates inheritance of base semantics. Standby on OFF does not itself become worked duty. | **Confirmed preservation/inheritance requirement; proposed representation.** No new permission is needed. Source validity remains visible for inventory review; do not strip or rewrite modifiers. Hyphen forms are repository-supported supplements, not claimed as observed roster values. |
| P0-MULTI-01: Najmi | Recorded `AM + PM`, UTC `2026-07-27T16:00:00.000Z` → provisional +08 date **2026-07-28**. Preserve both assignment rows and distinct identities in a future model; do not flatten to last-row-wins or collapse to one shift. Source concatenates roster rows but analytics overwrites its person/date slot, as already documented. | **Open intent:** owner must identify intentional double duty versus error and provide the intended disposition. No inference of intent, worked-day total, timing or GOFF entitlement is made. |
| P0-MULTI-02: Adli | Recorded `AM + PN`, UTC `2026-07-28T16:00:00.000Z` → provisional +08 date **2026-07-29**. Preserve both; flag work plus recovery for review. Approved future PN semantics are non-worked/non-staffing/transparent, Policy-B qualifying, and OFF-displacement eligible only under the specified rule. Adjacent source rows/times are unavailable, so recovery adequacy or an intentional exception cannot be established. | **Open intent:** owner identifies intended assignment(s) or documented exception. No automatic deletion, replacement, inferred prior night or historical recalculation. |
| P0-MULTI-03: 56 EP pairs | The prior inventory records 56 same-person/date office-hour + on-call pairs and zero exact normalized person/date/shift duplicate groups. The dual-column model supports preserving the pair structure. Retain all **56 pairs / 112 assignments**; the fixture contains only one synthetic structural example. | **Confirmed preservation instruction.** No deduplication unless later evidence establishes a specific error; this is not a claim that every pair's operational intent was verified. |
| P0-PH-01: PH/GHKA separation | Existing `phTrackerOpeningBalances` (11 entries, total 24) and memo structures remain PH/GHKA data. Historical GOFF labels/notes do not establish future GOFF opening credits. The fixture uses a synthetic PH balance and a null future GOFF balance, not zero. | **Confirmed requirement.** No copying/relabeling of balances or historical GOFF inference. Commencement and confirmed GOFF balances remain later enablement inputs, not additional Phase 0 product decisions. |

### Proposed stable-person crosswalk (no source rewriting)

Use an immutable future ID per verified person, preserve each exact source display name as historical text, and retain directory domain. The references below are review labels only, not assigned product IDs. No mapping uses contact details or staff identifiers.

| Review reference | Directory target | Exact alias evidence currently available | Proposal / limit |
| --- | --- | --- | --- |
| P0-PER-MO-01 | Syuhada (MO) | `Syuhada`, `SYUHADA` in roster; `SYU` in Settings; explicit `SYU → SYUHADA` in `src/utils/adapters.js:14-18`. | Propose one person and three preserved aliases. Existing compatibility mapping is verified; stable-person crosswalk still needs owner review and physical-directory collision checks. |
| P0-PER-EP-01 | Iskasymar (EP) | Directory display name recorded. | Reserve one candidate person; exact title variants not enumerated in retained evidence. |
| P0-PER-EP-02 | Luqman (EP) | Directory display name recorded. | Same limitation. |
| P0-PER-EP-03 | Hafizah (EP) | `DR HAFIZAH`, `Dr. Hafizah` are the two explicitly recorded title examples. | Propose both aliases plus directory display name for one person, pending collision/owner check. |
| P0-PER-EP-04 | Hayati (EP) | Directory display name recorded. | Exact title variants still required. |
| P0-PER-EP-05 | Syakirah (EP) | Directory display name recorded. | Exact title variants still required. |
| P0-PER-EP-06 | Suhaimi (EP) | Directory display name recorded. | Exact title variants still required. |

The prior report counts **11 unmatched roster strings** but retains only two exact examples. The other nine strings must come from the supplied copy/export before this can be a complete signed crosswalk. Do not manufacture title variants, merge solely by removing titles, derive identity from blank EP staff IDs/emails, or collapse different directory domains. Preserve inactive historical people. Physical-directory deduplication/collision checks remain necessary because API directory getters already deduplicate.

### Fixture coverage and validation

Created `docs/phase-0-evidence/representative-cases.json`: **10 cases**, containing synthetic people/IDs/dates only, no contact details, staff identifiers, notes or other personal fields. Cases cover AM+PM, AM+PN with approved PN target properties, an EP pair, title/case/abbreviation aliases, all 11 observed modifier spellings, the three observed unmapped codes, explicitly supplemental legacy-night/hyphen/unknown examples, UTC+08 month-boundary conversion, separate PH/GHKA and future GOFF balances, and the nonpersonal blank-field anomaly. Raw code spellings and the anomalous numeric value are retained because they are the evidence under review.

Observed shapes are distinguished from synthetic supplements. No synthetic person is mapped back to an actual person. The fixtures reconstruct the recorded structural cases; they are not complete legacy months or extracts that prove source row locations. Local JSON parsing, synthetic ID uniqueness/references, two-row preservation for all three multiple-assignment examples, modifier coverage, unresolved mapping fields, PH/GOFF separation and boundary conversions were checked. No domain resolver, API integration, migration or restore was run. Existing application tests/build results above remain dated 2026-09-04 and were not rerun for this documentation-only continuation.

### Remote requests, side effects and sign-off

**Additional endpoint requests: 0.** No remote workbook or deployment was opened. No new test-workbook side effect was observed or caused by this continuation. The 2026-09-04 record of three identical responses, 11 Archived activity rows and possible first-call initialization/archiving remains unchanged; without a before-snapshot it still cannot establish which changes those GETs caused.

Owner/reviewer, inventory approval date, operational dispositions, deployment reconciliation approval, backup/restore acceptance and overall Phase 0 sign-off are **not supplied**. The user's endpoint-copy attestation and fixture authorization do not substitute for those approvals. The fixture-existence gate is now met; all other incomplete gates below remain open.

### Consolidated closure handoff

Supply one repository evidence package containing: **(1)** the read-only copied workbook/full export with copy ID/binding, provenance/copy time, physical metadata and the blank Requests cell/purpose; **(2)** immutable test deployment version/source/manifest, both timezone settings, redacted property-name/purpose inventory, triggers and execution/access settings; **(3)** complete backup/checksum manifest and existing dated restore/comparison evidence (or explicit missing-drill status); **(4)** owner decisions for COURT and both EP semantics, Najmi/Adli's intended assignments, the exact 11 EP alias strings and approved crosswalk, authoritative staffing thresholds and named migration/rollback/review owners, followed by dated inventory/fixture/Phase 0 sign-off. No production read or new restore action is requested. The fixture and manifest files already exist; do not request permission to recreate them.

## Current architecture

The application is a static React/Vite PWA hosted under `/REQUEST-APP/`. The browser calls a Google Apps Script web app, and the bound Google Sheet is the authoritative store. The backend URL comes from build-time `VITE_APPS_SCRIPT_URL`; `src/api.js` sends GET query actions and JSON POST bodies using `text/plain;charset=UTF-8` (`src/api.js:1-39`). The Vite base path, PWA registration, and service-worker path are repository-specific (`vite.config.js:4-6`; `src/main.jsx:7-17`; `public/sw.js:1-8`). GitHub Pages builds on pushes to `main` (`.github/workflows/deploy.yml:3-5`, `.github/workflows/deploy.yml:17-48`).

`src/App.jsx` is the client data orchestrator. It hydrates separate `resq_cache_*` values from `localStorage`, calls `alldata`, normalizes responses, replaces root state, writes the refreshed values back to cache, and repeats after one minute (`src/App.jsx:59-145`, `src/App.jsx:229-370`; `src/utils/cache.js:1-22`). `src/api.js` has one fetch wrapper but no timeout, cancellation, retry, operation ID, idempotency key, revision, or conflict protocol (`src/api.js:21-55`).

The current admin boundary is client-side selection/PIN/session state, not backend authorization (`src/App.jsx:125-135`; `docs/PROJECT_NOTES.md:14-16`). This is not adequate for the planned critical lifecycle and ledger actions.

The repository contains only the expected manual Apps Script source, not an Apps Script manifest, clasp project, deployment ID, immutable deployment version, or automated backend release verification. The documented process is manual (`README.md:100-111`; `docs/PROJECT_NOTES.md:16`). The deployed code/version therefore cannot be proven equal to `appscript.txt` from local evidence.

## Repository-derived Google Sheets contract

This is the contract implemented by `appscript.txt`, not proof of the live workbook's actual shape.

| Sheet | Expected headers in repository code | Current read/write behavior | Test-endpoint evidence |
| --- | --- | --- | --- |
| `Requests` | `ID`, `Timestamp`, `Name`, `Date`, `Day`, `Request`, `Status`, `Comment`, `ApprovalStatus`, `SwapPartner`, `RequestType` | GET creates a missing tab and can append missing headers. Submit/update append new versions using `Date.now()` IDs; prior active records become old/cancelled rather than being deleted (`appscript.txt:162-183`, `appscript.txt:384-548`, `appscript.txt:1146-1161`). | 2,805 rows; all expected fields plus one trailing blank field name containing one nonblank numeric value. |
| `TeamMembers` | `MemberName`, `FullName`, `Phone`, `Active`, `StaffId`, `Email` | Missing tab is created initially with four headers; GET adds any of all six missing headers. Rows are deduplicated case-insensitively on read. Update clears every body row and rewrites the supplied directory (`appscript.txt:202-295`, `appscript.txt:1370-1466`). | 13 returned normalized rows; six expected response fields. |
| `EmergencyPhysicians` | Same as `TeamMembers` | Same read migration, deduplication, and whole-body replacement behavior (`appscript.txt:190-202`, `appscript.txt:1370-1466`). | 6 returned normalized rows; six expected response fields. |
| `MasterRoster` | `Name`, `Date`, `Shift` | GET creates a missing tab. Upload clears **all** body rows across all dates, then writes exactly the submitted three-column rows; there is no lock or revision check (`appscript.txt:298-319`, `appscript.txt:551-569`). | 3,859 rows; exact expected fields. |
| `ShiftBlocks` | `ID`, `Date`, `ShiftType`, `MaxSlots` | GET creates a missing tab. Add appends a `Date.now()` ID; delete physically removes a matching row (`appscript.txt:322-343`, `appscript.txt:607-646`). | 12 rows; exact expected fields. |
| `ShiftTypes` | `ID`, `Name`, `IsPublic`, `GroupID` | GET creates and seeds defaults if missing. Add/update/delete mutate rows; reorder clears all body cells and rewrites them without a lock/revision (`appscript.txt:346-380`, `appscript.txt:649-764`). | 15 rows; exact expected fields. |
| `LimitGroups` | `ID`, `GroupName`, `DefaultLimit` | GET creates and seeds `LEAVES / Leaves & Offs / 3` if missing. Add/update/delete mutate rows without a lock/revision (`appscript.txt:767-868`). | 2 rows; exact expected fields. |
| `ActivityHistory` | `ID`, `Timestamp`, `CustomText`, `Name`, `RequestType`, `Request`, `SwapPartner`, `Date`, `ApprovalStatus`, `Comment`, `Status` | GET creates a missing tab, adds `Status`, and writes `Archived` to past-dated active rows. Add appends; delete is a status update, not a physical delete (`appscript.txt:1177-1310`). | 12 rows; exact expected fields; 11 Archived and 1 Active after inspection. |
| `Settings` | `Key`, `Value` | GET is intended to create/seed `monthly_request_limit=10`; however, if the tab is missing, it calls the creator but then dereferences the original null `sheet`, so the request can mutate and then fail. Existing-tab updates overwrite or append without a lock/revision (`appscript.txt:1313-1359`). | 8 returned keys; both PH tracker JSON values parse successfully. |
| `PublicHolidays` | `ID`, `Date`, `Name`, `Active` | GET creates the tab and ensures headers. Upsert/delete use a script lock; delete physically removes the row (`appscript.txt:886-983`). | 1 row; exact expected fields. |
| `LeaveApplications` | `ID`, `MemberName`, `LeaveType`, `StartDate`, `EndDate`, `Days`, `Status`, `SubmittedDate`, `ReferenceNo`, `Notes`, `UpdatedAt` | GET creates the tab and ensures headers. Upsert/delete use a script lock; delete physically removes the row (`appscript.txt:986-1105`). | 2 rows; exact expected fields. |

The repository proves 11 named tabs (`appscript.txt:1-11`), and the test endpoint returned the corresponding 11 datasets. The API now establishes returned field order, row counts, and row-level values for this copy. It does **not** expose physical tab order, extra unqueried tabs, cell formats, formulas, validations, merged/frozen/hidden ranges, named ranges, protections, filters, triggers, script properties, change history, or deployed source identity. Directory getters also deduplicate names before returning them, so their response cannot prove absence of duplicate physical rows (`appscript.txt:266-291`).

## Read and mutation flow inventory

### Reads

1. On mount, `App` calls `fetchAllData()` and schedules the next call one minute after completion (`src/App.jsx:229-370`).
2. `fetchAllData()` sends `GET?action=alldata` (`src/api.js:104-106`).
3. The Apps Script aggregates all 11 getters (`appscript.txt:142-155`). This is a read-shaped request with write side effects.
4. If the response is a legacy array, the frontend separately calls team, emergency-physician, roster, and block endpoints (`src/App.jsx:249-268`). Those getters can also create/migrate tabs.
5. Successful refresh replaces each root collection and most cache entries as a full snapshot (`src/App.jsx:288-346`).

The service worker intercepts GET requests, but only caches same-origin/basic responses in the main path; no evidence was found that it intentionally persists cross-origin Apps Script data (`public/sw.js:35-70`). Browser `localStorage`, rather than the service worker, is the explicit last-known data cache.

### Writes

- Requests use append-version/soft-status semantics, but `Date.now()` supplies IDs and no operation deduplication or backend lock is present (`appscript.txt:384-548`).
- Roster save is a destructive whole-sheet replacement (`appscript.txt:551-569`).
- Shift blocks, shift types, and limit groups use row mutation/deletion; shift-type reorder is whole-body clear/rewrite (`appscript.txt:607-868`).
- Activity writes append or mark status, while reads can independently archive rows (`appscript.txt:1177-1310`).
- Settings overwrite or append values without concurrency control (`appscript.txt:1336-1359`).
- Team and emergency-physician directories are whole-body clear/rewrite operations (`appscript.txt:1370-1466`).
- Only public-holiday and leave-application writes use `LockService` (`appscript.txt:918-983`, `appscript.txt:1050-1105`). No write action has a client operation ID, replay result, record/period revision, stale-write rejection, or audit envelope.

## Optimistic UI and concurrency assessment

| Flow | Current client behavior | Risk |
| --- | --- | --- |
| Request submit/update/delete/approval | Captures the entire requests array, mutates state, starts a detached async function, refreshes all data on success, and restores the captured array on failure (`src/App.jsx:414-542`). | A late failure can erase a newer local result. Callers cannot await authoritative completion. Temporary request IDs are unrelated to backend IDs. |
| Roster upload | Replaces the entire in-memory roster immediately, starts a detached write, reports success after the POST, waits a fixed 1.5 seconds, and then refreshes (`src/App.jsx:544-582`). `RosterPage.handleSave()` does not await it and exits edit mode immediately (`src/components/RosterPage.jsx:1710-1735`). | Highest current data-loss risk: stale/incomplete client state can become a global sheet replacement; no revision or conflict signal exists. |
| Shift blocks/types/limit groups | Applies local change, awaits backend, refreshes all data, and restores the whole captured collection on failure (`src/App.jsx:585-818`). | Awaiting is better, but whole-collection rollback and refresh remain vulnerable to overlapping changes and out-of-order responses. |
| Activity, setting, team, emergency-physician updates | Uses detached async writes and captured whole-object/array rollback; activity also waits a fixed 800 ms before refresh (`src/App.jsx:827-975`). | No durable pending/retry state; later confirmed changes may be overwritten locally. Directory writes also replace the backend body wholesale. |
| Public holidays and leave applications | Applies optimistic state, directly awaits backend, refreshes, restores captured collection and rethrows on failure (`src/App.jsx:977-1088`). | Better propagation to callers and backend locking, but rollback is still collection-wide and there is no revision/idempotency protocol. |

There is no durable outbox, per-entity pending state, retry queue, idempotency key, inverse patch, revision-aware merge, stale-response suppression, or conflict UI. The global `isSyncing`/`refreshError` state describes refresh, not individual writes (`src/App.jsx:123-135`, `src/App.jsx:347-353`). These findings support completing the planned mutation-safety phase before lifecycle/ledger work (`MAJOR_UPDATE_IMPLEMENTATION_PLAN.md:636-673`).

## `MasterRoster`, identity, duplicates, and inactive people

`MasterRoster` has no row ID, person ID, period ID, version, lifecycle state, operation ID, amendment link, or audit metadata. `validateMasterRoster()` merely retains rows that contain a `Shift`/`shift` property and maps one hard-coded alias, `SYU` to `SYUHADA`; it neither validates required name/date values nor detects duplicates (`src/utils/adapters.js:14-18`, `src/utils/adapters.js:71-85`).

Identity is primarily a trimmed, lower-cased display name (`src/utils/normalise.js:1-3`). Directory records can contain `StaffId` and `Email`, but frontend and backend deduplication use the name (`src/App.jsx:61-92`; `appscript.txt:266-291`, `appscript.txt:1421-1449`). Historical roster, requests, PH/GHKA, and leave relationships therefore remain vulnerable to renames, aliases, spelling drift, collisions, and missing directory rows.

Duplicate roster rows are interpreted inconsistently:

- `RosterPage` concatenates multiple shifts for the same normalized person/date (`src/components/RosterPage.jsx:610-634`).
- Shared analytics keeps only the last encountered shift for that person/date (`src/utils/rosterAnalytics.js:58-75`).
- Public-holiday and leave derivations iterate every roster row and can count duplicates independently (`src/utils/publicHolidayTracker.js:94-128`; `src/utils/leaveTracking.js:47-54`, `src/utils/leaveTracking.js:251-277`).

Inactive people are retained in directory data. Some analytics exclude inactive names from the comparison pool (`src/utils/rosterAnalytics.js:332-350`), while the roster daily tally still counts their active shifts but suppresses their non-active statuses (`src/components/RosterPage.jsx:1318-1397`). Historical attribution is name-based and no durable person-status snapshot exists. The copied-test API identified one inactive MO and multiple EP/title aliases, but its directory getter deduplicates before returning rows. The physical copy/export must therefore finish the duplicate and historical-link review before stable-ID migration rules are approved.

## Roster reconstruction and destructive-save boundary

The roster page has two materially different projections:

- The primary staffing grid keeps only AM-like, PM-like, and normalized night rows; unsupported statuses are excluded from that grid (`src/components/RosterPage.jsx:697-721`). Future approved/pending-admin requests can visually populate otherwise blank upcoming cells even though those rows are not in `MasterRoster` (`src/components/RosterPage.jsx:723-756`).
- The editable/table map loads all raw shift keys and can concatenate multiple rows for a person/date (`src/components/RosterPage.jsx:610-634`, `src/components/RosterPage.jsx:831-883`). Saving flattens the in-memory edit grid and calls the global replacement action (`src/components/RosterPage.jsx:1710-1735`; `appscript.txt:551-569`).

Consequently, a screen labelled around one month can drive replacement of the entire compatibility table. Any omitted historical row, stale cache, duplicate normalization difference, unsupported value, or concurrent writer can cause loss or reinterpretation. This confirms that a restorable workbook copy and row-level reconciliation are prerequisites, not optional precautions.

## Shift-code inventory and `PN` mismatch

### Codes evidenced in repository behavior

- Apps Script seeds: `AM`, `PM`, `ON`, `OFF`, `AL`, `HKA`, `GHKA`, `COURSE`, `MC`, `EL` (`appscript.txt:346-364`).
- Roster fallback additionally uses `NIGHT`; request-form fallback uses `ON` (`src/components/RosterPage.jsx:538-558`; `src/components/NewRequestForm.jsx:34`).
- Normalizers recognize night aliases `ON`, `ON1`, `ON2`, `N`, and `NIGHT` as `NIGHT` (`src/components/RosterPage.jsx:249-254`; `src/utils/rosterAnalytics.js:32-37`; `src/utils/leaveTracking.js:10-22`).
- Special codes referenced outside defaults include `PN`, `OH`, `AMX`, `PMX`, and `GOFF`. `GOFF` is present in display/export language but is not seeded as a shift type (`src/components/RosterPage.jsx:277-281`, `src/components/RosterPage.jsx:604`; `src/utils/rosterPdfExport.js:226-234`).
- Standby/extended suffixes `(S)`, `-S`, `(X)`, `-X`, and trailing `X` are parsed in roster code, but parser implementations are duplicated and not identical (`src/components/RosterPage.jsx:210-246`; `src/utils/rosterAnalytics.js:5-37`; `src/utils/publicHolidayTracker.js:57-70`).

The repository list above is now supplemented by the exact copied-test values and counts in **Approved test-endpoint inspection → Shift inventory**. Equivalence to the current production workbook and physical-cell formatting remains unverified; no production endpoint was queried.

### Confirmed semantic mismatch

The approved target semantics classify `PN` as Policy-B-qualifying, non-worked, non-staffing, transparent for consecutive work, and able to earn GOFF only when it displaces planned `OFF` (`MAJOR_UPDATE_SPEC.md:79-91`, `MAJOR_UPDATE_SPEC.md:397-408`; `MAJOR_UPDATE_IMPLEMENTATION_PLAN.md:291-296`). Current code instead:

- includes `PN` in active-shift sets for roster daily and member tallies (`src/components/RosterPage.jsx:1373-1393`, `src/components/RosterPage.jsx:1430-1489`);
- includes `PN` in monthly/YTD active, weekend, and public-holiday analytics (`src/utils/rosterAnalytics.js:396-450`, `src/utils/rosterAnalytics.js:573-628`);
- includes `PN` as active work in individual leave-derived tracking (`src/utils/leaveTracking.js:8-22`, `src/utils/leaveTracking.js:251-277`); and
- classifies `PN` as worked and public-holiday-credit earning (`src/utils/publicHolidayTracker.js:50-84`).

Other divergence supports the planned shared semantic resolver: public-holiday logic explicitly treats `AMX`/`PMX` as worked but omits `OH`, while generic roster/analytics parsing can reduce trailing-X forms to their base shift. These paths must be compatibility-tested rather than mechanically replaced. Historical raw `PN` and other codes must remain unchanged, and the new semantics must not retroactively recalculate historical tallies or generate GOFF (`MAJOR_UPDATE_SPEC.md:573-581`).

No current weekly-OFF policy engine, cross-month shared-week ownership, consecutive-work state machine, night-bundle validator, post-night-rest validator, or GOFF ledger was found. Existing “consecutive” processing joins adjacent leave dates, not consecutive duties (`MAJOR_UPDATE_SPEC.md:425-447`).

## Public holiday / HKA / GHKA boundary

Public holidays are built-in and can be overlaid by rows from `PublicHolidays` (`src/App.jsx:318-325`; `src/utils/holidays.js:50-84`). The tracker derives an earned credit for each roster row it classifies as worked on a configured holiday, derives `GHKA` usage from roster rows, combines optional opening-balance data, and FIFO-matches credits to usages (`src/utils/publicHolidayTracker.js:94-210`). It ignores roster months later than the current month, but is still a derived calculation rather than an append-only accounting ledger.

Opening balances and memo statuses are JSON values in `Settings`, with a localStorage fallback for opening balances. Editing updates local state/storage and calls the settings write path (`src/components/PublicHolidayTrackerPage.jsx:16-108`). This is not transactional with roster changes and has no ledger source uniqueness, revision, or audit record.

`HKA` is treated as official public-holiday off and does not earn a PH credit; `GHKA` is replacement public-holiday usage (`src/utils/publicHolidayTracker.js:70-84`, `src/utils/publicHolidayTracker.js:137-169`). The new `OFF`/`GOFF` entitlement is separate and must not reuse or merge PH/HKA/GHKA balances, records, terminology, or memo behavior (`MAJOR_UPDATE_SPEC.md:52-56`). The current PH logic counting `PN` as worked is a historical compatibility issue to isolate during the shared-semantics rollout, not evidence that GOFF and GHKA are interchangeable.

## Integrity and migration risks

| Priority | Verified risk | Required control before production use |
| --- | --- | --- |
| Critical | `MasterRoster` upload clears all body rows without a lock, scope, backup check, or revision (`appscript.txt:551-569`). | Restorable copy, copied-workbook rehearsal, period-scoped authoritative actions, lock, revision check, idempotency, checksum/reconciliation, and legacy-upload rejection for enrolled periods. |
| Critical | Backend critical writes have no durable authorization boundary; admin gating is client-side. | Backend authorization design and tests before publish/close/reopen, amendments, opening balances, or ledger actions. |
| Critical | No stable person/assignment/period identity and inconsistent duplicate interpretation. | Signed person-resolution map, stable IDs, duplicate/conflict report, and explicit historical/orphan handling. |
| High | Detached optimistic writes, whole-collection rollback, full refresh, and no stale-response suppression. | Ordered/durable write model, per-entity pending/error/retry, operation IDs, inverse patches, backend revisions, and conflict UI. |
| High | Current GETs mutate schema/data, so ordinary endpoint inspection is unsafe. | Read-only workbook export/copy and a future nonmutating metadata/version path. |
| High | Repository `appscript.txt` cannot be matched to the deployed web app. | Record deployment ID/version and compare deployed source/hash or a verifiable version response to the frozen repository hash. |
| High | `PN` and other code semantics differ across roster, analytics, PH, leave, and export paths. | One versioned resolver with legacy fixtures, unknown-code surfacing, and no historical reinterpretation. |
| High | Live formulas, protections, extra columns/tabs, data validation, and real data quality are unknown. | Complete workbook inventory and copied-workbook migration rehearsal before schema writes. |
| Medium | Date parsing uses browser-local `Date` behavior while Apps Script uses spreadsheet/script timezone in places (`src/utils/normalise.js:5-25`; `appscript.txt:1024-1035`). | Confirm spreadsheet, Apps Script, and operational timezone; add boundary fixtures before cross-month/week rules. |
| Medium | Local-only roster thresholds can differ by device (`src/components/RosterPage.jsx:400-432`). | Confirm authoritative staffing thresholds and move official validation configuration to versioned shared storage. |
| Medium | Missing `Settings` tab can be created and then cause an exception due to a stale null variable (`appscript.txt:1313-1318`). | Preserve as a known legacy defect; cover schema discovery/bootstrap in copy-only contract tests before any deployment. |

## Local validation results

| Check | Result | Evidence |
| --- | --- | --- |
| Existing unit/helper suite | **Pass** | `npm test`: adapters, cache, quota, holidays, and leave-tracking tests all passed. The script is defined at `package.json:10`. |
| Production build | **Pass with warnings** | `npm run build` completed under Vite 7.1.7 with 1,877 modules transformed. Warnings: stale Baseline/Browserslist data and an 857.41 kB minified JS chunk above the 500 kB advisory threshold. |
| Test deployment modern-contract read | **Pass with qualifications** | Three necessary GETs returned HTTP 200, the complete 11-key modern envelope, identical length, and identical SHA-256. Required fields match; the Requests dataset has one extra blank field name. |
| Backend contract tests | **Absent** | No tests exercise `appscript.txt`, action routing, sheet headers, locks, idempotency, revisions, or failure recovery (`docs/PROJECT_NOTES.md:18`, `docs/PROJECT_NOTES.md:34`). |
| Integration/browser/concurrency/accessibility/migration tests | **Absent** | Current tests are pure Node assertion utilities; no full request/roster lifecycle coverage exists (`README.md:77-84`; `docs/PROJECT_NOTES.md:18`). |
| Workbook rehearsal | **Not run** | The approved endpoint exposes copied test data, but no workbook URL/export, checksums, or restore procedure was supplied. No write rehearsal was authorized. |

No dependency refresh was performed in response to build warnings because dependency changes are outside Phase 0.

## Safe workbook availability and required handoff

### Availability

The user confirms that the approved test deployment targets a copied test workbook, and its row-level API data has now been inventoried. No copied-workbook URL or `.xlsx`, `.xls`, `.xlsm`, `.ods`, `.csv`, `.tsv`, `.gsheet`, or archive was supplied or found in the repository. The API cannot expose the workbook metadata needed for schema safety or prove restorability. Physical-workbook inventory status: **Awaiting copied-workbook URL/export and metadata evidence**.

### Preferred safe evidence package

Provide read-only access to the already approved **copied test workbook**, or export that copy to `.xlsx` and place it in a clearly named evidence directory in this repository. The evidence must preserve all tabs, formulas, formatting, validations, named ranges, hidden content, and protections as far as Google Sheets supports. Do not expose a write-capable production URL.

Alongside the copy/export, provide a small deployment evidence note containing:

1. copied workbook spreadsheet timezone and Apps Script project timezone, plus confirmation that they match the intended production operational timezone;
2. test Apps Script deployment ID, immutable version number, deployment/update timestamp, and executing account/access mode;
3. a source export or verified source hash for the deployed version so it can be compared with repository SHA-256 `82554B83BDE2E9D111C2A3749F9C1E6C1B750AC11138B18F7BE18982BB045538`;
4. confirmation that the copied workbook is based on the intended production baseline, when it was copied, and that a separate source backup is restorable, including owner/location and restore procedure;
5. the evidence owner/reviewer and sign-off date.

If read-only access to the copy cannot be supplied, export the whole copied workbook as `.xlsx`. CSV alone is insufficient because it loses the multi-tab workbook contract, formulas, protections, and much metadata. If CSV is the only possible format, export **every tab separately using its exact tab name**, plus screenshots/notes covering formulas, validations, named/protected ranges, hidden tabs/rows/columns, filters, frozen ranges, and tab order.

### Inventory to run on the safe copy/export

For every tab, capture:

- exact tab name, order, hidden state, used range, last row/column, and nonblank row count;
- exact header text/order, duplicate/blank headers, inferred value types, date serial/display formats, formulas, array formulas, and error values;
- protected sheets/ranges and owner/editor permissions; named ranges; filters/filter views; data validations; frozen/merged cells; hidden rows/columns;
- duplicate primary candidates and exact duplicate rows;
- blank/malformed IDs, duplicate IDs, non-integer/unsafe timestamp IDs, and cross-tab orphan references;
- for `MasterRoster`: min/max dates, rows by month, duplicate person/date/shift, conflicting person/date assignments, missing name/date/shift, all distinct raw shift values with counts, suffix variants, unknown codes, and names not resolvable to a directory row;
- for directories: case/space/alias duplicates, duplicate/missing `StaffId` and email, inactive people with historical/future records, and names referenced elsewhere but absent from both directories;
- for requests/activities/leave/PH/settings: status/code distributions, malformed dates, duplicate business keys, JSON parseability, and historical coverage;
- whether old months are present in `MasterRoster`, which is essential because the current uploader replaces the entire sheet;
- a checksum/count manifest sufficient to prove that a copied-workbook rehearsal did not alter source evidence.

The inventory must be reviewed and signed before any migration/schema action. Unknown or extra fields must be preserved and surfaced; they must not be silently dropped.

## Evidence still required

- Read-only copied-workbook URL or full export, its copy/provenance timestamp, and restorable-backup confirmation.
- Signed physical tab/header/type/formula/protection/data-validation/hidden-range inventory and checksum manifest.
- Manual resolution of the trailing blank Requests header/value.
- Owner classification for `COURT`, `EP_OFFICE_HOUR`, and `EP_ONCALL`; review the preservation proposals below. Modifier inheritance is already an approved product requirement and is not being reopened.
- Reviewed disposition of the two non-EP multiple assignments and stable-person alias mapping for EP title variants and `SYU`/`SYUHADA`.
- Spreadsheet and Apps Script project timezone values; response timestamps only support an inference of UTC+08.
- Test deployment immutable version/source confirmation and comparison with repository `appscript.txt` SHA-256.
- Apps Script script-property inventory and installable/simple trigger inventory.
- Owner-supplied execution/access metadata and backend authorization owner; no direct production inspection is authorized.
- Authoritative staffing thresholds to replace device-local values.
- Operational owners/approvers for migration, rollback, and Phase 0 sign-off.

## Phase 0 exit gates

| Exit condition | Status | Decision |
| --- | --- | --- |
| Repository evidence frozen and inspected | **Met** | Commit, branch, Apps Script hashes, architecture, contracts, flows, semantics, and tests are recorded above. |
| No production mutation during assessment | **Met** | No production endpoint or workbook was accessed. The three approved copied-test GETs occurred on 2026-09-04; zero additional remote calls occurred on 2026-09-07. |
| Safe/restorable workbook copy exists | **Partially met** | User confirms the endpoint targets a copy, but its URL/export, provenance, checksum, separate restorable backup, and restore test are not evidenced. |
| Signed data/schema inventory complete | **Partially met** | API fields, row counts, date representations, codes, directory status, Settings structures, and duplicates are inventoried. Physical workbook metadata and reviewer sign-off remain missing. |
| Deployed Apps Script version reconciled to repository source | **Not met** | The response contract is compatible, but the immutable deployed source/version is not exposed. |
| Operational timezone confirmed | **Not met** | API dates are consistent with UTC+08 local midnights, but spreadsheet and Apps Script project settings were not supplied. |
| No unresolved assumption capable of altering existing rows | **Not met** | Blank-header data, unknown semantic codes, multi-assignment disposition, physical workbook metadata, backup/restore, and deployed-code drift remain unresolved. |
| Representative anonymized/copy-based migration fixtures exist | **Met (existence only)** | Ten minimal synthetic cases now exist in `docs/phase-0-evidence/representative-cases.json` under the current explicit authorization. JSON structure, preservation assertions and date conversions were checked locally. These are not full-month exports or an executed migration rehearsal; reviewer sign-off remains part of the signed-inventory gate. |

**Overall Phase 0 exit gate: OPEN / NOT PASSED.** The available local evidence work is complete. Workbook/deployment evidence and owner decisions/sign-off remain required; production access and restore operations are not authorized.

### Shortest checklist to close Phase 0

1. Supply a read-only link or full export of the copied test workbook, its copy timestamp/source provenance, a checksum manifest, and evidence that the separate source backup can be restored.
2. Supply screenshots/exports for tab order, exact physical headers, formulas, validations, named/protected/hidden ranges, filters, and resolve the blank Requests header/value.
3. Supply spreadsheet timezone, Apps Script project timezone, immutable test deployment version/source, script properties, and trigger inventory; reconcile deployed source to the frozen repository hash.
4. Complete and sign the proposed mapping/dispositions for the three unmapped codes, two non-EP assignment sets and exact EP/`SYU` aliases; preserve all 56 EP pairs and raw modifiers.
5. Review the ten created synthetic fixtures and sign the completed physical inventory, issue dispositions, source reconciliation and existing restore evidence. No further permission to create these local fixtures is needed.

## Phase 1 prerequisites

Phase 1 may start only after all unmet Phase 0 gates above are closed and signed. Its input package must include:

1. the immutable repository baseline and deployed Apps Script comparison;
2. restorable workbook copy plus checksum/count manifest;
3. approved tab/header preservation map, including extra columns/formulas/protections;
4. stable-person mapping and explicit duplicate/orphan decisions;
5. approved real-code semantic mapping, with unknown-code handling and special `PN` behavior;
6. confirmed timezones and authoritative staffing thresholds;
7. a copy-only rehearsal protocol and rollback owner;
8. contract fixtures for legacy reads/writes, `MasterRoster` compatibility projection, PH/GHKA preservation, and Settings JSON.

No Phase 1 source, schema discovery endpoint, semantic resolver, new sheet, config, dependency, Apps Script change, or feature flag was implemented in this assessment.

## Next task scope

The next task should remain **Phase 0 evidence completion**, not Phase 1 implementation:

1. receive and fingerprint the copied-workbook URL/export and deployment evidence;
2. finish only the metadata portions of the read-only inventory that the endpoint cannot expose;
3. resolve the blank Requests header, three unmapped codes, two non-EP multi-assignments, and person aliases;
4. record signed migration decisions, backup provenance, and the restore test result;
5. update only this readiness report with final evidence and gate outcomes;
6. begin Phase 1 in a separate task only if every Phase 0 exit condition is met.
