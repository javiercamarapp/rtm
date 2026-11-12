import { defineConfig, devices } from '@playwright/test';

// Capturas del rediseno A1 contra `next dev -p 3101` ya levantado y la base local propia (proyecto rtm-a1). Salida: docs/capturas/rediseno-a1.
export default defineConfig({
  testDir: 'test/capturas',
  testMatch: /a1\.spec\.ts/,
  globalSetup: './test/e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 600_000,
  reporter: [['list']],
  use: { baseURL: 'http://127.0.0.1:3101' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
