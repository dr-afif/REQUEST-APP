# Major Roster Update — Product Specification

> **Status:** Phase 0 PASSED with owner approval on 2026-09-07. Phase 1 implemented locally; no deployment or Phase 2+ work.\
> **Specification baseline:** `REQUEST-APP` commit `a852f0a` (2026-09-04).\
> **Evidence boundary:** Phase 0 closure, immutable deployed Version 1 source reconciliation and owner-approved workbook/operational evidence are recorded in docs/MAJOR_UPDATE_PHASE_0_READINESS.md. No production access occurred during Phase 1. Baseline current-state findings below describe commit a852f0a; Phase 1 changes and validation are in docs/MAJOR_UPDATE_PHASE_1_HANDOFF.md.

## Owner-approved clarifications — 2026-09-07

These explicit owner decisions refine the baseline below: COURT is worked duty without ED coverage, is not a Policy B night and can displace OFF. EP identities/assignments are display-only for MO rules and never contribute to MO staffing, consecutive work, OFF, GOFF or GHKA; office-hour/on-call pairs remain separate. MO SYU/Syu/SYUHADA/Syuhada resolve together; EP Dr/title/case variants resolve within the EP domain without fuzzy matching other people. Preserve historical raw rows and valid multiple assignments; multiple worked shifts on a date contribute one worked calendar day. PN remains transparent and generic legacy nights are never inferred as ON1/ON2. Standby indicates designation rather than attendance; base/actual assignments determine semantics.

Authoritative future MO staffing defaults are AM minimum 2, PM minimum 3, night 2/day; PM>=AM and PM-AM<=1 are advisory on all calendar days, with HOD-authorized exceptional holiday reduction. These approved values replace any unresolved staffing input, while the baseline description of existing device-local defaults remains factual. Phase 1 exposes constants/semantic contracts only, not the later validation or ledger engines. Requests blank L/M and accidental M638 formula are not new application schema. Historical duplicate Active requests, orphan references and note/date discrepancies must load without correction.

## 1. Purpose and scope

This update turns the existing editable monthly roster into a safely versioned roster workflow while preserving the current Google Sheets-backed application and all historical data.

The scope is:

- effective-dated weekly normal-OFF guidance across complete Monday–Sunday weeks;
- a `Draft → Published → Amended → Closed` lifecycle;
- immutable planned rosters plus current and amendment views;
- contextual absence, replacement, swap, correction, and reversal workflows;
- an auditable, non-expiring per-person GOFF ledger;
- advisory staffing, weekly-OFF, consecutive-work, rest, conflict, and GOFF checks;
- consistent optimistic UI with explicit pending, failure, retry, rollback, and conflict states;
- a denser, more usable desktop roster workspace without changing established mobile navigation unnecessarily; and
- additive, reversible handling of existing and historical roster data.

This specification distinguishes:

- **Confirmed requirement** — mandated product behavior in this update.
- **Implementation recommendation** — the preferred design based on the verified codebase, subject to technical validation.
- **Deployment input/technical finding** — a rollout value or repository/runtime fact that must be supplied or verified before its stated enablement gate; it is not an unresolved product-design rule.

## 2. Verified current state and problem statement

The application is a static Vite/React site. `src/App.jsx` owns most state, cache hydration, one-minute refresh, and optimistic mutations. `src/api.js` calls a Google Apps Script web app. `appscript.txt` is the backend source expected by the frontend, and Google Sheets is the authoritative store.

The current roster does not have a real lifecycle:

- `MasterRoster` stores row-per-assignment data with the contract `Name`, `Date`, `Shift`.
- Roster editing reconstructs an in-memory month grid from all `MasterRoster` rows.
- **Save Changes** flattens the grid and calls `uploadmasterroster`.
- The backend clears every non-header row in `MasterRoster`, not only the selected month, and then writes the submitted rows.
- The UI immediately leaves edit mode because `RosterPage.handleSave` does not await backend confirmation.
- The same rows are treated as both the official and current roster. There is no immutable planned snapshot, amendment event, period revision, state record, or close/reopen audit.
- The UI describes the roster as “official finalized” while still allowing direct overwrite.

Current guidance is monthly and derived:

- The table and member tallies iterate only the dates visible in the selected month.
- Night aliases `ON`, `ON1`, `ON2`, `N`, and `NIGHT` are normalized to `NIGHT`; parts of the current tally/analytics code place `PN` in the same active-shift set as worked duties. That current treatment is incompatible with the resolved `PN` semantics and requires careful shared-classification refactoring.
- Default local tally thresholds are AM minimum 1, PM minimum 1, night minimum 1, night maximum 2, and total leave maximum 4. They are saved only in `localStorage` under `rosterTallyThresholds`.
- Coverage warnings exist, but there is no weekly-OFF calculation, consecutive-work rule, or insufficient-rest rule.

Current public-holiday replacement tracking is not a transaction ledger:

- `src/utils/publicHolidayTracker.js` derives earned public-holiday credits from worked shifts on configured public holidays and derives GHKA use from `MasterRoster`.
- It FIFO-matches inferred credits to inferred GHKA use.
- Opening balances are stored as one JSON value (`phTrackerOpeningBalances`) in `Settings`, with a localStorage fallback, and are updated on each input change.
- It has no immutable credit/use/reservation identifiers, authorization reasons, reversal trail, or safe concurrent update model.
- This existing **HKA/GHKA** feature concerns public-holiday replacement. The new **OFF/GOFF** feature is a separate entitlement and must not reuse those terms interchangeably.

Current optimistic updates are inconsistent with the required reliability level:

- Several mutations immediately update whole React arrays, start an untracked background request, then refresh all data.
- Failure restores a captured whole-array snapshot, which can overwrite a newer local edit.
- There is no ordered queue, per-entity serialization, idempotency key, expected revision, persistent outbox, or multi-tab conflict handling.
- Success/failure is communicated mainly through one toast per operation.

## 3. Definitions and shift terminology

