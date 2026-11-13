import { defineConfig, devices } from '@playwright/test';

// Pruebas e2e del Historial y el acta contra `next dev -p $E2E_PUERTO` (3184 por omision) ya levantado y la base local propia del worktree con la demo sembrada.
export default defineConfig({
  testDir: 'test/e2e',
  testMatch: /historial-acta\.spec\.ts/,
  globalSetup: './test/e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 240_000,
  reporter: [['list']],
  use: { baseURL: `http://127.0.0.1:${process.env.E2E_PUERTO ?? '3184'}` },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
