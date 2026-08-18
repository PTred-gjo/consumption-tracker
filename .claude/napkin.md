# Napkin Runbook

## Curation Rules
- Re-prioritize on every read.
- Keep recurring, high-value notes only.
- Max 10 items per category.
- Each item includes date + "Do instead".

## Execution & Validation (Highest Priority)
1. **[2026-08-18] `eslint <dir>` silently skips `.jsx`**
   Do instead: always run `npm run lint` (which passes `--ext .js,.jsx,.mjs`). Linting a bare directory hid undefined imports and unescaped JSX entities in `App.jsx`.
2. **[2026-08-18] A `const` captured by an earlier `useEffect` throws a TDZ error at runtime**
   Do instead: declare each `useEffect` *after* every `const`/`useCallback` it references. `App.jsx` is one long component, so an effect placed near the top that lists a later `const` in its deps builds cleanly, then dies on mount with "Cannot access X before initialization". Only the browser smoke test catches this.
3. **[2026-08-18] A green `vite build` does not mean the app works**
   Do instead: run `npm run check` (lint + 92 unit tests + build), then the browser smoke test: `npm run build && npm run preview & && npm run test:e2e`.
4. **[2026-08-18] No Android SDK in this container**
   Do instead: never try `./gradlew` here — it cannot resolve the SDK. Android changes are verified by the `ci.yml` workflow on GitHub. Review gradle edits by eye.
5. **[2026-08-18] Playwright chromium is at a versioned path**
   Do instead: `CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome node tests/smoke.mjs`, and launch with `args: ['--no-sandbox']`.
6. **[2026-08-18] `innerText` applies CSS `text-transform`**
   Do instead: match page text case-insensitively in `tests/smoke.mjs`. Much of this UI is uppercased, so `includes('Due soon')` fails against rendered "DUE SOON".

## Architecture & Conventions
1. **[2026-08-18] Pure logic belongs in `src/lib/`, UI stays in `App.jsx`**
   Do instead: add calculations, parsing and storage access to `src/lib/*.js` with a matching `*.test.js`. These modules must import no React and touch no DOM. `App.jsx` holds only UI and state.
2. **[2026-08-18] The colour palette is a mutated module-level object**
   Do instead: read `COLORS` at render time inside a component. Never capture it in a module-scope constant or a pure helper — it is reassigned by `Object.assign` on theme change, so a captured copy goes stale. Return a status *key* and map it to a colour in the UI.
3. **[2026-08-18] Version has one source of truth: `package.json`**
   Do instead: bump with `npm version`. Vite injects `__APP_VERSION__`, `android/app/build.gradle` reads the same file for `versionName`, and `release.yml` fails if the tag disagrees.
4. **[2026-08-18] Never write to `localStorage` directly**
   Do instead: use `readJSON` / `writeJSON` / `removeKey` from `src/lib/storage.js`. A raw `setItem` throwing on a full quota inside a render effect blanks the whole app.

## Domain Behaviour Guardrails
1. **[2026-08-18] Consumption excludes the first refuel**
   Do instead: keep the first fill as a baseline only — it replaced fuel burnt before tracking began. The same exclusion applies to `avgCostPerKm`. Tests in `src/lib/stats.test.js` pin this.
2. **[2026-08-18] Average consumption is distance-weighted**
   Do instead: use `Σ liters / Σ distance × 100`, never the mean of the per-point values. A long interval must count for more than a short one.
3. **[2026-08-18] Maintenance status keys are `due` / `upcoming` / `ok`**
   Do instead: compare against `'upcoming'`. A stale `'soon'` comparison shipped and left the "Due soon" tile permanently at zero.
4. **[2026-08-18] Parse stored dates as local midnight**
   Do instead: use `parseLocalDate(str)` from `src/lib/stats.js`, never `new Date(dateStr)` — the latter parses as UTC and shifts the calendar day. Use `todayIso()` rather than `toISOString().slice(0,10)`.
5. **[2026-08-18] localStorage is ~5 MB and receipt photos dominate it**
   Do instead: route every image through `compressImage()` in `src/lib/image.js`. Never persist a raw data URL, and never store photos in the draft.
6. **[2026-08-18] Imported data is untrusted**
   Do instead: pass anything parsed from a file through `sanitizeBackup()`. Records are rendered directly (`entry.odometer.toLocaleString()`), so a missing field crashes the tree.

## Publishing
1. **[2026-08-18] Play requires targetSdk 35 and a privacy policy URL**
   Do instead: keep `android/variables.gradle` at 35+, and host `PRIVACY.md` publicly. Full checklist in `docs/PUBLISHING.md`.
2. **[2026-08-18] Signing material must never be committed**
   Do instead: keep credentials in `android/keystore.properties` or `FUELPILOT_KEYSTORE_*` env vars. Both `.gitignore` files block `*.jks`, `*.keystore` and `keystore.properties`.
3. **[2026-08-18] Changing `androidScheme` orphans every user's data**
   Do instead: leave `capacitor.config.json` at `"androidScheme": "https"`. It sets the WebView origin, and localStorage is keyed to it.

## User Directives
1. **[2026-08-18] Work happens on `claude/app-publish-ready-sw9bof`**
   Do instead: commit and push there; never push to `main` without explicit permission. Do not open a PR unless asked.
2. **[2026-08-18] User writes in Czech**
   Do instead: reply in Czech. Keep code, comments, commit messages and docs in English.
