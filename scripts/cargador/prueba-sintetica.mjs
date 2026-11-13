#!/usr/bin/env node
// Prueba de extremo a extremo del cargador con datos SINTETICOS (test/fixtures/cargador). Exige una base LOCAL recien reseteada con la semilla (scripts/cargador/semilla-local.sql):
//   supabase db reset && psql "$DATABASE_URL" -f scripts/cargador/semilla-local.sql && DATABASE_URL=... node scripts/cargador/prueba-sintetica.mjs
// Comprueba: carga completa sin errores, SEGUNDA corrida sin ningun cambio (idempotencia), libro conciliado y las cifras sinteticas esperadas.
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const url = process.env.DATABASE_URL;
if (!url || !/127\.0\.0\.1|localhost/.test(url)) { console.error('Solo contra una base LOCAL (DATABASE_URL con 127.0.0.1 o localhost).'); process.exit(2); }
const raiz = fileURLToPath(new URL('../..', import.meta.url));
const fx = `${raiz}test/fixtures/cargador`;
const llave = randomBytes(32).toString('base64');
const correr = (script, args, env = {}) => spawnSync('node', [`${raiz}scripts/cargador/${script}`, ...args], { encoding: 'utf8', env: { ...process.env, ...env } });
let fallos = 0;
const prueba = (ok, texto) => { console.log(`${ok ? 'OK   ' : 'FALLA'} ${texto}`); if (!ok) fallos += 1; };

const uno = correr('cargar.mjs', ['--archivos', fx, '--con-destinatarios'], { DS_LLAVE_DESTINATARIO: llave });
prueba(uno.status === 0, 'primera corrida termina sin errores');
if (uno.status !== 0) console.log(uno.stdout.split('\n').filter((l) => /FALLO|Advertencia/.test(l)).join('\n'), uno.stderr.split('\n').slice(0, 3).join('\n'));
const dos = correr('cargar.mjs', ['--archivos', fx, '--con-destinatarios'], { DS_LLAVE_DESTINATARIO: llave });
prueba(dos.status === 0 && /0 pasos aplicados/.test(dos.stdout), 'segunda corrida: 0 pasos aplicados (idempotente)');
const lotes = correr('cargar.mjs', ['--archivos', fx, '--lote', '3', '--con-destinatarios'], { DS_LLAVE_DESTINATARIO: llave });
prueba(lotes.status === 0 && /0 pasos aplicados/.test(lotes.stdout), 'correr un lote suelto ya cargado no cambia nada');
const cuadre = correr('cuadre.mjs', ['--objetivo', `${fx}/objetivo.json`]);
console.log(cuadre.stdout.split('\n').filter((l) => /\[ROJA|DIFERENCIA|RESULTADO/.test(l)).join('\n'));
prueba(cuadre.status === 0, 'cuadre: libro conciliado, comprobaciones sin rojas y objetivo sintetico cumplido');
prueba(/\[igual\] Capital aportado/.test(cuadre.stdout), 'capital sintetico igual al esperado');
console.log(fallos ? `\n${fallos} prueba(s) fallaron` : '\nPrueba sintetica completa.');
process.exit(fallos ? 1 : 0);
