import { describe, expect, it } from 'vitest';

import { parseCSVRow, parseFuelioCSV, parseImportDate, parseNumeric, normalizeCurrencyStr, toCSV } from './csv.js';

describe('parseCSVRow', () => {
  it('keeps commas that sit inside quoted fields', () => {
    expect(parseCSVRow('a,"b,c",d')).toEqual(['a', 'b,c', 'd']);
  });

  it('unescapes doubled quotes', () => {
    expect(parseCSVRow('"say ""hi""",x')).toEqual(['say "hi"', 'x']);
  });

  it('preserves empty trailing fields', () => {
    expect(parseCSVRow('a,,')).toEqual(['a', '', '']);
  });
});

describe('parseImportDate', () => {
  it('reads the day-first format Fuelio exports', () => {
    expect(parseImportDate('05/03/2026')).toBe('2026-03-05');
    expect(parseImportDate('5/3/2026 14:30')).toBe('2026-03-05');
  });

  it('reads ISO and dotted formats', () => {
    expect(parseImportDate('2026-03-05')).toBe('2026-03-05');
    expect(parseImportDate('05.03.2026')).toBe('2026-03-05');
  });

  it('returns null when there is no date to find', () => {
    expect(parseImportDate('')).toBeNull();
    expect(parseImportDate('n/a')).toBeNull();
  });
});

describe('parseNumeric', () => {
  it('accepts a comma as the decimal mark', () => {
    expect(parseNumeric('38,45')).toBeCloseTo(38.45, 6);
  });

  it('treats a comma as a thousands separator when a dot is also present', () => {
    expect(parseNumeric('1,234.56')).toBeCloseTo(1234.56, 6);
  });

  it('strips currency symbols and spaces', () => {
    expect(parseNumeric('1 234 Kč')).toBeCloseTo(1234, 6);
    expect(parseNumeric('$3.50')).toBeCloseTo(3.5, 6);
  });

  it('is 0 for empty or unparseable input', () => {
    expect(parseNumeric('')).toBe(0);
    expect(parseNumeric('abc')).toBe(0);
  });
});

describe('normalizeCurrencyStr', () => {
  it('maps ISO codes onto the symbols the app uses', () => {
    expect(normalizeCurrencyStr('CZK')).toBe('Kč');
    expect(normalizeCurrencyStr('eur')).toBe('€');
    expect(normalizeCurrencyStr('SEK')).toBe('kr');
  });

  it('passes symbols through untouched', () => {
    expect(normalizeCurrencyStr('€')).toBe('€');
  });

  it('falls back rather than returning something unusable', () => {
    expect(normalizeCurrencyStr('???')).toBe('Kč');
  });
});

const FUELIO_CSV = [
  '"## Vehicle"',
  '"Name","Description"',
  '"Octavia","diesel wagon"',
  '',
  '"## Fuel log"',
  '"Data","Odometer (km)","Fuel quantity (l)","Price per unit","Total price","Full fill","Station","Notes","Vehicle","Fuel type","Currency"',
  '"01/02/2026","120000","45,5","38,90","1770,00","1","Shell","highway","Octavia","Diesel","CZK"',
  '"15/02/2026","120600","30,0","39,10","1173,00","0","OMV","","Octavia","Diesel","CZK"',
].join('\n');

describe('parseFuelioCSV', () => {
  it('finds the log header below the vehicle metadata block', () => {
    const { refuels } = parseFuelioCSV(FUELIO_CSV);
    expect(refuels).toHaveLength(2);
    expect(refuels[0].odometer).toBe(120000);
    expect(refuels[0].liters).toBeCloseTo(45.5, 6);
    expect(refuels[0].pricePerLiter).toBeCloseTo(38.9, 6);
    expect(refuels[0].date).toBe('2026-02-01');
  });

  it('reads the full/partial flag', () => {
    const { refuels } = parseFuelioCSV(FUELIO_CSV);
    expect(refuels[0].isFullTank).toBe(true);
    expect(refuels[1].isFullTank).toBe(false);
  });

  it('creates one vehicle per name and links the refuels to it', () => {
    const { vehicles, refuels } = parseFuelioCSV(FUELIO_CSV);
    expect(vehicles).toHaveLength(1);
    expect(vehicles[0].name).toBe('Octavia');
    expect(vehicles[0].currency).toBe('Kč');
    expect(new Set(refuels.map((r) => r.vehicleId))).toEqual(new Set([vehicles[0].id]));
  });

  it('normalises the fuel type', () => {
    expect(parseFuelioCSV(FUELIO_CSV).refuels[0].fuelType).toBe('diesel');
  });

  it('counts rows it had to skip instead of importing blanks', () => {
    const withJunk = `${FUELIO_CSV}\n"20/02/2026","","","","","1","","","Octavia","Diesel","CZK"`;
    const { refuels, skipped } = parseFuelioCSV(withJunk);
    expect(refuels).toHaveLength(2);
    expect(skipped).toBe(1);
  });

  it('explains itself when no header can be found', () => {
    expect(() => parseFuelioCSV('just,some,text\n1,2,3')).toThrow(/header/i);
  });

  it('rejects an empty file', () => {
    expect(() => parseFuelioCSV('')).toThrow(/empty/i);
  });

  it('rejects a file whose rows are all unusable', () => {
    const header = '"Date","Odometer","Fuel quantity"';
    expect(() => parseFuelioCSV(`${header}\n"01/02/2026","",""`)).toThrow(/no rows/i);
  });

  it('reads the abbreviated header style Fuelio also emits', () => {
    // Some exports use "Data"/"Odo(km)"/"Fuel(litres)" rather than the long
    // English names; both have to be recognised.
    const csv = [
      '"Data","Odo(km)","Fuel(litres)","Price per unit","Full"',
      '"01/02/2026","50000","42,0","38,50","1"',
    ].join('\n');
    const { refuels } = parseFuelioCSV(csv);
    expect(refuels).toHaveLength(1);
    expect(refuels[0].odometer).toBe(50000);
    expect(refuels[0].liters).toBeCloseTo(42, 6);
  });

  it('derives the unit price when only a total is given', () => {
    const csv = [
      '"Date","Odometer","Fuel quantity","Total price"',
      '"01/02/2026","1000","50","2000"',
    ].join('\n');
    expect(parseFuelioCSV(csv).refuels[0].pricePerLiter).toBeCloseTo(40, 6);
  });
});

describe('toCSV', () => {
  it('quotes every field and escapes embedded quotes', () => {
    expect(toCSV([['a', 'b,c'], ['say "hi"', '']])).toBe('"a","b,c"\r\n"say ""hi""",""');
  });

  it('renders null and undefined as empty fields', () => {
    expect(toCSV([[null, undefined]])).toBe('"",""');
  });
});
