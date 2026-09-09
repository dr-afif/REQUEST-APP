# Phase 2 — Ordered Write Queue, Operation Journal, and Recovery

**Verdict: PASS for local implementation and fault-injection verification. No deployment or Phase 3 work.**

Started on `major-update-v2` at Phase 1 checkpoint `b64232f210afdb12d2aaefa4d958878a279e1eec`, with a clean working tree. `main` remains `a852f0ace8966c8fcbce88166e4dfc3081f5476c`. Phase 0 and Phase 1 decisions remain closed; see [Phase 0 readiness](MAJOR_UPDATE_PHASE_0_READINESS.md) and [Phase 1 handoff](MAJOR_UPDATE_PHASE_1_HANDOFF.md). These historical documents and both governing major-update documents are unchanged by Phase 2.

## Scope and architecture

The only new mutation is a private, unofficial draft-cell patch for an explicitly enrolled monthly period. Its entity key is `draft:YYYY-MM`. An enrolled period starts with an empty draft at revision zero; existing MasterRoster data is never silently imported. No enrollment/setup API exists. There are no published snapshots, lifecycle transitions, amendments, roster-rule engines or ledger records.

`queue/protocol.js` is the shared pure validation/hash/patch contract, embedded into Apps Script using the existing generator. `backend/roster-draft.gs` owns journal I/O, confirmed reads and recovery. Existing Apps Script v2 routing receives parsed POST payloads and dispatches only the added draft actions; all other legacy/Phase 1 behavior remains intact.

`data/draftRepository.js` is a separate HTTP adapter; existing src/api.js and legacy request/leave/PH mutations are untouched. `queue/indexedOutbox.js`, `state.js`, `draftQueue.js` and `runtime.js` implement durability, scoped optimistic state, scheduling, status reconciliation and navigation persistence. `components/DraftQueuePanel.jsx` adds a small private editor/save-state surface to RosterPage only when the two draft switches are enabled and the existing UI is in administrator mode. Server authentication remains authoritative.

The editor queues typed assignment changes and offers an explicit Save draft cell action, refresh, Retry/recover and Revert. Multiple assignments are separate array entries with separate assignment UUIDs; no person/date last-row overwrite is introduced. The existing official roster grid and upload handler remain independent and unchanged. Private draft refresh runs separately and never replaces the legacy grid.

## Additive storage contracts

No live sheets were created. A later authorized setup must create exactly these headers, preserve source evidence and use the same script lock as the legacy upload/enrollment boundary.

| Table | Ordered fields |
| --- | --- |
| OperationLog | OperationId, ClientId, TabId, OperationType, EntityKey, ExpectedRevision, ResultRevision, PayloadHash, Status, ResultJson, ErrorCode, CreatedAt, CompletedAt |
| RosterDraftPatches | OperationId, EntityKey, BaseRevision, ResultRevision, PayloadJson, ResultChecksum |

OperationLog statuses are PENDING, CONFIRMED, FAILED and RECOVERY_REQUIRED. ResultJson holds the prepared confirmation delta and resulting checksum; it is exposed as a fixed whitelist only after verified confirmation. One RosterDraftPatches row holds one complete patch batch, so an incomplete batch cannot be mistaken for several independent successes. These records are draft mutation evidence, not Phase 4 lifecycle records.

Draft revisions are derived from the confirmed journal chain, avoiding a separately mutable revision pointer. Reads require a contiguous revision chain, exactly one matching payload row per confirmed operation, matching operation meaning/hash, and matching result checksum. Unconfirmed rows contribute nothing to authoritative draft cells. Malformed or inconsistent evidence fails closed rather than returning a partial success.

## Protocol, hashing and limits

OperationId uses crypto.randomUUID() and canonical lowercase v4 UUID syntax. PersonId and assignmentId must be registered/stable v4 UUIDs in this prospective draft contract; legacy adapters retain their existing broader historical compatibility. ClientId is created atomically in IndexedDB; TabId is unique to a document/tab and stable across component remounts. They are diagnostic only and never authorize a request.

