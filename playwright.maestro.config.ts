import { defineConfig, devices } from '@playwright/test';
// Campana maestra: sin servidor propio ni setup global (el servidor y las sesiones los prepara quien corre).
const PUERTO = process.env.E2E_PUERTO ?? '3290';
export default defineConfig({
  testDir: 'test/e2e/maestro',
  testMatch: /.*\.spec\.ts/,
  fullyParallel: false, workers: 1, retries: 0, timeout: 3_000_000, reporter: [['list']],
  use: { baseURL: `http://127.0.0.1:${PUERTO}`, trace: 'off' },
  projects: [
    { name: 'laptop-1440', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'movil-390', use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
});
