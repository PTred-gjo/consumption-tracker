# ⛽ FuelPilot

A smart fuel consumption tracker that turns raw refuel data into clear insights — helping you understand what your car really costs per kilometer.

## Features

- **⛽ Quick Refuel Log** — Tap, enter odometer + liters + price, done
- **📊 Auto Consumption** — Instantly calculates l/100 km between fillups
- **💰 Cost Tracker** — See cost per km, monthly spend, and fuel price trends
- **📈 Charts & Stats** — Consumption trends, monthly costs, distance over time, yearly comparisons
- **🔧 Maintenance Reminders** — Oil change, STK, tires, insurance — by km or date, with service history log
- **🚗 Multi-Vehicle** — Track multiple cars with per-vehicle statistics and color labels
- **🌍 Multi-currency** — Supports Kč, €, $, £, zł, kr
- **🌗 Light / Dark Theme** — Toggle between dark and light modes, persisted across sessions
- **🏷️ Trip Tags** — Tag each refuel (Commute, Road Trip, Work, etc.) and see cost breakdown per tag
- **🌱 CO₂ Tracking** — Estimated CO₂ emissions per fill-up and lifetime total
- **📷 Receipt Photos** — Attach a receipt image to any refuel entry (compressed automatically)
- **💾 Backup & Restore** — Export/import JSON, CSV export, Fuelio CSV import, device storage backup
- **🔔 Push Notifications** — Schedule local reminders before maintenance is due (Capacitor)
- **📅 Monthly Budget** — Set a spending limit and track progress with a live progress bar
- **⚠️ Smart Warnings** — Low-range alert, overdue-refuel reminder, data integrity flags
- **🔍 History Search** — Filter refuel history by date, cost range, station, note, or trip tag
- **📲 Installable PWA** — Install from the browser and use it fully offline; home-screen shortcuts jump straight to Refuel or Stats
- **🔒 Private by design** — No account, no server, no analytics; nothing ever leaves your device

## How It Works

1. **Add your vehicle** — make, model, year, fuel type, tank size
2. **Log every refuel** — odometer reading, liters, price per liter, full/partial tank
3. **See the real cost** — the app calculates consumption (l/100 km) and cost per km automatically
4. **Track trends** — charts show how your consumption and spending change over time
5. **Never miss maintenance** — set reminders by km interval or date, get notified when due

## Calculation Logic

Implemented in [`src/lib/stats.js`](src/lib/stats.js) and
[`src/lib/maintenance.js`](src/lib/maintenance.js), both covered by unit tests.

### Fuel Consumption (l/100 km)

Measured between two **full tank** entries, where the fuel burnt over the
interval is known exactly. Partial fills in between are accumulated:

```
totalLiters   = partial fills since the last full tank + this full fill
totalDistance = currentOdometer - lastFullTankOdometer
consumption   = (totalLiters / totalDistance) × 100
```

The first full tank only establishes the baseline and produces no reading.

**If you never brim the tank**, a rolling 3-fill window is used instead: the
litres of fills *i-1* and *i* spread over the distance from fill *i-2* to *i*.
Results from this path are marked with an asterisk in the app, because they are
an estimate rather than a measurement.

### Average Consumption

Weighted by distance, not a plain mean of the individual readings, so a long
interval counts for more than a short one:

```
avgConsumption = (Σ liters / Σ distance) × 100
```

### Cost per Kilometer

The first refuel is excluded: it replaced fuel burnt *before* the tracked
distance began, so charging it against that distance would overstate the cost.

```
costPerKm = (totalCost - firstRefuelCost) / (lastOdometer - firstOdometer)
```

### Maintenance Due

```
isDue      = today >= lastDoneDate + intervalDays  OR  odometer >= lastDoneOdometer + intervalKm
isUpcoming = within 30 days                        OR  within 1000 km
```

Dates are parsed as local midnight throughout, so a reminder falls on the same
calendar day regardless of time zone.

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18+)

### Installation

```bash
# Clone the project
git clone https://github.com/your-username/fuelpilot.git
cd fuelpilot

# Install dependencies
npm install

# Start dev server
npm run dev
```

### Running on Your Phone

