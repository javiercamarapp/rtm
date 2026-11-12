import { defineConfig, devices } from '@playwright/test';

// Capturas de la etapa 2 (A2) en Chromium contra un servidor ya levantado en el puerto 3102 (npx next dev -p 3102). Salida: docs/capturas/rediseno-a2.
export default defineConfig({
  testDir: 'test/capturas',
  testMatch: /a2\.spec\.ts/,
  globalSetup: './test/e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 900_000,
  reporter: [['list']],
  use: { baseURL: 'http://127.0.0.1:3102' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
