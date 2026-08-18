/**
 * Shared, UI-independent constants.
 *
 * Kept free of React and of the colour palette so the calculation modules that
 * import them stay pure and unit-testable.
 */

export const CURRENCIES = ['Kč', '€', '$', '£', 'zł', 'kr'];

export const VEHICLE_COLORS = [
  '#3B82F6', '#EF4444', '#10B981', '#F59E0B', '#8B5CF6',
  '#EC4899', '#14B8A6', '#F97316', '#6366F1', '#84CC16',
];

export const MAINT_TYPES = [
  { value: 'oil_change', label: 'Oil Change' },
  { value: 'tires', label: 'Tires' },
  { value: 'stk', label: 'STK' },
  { value: 'insurance', label: 'Insurance' },
  { value: 'custom', label: 'Custom' },
];

export const FUEL_TYPES = ['diesel', 'petrol', 'lpg', 'ev'];

export const FUEL_LABELS = { diesel: 'Diesel', petrol: 'Petrol', lpg: 'LPG', ev: 'EV' };

export const DEFAULT_TRIP_TAGS = ['Commute', 'Road Trip', 'Work', 'Personal'];

/** kg CO₂ per litre burnt. EV is 0 here because grid emissions are out of scope. */
export const CO2_FACTORS = { diesel: 2.68, petrol: 2.31, lpg: 1.51, ev: 0 };

/** Typical retail price per litre, used to seed the price reference table. */
export const DEFAULT_BASE_PRICES = { 'Kč': 36, '€': 1.6, '$': 3.5, '£': 1.5, 'zł': 6.5, 'kr': 18 };

/** Litres above which a single fill is flagged, when the tank size is unknown. */
export const DEFAULT_LARGE_FILL_LITERS = 100;