SHA-256 covers operationType, entityKey, expectedRevision and all patch content. Object key order is canonicalized; patches are sorted by stable person/date cell key; assignment order and multiplicity are intentionally significant. Diagnostic identifiers, client timestamps, retry counts and the request action wrapper do not change operation meaning. Before first transmission, the operation is frozen as SENDING and its payload hash is durably stored. Retries reuse the same UUID, revision, assignments and hash.

Each patch contains only personId, ISO local date and an assignments array; each assignment contains only assignmentId and rawShift. Unknown shifts and S/X spelling are preserved. Unknown/private fields, cross-month dates, duplicate assignment IDs and missing registrations are rejected. Batches allow up to 100 cells, 12 assignments per cell and 80 characters per raw shift. Canonical payload JSON is bounded below 35,000 characters and prepared result JSON below 40,000, keeping stored JSON within a single Sheets cell. These are technical safety limits, not staffing rules.

| Action | Method | Behavior |
| --- | --- | --- |
| rosterv2draftschema | GET | Authorized draft capabilities, additive headers and safe registered person ID/display/domain fields. |
| rosterv2draft | GET | Authorized confirmed draft snapshot by entityKey; revision, checksum and cells. |
| rosterv2operation | GET | Authorized lookup of one OperationId; NOT_FOUND, stored status or verified confirmation. |
| rosterv2draftpatch | POST | Authorized, enabled, enrolled, revision-checked, idempotent patch batch. |
| rosterv2draftrecover | POST | Authorized deterministic reconciliation of one existing operation. |
| rosterv2draftabandon | POST | Authorized FAILED tombstone for an absent operation; prevents a delayed original request from committing after local Revert. Existing operations are not erased. |

The envelope is `{ok:true,...}` or `{ok:false,error:{code,retryable,details,message}}`. Machine codes distinguish VALIDATION_FAILED, AUTHORIZATION_REQUIRED, FEATURE_DISABLED, ENTITY_NOT_FOUND, REVISION_CONFLICT, IDEMPOTENCY_MISMATCH, LOCK_BUSY, TRANSIENT_BACKEND, PERMANENT_FAILURE and RECOVERY_REQUIRED. Conflict details include entity, current revision, checksum and reviewRequired. Errors never echo raw exception text or administrator properties. The repository uses a 20-second abort timeout; failed/invalid/truncated responses are ambiguous, not proof of server failure.

## Journal visibility and recovery

All draft reads/status queries and critical mutations use a script lock with a bounded 10-second wait, released in finally. Writes are flushed before proceeding/releasing the lock. Lock acquisition failure is retryable LOCK_BUSY and makes no write.

1. Validate meaning and verify payload hash; locate the UUID under lock.
2. Same UUID/hash and CONFIRMED returns the verified stored result. Changed meaning/hash returns IDEMPOTENCY_MISMATCH. PENDING/RECOVERY_REQUIRED returns explicit recovery state; no second operation is created.
3. For a new operation, validate enrollment, registered identities, expected revision, patch shape and assignment uniqueness. Another unresolved operation blocks that entity.
4. Write PENDING with the complete prepared result, then the operation-scoped patch batch.
5. Re-read and verify batch, hash, base/result revision and full resulting checksum; mark CONFIRMED last. Only then do canonical reads include it.
6. Any uncertain write outcome returns RECOVERY_REQUIRED. A lost response after confirmation remains queryable as CONFIRMED; a persisted PENDING row remains visible for reconciliation.

Recovery holds the same lock. If no payload row exists, it records FAILED: no original locked writer can still append that batch. If exactly one complete payload matches the prepared result and current base revision, it confirms that exact operation. Duplicates, corruption or conflicting revisions remain RECOVERY_REQUIRED and block later writes. No source rows are deleted or guessed, and no roster/ledger restore or reversal is performed.

Revert of a never-sent local operation removes only its optimistic overlay. A possibly sent operation is queried first. CONFIRMED cannot be locally undone; PENDING/RECOVERY_REQUIRED must be reconciled. NOT_FOUND alone is insufficient because an old request might still arrive: an authorized FAILED tombstone must be recorded before removing the local proposal. Retry of that UUID then returns FAILED without applying it. Later proposals remain visible; dependent revisions become explicit conflicts instead of being silently rebased.

## IndexedDB, queue and optimistic state

