// Importador de contactos de MENUDEO (solo lectura de las fuentes; no toca ninguna base).
//   npx tsx scripts/contactos/importar.mts                       informe de conteos (sin datos personales) en pantalla
//   npx tsx scripts/contactos/importar.mts --json ruta.json      ademas escribe el informe (sin datos personales)
//   npx tsx scripts/contactos/importar.mts --lotes carpeta       escribe lotes JSON para contactos.cargar_lote (CONTIENEN datos personales: carpeta FUERA del repo)
//   npx tsx scripts/contactos/importar.mts --prueba-idempotencia  corre dos veces con otro orden y compara huellas
// Fuentes por omision: carpeta NUMEROS VAPES, leads de Toocloudy, contactos de Descargas y el CSV de Meta (UTF-16).
// Para otras fuentes: --fuente tipo=ruta (tipo: google|meta|toocloudy|vapeunion), repetible.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, resolve, relative } from 'node:path';
import { construirInforme, consolidar, consolidarConEstadisticas } from '@/dominio/contactos/consolidar';
import { decodificarTexto, parsearCsv } from '@/dominio/contactos/csv';
import { leerTabla } from '@/dominio/contactos/leer';
import { tablaSinCabecera } from '@/dominio/contactos/plana';
import { leerVcf } from '@/dominio/contactos/vcard';
import type { ContactoConsolidado, FuenteTabla, ResultadoLectura, TipoFuente } from '@/dominio/contactos/tipos';
import { leerXlsx } from './xlsx.mjs';

const args = process.argv.slice(2);
const flag = (n: string) => args.includes(`--${n}`);
const valores = (n: string) => args.flatMap((a, i) => (a === `--${n}` && args[i + 1] ? [args[i + 1]!] : []));

const raizRepo = resolve(new URL('../..', import.meta.url).pathname);

interface Fuente { ruta: string; id: string; tipo: TipoFuente }

function fuentesPorOmision(): Fuente[] {
  const escritorio = join(homedir(), 'Desktop/TOOCLOUDY');
  const descargas = join(homedir(), 'Downloads');
  const out: Fuente[] = [];
  const vapes = join(escritorio, 'NÚMEROS VAPES');
  if (existsSync(vapes)) {
    for (const n of readdirSync(vapes).sort()) {
      if (!/\.(csv|xlsx|vcf)$/i.test(n)) continue;
      out.push({ ruta: join(vapes, n), id: `numeros-vapes/${n}`, tipo: /^VAPEUNION/i.test(n) ? 'vapeunion' : /\.vcf$/i.test(n) ? 'vcf' : 'google' });
    }
  }
  const suelto = join(escritorio, '1573.vcf');
  if (existsSync(suelto)) out.push({ ruta: suelto, id: 'toocloudy/1573.vcf', tipo: 'vcf' });
  const leads = join(escritorio, 'leads whatsapp FINAL.xlsx');
  if (existsSync(leads)) out.push({ ruta: leads, id: 'toocloudy/leads whatsapp FINAL.xlsx', tipo: 'toocloudy' });
  for (const n of ['contacts-12.xlsx', 'contacts (1).xlsx']) {
    if (existsSync(join(descargas, n))) out.push({ ruta: join(descargas, n), id: `descargas/${n}`, tipo: 'google' });
  }
  if (existsSync(join(descargas, 'BASE DE DATOS.xlsx'))) out.push({ ruta: join(descargas, 'BASE DE DATOS.xlsx'), id: 'descargas-base-de-datos.xlsx', tipo: 'plano' });
  if (existsSync(join(descargas, 'contacts.csv'))) out.push({ ruta: join(descargas, 'contacts.csv'), id: 'descargas-contacts.csv', tipo: 'google' });
  if (existsSync(join(descargas, 'contacts (1).csv'))) out.push({ ruta: join(descargas, 'contacts (1).csv'), id: 'descargas-contacts-1.csv', tipo: 'google' });
  if (existsSync(descargas)) {
    for (const n of readdirSync(descargas).sort()) if (/^Simple form setup.*Leads.*\.csv$/i.test(n)) out.push({ ruta: join(descargas, n), id: `meta/${n.slice(0, 40)}`, tipo: 'meta' });
  }
  return out;
}

