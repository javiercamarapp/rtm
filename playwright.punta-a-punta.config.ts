import { defineConfig, devices } from '@playwright/test';

// Campaña de punta a punta (QA): ESCRITA Y TIPADA, NO EJECUTADA por quien la escribio. Otro agente la corre en tandas (ver test/e2e/LEEME-punta-a-punta.md).
// Un solo navegador a la vez (workers 1), tiempo de espera de 90 s por la Mac cargada, contra el servidor de produccion local en 3100 (reuseExistingServer)
// y el Supabase LOCAL. Matriz de pantallas: laptop 1440x900, iPhone 16 Pro 402x874 (WebKit), plegable cerrado 344x880 y abierto 880x860.
// Los dos temas (claro y oscuro) se recorren DENTRO de cada especificacion fijando localStorage `rtm-tema`.
const FLUJOS = /punta_a_punta_flujos\.spec\.ts/;
const LIMITES = /punta_a_punta_limites\.spec\.ts/;
const PERMISOS = /punta_a_punta_permisos\.spec\.ts/;
const PANTALLAS = /punta_a_punta_pantallas\.spec\.ts/;
const BOTONES = /punta_a_punta_botones\.spec\.ts/;

export default defineConfig({
  testDir: 'test/e2e',
  testMatch: /punta_a_punta_.*\.spec\.ts/,
  globalSetup: './test/e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  reporter: [['list']],
  outputDir: 'test-results/punta-a-punta',
  use: { baseURL: 'http://127.0.0.1:3100', trace: 'off' },
  projects: [
    { name: 'laptop-1440', testMatch: [FLUJOS, LIMITES, PERMISOS, PANTALLAS, BOTONES], use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'iphone-16-pro', testMatch: [PANTALLAS, BOTONES], use: { ...devices['iPhone 15 Pro'], viewport: { width: 402, height: 874 }, screen: { width: 402, height: 874 }, deviceScaleFactor: 3 } },
    { name: 'fold-cerrado', testMatch: [PANTALLAS, BOTONES], use: { ...devices['Pixel 7'], viewport: { width: 344, height: 880 }, screen: { width: 344, height: 880 } } },
    { name: 'fold-abierto', testMatch: [PANTALLAS, BOTONES], use: { ...devices['Pixel 7'], viewport: { width: 880, height: 860 }, screen: { width: 880, height: 860 } } },
  ],
  webServer: {
    command: 'sh -c "npx next build && npx next start -p 3100"',
    url: 'http://127.0.0.1:3100/api/health',
    reuseExistingServer: true,
    timeout: 300_000,
  },
});
