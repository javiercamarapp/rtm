import { defineConfig, devices } from '@playwright/test';

// Pruebas e2e y capturas del carril de devoluciones contra `next dev -p 3109` ya levantado y la base local propia (proyecto rtm-dev, puertos 613xx).
const URL_BASE = process.env.APP_URL_E2E ?? 'http://127.0.0.1:3109';
export default defineConfig({
  testDir: 'test/e2e',
  testMatch: /devoluciones\.spec\.ts/,
  globalSetup: './test/e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 180_000,
  reporter: [['list']],
  use: { baseURL: URL_BASE, trace: 'off' },
  projects: [
    { name: 'laptop-1440', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'iphone-16-pro', use: { ...devices['iPhone 15 Pro'], viewport: { width: 402, height: 874 }, screen: { width: 402, height: 874 }, deviceScaleFactor: 2 } },
  ],
});