| Term | Meaning in this specification |
|---|---|
| Roster period | A calendar month managed through one lifecycle record. |
| Roster week | Monday 00:00 through Sunday 23:59 in the roster’s operational timezone, even when the week spans two months or years. |
| Planned/original shift | The immutable assignment captured when its owning monthly roster period is published. |
| Current shift/status | The effective assignment after applying all active amendments to the planned shift. |
| Draft | Editable, unofficial roster data with projected validations and GOFF effects. |
| Published | Official roster with immutable planned assignments and policy snapshots. |
| Amended | A published roster with one or more active amendments. |
| Closed | A completed and reconciled month. Reopening is deliberate and audited. |
| Amendment event | One auditable operation containing one or more linked cell changes and any linked GOFF effects. |
| `OFF` | Normal weekly day off. It is the only value that satisfies weekly normal-OFF entitlement. |
| `GOFF` | Replacement day off after a planned normal `OFF` was displaced by a qualifying duty-related assignment or required `PN`. It does not satisfy weekly normal-OFF entitlement. |
| `HKA` | Existing public-holiday-off status. It is not `OFF` or `GOFF`. |
| `GHKA` | Existing replacement public holiday. It is separate from `GOFF`. |
| Qualifying night-related shift | Planned `ON1`, `ON2`, `PN`, or legacy `ON`, `N`, or `NIGHT` in the complete Monday–Sunday week. Any one qualifies for Policy B’s one-normal-OFF branch. |
| Worked shift | A duty that increments consecutive work and ordinarily provides staffing coverage: initially `AM`, `PM`, `AMX`, `PMX`, `ON`, `ON1`, `ON2`, `N`, `NIGHT`, `OH`, plus configured worked codes. `PN` is explicitly not a worked shift. |
| Transparent shift | A value that neither increments nor resets an existing consecutive-work sequence. Initially this is `PN`. |
| Break/reset status | `OFF`, `GOFF`, `AL`, `MC`, `EL`, `HKA`, `GHKA`, `COURSE`, blank, and other configured non-working statuses. These reset consecutive work. |
| Reservation | A confirmed claim against available GOFF for a future published `GOFF` assignment. |
| Reconciliation | The deliberate process that converts eligible reservations/pending credits into used/earned ledger transactions. |
| Public operational category | Viewer-visible category such as `MC`, `EL`, `Coverage`, or `Shift swap`. It contains no sensitive free text. |
| Administrative note | Free text visible only to the administrator and protected by server-side authorization. It must not contain diagnoses or other unnecessary medical detail. |

`ON1` is the first night shift, `ON2` is the second night shift, and `PN` is the recovery day after night duty. `ON`, `N`, and `NIGHT` are legacy night aliases used before `ON1`/`ON2`. Standby and extended markers currently encoded as `(S)`/`-S` and `(X)`/`-X` inherit the semantic classification of their base shift; they do not create separate weekly-OFF or GOFF categories. Unknown codes are preserved and surfaced for mapping rather than guessed.

## 4. Personas and permissions

### 4.1 Sole roster administrator

**Confirmed requirement:** There is one roster maker/administrator. Do not introduce multiple administrative role types.

The administrator can:

- create, edit, and autosave drafts;
- publish rosters;
- apply and reverse amendments;
- accept staffing shortages with a required reason;
- manage GOFF commencement, opening balances, adjustments, and deliberate exceptions;
- close and reopen months; and
- view audit and conflict information.

### 4.2 General roster viewer

General viewers are read-only. They can see the current roster, original planned roster, change history, and operational categories such as `MC`, `EL`, `Coverage`, and `Shift swap`. Free-text administrative notes are administrator-only. Neither public nor administrative forms should request diagnoses or unnecessary sensitive medical detail.

### 4.3 Security boundary

**Verified finding:** Current admin gating is a client-side four-digit PIN (`VITE_ADMIN_PIN`, defaulting to `1234`) plus session state. The Apps Script endpoints do not enforce administrator identity.

**Implementation requirement:** Retain a single-admin product model, but establish server-side authorization for lifecycle, amendment, ledger writes, and administrator-only note reads before production rollout. The current client PIN must not be treated as protection for private notes. This is security hardening, not a multi-role system.

## 5. Confirmed weekly OFF rules

1. A roster week is always the full Monday–Sunday interval.
2. A month view must load adjacent-month dates needed to evaluate each visible week.
3. Policy is effective-dated. Each effective date must be a Monday.
4. Initially supported policies are:
   - **Policy A:** every person requires one normal `OFF` in the week;
   - **Policy B:** a person with at least one planned `ON1`, `ON2`, `PN`, `ON`, `N`, or `NIGHT` requires one normal `OFF`; a person without one requires two normal `OFF` days.
5. A shared week record is keyed by Monday `weekStart`. It locks the effective policy selected from `weekStart`; a later policy change must not recalculate that week.
6. Night qualification comes from the published planned roster, never from later current-state changes.
7. Later `MC`, `EL`, replacement, correction, reversal, or actual attendance changes must not retroactively change the required OFF count.
8. Only exact base shift `OFF` counts toward the entitlement.
9. `GOFF`, `MC`, `EL`, `AL`, `PH`/`HKA`, `GHKA`, `COURSE`, blank cells, and any other non-working status do not satisfy it.
10. Guidance is advisory. It must not assign, move, or delete a shift automatically.
11. Each person/week guidance row must show applied policy, qualifying-night yes/no, required OFF, planned assigned OFF, current operational OFF outcome, and complete/shortfall status.
12. If any of the seven dates lacks a published planned assignment because the adjacent monthly period is not yet published, guidance is `Incomplete`/`Provisional`; it must not claim compliance or shortfall.

### 5.1 Weekly examples

| Example | Complete week | Planned shifts relevant to rule | Policy | Result |
|---|---|---|---|---|
| Cross-month, one OFF | Mon 29 Jun–Sun 5 Jul | `OFF` on 1 Jul | A | Required 1, assigned 1, complete. June-only calculation would be wrong. |
| Cross-month shortfall | Mon 29 Jun–Sun 5 Jul | No `OFF`; `AL` on 30 Jun | A | Required 1, assigned 0, shortfall 1. `AL` does not substitute. |
| Night-qualified | Mon 3–Sun 9 Aug | Planned `ON1` on Tue and `OFF` on Fri | B | Qualifying night yes; required 1, assigned 1, complete. |
| Legacy night-qualified | Mon 3–Sun 9 Aug | Planned legacy `NIGHT` on Tue and `OFF` on Fri | B | Qualifying night yes; required 1, assigned 1, complete. |
| No qualifying night | Mon 3–Sun 9 Aug | `AM`/`PM` only and one `OFF` | B | Qualifying night no; required 2, assigned 1, shortfall 1. |
| GOFF is separate | Mon 3–Sun 9 Aug | One `GOFF`, one `OFF`, no qualifying night | B | Required 2, assigned normal OFF 1, shortfall 1. |
| Later absence | Planned `ON2` is amended to `MC` | Planned roster still contains `ON2` | B | Qualification remains yes and required OFF remains 1. |
| Displaced planned OFF | Planned `OFF` is amended to current `PN` | Planned roster contains no qualifying night for that person | B | Planned qualification does not change. Planned OFF compliance remains visible, current operational OFF shows not taken, and the displacement creates one projected GOFF earn. |
| Policy change | Policy A effective through Sun 6 Sep; Policy B effective Mon 7 Sep | Any | Snapshot | Week starting 31 Aug uses A; week starting 7 Sep uses B. |
| Incomplete boundary week | June is published; 1–5 Jul belongs to an unpublished July period | Policy is locked from Mon 29 Jun | Any | Mark Provisional/Incomplete and do not claim compliance until July publishes. June publication does not own or lock July assignments. |
| Cross-year complete week | Mon 28 Dec–Sun 3 Jan; both December and January periods are published | Assignments remain owned by their respective months | Any | Evaluate all seven dates once using the policy effective on 28 Dec. |

