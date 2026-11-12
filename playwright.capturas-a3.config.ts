import { defineConfig, devices } from '@playwright/test';

// Capturas del lote A3 (rediseno etapa 2) en Chromium contra el servidor de desarrollo propio (puerto 3103) y el Supabase local propio.
export default defineConfig({
  testDir: 'test/capturas',
  testMatch: /a3\.spec\.ts/,
  globalSetup: './test/e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 900_000,
  reporter: [['list']],
  use: { baseURL: 'http://127.0.0.1:3103' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: { command: 'npx next dev -p 3103', url: 'http://127.0.0.1:3103/api/health', reuseExistingServer: true, timeout: 240_000 },
});
