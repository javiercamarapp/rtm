import { defineConfig, devices } from '@playwright/test';

// Posicion con el proveedor (Proveedores, Inicio, hoja semanal) contra una base local propia y un servidor de produccion local ya levantado
// (npx next build && npx next start -p 3172; con next dev el CSP bloquea eval y la pagina no hidrata).
const URL_BASE = process.env.APP_URL_E2E ?? 'http://127.0.0.1:3172';
export default defineConfig({
  testDir: 'test/e2e',
  testMatch: /posicion-proveedores\.spec\.ts/,
  globalSetup: './test/e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 300_000,
  reporter: [['list']],
  use: { baseURL: URL_BASE, actionTimeout: 20_000, navigationTimeout: 90_000, ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
});
