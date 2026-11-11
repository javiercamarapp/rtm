import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    include: ['src/**/*.test.{ts,tsx}', 'test/unit/**/*.test.ts', 'test/contratos/**/*.test.ts'],
    environment: 'node',
    testTimeout: 20_000,
    // Cobertura (npm run cobertura:graficas): modulo de graficas y movimiento, minimo 90 % de lineas. Las dos graficas de F1 (barras.tsx, linea.tsx) no son de este modulo.
    coverage: {
      provider: 'v8',
      include: ['src/ui/graficas/**/*.{ts,tsx}', 'src/ui/movimiento/**/*.ts'],
      exclude: ['**/*.test.{ts,tsx}', 'src/ui/graficas/pruebas/**', 'src/ui/graficas/ejemplos.ts', 'src/ui/graficas/barras.tsx', 'src/ui/graficas/linea.tsx', 'src/ui/graficas/tipos.ts'],
      thresholds: { lines: 90, statements: 90, functions: 90, branches: 85 },
    },
  },
});
