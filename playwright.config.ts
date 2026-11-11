import { defineConfig, devices } from '@playwright/test';

// Pruebas del acceso contra el Supabase LOCAL (buzon Mailpit integrado) y un servidor de desarrollo local. Cero servicios externos.
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
  projects: [{ name: 'laptop-1440', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
  webServer: {
    command: 'sh -c "npx next build && npx next start -p 3100"',
    url: 'http://127.0.0.1:3100/api/health',
    reuseExistingServer: true,
    timeout: 300_000,
  },
});
