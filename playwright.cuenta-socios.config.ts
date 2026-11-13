import { defineConfig, devices } from '@playwright/test';

// e2e de la cuenta de socios por valuacion contra `next dev -p $E2E_PUERTO` (3190 por omision) y la base local propia con los datos reales privados cargados.
export default defineConfig({
  testDir: 'test/e2e',
  testMatch: /cuenta-socios\.spec\.ts/,
  globalSetup: './test/e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 240_000,
  reporter: [['list']],
  use: { baseURL: `http://127.0.0.1:${process.env.E2E_PUERTO ?? '3190'}` },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
