import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  site: process.env.SITE_URL || 'http://localhost:4322',
  adapter: vercel(),
  vite: { plugins: [tailwindcss()] },
  security: { checkOrigin: true },
  devToolbar: { enabled: false },
});
