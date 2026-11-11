#!/usr/bin/env node
// Prorrateo mensual de la suscripcion de Claude para RTM (spec 17, 3.3; decision 20).
//
// Corre SOLO en la Mac de Javier. Lee unicamente los campos de conteo de tokens de las transcripciones de Claude Code
// (~/.claude/projects/*/*.jsonl y los subagentes). De cada registro toca exactamente tres rutas:
//   timestamp, message.id, message.usage.{input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens}
// Nunca lee, guarda ni imprime el contenido de los mensajes, ni rutas de archivos de trabajo, ni herramientas.
// Sin red. Salida: claude-uso-AAAA-MM.json con su sha256.
//
// Metricas (la principal es la que se cobra; techo al punto porcentual):
//   entrada_salida_escritura_cache  = input + output + cache_creation        (decision 20)
//   solo_salida                     = output
//   todo_con_lectura_cache          = input + output + cache_creation + cache_read
//
// Uso: node scripts/costos/prorratear-claude.mjs --mes 2026-11 [--raiz ~/.claude/projects] [--salida .] [--proyecto <carpeta> ...]

import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { homedir } from 'node:os';
import { join, relative, sep, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const SCRIPT_VERSION = '1.0.0';
const DESFASE_MERIDA_MS = 6 * 3_600_000; // UTC-6 fijo
/** Carpeta de proyecto de RTM por omision (y sus worktrees). */
export const PROYECTOS_RTM_POR_OMISION = ['-Users-javiercamaraportepetit-rtm'];

/** Techo de a / b con enteros BigInt, b > 0. Misma regla que src/dominio/dinero/techo.ts. */
export function ceilDiv(a, b) {
  if (b <= 0n) throw new RangeError('denominador invalido');
  return a >= 0n ? (a + b - 1n) / b : -(-a / b);
}

/** Mes civil AAAA-MM en America/Merida de un instante ISO UTC, o null si no es una fecha valida. */
export function mesMerida(isoUtc) {
  if (typeof isoUtc !== 'string') return null;
  const ms = Date.parse(isoUtc);
  if (Number.isNaN(ms)) return null;
  const d = new Date(ms - DESFASE_MERIDA_MS);
  return `${String(d.getUTCFullYear()).padStart(4, '0')}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

const entero = (v) => (Number.isSafeInteger(v) && v >= 0 ? BigInt(v) : 0n);

/**
 * Extrae de UN registro de transcripcion solo lo permitido. No toca message.content ni ningun otro campo.
 * Devuelve null si el registro no trae conteo de tokens o instante.
 */
export function leerUsoDeRegistro(reg) {
  if (reg === null || typeof reg !== 'object') return null;
  const timestamp = reg.timestamp;
  const message = reg.message;
  if (message === null || typeof message !== 'object') return null;
  const id = message.id;
  const usage = message.usage;
  if (usage === null || typeof usage !== 'object') return null;
  const mes = mesMerida(timestamp);
  if (mes === null) return null;
  return {
    id: typeof id === 'string' && id.length > 0 ? id : null,
    mes,
    entrada: entero(usage.input_tokens),
    salida: entero(usage.output_tokens),
    escritura: entero(usage.cache_creation_input_tokens),
    lectura: entero(usage.cache_read_input_tokens),
  };
}

/** Una carpeta es de RTM si es igual a un patron o empieza con el patron seguido de "-" (cubre los worktrees). */
export function esProyectoRtm(carpeta, patrones) {
  return patrones.some((p) => carpeta === p || carpeta.startsWith(`${p}-`));
}

function* archivosJsonl(dir) {
  for (const nombre of readdirSync(dir)) {
    const ruta = join(dir, nombre);
    const st = statSync(ruta);
    if (st.isDirectory()) yield* archivosJsonl(ruta);
    else if (st.isFile() && nombre.endsWith('.jsonl')) yield ruta;
  }
}

const max = (a, b) => (a > b ? a : b);

/** Analiza una linea JSONL y devuelve solo el uso permitido; el registro completo no sale de esta funcion. */
export function leerUsoDeLinea(linea) {
  try {
    return leerUsoDeRegistro(JSON.parse(linea));
  } catch {
    return null;
  }
}

/** Lee todas las transcripciones y devuelve el conteo por mensaje (sin duplicados por message.id). */
export async function recolectar({ raiz, mes }) {
  /** @type {Map<string, {carpeta: string, sesion: string, u: ReturnType<typeof cero>}>} */
  const mensajes = new Map();
  let sinId = 0;
  for (const carpeta of readdirSync(raiz)) {
    const dirCarpeta = join(raiz, carpeta);
    if (!statSync(dirCarpeta).isDirectory()) continue;
    for (const archivo of archivosJsonl(dirCarpeta)) {
      const rel = relative(dirCarpeta, archivo).split(sep);
      const sesion = `${carpeta}/${rel[0].replace(/\.jsonl$/, '')}`;
      const lineas = createInterface({ input: createReadStream(archivo, { encoding: 'utf8' }), crlfDelay: Infinity });
      for await (const linea of lineas) {
        if (linea.length === 0 || !linea.includes('"usage"')) continue;
        const uso = leerUsoDeLinea(linea);
        if (uso === null || uso.mes !== mes) continue;
        const clave = uso.id ?? `sin-id:${archivo}:${sinId++}`;
        const previo = mensajes.get(clave);
        if (previo) {
          // El mismo mensaje aparece varias veces mientras se transmite: se cuenta una vez, con el mayor valor de cada campo.
          previo.u.entrada = max(previo.u.entrada, uso.entrada);
          previo.u.salida = max(previo.u.salida, uso.salida);
          previo.u.escritura = max(previo.u.escritura, uso.escritura);
          previo.u.lectura = max(previo.u.lectura, uso.lectura);
        } else {
          mensajes.set(clave, { carpeta, sesion, u: { entrada: uso.entrada, salida: uso.salida, escritura: uso.escritura, lectura: uso.lectura } });
        }
      }
    }
  }
  return mensajes;
}

const METRICAS = {
  entrada_salida_escritura_cache: (u) => u.entrada + u.salida + u.escritura,
  solo_salida: (u) => u.salida,
  todo_con_lectura_cache: (u) => u.entrada + u.salida + u.escritura + u.lectura,
};

const aNumero = (b) => (b <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(b) : b.toString());

/** Agrega por metrica y por proyecto. Pura: recibe los mensajes ya recolectados. */
export function agregar({ mensajes, mes, patrones }) {
  const total = Object.fromEntries(Object.keys(METRICAS).map((k) => [k, { rtm: 0n, cuenta: 0n }]));
  const porCarpeta = new Map();
  const sesionesRtm = new Set();
  const sesionesCuenta = new Set();
  let mensajesRtm = 0;
  for (const { carpeta, sesion, u } of mensajes.values()) {
    const rtm = esProyectoRtm(carpeta, patrones);
    sesionesCuenta.add(sesion);
    if (rtm) {
      sesionesRtm.add(sesion);
      mensajesRtm += 1;
    }
    for (const [nombre, f] of Object.entries(METRICAS)) {
      const t = f(u);
      total[nombre].cuenta += t;
      if (rtm) total[nombre].rtm += t;
    }
    const p = porCarpeta.get(carpeta) ?? { tokens: 0n, sesiones: new Set() };
    p.tokens += METRICAS.entrada_salida_escritura_cache(u);
    p.sesiones.add(sesion);
    porCarpeta.set(carpeta, p);
  }

  /** @type {Record<string, {tokens_rtm: number | string, tokens_cuenta: number | string, pct_exacto_ppm: number | string | null, pct_aplicado_ppm: number | string | null}>} */
  const metricas = {};
  for (const [nombre, t] of Object.entries(total)) {
    metricas[nombre] = {
      tokens_rtm: aNumero(t.rtm),
      tokens_cuenta: aNumero(t.cuenta),
      pct_exacto_ppm: t.cuenta === 0n ? null : aNumero((t.rtm * 1_000_000n) / t.cuenta),
      // Techo al punto porcentual con la fraccion exacta, en partes por millon.
      pct_aplicado_ppm: t.cuenta === 0n ? null : aNumero(ceilDiv(t.rtm * 100n, t.cuenta) * 10_000n),
    };
  }
  return {
    mes,
    script_version: SCRIPT_VERSION,
    zona: 'America/Merida',
    campos_leidos: ['timestamp', 'message.id', 'message.usage'],
    proyectos_rtm: [...patrones],
    metricas,
    rtm: { mensajes: mensajesRtm, sesiones: sesionesRtm.size },
    cuenta: { mensajes: mensajes.size, sesiones: sesionesCuenta.size },
    proyectos: [...porCarpeta.entries()]
      .map(([slug, p]) => ({ slug, tokens: aNumero(p.tokens), sesiones: p.sesiones.size, rtm: esProyectoRtm(slug, patrones) }))
      .sort((a, b) => (a.slug < b.slug ? -1 : 1)),
  };
}

export async function prorratear({ raiz, mes, patrones = PROYECTOS_RTM_POR_OMISION }) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) throw new Error('El mes debe ser AAAA-MM.');
  if (!existsSync(raiz)) throw new Error('No existe la carpeta de transcripciones indicada.');
  const mensajes = await recolectar({ raiz, mes });
  return agregar({ mensajes, mes, patrones });
}

export function parsearArgs(argv) {
  const out = { raiz: join(homedir(), '.claude', 'projects'), salida: process.cwd(), proyectos: [], mes: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const v = () => {
      const x = argv[++i];
      if (x === undefined) throw new Error(`Falta el valor de ${a}.`);
      return x;
    };
    if (a === '--mes') out.mes = v();
    else if (a === '--raiz') out.raiz = resolve(v());
    else if (a === '--salida') out.salida = resolve(v());
    else if (a === '--proyecto') out.proyectos.push(v());
    else throw new Error(`Argumento desconocido: ${a}`);
  }
  if (!out.mes) throw new Error('Falta --mes AAAA-MM.');
  return out;
}

/** Ejecuta el CLI. Devuelve el codigo de salida; la salida va por `io` para poder probarlo sin procesos. */
export async function ejecutar(argv, io = { log: console.log, error: console.error }) {
  try {
    const args = parsearArgs(argv);
    const patrones = args.proyectos.length > 0 ? args.proyectos : PROYECTOS_RTM_POR_OMISION;
    const resultado = await prorratear({ raiz: args.raiz, mes: args.mes, patrones });
    if (resultado.cuenta.mensajes === 0) {
      io.error(`Sin dato: no hay mensajes con conteo de tokens en ${args.mes}. No se escribe archivo (nunca 0 ni la mensualidad completa).`);
      return 2;
    }
    const texto = `${JSON.stringify(resultado, null, 2)}\n`;
    const archivo = join(args.salida, `claude-uso-${args.mes}.json`);
    writeFileSync(archivo, texto, { mode: 0o600 });
    const sha = createHash('sha256').update(texto).digest('hex');
    const p = resultado.metricas.entrada_salida_escritura_cache;
    io.log(`Escrito ${archivo}`);
    io.log(`sha256 ${sha}`);
    io.log(`Participacion de RTM (entrada + salida + escritura de cache): exacta ${p.pct_exacto_ppm} ppm, aplicada ${p.pct_aplicado_ppm} ppm`);
    return 0;
  } catch (e) {
    io.error(e instanceof Error ? e.message : 'Error desconocido.');
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await ejecutar(process.argv.slice(2));
}
