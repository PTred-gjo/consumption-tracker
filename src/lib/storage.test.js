import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { estimateUsedBytes, onStorageError, readJSON, removeKey, writeJSON } from './storage.js';

/** Minimal localStorage stand-in; `failOn` makes setItem throw like a full quota. */
function createStubStorage({ failOn = null, errorName = 'QuotaExceededError' } = {}) {
  const map = new Map();
  return {
    get length() {
      return map.size;
    },
    key: (i) => Array.from(map.keys())[i] ?? null,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => {
      if (failOn === null || k === failOn || failOn === '*') {
        if (failOn !== null) {
          const err = new Error('quota');
          err.name = errorName;
          throw err;
        }
      }
      map.set(k, String(v));
    },
    removeItem: (k) => map.delete(k),
  };
}

let originalStorage;

beforeEach(() => {
  originalStorage = globalThis.localStorage;
});

afterEach(() => {
  globalThis.localStorage = originalStorage;
  vi.restoreAllMocks();
});

function useStorage(stub) {
  Object.defineProperty(globalThis, 'localStorage', { value: stub, configurable: true, writable: true });
}

describe('readJSON', () => {
  it('returns the stored value', () => {
    useStorage(createStubStorage());
    localStorage.setItem('k', JSON.stringify({ a: 1 }));
    expect(readJSON('k', null)).toEqual({ a: 1 });
  });

  it('returns the fallback for a missing key', () => {
    useStorage(createStubStorage());
    expect(readJSON('nope', 'fallback')).toBe('fallback');
  });

  it('returns the fallback instead of throwing on corrupt JSON', () => {
    useStorage(createStubStorage());
    localStorage.setItem('k', '{not json');
    expect(readJSON('k', [])).toEqual([]);
  });

  it('survives localStorage being unavailable entirely', () => {
    useStorage({
      get length() { return 0; },
      key: () => null,
      getItem: () => { throw new Error('blocked'); },
      setItem: () => {},
      removeItem: () => {},
    });
    expect(readJSON('k', 'fallback')).toBe('fallback');
  });
});

describe('writeJSON', () => {
  it('reports success and stores the value', () => {
    useStorage(createStubStorage());
    expect(writeJSON('k', [1, 2])).toBe(true);
    expect(localStorage.getItem('k')).toBe('[1,2]');
  });

  it('returns false instead of throwing when the quota is exceeded', () => {
    // The unguarded write used to throw out of a render effect and blank the app.
    useStorage(createStubStorage({ failOn: '*' }));
    expect(() => writeJSON('k', { a: 1 })).not.toThrow();
    expect(writeJSON('k', { a: 1 })).toBe(false);
  });

  it('notifies listeners with a quota flag and a readable message', () => {
    useStorage(createStubStorage({ failOn: '*' }));
    const seen = [];
    const off = onStorageError((e) => seen.push(e));

    writeJSON('fuelpilot_refuels', [1]);

    expect(seen).toHaveLength(1);
    expect(seen[0].key).toBe('fuelpilot_refuels');
    expect(seen[0].quota).toBe(true);
    expect(seen[0].message).toMatch(/storage is full/i);
    off();
  });

  it('marks non-quota failures as such', () => {
    useStorage(createStubStorage({ failOn: '*', errorName: 'SecurityError' }));
    const seen = [];
    const off = onStorageError((e) => seen.push(e));

    writeJSON('k', 1);

    expect(seen[0].quota).toBe(false);
    off();
  });

  it('stops notifying after unsubscribe', () => {
    useStorage(createStubStorage({ failOn: '*' }));
    const seen = [];
    onStorageError((e) => seen.push(e))();

    writeJSON('k', 1);

    expect(seen).toHaveLength(0);
  });

  it('keeps writing even when a listener throws', () => {
    useStorage(createStubStorage({ failOn: '*' }));
    const off = onStorageError(() => { throw new Error('bad listener'); });
    expect(() => writeJSON('k', 1)).not.toThrow();
    off();
  });
});

describe('removeKey', () => {
  it('removes an entry', () => {
    useStorage(createStubStorage());
    localStorage.setItem('k', '1');
    expect(removeKey('k')).toBe(true);
    expect(localStorage.getItem('k')).toBeNull();
  });
});

describe('estimateUsedBytes', () => {
  it('counts only this app’s keys', () => {
    useStorage(createStubStorage());
    localStorage.setItem('fuelpilot_a', 'xxxx');
    localStorage.setItem('somethingelse', 'yyyyyyyyyyyyyyyy');

    // UTF-16: (key length + value length) * 2.
    expect(estimateUsedBytes()).toBe(('fuelpilot_a'.length + 4) * 2);
  });

  it('is 0 when storage cannot be read', () => {
    useStorage({
      get length() { throw new Error('blocked'); },
      key: () => null,
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    });
    expect(estimateUsedBytes()).toBe(0);
  });
});
