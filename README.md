# ⛽ FuelPilot

A smart fuel consumption tracker that turns raw refuel data into clear insights — helping you understand what your car really costs per kilometer.

## Features

- **⛽ Quick Refuel Log** — Tap, enter odometer + liters + price, done
- **📊 Auto Consumption** — Instantly calculates l/100 km between fillups
- **💰 Cost Tracker** — See cost per km, monthly spend, and fuel price trends
- **📈 Charts & Stats** — Consumption trends, monthly costs, and distance driven over time
- **🔧 Maintenance Reminders** — Oil change, STK, tires, insurance — by km or date
- **🚗 Multi-Vehicle** — Track multiple cars with per-vehicle statistics
- **🌍 Multi-currency** — Supports Kč, €, $, £, zł, kr

## How It Works

1. **Add your vehicle** — make, model, year, fuel type, tank size
2. **Log every refuel** — odometer reading, liters, price per liter, full/partial tank
3. **See the real cost** — the app calculates consumption (l/100 km) and cost per km automatically
4. **Track trends** — charts show how your consumption and spending change over time
5. **Never miss maintenance** — set reminders by km interval or date, get notified when due

## Calculation Logic

### Fuel Consumption (l/100 km)

Between two consecutive **full tank** entries:

```
consumption = (liters / (currentOdometer - previousOdometer)) × 100
```

For partial fillups, liters are accumulated until the next full tank:

```
totalLiters = sum of all partial fills + current full fill
totalDistance = currentOdometer - lastFullTankOdometer
consumption = (totalLiters / totalDistance) × 100
```

### Cost per Kilometer

```
costPerKm = totalCost / (currentOdometer - previousOdometer)
```

### Maintenance Due

```
isDue = (today >= lastDoneDate + intervalDays) OR (currentOdometer >= lastDoneOdometer + intervalKm)
isUpcoming = within 30 days OR within 1000 km
```

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
# Build the web app
npm run build

# Add Android platform
npx cap add android

# Sync web assets to native project
npx cap sync android

# Build debug APK
cd android && ./gradlew assembleDebug
```

The debug APK will be at `android/app/build/outputs/apk/debug/app-debug.apk`.

A GitHub Actions workflow (`.github/workflows/build-apk.yml`) builds the APK automatically on every push to `main`.

## Project Structure

```
fuelpilot/
├── .github/
│   └── workflows/
│       └── build-apk.yml              # Auto-build APK on push
├── index.html                          # Entry point
├── package.json                        # Dependencies
├── vite.config.js                      # Vite configuration
├── capacitor.config.json               # Capacitor (Android) config
└── src/
    ├── main.jsx                        # React mount
    └── App.jsx                         # Full app (single file)
```

### Why Single File?

Same approach as Worth My Time — the entire app lives in `App.jsx`. State, UI, logic, styles — all in one place. No routing library, no state management library, no CSS framework. Just React + inline styles + localStorage.

## Tech Stack

- **React 18** + **Vite 5** — fast dev, fast builds
- **Capacitor 6** — wraps the web app into a native Android APK
- **Chart.js** — lightweight charts for consumption & cost trends
- **localStorage** — offline-first, no server, no account needed
- **GitHub Actions** — automated APK builds on push

## Data Model

### Vehicle

```json
{
  "id": "v_001",
  "name": "Škoda Octavia",
  "make": "Škoda",
  "model": "Octavia",
  "year": 2019,
  "fuelType": "diesel",
  "tankSize": 50,
  "currency": "Kč",
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
  "note": "Castrol 5W-30"
}
```

## Screens

```
┌──────────────┐
│   Vehicle    │──── First launch: Add Vehicle
│   Selector   │
└──────┬───────┘
       │
  Bottom Tab Bar
  ─────────────────────────────────
  ⛽ Refuel    📊 Stats    🔧 Maint    ⚙ Settings
  ─────────────────────────────────

⛽ Refuel (Home)
  • Quick-add form (odometer, liters, price, full/partial)
  • Last fill summary card
  • Running avg consumption & cost/km

📊 Stats & Charts
  • Consumption trend (line chart)
  • Monthly cost (bar chart)
  • Fuel price history
  • Distance per month

🔧 Maintenance
  • Active reminders with status (OK / upcoming / overdue)
  • Add/edit maintenance types
  • Maintenance cost log

⚙ Settings
  • Vehicle management (add/edit/switch)
  • Currency selector
  • Export/import JSON
  • Quick reference table (price → l/100km at current avg)
```

## Design

Dark theme matching the Worth My Time aesthetic:

| Token           | Value                        |
|-----------------|------------------------------|
| `bg`            | `#0A0A0A`                    |
| `surface`       | `#141414`                    |
| `surfaceElevated` | `#1C1C1E`                  |
| `accent`        | `#3B82F6` (blue for fuel)    |
| `success`       | `#30D158`                    |
| `danger`        | `#FF453A`                    |
| `warning`       | `#E8A838`                    |
| `textPrimary`   | `#F5F5F3`                    |
| `textSecondary` | `#8E8E93`                    |
| `textMuted`     | `#555558`                    |
| `border`        | `#2C2C2E`                    |
| `borderLight`   | `#1C1C1E`                    |

System font stack: `-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`

UI patterns carried over from Worth My Time:
- Bottom tab bar (4 tabs)
- Inline styles (no CSS files)
- Card-based layouts with `surface` background and `borderLight` borders
- Modal sheet sliding up from bottom with backdrop overlay
- Accent-colored summary cards for key metrics
- Uppercase 12px labels, 0.8 letter-spacing for form fields
- `env(safe-area-inset-*)` for notch/home-bar safe areas

## Roadmap

### Phase 1 — MVP (v0.1)
> Log refuels and see basic consumption.

- [ ] Vehicle setup screen
- [ ] Refuel form (odometer, liters, price, full/partial)
- [ ] Consumption calculation (l/100 km)
- [ ] Refuel history list with ItemCard components
- [ ] Dashboard card (last fill, avg consumption, cost/km)
- [ ] localStorage persistence (same pattern as Worth My Time)
- [ ] Bottom tab navigation (Refuel · Stats · Maintenance · Settings)
- [ ] Dark theme UI with COLORS object

### Phase 2 — Charts & Costs (v0.2)
> Visualize trends and spending.

- [ ] Add Chart.js dependency
- [ ] Consumption trend line chart
- [ ] Monthly cost bar chart
- [ ] Fuel price history chart
- [ ] Cost per km tracking
- [ ] Date range filter

### Phase 3 — Maintenance (v0.3)
> Never miss an oil change or STK.

- [ ] Maintenance type manager (oil, tires, STK, insurance, custom)
- [ ] Reminder engine (km-based + date-based)
- [ ] Status indicators (OK / upcoming / overdue)
- [ ] Maintenance cost log
- [ ] Notification support via Service Worker

### Phase 4 — Multi-Vehicle & Export (v0.4)
> Multiple cars, data portability.

- [ ] Vehicle switcher
- [ ] Per-vehicle stats
- [ ] JSON export/import
- [ ] CSV export

### Phase 5 — Android & Polish (v1.0)
> Ship it.

- [ ] Capacitor Android build
- [ ] GitHub Actions APK workflow (`.github/workflows/build-apk.yml`)
- [ ] Onboarding flow (first vehicle setup)
- [ ] Localization (CZ / EN)
- [ ] PWA manifest + Service Worker (installable from browser)

## License

MIT — free for personal and commercial use.

---

> Built with ☕ and ⛽ by Petr
