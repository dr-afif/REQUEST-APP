# Phase 1 — Compatibility Foundation and Feature Switches

**Status: PASS for the local Phase 1 implementation. No deployment, remote schema change or Phase 2 work.**

Phase 0 was closed and approved by the application owner on 2026-09-07. The current closure record is in `MAJOR_UPDATE_PHASE_0_READINESS.md`; the earlier open assessment is archived without alteration. The owner-supplied evidence and decisions are authoritative for this implementation; production was not queried to reconfirm them.

## Architecture and source ownership

`src/features/roster/compatibility.js` is the sole pure semantic/identity/projection contract. `scripts/build-appscript.mjs` embeds that exact module, without its ES-module export, together with `backend/roster-v2.gs` into the marked generated block in `appscript.txt`. Run `npm run build:appscript` after changing either source. `npm test` rejects a stale bundle. There is no second handwritten Apps Script semantic resolver.

`src/features/roster/shadow.js` supplies opt-in frontend shadow comparison and Web Crypto SHA-256 snapshots. `src/api.js` adds two explicit diagnostic calls. The existing UI, cache, one-minute refresh, tally/analytics and PH/GHKA paths are not switched to new semantics. This preserves historical behavior while the v2 foundation is disabled. There is no automatic diagnostic fetch or new interface.

## Read contracts

| GET action | Parameters | Contract |
| --- | --- | --- |
| `rosterv2schema` | None | Schema 2 / foundation 1 / semantic rule 1; capability flags, default/configured/effective features, additive schema inspection plan, bundled catalog and approved staffing defaults. |
| `rosterv2period` | `period=YYYY-MM&mode=shadow` | Read-only `LEGACY_SHADOW` projection; period enrollment status, separate assignment occurrences, registered or unresolved identities, raw `Name/Date/Shift`, semantic properties, unplaced invalid-date rows, SHA-256 and exact reconciliation. |

These paths use direct nonmutating table reads, not legacy getters. Missing tabs return an empty shadow/inspection proposal; no tab/header/default is written and no activity row is archived. Shadow diagnostics remain explicitly available with all switches OFF, but cannot be mistaken for an official planned snapshot. An enrolled month is identified as `ENROLLED`; its Phase 1 response remains a legacy compatibility shadow, not a lifecycle implementation. Invalid dates remain in `unplaced`, not silently discarded. Frontend comparison is complete only when both local input and server projection have no unplaced dates; it reports `localUnplacedCount` separately from the server `unplacedCount`. Physical source-row numbers retain intervening blank rows. Source-row keys are snapshot-local references, never presented as durable assignment IDs.

Only a fixed public whitelist is returned: roster `Name/Date/Shift` and identity display/domain/active information. No raw Requests/LeaveApplications notes, contacts, arbitrary extra roster columns, Settings JSON or script-property values enter the new public responses. Private/unknown `rosterv2*` reads cannot fall through to the default legacy Requests endpoint. All `rosterv2*` POSTs fail closed after authorization; none performs an official operation.

## Additive schema contracts

| Table | Headers |
| --- | --- |
| `RosterPeople` | `PersonId`, `DirectoryType`, `CurrentDisplayName`, `LegacyNamesJson`, `Active`, `CreatedAt`, `UpdatedAt` |
| `RosterPeriods` | `PeriodId`, `SchemaVersion`, `EnrolledAt`, `EnrolledBy` |
| `ShiftSemantics` | `ShiftCode`, `RuleVersion`, `DirectoryType`, `CountsAsWorked`, `ConsecutiveBehavior`, `StaffingBucket`, `PolicyBQualifier`, `NormalOff`, `CanDisplaceOffEarnGoff`, `ExpectedPredecessorsJson`, `ExpectedFollowersJson` |

These are the minimum Phase 1 foundation headers, intentionally omitting lifecycle state/revisions, OperationLog, events and ledger columns until their phases. Schema discovery returns inspect/propose operations with `apply: false`. The internal `rosterV2CatalogRows_` supplies ordered rule-1 catalog rows for a future authorized copy-only setup. No setup/rename/enrollment write endpoint exists in Phase 1, and deploying this file does not create these tables. Later setup must be deliberate, preserve unknown existing columns and use the same script lock as the legacy upload guard.

Stable IDs are caller-supplied durable `PersonId` values, independent of names. Pure `createPerson` and `renamePerson` helpers retain aliases and identity across renames without writing. Registered alias conflicts fail explicitly. Without a registered row, reads expose `personId: null` and a clearly labeled deterministic `legacyPersonKey`; they do not invent a durable registration. Directory membership/active state may inform display, but an orphan such as the historical cancelled Amir request stays historical and inactive and is never inserted as current staff. Distinct MO/EP identities cannot merge; ambiguous cross-domain names are surfaced. The shared resolver, projection and day classifier all retain an explicit UNKNOWN domain with unknown MO work/coverage/entitlement properties until resolved. An explicit EP assignment code still establishes EP semantics.

