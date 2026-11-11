import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Pruebas de integracion contra la base local (exigen Supabase arriba). Aparte de `vitest run` para no romper el paso previo a levantarla.
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: { include: ['test/integracion/**/*.test.ts'], environment: 'node', testTimeout: 60_000 },
});