### 5.2 Boundary-week publication

Each monthly roster publishes independently and owns only its calendar dates. A shared weekly record is keyed by Monday `weekStart`; the first touching publication locks only the policy selected from that date, not the other month’s assignments.

Until both touching monthly periods have published all seven planned dates, the shared week is `Incomplete`/`Provisional` and shows no false compliance result. The second publication supplies only its own dates, reuses the locked policy, and triggers the complete Monday–Sunday evaluation. It cannot overwrite dates owned by the first period. Duplicate or incompatible ownership is a conflict requiring correction or amendment. Publishing one month never requires the following month to be prepared early. The same rule applies across year boundaries.

## 6. Roster lifecycle

```text
Draft --Publish Roster--> Published --first active amendment--> Amended
                              ^                                  |
                              |<--reverse final active amendment-|

Published --Close/Reconcile-------------------------------> Closed
Amended   --Close/Reconcile-------------------------------> Closed
Closed    --confirmed reopen--> Published or Amended
```

The state transition must be atomic with its audit record.

### 6.1 Draft

- Editable and autosavable.
- Not visible as the official roster to general viewers.
- Uses projected staffing, weekly-OFF, conflict, consecutive-work, rest, and GOFF calculations.
- Draft GOFF assignments and credits are projections only.
- Can be explicitly discarded only with confirmation.

### 6.2 Published

- Is the official planned roster.
- Captures immutable planned assignments, week-policy snapshots, a revision/checksum, and publication metadata.
- Makes future GOFF reservations.
- Direct editing is disabled; operational changes use amendments.
- UI action label is **Publish Roster**, not “Finalise.”

### 6.3 Amended

- Has the same immutable planned snapshot as Published.
- Has one or more active amendment events.
- Presents current, original planned, and changes views.
- Reversing the last active amendment returns the lifecycle label to Published while retaining full event history.

### 6.4 Closed

- Represents a completed and reconciled month.
- Closing is always manual. The UI may prompt after month-end but never closes automatically.
- Closing requires explicit confirmation and a reconciliation preview.
- Pending/failed official writes or unresolved ledger inconsistencies block closing.
- Converts eligible confirmed GOFF reservations to used transactions.
- Converts eligible pending earned-GOFF projections to earned credits under the recommendation in §9.4.
- Rejects normal amendment writes.
- Reopen requires explicit confirmation, reason, operation ID, actor, timestamp, and revision increment.
- Reopening returns to Published or Amended according to whether active amendments remain.
- Corrections after reopening use normal amendment/reversal transactions; no history is deleted.

## 7. Planned, current, and amendment behavior

For legacy cells without new lifecycle records, planned and current values are identical.

For a published roster:

```text
planned assignment (immutable)
        + ordered active amendment lines
        = current assignment/status
```

The viewer provides:

- **Current roster** — default operational view;
- **Original planned roster** — immutable publication snapshot; and
- **Changes** — amendment events and affected cells.

An amended cell must expose:

- current assignment/status;
- original planned assignment;
- change reason;
- linked affected staff;
- GOFF effect, including pending/confirmed/reversed state;
- amendment timestamp and event ID; and
- save state if the transaction is still pending or failed.

Amendments are append-only events. A correction to an amendment is a reversal plus a new event, not mutation or deletion of history.

Weekly guidance distinguishes the immutable **planned OFF compliance at publication** from the **current operational OFF outcome**. If a planned `OFF` is displaced later, the original view and publication result retain that planned OFF, while the current view shows that the OFF was not actually taken and exposes any linked GOFF effect.

## 8. Contextual amendment workflows

Selecting a cell in amendment mode offers only relevant actions:

- Record absence
- Assign replacement
- Swap shifts
- Administrative correction
- View history

Fields appear progressively according to the action. Before commit, an impact preview shows original and proposed current values, staffing before/after, weekly-OFF effect, GOFF effect, conflicts, and warnings.

After a confirmed save, show clear confirmation and keep **Undo** prominently available for 10 seconds. Undo creates a reversal transaction. After 10 seconds, the permanent **Reverse Amendment** action remains available in history.

### 8.1 Absence only

1. Administrator selects the affected planned/current cell.
2. Chooses `MC`, `EL`, or another allowed absence status.
3. Selects a viewer-visible, non-sensitive operational category. Optional free-text administrative notes are administrator-only. For `MC`, do not solicit diagnosis.
4. Preview compares staffing before and after.
5. If staffing remains at/above configured minimum, replacement is optional.
6. If below minimum, recommend replacement. The administrator may accept the shortage only with a reason.
7. Confirm creates one amendment event and one affected line.

### 8.2 Absence with replacement

Example:

- Siti planned `PN` → current `MC`.
- Ahmad planned `OFF` → current `PN`.
- Both lines share one amendment event ID.
- Ahmad receives exactly one projected GOFF earn because required `PN` displaced his planned normal `OFF`; it becomes an earned credit at reconciliation.

`PN` provides no staffing coverage, does not increment or reset Ahmad’s consecutive-work sequence, and does not satisfy normal weekly OFF. These semantics do not change the linked replacement workflow or its atomicity.

The replacement selector must use existing staffing thresholds and show before/after counts. Suggested people are advisory.

### 8.3 Shift swap

- Captures both people and both dates/shifts in one event.
- Validates that each proposed current assignment is unambiguous.
- Shows effects on staffing, weekly OFF, GOFF, consecutive work, and rest for both people.
- Applies all linked lines atomically or none.

### 8.4 Administrative correction

- Requires a reason.
- Is used for data correction that is not an operational absence or swap.
- Does not rewrite the planned snapshot.
- Any GOFF impact must be explicit in preview and ledger linkage.

### 8.5 Reversal

- Restores the current state that existed immediately before the target event, provided no later dependent event makes automatic reversal unsafe.
- If later dependencies exist, present a conflict and require a new administrative correction rather than silently overwriting them.
- Appends reversal records for amendment and GOFF effects.
- Never deletes original events.

## 9. GOFF ledger

