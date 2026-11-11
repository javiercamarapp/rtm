import { defineConfig, devices } from '@playwright/test';

// Pruebas contra el Supabase LOCAL (buzon Mailpit integrado) y un servidor de produccion local. Cero servicios externos.
// Matriz de pantallas: laptop 1440 (Chromium), iPhone 16 Pro 402x874 (WebKit) y Samsung plegable cerrado (344) y abierto (880) en Chromium movil.
const ACCESO = /acceso\.spec\.ts/;
const F1 = /f1\.spec\.ts/;
const CONFIRMAR = /confirmar\.spec\.ts/;
const MOVIL = /movil\.spec\.ts/;
const F2 = /[\\/]f2\.spec\.ts$/;
const MOVIL_F2 = /movil-f2\.spec\.ts/;

export default defineConfig({
  testDir: 'test/e2e',
  testMatch: /.*\.spec\.ts/,
  globalSetup: './test/e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  reporter: [['list']],
  use: { baseURL: 'http://127.0.0.1:3100', trace: 'off' },
  projects: [
    { name: 'laptop-1440', testMatch: [ACCESO, F1, CONFIRMAR, F2], use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'iphone-16-pro', testMatch: [CONFIRMAR, MOVIL, MOVIL_F2], use: { ...devices['iPhone 15 Pro'], viewport: { width: 402, height: 874 }, screen: { width: 402, height: 874 }, deviceScaleFactor: 3 } },
    { name: 'fold-cerrado', testMatch: [CONFIRMAR, MOVIL, MOVIL_F2], use: { ...devices['Pixel 7'], viewport: { width: 344, height: 882 }, screen: { width: 344, height: 882 } } },
    { name: 'fold-abierto', testMatch: [CONFIRMAR, MOVIL, MOVIL_F2], use: { ...devices['Pixel 7'], viewport: { width: 880, height: 860 }, screen: { width: 880, height: 860 } } },
  ],
  webServer: {
    command: 'sh -c "npx next build && npx next start -p 3100"',
    url: 'http://127.0.0.1:3100/api/health',
    reuseExistingServer: true,
    timeout: 300_000,
  },
});
