import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

const base = process.env.VITE_BASE || '/';
const startUrl = base.endsWith('/') ? base : `${base}/`;

export default defineConfig({
  base,
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'CAS & Expiry Intelligence',
        short_name: 'CAS Intel',
        description: 'Analytics-only CAS and expiry intelligence terminal',
        theme_color: '#0b1220',
        background_color: '#0b1220',
        display: 'standalone',
        start_url: startUrl,
        icons: [],
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8787',
    },
  },
});
