/**
 * Fuelio-style CSV import.
 *
 * Fuelio exports are not a single stable format — column names and the order of
 * sections vary by app version and locale — so columns are located by keyword
 * rather than by index.
 */

import { CURRENCIES, VEHICLE_COLORS } from './constants.js';
import { num, todayIso, uid } from './stats.js';

/** Rows can hold quoted fields containing commas, so this cannot be a split(','). */
export function parseCSVRow(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result.map((s) => s.trim());
}

export function normalizeCurrencyStr(raw) {
  const r = (raw || '').trim();
  if (CURRENCIES.includes(r)) return r;
  const code = r.toUpperCase();
  const byCode = {
    CZK: 'Kč',
    EUR: '€',
    USD: '$',
    GBP: '£',
    PLN: 'zł',
    SEK: 'kr',
    NOK: 'kr',
    DKK: 'kr',
  };
  return byCode[code] || 'Kč';
}

/**
 * Accepts DD/MM/YYYY, YYYY-MM-DD and DD.MM.YYYY, each optionally followed by a
 * time. Returns null when nothing recognisable is found, so the caller can
 * decide whether to skip the row or fall back to today.
 */
export function parseImportDate(raw) {
  const str = String(raw || '').trim();
  if (!str) return null;

  const iso = str.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;

  const dmy = str.match(/(\d{1,2})[/.](\d{1,2})[/.](\d{4})/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;

  return null;
}

/** Fuelio writes decimals with either separator depending on locale. */
export function parseNumeric(raw) {
  const str = String(raw ?? '').trim();
  if (!str) return 0;
  // Strip currency symbols, spaces and thousands separators, then normalise the
  // decimal mark. A comma is only a decimal mark when no dot follows it.
  let cleaned = str.replace(/[^0-9.,-]/g, '');
  if (cleaned.includes(',') && cleaned.includes('.')) {
    cleaned = cleaned.replace(/,/g, '');
  } else if (cleaned.includes(',')) {
    cleaned = cleaned.replace(',', '.');
  }
  return num(cleaned);
}

function normalizeFuelType(raw) {
  const t = String(raw || '').toLowerCase();
  if (t.includes('diesel') || t.includes('nafta')) return 'diesel';
  if (t.includes('lpg') || t.includes('lng')) return 'lpg';
  if (t.includes('ev') || t.includes('electric') || t.includes('elektr')) return 'ev';
  return 'petrol';
}

/**
 * Fuelio labels the date column "Data" in several locales, so both spellings
 * have to be recognised or those exports look header-less.
 */
function isDateHeader(c) {
  return c.includes('date') || c === 'data' || c.startsWith('data ') || c.includes('datum');
}

function isQuantityHeader(c) {
  return (
    c.includes('quantity') ||
    c.includes('fuel q') ||
    c.startsWith('fuel(') ||
    c.includes('litre') ||
    c.includes('liter')
  );
}

function detectColumns(row) {
  const cols = {};
  row.forEach((raw, idx) => {
    const c = raw.toLowerCase();
    if (isDateHeader(c) && cols.date === undefined) cols.date = idx;
    if (isQuantityHeader(c) && cols.liters === undefined) cols.liters = idx;
    if ((c.includes('price per unit') || c === 'price/unit' || c.includes('price per')) && cols.pricePerLiter === undefined) cols.pricePerLiter = idx;
    if ((c.includes('total price') || c === 'total' || c === 'total cost') && cols.totalCost === undefined) cols.totalCost = idx;
    if ((c.includes('full') || c.includes('partial')) && cols.isFullTank === undefined) cols.isFullTank = idx;
    if ((c.includes('odometer') || c.startsWith('odo')) && cols.odometer === undefined) cols.odometer = idx;
    if (c.includes('station') && cols.station === undefined) cols.station = idx;
    if ((c.includes('note') || c.includes('comment')) && cols.note === undefined) cols.note = idx;
    if (c.includes('vehicle') && cols.vehicle === undefined) cols.vehicle = idx;
    if ((c.includes('fuel type') || c === 'fuel') && cols.fuelType === undefined) cols.fuelType = idx;
    if (c.includes('currency') && cols.currency === undefined) cols.currency = idx;
  });
  return cols;
}

const HEADER_SEARCH_ROWS = 20;

export function parseFuelioCSV(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) throw new Error('The file is empty.');

  // Fuelio prefixes the fuel-log section with vehicle metadata blocks, so the
  // header can sit well below the first line.
  let headerIdx = -1;
  let cols = {};
  for (let i = 0; i < Math.min(HEADER_SEARCH_ROWS, lines.length); i++) {
    const row = parseCSVRow(lines[i]);
    const lower = row.map((c) => c.toLowerCase());
    const hasDate = lower.some(isDateHeader);
    const hasMetric = lower.some((c) => c.includes('odometer') || c.startsWith('odo') || isQuantityHeader(c));
    if (hasDate && hasMetric) {
      headerIdx = i;
      cols = detectColumns(lower);
      break;
    }
  }

  if (headerIdx === -1) {
    throw new Error('No fuel-log header row found. Export the log from Fuelio as CSV and try again.');
  }

  const vehicleMap = {};
  const refuelEntries = [];
  let skipped = 0;

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const row = parseCSVRow(lines[i]);
    if (!row.length || row.every((c) => !c)) continue;

    const liters = parseNumeric(cols.liters !== undefined ? row[cols.liters] : 0);
    const pricePerLiter = parseNumeric(cols.pricePerLiter !== undefined ? row[cols.pricePerLiter] : 0);
    const totalCostRaw = parseNumeric(cols.totalCost !== undefined ? row[cols.totalCost] : 0);
    const odometer = parseNumeric(cols.odometer !== undefined ? row[cols.odometer] : '');

    if (!(odometer > 0) || !(liters > 0)) {
      skipped++;
      continue;
    }

    const totalCost = totalCostRaw || liters * pricePerLiter;
    const isFullTankRaw = String(cols.isFullTank !== undefined ? row[cols.isFullTank] : '1').toLowerCase();
    const isFullTank = isFullTankRaw === '1' || isFullTankRaw === 'true' || isFullTankRaw === 'full' || isFullTankRaw === 'yes';
    const station = (cols.station !== undefined ? row[cols.station] : '').trim();
    const note = (cols.note !== undefined ? row[cols.note] : '').trim();
    const vehicleName = (cols.vehicle !== undefined ? row[cols.vehicle] : '').trim() || 'Imported Vehicle';
    const fuelType = normalizeFuelType(cols.fuelType !== undefined ? row[cols.fuelType] : '');
    const currencyRaw = cols.currency !== undefined ? row[cols.currency] : '';
    const isoDate = parseImportDate(cols.date !== undefined ? row[cols.date] : '') || todayIso();

    if (!vehicleMap[vehicleName]) {
      vehicleMap[vehicleName] = {
        id: uid('v'),
        name: vehicleName,
        make: '',
        model: '',
        year: 0,
        fuelType,
        fuelTypes: [fuelType],
        tankSize: 0,
        currency: normalizeCurrencyStr(currencyRaw),
        color: VEHICLE_COLORS[Object.keys(vehicleMap).length % VEHICLE_COLORS.length],
        createdAt: Date.now(),
      };
    }

    const vehicle = vehicleMap[vehicleName];
    if (!vehicle.fuelTypes.includes(fuelType)) vehicle.fuelTypes.push(fuelType);

    refuelEntries.push({
      id: uid('r'),
      vehicleId: vehicle.id,
      date: isoDate,
      odometer,
      liters,
      pricePerLiter: pricePerLiter || (liters > 0 ? totalCost / liters : 0),
      totalCost,
      fuelType,
      isFullTank,
      station,
      note,
      tripTag: '',
      photo: null,
      createdAt: Date.now(),
    });
  }

  if (!refuelEntries.length) {
    throw new Error('No rows with both an odometer reading and a fuel quantity were found.');
  }

  return { vehicles: Object.values(vehicleMap), refuels: refuelEntries, skipped };
}

/** Quote every field so embedded separators, quotes and newlines survive a round trip. */
export function toCSV(rows) {
  return rows
    .map((row) => row.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\r\n');
}
