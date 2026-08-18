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

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((registration) => {
        registration.addEventListener('updatefound', () => {
          const installing = registration.installing;
          if (!installing) return;
          installing.addEventListener('statechange', () => {
            // A new version is ready but the old one still controls the page.
            // Activating it immediately would swap assets under a form in
            // progress, so it takes effect on the next launch instead.
            if (installing.state === 'installed' && navigator.serviceWorker.controller) {
              window.dispatchEvent(new CustomEvent('fp:update-available'));
            }
          });
        });
      })
      .catch((err) => {
        console.warn('Service worker registration failed:', err);
      });
  });
}
