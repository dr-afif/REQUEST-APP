# Phase 3 — Weekly OFF, Night Bundles, Consecutive Work, and Rest Guidance

**Verdict: PASS for local Phase 3 implementation and verification. No deployment or Phase 4 work.**

Implementation started on `major-update-v2` at Phase 2 checkpoint `894b04e85f565f5c0aee77cc84494f02fe289a79`, with a clean working tree. `main` remained `a852f0ace8966c8fcbce88166e4dfc3081f5476c`. The governing specification, implementation plan, and Phase 1/2 handoffs were read before changes. No `AGENTS.md` applied.

## Architecture and week model

`src/features/roster/guidance.js` is the shared pure advisory engine. It treats roster dates as validated ISO calendar labels, uses UTC arithmetic only to move between those labels, keys weeks by Monday, and always returns the complete Monday–Sunday range. Month views enumerate every touching week, including 29 June–5 July and 28 December–3 January.

Weekly evaluation receives planned and current assignments separately. Missing any of the seven planned dates produces `PROVISIONAL` / `INCOMPLETE` with null qualification, requirement, counts, and shortfall. The UI requests the previous, selected, and next monthly drafts. Missing adjacent context also prevents partial night/consecutive conclusions and produces `INCOMPLETE_SEQUENCE_CONTEXT`. Assignments remain in their monthly draft entities; Phase 3 does not transfer or rewrite them.

Policy selection uses `weekStart`. The pure evaluator accepts a previously locked policy and will not replace it with a later effective policy. Persisted published snapshots remain Phase 4 scope because no published assignment lifecycle exists yet. The Phase 3 UI evaluates only enrolled draft contexts and does not render guidance for unenrolled historical periods.

## `OffPolicies` contract

The additive sheet contract is:

`PolicyId`, `PolicyCode`, `EffectiveMonday`, `RuleVersion`, `RuleJson`, `Active`, `Reason`, `Revision`, `OperationId`, `CreatedAt`, `CreatedBy`.

Policies are append-only, effective-dated records. The backend accepts `A` or `B`, requires a valid Monday, derives deterministic `RuleJson`, rejects duplicate IDs/effective Mondays and stale revisions, and exposes only journal-confirmed rows. `RuleJson` records rule version 1, exact base `OFF`, and published-planned semantic qualification. The backend never creates a missing sheet.

Administrator policy writes reuse the Phase 2 `OperationLog`, UUID, canonical payload hash, expected revision, ScriptLock, recovery, and idempotent replay contract. The browser persists the pending policy operation before transport, resumes with the same UUID, and clears it only after a matching confirmation or final failure. All six before/after partial-write positions were fault-tested. Direct calls require the configured administrator. Writes require `weekly_off_guidance_enabled`, `roster_v2_write_enabled`, and `write_queue_v2_enabled`, checked before and after lock acquisition.

## Weekly OFF rules

- Policy A requires one normal `OFF` in every complete Monday–Sunday week.
- Policy B requires one normal `OFF` if the planned week contains `ON1`, `ON2`, `PN`, legacy `ON`, `N`, or `NIGHT`; otherwise it requires two.
- Qualification uses planned assignments and the Phase 1 resolver. A later current `MC` replacing planned `ON2` does not change qualification.
- Only semantic base `OFF`, including its recognized modifiers, counts. `GOFF`, `MC`, `EL`, `AL`, `HKA`, `GHKA`, `COURSE`, `COURT`, blank, and other non-OFF values do not substitute.
- Unknown semantics produce an incomplete/unknown result with null compliance values.
- EP identities and assignments are excluded from MO entitlement.

For planned `OFF` changed to current `MC`, the result retains planned assigned OFF, reports current operational OFF as not taken, and displays current `MC`. It produces zero replacement OFF and zero GOFF. Phase 3 contains no GOFF ledger or inferred entitlement.

## Consecutive work, night bundles, and rest

Consecutive evaluation uses the Phase 1 `INCREMENT`, `TRANSPARENT`, `RESET`, and `UNKNOWN` classification. The default configurable threshold is six worked calendar days; the seventh and later increments are advisory issues. Multiple assignments such as AM+PM and AM+PN remain separate but count as one worked date. `PN` preserves the running count without incrementing or resetting. Reset statuses clear it, and unknown input makes the result indeterminate until a reset. Evaluation crosses month and year boundaries.

Valid night patterns are `ON1 → ON2 → PN`, `ON1 → PN`, and legacy `ON`/`N`/`NIGHT → PN`, without converting legacy codes. `ON1 → ON2` is accepted as bundle continuation and recovery is checked after `ON2`. Missing predecessors/followers remain distinct. A protected reset after a night can produce a bundle warning without a rest warning; a worked continuation without recovery produces both applicable bundle and insufficient-rest issues. Isolated PN is reviewable. EP assignments are excluded.

The structured advisory codes are `PROVISIONAL_WEEK`, `WEEKLY_OFF_SHORTFALL`, `UNKNOWN_SEMANTIC`, `SEVENTH_WORKED_DAY`, `NIGHT_BUNDLE_PREDECESSOR`, `NIGHT_BUNDLE_FOLLOWER`, `INSUFFICIENT_POST_NIGHT_REST`, and `INCOMPLETE_SEQUENCE_CONTEXT`. IDs include person and date/week/context. Acknowledgement records retain issue ID/code, actor, and timestamp; acknowledged warnings remain visible as reviewed and never edit roster data.

## UI and compatibility