All Syuhada aliases approved by the owner resolve together. EP-only `DR ` / `Dr. ` prefix removal and case folding resolve the same EP name; unrelated similar names remain separate. Raw names and separate assignment rows survive projection. Multiple Active requests and duplicate stress fixtures load without a new legacy uniqueness constraint. Structured leave dates and conflicting free-text notes remain untouched.

## Defaults and semantic decisions

All eight new switches default OFF: `roster_v2_read_enabled`, `roster_v2_write_enabled`, `shift_semantics_v2_enabled`, `weekly_off_guidance_enabled`, `night_safety_guidance_enabled`, `goff_ledger_enabled`, `write_queue_v2_enabled`, `roster_workspace_v2_enabled`. They may be discovered from existing Settings rows, but effective workflow flags remain OFF for Phase 1 even if someone manually enters `true`. No seeding occurs. Only Boolean true or exact text `true` is recognized as configured true; truthy strings such as `false` do not enable anything.

`legacy_upload_enabled` is a separate compatibility permission, not a new-v2 enablement switch: absent means retain the old upload behavior, exact text `false` disables it. No default row is created. Enrollment protection is unconditional and never bypassed by this value or any feature switch. GOFF commencement/opening status and the historical read-only cutoff remain unset rollout inputs. The existing unauthenticated Settings action cannot set reserved v2/configuration keys; those attempts are denied even for an authenticated administrator in Phase 1.

| Assignment | Worked calendar day | ED/MO coverage | Consecutive behavior | Policy B planned-night candidate | Can displace OFF |
| --- | --- | --- | --- | --- | --- |
| AM / PM / extended variants | Yes | AM / PM | Increment once per calendar day | No | Yes |
| OH | Yes | Separate OH bucket, not automatically AM or PM | Increment | No | Yes |
| COURT | Yes | None | Increment | No | Yes |
| ON1 / ON2 | Yes | NIGHT | Increment | Yes | Yes |
| ON / N / NIGHT | Yes | NIGHT; retain generic raw/base code | Increment | Yes | Yes |
| PN | No | None | Transparent: neither increment nor reset | Yes; bundle context belongs to later policy/sequence evaluation | Yes, under the approved displacement rule |
| OFF | No | None | Reset | No | No |
| GOFF / HKA / GHKA / AL / MC / EL / COURSE / blank | No | None | Reset | No | No |
| EP assignments/identities | Excluded from MO work | None | Excluded, without resetting MO work | No MO qualification | No MO entitlement |
| Unknown | Unknown | Unknown | Unknown; never silently reset | Unknown | Unknown |

Recognized X and S suffixes retain their raw spelling. X inherits the base shift. S retains the underlying assignment properties and sets a standby marker; it never asserts actual attendance. OFF(S) alone is not worked. If an actual AM assignment also exists, AM determines the worked day. AM(S) retains AM base semantics; the marker itself adds no staffing or work. The pure day classifier collapses only the **worked-day count**, never assignment rows: AM+PM and AM+PN each contribute one worked calendar day. `AM → ON1 → ON2 → PN → AM` produces four. This is a semantic contract helper, not the Phase 3 sequence/weekly engine.

Policy qualification is labeled `PUBLISHED_PLANNED`; Phase 1 neither evaluates weekly entitlement from current amendments nor creates a published snapshot. Normal OFF requires exact base OFF. Generic nights are never inferred to be ON1 or ON2. Unknown code spelling is preserved, including unexpected embedded markers. No semantic result produces a GOFF transaction or changes historical PH/GHKA results.

The owner-approved MO staffing constants are AM minimum 2, PM minimum 3, night 2/day; PM >= AM and PM-AM <= 1 are advisory. They apply on weekends/public holidays, with HOD-authorized exceptional holiday reduction. They are exposed as future validation metadata only; existing device-local tally controls are unchanged. No Phase 3 staffing or weekly engine was added.

## Upload, integrity and authorization protections

The legacy global upload now obtains a script lock before checking enrollment and before its existing clear-and-replace operation. Any nonblank enrollment row in `RosterPeriods`, including malformed rows, rejects the **entire** legacy upload before a sheet is created or cleared. Checking only submitted dates would miss omitted months. Empty payloads and payloads containing only other months are also rejected. With no enrolled periods and default settings, success/error response shapes and sheet writes match Version 1. Future enrollment writers must use the same script lock. Direct spreadsheet edits or an old independently deployed backend cannot be locked by this new source; deployment coordination remains a later rollout concern.

