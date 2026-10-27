import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

// The React app lives in web/ and builds to dist/, which Vercel serves.
// API routes stay in api/ (Vercel functions). In dev, /api is proxied to the
// local API server started by `npm run dev:api`.
export default defineConfig({
  root: 'web',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./web/src', import.meta.url)) },
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 900,
  },
  server: {
    proxy: { '/api': 'http://localhost:3000' },
  },
});