1. Run `npm run dev`
2. Open the local URL on your phone (same Wi-Fi network)
3. Or build the APK (see below)

### Building for Android

```bash
# Build the web app and copy it into the native project
npm run build:android

# Debug APK
cd android && ./gradlew assembleDebug
```

The debug APK lands at `android/app/build/outputs/apk/debug/app-debug.apk`.

For signed release builds and the Play Store submission, see
**[docs/PUBLISHING.md](docs/PUBLISHING.md)**.

```bash
npm run android:bundle   # signed .aab for Google Play
npm run android:apk      # signed .apk for sideloading
```

Release signing reads `android/keystore.properties` or the `FUELPILOT_KEYSTORE_*`
environment variables. Neither is committed — see the publishing guide.

## Quality Checks

```bash
npm run lint      # ESLint
npm test          # Vitest unit tests
npm run check     # lint + tests + build, same as CI

# End-to-end smoke test against the production build
npm run build
npm run preview &
npm run test:e2e
```

The calculation-heavy parts of the app — consumption maths, CSV import, backup
validation, maintenance scheduling and the storage layer — live in `src/lib/`
as pure modules with unit tests. Run `npm test` before opening a PR.

`tests/smoke.mjs` drives the built app in a real browser to cover what unit
tests cannot: that it mounts, that a refuel entered through the form yields the
right consumption figure, that every tab renders, and that data survives a
reload.

Two GitHub Actions workflows run automatically:

| Workflow | Trigger | What it does |
| --- | --- | --- |
| `ci.yml` | push to `main`, PRs | Lint, unit tests, web build, PWA asset check, browser smoke test, debug APK |
| `pages.yml` | push to `main` | Deploys the PWA and the privacy policy to GitHub Pages |
| `release.yml` | `v*` tags | Verifies the tag matches `package.json`, builds a signed AAB and APK, attaches them to a GitHub release |

## Project Structure

```
fuelpilot/
├── .github/workflows/
│   ├── ci.yml                  # Lint, test, build, debug APK
│   └── release.yml             # Signed AAB/APK on version tags
├── android/                    # Capacitor Android project
├── docs/
│   ├── PUBLISHING.md           # Release and Play Store guide
│   └── store/                  # Generated Play listing assets
├── public/
│   ├── manifest.json           # PWA manifest
│   ├── sw.js                   # Service worker (offline shell)
│   └── icon-*.png              # Generated icon set
├── scripts/
│   ├── generate-icons.mjs      # App and PWA icons (npm run icons)
│   ├── generate-feature-graphic.mjs   # Play feature graphic
│   ├── generate-screenshots.mjs       # Play screenshots from the real app
│   ├── build-privacy-page.mjs  # PRIVACY.md -> hosted privacy.html
│   └── create-keystore.sh      # Creates the Play upload key
├── tests/
│   └── smoke.mjs               # Browser end-to-end smoke test
├── src/
│   ├── main.jsx                # React mount
│   ├── App.jsx                 # UI, state and screens
│   ├── ErrorBoundary.jsx       # Crash fallback with data export
│   ├── registerSW.js           # Service worker registration
│   └── lib/                    # Pure logic, unit tested
│       ├── constants.js        # Shared constants
│       ├── stats.js            # Consumption and cost calculations
│       ├── maintenance.js      # Due-date and interval logic
│       ├── csv.js              # Fuelio CSV import / CSV export
│       ├── backup.js           # Backup validation and normalisation
│       ├── storage.js          # Guarded localStorage access
│       └── image.js            # Receipt photo compression
├── PRIVACY.md                  # Privacy policy (required by Google Play)
├── index.html
├── package.json
├── vite.config.js
└── capacitor.config.json
```

### Structure Notes

The UI lives in one `App.jsx` — no routing library, no state management library,
no CSS framework, just React with inline styles and localStorage.

Anything that can be reasoned about without a browser lives in `src/lib/`
instead. That split is what makes the fuel maths testable; those modules import
no React and touch no DOM.

## Tech Stack

- **React 18** + **Vite 5** — fast dev, fast builds
- **Capacitor 6** — wraps the web app into a native Android APK
  - `@capacitor/local-notifications` — schedule push reminders for maintenance
  - `@capacitor/filesystem` — save backup files to the device's Documents folder
