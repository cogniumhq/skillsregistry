// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

// Static build. Output is served by the parent Hono process
// (apps/local/src/index.ts) via serveStatic at /admin/*.
export default defineConfig({
  output: 'static',
  outDir: './dist',
  base: '/admin',
  trailingSlash: 'always',
  vite: {
    plugins: [tailwindcss()],
  },
  build: {
    assets: '_assets',
  },
});
