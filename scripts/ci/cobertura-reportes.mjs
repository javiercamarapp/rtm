// Cobertura de lineas del modulo de reportes (>= 90 %). Corre las pruebas de test/unit/reportes con la cobertura precisa de V8,
// une los volcados de todos los procesos y mapea a las lineas del TypeScript original con el mapa de fuentes en linea de vite-node.
//   node scripts/ci/cobertura-reportes.mjs [--minimo=90]
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { SourceMapConsumer } = require('source-map-js');
const raiz = new URL('../..', import.meta.url).pathname.replace(/\/$/, '');
const minimo = Number((process.argv.find((a) => a.startsWith('--minimo=')) ?? '--minimo=90').split('=')[1]);
const dir = mkdtempSync(join(tmpdir(), 'rtm-cob-'));

const r = spawnSync('npx', ['vitest', 'run', '--config', 'vitest.cobertura.config.mts'], { cwd: raiz, env: { ...process.env, COBERTURA_DIR: dir }, encoding: 'utf8' });
const ultimas = (r.stdout + r.stderr).trim().split('\n').slice(-6).join('\n');
if (r.status !== 0) {
  console.error(`Las pruebas fallaron:\n${ultimas}`);
  rmSync(dir, { recursive: true, force: true });
  process.exit(1);
}

/** por archivo: lineas ejecutables y lineas cubiertas (union entre procesos). */
const porArchivo = new Map();
for (const f of readdirSync(dir)) {
  for (const a of JSON.parse(readFileSync(join(dir, f), 'utf8'))) {
    const ruta = relative(raiz, new URL(a.url.split('?')[0]).pathname);
    const m = /\/\/# sourceMappingURL=data:application\/json;base64,([A-Za-z0-9+/=]+)/.exec(a.source);
    if (!m) continue;
    const consumidor = new SourceMapConsumer(JSON.parse(Buffer.from(m[1], 'base64').toString('utf8')));
    // cubierto por caracter: los rangos vienen de afuera hacia adentro; el mas interno manda.
    const cubierto = new Int8Array(a.source.length).fill(-1);
    const rangos = [...a.ranges].sort((x, y) => x.startOffset - y.startOffset || y.endOffset - x.endOffset);
    for (const g of rangos) for (let i = g.startOffset; i < Math.min(g.endOffset, cubierto.length); i++) cubierto[i] = g.count > 0 ? 1 : 0;
    const ejecutables = new Set();
    const noCubiertas = new Set();
    const lineas = a.source.split('\n');
    let offset = 0;
    for (let li = 0; li < lineas.length; li++) {
      const texto = lineas[li];
      for (let col = 0; col < texto.length; col++) {
        const c = texto[col];
        if (/\s/.test(c) || cubierto[offset + col] === -1) continue;
        const o = consumidor.originalPositionFor({ line: li + 1, column: col });
        if (o.line == null) continue;
        ejecutables.add(o.line);
        if (cubierto[offset + col] === 0) noCubiertas.add(o.line);
      }
      offset += texto.length + 1;
    }
    const previo = porArchivo.get(ruta) ?? { ejecutables: new Set(), cubiertas: new Set() };
    for (const l of ejecutables) {
      previo.ejecutables.add(l);
      if (!noCubiertas.has(l)) previo.cubiertas.add(l);
    }
    porArchivo.set(ruta, previo);
  }
}
rmSync(dir, { recursive: true, force: true });

// Una linea cuenta como cubierta si lo fue en al menos un proceso de prueba.
let totE = 0;
let totC = 0;
const filas = [];
for (const [ruta, v] of [...porArchivo.entries()].sort()) {
  const e = v.ejecutables.size;
  const c = v.cubiertas.size;
  totE += e;
  totC += c;
  const sinCubrir = [...v.ejecutables].filter((l) => !v.cubiertas.has(l)).sort((a, b) => a - b);
  filas.push({ ruta, e, c, pct: e ? (100 * c) / e : 100, sinCubrir });
}
for (const f of filas) console.log(`${f.pct.toFixed(1).padStart(6)} %  ${String(f.c).padStart(4)}/${String(f.e).padEnd(4)} ${f.ruta}${f.sinCubrir.length ? `  (sin cubrir: ${f.sinCubrir.slice(0, 12).join(', ')}${f.sinCubrir.length > 12 ? ', ...' : ''})` : ''}`);
const pct = totE ? (100 * totC) / totE : 0;
console.log(`\nCobertura de lineas del modulo de reportes: ${pct.toFixed(2)} % (${totC} de ${totE} lineas, ${filas.length} archivos). Minimo: ${minimo} %.`);
console.log(ultimas.split('\n').filter((l) => /Tests|Test Files/.test(l)).join('\n'));
if (pct < minimo) {
  console.error('Cobertura por debajo del minimo.');
  process.exit(1);
}
