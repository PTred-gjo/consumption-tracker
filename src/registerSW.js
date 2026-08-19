/**
 * Service worker registration.
 *
 * Only meaningful for the web/PWA build — inside the Capacitor Android shell the
 * assets are already local, so registration is skipped there.
 */

function isNativeShell() {
  return typeof window !== 'undefined' && Boolean(window.Capacitor?.isNativePlatform?.());
}

export function registerServiceWorker() {
  if (typeof window === 'undefined') return;
  if (!('serviceWorker' in navigator)) return;
  if (isNativeShell()) return;
  // The dev server serves modules that must not be cached.
  if (import.meta.env?.DEV) return;

  // BASE_URL is "/" for the Capacitor bundle and "/<repo>/" for a Pages deploy.
  const base = import.meta.env?.BASE_URL || '/';

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(`${base}sw.js`, { scope: base })
      .then((registration) => {
        registration.addEventListener('updatefound', () => {
          const installing = registration.installing;
          if (!installing) return;
          installing.addEventListener('statechange', () => {
            // A new version is ready but the old one still controls the page.
            // The app offers a reload rather than swapping assets under a form
            // that may be half filled in.
            if (installing.state === 'installed' && navigator.serviceWorker.controller) {
              window.dispatchEvent(new CustomEvent(UPDATE_EVENT));
            }
          });
        });
      })
      .catch((err) => {
        console.warn('Service worker registration failed:', err);
      });
  });
}

/** Dispatched on `window` when a newer build has finished downloading. */
export const UPDATE_EVENT = 'fp:update-available';

/** Hand control to the waiting worker, then reload onto the new build. */
export function applyServiceWorkerUpdate() {
  if (!('serviceWorker' in navigator)) {
    window.location.reload();
    return;
  }
  navigator.serviceWorker.getRegistration().then((registration) => {
    const waiting = registration?.waiting;
    if (!waiting) {
      window.location.reload();
      return;
    }
    // Reload once the new worker has actually taken over, otherwise the page
    // would come back on the old assets.
    navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload(), { once: true });
    waiting.postMessage('fp:skip-waiting');
  });
}
