/**
 * localStorage access that cannot take the app down.
 *
 * Every write is guarded: a full quota (easy to hit once receipt photos are
 * stored) used to throw out of a render effect, which unmounted the whole tree
 * and left a blank screen with no way back to the data.
 */

const listeners = new Set();

/** Subscribe to write failures. Returns an unsubscribe function. */
export function onStorageError(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit(error) {
  for (const listener of listeners) {
    try {
      listener(error);
    } catch {
      /* a broken listener must not break the write path */
    }
  }
}

function isQuotaError(err) {
  if (!err) return false;
  return (
    err.name === 'QuotaExceededError' ||
    err.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    err.code === 22 ||
    err.code === 1014
  );
}

export function isStorageAvailable() {
  try {
    const probe = '__fp_probe__';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

export function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    const parsed = JSON.parse(raw);
    return parsed === undefined ? fallback : parsed;
  } catch {
    // Corrupt or unreadable entry — fall back rather than crash on boot.
    return fallback;
  }
}

/** @returns true when the value was persisted. */
export function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (err) {
    emit({
      key,
      quota: isQuotaError(err),
      message: isQuotaError(err)
        ? 'Device storage is full. Recent changes were not saved. Export a backup, then delete some receipt photos to free space.'
        : 'Changes could not be saved to this device.',
    });
    return false;
  }
}

export function removeKey(key) {
  try {
    localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

/** Approximate bytes used by this app's keys, for the storage meter in Settings. */
export function estimateUsedBytes(prefix = 'fuelpilot') {
  try {
    let total = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(prefix)) continue;
      const value = localStorage.getItem(key) || '';
      // UTF-16 code units, which is what browsers count against the quota.
      total += (key.length + value.length) * 2;
    }
    return total;
  } catch {
    return 0;
  }
}