Snapshots preserve ordered/duplicate/blank headers, row order/multiplicity, raw values, supplied formula/format metadata and exact Settings text. Canonical typed serialization distinguishes numbers, strings, Dates and objects. SHA-256 uses Apps Script Utilities / browser Web Crypto / Node crypto with parity tests. Reconciliation reports missing/extra occurrences and order differences, never repairs data. Row order is intentionally part of the checksum contract; table names and object keys are sorted, but source rows and headers retain order. Shadow projection checksums and comparisons convert only Date objects to their exact JSON ISO representation so Apps Script and received JSON agree. Date strings remain exact: different spellings or date-only values are not silently equated. Typed raw backup checksums remain distinct from transport checksums. Public stored-catalog drift exposes match/order flags and missing/extra occurrence counts only, never raw stored cells or extra columns. These are dataset snapshot utilities, not a full workbook metadata exporter or restore operation.

The sole administrator boundary compares the server-established `Session.getActiveUser().getEmail()` with the private script property `ROSTER_V2_ADMIN_EMAIL`. Missing/unavailable identity or configuration denies access. Request email/admin/PIN values, temporary user keys and `getEffectiveUser()` are never trusted. Official write/private-note routes stay unavailable even to an authenticated administrator.

The existing deployment executes as its deploying user with anonymous access. Google documents that the active user's email can be unavailable in this context; the effective user is the deployer, not caller authentication. Therefore the boundary safely denies unavailable identities. A caller-authentication/access arrangement must be validated before later write enablement; no permissive fallback exists. Source: [Apps Script Session reference](https://developers.google.com/apps-script/reference/base/session). No administrator address, credential, property, OAuth scope or deployment setting was configured during this work. Existing public legacy endpoints retain their prior authorization behavior.

## Validation and exit gate

| Check | Result |
| --- | --- |
| Existing tests | PASS: all five original helper suites; no existing test edited or removed. |
| Phase 1 tests | PASS: 66 Node tests, 0 failures (59 existing Phase 1 tests plus seven review additions). Includes the immutable Version 1 Git-blob oracle; 14 legacy GET routes/default/fallback cases; 23 legacy POST success/error shapes; missing-sheet side effects; unknowns/modifiers/PN; aliases/renames/orphans; EP pairs; duplicate preservation; read privacy; enrollment and lock failure; checksums and catalog drift. |
| Shared bundle | PASS: `node scripts/build-appscript.mjs --check`. Same pure code executes in frontend and Apps Script test context. |
| Build | PASS: `npm run build -- --configLoader runner`; Vite 7.1.7, 1,877 modules; 857.49 kB JS chunk, 235.33 kB gzip. |
| Build advisories | Existing stale Baseline/Browserslist data and >500 kB chunk advisory. No dependency refresh. |
| Lint/typecheck | Not configured in this JavaScript repository; no lint/typecheck script or TypeScript project to run. Node tests parse the new modules and Apps Script; Vite checks the application build. |
| Remote validation | Not run or required for this local implementation gate. No deployment or live spreadsheet request occurred. Apps Script integration tests execute in a local Sheets simulator and do not prove a deployed runtime result. |

An initial oracle test identified checkout CRLF versus Git-normalized LF; the comparison now uses Git text normalization while retaining the fixed approved blob digest. No semantic or legacy-contract assertion was weakened.

**Phase 1 exit gate: PASS (local implementation and contract verification).** All new switches are OFF; legacy payloads and data behavior remain compatible when unenrolled; shadow reads reconcile; every initial semantic code is deterministic; unknowns and historical evidence are preserved; stable identities and valid multi-assignments work; enrolled-period upload protection and the administrator boundary are tested. Real deployment, population of registered identities/enrolled periods, and authenticated runtime verification remain future authorized rollout work, not actions performed here. No unresolved Phase 1 implementation blocker is known. Do not proceed automatically to Phase 2.

## Final independent review — 2026-09-08

**Verdict: PASS after four concrete fixes.** This review inspected the actual tracked and untracked changes against the approved Phase 1 scope and frozen Version 1 source, rather than accepting the earlier PASS claim.

| Severity | Defect and fix | Regression evidence |
| --- | --- | --- |
| High | Public catalog drift returned raw stored rows, including arbitrary extra cells. Return only status flags and occurrence counts. No live sensitive data was accessed; reproduced with a synthetic private marker. | Public catalog drift test covers both extra columns and unexpected values in known schema columns, while confirming drift remains visible and no writes occur. |
| Medium | Sheet Date values were hashed as typed Dates but transported as strings, producing checksum/comparison mismatches. Normalize Dates only at the projection transport boundary; retain typed backups and exact strings. | Real Date cells across UTC+08 month/year boundaries, duplicate occurrences, wire checksum parity, repeatability, exact-change detection and unchanged legacy masterroster/alldata contracts. |
| Medium | Resolver/day classifier treated an UNKNOWN person domain as MO, while projection patched only some fields. Centralize explicit ambiguous-domain semantics in the shared resolver and preserve the issue through day classification. | Frontend/backend resolver/classifier/projection parity; ambiguous-only day remains unknown; known AM+PM still count one day; explicit EP stays excluded. |
| Medium | Client invalid-date rows could be omitted while comparison was labeled complete based only on server rows. Require both sides to have no unplaced rows and expose the local count. | All four combinations of local/server invalid rows, placed-row matching and immutable input checks. |

