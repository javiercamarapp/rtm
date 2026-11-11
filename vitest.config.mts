import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    include: ['src/**/*.test.{ts,tsx}', 'test/unit/**/*.test.ts', 'test/contratos/**/*.test.ts'],
    environment: 'node',
    testTimeout: 20_000,
  },
});
