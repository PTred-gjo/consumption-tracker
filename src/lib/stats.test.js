import { describe, expect, it } from 'vitest';

import {
  computeConsumptionSeries,
  computeRefuelWarnings,
  computeStats,
  fmt,
  getCurrentOdometer,
  getVehicleRefuels,
  num,
  parseLocalDate,
  todayIso,
} from './stats.js';

/** Minimal refuel with sensible defaults, so each test states only what it varies. */
function refuel(overrides = {}) {
  const liters = overrides.liters ?? 40;
  const pricePerLiter = overrides.pricePerLiter ?? 40;
  return {
    id: `r_${Math.random().toString(36).slice(2)}`,
    vehicleId: 'v1',
    date: '2026-01-01',
    odometer: 1000,
    liters,
    pricePerLiter,
    totalCost: liters * pricePerLiter,
    fuelType: 'diesel',
    isFullTank: true,
    station: '',
    note: '',
    tripTag: '',
    photo: null,
    createdAt: 0,
    ...overrides,
    // Keep the total consistent when litres or price were overridden.
    ...(overrides.totalCost === undefined ? { totalCost: liters * pricePerLiter } : {}),
  };
}

describe('num', () => {
  it('returns 0 for values that are not finite numbers', () => {
    expect(num('')).toBe(0);
    expect(num('abc')).toBe(0);
    expect(num(undefined)).toBe(0);
    expect(num(Infinity)).toBe(0);
    expect(num(NaN)).toBe(0);
  });

  it('parses numeric strings', () => {
    expect(num('42.5')).toBe(42.5);
    expect(num(-3)).toBe(-3);
  });
});

describe('fmt', () => {
  it('renders a dash for non-finite values rather than "NaN"', () => {
    expect(fmt(NaN)).toBe('-');
    expect(fmt(Infinity)).toBe('-');
  });

  it('fixes to the requested precision', () => {
    expect(fmt(7.126, 2)).toBe('7.13');
    expect(fmt(7, 0)).toBe('7');
  });
});

describe('todayIso', () => {
  it('returns the local calendar date, not the UTC one', () => {
    const iso = todayIso();
    const now = new Date();
    const expected = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0'),
    ].join('-');
    expect(iso).toBe(expected);
  });
});

describe('parseLocalDate', () => {
  it('parses at local midnight so the calendar day is preserved', () => {
    const date = parseLocalDate('2026-03-15');
    expect(date.getFullYear()).toBe(2026);
    expect(date.getMonth()).toBe(2);
    expect(date.getDate()).toBe(15);
  });

  it('returns null for missing or malformed input', () => {
    expect(parseLocalDate('')).toBeNull();
    expect(parseLocalDate(null)).toBeNull();
    expect(parseLocalDate('not-a-date')).toBeNull();
  });
});

describe('getVehicleRefuels', () => {
  it('keeps only the requested vehicle and orders by odometer', () => {
    const entries = [
      refuel({ id: 'b', odometer: 2000 }),
      refuel({ id: 'other', vehicleId: 'v2', odometer: 1500 }),
      refuel({ id: 'a', odometer: 1000 }),
    ];
    expect(getVehicleRefuels(entries, 'v1').map((r) => r.id)).toEqual(['a', 'b']);
  });
});

describe('getCurrentOdometer', () => {
  it('is the highest reading, not the last entered', () => {
    expect(getCurrentOdometer([refuel({ odometer: 5000 }), refuel({ odometer: 3000 })])).toBe(5000);
  });

  it('is 0 with no refuels', () => {
    expect(getCurrentOdometer([])).toBe(0);
  });
});

describe('computeConsumptionSeries', () => {
  it('measures between two full tanks and ignores the first fill', () => {
    const entries = [
      refuel({ odometer: 1000, liters: 50, isFullTank: true }),
      refuel({ odometer: 1500, liters: 40, isFullTank: true }),
    ];
    const { points, isRolling } = computeConsumptionSeries(entries);

    // 40 L over 500 km = 8 l/100km. The first fill only sets the baseline.
    expect(isRolling).toBe(false);
    expect(points).toHaveLength(1);
    expect(points[0].value).toBeCloseTo(8, 6);
    expect(points[0].distance).toBe(500);
  });

  it('rolls partial fills into the next full tank', () => {
    const entries = [
      refuel({ odometer: 1000, liters: 50, isFullTank: true }),
      refuel({ odometer: 1200, liters: 20, isFullTank: false }),
      refuel({ odometer: 1500, liters: 20, isFullTank: true }),
    ];
    const { points } = computeConsumptionSeries(entries);

    // The partial fill counts towards the same 500 km interval: 40 L / 500 km.
    expect(points).toHaveLength(1);
    expect(points[0].value).toBeCloseTo(8, 6);
  });

  it('falls back to a rolling window when no tank is ever brimmed', () => {
    const entries = [
      refuel({ odometer: 1000, liters: 30, isFullTank: false }),
      refuel({ odometer: 1400, liters: 30, isFullTank: false }),
      refuel({ odometer: 1800, liters: 30, isFullTank: false }),
    ];
    const { points, isRolling } = computeConsumptionSeries(entries);

    expect(isRolling).toBe(true);
    expect(points).toHaveLength(1);
    // 60 L over 800 km = 7.5 l/100km.
    expect(points[0].value).toBeCloseTo(7.5, 6);
  });

  it('skips intervals where the odometer did not advance', () => {
    const entries = [
      refuel({ odometer: 1000, isFullTank: true }),
      refuel({ odometer: 1000, isFullTank: true }),
    ];
    expect(computeConsumptionSeries(entries).points).toHaveLength(0);
  });

  it('produces nothing from a single fill', () => {
    expect(computeConsumptionSeries([refuel()]).points).toHaveLength(0);
  });
});

