/**
 * Captures Play Store phone screenshots by driving the real production build.
 *
 * Screenshots must show the actual app, so this seeds a realistic dataset into
 * localStorage and photographs the running UI rather than mocking anything.
 *
 * Output is 1080x1920 (9:16), which is inside Play's accepted range on every
 * dimension.
 *
 * Usage:
 *   npm run build && npm run preview &
 *   npm run store:screenshots
 */

import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'docs', 'store', 'screenshots');
const BASE = process.argv[2] || 'http://localhost:4173';

// 360x640 CSS at 3x gives exactly 1080x1920.
const VIEWPORT = { width: 360, height: 640 };
const SCALE = 3;

/* ── Demo data ──────────────────────────────────────────────────────────── */

const VEHICLE_ID = 'v_demo';
const DAY = 86400000;

function isoDaysAgo(days) {
  const d = new Date(Date.now() - days * DAY);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

/** A year of fill-ups at roughly 6 l/100 km, with believable price drift. */
function buildRefuels() {
  const stations = ['Shell', 'OMV', 'MOL', 'Benzina', 'Orlen'];
  const tags = ['Commute', 'Road Trip', 'Work', '', 'Commute'];
  const out = [];
  let odometer = 118400;
  let daysAgo = 350;

  for (let i = 0; i < 15; i++) {
    // ~600 km between fills, consumption drifting around 6 l/100 km.
    const distance = 560 + Math.round(Math.sin(i * 1.7) * 70);
    const consumption = 5.9 + Math.sin(i * 0.9) * 0.55;
    const liters = Math.round(((distance * consumption) / 100) * 10) / 10;
    const price = Math.round((36.4 + Math.sin(i * 0.6) * 2.4) * 10) / 10;

    odometer += distance;
    daysAgo -= 23;

    out.push({
      id: `r_demo_${i}`,
      vehicleId: VEHICLE_ID,
      date: isoDaysAgo(Math.max(2, daysAgo)),
      odometer,
      liters,
      pricePerLiter: price,
      totalCost: Math.round(liters * price * 100) / 100,
      fuelType: 'diesel',
      isFullTank: true,
      station: stations[i % stations.length],
      note: i === 3 ? 'Motorway run to Brno' : '',
      tripTag: tags[i % tags.length],
      photo: null,
      createdAt: Date.now() - i * 1000,
    });
  }
  return out;
}

const refuels = buildRefuels();
const lastOdometer = refuels[refuels.length - 1].odometer;

const seed = {
  fuelpilot_onboarded: true,
  fuelpilot_theme: 'dark',
  fuelpilot_selectedVehicleId: VEHICLE_ID,
  fuelpilot_vehicles: [
    {
      id: VEHICLE_ID,
      name: 'Škoda Octavia',
      make: 'Škoda',
      model: 'Octavia',
      year: 2019,
      fuelType: 'diesel',
      fuelTypes: ['diesel'],
      tankSize: 50,
      currency: 'Kč',
      color: '#3B82F6',
      createdAt: Date.now() - 400 * DAY,
    },
  ],
  fuelpilot_refuels: refuels,
  fuelpilot_maintenance: [
    {
      id: 'm_oil',
      vehicleId: VEHICLE_ID,
      type: 'oil_change',
      label: 'Oil Change',
      lastDoneAt: isoDaysAgo(340),
      lastDoneOdometer: lastOdometer - 14200,
      intervalKm: 15000,
      intervalDays: 365,
      cost: 2400,
      note: 'Castrol 5W-30',
      history: [{ date: isoDaysAgo(340), odometer: lastOdometer - 14200, cost: 2400 }],
    },
    {
      id: 'm_stk',
      vehicleId: VEHICLE_ID,
      type: 'stk',
      label: 'STK',
      lastDoneAt: isoDaysAgo(710),
      lastDoneOdometer: lastOdometer - 26000,
      intervalKm: 0,
      intervalDays: 730,
      cost: 1600,
      history: [],
    },
    {
      id: 'm_tires',
      vehicleId: VEHICLE_ID,
      type: 'tires',
      label: 'Winter Tires',
      lastDoneAt: isoDaysAgo(120),
      lastDoneOdometer: lastOdometer - 4800,
      intervalKm: 0,
      intervalDays: 200,
      cost: 900,
      history: [],
    },
  ],
  fuelpilot_odometer_readings: [],
  fuelpilot_monthly_budget: 4000,
  fuelpilot_vehicle_targets: { [VEHICLE_ID]: 5.8 },
};

/* ── Capture ────────────────────────────────────────────────────────────── */

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--no-sandbox'],
});
const context = await browser.newContext({
  viewport: VIEWPORT,
  deviceScaleFactor: SCALE,
  isMobile: true,
  hasTouch: true,
});

// Seeded before any app script runs, so the first render already has the data.
await context.addInitScript((data) => {
  for (const [key, value] of Object.entries(data)) {
    localStorage.setItem(key, JSON.stringify(value));
  }
}, seed);

const page = await context.newPage();
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);

/**
 * Opens a tab through the ?tab= parameter the app already supports, rather than
 * clicking the bottom bar. Navigation is deterministic; a synthetic click into
 * a fixed, blurred bar under a 3x device scale factor is not.
 */
async function capture(name, { tab = 'refuel', scrollTo = 0, settle = 1200 } = {}) {
  await page.goto(`${BASE}/?tab=${tab}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(settle);
  if (scrollTo) {
    await page.evaluate((y) => window.scrollTo(0, y), scrollTo);
    await page.waitForTimeout(600);
  }
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  console.log(`wrote docs/store/screenshots/${name}.png`);
}

await capture('01-dashboard', { tab: 'refuel' });
await capture('02-refuel-log', { tab: 'refuel', scrollTo: 620 });
await capture('03-stats-summary', { tab: 'stats', settle: 1800 });
await capture('04-consumption-chart', { tab: 'stats', scrollTo: 1320, settle: 1800 });
await capture('05-cost-charts', { tab: 'stats', scrollTo: 2050, settle: 1800 });
await capture('06-maintenance', { tab: 'maintenance' });

// Light theme, to show both are supported.
await page.goto(`${BASE}/?tab=refuel`, { waitUntil: 'networkidle' });
await page.waitForTimeout(900);
await page.getByTitle(/Switch to light mode/).click();
await page.waitForTimeout(900);
await page.screenshot({ path: join(OUT, '07-light-theme.png') });
console.log('wrote docs/store/screenshots/07-light-theme.png');

await browser.close();
console.log('\nAll screenshots written to docs/store/screenshots/ (1080x1920).');
