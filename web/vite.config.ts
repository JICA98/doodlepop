import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

// In dev, Vite serves the UI on :5173 and proxies API + WebSocket traffic to `wrangler dev` on :8787.
export default defineConfig({
  plugins: [preact()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8787',
      '/ws': { target: 'ws://localhost:8787', ws: true },
    },
  },
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2020' },
});
