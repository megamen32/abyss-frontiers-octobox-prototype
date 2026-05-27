import { defineConfig } from 'vite';

export default defineConfig({
  base: process.env.BASE_URL || '/abyss-frontiers-octobox-prototype/',
  server: {
    host: '0.0.0.0',
    port: 4173,
  },
});