The existing administrator roster area now mounts a compact guidance panel when either Phase 3 switch is enabled. It shows applied policy, week state, planned OFF, operational OFF, shortfall, plain-language issues, acknowledgement, and the minimum effective-dated policy editor. It uses current Phase 2 draft values as planning/current inputs and says so until Phase 4 supplies immutable published/current snapshots. The panel has no roster mutation path.

`weekly_off_guidance_enabled` and `night_safety_guidance_enabled` remain OFF by default and malformed/false-like values remain closed. Policy mutation also requires both Phase 2 write switches. Existing staffing constants and semantic staffing buckets remain the shared source; no competing staffing engine was added. The immutable Version 1 fixture, legacy API/workbook-effect oracle, Phase 1 semantic behavior, Phase 2 queue/recovery behavior, PH/GHKA handling, and legacy upload protections remain unchanged. No historical roster is recalculated. No lifecycle, publication, amendment, replacement, closing, GOFF ledger, migration, or Phase 4+ record was introduced.

## Validation

- Legacy: 5 original helper suites passed.
- Phase 1: 66/66 tests passed.
- Phase 2: 72/72 tests passed, including real IndexedDB/browser cases.
- Phase 3: 69/69 tests passed, including pure rules, generated Apps Script backend fault injection, durable policy mutation, and real-browser UI checks.
- Node total: 207/207 tests passed across Phases 1–3.
- Production build: passed; 1,888 modules transformed.
- Generated source: `node scripts/build-appscript.mjs --check` passed.
- Whitespace: `git diff --check` passed. Git emitted only its configured LF-to-CRLF working-copy notices.

## Files changed

Modified: `appscript.txt`, `backend/roster-draft.gs`, `backend/roster-v2.gs`, `package.json`, `scripts/build-appscript.mjs`, `src/components/RosterPage.jsx`, and `src/features/roster/components/DraftQueuePanel.jsx`.

Added: `backend/roster-guidance.gs`, `src/features/roster/guidance.js`, `src/features/roster/data/guidanceRepository.js`, `src/features/roster/components/RosterGuidancePanel.jsx`, all five files under `tests/phase3/`, and this handoff.

The two governing major-update documents and earlier handoffs were not changed.

## Remaining work outside this local exit gate

No known local Phase 3 blocker remains. Before any later copied-workbook enablement, deliberately create and validate the exact `OffPolicies` sheet, seed an owner-approved initial policy, verify live administrator identity and transport, and repeat deployment-specific recovery checks. Feature switches remain off. Persistent published week-policy snapshots and immutable planned/current inputs belong to Phase 4 and were intentionally not created here. Acknowledgements are Phase 3 local advisory metadata; authoritative lifecycle audit events remain deferred.

No workbook or endpoint was accessed. Nothing was staged, committed, pushed, merged, or deployed.

## Final Review — 2026-09-09

**Independent review verdict: PASS.** The review began from the requested Phase 2 checkpoint (`894b04e85f565f5c0aee77cc84494f02fe289a79`) on `major-update-v2`, with `main` at `a852f0ace8966c8fcbce88166e4dfc3081f5476c`. It remained limited to Phase 3. No Phase 4 lifecycle, publication, amendment, closing, migration, GOFF ledger, or deployment work was introduced.

The implementation entered review with 69 Phase 3 tests and 207 Node tests across Phases 1–3. The reviewer added seven targeted Phase 3 regressions and fixed three concrete defects:

- **High — recovery integrity:** policy-write recovery could mark a staged `OffPolicies` row `CONFIRMED` before validating its `RuleVersion`, canonical `RuleJson`, active state, creator, and creation timestamp. Recovery and confirmed-state reconstruction now validate the semantic and audit fields before confirmation. Tampering with `RuleJson`, `Active`, `CreatedAt`, or `CreatedBy` leaves the operation and journal in `RECOVERY_REQUIRED` and does not advance policy state.
- **Medium — audit provenance:** `CreatedBy` used the generic string `ADMIN`. The authenticated administrator returned by the existing authorization guard is now carried into the append-only policy row. Regression coverage verifies the stored actor and idempotent replay.
- **Medium — period/context safety in the UI:** a delayed policy response for a previously selected month could overwrite the current month; resumed non-confirmed policy operations could be missed; and incomplete sequence context could render an undefined label. Policy data is now applied only to the live selected period, pending or failed recovery status is surfaced, evaluation waits for the matching loaded period, and sequence issues display their context key. Browser tests cover the delayed prior-month response and the cross-month context label.

The review also added explicit evidence for leap day, cross-month Policy A, cross-year Policy B with a planned night and current leave, OFF→EL and OFF→AL treatment, six worked days plus transparent PN followed by a warned seventh worked date, invalid policy dates and IDs, unknown night context, and exclusion of EP office-hour/on-call pairs. These cases preserve planned/current separation, produce no replacement OFF or GOFF, and do not turn unknown or EP input into false MO rest warnings.

Final validation:

- Legacy: all 5 original helper suites passed.
- Phase 1: 66/66 passed.
- Phase 2: 72/72 passed.
- Phase 3: 76/76 passed.
- Node total: 214/214 across Phases 1–3.
- Production build: passed; 1,888 modules transformed. The generated `dist/index.html` change was restored after validation.
- Immutable Version 1 blob and generated Apps Script consistency checks passed as part of the full test run.
- No workbook or endpoint was accessed, so there were no remote side effects.

No local Phase 3 blocker remains. Deployment-time work remains outside this review: create and verify the exact `OffPolicies` sheet in the copied workbook, seed the owner-approved initial policy, verify the live administrator identity and credentialed transport, and run deployment-specific quota, latency, and recovery checks. Both Phase 3 feature switches remain off. Nothing was staged, committed, pushed, merged, or deployed.
