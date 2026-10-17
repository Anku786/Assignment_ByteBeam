import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    // Precaches the app shell, the DuckDB wasm binaries and worker scripts so the
    // console loads and queries the local DB with no network after the first visit.
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Fleet Console',
        short_name: 'Fleet',
        display: 'standalone',
        start_url: '/',
        background_color: '#ffffff',
        theme_color: '#0b5fff',
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,wasm}'],
        maximumFileSizeToCacheInBytes: 100 * 1024 * 1024, // duckdb wasm binaries are large
        navigateFallback: '/index.html',
      },
    }),
  ],
  optimizeDeps: { exclude: ['@duckdb/duckdb-wasm'] },
  worker: { format: 'es' },
});