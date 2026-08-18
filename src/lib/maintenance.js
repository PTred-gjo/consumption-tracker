/**
 * Maintenance due-date logic — pure, colour-free.
 *
 * Callers map `status.key` to a palette colour themselves so this module stays
 * independent of the active theme.
 */

import { parseLocalDate } from './stats.js';

export const UPCOMING_WINDOW_DAYS = 30;
export const UPCOMING_WINDOW_KM = 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Date an item becomes due, or null when it has no day-based interval. */
export function getDueDate(item) {
  const lastDone = parseLocalDate(item.lastDoneAt);
  if (!lastDone || !(item.intervalDays > 0)) return null;
  const due = new Date(lastDone.getTime());
  due.setDate(due.getDate() + item.intervalDays);
  return due;
}

/** Odometer at which an item becomes due, or null when it has no km interval. */
export function getDueOdometer(item) {
  if (!(item.intervalKm > 0)) return null;
  return (item.lastDoneOdometer || 0) + item.intervalKm;
}

/**
 * @returns {{key: 'due'|'upcoming'|'ok', label: string, daysLeft: number|null, kmLeft: number|null}}
 */
export function getMaintenanceStatus(item, currentOdometer, now = new Date()) {
  const dueDate = getDueDate(item);
  const dueOdometer = getDueOdometer(item);

  const daysLeft = dueDate ? Math.ceil((dueDate.getTime() - now.getTime()) / DAY_MS) : null;
  const kmLeft = dueOdometer !== null ? dueOdometer - currentOdometer : null;

  const dateDue = daysLeft !== null && daysLeft <= 0;
  const kmDue = kmLeft !== null && kmLeft <= 0;

  if (dateDue || kmDue) {
    return { key: 'due', label: 'Overdue', daysLeft, kmLeft };
  }

  const upcomingDate = daysLeft !== null && daysLeft <= UPCOMING_WINDOW_DAYS;
  const upcomingKm = kmLeft !== null && kmLeft <= UPCOMING_WINDOW_KM;

  if (upcomingDate || upcomingKm) {
    return { key: 'upcoming', label: 'Due soon', daysLeft, kmLeft };
  }

  return { key: 'ok', label: 'OK', daysLeft, kmLeft };
}

/** The item that falls due soonest, or null. Used for the summary banner. */
export function getNextDueItem(items, currentOdometer, now = new Date()) {
  const scored = items
    .map((item) => ({ item, status: getMaintenanceStatus(item, currentOdometer, now) }))
    .filter(({ status }) => status.daysLeft !== null && status.daysLeft > 0)
    .sort((a, b) => a.status.daysLeft - b.status.daysLeft);
  return scored.length ? scored[0] : null;
}