GOFF tracking begins on the first day of the first monthly roster period enrolled in the new lifecycle. The exact calendar month is a deployment input recorded before GOFF is enabled. The administrator supplies a confirmed opening balance and source note for every applicable person. Implementation may proceed before those values are available, but production GOFF enablement remains blocked until the commencement record and all opening balances are recorded and reconciled. No pre-commencement roster is reinterpreted and no historical GOFF is inferred.

### 9.1 Confirmed accounting rules

For each person:

```text
Current balance = opening balance + earned credits − used credits ± authorised adjustments
Available to assign = current balance − active reservations
Projected balance = available to assign + projected earns − draft/proposed uses
```

- GOFF belongs to the person, carries across months indefinitely, and never expires.
- Units are whole days.
- A planned normal `OFF` displaced by a duty-related assignment or required `PN` earns one GOFF.
- Qualifying displacement initially includes `AM`, `PM`, `AMX`, `PMX`, `ON`, `ON1`, `ON2`, `N`, `NIGHT`, `OH`, configured worked duties, and specifically `PN`.
- `PN` earns under this rule because it displaced the normal OFF for required post-night recovery, not because it is worked or provides staffing coverage.
- Changing planned `OFF` to ordinary `MC`, `EL`, `AL`, or another non-duty absence does not automatically earn GOFF. A deliberate manual exception requires a reason and audit record.
- Working a planned `GOFF` earns no new GOFF; the existing reservation is released/not consumed.
- GOFF does not count as the current week’s normal `OFF`.
- Draft effects are projections only.
- A GOFF in a published future roster creates a reservation.
- Cancelling or replacing a future GOFF releases its reservation.
- Credits reserved in any other published future roster reduce available-to-assign balance.
- Negative available balance is blocked by default.
- The sole administrator may deliberately override with a mandatory reason and audit event.
- A historical/manual adjustment is preferred over an unexplained negative balance.
- Every opening credit, earn, reservation, release, use, reversal, and adjustment has a unique transaction ID and audit link.
- The source amendment and person/date may produce at most one active earn entitlement; retries or linked-line duplication must not create a second credit.

### 9.2 Ledger display

The UI shows per person:

- opening balance;
- earned credits;
- active reservations;
- used credits;
- net authorised adjustments;
- current balance;
- available balance;
- projected balance; and
- each outstanding credit’s age and source.

No total may be derived solely from the mutable current roster once the ledger is enabled.

### 9.3 Examples

These are illustrative balance snapshots; the worked-duty and `PN` displacement rows show alternative ways to earn one unit rather than two cumulative earns.

| Event | Opening | Earned | Reserved | Used | Adjustment | Current | Available |
|---|---:|---:|---:|---:|---:|---:|---:|
| Confirmed opening position | 2 | 0 | 0 | 0 | 0 | 2 | 2 |
| Published future GOFF | 2 | 0 | 1 | 0 | 0 | 2 | 1 |
| Month closes and GOFF is completed | 2 | 0 | 0 | 1 | 0 | 1 | 1 |
| Planned OFF becomes worked duty; reconciled | 2 | 1 | 0 | 1 | 0 | 2 | 2 |
| Alternative: planned OFF becomes PN; reconciled | 2 | 1 | 0 | 1 | 0 | 2 | 2 |
| Authorised correction of +1 | 2 | 1 | 0 | 1 | +1 | 3 | 3 |

If a person planned as `GOFF` is amended to a worked shift before completion, the reservation is released and no earned credit is created. If a person planned as `OFF` is amended to a qualifying worked duty or `PN`, exactly one projected earn is linked to that amendment and becomes earned only on reconciliation. Reversing the `OFF → PN` amendment appends a compensating reversal for its linked projection/credit; it never deletes either record.

### 9.4 Recommended posting timing

To avoid granting credit for work that has not occurred:

- Confirming a future amendment from planned `OFF` to a qualifying worked duty or required `PN` creates one linked `PENDING_EARN` projection, not spendable balance.
- Publishing a future current `GOFF` creates `RESERVE` immediately after Sheets confirms publication.
- Closing/reconciling the month atomically converts eligible `PENDING_EARN` to `EARN` and each still-valid `RESERVE` to `USE`.
- A pre-close cancellation produces `RELEASE`; a reversal produces linked compensating records.
- No passage-of-time timer alone posts an earn or use.

This timing must be tested against operational practice before rollout, but implementation must choose and document one deterministic rule.

## 10. Smart replacement suggestions

Suggestions must exclude or clearly warn for people who are:

- already assigned to another shift on the target date;
- on leave, `OFF`, or `GOFF`;
- insufficiently rested after night duty;
- at risk of excessive consecutive working days;
- at risk of losing required weekly `OFF`.

Ranking may consider staffing fit and fairness, but must explain why a person is suggested or warned. No reliable skill/role eligibility source currently exists, so the initial release does not automatically filter on that basis and every suggestion states **Eligibility not checked**. The sole administrator confirms operational suitability. A verified eligibility source may be added later.

The administrator makes the final decision. No suggestion automatically changes a shift.

## 11. Night bundles, consecutive work, and rest guidance

These are three separate advisory checks. None silently edits or blocks the roster, although the administrator must be able to see and acknowledge each warning. They evaluate complete date sequences across week, month, and year boundaries. Planned view uses planned assignments; current view uses current assignments; amendment preview shows the proposed current result.

### 11.1 Shared semantic classification

All validators use one configurable classification rather than separate hard-coded arrays:

| Classification | Initial codes | Consecutive behavior | Staffing coverage |
|---|---|---|---|
| Worked | `AM`, `PM`, `AMX`, `PMX`, `ON`, `ON1`, `ON2`, `N`, `NIGHT`, `OH`, plus configured worked codes | Increment | Yes, subject to configured shift/tally mapping |
| Transparent | `PN` | Preserve count without incrementing | No |
| Break/reset | `OFF`, `GOFF`, `AL`, `MC`, `EL`, `HKA`, `GHKA`, `COURSE`, blank, plus configured non-working statuses | Reset | No |
| Unknown | Unmapped raw code | Do not guess; surface mapping issue | Do not assume |

Modifiers such as `(S)` and `(X)` inherit the base shift classification. Independently configurable properties also record Policy-B qualification, whether a shift can displace OFF and earn GOFF, and expected night-bundle predecessor/follower.

### 11.2 Consecutive-work warning

- The configurable recommended maximum is six consecutive worked days.
- Assigning a seventh consecutive worked day creates an advisory warning requiring visible acknowledgement; it does not block the assignment.
- `PN` is transparent: it neither increments nor resets the existing sequence.
- Break/reset statuses end the sequence.

Example:

```text
OFF – AM – AM – ON1 – ON2 – PN – PM – PM – OFF
      1    2     3     4      —    5    6
```

