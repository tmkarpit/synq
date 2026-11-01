import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import seo from './seo.config.js';
import { fileURLToPath, URL } from 'node:url';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), seo()],
  resolve: {
    alias: [
      { find: '@', replacement: fileURLToPath(new URL('./src', import.meta.url)) },
      // monaco-editor's "exports" maps "./*" to "*.js", which hides its CSS files from
      // our features-only Monaco entry (src/features/editor/monaco/monacoCore.js).
      {
        find: /^monaco-editor\/(.+\.css)$/,
        replacement: fileURLToPath(
          new URL('./node_modules/monaco-editor/esm/vs/$1', import.meta.url),
        ),
      },
    ],
    // One Monaco and one Yjs instance (Yjs breaks when two copies are bundled).
    dedupe: ['monaco-editor', 'yjs'],
  },
  server: {
    // IPv4 loopback, so both http://127.0.0.1:5173 and http://localhost:5173 work
    // (plain "localhost" can bind IPv6 ::1 only). `npm run dev:lan` overrides this.
    host: '127.0.0.1',
    port: 5173,
    strictPort: false,
    // Live mode: the browser talks to this dev server only, so invite links that point
    // at it (http://<your-ip>:5173/room/...) work for everyone on the network.
    // 127.0.0.1, not localhost: Node resolves localhost to ::1 first, where another app
    // on port 4000 can answer instead of the SYNQ server.
    proxy: {
      '/socket.io': { target: process.env.SYNQ_SERVER_URL || 'http://127.0.0.1:4000', ws: true },
      // xfwd: passes the visitor's address on (X-Forwarded-For) for the login history.
      '/api': { target: process.env.SYNQ_SERVER_URL || 'http://127.0.0.1:4000', xfwd: true },
      // Go Live previews (http://localhost:5173/live/<token>/index.html).
      '/live': { target: process.env.SYNQ_SERVER_URL || 'http://127.0.0.1:4000' },
    },
  },
  build: {
    target: 'es2020',
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
  },
  worker: {
    format: 'es',
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.js'],
  },
});