Database version 1 has `entities` (keyPath entityKey) and `meta` stores. The runtime database name is `request-app-roster-outbox-v1-<SHA256 of configured endpoint URL>`, preventing replay into another deployment after an endpoint change. No mutation payload is stored in localStorage.

Each entity row contains schemaVersion, entityKey, storageRevision, a confirmed baseline (revision/checksum/cells), a monotonically increasing local sequence and its operation records. Each operation records schemaVersion, operationId, clientId, tabId, operationClass/type, entityKey, expectedRevision, payload/hash, localSequence, status, everSent, attemptCount, nextRetryAt, lastError, creation/update timestamps and lastConfirmed values for its affected cells. The optimistic patch is the payload's patches; a second copy of the same patch is unnecessary.

Entity/baseline/operation changes commit atomically in a readwrite IndexedDB transaction with a strict durability hint. The Promise resolves on transaction completion, not request success. There is no awaited network/hash work inside a live transaction. Unknown schema versions, blocked upgrades and failed transactions are explicit failures; existing data is never cleared to recover. Browser storage clearing, quota and deployment authentication remain real platform limitations; local persistence failure retains visible in-memory intent and enables retry/discard controls.

The view overlays nonterminal patches on the confirmed baseline in local sequence order. Confirmation clears only its own operation. Revert removes only its own overlay. No whole roster array is restored. Older snapshots and older local-storage reads cannot replace newer confirmed/local states. A newer foreign snapshot updates the baseline while preserving a local proposal separately and surfacing a conflict. Manual resolution is refresh/review, Revert of the old proposal after status verification, then an explicit new edit at the new base revision; no automatic rebase occurs.

## Ordering, debounce, retry and multi-tab behavior

Web Locks serialize dispatch/status/recovery per database/entity. Shared IndexedDB transactions serialize local edits and freeze-before-send transitions. Independent entities can proceed concurrently. Web Locks absence blocks enqueue/dispatch explicitly; it does not silently fall back to unsafe parallel sending.

Unsent edits from the same tab may coalesce into the final queued batch for that entity. Same-cell values replace only unsent proposals; other cells stay in the batch. Sent/ambiguous operations and another tab's edits never coalesce. The default debounce is 500 ms and is configurable; it is an engineering setting. A local successor may depend on its own prior revision. Foreign-tab revisions are never adopted silently from shared storage; a stale proposal remains a conflict. Manual Retry cannot overtake an earlier unresolved operation.

After a lost response or restart with SENDING/AWAITING_STATUS, the queue queries OperationLog before any retransmission. CONFIRMED merges a checksum-verified snapshot and clears only that UUID. NOT_FOUND permits retry with the original UUID and payload. PENDING/RECOVERY_REQUIRED requires explicit recovery. Backend failures known to be transient use status reconciliation and bounded backoff. Delay is `min(30000, 500 * 2^(attempt-1))` multiplied by jitter from 0.75 to 1.25 (maximum 37.5 seconds). Five automatic attempts/status failures lead to visible RECOVERY_REQUIRED. Retry metadata persists; manual eligible Retry resets the bounded budget without changing identity. Validation, authorization, disabled-feature, idempotency and unresolved revision errors are never blindly retried.

BroadcastChannel signals entity/event metadata without assignment/private content; storage events provide a signaling fallback. Signals trigger local-state reload, not authentication or trusted revision changes. Server expected revisions remain authoritative across tabs/devices. A 250-ms local scheduler observes shared persisted state; it does not make periodic network requests when there is no eligible work.

The runtime retains non-durable intent across in-app navigation; unmount pauses dispatch rather than destroying that intent. `beforeunload` is registered only while in-memory edits or failed local persistence make recovery unsafe. Fully durable queued/sent/recovery records do not create a permanent leave-page warning. Reopening restores durable pending state; safe work resumes and ambiguous work checks the original UUID first.

## Switches, compatibility and authorization

All eight Phase 1 switches remain OFF by default. Draft enqueue, draft write/recover/abandon require both roster_v2_write_enabled and write_queue_v2_enabled; the backend checks Settings independently of the UI. Private status/read operations remain authorized and usable after a write kill switch so confirmed outcomes can be inspected. The unchanged Phase 1 schema endpoint retains its Phase 1 effective-workflow contract; Phase 2 clients use the private draft capability handshake. Publication, private-note and later official operations stay unavailable.

