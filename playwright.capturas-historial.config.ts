import { defineConfig, devices } from '@playwright/test';

// Pruebas e2e del Historial y el acta contra `next dev -p 3184` ya levantado y la base local propia (proyecto rtm-lane-hist, puertos 633xx) con la demo sembrada.
export default defineConfig({
  testDir: 'test/capturas',
  testMatch: /historial\.spec\.ts/,
  globalSetup: './test/e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 900_000,
  reporter: [['list']],
  use: { baseURL: 'http://127.0.0.1:3184' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
