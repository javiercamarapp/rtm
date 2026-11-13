import { defineConfig, devices } from '@playwright/test';

// Capturas del carril de devoluciones contra `next dev -p 3109` y la base local propia (rtm-dev). Salida: docs/capturas/devoluciones.
export default defineConfig({
  testDir: 'test/capturas',
  testMatch: /devoluciones\.spec\.ts/,
  globalSetup: './test/e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 600_000,
  reporter: [['list']],
  use: { baseURL: process.env.APP_URL_E2E ?? 'http://127.0.0.1:3109' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
