import { describe, expect, it } from 'vitest';

import { BACKUP_FORMAT_VERSION, buildBackup, sanitizeBackup } from './backup.js';

const vehicle = { id: 'v1', name: 'Octavia', fuelType: 'diesel', currency: 'Kč' };
const refuel = {
  id: 'r1',
  vehicleId: 'v1',
  date: '2026-02-01',
  odometer: 120000,
  liters: 45,
  pricePerLiter: 38,
  totalCost: 1710,
};

describe('sanitizeBackup', () => {
  it('rejects anything that is not a backup object', () => {
    expect(() => sanitizeBackup(null)).toThrow(/not a FuelPilot backup/i);
    expect(() => sanitizeBackup([])).toThrow(/not a FuelPilot backup/i);
    expect(() => sanitizeBackup('{}')).toThrow(/not a FuelPilot backup/i);
  });

  it('rejects a backup missing its core lists', () => {
    expect(() => sanitizeBackup({ vehicles: [] })).toThrow(/missing/i);
  });

  it('rejects a backup with no usable vehicle', () => {
    expect(() => sanitizeBackup({ vehicles: [null], refuels: [] })).toThrow(/no usable vehicles/i);
  });

  it('accepts a well-formed backup unchanged in substance', () => {
    const result = sanitizeBackup({ vehicles: [vehicle], refuels: [refuel], maintenance: [] });
    expect(result.vehicles).toHaveLength(1);
    expect(result.refuels).toHaveLength(1);
    expect(result.refuels[0].odometer).toBe(120000);
    expect(result.selectedVehicleId).toBe('v1');
  });

  it('fills in every field the UI reads, so rendering cannot throw', () => {
    // A record like this used to be stored as-is and then crashed the history
    // list on `entry.odometer.toLocaleString()`.
    const sparse = { id: 'r2', vehicleId: 'v1', odometer: 5000, liters: 30 };
    const { refuels } = sanitizeBackup({ vehicles: [vehicle], refuels: [sparse], maintenance: [] });

    expect(refuels).toHaveLength(1);
    const entry = refuels[0];
    expect(typeof entry.date).toBe('string');
    expect(typeof entry.station).toBe('string');
    expect(typeof entry.note).toBe('string');
    expect(typeof entry.tripTag).toBe('string');
    expect(Number.isFinite(entry.totalCost)).toBe(true);
    expect(Number.isFinite(entry.pricePerLiter)).toBe(true);
    expect(entry.isFullTank).toBe(true);
    expect(entry.photo).toBeNull();
  });

  it('drops refuels that carry no usable odometer or quantity', () => {
    const result = sanitizeBackup({
      vehicles: [vehicle],
      refuels: [refuel, { id: 'bad', vehicleId: 'v1', odometer: 0, liters: 0 }, null],
      maintenance: [],
    });
    expect(result.refuels).toHaveLength(1);
    expect(result.dropped.refuels).toBe(2);
  });

  it('drops records pointing at a vehicle the backup does not contain', () => {
    const result = sanitizeBackup({
      vehicles: [vehicle],
      refuels: [refuel, { ...refuel, id: 'orphan', vehicleId: 'ghost' }],
      maintenance: [],
    });
    expect(result.refuels.map((r) => r.id)).toEqual(['r1']);
    expect(result.dropped.refuels).toBe(1);
  });

  it('keeps only data-URL photos', () => {
    const withScript = { ...refuel, id: 'r3', photo: 'javascript:alert(1)' };
    const withImage = { ...refuel, id: 'r4', photo: 'data:image/jpeg;base64,AAAA' };
    const { refuels } = sanitizeBackup({ vehicles: [vehicle], refuels: [withScript, withImage], maintenance: [] });

    expect(refuels.find((r) => r.id === 'r3').photo).toBeNull();
    expect(refuels.find((r) => r.id === 'r4').photo).toBe('data:image/jpeg;base64,AAAA');
  });

  it('repairs an out-of-range date rather than storing it', () => {
    const { refuels } = sanitizeBackup({
      vehicles: [vehicle],
      refuels: [{ ...refuel, date: '01/02/2026' }],
      maintenance: [],
    });
    expect(refuels[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('normalises maintenance history entries', () => {
    const item = {
      id: 'm1',
      vehicleId: 'v1',
      label: 'Oil',
      history: [{ date: '2026-01-01', odometer: '100000', cost: '1200' }, null],
    };
    const { maintenance } = sanitizeBackup({ vehicles: [vehicle], refuels: [], maintenance: [item] });
    expect(maintenance[0].history).toEqual([{ date: '2026-01-01', odometer: 100000, cost: 1200 }]);
  });

  it('falls back to the first vehicle when the selection is stale', () => {
    const result = sanitizeBackup({
      vehicles: [vehicle],
      refuels: [],
      maintenance: [],
      selectedVehicleId: 'deleted-vehicle',
    });
    expect(result.selectedVehicleId).toBe('v1');
  });

  it('tolerates a backup with no odometerReadings key at all', () => {
    const result = sanitizeBackup({ vehicles: [vehicle], refuels: [refuel], maintenance: [] });
    expect(result.odometerReadings).toEqual([]);
  });
});

describe('buildBackup', () => {
  it('stamps the format so a future import can tell what it is reading', () => {
    const payload = buildBackup({
      vehicles: [vehicle],
      refuels: [refuel],
      maintenance: [],
      odometerReadings: [],
      selectedVehicleId: 'v1',
    });
    expect(payload.format).toBe('fuelpilot-backup');
    expect(payload.version).toBe(BACKUP_FORMAT_VERSION);
    expect(typeof payload.exportedAt).toBe('string');
  });

  it('round-trips through sanitizeBackup', () => {
    const payload = buildBackup({
      vehicles: [vehicle],
      refuels: [refuel],
      maintenance: [],
      odometerReadings: [],
      selectedVehicleId: 'v1',
    });
    const restored = sanitizeBackup(JSON.parse(JSON.stringify(payload)));
    expect(restored.refuels).toHaveLength(1);
    expect(restored.vehicles[0].name).toBe('Octavia');
  });
});
