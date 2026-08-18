import { describe, expect, it } from 'vitest';

import {
  UPCOMING_WINDOW_DAYS,
  getDueDate,
  getDueOdometer,
  getMaintenanceStatus,
  getNextDueItem,
} from './maintenance.js';

function item(overrides = {}) {
  return {
    id: 'm1',
    vehicleId: 'v1',
    type: 'oil_change',
    label: 'Oil Change',
    lastDoneAt: '2026-01-01',
    lastDoneOdometer: 100000,
    intervalKm: 15000,
    intervalDays: 365,
    cost: 0,
    note: '',
    ...overrides,
  };
}

/** Fixed "now" so the tests do not drift with the calendar. */
const NOW = new Date('2026-06-01T12:00:00');

describe('getDueDate', () => {
  it('adds the day interval to the last service date', () => {
    expect(getDueDate(item({ lastDoneAt: '2026-01-01', intervalDays: 30 })))
      .toEqual(new Date('2026-01-31T00:00:00'));
  });

  it('is null without a day interval', () => {
    expect(getDueDate(item({ intervalDays: 0 }))).toBeNull();
  });

  it('is null when the last service date is unusable', () => {
    expect(getDueDate(item({ lastDoneAt: '' }))).toBeNull();
  });
});

describe('getDueOdometer', () => {
  it('adds the km interval to the last service reading', () => {
    expect(getDueOdometer(item({ lastDoneOdometer: 100000, intervalKm: 15000 }))).toBe(115000);
  });

  it('is null without a km interval', () => {
    expect(getDueOdometer(item({ intervalKm: 0 }))).toBeNull();
  });
});

describe('getMaintenanceStatus', () => {
  it('reports "due" once the date has passed', () => {
    const status = getMaintenanceStatus(item({ lastDoneAt: '2025-01-01', intervalDays: 30, intervalKm: 0 }), 0, NOW);
    expect(status.key).toBe('due');
    expect(status.label).toBe('Overdue');
    expect(status.daysLeft).toBeLessThan(0);
  });

  it('reports "due" once the odometer has passed, whatever the date says', () => {
    const status = getMaintenanceStatus(item({ intervalDays: 0, lastDoneOdometer: 100000, intervalKm: 10000 }), 115000, NOW);
    expect(status.key).toBe('due');
    expect(status.kmLeft).toBe(-5000);
  });

  it('reports "upcoming" — not "soon" — inside the warning window', () => {
    // The UI previously compared against a 'soon' key this function never
    // returns, so the "due soon" count was stuck at zero.
    const dueIn10Days = new Date(NOW);
    dueIn10Days.setDate(dueIn10Days.getDate() + 10);
    const lastDone = new Date(dueIn10Days);
    lastDone.setDate(lastDone.getDate() - 30);

    const status = getMaintenanceStatus(
      item({ lastDoneAt: lastDone.toISOString().slice(0, 10), intervalDays: 30, intervalKm: 0 }),
      0,
      NOW
    );
    expect(status.key).toBe('upcoming');
    expect(status.label).toBe('Due soon');
    expect(status.daysLeft).toBeLessThanOrEqual(UPCOMING_WINDOW_DAYS);
    expect(status.daysLeft).toBeGreaterThan(0);
  });

  it('reports "upcoming" when the odometer is close', () => {
    const status = getMaintenanceStatus(
      item({ intervalDays: 0, lastDoneOdometer: 100000, intervalKm: 10000 }),
      109500,
      NOW
    );
    expect(status.key).toBe('upcoming');
    expect(status.kmLeft).toBe(500);
  });

  it('reports "ok" when both thresholds are far away', () => {
    const status = getMaintenanceStatus(
      item({ lastDoneAt: '2026-05-01', intervalDays: 365, lastDoneOdometer: 100000, intervalKm: 15000 }),
      101000,
      NOW
    );
    expect(status.key).toBe('ok');
  });

  it('reports "ok" for an item with no intervals at all', () => {
    const status = getMaintenanceStatus(item({ intervalDays: 0, intervalKm: 0 }), 999999, NOW);
    expect(status.key).toBe('ok');
    expect(status.daysLeft).toBeNull();
    expect(status.kmLeft).toBeNull();
  });
});

describe('getNextDueItem', () => {
  it('picks the item falling due soonest', () => {
    const items = [
      item({ id: 'far', lastDoneAt: '2026-05-01', intervalDays: 300, intervalKm: 0 }),
      item({ id: 'near', lastDoneAt: '2026-05-01', intervalDays: 45, intervalKm: 0 }),
    ];
    expect(getNextDueItem(items, 0, NOW).item.id).toBe('near');
  });

  it('ignores items already overdue', () => {
    const items = [item({ id: 'overdue', lastDoneAt: '2020-01-01', intervalDays: 30, intervalKm: 0 })];
    expect(getNextDueItem(items, 0, NOW)).toBeNull();
  });

  it('is null when nothing has a date interval', () => {
    expect(getNextDueItem([item({ intervalDays: 0 })], 0, NOW)).toBeNull();
  });
});
