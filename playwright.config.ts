import { defineConfig } from '@playwright/test';

const fileRenderMode = process.env.ABYSS_RENDER_MODE === 'file';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  timeout: 30_000,
  workers: 1,
  projects: [
    {
      name: 'webkit',
      use: {
        browserName: 'webkit',
      },
    },
  ],
  use: {
    baseURL: fileRenderMode ? undefined : 'http://127.0.0.1:4173',
    headless: true,
  },
  webServer: fileRenderMode ? undefined : {
    command: 'npm run dev -- --host 127.0.0.1 --port 4173',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
