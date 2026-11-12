import { defineConfig, devices } from '@playwright/test';

// Capturas y metricas de la etapa 3 (pulido) contra el servidor de desarrollo propio (puerto 3104) y el Supabase local propio.
export default defineConfig({
  testDir: 'test/capturas',
  testMatch: /e3\.spec\.ts/,
  globalSetup: './test/e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 1_800_000,
  reporter: [['list']],
  use: { baseURL: 'http://127.0.0.1:3104' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: { command: 'npx next dev -p 3104', url: 'http://127.0.0.1:3104/api/health', reuseExistingServer: true, timeout: 240_000 },
});
