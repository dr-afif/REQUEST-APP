# Major Update Phase 0 Readiness — Owner-approved Closure

**Phase 0: PASSED. Application owner approval: 7 September 2026.**

The application owner explicitly approved the Phase 0 inventory, restore/import evidence, source reconciliation and migration decisions in the attached Phase 1 authorization. This closure supersedes the earlier OPEN / NOT PASSED assessment; Phase 0 investigation was not reopened. Phase 1 implementation is documented in [the Phase 1 handoff](MAJOR_UPDATE_PHASE_1_HANDOFF.md).

## Evidence and provenance

| Evidence | Owner-approved record |
| --- | --- |
| Frozen repository | main; commit a852f0ace8966c8fcbce88166e4dfc3081f5476c |
| Frozen Apps Script Git blob | b9601899509b276742f516dc237d00af40a8b026 |
| Immutable deployed source | Version 1 retrieved through the official Apps Script API; exact Code source independently resolved to the same Git blob above. |
| Apps Script manifest | V8; Asia/Singapore; execute as deploying user; access anyone/anonymous. |
| Operational roster dates | Asia/Kuala_Lumpur / UTC+08. Owner confirms no operational offset conflict with Asia/Singapore. |
| Fresh workbook evidence snapshot | Captured 2026-09-07 16:36 MYT; SHA-256 5a80a7ece723e7b4ef4579f72f15109d93b75b18f9bc8f441d63e1008b3cb491. |
| Restore/import evidence | Previously passed; accepted by the application owner. No new restore operation authorized or performed. |
| Sign-off | Application owner explicitly approved inventory and authorized Phase 0 closure on 2026-09-07. |

The evidence above is recorded from the owner's supplied closure, not inferred from alldata. No production or test-workbook/API call was made during Phase 1 to reverify it. The raw new workbook snapshot and Version 1 export were not independently reread in this task. No separate spreadsheet timezone setting, property-name list or trigger list was enumerated in the supplied closure; this report does not invent those values or interpret absence as an empty inventory. The owner's explicit inventory approval and operational timezone decision are the closure authority.

The owner's request fingerprint, source reconciliation, snapshot digest and archive linkage are recorded in [owner-closure-2026-09-07.json](phase-0-evidence/owner-closure-2026-09-07.json). The previous assessment is preserved byte-for-byte in [READINESS_PRE_CLOSURE_2026-09-07.md](phase-0-evidence/READINESS_PRE_CLOSURE_2026-09-07.md), SHA-256 9d5ebf86c97379d113bb64155c600f7b2f846861564871324164314eb4a04caf. Its earlier timestamps, endpoint findings, proposals, test results and open gates are historical, not current blockers. The existing evidence-manifest.json and representative-cases.json remain untouched historical artifacts; the manifest's former readiness-path digest now corresponds to that archive. Its unapproved/unknown fixture labels describe the pre-closure evidence state. Current approved behavior is tested separately in tests/phase1.

## Approved workbook inventory

- All 11 expected sheets are present.
- No missing required IDs, duplicate IDs, exact duplicate rows, invalid structured dates or known spreadsheet error values were found in the fresh owner-approved snapshot.
- No known named ranges, protected sheets/ranges or hidden columns. The only known hidden rows are historical Requests rows used for manual viewing convenience.
- No intentional formulas. Requests blank columns L/M are not application schema. Requests!M638 = 145/12 is accidental legacy content, not business logic. Preserve it in source evidence/backups; do not add a new application field or derive a balance from it.
- The owner's approved inventory supersedes the earlier conditional column-L inference and unresolved purpose. No workbook cell was edited in this task.

## Confirmed migration and semantic dispositions

