// Guardas del demo. El conjunto demo NUNCA se siembra en produccion ni en un proyecto de la nube que no este declarado como demo.
// Funciones puras (salvo `baseVacia`, que solo LEE): se prueban en test/unit/demo.
import { fileURLToPath } from 'node:url';

/** Referencias de proyectos de Supabase que son REALES: el demo se niega a tocarlos, con cualquier bandera. */
export const PROYECTOS_PRODUCCION = ['kaapcbypmjclqrkwwegp'];
const ANFITRIONES_LOCALES = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export class ErrorGuarda extends Error {
  constructor(mensaje) {
    super(mensaje);
    this.name = 'ErrorGuarda';
  }
}

/** Nombre del proyecto de Supabase que insinua una URL (db.<ref>.supabase.co o usuario postgres.<ref>), o null. */
export function proyectoDeUrl(texto) {
  const u = new URL(texto);
  const porHost = /^db\.([a-z0-9]{20})\.supabase\.co$/.exec(u.hostname)?.[1];
  const porUsuario = /^[a-z_]+\.([a-z0-9]{20})$/.exec(decodeURIComponent(u.username))?.[1];
  return porHost ?? porUsuario ?? null;
}

/**
 * Decide si se puede sembrar el demo en esa base. Devuelve { destino: 'local' | 'remoto-demo', proyecto }.
 * Reglas: (1) la URL no puede mencionar un proyecto de produccion, jamas; (2) localhost, 127.0.0.1 o ::1 pasan; (3) cualquier otro host exige la bandera
 * --permitir-remoto-demo Y que el nombre del proyecto este en la lista de permitidos del demo (RTM_DEMO_PROYECTOS, separada por comas).
 */
/**
 * @param {string | undefined} urlTexto
 * @param {{ permitirRemotoDemo?: boolean, proyectosDemo?: string[] }} [opciones]
 * @returns {{ destino: string, proyecto: string | null }}
 */
export function evaluarDestino(urlTexto, { permitirRemotoDemo = false, proyectosDemo = [] } = {}) {
  if (!urlTexto || typeof urlTexto !== 'string') throw new ErrorGuarda('Falta DATABASE_URL (o --url): indica la base LOCAL vacia donde sembrar el demo.');
  let u;
  try {
    u = new URL(urlTexto);
  } catch {
    throw new ErrorGuarda('DATABASE_URL no es una URL valida.');
  }
  const crudo = decodeURIComponent(urlTexto).toLowerCase();
  for (const p of PROYECTOS_PRODUCCION) {
    if (crudo.includes(p)) throw new ErrorGuarda('Esa URL apunta al proyecto de PRODUCCION: el demo se niega a correr. Los datos demo nunca se mezclan con el libro real.');
  }
  if (ANFITRIONES_LOCALES.has(u.hostname)) return { destino: 'local', proyecto: null };
  if (!permitirRemotoDemo) throw new ErrorGuarda(`El host ${u.hostname} no es local. El demo solo siembra en localhost, 127.0.0.1 o ::1 (o un proyecto demo declarado con --permitir-remoto-demo).`);
  const proyecto = proyectoDeUrl(urlTexto);
  const lista = proyectosDemo.map((x) => x.trim()).filter(Boolean);
  if (!proyecto) throw new ErrorGuarda('No se pudo determinar el nombre del proyecto remoto desde la URL; el demo remoto exige una URL db.<proyecto>.supabase.co o usuario postgres.<proyecto>.');
  if (!lista.includes(proyecto)) throw new ErrorGuarda(`El proyecto ${proyecto} no esta en la lista de permitidos del demo (RTM_DEMO_PROYECTOS). Crearlo y declararlo requiere autorizacion explicita del dueno.`);
  return { destino: 'remoto-demo', proyecto };
}

const TABLAS_CON_DATOS = [
  ['operacion.pedido', 'pedidos'],
  ['operacion.compra', 'compras'],
  ['operacion.pago', 'pagos'],
  ['contabilidad.asiento', 'asientos contables'],
  ['catalogo.cliente', 'clientes'],
  ['catalogo.modelo', 'modelos'],
  ['seguridad.usuario', 'usuarios'],
  ['seguridad.correo_permitido', 'correos permitidos'],
];

/** Solo lectura: lista lo que ya hay. Vacia = ningun renglon en ninguna de las tablas de arriba. */
/**
 * @param {any} client
 * @returns {Promise<{ tabla: string, nombre: string, n: number }[]>}
 */
export async function contenidoDeBase(client) {
  const hay = [];
  for (const [tabla, nombre] of TABLAS_CON_DATOS) {
    const n = Number((await client.query(`select count(*)::bigint as n from ${tabla}`)).rows[0].n);
    if (n > 0) hay.push({ tabla, nombre, n });
  }
  return hay;
}

/** Falla si la base no esta vacia o ya tiene datos (reales o de otro cargue). */
/** @param {any} client */
export async function exigirBaseVacia(client) {
  const hay = await contenidoDeBase(client);
  if (hay.length) {
    throw new ErrorGuarda(`La base NO esta vacia (${hay.map((h) => `${h.nombre}: ${h.n}`).join(', ')}). El demo solo se siembra en una base recien creada; para empezar de cero en el Supabase local usa npm run demo:reiniciar.`);
  }
}

/** Fecha de hoy en America/Merida (UTC-6 fijo), como en negocio.hoy(). */
export function hoyMerida(ahora = new Date()) {
  return new Date(ahora.getTime() - 6 * 3600_000).toISOString().slice(0, 10);
}

export const esEjecucionDirecta = (importMetaUrl) => process.argv[1] && fileURLToPath(importMetaUrl) === process.argv[1];