describe('computeStats', () => {
  it('returns a complete zeroed shape for an empty history', () => {
    const stats = computeStats([]);
    // Every field the UI reads must exist, or it renders "undefined".
    expect(stats.avgConsumption).toBe(0);
    expect(stats.lastConsumption).toBe(0);
    expect(stats.refuelCount).toBe(0);
    expect(stats.lastEntry).toBeNull();
    expect(stats.monthlyCost).toEqual([]);
  });

  it('weights the average by distance rather than averaging the points', () => {
    const entries = [
      refuel({ odometer: 0, liters: 40, isFullTank: true }),
      // 10 l/100km over 100 km
      refuel({ odometer: 100, liters: 10, isFullTank: true }),
      // 5 l/100km over 900 km
      refuel({ odometer: 1000, liters: 45, isFullTank: true }),
    ];
    const stats = computeStats(entries);

    // A plain mean of the two points would be 7.5; distance weighting gives
    // 55 L over 1000 km = 5.5.
    expect(stats.avgConsumption).toBeCloseTo(5.5, 6);
    expect(stats.bestConsumption).toBeCloseTo(5, 6);
    expect(stats.worstConsumption).toBeCloseTo(10, 6);
    expect(stats.lastConsumption).toBeCloseTo(5, 6);
  });

  it('excludes the first fill from cost per km', () => {
    const entries = [
      refuel({ odometer: 0, liters: 50, pricePerLiter: 40 }),
      refuel({ odometer: 1000, liters: 50, pricePerLiter: 40 }),
    ];
    const stats = computeStats(entries);

    // Only the second fill (2000) paid for the tracked 1000 km.
    expect(stats.totalCost).toBeCloseTo(4000, 6);
    expect(stats.avgCostPerKm).toBeCloseTo(2, 6);
  });

  it('orders monthly series chronologically even when a fill is back-dated', () => {
    const entries = [
      refuel({ odometer: 1000, date: '2026-03-01' }),
      // Logged later at a higher odometer but dated earlier in the year.
      refuel({ odometer: 2000, date: '2026-01-15' }),
      refuel({ odometer: 3000, date: '2026-02-10' }),
    ];
    const months = computeStats(entries).monthlyCost.map((m) => m.month);
    expect(months).toEqual(['2026-01', '2026-02', '2026-03']);
  });

  it('totals CO2 using the factor for each fuel type', () => {
    const entries = [
      refuel({ odometer: 1000, liters: 10, fuelType: 'diesel' }),
      refuel({ odometer: 2000, liters: 10, fuelType: 'petrol' }),
      refuel({ odometer: 3000, liters: 10, fuelType: 'ev' }),
    ];
    // 10×2.68 + 10×2.31 + 10×0
    expect(computeStats(entries).totalCo2).toBeCloseTo(49.9, 6);
  });

  it('flags the average as estimated when it comes from partial fills', () => {
    const entries = [
      refuel({ odometer: 1000, liters: 30, isFullTank: false }),
      refuel({ odometer: 1400, liters: 30, isFullTank: false }),
      refuel({ odometer: 1800, liters: 30, isFullTank: false }),
    ];
    expect(computeStats(entries).isEstimatedConsumption).toBe(true);
  });

  it('does not flag a full-tank average as estimated', () => {
    const entries = [
      refuel({ odometer: 1000, isFullTank: true }),
      refuel({ odometer: 1500, isFullTank: true }),
    ];
    expect(computeStats(entries).isEstimatedConsumption).toBe(false);
  });
});

describe('computeRefuelWarnings', () => {
  it('flags an odometer that goes backwards', () => {
    const a = refuel({ id: 'a', odometer: 2000 });
    const b = refuel({ id: 'b', odometer: 1500 });
    expect(computeRefuelWarnings([a, b]).get('b')).toContain('Odometer not increasing');
  });

  it('measures a large fill against the tank size when it is known', () => {
    const big = refuel({ id: 'big', liters: 70 });
    // 70 L in a 50 L tank is implausible; the same fill is fine with no tank size,
    // where only the flat 100 L threshold applies.
    expect(computeRefuelWarnings([big], 50).get('big')?.some((w) => w.startsWith('Large fill'))).toBe(true);
    expect(computeRefuelWarnings([big], 0).has('big')).toBe(false);
  });

  it('flags a total that disagrees with litres times price', () => {
    const wrong = refuel({ id: 'wrong', liters: 40, pricePerLiter: 40, totalCost: 100 });
    expect(computeRefuelWarnings([wrong]).get('wrong')?.some((w) => w.includes('does not match'))).toBe(true);
  });

  it('leaves consistent entries unflagged', () => {
    const entries = [refuel({ id: 'a', odometer: 1000 }), refuel({ id: 'b', odometer: 2000 })];
    expect(computeRefuelWarnings(entries, 60).size).toBe(0);
  });
});
