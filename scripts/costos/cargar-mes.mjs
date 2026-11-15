#!/usr/bin/env node
// Carga mensual de los costos del sistema (spec 17; pagina /costos). Reune SOLO datos reales y declara lo que falta; nunca inventa una cifra.
//
//   node scripts/costos/cargar-mes.mjs --mes 2026-11 --verificar            lee la base (solo lectura), calcula y muestra el plan; no escribe
//   node scripts/costos/cargar-mes.mjs --mes 2026-11 --aplicar              escribe (pide escribir APLICAR; --si lo omite)
//   node scripts/costos/cargar-mes.mjs --mes 2026-11 --verificar --datos instantanea.json   sin conexion: usa una instantanea de lectura
//
// Conexion: DATABASE_URL (rol propietario de la base de RTM; del gestor de secretos del dueno, nunca en el repo ni impreso). --verificar abre una
// transaccion READ ONLY; --aplicar escribe con las funciones oficiales costos.registrar_cargo / registrar_tipo_cambio / registrar_dato_faltante
// (la misma ruta que el formulario de la pagina: el cargo cobrable nace como gasto de la sociedad pagado por Javier). Idempotente: un servicio con
// cargo vivo igual en el mes se omite; si difiere, se avisa y solo se reemplaza con --reemplazar (anula con reversa y registra de nuevo).
//
// Fuentes por servicio (ver docs/costos-carga-mensual.md):
//   openrouter / openrouter_comision / transcripcion  libro propio ia.llamada del mes (liquidadas); el rol 'audio' es la transcripcion. Sin libro:
//                                                      dato faltante, salvo --openrouter-usd (consumo declarado de la llave de RTM, queda 'capturado').
//   vercel                  vale 0 por ahora (plan equivalente): sin cargo y SIN dato faltante; con --vercel-consumo/--vercel-factura-usd aplica la misma regla de cuota base.
//   supabase                vale 0 sin consumo real declarado (14-nov). Con --supabase-horas RTM:TOTAL --supabase-factura-usd N se cobra lo MENOR (o lo mayor, segun la
//                           regla vigente de costos.cuota_base) entre la cuota base y el consumo real.
//   claude_max              FIJO en US$20 al mes (decision del dueno: 20 de 200 prorrateados; --claude-usd N lo cambia). No usa el conteo de tokens por carpeta.
//   dominio                 administrado en Vercel; --dominio-anual-usd N (devengo de un doceavo). Sin costo declarado vale 0.
//   higgsfield              --higgsfield-usd N (generaciones etiquetadas RTM). Sin dato: sin cargo.
//   resend, telegram, github  gratuitos (declarado): sin cargo.
// Tipo de cambio: --tc N [--tc-fecha AAAA-MM-DD] (manual), o el ultimo de costos.tipo_cambio, o Banxico FIX con BANXICO_TOKEN. Sin tipo de cambio NO se convierte nada:
// el cargo en dolares se guarda como pendiente (costos.cargo_pendiente_tc) y la pagina dice "Sin tipo de cambio: falta capturarlo".
// Cada cargo cobrable de Javier nace como APORTACION DE CAPITAL declarada (costos.parametro costos_como_capital): sin tocar la caja, con su fecha, servicio, TC y referencia.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const SCRIPT_VERSION = '1.0.0';
const DESFASE_MERIDA_MS = 6 * 3_600_000;
export const DIAS_TC_VIGENTE = 4;
const PPM_CIEN = 1_000_000n;
const TC_UNO = 1_000_000n;
const DEN_CENT = 10n ** 16n;
const DEN_E6 = 10n ** 10n;
const RE_MES = /^\d{4}-(0[1-9]|1[0-2])$/;
const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Aritmetica (misma regla que src/dominio/dinero/techo.ts y src/dominio/costos/cargo.ts; una prueba de paridad las compara).
// ---------------------------------------------------------------------------------------------------------------------------------------------
export function ceilDiv(a, b) {
  if (b <= 0n) throw new RangeError('denominador invalido');
  return a >= 0n ? (a + b - 1n) / b : -(-a / b);
}
const floorDiv = (a, b) => -ceilDiv(-a, b);
export const techoCent = (num, den, paso = 100n) => ceilDiv(ceilDiv(num, den), paso) * paso;

