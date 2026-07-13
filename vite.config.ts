import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The web UI lives in src/ui/app and compiles to dist/ui/public, where the
// engram ui server (dist/ui/server.js) serves it as static files.
export default defineConfig({
  root: 'src/ui/app',
  plugins: [react()],
  build: {
    outDir: '../../../dist/ui/public',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    // `npm run dev:ui` against a running `engram ui` for API + hot reload.
    proxy: { '/api': 'http://127.0.0.1:5423' },
  },
});
