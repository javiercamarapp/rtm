import { defineConfig, devices } from '@playwright/test';

// Capital por mes: e2e y capturas en Chromium (1440 y 390) contra el servidor de desarrollo propio (puerto 3187) y el Supabase local propio (proyecto rtm-capital).
export default defineConfig({
  testDir: 'test',
  testMatch: [/e2e[\\/]capital\.spec\.ts/, /capturas[\\/]capital\.spec\.ts/],
  globalSetup: './test/e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 300_000,
  reporter: [['list']],
  use: { baseURL: 'http://127.0.0.1:3187' },
  projects: [
    { name: 'laptop-1440', testMatch: [/e2e[\\/]capital\.spec\.ts/], use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'movil-390', testMatch: [/e2e[\\/]capital\.spec\.ts/], use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 }, screen: { width: 390, height: 844 } } },
    { name: 'capturas', testMatch: [/capturas[\\/]capital\.spec\.ts/], use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: { command: 'npx next dev -p 3187', url: 'http://127.0.0.1:3187/api/health', reuseExistingServer: true, timeout: 240_000 },
});
