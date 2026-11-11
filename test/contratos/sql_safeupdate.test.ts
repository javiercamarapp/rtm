// PostgREST corre con la extension pg_safeupdate: un UPDATE o DELETE sin WHERE falla con "requires a WHERE clause" aunque pgTAP (que corre como postgres) no
// lo vea. Esta prueba recorre las migraciones y exige WHERE en todo UPDATE/DELETE que no sea un `ON CONFLICT ... DO UPDATE`.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const DIR = join(process.cwd(), 'supabase', 'migrations');

function sinComentarios(sql: string): string {
  return sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

describe('migraciones y pg_safeupdate', () => {
  for (const archivo of readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort()) {
    it(`${archivo}: todo UPDATE y DELETE lleva WHERE`, () => {
      const sql = sinComentarios(readFileSync(join(DIR, archivo), 'utf8'));
      // Solo dentro del cuerpo de funciones ($$ ... $$): lo que la web ejecuta. El DDL de las migraciones corre como postgres.
      const cuerpos = [...sql.matchAll(/\$(\w*)\$([\s\S]*?)\$\1\$/g)].map((m) => m[2]!);
      const malos: string[] = [];
      for (const cuerpo of cuerpos) {
        for (const m of cuerpo.matchAll(/\b(delete\s+from\s+[\w.]+|update\s+[\w.]+\s+set)\b([^;]*);/gi)) {
          const previo = cuerpo.slice(Math.max(0, (m.index ?? 0) - 40), m.index);
          if (/do\s*$/i.test(previo.trim()) || /on\s+conflict/i.test(previo)) continue; // ON CONFLICT DO UPDATE SET
          if (!/\bwhere\b/i.test(m[2]!)) malos.push(m[0].slice(0, 80));
        }
      }
      expect(malos).toEqual([]);
    });
  }
});
