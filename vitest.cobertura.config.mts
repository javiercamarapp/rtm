// Configuracion para medir la cobertura de lineas del modulo de reportes (ver scripts/ci/cobertura-reportes.mjs).
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    include: ['test/unit/reportes/**/*.test.ts'],
    environment: 'node',
    testTimeout: 60_000,
    setupFiles: ['test/setup/cobertura.ts'],
    pool: 'forks',
  },
});
