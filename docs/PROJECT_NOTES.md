# Project Notes

## Current Completed Refactors

- Extracted backend response normalization and validation into `src/utils/adapters.js`.
- Extracted duplicated quota/counting logic into `src/utils/quota.js`.
- Extracted repeated localStorage access into `src/utils/cache.js`.
- Added simple Node assertion tests for adapters, cache, and quota helpers.

## Known Technical Debt

- `src/App.jsx` still owns a large amount of state, cache hydration, API orchestration, and optimistic mutation handling.
- `src/components/AdminPanel.jsx` remains oversized and mixes several admin workflows in one component.
- Optimistic update rollback restores prior in-memory arrays, which can overwrite newer local changes if several background writes overlap.
- Admin access is controlled in the client UI and should not be treated as a secure permission boundary.
- Apps Script backend source is stored as `appscript.txt`, so backend deploys are manual and easy to drift from frontend expectations.
- The service worker and Vite base path are tied to `/REQUEST-APP/`; hosting path changes require coordinated updates.
- Test coverage is focused on pure utilities. There are no integration or browser-flow tests for the full request lifecycle.

## Risky Areas

- Changing any `resq_cache_*` key can break cache-first startup for existing users.
- Apps Script `action` names and payload field names are the backend contract.
- Date parsing and timezone behavior affect request quotas, weekend counts, and roster matching.
- Quota helpers intentionally count active requests using the current month/weekend semantics.
- Service worker caching can make deployed changes appear stale until the browser updates its cache.
- Optimistic request, delete, approval, and activity flows depend on full refresh after successful writes.

## Future Refactor Targets

- Move data loading, cache hydration, and refresh status into a dedicated app data hook.
- Split `AdminPanel.jsx` into smaller workflow components for roster, shift blocks, shift types, limit groups, activities, settings, and quota overview.
- Extract optimistic mutation patterns into a small helper after behavior is covered by integration tests.
- Add backend contract tests or fixtures around `fetchAllData()` response shapes.
- Add browser smoke tests for submit, edit, delete, approval, and admin configuration paths.
- Document or automate the Apps Script deployment process to reduce backend drift.

## Important Design Decisions

- The frontend remains a static Vite/React app deployable to GitHub Pages.
- Google Apps Script is the backend system of record.
- Browser cache is used only for fast startup and offline-ish last-known rendering; Apps Script refresh remains authoritative.
- Write requests use `text/plain;charset=UTF-8` JSON bodies to preserve the existing Apps Script integration behavior.
- Utility tests use simple Node assertions instead of introducing a heavier test framework.
- Refactors should preserve visible behavior, localStorage keys, and API payloads unless a behavior change is explicitly planned.
