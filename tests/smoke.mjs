/**
 * End-to-end smoke test against a production build.
 *
 * Covers the paths that unit tests cannot reach: that the app actually mounts,
 * that a refuel entered through the form produces the right consumption figure,
 * that every tab renders, and that data survives a reload.
 *
 * Usage:
 *   npm run build && npm run preview &
 *   node tests/smoke.mjs [baseUrl]
 *
 * Or simply: npm run test:e2e
 */
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://localhost:4173';
const CHROME = process.env.CHROMIUM_PATH || undefined;

const failures = [];
const consoleErrors = [];

function check(name, condition, detail = '') {
  if (condition) {
    console.log(`  PASS  ${name}`);
  } else {
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
    failures.push(name);
  }
}

/**
 * innerText applies CSS text-transform, and much of this UI is uppercased,
 * so page text is always matched case-insensitively.
 */
function contains(haystack, needle) {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--no-sandbox'],
});
const context = await browser.newContext({
  viewport: { width: 412, height: 915 },
  hasTouch: true,
  isMobile: true,
});
const page = await context.newPage();

page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text());
});
page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`));

console.log(`\n== Loading ${BASE} ==`);
await page.goto(BASE, { waitUntil: 'networkidle' });

console.log('\n== Onboarding ==');
check('welcome screen renders', await page.getByText('Welcome to FuelPilot!').isVisible());
for (let i = 0; i < 3; i++) await page.getByRole('button', { name: /Next/ }).click();
await page.getByRole('button', { name: /Get started/ }).click();
check(
  'onboarding dismisses',
  !(await page.getByText('Welcome to FuelPilot!').isVisible().catch(() => false))
);

console.log('\n== Add vehicle ==');
check('first-vehicle form shown', await page.getByText('Add your first vehicle').isVisible());
await page.getByPlaceholder('Škoda Octavia').fill('Test Car');
await page.getByRole('button', { name: 'Save vehicle' }).click();
await page.waitForTimeout(400);
check('vehicle selector appears', await page.getByText('Active Vehicle').isVisible());
check('refuel form appears', await page.getByText('Quick refuel log').isVisible());

console.log('\n== Form validation ==');
await page.getByRole('button', { name: 'Save refuel' }).click();
await page.waitForTimeout(200);
check('empty submit explains itself', await page.getByText(/Enter an odometer reading/).isVisible());

console.log('\n== Log refuels ==');
async function logRefuel({ date, odometer, liters, price }) {
  await page.locator('input[type=date]').first().fill(date);
  const numbers = page.locator('form').filter({ hasText: 'Odometer (km)' }).locator('input[type=number]');
  await numbers.nth(0).fill(String(odometer));
  await numbers.nth(1).fill(String(liters));
  await numbers.nth(2).fill(String(price));
  await page.getByRole('button', { name: 'Save refuel' }).click();
  await page.waitForTimeout(400);
}

await logRefuel({ date: '2026-01-01', odometer: 100000, liters: 50, price: 38 });
await logRefuel({ date: '2026-02-01', odometer: 100500, liters: 40, price: 38 });

let body = await page.locator('body').innerText();
// 40 L over 500 km = 8.00 l/100km. The first fill only sets the baseline.
check('consumption computed as 8.00 l/100km', body.includes('8.00'), body.slice(0, 400));
check('undo is offered after a save', contains(body, 'undo'));

console.log('\n== Tabs ==');
for (const [tab, marker] of [
  ['Stats', 'Date range filter'],
  ['Maint', 'Maintenance reminders'],
  ['Settings', 'Device storage'],
  ['Refuel', 'Quick refuel log'],
]) {
  await page.getByRole('button', { name: new RegExp(tab) }).first().click();
  await page.waitForTimeout(500);
  check(`${tab} tab renders`, await page.getByText(marker).first().isVisible().catch(() => false));
}

console.log('\n== Charts ==');
await page.getByRole('button', { name: /Stats/ }).first().click();
await page.waitForTimeout(800);
const drawnCanvases = await page.evaluate(
  () =>
    Array.from(document.querySelectorAll('canvas')).filter((c) => {
      if (!c.width || !c.height) return false;
      const data = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      for (let i = 3; i < data.length; i += 4) if (data[i] !== 0) return true;
      return false;
    }).length
);
check('a chart actually drew pixels', drawnCanvases > 0, `canvases with content: ${drawnCanvases}`);

console.log('\n== Theme ==');
const beforeBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
await page.getByTitle(/Switch to (light|dark) mode/).click();
await page.waitForTimeout(400);
const afterBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
check('theme toggle repaints the background', beforeBg !== afterBg, `${beforeBg} -> ${afterBg}`);

console.log('\n== Persistence ==');
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(700);
check('data survives a reload', contains(await page.locator('body').innerText(), 'Test Car'));

console.log('\n== Maintenance status ==');
await page.getByRole('button', { name: /Maint/ }).first().click();
await page.waitForTimeout(500);
// 10-day interval starting 5 days ago lands the item inside the warning window.
const fiveDaysAgo = new Date(Date.now() - 5 * 864e5).toISOString().slice(0, 10);
const maintForm = page.locator('form').filter({ hasText: 'Interval km' });
await maintForm.locator('input[type=date]').fill(fiveDaysAgo);
const maintNumbers = maintForm.locator('input[type=number]');
await maintNumbers.nth(0).fill('100000');  // last done odometer
await maintNumbers.nth(1).fill('999999');  // interval km — deliberately far off
await maintNumbers.nth(2).fill('10');      // interval days — close
await page.getByRole('button', { name: 'Save reminder' }).click();
await page.waitForTimeout(500);

body = await page.locator('body').innerText();
check('item is labelled Due soon', contains(body, 'due soon'));
check('remaining days are shown', /\d+ days left/i.test(body));
check('mark-as-done is offered for an upcoming item', contains(body, 'mark as done'));
// The summary tile counted a status key the app never produced, so it was
// permanently zero. Guard against that regression.
const dueSoonCount = body.match(/(\d+)\s*\n\s*DUE SOON/i);
check('due-soon counter reflects the item', dueSoonCount && Number(dueSoonCount[1]) === 1,
  dueSoonCount ? `counter read ${dueSoonCount[1]}` : 'counter not found');

console.log('\n== Console ==');
const realErrors = consoleErrors.filter(
  (e) => !e.includes('favicon') && !e.includes('sw.js') && !e.includes('ServiceWorker')
);
check('no console errors', realErrors.length === 0, realErrors.slice(0, 5).join(' | '));

await browser.close();

console.log(
  `\n${failures.length === 0 ? 'ALL CHECKS PASSED' : `FAILURES (${failures.length}): ${failures.join(', ')}`}\n`
);
process.exit(failures.length === 0 ? 0 : 1);