The Phase 1 Session.getActiveUser email versus private ROSTER_V2_ADMIN_EMAIL boundary is reused. Blank/unavailable identity fails closed. No request field, ClientId, TabId, PIN or effective/deployer user grants authority. Live identity validation is deliberately not simulated as a production guarantee.

The immutable Version 1 fixture is unchanged: checkout SHA-256 `82554b83bde2e9d111c2a3749f9c1e6c1b750ac11138b18f7be18982bb045538`; Git blob `b9601899509b276742f516dc237d00af40a8b026`. Its approved historical whitespace exception remains. No Phase 1 test was changed or weakened; no historical roster, PH/GHKA balance, note, alias or multiple assignment was rewritten.

## Validation — final review on 2026-09-09

| Check | Result |
| --- | --- |
| Original legacy helper suites | 5 passed, 0 failed. |
| Phase 1 Node tests | 66 passed, 0 failed; unchanged tests and immutable source oracle. |
| Phase 2 tests | 72 passed, 0 failed: 28 backend tests and 44 real-browser/queue/editor/integration tests (49 pre-review plus 23 review additions). |
| Total | 138 reported Node tests plus five original helper suites; zero failures/skips. |
| Generated source | build-appscript --check passes; shared protocol and both modular adapters match generated appscript.txt. |
| Build | PASS, Vite 7.1.7. No added or upgraded dependencies. Existing browser-data and large-bundle advisories remain. |
| Lint/typecheck | Not configured in this JavaScript repository. |
| Whitespace | git diff --check passes, with the existing immutable-fixture exception retained for repository-wide checks. Added files also checked separately. |
| Remote effects | None. All backend tests use synthetic local Sheets simulation; browser HTTP integration uses loopback only. |

Tests cover duplicate replay; changed-payload UUID reuse; missing/disabled flags; authorization; correct/stale revisions; lock contention; failures before/after each journal write; corrupted/duplicate pending payloads; hidden pending data; confirmed-chain corruption; safe abandonment; multiplicity/unknowns/modifiers; bounded retries; scoped revert; older refresh/IDB reads; blocked/failed transactions; restart and actual page reload; shared-store tab identity; actual distinct browser tabs; and the visible editor.

The end-to-end loopback tests route real browser repository requests into the generated Apps Script simulator. One confirms two actual tabs cannot overwrite from the same stale revision. Another truncates the HTTP result body after server confirmation, reloads the page and verifies one OperationLog entry, one patch batch and recovery via the original UUID. Browser transport itself may retry a reset connection, so truncation provides a deterministic lost-result boundary. Tests use installed headless Chrome with an isolated temporary profile; PHASE2_BROWSER_PATH can select another Chromium executable. No personal browser profile, live workbook or remote deployment is used.

