import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      // Manifest icons are precached automatically; add the favicon too.
      includeAssets: ['icons/favicon.svg', 'icons/icon-180.png'],
      manifest: {
        id: '/',
        name: 'Ascend',
        short_name: 'Ascend',
        description: 'A calm study planner for your semester.',
        lang: 'en',
        categories: ['education', 'productivity'],
        start_url: '.',
        scope: '.',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#f7f2ea',
        theme_color: '#f7f2ea',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        // Long-press the home-screen icon (Android) for these.
        shortcuts: [
          { name: 'Today', short_name: 'Today', url: './#/today', icons: [{ src: 'icons/icon-192.png', sizes: '192x192' }] },
          { name: 'Attendance', short_name: 'Attendance', url: './#/attendance', icons: [{ src: 'icons/icon-192.png', sizes: '192x192' }] },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html}'],
        navigateFallback: 'index.html',
      },
    }),
  ],
  test: {
    include: ['tests/**/*.test.js'],
    environment: 'node',
  },
});