The result is six consecutive worked days. A worked assignment in place of the final `OFF` would be the seventh and would warn.

### 11.3 Night-bundle integrity

Recognized sequences are:

```text
ON1 → ON2 → PN
ON1 → PN
ON/N/NIGHT → PN
```

`ON1 → PN` is valid because a person may work one night rather than continuing to `ON2`.

Bundle checks include:

- `ON1` should be followed by `ON2` or `PN`;
- `ON2` should normally follow `ON1` and should be followed by `PN`;
- legacy `ON`, `N`, or `NIGHT` should be followed by `PN`; and
- isolated or unexpected `PN` is flagged for review.

Approved absence or administrative exceptions remain possible and are acknowledged with an operational reason.

### 11.4 Post-night rest

- If `OFF`, `GOFF`, `AL`, `MC`, `EL`, `HKA`, `GHKA`, `COURSE`, or another configured non-working status immediately follows a night shift, rest is protected, but bundle integrity may still warn because `PN` was not recorded.
- If a worked assignment such as `AM`, `PM`, or `OH` immediately follows a night shift without `PN`, show both the applicable bundle-integrity warning and post-night-rest warning. A valid `ON1 → ON2` continuation is not treated as this unsafe case; the required recovery check applies after `ON2`.
- `PN` is the expected recovery marker and provides no staffing coverage.

**Verified finding:** The current project has no such sequence engine. Its existing “consecutive” code only joins adjacent leave dates into leave episodes, and some current active-shift logic incorrectly groups `PN` with worked duties.

## 12. Issues panel

Provide one consolidated, collapsible panel containing at least:

- staffing shortages;
- missing weekly `OFF`;
- GOFF over-allocation or negative override;
- night-bundle integrity;
- excessive consecutive work;
- insufficient rest;
- conflicting/double assignments;
- incomplete cross-month context; and
- failed or pending saves.

Each item includes severity, person/date/week, plain-language reason, and resolution state. Selecting it focuses the affected person and date, opens the relevant detail, and preserves a keyboard-visible focus indicator.

## 13. Desktop and mobile experience

### 13.1 Desktop

- Add a collapsible sidebar: expanded icons+labels; collapsed icons with accessible names/tooltips.
- Remember the preference on that device.
- Prefer collapsed state while roster editing is active.
- Focus Mode hides non-essential navigation/header content and maximizes roster space; exiting Focus Mode must remain obvious and keyboard accessible.
- Display modes:
  - **Fit Month** — all dates fit the available width; recommended default;
  - **Fit Entire Roster** — attempts to fit dates and staff simultaneously; and
  - **Comfortable** — larger cells with scrolling.
- Compute sizes from available width/height, date count, and staff count.
- In Fit modes, never reduce roster-cell text below 10 px. Prefer a larger compact size when space permits; if fitting would cross 10 px, preserve the minimum and introduce controlled scrolling.
- Comfortable mode uses approximately 13–14 px roster-cell text.
- Remember display preference on the device.
- Provide sticky staff-name column and sticky date/day headers.
- Preserve clear Monday–Sunday boundaries and subtle weekends.
- Highlight selected row and date column.
- Preserve roster scroll position through background saves and view navigation.
- Support keyboard movement, activation, editing, Undo/Redo, and escape/cancel paths.
- Include staff search, selected/current-week focus, collapsible tally/guidance, compact shift legend, and full details for truncated cells.

### 13.2 Mobile

- Preserve the current top header and bottom navigation unless usability testing establishes a need to change them.
- Use the existing responsive bottom-sheet pattern for cell/amendment details where practical.
- Do not require hover for history, warnings, or tooltips.
- Maintain at least 44×44 CSS-pixel touch targets for important controls and adequate spacing between targets.
- Avoid forcing the complete desktop editing grid into an unreadable fit mode; prioritize selected day/person context and controlled horizontal scrolling.

## 14. Optimistic UI and save-state model

### 14.1 Operation classes

| Class | Examples | Display rule |
|---|---|---|
| Routine/reversible | Draft cell edits, shift selection, notes, local preferences, filters, selection, draft Undo/Redo | Apply immediately; queue background save. |
| Official but reversible | Amendments, `MC`/`EL`, replacements, GOFF credits/reservations/uses/releases/reversals | May render immediately as visibly **Pending**; never appear confirmed before Sheets confirmation. |
| Critical lifecycle/accounting | Publish, close, reopen, opening-balance changes, manual adjustments/exceptions, negative override | Show progress, but do not show success or update authoritative totals/state until Sheets confirms. |

### 14.2 Required operation states

```text
local edit → queued → sending → confirmed
                    ↘ failed → retrying → confirmed
                              ↘ reverted
                    ↘ conflict → review/rebase/revert
```

The application must retain both the optimistic value and last-confirmed value. Per-cell and global state must be visible without freezing unrelated cells.

Persistent status examples:

- `All changes saved`
- `Saving 3 changes…`
- `1 change failed — Review`
- `Connection unavailable — Changes retained locally`

Use one persistent status surface plus the issues panel. Do not emit a repetitive toast for every background edit.

### 14.3 Queue and recovery rules

- Serialize writes per roster period/entity while allowing unrelated safe reads/interactions.
- Debounce and batch rapid draft edits.
- Give every operation a client-generated unique ID and reuse it on retry.
- Disable/guard the initiating control against double submission.
- Reject stale responses using operation sequence and server revision.
- Persist a safe pending outbox across accidental refresh where feasible.
- Warn before navigation/unload when an operation cannot safely survive it.
- Detect multiple-tab/device conflicts with expected period revisions and, locally, browser channel/storage events.
- Never roll back an entire collection when only one operation failed.
- Retry transient errors with bounded backoff; make permanent validation errors actionable.
- Provide explicit **Retry** and **Revert** controls.

## 15. Errors, reversals, and conflicts

| Condition | Required behavior |
|---|---|
| Temporary network failure | Keep routine draft edit locally, mark failed/offline, retry safely with same operation ID. |
| Permanent validation failure | Restore only the affected entity/cell to last-confirmed state unless user chooses to edit and retry. |
| Out-of-order response | Ignore response if its sequence/revision is older than the latest acknowledged operation. |
| Duplicate submit/retry | Backend returns the original operation result; it must not append duplicate amendment/ledger rows. |
| Period revision conflict | Do not overwrite. Fetch current data, show differences, and offer rebase/review or revert. |
| Later event depends on amendment | Block one-click reversal; explain dependency and offer administrative correction. |
| Partial linked event write | Backend transaction wrapper/lock must leave no visible partial event; return failed for the whole operation. |
| Publish/close failure | Lifecycle state remains at last confirmed state; affected operation remains reviewable. |
| Negative GOFF | Block by default; override requires explicit action and reason and is separately flagged. |
| Stale cached legacy data | Show last-known/offline status and do not claim it is current. |

