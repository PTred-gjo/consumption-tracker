/**
 * Backup import validation.
 *
 * Imported records are rendered directly (`entry.odometer.toLocaleString()`,
 * `entry.date.slice(...)`), so a file missing a field would throw during render.
 * Every record is coerced to a complete shape here, and anything unusable is
 * dropped and reported rather than stored.
 */

import { FUEL_TYPES, VEHICLE_COLORS } from './constants.js';
import { num, todayIso, uid } from './stats.js';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function str(value, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function isoDate(value) {
  const s = str(value);
  return ISO_DATE.test(s) ? s : todayIso();
}

function fuelType(value, fallback = 'petrol') {
  const s = str(value).toLowerCase();
  return FUEL_TYPES.includes(s) ? s : fallback;
}

function sanitizeVehicle(raw, index) {
  if (!raw || typeof raw !== 'object') return null;
  const primary = fuelType(raw.fuelType, 'diesel');
  const fuelTypes = Array.isArray(raw.fuelTypes)
    ? [...new Set(raw.fuelTypes.map((f) => fuelType(f, primary)))]
    : [primary];
  if (!fuelTypes.includes(primary)) fuelTypes.unshift(primary);

  return {
    id: str(raw.id) || uid('v'),
    name: str(raw.name).trim() || `Vehicle ${index + 1}`,
    make: str(raw.make),
    model: str(raw.model),
    year: num(raw.year),
    fuelType: primary,
    fuelTypes,
    tankSize: num(raw.tankSize),
    currency: str(raw.currency) || 'Kč',
    color: str(raw.color) || VEHICLE_COLORS[index % VEHICLE_COLORS.length],
    createdAt: num(raw.createdAt) || Date.now(),
  };
}

function sanitizeRefuel(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const odometer = num(raw.odometer);
  const liters = num(raw.liters);
  // Without these two the entry cannot contribute to any calculation.
  if (!(odometer > 0) || !(liters > 0)) return null;

  const pricePerLiter = num(raw.pricePerLiter);
  const totalCost = num(raw.totalCost) || liters * pricePerLiter;

  return {
    id: str(raw.id) || uid('r'),
    vehicleId: str(raw.vehicleId),
    date: isoDate(raw.date),
    odometer,
    liters,
    pricePerLiter: pricePerLiter || (liters > 0 ? totalCost / liters : 0),
    totalCost,
    fuelType: fuelType(raw.fuelType),
    isFullTank: raw.isFullTank !== false,
    station: str(raw.station),
    note: str(raw.note),
    tripTag: str(raw.tripTag),
    photo: typeof raw.photo === 'string' && raw.photo.startsWith('data:image/') ? raw.photo : null,
    createdAt: num(raw.createdAt) || Date.now(),
  };
}

function sanitizeMaintenance(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const history = Array.isArray(raw.history)
    ? raw.history
        .filter((h) => h && typeof h === 'object')
        .map((h) => ({ date: isoDate(h.date), odometer: num(h.odometer), cost: num(h.cost) }))
    : [];

  return {
    id: str(raw.id) || uid('m'),
    vehicleId: str(raw.vehicleId),
    type: str(raw.type) || 'custom',
    label: str(raw.label).trim() || 'Maintenance',
    lastDoneAt: isoDate(raw.lastDoneAt),
    lastDoneOdometer: num(raw.lastDoneOdometer),
    intervalKm: num(raw.intervalKm),
    intervalDays: num(raw.intervalDays),
    cost: num(raw.cost),
    note: str(raw.note),
    history,
  };
}

function sanitizeOdometerReading(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const odometer = num(raw.odometer);
  if (!(odometer > 0)) return null;
  return {
    id: str(raw.id) || uid('o'),
    vehicleId: str(raw.vehicleId),
    date: isoDate(raw.date),
    odometer,
    createdAt: num(raw.createdAt) || Date.now(),
  };
}

/**
 * Validate and normalise a parsed backup object.
 *
 * @throws {Error} when the file is not a FuelPilot backup at all.
 * @returns {{vehicles, refuels, maintenance, odometerReadings, selectedVehicleId, dropped}}
 */
export function sanitizeBackup(parsed) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('This file is not a FuelPilot backup.');
  }
  if (!Array.isArray(parsed.vehicles) || !Array.isArray(parsed.refuels)) {
    throw new Error('This backup is missing its vehicles or refuels list.');
  }

  const vehicles = parsed.vehicles.map(sanitizeVehicle).filter(Boolean);
  const vehicleIds = new Set(vehicles.map((v) => v.id));
  const dropped = { vehicles: parsed.vehicles.length - vehicles.length, refuels: 0, maintenance: 0, odometerReadings: 0 };

  // A record pointing at a vehicle the backup does not contain would be
  // invisible in the UI but would still count towards storage.
  const belongsToKnownVehicle = (record) => vehicleIds.has(record.vehicleId);

  const rawMaintenance = Array.isArray(parsed.maintenance) ? parsed.maintenance : [];
  const rawOdometer = Array.isArray(parsed.odometerReadings) ? parsed.odometerReadings : [];

  const refuels = parsed.refuels.map(sanitizeRefuel).filter(Boolean).filter(belongsToKnownVehicle);
  const maintenance = rawMaintenance.map(sanitizeMaintenance).filter(Boolean).filter(belongsToKnownVehicle);
  const odometerReadings = rawOdometer.map(sanitizeOdometerReading).filter(Boolean).filter(belongsToKnownVehicle);

  dropped.refuels = parsed.refuels.length - refuels.length;
  dropped.maintenance = rawMaintenance.length - maintenance.length;
  dropped.odometerReadings = rawOdometer.length - odometerReadings.length;

  if (!vehicles.length) {
    throw new Error('This backup contains no usable vehicles.');
  }

  const selectedVehicleId = vehicleIds.has(str(parsed.selectedVehicleId))
    ? str(parsed.selectedVehicleId)
    : vehicles[0].id;

  return { vehicles, refuels, maintenance, odometerReadings, selectedVehicleId, dropped };
}

export const BACKUP_FORMAT_VERSION = 2;

export function buildBackup({ vehicles, refuels, maintenance, odometerReadings, selectedVehicleId, settings }) {
  return {
    format: 'fuelpilot-backup',
    version: BACKUP_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    vehicles,
    refuels,
    maintenance,
    odometerReadings,
    selectedVehicleId,
    settings: settings || {},
  };
}
