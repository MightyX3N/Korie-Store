import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// The launcher is served from the root of its own origin (the Android app's ui host, or
// the browser host), so plain absolute paths are fine.
export default defineConfig({
  plugins: [svelte()],
  build: { outDir: 'dist', emptyOutDir: true, assetsInlineLimit: 0, target: 'chrome80' },
  server: { proxy: { '/bridge': 'http://localhost:8600', '/events': 'http://localhost:8600', '/__icon': 'http://localhost:8600', '/__pbs': 'http://localhost:8600' } },
});