The IndexedDB/Web Locks implementation follows platform transaction/lifetime rules: [IDBTransaction](https://developer.mozilla.org/en-US/docs/Web/API/IDBTransaction), [Web Locks API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API). Real browser tests verify these primitives rather than replacing persistence with an in-memory mock.

## Changed files

Modified: appscript.txt; backend/roster-v2.gs; scripts/build-appscript.mjs; package.json (test scripts only); src/components/RosterPage.jsx (gated panel integration only).

Added: backend/roster-draft.gs; src/features/roster/data/draftRepository.js; src/features/roster/queue/protocol.js; indexedOutbox.js; state.js; draftQueue.js; runtime.js; src/features/roster/components/DraftQueuePanel.jsx; tests/phase2/backend.test.mjs; browser-cases.js; browser.test.mjs; ui-fixture.jsx; this handoff.

## Exit gates and remaining work

| Required guarantee | Verdict |
| --- | --- |
| No duplicate operation/effect | PASS: UUID/hash replay, lost result and repeated retry tests. |
| No stale overwrite | PASS: authoritative expected revisions, ordered dispatch and two real tabs. |
| No whole-array rollback | PASS: scoped overlay/revert with later proposals preserved. |
| Durable recovery | PASS: real IndexedDB transaction/restart/reload and query-before-replay tests. |
| Legacy compatibility | PASS: five original suites and all 66 unchanged Phase 1 contracts. |

No known local Phase 2 blocker remains. Before any later enablement: validate live Apps Script administrator identity/access, deliberately set up additive schemas/registered UUID mappings/enrollment on a copy, exercise deployment-specific quotas/latency and browser storage behavior, coordinate the backend lock/old-client upload guard, and obtain rollout approval. These are deployment prerequisites, not remote actions performed here. Conflicting/corrupt recovery evidence requires authorized human inspection; the implementation intentionally does not guess a destructive repair.

Phase 3 weekly/night/rest rules, Phase 4 lifecycle/publication, amendments, replacement workflows, GOFF accounting and workspace redesign remain deferred. Nothing is staged, committed, pushed, merged or deployed by this Phase 2 task.

## Final Review — 2026-09-09

**Verdict: PASS after scoped corrections and 23 additional regression tests.** Review began on major-update-v2 at b64232f210afdb12d2aaefa4d958878a279e1eec with exactly five modified and thirteen untracked Phase 2 files, no staged changes, and main at a852f0ace8966c8fcbce88166e4dfc3081f5476c. All eighteen Phase 2 files, the complete specification/plan and Phase 1 handoff, the generated source and relevant legacy mutation boundary were inspected. The earlier implementation report was not accepted as proof.

| Severity | Location | Defect | Correction | Regression evidence |
| --- | --- | --- | --- | --- |
| High | queue/draftQueue.js, persistIntent | Retrying an earlier local persistence failure could overwrite a newer successfully persisted edit. | Serialize persistence per entity; preserve later intent in order behind an unresolved storage failure. Discard is unavailable while a persistence operation is active. | Failed A followed by B retains B before/after persistence retry and server confirmation. Existing scoped Revert tests preserve later same-cell and independent-cell proposals. |
| High | queue/state.js and draftQueue.js, stored-record loading/dispatch | Only the entity schema number was checked. Unknown/contradictory states could enter the queue; a corrupted sent payload could be rehashed and retried with changed meaning. | Validate entity/operation shape, statuses, identities, sequence, revisions, assignment sets, and confirmed-baseline/payload hashes before loading or dispatching. Invalid data remains stored, produces an explicit local error, and cannot send or appear confirmed. | Malformed states/payloads/revisions/sequences, duplicate operations, unsupported schema and changed sent payload are rejected without storage erasure or network dispatch. A crash before initial hashing still completes that frozen hash and queries its original UUID before sending. |
| High | backend/roster-draft.gs, rosterDraftRoute_ | Write switches were checked only before bounded lock acquisition; a switch disabled during the wait did not stop the write. | Recheck both switches under the acquired lock before every mutation route. | Lock-acquisition hook disables the queue switch; the queued request returns FEATURE_DISABLED, releases its lock and makes zero writes. |
| Medium | backend/roster-draft.gs, rosterDraftLogs_ | Blank/Boolean revision cells were coerced to zero, and journal operation type/diagnostic identities were not validated. Corrupt rows could be treated as valid. | Validate journal identity, type, entity, hash and numeric revision relationships before read/replay/recovery. | Malformed fields and duplicate journal IDs fail closed with RECOVERY_REQUIRED and no extra writes. |
| Medium | DraftQueuePanel.jsx effect; draftQueue.js start/stop | A delayed schema/refresh response could start an obsolete refresh interval after unmount. Overlapping asynchronous starts could also install multiple schedulers. | Check effect liveness after each awaited initialization step; use a start/stop generation to invalidate superseded starts. Recheck dispatch eligibility after asynchronous reads. | Delayed schema completion after unmount makes no draft read; overlapping starts leave exactly one scheduler and stop clears it. |
| Medium | DraftQueuePanel.jsx editor text synchronization | Revert updated the table but left the abandoned value in the editable textarea, allowing accidental resubmission. | Synchronize editable text with the selected cell's projected value. | Reverting AM clears both its optimistic table value and editable text. |
| Medium | queue/draftQueue.js scheduler | Known offline state still dispatched work and consumed retry attempts, potentially exhausting a safely queued edit before reconnection. | Pause automatic dispatch/status scheduling while offline; preserve durable intent and resume through the same ordered scheduler. | Offline queues make zero calls/attempts; concurrent reconnect ticks produce one confirmed effect. Actual transport loss still follows status reconciliation. |
| Medium | backend/roster-draft.gs prerequisite reads; queue/protocol.js entity validation | Read failures before any mutation and a zero-year entity were misclassified as ambiguous recovery. | Return TRANSIENT_BACKEND for unavailable prerequisite reads, and VALIDATION_FAILED for invalid zero-year entities. | Settings, enrollment and identity read failures are retryable with zero writes; invalid year is rejected before journaling. |
| Low | queue/indexedOutbox.js open | A blocked open promise could reject and subsequently open an unowned connection, leaving an upgrade blocker. | Close a late successful connection after rejection. | Unavailable/blocked IndexedDB reject; simulated late success closes exactly once. Real transaction/reload tests remain in place. |
| Low | queue/protocol.js canonical revision | Negative zero and zero have the same JSON wire revision but produced different typed hashes. | Normalize zero at the operation meaning boundary without changing raw text or the Phase 1 snapshot serializer. | Negative-zero/zero hashes match and server confirmation succeeds; nested values, raw whitespace and assignment order remain meaningfully distinct. |

The final suite contains 72 Phase 2 tests (28 backend, 44 browser/queue/editor/integration), all passing, plus the unchanged 66 Phase 1 tests and five legacy suites. Total: 138 Node tests plus five legacy suites, zero failures/skips. Review added eight backend tests and fifteen browser/integration tests. No pre-review test was removed or weakened. Targeted pre-fix runs reproduced the persistence-order, malformed/corrupted outbox, switch-wait, journal validation, offline scheduling, blocked-open, unmount, Revert-text and error-classification failures. New stress assertions also cover three distinct A/B/C operations through lost responses, simultaneous manual reconciliation, repeated backend recovery/FAILED replay, explicit conflict review/Revert/new-edit at revision 5/6/7, duplicate/malformed channel messages, A/B/A coalescing, missing/false-like switches and type/hash boundaries.

Persistence schema remains version 1: no store/index/header migration, deletion or automatic repair was introduced. Unknown schema or malformed state is retained for reviewed recovery. For a sent record, a null hash is permitted only at the durable SENDING-before-hashing crash boundary; it is completed before status reconciliation. Non-durable intents are serialized independently for each entity, so a storage failure cannot reorder later intent. Lifecycle ownership, public legacy reads, enrollment and the two-switch authorization boundary are unchanged. Existing tests use real IndexedDB/Web Locks/BroadcastChannel and headless Chrome; backend behavior is simulated locally. The blocked-open edge uses a controlled request stub, and execution quotas/real Sheets partial-write timing remain deployment-time checks, not claims proven by this simulator.

The platform review checked bounded lock acquisition, automatic release on termination, and flushing spreadsheet changes before explicit release against the [Apps Script Lock reference](https://developers.google.com/apps-script/reference/lock/lock). IndexedDB transaction completion/abort and upgrade blocking were checked against [IDBTransaction](https://developer.mozilla.org/en-US/docs/Web/API/IDBTransaction) and [blocked events](https://developer.mozilla.org/en-US/docs/Web/API/IDBOpenDBRequest/blocked_event). These were public documentation reads only; no workbook or deployment endpoint was accessed.

Files changed in this review only: appscript.txt (regenerated); backend/roster-draft.gs; src/features/roster/queue/draftQueue.js, indexedOutbox.js, protocol.js, state.js; src/features/roster/components/DraftQueuePanel.jsx; tests/phase2/backend.test.mjs, browser-cases.js, browser.test.mjs, ui-fixture.jsx; this handoff. Other Phase 2 files, all Phase 1 tests/source contracts, governing documents, historical handoffs, dependencies/lockfile and tracked build output remain unchanged from review entry.

All five local exit gates remain PASS: no duplicate operation, no stale overwrite, no whole-array rollback, durable recovery, and legacy compatibility. No known local Phase 2 blocker remains. Before enablement, separately verify live caller identity/access and credentialed cross-origin transport, deliberate copied-workbook setup/enrollment, quotas/latency, storage behavior, and coordinated upload protection. No workbook access, staging, commit, push, merge, deployment or Phase 3 work occurred in this review.
