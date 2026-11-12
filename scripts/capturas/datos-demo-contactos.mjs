// Datos ILUSTRATIVOS de contactos de menudeo para las capturas (etapa 4). Telefonos y correos inventados (555 y example.test). NUNCA datos reales.
import { execFileSync } from 'node:child_process';
import pg from 'pg';

const url = JSON.parse(execFileSync('supabase', ['status', '-o', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })).DB_URL;
const c = new pg.Client({ connectionString: url });
await c.connect();
try {
  const origenes = [
    { origen: 'meta', anuncio: 'Anuncio ilustrativo 1', formulario: 'Formulario A' },
    { origen: 'meta', anuncio: 'Anuncio ilustrativo 2', formulario: 'Formulario B' },
    { origen: 'toocloudy' }, { origen: 'vapeunion' }, { origen: 'google-lote:uno' },
  ];
  const colonias = ['Centro', 'Montebello', 'Itzimná', 'Francisco de Montejo', ''];
  const contactos = Array.from({ length: 60 }, (_, i) => ({
    nombre: `Contacto ilustrativo ${i + 1}`,
    telefonos: [`+5299955${String(50000 + i).slice(-5)}`],
    correos: i % 4 === 0 ? [`demo${i}@example.test`] : [],
    colonias: colonias[i % 5] ? [colonias[i % 5]] : [],
    origenes: [origenes[i % 5]],
  }));
  await c.query('begin');
  await c.query("select set_config('rtm.canal', 'importacion', true)");
  const r = await c.query('select contactos.cargar_lote($1, $2::jsonb)', ['demo-capturas-e4', JSON.stringify(contactos)]);
  await c.query('commit');
  console.log(JSON.stringify(r.rows[0].cargar_lote));
} catch (e) { await c.query('rollback').catch(() => {}); console.error(String(e.message)); process.exitCode = 1; } finally { await c.end(); }
