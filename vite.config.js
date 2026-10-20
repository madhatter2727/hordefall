import { defineConfig } from 'vite';
const SITE = process.env.SITE_URL || 'https://hordefall.vercel.app';
export default defineConfig({
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
  plugins: [{ name: 'site-url', transformIndexHtml: (html) => html.replaceAll('%SITE_URL%', SITE) }],
});
