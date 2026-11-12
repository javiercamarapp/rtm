import { defineConfig, devices } from '@playwright/test';

// Recorrido de "cuadrar cuentas" con una base local de demostracion y un servidor ya levantado en el puerto 3190 (npx next dev -p 3190).
const URL_BASE = process.env.APP_URL_E2E ?? 'http://127.0.0.1:3190';
export default defineConfig({
  testDir: 'test/cuadre',
  testMatch: /.*\.spec\.ts/,
  globalSetup: './test/e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 600_000,
  reporter: [['list']],
  use: { baseURL: URL_BASE, actionTimeout: 20_000, navigationTimeout: 90_000, ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
});
