import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // No update prompt exists, so a waiting worker would keep serving a stale build.
      registerType: 'autoUpdate',
      injectRegister: 'script-defer',
      includeAssets: ['icon.svg', 'apple-touch-icon.png', 'push-sw.js'],
      manifest: {
        name: 'Marsad',
        short_name: 'Marsad',
        description: 'Private market-intelligence terminal',
        lang: 'en',
        dir: 'ltr',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#0b0f14',
        theme_color: '#0b0f14',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        navigateFallback: '/index.html',
        // Never cache API traffic: stale market data must not look live.
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [],
        // Push and notification-click handlers (ADR 0031).
        importScripts: ['push-sw.js'],
      },
    }),
  ],
  // Fonts must stay files: the production CSP allows font-src 'self' only, not data: URIs.
  build: { sourcemap: false, assetsInlineLimit: 0 },
});
