import { defineConfig, devices } from '@playwright/test';

// e2e del pulido final (inventario: Concilia con el libro y sabor nuevo en la hoja de conteo; /proveedores, /cuentas y /socios las cubren sus propias configuraciones).
// Servidor ya levantado en APP_URL_E2E (o http://127.0.0.1:$E2E_PUERTO); capturas fuera del repo en PULIDO_CAPTURAS.
const URL_BASE = process.env.APP_URL_E2E ?? `http://127.0.0.1:${process.env.E2E_PUERTO ?? '3197'}`;
export default defineConfig({
  testDir: 'test/e2e',
  testMatch: /pulido-inventario\.spec\.ts/,
  globalSetup: './test/e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 300_000,
  reporter: [['list']],
  use: { baseURL: URL_BASE, actionTimeout: 20_000, navigationTimeout: 90_000, ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
});
