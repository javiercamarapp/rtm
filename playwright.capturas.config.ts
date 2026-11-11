import { defineConfig, devices } from '@playwright/test';

// Capturas de F0 en Chromium y WebKit (descargados del registro oficial de Playwright). Salida: docs/capturas/f0.
export default defineConfig({
  testDir: 'test/capturas',
  testMatch: /.*\.spec\.ts/,
  globalSetup: './test/e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 240_000,
  reporter: [['list']],
  use: { baseURL: 'http://127.0.0.1:3100' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: {
    command: 'sh -c "npx next build && npx next start -p 3100"',
    url: 'http://127.0.0.1:3100/api/health',
    reuseExistingServer: true,
    timeout: 300_000,
  },
});