## 16. Accessibility requirements

- Meet WCAG 2.2 AA for the new workflow.
- Normal text contrast is at least 4.5:1; large text and graphical controls at least 3:1.
- Warnings, lifecycle states, shift types, pending/error states, and amendment markers use text/icon/pattern in addition to color.
- All icon-only controls have accessible names and visible tooltips where useful.
- Focus order follows visual order; focus is visible and restored sensibly after dialogs and saves.
- All workflows are keyboard operable. Grid keyboard behavior must be documented and must not trap focus.
- Dialogs/sheets expose correct role, title, modal state, escape/cancel path, and initial/return focus.
- Save and error changes use non-disruptive live regions; routine toasts must not steal focus.
- Tables expose meaningful row/column headers; the issues panel can navigate to cells without relying on screen coordinates.
- Truncated values have keyboard- and touch-accessible full text.
- Motion respects `prefers-reduced-motion`.
- Browser zoom remains enabled. Layout must tolerate text resizing without loss of function.
- Touch targets are at least 44×44 CSS pixels for primary mobile interactions.

## 17. Legacy and migration behavior

- Do not rewrite historical `MasterRoster` cells merely to adopt the new model.
- If no new planned snapshot/amendment exists, treat a legacy roster cell as both planned and current.
- Legacy months are read-only by default.
- Do not recalculate previously accepted historical weekly-OFF compliance.
- Start GOFF accounting on the first day of the first monthly period enrolled in the new lifecycle. The exact month is recorded as a deployment input.
- Enter administrator-confirmed pre-commencement outstanding GOFF as opening balances for every applicable person; never infer it from overwritten historical rosters.
- Block production GOFF enablement until the commencement record and complete opening-balance set reconcile, but do not block software implementation while deployment values are pending.
- Preserve current raw `PN` values. Do not retroactively reinterpret legacy tallies or consecutive-work outcomes even though the new shared semantics classify `PN` as transparent and non-staffing.
- Preserve `MasterRoster` as a compatibility projection for the current viewer during phased rollout.
- Test migration on copied/non-production Sheets data.
- Back up every affected sheet before schema enablement and before production cutover.
- Feature switches must allow the new reads/UI to be disabled without deleting additive records.

**Implementation recommendation:** New data becomes canonical only for roster periods explicitly enrolled in the new lifecycle. Older periods continue through the legacy adapter.

## 18. Non-goals

- Implementing any code or Sheets change in this documentation task.
- Multiple administrator roles, approval hierarchies, or broad workforce-management RBAC.
- Payroll, overtime calculation, attendance clocking, or clinical credential management.
- Inferring diagnoses or storing sensitive medical details.
- Reconstructing lost planned history from overwritten roster cells.
- Replacing Google Sheets or GitHub Pages in this update.
- Replacing GHKA with GOFF or combining the two ledgers.
- Automatically generating or changing shifts to clear warnings.
- Automated skill/role eligibility filtering in the initial replacement-suggestion release.
- Treating browser zoom as the desktop fitting solution.

## 19. Edge-case matrix

| Case | Expected result |
|---|---|
| Week spans two months/years and both periods are published | Evaluate all seven dates once; each month retains assignment ownership and the shared `weekStart` record reuses one locked policy. |
| Adjacent-month period not published | Mark the shared week Incomplete/Provisional; show no false compliance or shortfall and do not require the adjacent roster early. |
| Second touching month publishes | Supply only that period’s dates, complete the shared week, and calculate full Monday–Sunday guidance without overwriting the first month. |
| Duplicate/incompatible cross-month ownership | Reject the conflicting publication/write and require correction or amendment. |
| Policy effective date is not Monday | Reject configuration. |
| Policy changes after publication | Published week keeps its snapshot. |
| Planned qualifying night becomes `MC` | Required OFF count is unchanged. |
| Non-night becomes current `PN` | Planned qualification is unchanged. |
| Planned OFF later displaced | Original view/publication compliance retains planned `OFF`; current outcome shows OFF not taken and exposes the GOFF effect. |
| Two `OFF` values represented by duplicate rows | Treat as one person-date OFF and flag duplicate/conflict. |
| `OFF (S)`/`OFF (X)` | Normalize the base code; determine whether such modifiers are valid, but do not double-count. |
| `GOFF` assigned with zero available | Block unless deliberate reasoned override. |
| Same credit reserved twice | Idempotency and active-reservation uniqueness prevent it. |
| Published GOFF cancelled | Append release; available balance increases after confirmation. |
| Planned GOFF is worked | Release/non-consume existing reservation; do not earn another GOFF. |
| Planned OFF becomes qualifying duty | Create one projected earn, then exactly one earned credit on reconciliation. |
| Planned OFF becomes `PN` | `PN` provides no coverage and is not worked, but displaced OFF creates exactly one projected GOFF earn. |
| Reverse `OFF → PN` | Restore prior current state and append the exact compensating GOFF reversal; do not delete history. |
| Retry `OFF → PN` operation | Reuse the operation ID and source uniqueness; do not create a duplicate GOFF projection/credit. |
| `PN` within consecutive-work sequence | Preserve the running count without incrementing or resetting it. |
| Seventh worked day after transparent `PN` | Show advisory consecutive-work warning and require visible acknowledgement; do not block or auto-edit. |
| Night bundle crosses month/year | Load adjacent dates and validate the sequence continuously across the boundary. |
| Night followed by non-working status without `PN` | Rest is protected; show bundle warning only. |
| Night followed by worked shift without `PN` | Show both bundle-integrity and post-night-rest warnings. |
| Isolated `PN` | Flag for bundle review; allow an acknowledged absence/administrative exception. |
| Linked replacement partially invalid | Reject entire event; apply no amendment or GOFF effect. |
| Reverse event with later dependency | Block automatic reversal and require reviewed correction. |
| Close with unresolved failed/pending official writes | Block close and link to issues. |
| Reopen closed month | Require confirmation and reason; append audit; never delete close records. |
| Same draft open in two tabs/devices | Detect revision conflict; never last-write-wins silently. |
| Offline refresh | Show cached data as last-known and retain safe pending drafts locally. |
| Staff renamed/inactivated | Preserve stable staff ID links and historical display name; never orphan ledger history. |
| Unknown shift code | Preserve raw value, classify as unknown, exclude from entitlement until mapped, and surface an issue. |
| Replacement has no skill/role data | Do not filter automatically; display `Eligibility not checked` and require administrator confirmation. |
| `MC` note contains medical detail | UI guidance discourages entry; public roster exposes category only, and authenticated administrator-only note access is required. |
| Close is prompted after month-end | Require manual confirmation and reconciliation preview; never close automatically. |
| Close has pending/failed official writes or ledger mismatch | Block close and navigate to the unresolved issues. |
| Legacy month has no snapshot | Planned=current, read-only, labeled Legacy; no retroactive OFF/GOFF inference. |

