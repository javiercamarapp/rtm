// Arma el HTML del reporte mensual con los insumos REALES de la base local (escenario ilustrativo de capital) y lo guarda para capturarlo. Solo local.
// Uso: npx tsx scripts/capturas/reporte-capital.mts 2026-11-01 /ruta/salida.html
import { readFileSync, writeFileSync } from 'node:fs';
import pg from 'pg';
import { FuenteInsumosDb } from '../../src/infra/reportes/postgres';
import { armarPaquete } from '../../src/dominio/reportes/paquete';
import { construirReporte } from '../../src/dominio/reportes/paginas';
import { renderHtml } from '../../src/dominio/reportes/html';

const [inicio = '2026-11-01', salida = 'reporte-capital.html'] = process.argv.slice(2);
const url = /^SERVIDOR_DATABASE_URL=(.+)$/m.exec(readFileSync('.env.local', 'utf8'))![1]!;
const pool = new pg.Pool({ connectionString: url, max: 1 });
try {
  const fuente = new FuenteInsumosDb(async (texto, params = []) => (await pool.query(texto, [...params])).rows as never);
  const p = armarPaquete(await fuente.mensual(inicio));
  const r = construirReporte(p);
  writeFileSync(salida, renderHtml(r, { cssFuentes: '' }));
  console.log(`paginas=${r.paginas.length} sale=${r.sale} estado=${r.estado} capital=${r.paginas.some((x) => x.id === 'capital')} bloqueantes=${p.estado.bloqueantes.join(',')} fallas=${p.estado.fallas.join(',')}`);
} finally {
  await pool.end();
}