- **Chart.js 4** — lightweight charts for consumption & cost trends
- **localStorage** — offline-first, no server, no account needed
- **Vitest** — unit tests for the calculation, import and storage modules
- **Playwright** — browser smoke test over the production build
- **ESLint** — React and hooks rules, enforced in CI
- **GitHub Actions** — lint/test/build on every push and PR; signed release builds on version tags

## Data Model

Everything is held in `localStorage` under `fuelpilot_*` keys. Browsers allow
roughly 5 MB per origin, and receipt photos dominate that budget — they are
downscaled to 1280px JPEG on capture, and Settings shows a live storage meter.
A failed write raises a banner offering an export rather than losing the edit
silently.

Backups are validated and normalised on import, so a truncated or hand-edited
file cannot introduce records that break the UI.

### Vehicle

```json
{
  "id": "v_001",
  "name": "Škoda Octavia",
  "make": "Škoda",
  "model": "Octavia",
  "year": 2019,
  "fuelType": "diesel",
  "fuelTypes": ["diesel"],
  "tankSize": 50,
  "currency": "Kč",
  "color": "#3B82F6",
  "createdAt": 1710423600000
}
```

### Refuel Entry

```json
{
  "id": "r_001",
  "vehicleId": "v_001",
  "date": "2026-03-14",
  "odometer": 85420,
  "liters": 42.5,
  "pricePerLiter": 36.90,
  "totalCost": 1568.25,
  "fuelType": "diesel",
  "isFullTank": true,
  "station": "MOL Pardubice",
  "note": "",
  "tripTag": "Commute",
  "photo": null,
  "createdAt": 1710423600000
}
```

### Maintenance Record

```json
{
  "id": "m_001",
  "vehicleId": "v_001",
  "type": "oil_change",
  "label": "Oil Change",
  "lastDoneAt": "2026-01-10",
  "lastDoneOdometer": 82000,
  "intervalKm": 15000,
  "intervalDays": 365,
  "cost": 2500,
  "note": "Castrol 5W-30",
  "history": [
    { "date": "2025-01-10", "odometer": 67000, "cost": 2200 }
  ]
}
```

### Odometer Reading

```json
{
  "id": "o_001",
  "vehicleId": "v_001",
  "date": "2026-05-01",
  "odometer": 88000,
  "createdAt": 1746057600000
}
```

## Screens

```
┌──────────────┐
│   Vehicle    │──── First launch: Onboarding + Add Vehicle
│   Selector   │
└──────┬───────┘
       │
  Bottom Tab Bar
  ─────────────────────────────────
  ⛽ Refuel    📊 Stats    🔧 Maint    ⚙ Settings
  ─────────────────────────────────

⛽ Refuel (Home)
  • Dashboard card (last fill, avg consumption, cost/km, odometer)
  • Monthly budget progress bar
  • Refuel interval reminder banner
  • Low-range warning banner
  • Quick refuel form (date, odometer, liters, price, full/partial,
    station autocomplete, note, fuel type, trip tag, receipt photo)
  • Real-time cost/km preview while typing price
  • "Duplicate last" shortcut pre-fills station + price
  • Refuel history (sortable, filterable, paginated)
    – swipe left to reveal Edit / Delete actions
    – long-press for context menu
    – bulk-select mode for multi-delete
    – per-entry data-integrity warning badge
  • Standalone odometer readings tracker

📊 Stats & Charts
  • Date range filter
  • Summary row (refuel count, total cost, total distance)
  • All-time lifetime stats panel (km driven, total cost, fuel, CO₂)
  • Fuel Insights card (best fill, worst fill, avg dist/fill)
  • Last fill vs average comparison (consumption + price delta)
  • Consumption trend line chart (with optional target goal line)
  • Monthly cost bar chart
  • Fuel price history chart (cheapest / costliest annotated)
  • Distance per month bar chart
  • Cost per km trend line chart
  • Yearly cost & fuel comparison bar charts
  • Cost breakdown by trip tag
  • Share stats button (Web Share API / clipboard fallback)

🔧 Maintenance
  • Summary banner (overdue count, due-soon count, next upcoming)
  • Active reminders with OK / Upcoming / Overdue status pills
  • Per-item service history log (expandable)
  • "Mark as done" modal (records date, odometer, cost)
  • Edit / Delete reminders
  • Add maintenance form (type, label, last done date + odometer,
    interval km + days, cost, note)
  • Total cost breakdown by maintenance type

⚙ Settings
  • Add vehicle form (name, make, model, year, primary + secondary
    fuel type, tank size, currency, color picker)
  • Current vehicle settings (currency, color)
  • Per-vehicle consumption target (adds goal line to chart)
  • Trip tag manager (add / delete custom tags)
  • Manage vehicles list (switch, delete with cascade)
  • Export / Import (JSON backup, CSV export, Fuelio CSV import,
    merge vs. replace strategy modal, device backup)
  • Maintenance notifications (set lead-time days, schedule now)
  • Refuel interval reminder threshold
  • Low-range warning threshold
  • Monthly fuel budget
  • Help / Show onboarding again
  • Price → cost/km quick reference table
```

