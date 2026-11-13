import { defineConfig, devices } from '@playwright/test';

// Capturas del carril paquete-perdido contra el servidor propio (E2E_PUERTO, 3140 en esta sesion) y la base local propia. Salida: docs/capturas/paquete-perdido.
export default defineConfig({
  testDir: 'test/capturas',
  testMatch: /paquete-perdido\.spec\.ts/,
  globalSetup: './test/e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 600_000,
  reporter: [['list']],
  use: { baseURL: `http://127.0.0.1:${process.env.E2E_PUERTO ?? '3140'}` },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
