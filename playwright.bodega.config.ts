import { defineConfig, devices } from '@playwright/test';

// Pruebas e2e del rol bodega y la pantalla Cuentas contra la base local propia del worktree (rtm-bodega, puertos 653xx) y `next start -p $E2E_PUERTO` (3197).
// Primero `npx next build`. Chromium 1440 y movil 390; las capturas (claro y oscuro) van a docs/capturas/bodega/.
const PUERTO = process.env.E2E_PUERTO ?? '3197';
export default defineConfig({
  testDir: 'test/e2e',
  testMatch: /bodega\.spec\.ts/,
  globalSetup: './test/e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  reporter: [['list']],
  use: { baseURL: `http://127.0.0.1:${PUERTO}` },
  projects: [
    { name: 'laptop-1440', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'movil-390', use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 }, screen: { width: 390, height: 844 } } },
  ],
  webServer: { command: `npx next start -p ${PUERTO}`, url: `http://127.0.0.1:${PUERTO}/api/health`, reuseExistingServer: true, timeout: 120_000 },
});