## Design

Dark **and** light theme support — toggled with the ☀️ / 🌙 button in the header:

### Dark theme (default)

| Token             | Value                        |
|-------------------|------------------------------|
| `bg`              | `#0A0A0A`                    |
| `surface`         | `#141414`                    |
| `surfaceElevated` | `#1C1C1E`                   |
| `accent`          | `#3B82F6` (blue for fuel)    |
| `success`         | `#30D158`                    |
| `danger`          | `#FF453A`                    |
| `warning`         | `#E8A838`                    |
| `textPrimary`     | `#F5F5F3`                    |
| `textSecondary`   | `#8E8E93`                    |
| `textMuted`       | `#555558`                    |
| `border`          | `#2C2C2E`                    |
| `borderLight`     | `#1C1C1E`                    |

### Light theme

| Token             | Value       |
|-------------------|-------------|
| `bg`              | `#F2F2F7`   |
| `surface`         | `#FFFFFF`   |
| `surfaceElevated` | `#F2F2F7`  |
| `accent`          | `#3B82F6`   |
| `success`         | `#34C759`   |
| `danger`          | `#FF3B30`   |
| `warning`         | `#FF9500`   |
| `textPrimary`     | `#1C1C1E`   |
| `textSecondary`   | `#6C6C70`   |
| `textMuted`       | `#AEAEB2`   |
| `border`          | `#C6C6C8`   |
| `borderLight`     | `#E5E5EA`   |

System font stack: `-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`

UI patterns:
- Bottom tab bar (4 tabs) with active indicator dot and overdue badge
- Inline styles (no CSS files)
- Card-based layouts with `surface` background and `borderLight` borders
- Modal sheet with backdrop overlay
- Accent-colored summary cards for key metrics (StatBox)
- Uppercase 12px labels, 0.8 letter-spacing for form fields
- `env(safe-area-inset-*)` for notch/home-bar safe areas
- Swipeable rows (left-swipe reveals Edit / Delete)
- Long-press context menu (bottom sheet)
- Undo toast (3-second window to undo deletes)
- Skeleton loading cards on first render
- Slide-in tab transitions (left / right)

## Roadmap

### Phase 1 — MVP (v0.1) ✅
> Log refuels and see basic consumption.

- [x] Vehicle setup screen
- [x] Refuel form (odometer, liters, price, full/partial)
- [x] Consumption calculation (l/100 km) — full-tank method + rolling 3-fill fallback
- [x] Refuel history list with card components
- [x] Dashboard card (last fill, avg consumption, cost/km, odometer)
- [x] localStorage persistence
- [x] Bottom tab navigation (Refuel · Stats · Maintenance · Settings)
- [x] Dark theme UI with COLORS object
- [x] Onboarding flow (multi-step wizard shown on first launch)
- [x] Light theme + toggle button in header

### Phase 2 — Charts & Costs (v0.2) ✅
> Visualize trends and spending.

- [x] Add Chart.js dependency
- [x] Consumption trend line chart
- [x] Monthly cost bar chart
- [x] Fuel price history chart (cheapest / costliest points annotated)
- [x] Cost per km tracking + trend chart
- [x] Date range filter on Stats tab
- [x] All-time lifetime stats panel
- [x] Last fill vs average comparison card
- [x] Fuel Insights card (best fill, worst fill, avg distance per fill)
- [x] Yearly cost & fuel comparison bar charts
- [x] CO₂ emissions estimate (per fill-up and lifetime total)
- [x] Share stats (Web Share API / clipboard fallback)

