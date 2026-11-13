import { defineConfig, devices } from '@playwright/test';

// Capturas y metricas de la etapa 4 contra el servidor propio (E4_BASE; por omision desarrollo en el puerto 3104, pero para entregables usar un build de produccion: el de desarrollo pinta el indicador 'N Issue' en la captura) y el Supabase local propio.
const BASE = process.env.E4_BASE ?? 'http://127.0.0.1:3104';

export default defineConfig({
  testDir: 'test/capturas',
  testMatch: /e4\.spec\.ts/,
  globalSetup: './test/e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 1_800_000,
  reporter: [['list']],
  use: { baseURL: BASE },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: { command: 'npx next dev -p 3104', url: `${BASE}/api/health`, reuseExistingServer: true, timeout: 240_000 },
});