export function montoDesdeNumerador(numerador) {
  return { numerador, exactoMxnE6: floorDiv(numerador, DEN_E6), montoCent: techoCent(numerador, DEN_CENT, 100n) };
}
export function calcularMonto({ baseOrigMicro, pctPpm, tcMicro }) {
  if (tcMicro <= 0n) throw new RangeError('tipo de cambio invalido');
  if (pctPpm < 0n || pctPpm > PPM_CIEN) throw new RangeError('porcentaje invalido');
  return montoDesdeNumerador(baseOrigMicro * pctPpm * tcMicro);
}
/** Participacion: exacta truncada (solo mostrar) y aplicada con techo al punto porcentual entero (la que se cobra). */
export function participacion(consumoRtm, consumoTotal) {
  if (consumoTotal <= 0n) throw new RangeError('sin consumo total del periodo');
  if (consumoRtm < 0n || consumoRtm > consumoTotal) throw new RangeError('el consumo de RTM debe estar entre 0 y el total');
  return { exactoPpm: (consumoRtm * PPM_CIEN) / consumoTotal, aplicadoPpm: ceilDiv(consumoRtm * 100n, consumoTotal) * 10_000n };
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Fechas y textos
// ---------------------------------------------------------------------------------------------------------------------------------------------
const fechaDeMs = (ms) => new Date(ms).toISOString().slice(0, 10);
export const fechaNegocio = (instante) => fechaDeMs(instante.getTime() - DESFASE_MERIDA_MS);
export function sumarDias(f, n) {
  const [a, m, d] = f.split('-').map(Number);
  return fechaDeMs(Date.UTC(a, m - 1, d + n));
}
export function ultimoDiaDelMes(mes) {
  const [a, m] = mes.split('-').map(Number);
  return fechaDeMs(Date.UTC(a, m, 0));
}
export const sha256 = (t) => createHash('sha256').update(t).digest('hex');

/** "20" / "1,234.5" -> millonesimas (20000000n). null si no es valido, es negativo o trae mas de 6 decimales. */
export function microDeTexto(texto) {
  const t = String(texto).trim().replace(/,/g, '').replace(/^\$/, '');
  const m = /^(\d{1,12})(?:\.(\d{1,6}))?$/.exec(t);
  return m ? BigInt(m[1]) * 1_000_000n + BigInt((m[2] ?? '').padEnd(6, '0')) : null;
}
export function textoMicro(micro, min = 2) {
  const neg = micro < 0n;
  const a = neg ? -micro : micro;
  let dec = (a % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '');
  dec = dec.padEnd(min, '0');
  return `${neg ? '-' : ''}${(a / 1_000_000n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${dec}`;
}
/** Centavos -> "$1,234.00". */
export function pesos(cent) {
  const a = cent < 0n ? -cent : cent;
  return `${cent < 0n ? '-' : ''}$${(a / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${(a % 100n).toString().padStart(2, '0')}`;
}
/** Centavos x 1e6 -> pesos con 4 decimales ("exacto"). */
export function pesosDeExactoE6(e6) {
  const neg = e6 < 0n;
  const a = neg ? -e6 : e6;
  const diezmilesimas = a / 10_000n; // 1e8 por peso -> 1e4 por unidad de 1e-4
  return `${neg ? '-' : ''}$${(diezmilesimas / 10_000n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${(diezmilesimas % 10_000n).toString().padStart(4, '0')}`;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Calculo de un cargo (gemelo de calcularCargo de src/dominio/costos/registro.ts, con los casos que usa esta carga)
// ---------------------------------------------------------------------------------------------------------------------------------------------
/**
 * @param {{slug:string, fase:string, mes:string, fecha:string, baseOrigMicro:bigint, moneda:'USD'|'MXN', atribucion:object, etiqueta:string, evidenciaTipo:string, evidenciaSha256:string|null, nota:string, pagadoPor?:string, cobrable:boolean}} c
 * @param {{tcMicro:bigint, fecha:string, fuente:string}|null} tc
 */
export function calcularCargoMes(c, tc) {
  const t = c.moneda === 'MXN' ? { tcMicro: TC_UNO, fecha: c.fecha, fuente: 'manual' } : tc;
  if (!t) throw new RangeError('sin tipo de cambio');
  let base = c.baseOrigMicro;
  let pctExacto = PPM_CIEN;
  let pctAplicado = PPM_CIEN;
  let comoSeria = null;
  let comoDeberia = null;
  const a = c.atribucion;
  if (a.tipo === 'tasa') {
    pctExacto = a.ppm;
    pctAplicado = a.ppm;
  } else if (a.tipo === 'participacion') {
    const p = participacion(a.consumoRtm, a.consumoTotal);
    pctExacto = p.exactoPpm;
    pctAplicado = p.aplicadoPpm;
  } else if (a.tipo === 'cuota_minima') {
    // Sin consumo real conocido: se cobra la cuota del documento ("como seria"); "como deberia ser" queda sin dato.
    comoSeria = calcularMonto({ baseOrigMicro: base, pctPpm: PPM_CIEN, tcMicro: t.tcMicro }).montoCent;
  } else if (a.tipo === 'mayor' || a.tipo === 'menor') {
    const p = participacion(a.consumoRtm, a.consumoTotal);
    const nSeria = a.cuotaOrigMicro * PPM_CIEN * t.tcMicro;
    const nDeberia = c.baseOrigMicro * p.aplicadoPpm * t.tcMicro;
    comoSeria = montoDesdeNumerador(nSeria).montoCent;
    comoDeberia = montoDesdeNumerador(nDeberia).montoCent;
    // 'mayor': cuota base como piso; 'menor': cuota base como tope (lo menor entre la cuota y el consumo real).
    const usaCuota = a.tipo === 'mayor' ? nSeria > nDeberia : nSeria < nDeberia;
    if (usaCuota) base = a.cuotaOrigMicro;
    else {
      pctExacto = p.exactoPpm;
      pctAplicado = p.aplicadoPpm;
    }
  }
  const m = calcularMonto({ baseOrigMicro: base, pctPpm: pctAplicado, tcMicro: t.tcMicro });
  const puro = pctExacto === pctAplicado ? m : calcularMonto({ baseOrigMicro: base, pctPpm: pctExacto, tcMicro: t.tcMicro });
  const tcVencido = c.moneda === 'USD' && sumarDias(t.fecha, DIAS_TC_VIGENTE) < c.fecha;
  const estado = c.evidenciaSha256 && !tcVencido ? 'confirmado' : 'provisional';
  return {
    slug: c.slug, mes: c.mes, fecha: c.fecha, fase: c.fase, baseOrigMicro: base, moneda: c.moneda, pctExactoPpm: pctExacto, pctAplicadoPpm: pctAplicado,
    tcMicro: t.tcMicro, tcFecha: t.fecha, tcFuente: t.fuente, exactoMxnE6: m.exactoMxnE6, exactoPuroMxnE6: puro.exactoMxnE6, montoCent: m.montoCent,
    comoSeriaCent: comoSeria, comoDeberiaCent: comoDeberia, pagadoPor: c.pagadoPor ?? 'javier', cobrable: c.cobrable, etiqueta: c.etiqueta, estado,
    evidenciaTipo: c.evidenciaTipo, evidenciaSha256: c.evidenciaSha256, nota: c.nota,
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Plan del mes (puro): recibe la instantanea de lectura y lo declarado; devuelve una lista de acciones por servicio.
// ---------------------------------------------------------------------------------------------------------------------------------------------
/**
 * @typedef {{slug:string, fase:string, moneda:string, activo:boolean, opcional:boolean, cobrable:boolean, cuotaMicro:bigint|null}} ServicioSnap
 * @typedef {{servicios: Record<string, ServicioSnap>, parametros:{comisionPpm:bigint, incluirComision:boolean, inicioMantenimiento:string},
 *   ledger: {rol:string, n:number, micro:bigint}[], tc: {tcMicro:bigint, fecha:string, fuente:string}|null,
 *   cargosVivos: {id:string, folio:string, slug:string, baseOrigMicro:bigint, pctAplicadoPpm:bigint, tcMicro:bigint, montoCent:bigint}[],
 *   faltantesAbiertos: {slug:string, motivo:string}[]}} Instantanea
 */

/** Dolares atribuidos (micro) de un cargo antes del tipo de cambio: solo para mostrar el pendiente sin TC. */
export function atribuidoUsdMicro(c) {
  const a = c.atribucion;
  const porPpm = (b, ppm) => (b * ppm) / PPM_CIEN;
  if (a.tipo === 'tasa') return porPpm(c.baseOrigMicro, a.ppm);
  if (a.tipo === 'participacion') return porPpm(c.baseOrigMicro, participacion(a.consumoRtm, a.consumoTotal).aplicadoPpm);
  if (a.tipo === 'mayor' || a.tipo === 'menor') {
    const real = porPpm(c.baseOrigMicro, participacion(a.consumoRtm, a.consumoTotal).aplicadoPpm);
    return a.tipo === 'mayor' ? (a.cuotaOrigMicro > real ? a.cuotaOrigMicro : real) : a.cuotaOrigMicro < real ? a.cuotaOrigMicro : real;
  }
  return c.baseOrigMicro;
}

const sinCargo = (slug, motivo) => ({ tipo: 'sin_cargo', slug, motivo });
const faltante = (slug, motivo) => ({ tipo: 'faltante', slug, motivo });

export function planificar({ mes, fecha, snap, declarado, tc }) {
  const acciones = [];
  const S = snap.servicios;
  const usd = (slug) => S[slug]?.moneda !== 'MXN';
  const servicio = (slug) => {
    const s = S[slug];
    if (!s) throw new RangeError(`servicio desconocido en la base: ${slug}`);
    return s;
  };
  const cargo = (slug, extra) => {
    const s = servicio(slug);
    const comun = { slug, fase: s.fase, mes, fecha, moneda: s.moneda, cobrable: s.cobrable };
    if (usd(slug) && !tc) {
      // Sin tipo de cambio NO se convierte ni se inventa uno: el cargo queda en dolares y la pagina dice "Sin tipo de cambio: falta capturarlo".
      acciones.push({ tipo: 'pendiente_tc', slug, mes, fecha, usdMicro: atribuidoUsdMicro(extra), motivo: 'Sin tipo de cambio: falta capturarlo (declara --tc, registralo en la pagina o configura BANXICO_TOKEN)' });
      return false;
    }
    acciones.push({ tipo: 'cargo', slug, cargo: calcularCargoMes({ ...comun, ...extra }, tc) });
    return true;
  };

  // --- IA: libro propio de llamadas del mes
  const porRol = new Map(snap.ledger.map((r) => [r.rol, r]));
  const totalLibro = snap.ledger.reduce((s, r) => s + r.micro, 0n);
  const llamadas = snap.ledger.reduce((s, r) => s + r.n, 0);
  const audio = porRol.get('audio') ?? { n: 0, micro: 0n };
  const resumenLibro = (soloAudio) =>
    JSON.stringify({ mes, fuente: 'ia.llamada', soloAudio, porRol: snap.ledger.map((r) => [r.rol, r.n, r.micro.toString()]).sort() });
  let openrouterBase = null;
  if (declarado.openrouterMicro !== null) {
    openrouterBase = { micro: declarado.openrouterMicro, etiqueta: 'capturado', tipo: 'captura', sha: null, nota: 'Consumo de RTM declarado por el dueno (llave de RTM en OpenRouter); no viene del libro propio.' };
  } else if (llamadas > 0) {
    const micro = totalLibro - audio.micro;
    const h = sha256(resumenLibro(false));
    openrouterBase = { micro, etiqueta: 'medido', tipo: 'libro', sha: h, nota: `Libro propio ia.llamada de ${mes}: ${llamadas - audio.n} llamadas liquidadas, sin el rol audio.` };
  }
  if (!openrouterBase) {
    acciones.push(sinCargo('openrouter', `el libro propio ia.llamada no tiene llamadas liquidadas en ${mes}: sin consumo real medido vale 0 (declara --openrouter-usd con el consumo de la llave de RTM si hubo)`));
  } else if (openrouterBase.micro > 0n) {
    cargo('openrouter', { baseOrigMicro: openrouterBase.micro, atribucion: { tipo: 'directa' }, etiqueta: openrouterBase.etiqueta, evidenciaTipo: openrouterBase.tipo, evidenciaSha256: openrouterBase.sha, nota: openrouterBase.nota });
    if (snap.parametros.incluirComision && snap.parametros.comisionPpm > 0n) {
      cargo('openrouter_comision', {
        baseOrigMicro: openrouterBase.micro, atribucion: { tipo: 'tasa', ppm: snap.parametros.comisionPpm }, etiqueta: openrouterBase.etiqueta === 'medido' ? 'atribuido' : 'capturado',
        evidenciaTipo: openrouterBase.tipo, evidenciaSha256: openrouterBase.sha ? sha256(`comision|${openrouterBase.sha}`) : null,
        nota: `Comision de recarga ${(Number(snap.parametros.comisionPpm) / 10_000).toString()} % sobre el consumo de RTM.`,
      });
    }
  } else {
    acciones.push(sinCargo('openrouter', 'consumo de RTM en cero este mes'));
  }
  if (audio.micro > 0n) {
    cargo('transcripcion', { baseOrigMicro: audio.micro, atribucion: { tipo: 'directa' }, etiqueta: 'medido', evidenciaTipo: 'libro', evidenciaSha256: sha256(resumenLibro(true)), nota: `Libro propio ia.llamada de ${mes}: ${audio.n} llamadas de audio.` });
  } else {
    acciones.push(sinCargo('transcripcion', 'sin llamadas de audio en el libro propio'));
  }

  // --- Plataformas compartidas (Vercel y Supabase): cuota base editable (costos.cuota_base, vigente_desde) y regla 'menor' o 'mayor' entre la cuota y el consumo real.
  // Sin consumo declarado valen 0: sin cargo y sin dato faltante (decision del dueno, 14-nov). El consumo real = factura declarada x participacion (RTM:TOTAL).
  for (const slug of ['vercel', 'supabase']) {
    const s = servicio(slug);
    const d = declarado[slug];
    const q = snap.cuotas?.[slug] ?? (s.cuotaMicro === null ? null : { regla: 'mayor', cuotaMicro: s.cuotaMicro });
    if (!d?.consumo || d.facturaMicro === null) {
      acciones.push(sinCargo(slug, `vale 0: sin consumo real declarado (decision del dueno, 14-nov); con --${slug}-${slug === 'supabase' ? 'horas' : 'consumo'} RTM:TOTAL --${slug}-factura-usd N se cobra lo ${q?.regla ?? 'menor'} entre la cuota base y el consumo real`));
      continue;
    }
    if (!q) {
      acciones.push(faltante(slug, 'el servicio no trae cuota base: fijala con --fijar-cuota'));
      continue;
    }
    cargo(slug, {
      baseOrigMicro: d.facturaMicro, atribucion: { tipo: q.regla, cuotaOrigMicro: q.cuotaMicro, consumoRtm: d.consumo.rtm, consumoTotal: d.consumo.total }, etiqueta: 'atribuido',
      evidenciaTipo: 'captura', evidenciaSha256: null, nota: `Participacion declarada ${d.consumo.rtm}/${d.consumo.total} sobre factura declarada; se cobra lo ${q.regla} entre la cuota base de USD ${textoMicro(q.cuotaMicro)} y el consumo real.`,
    });
  }

  // --- Claude Max (construccion, opcional): monto fijo declarado por el dueno
  cargo('claude_max', {
    baseOrigMicro: declarado.claudeUsdMicro, atribucion: { tipo: 'directa' }, etiqueta: 'capturado', evidenciaTipo: 'captura', evidenciaSha256: null,
    nota: `declarado por el dueno: ${textoMicro(declarado.claudeUsdMicro)} USD de 200 prorrateados (plan de 200 USD al mes; no se usa el conteo de tokens por carpeta)`,
  });

  // --- Dominio (anual, devengo de un doceavo)
  if (declarado.dominioAnualMicro === null) {
    acciones.push(sinCargo('dominio', 'dominio administrado en Vercel, devengo de un doceavo: vale 0 hasta que el dueno declare el costo anual (--dominio-anual-usd)'));
  } else {
    cargo('dominio', {
      baseOrigMicro: ceilDiv(declarado.dominioAnualMicro, 12n), atribucion: { tipo: 'directa' }, etiqueta: 'capturado', evidenciaTipo: 'captura', evidenciaSha256: null,
      nota: `Dominio administrado en Vercel: devengo de un doceavo de US$${textoMicro(declarado.dominioAnualMicro)} anuales declarados por el dueno.`,
    });
  }

  // --- Higgsfield (opcional) y gratuitos
  if (declarado.higgsfieldMicro !== null && declarado.higgsfieldMicro > 0n) {
    cargo('higgsfield', { baseOrigMicro: declarado.higgsfieldMicro, atribucion: { tipo: 'directa' }, etiqueta: 'capturado', evidenciaTipo: 'captura', evidenciaSha256: null, nota: 'Generaciones etiquetadas RTM declaradas por el dueno.' });
  } else {
    acciones.push(sinCargo('higgsfield', 'sin generaciones etiquetadas RTM registradas (no existe libro); declara --higgsfield-usd si hubo'));
  }
  acciones.push(sinCargo('resend', 'plan gratuito declarado: cero'));
  acciones.push(sinCargo('telegram', 'sin cobro declarado'));
  acciones.push(sinCargo('github', 'repositorio privado sin costo declarado'));

  // --- Contraste con lo ya registrado (idempotencia)
  const vivos = new Map(snap.cargosVivos.map((c) => [c.slug, c]));
  return acciones.map((a) => {
    const previo = vivos.get(a.slug);
    if (a.tipo === 'cargo' && previo) {
      const igual = previo.baseOrigMicro === a.cargo.baseOrigMicro && previo.pctAplicadoPpm === a.cargo.pctAplicadoPpm && previo.montoCent === a.cargo.montoCent;
      return { ...a, estadoPrevio: igual ? 'ya_registrado' : 'conflicto', previo };
    }
    if (a.tipo === 'pendiente_tc' && previo) return { tipo: 'sin_cargo', slug: a.slug, motivo: `ya tiene cargo ${previo.folio}; no queda pendiente de tipo de cambio` };
    if (a.tipo === 'faltante' && previo) return { tipo: 'sin_cargo', slug: a.slug, motivo: `ya tiene cargo ${previo.folio}; el faltante (${a.motivo}) no se abre` };
    return a;
  });
}

/** Totales como los muestra la pagina: operar (mantenimiento no opcional), opcionales, construccion; exacto y redondeado por separado. */
export function totales(acciones, servicios) {
  const t = { operar: { cent: 0n, e6: 0n }, opcionales: { cent: 0n, e6: 0n }, construccion: { cent: 0n, e6: 0n } };
  for (const a of acciones) {
    if (a.tipo !== 'cargo' || a.estadoPrevio === 'ya_registrado') continue;
    const s = servicios[a.slug];
    const k = a.cargo.fase === 'construccion' ? 'construccion' : s.opcional ? 'opcionales' : 'operar';
    t[k].cent += a.cargo.montoCent;
    t[k].e6 += a.cargo.exactoMxnE6;
  }
  const faltan = acciones.some((a) => a.tipo === 'faltante');
  return { ...t, sinConstruccion: { cent: t.operar.cent + t.opcionales.cent, e6: t.operar.e6 + t.opcionales.e6 }, conConstruccion: { cent: t.operar.cent + t.opcionales.cent + t.construccion.cent, e6: t.operar.e6 + t.opcionales.e6 + t.construccion.e6 }, alMenos: faltan };
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Argumentos
// ---------------------------------------------------------------------------------------------------------------------------------------------
const OPCIONES_CON_VALOR = ['mes', 'fecha', 'tc', 'tc-fecha', 'datos', 'claude-usd', 'openrouter-usd', 'dominio-anual-usd', 'higgsfield-usd',
  'supabase-horas', 'supabase-factura-usd', 'vercel-consumo', 'vercel-factura-usd', 'fijar-cuota'];
const OPCIONES_BANDERA = ['verificar', 'aplicar', 'si', 'reemplazar', 'ayuda', 'tc-sugerido'];
export const CLAUDE_USD_POR_OMISION = 20_000_000n;

export function parsearArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) throw new Error(`Argumento desconocido: ${a}`);
    const k = a.slice(2);
    if (OPCIONES_BANDERA.includes(k)) o[k] = true;
    else if (OPCIONES_CON_VALOR.includes(k)) {
      const v = argv[++i];
      if (v === undefined) throw new Error(`Falta el valor de ${a}.`);
      o[k] = v;
    } else throw new Error(`Argumento desconocido: ${a}`);
  }
  if (o.ayuda || o['tc-sugerido'] || o['fijar-cuota']) return o;
  if (!o.mes || !RE_MES.test(o.mes)) throw new Error('Falta --mes AAAA-MM.');
  if (o.verificar && o.aplicar) throw new Error('Elige --verificar o --aplicar, no los dos.');
  if (!o.verificar && !o.aplicar) o.verificar = true;
  if (o.fecha && !RE_FECHA.test(o.fecha)) throw new Error('--fecha debe ser AAAA-MM-DD.');
  if (o['tc-fecha'] && !RE_FECHA.test(o['tc-fecha'])) throw new Error('--tc-fecha debe ser AAAA-MM-DD.');
  if (o.aplicar && o.datos) throw new Error('--datos (instantanea) solo sirve con --verificar: --aplicar siempre lee la base.');
  return o;
}

const par = (texto, nombre) => {
  const m = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(String(texto));
  if (!m) throw new Error(`${nombre} debe ser RTM:TOTAL (por ejemplo 3:12).`);
  // Se escalan a enteros con 6 decimales para no usar flotantes.
  const e = (v) => microDeTexto(v);
  const rtm = e(m[1]);
  const total = e(m[2]);
  if (rtm === null || total === null || total <= 0n || rtm > total) throw new Error(`${nombre}: valores invalidos (el total debe ser positivo y RTM no puede exceder el total).`);
  return { rtm, total };
};
const usdOpcional = (v, nombre) => {
  if (v === undefined) return null;
  const m = microDeTexto(v);
  if (m === null) throw new Error(`${nombre} debe ser un monto en dolares (hasta 6 decimales).`);
  return m;
};

export function declaradoDeArgs(o) {
  const plataforma = (consumo, factura, nc, nf) => ({ consumo: consumo ? par(consumo, nc) : null, facturaMicro: usdOpcional(factura, nf) });
  const s = plataforma(o['supabase-horas'], o['supabase-factura-usd'], '--supabase-horas', '--supabase-factura-usd');
  const v = plataforma(o['vercel-consumo'], o['vercel-factura-usd'], '--vercel-consumo', '--vercel-factura-usd');
  for (const [d, n] of [[s, 'supabase'], [v, 'vercel']]) if (Boolean(d.consumo) !== (d.facturaMicro !== null)) throw new Error(`Para ${n} declara el consumo (RTM:TOTAL) Y la factura del mes en dolares, o ninguno.`);
  return {
    openrouterMicro: usdOpcional(o['openrouter-usd'], '--openrouter-usd'), supabase: s, vercel: v, claudeUsdMicro: usdOpcional(o['claude-usd'], '--claude-usd') ?? CLAUDE_USD_POR_OMISION,
    dominioAnualMicro: usdOpcional(o['dominio-anual-usd'], '--dominio-anual-usd'), higgsfieldMicro: usdOpcional(o['higgsfield-usd'], '--higgsfield-usd'),
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Lectura de la base (solo SELECT) y de una instantanea
// ---------------------------------------------------------------------------------------------------------------------------------------------
export const SQL_LECTURA = {
  servicios: 'select slug, fase, moneda, activo, opcional, cobrable, cuota_documento_orig_micro::text as cuota from costos.servicio',
  parametros: "select clave, valor from costos.parametro where clave in ('openrouter_comision_ppm', 'openrouter_incluir_comision', 'fecha_inicio_mantenimiento')",
  ledger: "select rol, count(*)::int as n, coalesce(sum(costo_usd_micro), 0)::text as micro from ia.llamada where estado = 'liquidada' and to_char((ts at time zone 'UTC') - interval '6 hours', 'YYYY-MM') = $1 group by rol",
  tc: 'select costos.tipo_cambio_del_dia($1::date) as tc',
  cuotas: "select s.slug, costos.cuota_base_vigente(s.slug, $1::date) as q from costos.servicio s where s.slug in ('vercel', 'supabase')",
  cargos: 'select c.id::text as id, c.folio, s.slug, c.base_orig_micro::text as base, c.pct_aplicado_ppm::text as pct, c.tc_micro::text as tc, c.monto_cent::text as monto from costos.cargo c join costos.servicio s on s.id = c.servicio_id where c.mes = $1 and c.reversa_de is null and not exists (select 1 from costos.cargo r where r.reversa_de = c.id)',
  faltantes: 'select s.slug, f.motivo from costos.dato_faltante f join costos.servicio s on s.id = f.servicio_id where f.mes = $1 and f.resuelto_at is null',
};

/** Convierte las filas crudas de SQL_LECTURA (o el JSON de --datos) a la instantanea con bigint. */
export function instantaneaDeFilas(f) {
  const p = Object.fromEntries((f.parametros ?? []).map((r) => [r.clave, r.valor]));
  const servicios = {};
  for (const r of f.servicios) servicios[r.slug] = { slug: r.slug, fase: r.fase, moneda: r.moneda, activo: r.activo, opcional: r.opcional, cobrable: r.cobrable, cuotaMicro: r.cuota === null || r.cuota === undefined ? null : BigInt(r.cuota) };
  const tc = f.tc?.tc_micro ? { tcMicro: BigInt(f.tc.tc_micro), fecha: f.tc.fecha, fuente: f.tc.fuente } : null;
  return {
    servicios,
    parametros: { comisionPpm: BigInt(p.openrouter_comision_ppm ?? 0), incluirComision: p.openrouter_incluir_comision === true || p.openrouter_incluir_comision === 'true', inicioMantenimiento: p.fecha_inicio_mantenimiento ?? '2026-11-01' },
    ledger: (f.ledger ?? []).map((r) => ({ rol: r.rol, n: Number(r.n), micro: BigInt(r.micro) })),
    tc,
    cuotas: Object.fromEntries((f.cuotas ?? []).filter((r) => r.q).map((r) => [r.slug, { regla: r.q.regla, cuotaMicro: BigInt(r.q.cuota_orig_micro) }])),
    cargosVivos: (f.cargos ?? []).map((r) => ({ id: String(r.id), folio: r.folio, slug: r.slug, baseOrigMicro: BigInt(r.base), pctAplicadoPpm: BigInt(r.pct), tcMicro: BigInt(r.tc), montoCent: BigInt(r.monto) })),
    faltantesAbiertos: f.faltantes ?? [],
  };
}

export async function leerFilas(client, mes, fecha) {
  const q = async (sql, params = []) => (await client.query(sql, params)).rows;
  return {
    servicios: await q(SQL_LECTURA.servicios),
    parametros: await q(SQL_LECTURA.parametros),
    ledger: await q(SQL_LECTURA.ledger, [mes]),
    tc: (await q(SQL_LECTURA.tc, [fecha]))[0]?.tc ?? null,
    cuotas: await q(SQL_LECTURA.cuotas, [fecha]),
    cargos: await q(SQL_LECTURA.cargos, [mes]),
    faltantes: await q(SQL_LECTURA.faltantes, [mes]),
  };
}

/** Banxico FIX (serie SF43718) con token del entorno; el ultimo publicado en los 10 dias previos. null si no hay token o no hay dato. */
export async function tipoCambioBanxico(fecha, token, fetchFn = fetch) {
  if (!token) return null;
  const url = `https://www.banxico.org.mx/SieAPIRest/service/v1/series/SF43718/datos/${sumarDias(fecha, -10)}/${fecha}`;
  const r = await fetchFn(url, { headers: { 'Bmx-Token': token, Accept: 'application/json' } });
  if (!r.ok) return null;
  const datos = (await r.json())?.bmx?.series?.[0]?.datos;
  if (!Array.isArray(datos)) return null;
  const pub = datos
    .filter((d) => /^\d/.test(d?.dato ?? ''))
    .map((d) => {
      const [dd, mm, aa] = d.fecha.split('/');
      const m = /^(\d+)(?:\.(\d{1,12}))?$/.exec(d.dato.trim());
      const dec = m?.[2] ?? '';
      if (!m || /[1-9]/.test(dec.slice(6))) return null;
      return { fecha: `${aa}-${mm}-${dd}`, tcMicro: BigInt(m[1]) * 1_000_000n + BigInt(dec.slice(0, 6).padEnd(6, '0')) };
    })
    .filter((d) => d && d.fecha <= fecha)
    .sort((a, b) => (a.fecha < b.fecha ? -1 : 1));
  const u = pub.at(-1);
  return u ? { tcMicro: u.tcMicro, fecha: u.fecha, fuente: 'banxico_fix' } : null;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Presentacion
// ---------------------------------------------------------------------------------------------------------------------------------------------
export function resumenTexto({ mes, fecha, snap, acciones, tc, tcOrigen }) {
  const L = [];
  L.push(`Costos del sistema ${mes} (fecha de negocio ${fecha})`);
  L.push(tc ? `Tipo de cambio: ${textoMicro(tc.tcMicro, 4)} del ${tc.fecha} (${tc.fuente}${tcOrigen ? `, ${tcOrigen}` : ''})` : 'Tipo de cambio: SIN DATO (no se inventa uno)');
  if (snap.ledger.length === 0) L.push('Libro ia.llamada: sin llamadas liquidadas en el mes');
  L.push('');
  const w = (t, n) => String(t).padEnd(n);
  for (const a of acciones) {
    if (a.tipo === 'cargo') {
      const c = a.cargo;
      const est = a.estadoPrevio === 'ya_registrado' ? `YA REGISTRADO (${a.previo.folio})` : a.estadoPrevio === 'conflicto' ? `CONFLICTO con ${a.previo.folio} (${pesos(a.previo.montoCent)}); usa --reemplazar` : 'cargo nuevo';
      L.push(`${w(a.slug, 20)} ${est}`);
      L.push(`${w('', 20)} ${c.moneda} ${textoMicro(c.baseOrigMicro, 2)} x ${(Number(c.pctAplicadoPpm) / 10_000).toFixed(2)} % x TC ${textoMicro(c.tcMicro, 4)} = exacto ${pesosDeExactoE6(c.exactoMxnE6)} -> ${pesos(c.montoCent)} (techo al peso)`);
      L.push(`${w('', 20)} ${c.etiqueta} / ${c.estado} / evidencia ${c.evidenciaTipo}${c.evidenciaSha256 ? ' (sha)' : ' (sin sha)'}${c.comoSeriaCent !== null ? ` / como seria ${pesos(c.comoSeriaCent)}` : ''}${c.comoDeberiaCent !== null ? ` / como deberia ser ${pesos(c.comoDeberiaCent)}` : ''}`);
    } else if (a.tipo === 'pendiente_tc') {
      L.push(`${w(a.slug, 20)} USD ${textoMicro(a.usdMicro, 2)} - ${a.motivo}`);
    } else if (a.tipo === 'faltante') {
      L.push(`${w(a.slug, 20)} DATO FALTANTE: ${a.motivo}`);
    } else {
      L.push(`${w(a.slug, 20)} sin cargo: ${a.motivo}`);
    }
  }
  const t = totales(acciones, snap.servicios);
  L.push('');
  L.push(`Costo mensual de operar${t.alMenos ? ' (al menos)' : ''}: exacto ${pesosDeExactoE6(t.operar.e6)} -> redondeado ${pesos(t.operar.cent)}`);
  L.push(`Opcionales (Claude y Higgsfield): exacto ${pesosDeExactoE6(t.opcionales.e6)} -> redondeado ${pesos(t.opcionales.cent)}   Construccion (aparte): ${pesos(t.construccion.cent)}`);
  L.push(`Gasto total sin construccion${t.alMenos ? ' (al menos)' : ''}: exacto ${pesosDeExactoE6(t.sinConstruccion.e6)} -> redondeado ${pesos(t.sinConstruccion.cent)}`);
  L.push(`Gasto total con construccion${t.alMenos ? ' (al menos)' : ''}: exacto ${pesosDeExactoE6(t.conConstruccion.e6)} -> redondeado ${pesos(t.conConstruccion.cent)}`);
  const nuevos = acciones.filter((a) => a.tipo === 'cargo' && !a.estadoPrevio).length;
  const faltantes = acciones.filter((a) => a.tipo === 'faltante').length;
  const aportacion = acciones.filter((a) => a.tipo === 'cargo' && a.estadoPrevio !== 'ya_registrado').reduce((x, a) => x + a.cargo.montoCent, 0n);
  L.push(`Aportacion de capital de Javier que se generara por estos cargos (sin tocar la caja): ${pesos(aportacion)}`);
  const sinTc = acciones.filter((a) => a.tipo === 'pendiente_tc').length;
  L.push(`Cargos nuevos: ${nuevos} | datos faltantes por abrir: ${faltantes} | en dolares sin tipo de cambio: ${sinTc}`);
  return L.join('\n');
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Escritura (solo con --aplicar): funciones oficiales de la base
// ---------------------------------------------------------------------------------------------------------------------------------------------
const SQL_REGISTRAR = `select costos.registrar_cargo($1, $2, $3, $4::date, $5, $6::bigint, $7, $8::int, $9::int, $10::bigint, $11::date, $12, $13::bigint, $14::bigint, $15::bigint, $16::bigint, $17::bigint, $18, $19::boolean, $20, $21, $22, $23, $24) as r`;

export function clavesDeCargo(mes, c) {
  return `cargar-mes:${mes}:${c.slug}:${sha256([c.baseOrigMicro, c.pctAplicadoPpm, c.tcMicro, c.montoCent, c.etiqueta].join('|')).slice(0, 12)}`;
}

export function argsRegistrar(mes, c) {
  const t = (v) => (v === null ? null : v.toString());
  return [clavesDeCargo(mes, c), c.slug, c.mes, c.fecha, c.fase, t(c.baseOrigMicro), c.moneda, c.pctExactoPpm.toString(), c.pctAplicadoPpm.toString(), t(c.tcMicro), c.tcFecha, c.tcFuente,
    t(c.exactoMxnE6), t(c.exactoPuroMxnE6), t(c.montoCent), t(c.comoSeriaCent), t(c.comoDeberiaCent), c.pagadoPor, c.cobrable, c.etiqueta, c.estado, c.evidenciaTipo, c.evidenciaSha256, c.nota];
}

export async function aplicarPlan(client, { mes, fecha, acciones, tc, tcOrigen, reemplazar }, log) {
  const socio = (await client.query("select id from seguridad.usuario where rol = 'socio' and activo and socio_nombre = 'Javier'")).rows[0]?.id;
  if (!socio) throw new Error('No hay un usuario socio activo para Javier.');
  await client.query('begin');
  try {
    await client.query("select set_config('request.jwt.claim.sub', $1, true)", [socio]);
    if (tc && tcOrigen !== 'base') {
      await client.query('select costos.registrar_tipo_cambio($1, $2::date, $3::bigint, $4)', [`cargar-mes:tc:${tc.fecha}:${tc.fuente}`, tc.fecha, tc.tcMicro.toString(), tc.fuente]);
      log(`Tipo de cambio ${textoMicro(tc.tcMicro, 4)} (${tc.fuente}) del ${tc.fecha} registrado.`);
    }
    let n = 0;
    for (const a of acciones) {
      if (a.tipo === 'cargo') {
        if (a.estadoPrevio === 'ya_registrado') continue;
        if (a.estadoPrevio === 'conflicto') {
          if (!reemplazar) {
            log(`${a.slug}: conflicto con ${a.previo.folio}; no se escribe (usa --reemplazar).`);
            continue;
          }
          await client.query('select costos.anular_cargo($1, $2::bigint, $3::date, $4)', [`cargar-mes:anula:${a.previo.folio}:${mes}`, a.previo.id, fecha, `Reemplazado por nueva carga mensual ${mes} (cifra corregida).`]);
        }
        const r = (await client.query(SQL_REGISTRAR, argsRegistrar(mes, a.cargo))).rows[0].r;
        await client.query('select costos.resolver_dato_faltante($1, $2)', [a.slug, mes]);
        await client.query('select costos.resolver_pendiente_tc($1, $2)', [a.slug, mes]);
        log(`${a.slug}: ${r.folio} ${pesos(a.cargo.montoCent)}${r.repetido ? ' (ya existia la clave)' : ''}`);
        n += 1;
      } else if (a.tipo === 'pendiente_tc') {
        await client.query('select costos.registrar_pendiente_tc($1, $2, $3::date, $4::bigint, $5)', [a.slug, mes, a.fecha, a.usdMicro.toString(), a.motivo]);
        log(`${a.slug}: USD ${textoMicro(a.usdMicro)} guardado sin convertir (falta el tipo de cambio).`);
      } else if (a.tipo === 'faltante') {
        await client.query('select costos.registrar_dato_faltante($1, $2, $3)', [a.slug, mes, a.motivo]);
        log(`${a.slug}: dato faltante abierto.`);
      }
    }
    await client.query('set constraints all immediate');
    await client.query('commit');
    return n;
  } catch (e) {
    await client.query('rollback').catch(() => {});
    throw e;
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------------------------------------------------------------------------
const AYUDA = `Uso: node scripts/costos/cargar-mes.mjs --mes AAAA-MM [--verificar | --aplicar] [opciones]
  --fecha AAAA-MM-DD            fecha del cargo (por omision hoy en Merida, o el ultimo dia si el mes ya paso)
  --tc N [--tc-fecha F]         tipo de cambio manual (MXN por USD); sin el se usa la base o Banxico (BANXICO_TOKEN)
  --datos archivo.json          (solo --verificar) instantanea de lectura en vez de conectar a la base
  --claude-usd N                monto fijo de Claude Max (por omision 20: declarado por el dueno)
  --tc-sugerido                 solo imprime como declarar el tipo de cambio
  --openrouter-usd N            consumo de la llave de RTM en OpenRouter (si el libro ia.llamada esta vacio)
  --dominio-anual-usd N         costo anual del dominio;  --higgsfield-usd N  generaciones etiquetadas RTM
  --supabase-horas RTM:TOTAL --supabase-factura-usd N    horas de computo y factura real de Supabase (consumo real; sin ellos vale 0)
  --vercel-consumo RTM:TOTAL --vercel-factura-usd N       consumo y factura real de Vercel (sin ellos vale 0)
  --fijar-cuota SLUG:REGLA:USD:AAAA-MM-DD   cuota base de vercel o supabase con vigente_desde; REGLA = menor | mayor entre la cuota y el consumo real
  --reemplazar                  anula (con reversa) y vuelve a registrar un cargo vivo con cifra distinta
  --si                          no pedir la confirmacion escrita en --aplicar`;

function confirmar(texto) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((r) => rl.question(texto, (x) => { rl.close(); r(x.trim()); }));
}

/** --fijar-cuota SLUG:REGLA:USD:AAAA-MM-DD  fila nueva de costos.cuota_base (regla menor|mayor entre la cuota base y el consumo real); nunca edita una anterior. */
export function parsearCuota(texto) {
  const m = /^([a-z][a-z0-9_]*):(menor|mayor):([0-9.,]+):(\d{4}-\d{2}-\d{2})$/.exec(String(texto));
  const micro = m ? microDeTexto(m[3]) : null;
  if (!m || micro === null) throw new Error('--fijar-cuota debe ser SLUG:REGLA:USD:AAAA-MM-DD (por ejemplo vercel:menor:20:2026-12-01).');
  return { slug: m[1], regla: m[2], cuotaMicro: micro, desde: m[4] };
}

async function fijarCuota(o, io, deps) {
  const c = parsearCuota(o['fijar-cuota']);
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('Falta DATABASE_URL (rol propietario de la base de RTM).');
  if (!o.si) {
    const r = await (deps.confirmar ?? confirmar)(`Se va a ESCRIBIR una cuota base: ${c.slug}, lo ${c.regla} entre USD ${textoMicro(c.cuotaMicro)} y el consumo real, desde ${c.desde}. Escribe APLICAR: `);
    if (r !== 'APLICAR') {
      io.log('Cancelado: no se escribio nada.');
      return 1;
    }
  }
  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const socio = (await client.query("select id from seguridad.usuario where rol = 'socio' and activo and socio_nombre = 'Javier'")).rows[0]?.id;
    if (!socio) throw new Error('No hay un usuario socio activo para Javier.');
    await client.query('begin');
    await client.query("select set_config('request.jwt.claim.sub', $1, true)", [socio]);
    await client.query('select costos.fijar_cuota_base($1, $2, $3::bigint, $4::date, $5)', [c.slug, c.regla, c.cuotaMicro.toString(), c.desde, 'Fijada con cargar-mes.mjs --fijar-cuota']);
    await client.query('commit');
    io.log(`Cuota base de ${c.slug}: lo ${c.regla} entre USD ${textoMicro(c.cuotaMicro)} y el consumo real, desde ${c.desde}.`);
    return 0;
  } catch (e) {
    await client.query('rollback').catch(() => {});
    throw e;
  } finally {
    await client.end().catch(() => {});
  }
}

export async function ejecutar(argv, io = { log: console.log, error: console.error }, deps = {}) {
  try {
    const o = parsearArgs(argv);
    if (o.ayuda) {
      io.log(AYUDA);
      return 0;
    }
    if (o['fijar-cuota']) return await fijarCuota(o, io, deps);
    if (o['tc-sugerido']) {
      io.log('Tipo de cambio: este script no inventa ni consulta uno sin credenciales. Declaralo con --tc N --tc-fecha AAAA-MM-DD (MXN por USD, FIX de Banxico del dia o el del recibo),\no define BANXICO_TOKEN para leer el FIX. Sin tipo de cambio nada en dolares se cobra: queda como dato faltante.');
      return 0;
    }
    const hoy = fechaNegocio(deps.ahora ?? new Date());
    if (o.mes > hoy.slice(0, 7)) throw new Error(`El mes ${o.mes} aun no empieza (hoy es ${hoy}).`);
    const fecha = o.fecha ?? (o.mes < hoy.slice(0, 7) ? ultimoDiaDelMes(o.mes) : hoy);
    if (fecha.slice(0, 7) !== o.mes) throw new Error('--fecha debe caer dentro de --mes.');
    const declarado = declaradoDeArgs(o);

    let client = null;
    let filas;
    if (o.datos) {
      filas = JSON.parse((deps.leerArchivo ?? ((r) => readFileSync(r, 'utf8')))(resolve(o.datos)));
    } else {
      const url = process.env.DATABASE_URL;
      if (!url) throw new Error('Falta DATABASE_URL (rol propietario de la base de RTM) o usa --datos con una instantanea.');
      const { default: pg } = await import('pg');
      client = new pg.Client({ connectionString: url });
      await client.connect();
      if (o.verificar) await client.query('begin read only');
    }
    try {
      if (client) filas = await leerFilas(client, o.mes, fecha);
      const snap = instantaneaDeFilas(filas);
      if (snap.parametros.inicioMantenimiento > `${o.mes}-31`) throw new Error(`El mantenimiento arranca el ${snap.parametros.inicioMantenimiento}; ${o.mes} es anterior.`);
      let tc = snap.tc;
      let tcOrigen = tc ? 'base' : null;
      if (o.tc) {
        const m = microDeTexto(o.tc);
        if (m === null || m <= 0n) throw new Error('--tc invalido.');
        tc = { tcMicro: m, fecha: o['tc-fecha'] ?? fecha, fuente: 'manual' };
        tcOrigen = 'declarado';
      } else if (!tc) {
        tc = await tipoCambioBanxico(fecha, process.env.BANXICO_TOKEN, deps.fetchFn ?? fetch).catch(() => null);
        if (tc) tcOrigen = 'Banxico';
      }
      const acciones = planificar({ mes: o.mes, fecha, snap, declarado, tc });
      io.log(resumenTexto({ mes: o.mes, fecha, snap, acciones, tc, tcOrigen, declarado }));
      if (o.verificar) {
        io.log('\nModo --verificar: no se escribio nada.');
        return 0;
      }
      const porEscribir = acciones.filter((a) => (a.tipo === 'cargo' && a.estadoPrevio !== 'ya_registrado') || a.tipo === 'faltante' || a.tipo === 'pendiente_tc').length;
      if (porEscribir === 0) {
        io.log('\nNada que escribir: todo esta registrado.');
        return 0;
      }
      if (!o.si) {
        const r = await (deps.confirmar ?? confirmar)(`\nSe va a ESCRIBIR en la base (cargos cobrables = gasto de la sociedad pagado por Javier). Escribe APLICAR para continuar: `);
        if (r !== 'APLICAR') {
          io.log('Cancelado: no se escribio nada.');
          return 1;
        }
      }
      const n = await aplicarPlan(client, { mes: o.mes, fecha, acciones, tc, tcOrigen, reemplazar: Boolean(o.reemplazar) }, io.log);
      io.log(`\nListo: ${n} cargos escritos. Revisa la pagina /costos?mes=${o.mes}.`);
      return 0;
    } finally {
      if (client) {
        if (o.verificar) await client.query('rollback').catch(() => {});
        await client.end().catch(() => {});
      }
    }
  } catch (e) {
    io.error(e instanceof Error ? e.message : 'Error desconocido.');
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await ejecutar(process.argv.slice(2));
}
