/**
 * Fuel statistics — pure functions, no React and no DOM.
 *
 * Consumption is always expressed in litres per 100 km and is derived from
 * odometer deltas, never from a user-entered distance.
 */

import { CO2_FACTORS, DEFAULT_LARGE_FILL_LITERS } from './constants.js';

export const todayIso = () => {
  // Local calendar date. `toISOString()` would shift the day for anyone east or
  // west of UTC around midnight, which silently mis-dates refuels.
  const now = new Date();
  const offsetMs = now.getTimezoneOffset() * 60 * 1000;
  return new Date(now.getTime() - offsetMs).toISOString().slice(0, 10);
};

export function num(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function fmt(value, digits = 2) {
  if (!Number.isFinite(value)) return '-';
  return value.toFixed(digits);
}

export function monthKey(dateStr) {
  return String(dateStr || '').slice(0, 7);
}

/** Parse a YYYY-MM-DD string as local midnight, matching how dates are entered. */
export function parseLocalDate(dateStr) {
  if (!dateStr) return null;
  const date = new Date(`${dateStr}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDate(dateStr) {
  const date = parseLocalDate(dateStr);
  if (!date) return '-';
  return date.toLocaleDateString();
}

export function uid(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function getVehicleRefuels(refuels, vehicleId) {
  return refuels
    .filter((x) => x.vehicleId === vehicleId)
    .map((entry) => {
      const liters = num(entry.liters);
      const pricePerLiter = num(entry.pricePerLiter);
      const rawTotalCost = entry.totalCost;
      const hasTotalCost =
        rawTotalCost !== undefined &&
        rawTotalCost !== null &&
        String(rawTotalCost).trim() !== '' &&
        Number.isFinite(Number(rawTotalCost));
      const totalCost = hasTotalCost ? num(rawTotalCost) : liters * pricePerLiter;
      const rawIsFullTank = entry.isFullTank;
      const isFullTank = rawIsFullTank == null
        ? true
        : (typeof rawIsFullTank === 'string'
            ? !['false', '0', 'no', 'partial'].includes(rawIsFullTank.trim().toLowerCase())
            : Boolean(rawIsFullTank));
      const rawCreatedAt = entry.createdAt;
      const createdAt = rawCreatedAt == null || String(rawCreatedAt).trim() === '' ? 0 : num(rawCreatedAt);
      return {
        ...entry,
        date: entry.date == null ? '' : String(entry.date),
        odometer: num(entry.odometer),
        liters,
        pricePerLiter,
        totalCost,
        isFullTank,
        createdAt,
      };
    })
    .slice()
    .sort(
      (a, b) =>
        a.odometer - b.odometer ||
        String(a.date).localeCompare(String(b.date)) ||
        (a.createdAt || 0) - (b.createdAt || 0)
    );
}

export function getCurrentOdometer(refuels) {
  if (!refuels.length) return 0;
  return Math.max(...refuels.map((x) => x.odometer));
}

export function computeConsumptionSeries(refuels) {
  // Primary: fill-to-full. Only emits a point between two brimmed tanks, where
  // the fuel burnt over the interval is known exactly.
  let accumulatedLiters = 0;
  let lastFullOdometer = null;
  const fullTankPoints = [];

  for (const entry of refuels) {
    accumulatedLiters += entry.liters;

    if (entry.isFullTank) {
      if (lastFullOdometer !== null) {
        const distance = entry.odometer - lastFullOdometer;
        if (distance > 0) {
          fullTankPoints.push({
            date: entry.date,
            odometer: entry.odometer,
            value: (accumulatedLiters / distance) * 100,
            liters: accumulatedLiters,
            distance,
          });
        }
      }

      accumulatedLiters = 0;
      lastFullOdometer = entry.odometer;
    }
  }

  if (fullTankPoints.length > 0) return { points: fullTankPoints, isRolling: false };

  // Fallback for users who rarely brim the tank: a rolling 3-fill window.
  // Over window [i-2, i-1, i] the litres of fills i-1 and i are spread across the
  // distance from i-2 to i. Fill i-2's litres are excluded because they replaced
  // fuel burnt before the window's starting odometer.
  const PARTIAL_WINDOW = 3;
  const rollingPoints = [];
  if (refuels.length >= PARTIAL_WINDOW) {
    for (let i = PARTIAL_WINDOW - 1; i < refuels.length; i++) {
      const windowStart = i - PARTIAL_WINDOW + 1;
      const distance = refuels[i].odometer - refuels[windowStart].odometer;
      if (distance <= 0) continue;
      let sumLiters = 0;
      for (let j = windowStart + 1; j <= i; j++) {
        sumLiters += refuels[j].liters;
      }
      if (sumLiters <= 0) continue;
      rollingPoints.push({
        date: refuels[i].date,
        odometer: refuels[i].odometer,
        value: (sumLiters / distance) * 100,
        liters: sumLiters,
        distance,
      });
    }
  }

  return { points: rollingPoints, isRolling: rollingPoints.length > 0 };
}

/**
 * Per-fill consumption series: one point per fill (from the second onward),
 * using the instantaneous interval `liters / (odometer_delta) * 100`.
 * Each point is tagged with `isFullTank` so the chart can colour them.
 */
export function computeAllFillsConsumptionSeries(refuels) {
  const points = [];
  for (let i = 1; i < refuels.length; i++) {
    const distance = refuels[i].odometer - refuels[i - 1].odometer;
    if (distance <= 0) continue;
    points.push({
      date: refuels[i].date,
      odometer: refuels[i].odometer,
      value: (refuels[i].liters / distance) * 100,
      liters: refuels[i].liters,
      distance,
      isFullTank: refuels[i].isFullTank,
    });
  }
  return points;
}

export function emptyStats() {
  return {
    consumptionSeries: [],
    allFillsConsumptionSeries: [],
    avgConsumption: 0,
    isEstimatedConsumption: false,
    bestConsumption: 0,
    worstConsumption: 0,
    lastConsumption: 0,
    avgDistancePerFill: 0,
    monthlyCost: [],
    priceSeries: [],
    monthlyDistance: [],
    totalCost: 0,
    avgCostPerKm: 0,
    lastCostPerKm: 0,
    totalDistance: 0,
    lastEntry: null,
    firstEntry: null,
    totalLiters: 0,
    totalCo2: 0,
    refuelCount: 0,
    fullFillCount: 0,
    partialFillCount: 0,
  };
}

/** @param refuels entries for a single vehicle, already sorted by odometer. */
export function computeStats(refuels) {
  if (!refuels.length) return emptyStats();

  const firstEntry = refuels[0];
  const lastEntry = refuels[refuels.length - 1];

  const { points: consumptionSeries, isRolling } = computeConsumptionSeries(refuels);

  // Distance-weighted, so a long interval counts for more than a short one.
  let avgConsumption = 0;
  let isEstimatedConsumption = isRolling;
  if (consumptionSeries.length) {
    const totalSeriesFuel = consumptionSeries.reduce((sum, p) => sum + p.liters, 0);
    const totalSeriesDist = consumptionSeries.reduce((sum, p) => sum + p.distance, 0);
    avgConsumption = totalSeriesDist > 0 ? (totalSeriesFuel / totalSeriesDist) * 100 : 0;
  }

  const lastConsumption = consumptionSeries.length
    ? consumptionSeries[consumptionSeries.length - 1].value
    : 0;

  const bestConsumption = consumptionSeries.length
    ? Math.min(...consumptionSeries.map((p) => p.value))
    : 0;
  const worstConsumption = consumptionSeries.length
    ? Math.max(...consumptionSeries.map((p) => p.value))
    : 0;

  const totalCost = refuels.reduce((sum, entry) => sum + entry.totalCost, 0);
  const totalLiters = refuels.reduce((sum, entry) => sum + entry.liters, 0);
  const totalCo2 = refuels.reduce(
    (sum, entry) => sum + entry.liters * (CO2_FACTORS[entry.fuelType] ?? CO2_FACTORS.petrol),
    0
  );
  const totalDistance = Math.max(0, lastEntry.odometer - firstEntry.odometer);

  let avgDistancePerFill = 0;
  if (refuels.length > 1) {
    const deltas = [];
    for (let i = 1; i < refuels.length; i += 1) {
      const d = refuels[i].odometer - refuels[i - 1].odometer;
      if (d > 0) deltas.push(d);
    }
    if (deltas.length) avgDistancePerFill = deltas.reduce((s, v) => s + v, 0) / deltas.length;
  }

  // Last resort when no series could be built: spread tracked fuel over tracked
  // distance. The first fill is excluded — it replaced fuel burnt before the
  // tracked window opened, same reasoning as avgCostPerKm below.
  if (avgConsumption === 0 && refuels.length > 1 && totalDistance > 0) {
    const trackedFuel = totalLiters - firstEntry.liters;
    if (trackedFuel > 0) {
      avgConsumption = (trackedFuel / totalDistance) * 100;
      isEstimatedConsumption = true;
    }
  }

  const costForTrackedDistance = refuels.length > 1 ? totalCost - firstEntry.totalCost : 0;
  const avgCostPerKm = totalDistance > 0 ? costForTrackedDistance / totalDistance : 0;

  let lastCostPerKm = 0;
  if (consumptionSeries.length > 0) {
    const lastPoint = consumptionSeries[consumptionSeries.length - 1];
    const matchingEntry = refuels.find(
      (r) => r.isFullTank && r.odometer === lastPoint.odometer && r.date === lastPoint.date
    );
    if (matchingEntry) {
      lastCostPerKm = (lastPoint.value * matchingEntry.pricePerLiter) / 100;
    }
  }

  const priceSeries = refuels.map((entry) => ({ date: entry.date, value: entry.pricePerLiter }));

  const monthlyCostMap = new Map();
  for (const entry of refuels) {
    const key = monthKey(entry.date);
    monthlyCostMap.set(key, (monthlyCostMap.get(key) || 0) + entry.totalCost);
  }

  const monthlyDistanceMap = new Map();
  for (let i = 1; i < refuels.length; i += 1) {
    const distance = refuels[i].odometer - refuels[i - 1].odometer;
    if (distance > 0) {
      const key = monthKey(refuels[i].date);
      monthlyDistanceMap.set(key, (monthlyDistanceMap.get(key) || 0) + distance);
    }
  }

  // Sorted by month, not by insertion: entries are ordered by odometer, so a
  // back-dated fill would otherwise plot its month out of sequence.
  const byMonth = (a, b) => a.month.localeCompare(b.month);
  const monthlyCost = Array.from(monthlyCostMap, ([month, value]) => ({ month, value })).sort(byMonth);
  const monthlyDistance = Array.from(monthlyDistanceMap, ([month, value]) => ({ month, value })).sort(byMonth);

  const allFillsConsumptionSeries = computeAllFillsConsumptionSeries(refuels);

  const fullFillCount = refuels.filter((r) => r.isFullTank).length;
  const partialFillCount = refuels.length - fullFillCount;

  return {
    consumptionSeries,
    allFillsConsumptionSeries,
    avgConsumption,
    isEstimatedConsumption,
    bestConsumption,
    worstConsumption,
    lastConsumption,
    avgDistancePerFill,
    monthlyCost,
    priceSeries,
    monthlyDistance,
    totalCost,
    avgCostPerKm,
    lastCostPerKm,
    totalDistance,
    lastEntry,
    firstEntry,
    totalLiters,
    totalCo2,
    refuelCount: refuels.length,
    fullFillCount,
    partialFillCount,
  };
}

/**
 * Plausibility checks on a vehicle's refuels, keyed by entry id.
 * @param tankSize litres; 0 when unknown, in which case a flat threshold applies.
 */
export function computeRefuelWarnings(refuels, tankSize = 0) {
  const warnings = new Map();
  if (!refuels.length) return warnings;

  const avgPrice = refuels.reduce((s, r) => s + r.pricePerLiter, 0) / refuels.length;
  // A fill can legitimately exceed the tank a little (jerry cans, brimming the
  // filler neck), so only flag well past it.
  const largeFill = tankSize > 0 ? tankSize * 1.15 : DEFAULT_LARGE_FILL_LITERS;

  for (let i = 0; i < refuels.length; i++) {
    const r = refuels[i];
    const warns = [];
    if (i > 0 && r.odometer <= refuels[i - 1].odometer) {
      warns.push('Odometer not increasing');
    }
    if (r.liters > largeFill) {
      warns.push(`Large fill: ${fmt(r.liters, 1)} L${tankSize > 0 ? ` (tank ${tankSize} L)` : ''}`);
    }
    if (avgPrice > 0 && r.pricePerLiter > avgPrice * 3) {
      warns.push(`Unusually high price (avg: ${fmt(avgPrice, 2)})`);
    }
    if (r.liters > 0 && r.pricePerLiter > 0) {
      const implied = r.liters * r.pricePerLiter;
      if (Math.abs(implied - r.totalCost) > Math.max(0.5, implied * 0.02)) {
        warns.push(`Total does not match litres × price (${fmt(implied, 2)})`);
      }
    }
    if (warns.length > 0) warnings.set(r.id, warns);
  }
  return warnings;
}
