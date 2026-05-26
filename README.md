# RESQ Request App

A Vite + React frontend that interacts with a Google Apps Script backend to manage roster requests.

## Project Architecture Overview

The app is a static React application. Browser state lives primarily in `src/App.jsx`, while user-facing panels live under `src/components/`. Shared pure helpers are kept under `src/utils/` so future work can move behavior out of large React components without changing visible behavior.

Data is loaded cache-first from `localStorage`, then refreshed from the Google Apps Script web app through `src/api.js`. Writes use optimistic UI updates in React state, then call Apps Script and refresh the full dataset after the backend confirms the change.

## Prerequisites

- Node.js 18+ with npm
- A published Google Apps Script web app URL for the backend

## Local Setup

```bash
npm install
cp .env.example .env.local # then edit with your Apps Script URL
npm run dev
```

The dev server runs at `http://localhost:5173`. Edits under `src/` trigger hot reloads.

## Environment Variables

- `VITE_APPS_SCRIPT_URL` - Google Apps Script web app URL. This value is embedded at build time, so do not commit a populated `.env.local`.

## Folder Responsibilities

```text
src/
  api.js              Apps Script request wrapper and backend action functions
  App.jsx             Root application state, cache hydration, data refresh, optimistic write flow
  main.jsx            Vite/React entry point
  components/         React UI components and page sections
  utils/
    adapters.js       Pure backend response normalization and validation helpers
    cache.js          Safe localStorage read/write helpers
    normalise.js      Date/name normalization helpers
    quota.js          Shared request quota/counting helpers
public/
  sw.js               Service worker for the GitHub Pages route
appscript.txt         Apps Script backend source expected by this frontend
dist/                 Production build output
vite.config.js        Vite config, including the GitHub Pages base path
```

## Important localStorage Keys

Keep these key names stable because existing browser sessions use them for cache-first startup:

- `resq_cache_requests`
- `resq_cache_masterRoster`
- `resq_cache_shiftBlocks`
- `resq_cache_shiftTypes`
- `resq_cache_limitGroups`
- `resq_cache_activities`
- `resq_cache_settings`
- `resq_cache_teamMembers`

The fallback defaults are owned in `src/App.jsx`; `src/utils/cache.js` only isolates safe storage access.

## API Flow Summary

- `src/api.js` reads `VITE_APPS_SCRIPT_URL`, builds Apps Script URLs, and sends requests with `fetch`.
- Read operations pass an `action` query parameter, for example `action=alldata`.
- Write operations send JSON as `text/plain;charset=UTF-8` with an `action` field in the body. This matches the Apps Script deployment pattern and avoids changing the backend contract.
- `fetchAllData()` is the main refresh path. `src/App.jsx` adapts the returned payload through `src/utils/adapters.js`, updates React state, and refreshes the cache.
- Submit, update, delete, approval, roster, shift block, shift type, limit group, activity, and setting writes all preserve the current Apps Script action names and payload shapes.

## Testing Commands

```bash
npm test
npm run build
```

`npm test` runs simple Node assertion tests for pure utility modules. The production build emits static assets to `dist/`.

## Build for Production

```bash
npm run build
```

Preview the production output locally with:

```bash
npm run preview
```

## Deployment Flow

This project ships with a `gh-pages` deployment helper.

1. Confirm `.env.local` contains the correct `VITE_APPS_SCRIPT_URL`.
2. Build the site with `npm run build`.
3. Publish `dist/` to the `gh-pages` branch with `npm run deploy`.
4. In GitHub repository settings, enable Pages from the `gh-pages` branch root.

The Vite config currently uses `base: '/REQUEST-APP/'`, and `public/sw.js` is scoped for the same GitHub Pages path. If the repository name or hosting path changes, update both before deploying.

## Backend

The bundled `appscript.txt` contains the Apps Script implementation expected by this frontend. Deploy it as a Web App with execution as the owner and access set to anyone with the link, then paste its URL into `.env.local` before building.

## AI Handoff Notes

See `docs/PROJECT_NOTES.md` before broad refactors. It records completed extractions, known technical debt, risky areas, and intended future refactor targets.