## 20. Acceptance criteria

### 20.1 Weekly OFF and policies

- **Given** a displayed month whose first or last week crosses a month boundary, **when** OFF guidance is calculated, **then** all seven Monday–Sunday dates are included.
- **Given** Policy A, **when** a person has zero `OFF` values in a week, **then** the guide shows required 1, assigned 0, shortfall 1.
- **Given** Policy B and any planned `ON1`, `ON2`, `PN`, `ON`, `N`, or `NIGHT`, **when** the week has one `OFF`, **then** it shows qualifying night yes and complete.
- **Given** Policy B and planned `PN` but no planned `OFF`, **when** guidance runs, **then** PN qualifies the person for required 1 but assigned normal OFF remains 0 and the week is short.
- **Given** Policy B and no qualifying planned night, **when** the week has one `OFF` and one `GOFF`, **then** it shows required 2, assigned 1, shortfall 1.
- **Given** a published qualifying night later amended to `MC`, **when** guidance recalculates, **then** its required OFF count remains based on the planned night.
- **Given** a policy change effective midweek, **when** it is saved, **then** the backend rejects it.
- **Given** a later effective policy, **when** an older published week is viewed, **then** its policy snapshot and result do not change.
- **Given** only the first touching monthly period is published, **when** its boundary week is shown, **then** the week reuses the policy selected from `weekStart`, is labeled Incomplete/Provisional, and shows no compliance result.
- **Given** the second touching month or year publishes later, **when** the shared week completes, **then** all seven dates are evaluated while each assignment remains owned by its monthly period.
- **Given** the second publication contains a date already owned by the first, **when** publication validates, **then** it rejects the duplicate/conflict rather than overwriting the first period.
- **Given** a planned `OFF` is displaced by an amendment, **when** weekly guidance is viewed, **then** planned compliance retains the OFF while current operational outcome shows it was not taken.
- **Given** any warning, **when** it appears, **then** no roster assignment is modified automatically.

### 20.2 Lifecycle and views

- **Given** a draft, **when** a viewer opens the official roster, **then** the draft is not presented as official.
- **Given** a successful publication, **when** the roster is viewed, **then** planned assignments and weekly policies have immutable snapshot IDs.
- **Given** a published roster, **when** the administrator selects a cell, **then** direct overwrite is unavailable and amendment actions are offered.
- **Given** an active amendment, **when** Current, Original planned, and Changes views are selected, **then** each displays the corresponding data consistently.
- **Given** an amended cell, **when** details are opened, **then** original, current, reason, linked staff, GOFF effect, timestamp, event ID, and transaction state are shown.
- **Given** all active amendments are reversed, **when** the state refreshes, **then** the roster label returns to Published without deleting history.
- **Given** a closed period, **when** a normal amendment is attempted, **then** it is rejected until deliberate reopen completes.
- **Given** month-end has passed, **when** the application prompts for closure, **then** no state changes until the administrator opens the reconciliation preview and explicitly confirms.
- **Given** pending/failed official writes or an unresolved ledger inconsistency, **when** Close is requested, **then** closing is blocked and the issues are shown.

### 20.3 Amendments and staffing

- **Given** an absence that leaves staffing sufficient, **when** preview runs, **then** replacement is optional and before/after staffing is shown.
- **Given** an absence below minimum, **when** preview runs, **then** replacement is suggested.
- **Given** the administrator accepts that shortage, **when** confirming, **then** a reason is required and audited.
- **Given** Siti `PN→MC` and Ahmad `OFF→PN`, **when** confirmed, **then** both lines share one event ID and Ahmad has one linked projected GOFF earn.
- **Given** a shift swap, **when** either linked line fails validation, **then** neither line is committed.
- **Given** a confirmed amendment, **when** its confirmation appears, **then** immediate Undo remains prominent for 10 seconds.
- **Given** that 10-second period has elapsed, **when** history is opened, **then** Reverse Amendment remains available permanently subject to dependency checks.
- **Given** Undo or Reverse Amendment is selected, **when** reversal confirms, **then** a reversal event restores the prior current state and reverses linked GOFF effects.
- **Given** a later dependent event, **when** reversal is requested, **then** the UI blocks automatic reversal and explains the dependency.
- **Given** replacement suggestions in the initial release, **when** candidates are listed, **then** no automated skill/role filter is claimed and each result states `Eligibility not checked` until the administrator confirms suitability.
- **Given** a general viewer opens change history, **when** an amendment contains an operational category and administrative note, **then** the category is visible but the note is neither returned nor displayed.
- **Given** the administrator requests private notes, **when** server authorization is absent or invalid, **then** the backend refuses access regardless of client PIN state.

### 20.4 Night sequences, consecutive work, and rest

- **Given** `OFF – AM – AM – ON1 – ON2 – PN – PM – PM – OFF`, **when** consecutive work is calculated, **then** the worked-day counts are 1, 2, 3, 4, transparent, 5, 6 and no seventh-day warning appears.
- **Given** a running six-worked-day sequence with an intervening `PN`, **when** another worked duty is proposed, **then** the transparent PN preserves the sequence and the proposed seventh worked day produces an advisory warning.
- **Given** `ON1 → ON2 → PN`, `ON1 → PN`, or legacy `ON`/`N`/`NIGHT → PN` across a week, month, or year boundary, **when** bundle validation runs, **then** the sequence is recognized as valid.
- **Given** `ON1`, **when** the next value is neither `ON2` nor `PN`, **then** bundle integrity warns.
- **Given** `ON2`, **when** it lacks an expected `ON1` predecessor or `PN` follower, **then** the applicable bundle warnings identify both relationships.
- **Given** an isolated `PN`, **when** bundle validation runs, **then** it is flagged for review but an acknowledged absence/administrative exception remains possible.
- **Given** a night shift followed by `OFF`, `GOFF`, leave, or another configured reset status without `PN`, **when** validation runs, **then** rest is treated as protected and only the bundle warning appears.
- **Given** a night shift followed by `AM`, `PM`, `OH`, or another non-bundle worked duty without `PN`, **when** validation runs, **then** both bundle-integrity and post-night-rest warnings appear.
- **Given** valid `ON1 → ON2`, **when** post-night-rest validation runs, **then** ON2 is accepted as the second bundled night and the recovery requirement is evaluated after ON2.
- **Given** the consecutive threshold is configured to a value other than six, **when** the next increment would exceed that value, **then** the warning uses the configured value.
- **Given** a seventh-worked-day, bundle, or rest warning, **when** the administrator acknowledges and continues, **then** the assignment may proceed, the acknowledgement is visible/auditable, and no shift is silently changed.
- **Given** a base shift with `(S)` or `(X)`, **when** semantics resolve, **then** the modifier inherits the base code’s worked, transparent/reset, staffing, Policy-B, and GOFF-displacement properties.
- **Given** an unknown code, **when** semantic validation runs, **then** the raw value is preserved and a mapping issue appears without guessing worked, reset, staffing, Policy-B, or GOFF behavior.