Seven tests were added without deleting or weakening the previous 59. Before the fixes, five of the seven new tests failed, independently reproducing the four defects; the Date-valued legacy compatibility and false-like switch tests already passed. After the fixes: five original helper suites and 66 Node tests pass, with zero failures/skips. Generated-bundle verification and the build pass; no lint/typecheck is configured. Build output remains 1,877 modules / 857.49 kB JavaScript / 235.33 kB gzip with the same pre-existing advisories. The reviewed diff passes whitespace checks.

All eleven Phase 1 requirements were checked: discovery; the three additive schema contracts; disabled switches; shared semantics; stable identities/adapters; explicit shadow reads; legacy contracts; server-side upload protection; snapshot/reconciliation utilities; and fail-closed administrator authorization. Tables are defined and inspected locally, not created remotely. Explicit enrollment classification is available; no enrollment writer is enabled. No queue/outbox, OperationLog, revision write protocol, lifecycle, amendments or GOFF processing was introduced.

Only these seven repository files changed in this review: appscript.txt; backend/roster-v2.gs; src/features/roster/compatibility.js; src/features/roster/shadow.js; tests/phase1/contracts.test.mjs; tests/phase1/semantics.test.mjs; this handoff. Existing UI/analytics, API additions, package scripts, dependencies/lockfile, original tests, fixtures, major-update documents and Phase 0 evidence remain unchanged from review entry. The historical readiness archive still matches SHA-256 9d5ebf86c97379d113bb64155c600f7b2f846861564871324164314eb4a04caf; Phase 0 remains owner-approved PASSED.

Deployment-time prerequisites remain the live caller-identity/access test, deliberate copy-only schema/identity setup and enrollment rehearsal, and coordinated deployment of the upload guard before any later enrollment writer. These do not authorize deployment now and do not reopen Phase 0. No remote endpoint, workbook, restore, staging, commit, push or deployment operation occurred in this review.

## Files changed (complete Phase 1 implementation)

- `appscript.txt`: minimal legacy routing/upload/Settings hooks plus generated shared contract and Apps Script adapter.
- `backend/roster-v2.gs`; `scripts/build-appscript.mjs`: read/auth/upload boundary and reproducible bundle generation.
- `src/features/roster/compatibility.js`; `src/features/roster/shadow.js`; `src/api.js`: pure foundation and opt-in read diagnostics.
- `tests/phase1/api.test.mjs`, `contracts.test.mjs`, `semantics.test.mjs`, `apps-script-harness.mjs`; `tests/fixtures/legacy-workbook.json`, `legacy-appscript-v1.txt`: local fixtures and regression coverage.
- `package.json`: test/build scripts only; dependencies and lockfile unchanged.
- `MAJOR_UPDATE_SPEC.md`, `MAJOR_UPDATE_IMPLEMENTATION_PLAN.md`, `docs/MAJOR_UPDATE_PHASE_0_READINESS.md`, this handoff, and the closure/archive records under `docs/phase-0-evidence`: approved decisions, closure, architecture and results.

Nothing staged, committed, pushed or deployed. Production and copied-test workbooks were not accessed or modified; no remote side effect or restore occurred.

## Checkpoint whitespace policy — 2026-09-08

The full staged check includes newly tracked historical evidence, unlike the earlier unstaged diff check. Markdown hard breaks in the specification and plan use equivalent backslash syntax; their rendering and requirements are preserved. The immutable tests/fixtures/legacy-appscript-v1.txt is the sole authorized whitespace exception: its captured blank-line spaces must not be trimmed. Its checkout SHA-256 remains 82554b83bde2e9d111c2a3749f9c1e6c1b750ac11138b18f7be18982bb045538, and its Git-normalized Version 1 blob remains b9601899509b276742f516dc237d00af40a8b026. Current/generated appscript.txt is verified separately by the bundle consistency test.

Required staged policy check:

```sh
git diff --cached --check -- . ':(exclude)tests/fixtures/legacy-appscript-v1.txt'
```

The unrestricted staged check is also inspected: all remaining findings must belong only to that fixture. This exception does not suppress checks for any application source or other file. Earlier statements that nothing was committed or pushed describe the implementation/review tasks; the subsequent authorized checkpoint operation is separate.