| Area | Approved disposition |
| --- | --- |
| Historical records | Preserve; do not silently clean, deduplicate, infer, rewrite or reinterpret. Stricter prospective v2 constraints must not reject faithful legacy loading/projection. |
| Syuhada | SYU, Syu, SYUHADA and Syuhada share the canonical MO identity. No fuzzy merging of other names. |
| EP aliases | DR NAME, Dr. Name and unprefixed Name represent the same EP identity; preserve raw text where practical. EPs are display-only relative to MO logic. |
| EP pairs | Keep office-hour + on-call as separate assignments, including all 56 previously observed pairs. They do not count toward MO staffing, consecutive work, OFF, GOFF or GHKA. |
| Multiple assignments | Valid: Najmi AM+PM on 2026-07-28; Adli AM+PN on 2026-07-29; EP pairs. Assignments remain separate; multiple worked duties on one date count as one worked calendar day. |
| PN | Non-worked/non-staffing; transparent without increment/reset; planned Policy B night-branch candidate; eligible under specified OFF-displacement semantics; never infer historical credits. |
| Generic nights | ON/N/NIGHT stay generic. Never infer ON1 versus ON2. ON1→ON2→PN and ON1→PN are valid; unexpected sequences warn rather than rewrite. |
| COURT | Official worked duty; increments consecutive days; no ED coverage; not a Policy B night; may displace planned OFF. |
| X | Extended hours; retain base AM/PM semantics and raw spelling. |
| S | Standby designation alone does not prove attendance. Preserve underlying base semantics; an actual worked assignment determines work/coverage. |
| Normal OFF | Only exact base OFF qualifies; GOFF, HKA, GHKA and leave/status values do not substitute. Policy B evaluates published planned assignments, not subsequent amendments. |
| Requests anomalies | Multiple Active requests per historical person/date remain loadable. Preserve the cancelled historical Amir reference without creating/activating current staff. |
| Leave note discrepancy | Preserve the structured one-day MC on 2026-09-04 and raw note mentioning 3 & 4 /9/2026; do not correct dates from free text. |
| PH/GHKA versus GOFF | Keep balances and histories separate; no historical GOFF inference. GOFF commencement/openings remain later rollout inputs. |
| Staffing authority | AM minimum 2; PM minimum 3; night 2/day. PM>=AM and PM-AM<=1 advisory, including weekends/public holidays; HOD may authorize exceptional holiday reduction. |

These decisions supersede the former unresolved mapping proposals. No new permission to apply these approved semantics to the Phase 1 foundation was requested. Historical UI/tallies remain untouched with all switches OFF.

## Phase 0 exit gates

| Gate | Status / evidence |
| --- | --- |
| Repository evidence frozen | MET: approved commit/blob; local baseline unchanged at Phase 1 entry. |
| Production not mutated by this assessment | MET: no production access or write performed by this task. Owner-supplied production evidence is a provided record. |
| Safe/restorable copy and inventory accepted | MET by explicit owner approval; restore/import test previously passed. |
| Signed inventory complete | MET by owner sign-off dated 2026-09-07 and supplied snapshot digest/inventory. |
| Deployed source reconciled | MET: immutable Version 1 Code and frozen source have the same approved Git blob. |
| Operational timezone | MET: owner-approved Asia/Kuala_Lumpur UTC+08; no operational offset conflict with manifest Asia/Singapore. |
| Schema/semantic assumptions resolved | MET: Requests L/M and accidental formula, COURT, EPs, aliases, modifiers, multiple assignments and historical anomalies have explicit dispositions. |
| Representative evidence fixtures | MET: ten preserved Phase 0 fixtures plus current Phase 1 contract coverage; historical artifacts are not rewritten to hide previous uncertainty. |

**Overall Phase 0 exit gate: PASSED, owner-approved on 2026-09-07.** No remaining Phase 0 closure checklist. Phase 1 was authorized; no automatic continuation to Phase 2.

## Changes and remote-effect statement

The earlier assessment, fixtures and manifest were preserved; a current closure document and owner-closure record were added. Phase 1 changes appscript.txt locally, so the current development source is expected to differ from the frozen deployed Version 1 baseline. That is not a source-reconciliation contradiction and has not been deployed.

Additional endpoint requests during Phase 1: zero. No production/test workbook edit, roster upload, migration, enrollment, lifecycle operation, ledger operation, property/trigger change or restore was performed remotely. Historical Phase 0 GET-side-effect observations remain in the archived report and are not recast as new activity.