### 20.5 GOFF

- **Given** opening 2, earned 2, used 1, adjustments 0, and reservations 1, **when** totals are shown, **then** current is 3 and available is 2.
- **Given** a future published GOFF, **when** Sheets confirms publication, **then** one reservation reduces available balance.
- **Given** that future GOFF is cancelled, **when** cancellation confirms, **then** a release restores availability without deleting the reservation history.
- **Given** a person works a planned GOFF, **when** reconciled, **then** the reservation is released/not used and no new credit is earned.
- **Given** a person works a planned OFF, **when** reconciled, **then** exactly one earned credit is posted.
- **Given** planned `OFF` becomes current `PN`, **when** the amendment confirms, **then** exactly one linked pending earn appears even though PN provides no staffing coverage and is not worked.
- **Given** that `OFF → PN` amendment is reversed, **when** reversal confirms, **then** its linked GOFF effect is compensated exactly once and audit history remains.
- **Given** the same `OFF → PN` operation is submitted or retried more than once, **when** the backend processes its operation/source identifiers, **then** only one GOFF earn entitlement exists.
- **Given** planned `OFF` becomes ordinary `MC`, `EL`, `AL`, or another non-duty absence, **when** reconciliation runs, **then** no automatic GOFF earn is posted unless a separately reasoned manual exception exists.
- **Given** insufficient available GOFF, **when** assignment is attempted, **then** it is blocked unless the administrator deliberately overrides with a reason.
- **Given** the same operation is retried, **when** the backend receives the same operation ID, **then** no duplicate ledger row is created.
- **Given** the first lifecycle-enrolled monthly period has been selected, **when** GOFF commencement is recorded, **then** its date is exactly that period’s first day.
- **Given** commencement or any applicable person’s confirmed opening balance is missing/unreconciled, **when** GOFF production enablement is attempted, **then** enablement is blocked without blocking earlier software implementation.
- **Given** pre-commencement history, **when** migration runs, **then** it creates only administrator-confirmed opening balances and does not infer credits from old rosters.

### 20.6 Optimistic behavior and conflict recovery

- **Given** a draft cell edit, **when** the value changes, **then** it renders immediately and enters the ordered queue.
- **Given** rapid edits to the same unsent draft cell, **when** the debounce window ends, **then** they are coalesced without losing the latest value.
- **Given** an amendment awaiting Sheets, **when** it renders, **then** it is visibly Pending and is not described as saved.
- **Given** a publish/close/opening-balance action, **when** the request is pending, **then** success and authoritative totals/state are withheld.
- **Given** one operation fails, **when** rollback occurs, **then** later confirmed values in unrelated cells remain intact.
- **Given** an older response arrives after a newer response, **when** it is processed, **then** it cannot overwrite the newer value.
- **Given** an accidental refresh with a safe pending draft, **when** the app reloads, **then** the pending edit is restored and clearly labeled.
- **Given** two devices use the same stale period revision, **when** the second writes, **then** it receives a conflict and no silent overwrite occurs.
- **Given** no pending or failed operations, **when** status is shown, **then** it reads `All changes saved` without repetitive success toasts.

### 20.7 UX and accessibility

- **Given** desktop editing, **when** the sidebar collapses or Focus Mode starts, **then** roster width expands and an accessible exit remains available.
- **Given** Fit Month or Fit Entire Roster, **when** calculated text would fall below 10 px, **then** roster-cell text remains at least 10 px and controlled scrolling is introduced.
- **Given** Comfortable mode, **when** the roster renders, **then** its roster-cell text is approximately 13–14 px with scrolling as needed.
- **Given** a save or navigation, **when** the roster re-renders, **then** selected cell and scroll position are preserved where still valid.
- **Given** keyboard-only use, **when** the administrator navigates the grid, opens an amendment, previews, cancels, or confirms, **then** all actions are operable with visible focus.
- **Given** a warning or pending state, **when** color is unavailable, **then** text/icon/pattern still communicates its meaning.
- **Given** mobile use, **when** amendment details open, **then** they are usable without hover and established top/bottom navigation remains intact.

### 20.8 Compatibility and migration

- **Given** a legacy cell with no new records, **when** it is viewed, **then** planned and current are identical.
- **Given** an older accepted month, **when** new features are enabled, **then** it remains read-only and is not retroactively recalculated.
- **Given** a legacy roster containing `PN`, **when** the new semantic layer is enabled, **then** the raw value is preserved and no historical tally, consecutive-work result, or GOFF credit is retroactively reinterpreted.
- **Given** feature switches are disabled after a rollout issue, **when** the app reloads, **then** the legacy viewer can still read the compatibility `MasterRoster` projection.
- **Given** a migration rehearsal, **when** source and projected rosters are compared, **then** person/date/shift counts and checksums reconcile before production enablement.

## 21. Deployment inputs and genuine technical findings

The product rules above are resolved. The following are rollout inputs or verified technical gates, not unresolved software-design questions:

1. Record the exact first monthly period enrolled in the lifecycle. Its first calendar day is the GOFF commencement date.
2. Obtain the administrator-confirmed opening balance and source note for every applicable person. These values and the commencement record block GOFF production enablement until reconciled, but do not block implementation.
3. Confirm the operational timezone, production workbook headers/data shape, protections/formulas, and deployed Apps Script version through a no-side-effect export or copied workbook.
4. Inventory production shift codes beyond the initial semantic mapping. Unknown codes remain preserved and flagged until explicitly mapped; they are never guessed.
5. Select and validate the server-side single-administrator authorization mechanism and protected note-read path. This blocks production lifecycle/accounting writes and administrator-only note access because the current client PIN is insufficient.
6. Confirm authoritative staffing thresholds when moving the current local-only tally configuration into shared validation.

No genuine contradiction between the resolved product decisions and the verified repository model is known. The main refactoring risk is the current code’s inconsistent classification of `PN`; it is addressed by the required shared semantic layer and compatibility tests.
