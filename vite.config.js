import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf8'));

export default defineConfig({
  // GitHub Pages serves the app from /<repo>/, while Capacitor loads it from the
  // root of the WebView origin. The Pages build sets VITE_BASE; everything else
  // keeps the default so the Android bundle is unaffected.
  base: process.env.VITE_BASE || '/',
  plugins: [react()],
  define: {
    // Single source of truth for the version shown in Settings.
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  server: {
    host: true,
    port: 5173,
  },
  build: {
    // Capacitor loads the bundle from a file:// style origin where source maps
    // are the only way to read a crash report from a released build.
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          // Chart.js is ~200 kB and is only needed on the Stats tab.
          charts: ['chart.js'],
          react: ['react', 'react-dom'],
        },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.js'],
  },
});