### Phase 3 — Maintenance (v0.3) ✅
> Never miss an oil change or STK.

- [x] Maintenance type manager (oil, tires, STK, insurance, custom)
- [x] Reminder engine (km-based + date-based)
- [x] Status indicators (OK / upcoming / overdue) with colored pills
- [x] Maintenance cost log + total cost by type card
- [x] Local push notifications via `@capacitor/local-notifications`
- [x] "Mark as done" modal (records date, odometer, cost)
- [x] Service history log per maintenance item (expandable)
- [x] Maintenance summary banner (overdue count, due-soon, next upcoming)

### Phase 4 — Multi-Vehicle & Export (v0.4) ✅
> Multiple cars, data portability.

- [x] Vehicle switcher (dropdown + color dot indicator)
- [x] Per-vehicle stats (all calculations scoped to selected vehicle)
- [x] JSON export / import (replace-all or merge-append strategy)
- [x] CSV export
- [x] Fuelio CSV import (auto-creates/matches vehicles by name)
- [x] Auto-backup to device storage via `@capacitor/filesystem`
- [x] Per-vehicle consumption target (goal line on chart)
- [x] Vehicle color picker

### Phase 5 — Android & Polish (v1.0) ✅
> Ship it.

- [x] Capacitor Android build
- [x] GitHub Actions CI (`.github/workflows/ci.yml`) — lint, unit tests, web build and debug APK
- [x] Signed release pipeline (`.github/workflows/release.yml`) — AAB and APK on version tags
- [x] Onboarding flow (first vehicle setup wizard)
- [x] PWA manifest (`public/manifest.json`) with home-screen shortcuts
- [x] Service worker for offline use, plus the icon set the manifest requires
- [x] Unit tests over the calculation, import and storage logic
- [x] Google Play readiness — API 35, release signing, privacy policy
- [ ] Localization (CZ / EN) — not yet implemented

### Extra Features (beyond original phases)

- [x] Trip tags — label each refuel; cost breakdown by tag in Stats
- [x] Receipt photo — attach a camera/gallery image to any refuel entry
- [x] Monthly fuel budget — set a limit; progress bar on dashboard
- [x] Low-range warning — banner when estimated remaining range is low
- [x] Refuel interval reminder — banner when you haven't logged a fill in N days
- [x] History search & filter — station/note text search, date range, cost range, tag filter
- [x] History sort — newest, oldest, highest/lowest cost, most/fewest liters
- [x] History pagination — "Load more" button (10 entries per page)
- [x] Bulk delete — select multiple refuels and delete at once
- [x] Swipe-to-reveal — swipe a refuel row left to show Edit / Delete buttons
- [x] Long-press context menu — long-press a row for a bottom-sheet menu
- [x] Undo toast — 6-second undo window after any delete, import or bulk action
- [x] Data integrity warnings — badge on entries with suspicious odometer, large fills, or extreme prices
- [x] Duplicate last refuel — pre-fill station + price from the most recent entry
- [x] Odometer tracker — log standalone odometer readings (no fuel required)
- [x] Secondary fuel type — dual-fuel vehicles (e.g. petrol + LPG)
- [x] Keyboard shortcuts — R / S / M / comma to switch tabs (desktop/PWA)
- [x] Swipe-to-change-tab — horizontal swipe on content area switches tabs
- [x] Skeleton loading — shimmer placeholders shown briefly on first render
- [x] Real-time cost/km preview — shows estimated cost/km while typing price in the refuel form

## Privacy

Hosted policy: `https://<owner>.github.io/<repo>/privacy.html` (deployed from
[PRIVACY.md](PRIVACY.md) on every push to `main`).

FuelPilot collects nothing. Every record stays in your device's local storage,
there is no account and no server, and the app works with no connection at all.
The full policy is in [PRIVACY.md](PRIVACY.md).

## License

[MIT](LICENSE) — free for personal and commercial use.

---

> Built with ☕ and ⛽ by Petr
