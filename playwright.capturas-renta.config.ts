import { defineConfig, devices } from '@playwright/test';

// Capturas y e2e del Pago de renta contra `next dev -p 3190` ya levantado y la base local propia del worktree (project_id rtm-renta). Datos ILUSTRATIVOS.
export default defineConfig({
  testDir: 'test/capturas',
  testMatch: /pago-renta\.spec\.ts/,
  globalSetup: './test/e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 900_000,
  reporter: [['list']],
  use: { baseURL: `http://127.0.0.1:${process.env.E2E_PUERTO ?? '3190'}` },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
