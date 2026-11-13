import { defineConfig, devices } from '@playwright/test';

// Recorrido de dropshipping contra el Supabase LOCAL propio (puertos 643xx) y un servidor de produccion local en el puerto 3417. Cero servicios externos, cero Vercel.
// Sin globalSetup compartido: el acceso usa el enlace por token_hash (sin correo).
const PUERTO = process.env.E2E_PUERTO ?? '3417';
export default defineConfig({
  testDir: 'test/e2e',
  testMatch: /dropshipping\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 240_000,
  reporter: [['list']],
  use: { baseURL: `http://127.0.0.1:${PUERTO}`, trace: 'off', permissions: ['clipboard-read', 'clipboard-write'] },
  projects: [
    { name: 'laptop-1440', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'movil-390', use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true } },
  ],
  webServer: { command: `sh -c "npx next start -p ${PUERTO}"`, url: `http://127.0.0.1:${PUERTO}/api/health`, reuseExistingServer: true, timeout: 120_000 },
});
