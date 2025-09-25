# RESQ Request App

A Vite + React frontend that interacts with a Google Apps Script backend to manage roster requests.

## Prerequisites

- Node.js 18+ (includes npm)
- A published Google Apps Script web app URL for the backend

## Local Setup

```bash
npm install
cp .env.example .env.local # then edit with your Apps Script URL
npm run dev
```

The dev server runs at `http://localhost:5173`. Any edits under `src/` trigger hot reloads.

## Build for Production

```bash
npm run build
```

Static assets are emitted to `dist/`. Preview locally with:

```bash
npm run preview
```

## Deploy to GitHub Pages

This project ships with a `gh-pages` deployment helper.

1. Ensure your repository is pushed to GitHub (e.g. `username/REQUEST-APP`).
2. Build the site: `npm run build`
3. Publish the `dist/` folder to the `gh-pages` branch: `npm run deploy`
4. In the GitHub repo settings, enable Pages and point it to the `gh-pages` branch (root).

> The Vite config sets `base: './'`, so the app works from any sub-directory on GitHub Pages.

Whenever you deploy, rebuild first so the latest `.env.local` values (e.g. `VITE_APPS_SCRIPT_URL`) are baked into the bundle.

## Environment Variables

- `VITE_APPS_SCRIPT_URL` – Google Apps Script web-app URL. This value is embedded at build time, so do not commit your populated `.env.local`.

## Project Scripts

- `npm run dev` – start the Vite dev server
- `npm run build` – build production assets
- `npm run preview` – preview the production build locally
- `npm run deploy` – publish `dist/` to GitHub Pages (`predeploy` runs the build automatically)

## Folder Structure

```
├── src/
│   ├── components/   # React UI components
│   ├── utils/        # Helpers for date/name normalization
│   ├── api.js        # Fetch helpers for Apps Script endpoints
│   ├── App.jsx       # Root application component
│   └── main.jsx      # Vite entry point
├── public/           # (optional) static assets served as-is
├── index.html        # Vite HTML entry
└── vite.config.js    # Vite configuration (base path + plugins)
```

## Backend

The bundled `appscript.txt` contains the Apps Script implementation expected by this frontend. Deploy it as a Web App (execute as **Me**, accessible by **Anyone with the link**) and paste its URL into `.env.local` before building.