function fuentesExplicitas(): Fuente[] {
  return valores('fuente').map((v) => {
    const [tipo, ...resto] = v.split('=');
    const ruta = resto.join('=');
    return { ruta, id: `${tipo}/${basename(ruta)}`, tipo: tipo as TipoFuente };
  });
}

function leerFuente(f: Fuente): ResultadoLectura {
  const bytes = readFileSync(f.ruta);
  const tabla = f.tipo === 'plano' ? tablaSinCabecera(leerXlsx(bytes)) : /\.xlsx$/i.test(f.ruta) ? leerXlsx(bytes) : /\.vcf$/i.test(f.ruta) ? leerVcf(decodificarTexto(bytes)) : parsearCsv(decodificarTexto(bytes));
  const fuente: FuenteTabla = { archivo: f.id, tipo: f.tipo };
  return leerTabla(tabla, fuente);
}

function huella(contactos: ContactoConsolidado[]): string {
  return createHash('sha256').update(JSON.stringify(contactos)).digest('hex').slice(0, 16);
}

function dentroDelRepo(ruta: string): boolean {
  const rel = relative(raizRepo, resolve(ruta));
  return !rel.startsWith('..') && !rel.startsWith('/');
}

const fuentes = valores('fuente').length ? fuentesExplicitas() : fuentesPorOmision();
if (fuentes.length === 0) { console.error('No hay fuentes de contactos.'); process.exit(1); }

const lecturas: ResultadoLectura[] = [];
for (const f of fuentes) {
  try { lecturas.push(leerFuente(f)); } catch (e) { console.error(`No se pudo leer ${f.id}: ${(e as Error).message}`); process.exitCode = 1; }
}
const registros = lecturas.flatMap((l) => l.registros);
const { contactos, unidos_por_correo_y_nombre: unidosPorCorreo } = consolidarConEstadisticas(registros);
const informe = construirInforme(lecturas, contactos, unidosPorCorreo);

if (flag('prueba-idempotencia')) {
  const a = huella(contactos);
  const b = huella(consolidar([...registros].reverse()));
  console.log(`huella directa=${a} orden inverso=${b}`);
  if (a !== b) { console.error('FALLA: el resultado depende del orden.'); process.exit(1); }
  console.log('Determinista: el orden de entrada no cambia el resultado.');
}

console.log('== Informe de contactos de menudeo (sin datos personales) ==');
console.table(informe.por_archivo.map((a) => ({ archivo: a.archivo, tipo: a.tipo, filas: a.filas, validos: a.con_telefono_valido, vacias: a.descartes.fila_vacia, sin_tel: a.descartes.sin_telefono, cortos: a.descartes.corto, largos: a.descartes.largo, falsos: a.descartes.patron_falso, sin_lada: a.sin_lada, correo_inv: a.descartes.correo_invalido, extranj: a.extranjeros })));
console.log('Totales:', JSON.stringify(informe.totales));
console.log('Por origen (un contacto puede tener varios):');
console.table(informe.por_origen);
if (informe.por_anuncio.length) { console.log('Meta por anuncio y formulario:'); console.table(informe.por_anuncio); }
console.log(`Etiquetas y grupos distintos: ${informe.etiquetas.length}`);
console.table(informe.etiquetas);

const rutaJson = valores('json')[0];
if (rutaJson) {
  if (dentroDelRepo(rutaJson)) { console.error('Rechazado: el informe se escribe fuera del repo.'); process.exit(1); }
  writeFileSync(rutaJson, JSON.stringify(informe, null, 2));
  console.log(`Informe escrito en ${rutaJson}`);
}

const carpetaLotes = valores('lotes')[0];
if (carpetaLotes) {
  if (dentroDelRepo(carpetaLotes)) { console.error('Rechazado: los lotes contienen datos personales y no pueden escribirse dentro del repo.'); process.exit(1); }
  mkdirSync(carpetaLotes, { recursive: true, mode: 0o700 });
  const TAM = 500;
  for (let i = 0; i < contactos.length; i += TAM) {
    const n = String(i / TAM + 1).padStart(4, '0');
    writeFileSync(join(carpetaLotes, `lote-${n}.json`), JSON.stringify(contactos.slice(i, i + TAM)), { mode: 0o600 });
  }
  console.log(`Escritos ${Math.ceil(contactos.length / TAM)} lotes de hasta ${TAM} contactos en ${carpetaLotes} (no se cargaron a ninguna base).`);
}
