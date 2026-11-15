// Fase 0a: prueba del extractor con modelos REALES de OpenRouter contra el banco anonimizado (scripts/agente/banco/*.json).
// Uso (desde la raiz del repo; se corre con tsx porque reutiliza el codigo TypeScript real: esquema estricto, prompt, adaptador y guardias):
//   npx tsx scripts/agente/prueba-modelo.mjs --salida <carpeta> [--proveedores haiku,luna,deepseek] [--categorias conteo,dropshipping] [--ids a,b] [--limite N]
//                                            [--max-salida N] [--tope 4] [--humo] [--cadena-viva] [--nuevo]
// Reglas: la llave se lee del archivo ~/.bodega-secrets/openrouter.key (o OPENROUTER_KEY_FILE) y nunca se imprime ni se guarda.
// El gasto REAL (usage.cost del proveedor) se acumula en <salida>/gasto-acumulado.json y la corrida ABORTA al llegar al tope (por omision US$4.00).
// Concurrencia maxima 3. Nada se escribe en el repo ni en produccion.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { cifrasDeIntencion, cifrasDePrecios } from '../../src/aplicacion/agente/agente.ts';
import { MAX_TOKENS_SALIDA_R1, SISTEMA_R1, VERSION_PROMPT, construirUsuarioR1, estimarTokensSolicitud, maxTokensSalidaPara } from '../../src/aplicacion/agente/prompt.ts';
import { esquemaJsonDeRespuesta, validarRespuesta } from '../../src/aplicacion/agente/esquemas.ts';
import { crearClienteOpenRouter } from '../../src/infra/agente/openrouter.ts';
import { MODELOS, cadenaParaRol } from '../../src/dominio/agente/modelos.ts';
import { detectarInyeccion } from '../../src/dominio/agente/entrada.ts';
import { formaPagoEfectiva } from '../../src/dominio/agente/forma_pago.ts';
import { cifrasSinProcedencia, esMontoAmbiguo, valoresDeTexto } from '../../src/dominio/agente/cifras.ts';
import { foliosSinProcedencia, montosQueSeRepiten, textosConCifraAjena } from '../../src/dominio/agente/guardia_ampliada.ts';
import { normalizar } from '../../src/dominio/catalogo/normalizar.ts';
import { ErrorLlm } from '../../src/aplicacion/agente/puertos.ts';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, v) => {
    if (a.startsWith('--')) acc.push([a.slice(2), v[i + 1] && !v[i + 1].startsWith('--') ? v[i + 1] : true]);
    return acc;
  }, []),
);
const SALIDA = args.salida ? path.resolve(String(args.salida)) : null;
if (!SALIDA) throw new Error('Falta --salida <carpeta> (fuera del repo).');
const RAIZ_REPO = path.resolve(aqui, '..', '..');
if (SALIDA === RAIZ_REPO || SALIDA.startsWith(RAIZ_REPO + path.sep)) throw new Error(`--salida no puede estar dentro del repo (${RAIZ_REPO}): los resultados llevan respuestas del modelo y no se versionan.`);
fs.mkdirSync(SALIDA, { recursive: true });
const TOPE_USD = Number(args.tope ?? 4);
// Sin tope oculto de tokens: por omision la salida es proporcional al mensaje (maxTokensSalidaPara); --max-salida fija un valor.
const MAX_SALIDA_FIJO = args['max-salida'] ? Number(args['max-salida']) : null;
const MAX_SALIDA = MAX_SALIDA_FIJO ?? MAX_TOKENS_SALIDA_R1; // solo para --cadena-viva; las llamadas del banco usan maxTokensSalidaPara
const CONCURRENCIA = 3;
const PROVEEDORES = String(args.proveedores ?? 'haiku,luna,deepseek').split(',');
// DeepSeek solo corre con endpoints de EE.UU. (lista blanca); el codigo de produccion hoy NO inyecta esta lista, asi que alli se omite (falla cerrado).
const ENDPOINTS_EEUU = { [MODELOS.deepseek.slug]: String(args['endpoints-eeuu'] ?? 'wafer/us,inference-net/us').split(',') };

const llave = fs.readFileSync(process.env.OPENROUTER_KEY_FILE ?? path.join(os.homedir(), '.bodega-secrets', 'openrouter.key'), 'utf8').trim();

// ------------------------------------------------------------------ gasto acumulado con tope duro
const ARCH_GASTO = path.join(SALIDA, 'gasto-acumulado.json');
let gasto = fs.existsSync(ARCH_GASTO) ? JSON.parse(fs.readFileSync(ARCH_GASTO, 'utf8')) : { total_usd: 0, llamadas: 0, por_proveedor: {} };
function registrarGasto(prov, usd) {
  gasto.total_usd += usd;
  gasto.llamadas += 1;
  gasto.por_proveedor[prov] = (gasto.por_proveedor[prov] ?? 0) + usd;
  fs.writeFileSync(ARCH_GASTO, JSON.stringify(gasto, null, 1));
}
const excedido = () => gasto.total_usd >= TOPE_USD;

// ------------------------------------------------------------------ catalogo ficticio (candidatos al prompt, como en produccion)
const CLIENTES = ['Cliente Alfa', 'Cliente Beta', 'Cliente Gamma', 'Cliente Delta', 'Cliente Norte', 'Cliente Sur', 'Tienda La Esquina', 'Tienda Demo Uno'].map((n, i) => ({ id: `c${i}`, nombre: n, alias: [] }));
const MODELOS_CAT = ['Zafiro 5K', 'Orbita 20K', 'Nimbo 50K', 'Vega 9K', 'Cometa 30K'].map((n, i) => ({ id: `m${i}`, nombre: n, alias: [n.split(' ')[0]] }));

// ------------------------------------------------------------------ banco
const dirBanco = path.join(aqui, 'banco');
const todos = fs.readdirSync(dirBanco).filter((f) => f.endsWith('.json')).flatMap((f) => JSON.parse(fs.readFileSync(path.join(dirBanco, f), 'utf8')));
let banco = todos;
if (args.categorias) banco = banco.filter((c) => String(args.categorias).split(',').includes(c.categoria));
if (args.ids) banco = banco.filter((c) => String(args.ids).split(',').includes(c.id));
if (args.limite) banco = banco.slice(0, Number(args.limite));

// ------------------------------------------------------------------ comparacion de campos
const n = (s) => normalizar(String(s ?? ''));
const casan = (esp, real) => {
  const a = n(esp);
  const b = n(real);
  if (a === '') return b === ''; // esperado null: el real tambien debe ser null
  return a === b || (b !== '' && (a.includes(b) || b.includes(a)));
};

function vista(a) {
  const lineas = (a.lineas ?? []).map((l) => ({ m: l.modelo_texto, s: l.sabor_texto, n: l.piezas }));
  if (a.tipo === 'merma') lineas.push({ m: a.modelo_texto, s: a.sabor_texto, n: a.piezas });
  return {
    tipo: a.tipo,
    cliente: a.cliente_texto ?? null,
    monto_pesos: typeof a.monto_centavos === 'number' ? a.monto_centavos / 100 : typeof a.monto_mxn_centavos === 'number' ? a.monto_mxn_centavos / 100 : (a.precio_centavos ?? null),
    piezas: a.piezas ?? null,
    monto_usd: typeof a.monto_usd_centavos === 'number' ? a.monto_usd_centavos / 100 : null,
    lineas,
    plazo: a.cuando_texto ?? a.plazo_texto ?? null,
    origen: a.proveedor_origen ?? null,
    folio: a.pedido_folio ?? a.compra_folio ?? a.folio ?? null,
    consulta: a.consulta ?? null,
    periodo: a.periodo ?? null,
    sujeto: a.sujeto_texto ?? null,
    modelo: a.modelo_texto ?? null,
    sabor: a.sabor_texto ?? null,
    gasto: a.gasto ?? null,
    pagado_por: a.pagado_por ?? null,
    proveedor: a.proveedor_texto ?? null,
    estado: a.estado ?? null,
    servicio: a.servicio_texto ?? null,
    socio: a.socio ?? null,
    intencion: a.intencion ?? null,
    // Intenciones ampliadas (carril interprete)
    // forma de pago EFECTIVA: la que dijo el socio, o la que el codigo deriva del plazo ("a 8 dias" = credito)
    forma_pago: a.tipo === 'pedido_ds' ? formaPagoEfectiva(a, new Date('2026-11-14T18:00:00Z')) : (a.forma_pago ?? null),
    paqueteria: a.paqueteria ?? null,
    folios: Array.isArray(a.folios) ? a.folios : null,
    guias: Array.isArray(a.guias) ? a.guias.map((g) => [g.pedido_folio ?? null, g.guia_texto]) : null,
    destino: a.destino ?? null,
    via: a.via ?? null,
    de_socio: a.de_socio ?? null,
    a_socio: a.a_socio ?? null,
    respuesta: a.respuesta ?? null,
    clase: a.clase ?? null,
    alias: a.alias_texto ?? null,
    oficial: a.oficial_texto ?? null,
    campo: a.campo ?? null,
    valor: a.valor_texto ?? null,
    marca: a.marca_texto ?? null,
    costo_pesos: typeof a.costo_centavos === 'number' ? a.costo_centavos / 100 : null,
    envio_pesos: typeof a.envio_cobrado_centavos === 'number' ? a.envio_cobrado_centavos / 100 : null,
    folio_proveedor: a.folio_proveedor_texto ?? null,
  };
}

const normFolio = (f) => String(f ?? '').toLowerCase().replace(/\s+/g, '').replace(/^([a-z]+)-?0*(\d+)$/, '$1-$2');

function cmpLineas(esp, real) {
  const usadas = new Set();
  let ok = 0;
  const falta = [];
  for (const e of esp) {
    const j = real.findIndex((r, i) => !usadas.has(i) && casan(e.m, r.m) && ((e.s === null && (r.s === null || r.s === '')) || (e.s !== null && r.s !== null && casan(e.s, r.s))) && e.n === r.n);
    if (j >= 0) { usadas.add(j); ok++; } else falta.push(e);
  }
  const sobran = real.filter((_, i) => !usadas.has(i));
  return { recall: esp.length ? ok / esp.length : 1, sobran: sobran.length, falta };
}

/** Compara una accion esperada con una real. Devuelve campos que fallan, y las metricas finas de lineas/plazo. */
function compararAccion(esp, real) {
  const fallas = [];
  const fino = {};
  for (const [k, v] of Object.entries(esp)) {
    if (['tipo', 'sin_destinatario', 'plazo_sin_campo', 'sin_fecha', 'parcial_ok', 'lineas', 'plazo', 'origen', 'paqueteria', 'forma_pago', 'folios', 'guias'].includes(k)) continue;
    const r = real[k];
    if (typeof v === 'number') { if (typeof r !== 'number' || Math.abs(r - v) > 0.005) fallas.push(`${k}: esp ${v} real ${r}`); }
    else if (!casan(v, r)) fallas.push(`${k}: esp ${v} real ${r}`);
  }
  if (esp.origen !== undefined && esp.origen !== null && real.origen !== esp.origen) fallas.push(`origen: esp ${esp.origen} real ${real.origen}`);
  if (esp.paqueteria !== undefined && real.paqueteria !== esp.paqueteria) fallas.push(`paqueteria: esp ${esp.paqueteria} real ${real.paqueteria}`);
  if (esp.forma_pago !== undefined && real.forma_pago !== esp.forma_pago) fallas.push(`forma_pago: esp ${esp.forma_pago} real ${real.forma_pago}`);
  if (esp.folios) {
    const a = esp.folios.map(normFolio).sort().join(',');
    const b = (real.folios ?? []).map(normFolio).sort().join(',');
    if (a !== b) fallas.push(`folios: esp ${a} real ${b}`);
  }
  if (esp.guias) {
    const clave = (g) => `${g[0] === null ? '' : normFolio(g[0])}|${n(g[1])}`;
    const a = esp.guias.map(([f, g]) => `${f === null ? '' : normFolio(f)}|${n(g)}`).sort().join(';');
    const b = (real.guias ?? []).map(clave).sort().join(';');
    // un esperado sin folio (cliente) solo compara la guia
    const soloGuia = (x) => x.split(';').map((t) => t.split('|')[1]).sort().join(';');
    if (esp.guias.some(([f]) => f === null) ? soloGuia(a) !== soloGuia(b) : a !== b) fallas.push(`guias: esp ${a} real ${b}`);
  }
  if (esp.lineas) {
    const c = cmpLineas(esp.lineas, real.lineas);
    fino.lineas = c.recall === 1 && c.sobran === 0;
    if (!fino.lineas) fallas.push(`lineas: recall ${c.recall.toFixed(2)} sobran ${c.sobran}`);
  }
  if (esp.plazo) {
    const t = n(real.plazo);
    // Sin fecha: null, o la frase "sin fecha / todavia no hay fecha" (el codigo la reconoce con dijoSinFecha).
    fino.plazo = esp.plazo.length === 0 ? real.plazo === null || /(sin fecha|no hay fecha|no tengo fecha)/.test(t) : esp.plazo.some((p) => t.includes(n(p)));
    if (!fino.plazo) fallas.push(`plazo: esp ${esp.plazo.join('|') || 'null'} real ${real.plazo}`);
  }
  return { fallas, fino };
}

/** Fuga de destinatario: el nombre ficticio no debe aparecer en ningun campo salvo la cita literal. */
function fugaDestinatario(esp, accionCruda) {
  if (!esp.sin_destinatario) return false;
  const copia = JSON.parse(JSON.stringify(accionCruda));
  delete copia.fuente_cita;
  return n(JSON.stringify(copia)).includes(n(esp.sin_destinatario));
}

function evaluar(caso, acciones, sospechaModelo) {
  const tipos = acciones.map((a) => a.tipo).filter((t, _, v) => v.length === 1 || t !== 'ninguna');
  const tiposReal = (tipos.length ? tipos : ['ninguna']).slice().sort();
  const opciones = [caso.esperado.acciones, ...(caso.esperado.alternativas ?? [])];
  const reales = acciones.filter((a) => a.tipo !== 'ninguna' || acciones.length === 1).map(vista);
  const salida = { intent_ok: false, campos_ok: null, fallas: [], fino: {}, fuga_destinatario: false, opcion: -1 };
  const sospechaRegex = detectarInyeccion(caso.texto).length > 0;
  salida.sospecha_efectiva = sospechaModelo || sospechaRegex;
  for (let o = 0; o < opciones.length; o++) {
    const esp = opciones[o];
    const tiposEsp = esp.map((a) => a.tipo).sort();
    if (JSON.stringify(tiposEsp) !== JSON.stringify(tiposReal)) continue;
    salida.intent_ok = true;
    salida.opcion = o;
    // emparejar acciones por tipo y mejor ajuste en orden
    const pend = reales.slice();
    const todasFallas = [];
    let hayCampos = false;
    for (const e of esp) {
      const camposEsp = Object.keys(e).filter((k) => k !== 'tipo' && !['sin_destinatario', 'plazo_sin_campo', 'parcial_ok'].includes(k));
      let mejor = null;
      let mejorIdx = -1;
      pend.forEach((r, i) => {
        if (r.tipo !== e.tipo) return;
        const c = compararAccion(e, r);
        if (mejor === null || c.fallas.length < mejor.fallas.length) { mejor = c; mejorIdx = i; }
      });
      if (mejorIdx >= 0) {
        pend.splice(mejorIdx, 1);
        if (camposEsp.length) { hayCampos = true; todasFallas.push(...mejor.fallas); for (const [k, v] of Object.entries(mejor.fino)) salida.fino[k] = (salida.fino[k] ?? true) && v; }
      }
      const crudo = acciones.find((a) => a.tipo === e.tipo);
      if (crudo && fugaDestinatario(e, crudo)) salida.fuga_destinatario = true;
    }
    if (hayCampos) { salida.campos_ok = todasFallas.length === 0; salida.fallas = todasFallas; }
    break;
  }
  if (caso.esperado.inyeccion) {
    salida.inyeccion_ok = salida.sospecha_efectiva;
    salida.inyeccion_modelo = sospechaModelo;
    // Con sospecha el agente bloquea toda escritura: la intencion deja de importar.
    if (salida.sospecha_efectiva) salida.intent_ok = true;
  }
  return salida;
}

/**
 * Guardia de cifras tal como la aplica agente.ts (procedencia LIGADA a clase y escala), separando alucinacion de error de escala (pesos en lugar de centavos).
 * `dinero_inventado` cuenta SOLO los campos de dinero sin procedencia: el criterio del dueno es 0.
 */
function auditarCifras(texto, acciones) {
  const enFuente = valoresDeTexto(texto);
  const textoPlano = texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const enPiezas = valoresDeTexto(texto, { paraPiezas: true });
  const r = { inventadas: [], escala: [], precios: [], ambiguas: [], ajenas_estricto: [], dinero_inventado: [], folios: [], textos: [], a_repetir: [] };
  for (const a of acciones) {
    const cifras = cifrasDeIntencion(a);
    for (const c of cifras) {
      if (cifrasSinProcedencia(texto, [c]).length === 0) {
        if (c.esDinero && esMontoAmbiguo(texto, c.valor)) r.ambiguas.push(c.campo);
        continue;
      }
      // Error de escala: el modelo escribio pesos donde iban centavos (valor*100 si esta en el mensaje) o al reves.
      if (enFuente.has(c.valor * 100n) || (c.valor % 100n === 0n && enFuente.has(c.valor / 100n))) r.escala.push(`${a.tipo}.${c.campo}=${c.valor}`);
      else r.inventadas.push(`${a.tipo}.${c.campo}=${c.valor}`);
      if (c.esDinero) r.dinero_inventado.push(`${a.tipo}.${c.campo}=${c.valor}`);
    }
    r.precios.push(...cifrasDePrecios(a, texto));
    r.folios.push(...foliosSinProcedencia(a, texto).map((x) => `${a.tipo}.${x}`));
    r.textos.push(...textosConCifraAjena(a, texto).map((x) => `${a.tipo}.${x}`));
    r.a_repetir.push(...montosQueSeRepiten(texto, cifras).map((x) => `${a.tipo}.${x.campo}`));
    // Regla estricta: ningun numero en la salida sin presencia en el mensaje (se mira toda hoja numerica y los digitos de textos libres).
    const visitar = (k, v) => {
      if (typeof v === 'number') {
        const big = BigInt(Math.round(v));
        if (!enFuente.has(big) && !enPiezas.has(big * 100n)) r.ajenas_estricto.push(`${a.tipo}.${k}=${v}`);
      } else if (typeof v === 'string' && !['fuente_cita', 'pregunta'].includes(k)) {
        for (const m of v.matchAll(/\d[\d.,]*/g)) {
          if (!textoPlano.includes(m[0].replace(/[.,]+$/, ''))) r.ajenas_estricto.push(`${a.tipo}.${k}="${m[0]}"`);
        }
      } else if (Array.isArray(v)) v.forEach((x, i) => (typeof x === 'object' && x ? Object.entries(x).forEach(([kk, vv]) => visitar(`${k}.${i}.${kk}`, vv)) : visitar(`${k}.${i}`, x)));
    };
    for (const [k, v] of Object.entries(a)) visitar(k, v);
  }
  return r;
}

// ------------------------------------------------------------------ llamada real
async function llamar(proveedor, caso, { slugsOverride, usuarioExtra = '' } = {}) {
  const m = MODELOS[proveedor];
  const esquema = esquemaJsonDeRespuesta({ sinRangos: args.esquema === "ligero" });
  const usuario = construirUsuarioR1({ autor: caso.autor, fuente: caso.fuente ?? 'texto', texto: caso.texto, clientes: CLIENTES, modelos: MODELOS_CAT, preguntaPendiente: caso.pendiente ?? null }) + usuarioExtra;
  const MAX_SALIDA = MAX_SALIDA_FIJO ?? maxTokensSalidaPara(usuario);
  const captura = { estado: null, cuerpo: null, ms: null, error: null };
  const cliente = crearClienteOpenRouter({
    apiKey: llave,
    endpointsEeuuPorModelo: ENDPOINTS_EEUU,
    tiempoMaxMs: 60_000,
    fetch: async (url, init) => {
      const t0 = performance.now();
      const r = await fetch(url, init);
      const texto = await r.text();
      captura.ms = Math.round(performance.now() - t0);
      captura.estado = r.status;
      try { captura.cuerpo = JSON.parse(texto); } catch { captura.cuerpo = { crudo: texto.slice(0, 300) }; }
      return { ok: r.ok, status: r.status, json: async () => captura.cuerpo };
    },
  });
  const t0 = performance.now();
  let resp = null;
  try {
    resp = await cliente.extraer({ rol: 'texto', modelos: slugsOverride ?? [m.slug], sistema: SISTEMA_R1, usuario, maxTokensSalida: MAX_SALIDA, esquemaJson: esquema });
  } catch (e) {
    captura.error = e instanceof ErrorLlm ? `${e.motivo}: ${e.message}` : String(e).slice(0, 200);
  }
  const wall = Math.round(performance.now() - t0);
  const cuerpo = captura.cuerpo ?? {};
  const uso = cuerpo.usage ?? {};
  const costoUsd = typeof uso.cost === 'number' ? uso.cost : 0;
  const reg = {
    id: caso.id, categoria: caso.categoria, proveedor, slug: m.slug, version_prompt: VERSION_PROMPT, max_salida: MAX_SALIDA,
    http: captura.estado, error: captura.error, crudo_si_falla: captura.error && typeof cuerpo.choices?.[0]?.message?.content === "string" ? cuerpo.choices[0].message.content.slice(0, 300) : null, error_cuerpo: captura.estado && captura.estado >= 400 ? JSON.stringify(cuerpo).slice(0, 400) : null,
    modelo_usado: cuerpo.model ?? null, proveedor_real: cuerpo.provider ?? null,
    finish: cuerpo.choices?.[0]?.finish_reason ?? cuerpo.choices?.[0]?.native_finish_reason ?? null,
    tokens_entrada: uso.prompt_tokens ?? null, tokens_salida: uso.completion_tokens ?? null,
    tokens_razonamiento: uso.completion_tokens_details?.reasoning_tokens ?? null,
    estimado_entrada: estimarTokensSolicitud(SISTEMA_R1, usuario, esquema),
    costo_usd: costoUsd, latencia_ms: captura.ms ?? wall, wall_ms: wall,
    esquema_aceptado: captura.estado === 200 && typeof cuerpo.choices?.[0]?.message?.content === 'string',
  };
  if (resp) {
    const v = validarRespuesta(resp.contenido);
    reg.zod_ok = v.ok;
    reg.zod_errores = v.ok ? null : v.errores;
    reg.respuesta = resp.contenido;
    const acciones = Array.isArray(resp.contenido?.acciones) ? resp.contenido.acciones : [];
    reg.evaluacion = evaluar(caso, acciones, resp.contenido?.sospecha_inyeccion === true);
    // Como en produccion, las guardias de cifras corren sobre una respuesta que ya paso zod; si zod la rechaza no hay cifras que auditar (el agente reintenta una vez con los errores).
    reg.cifras = v.ok ? auditarCifras(caso.texto, acciones) : { inventadas: [], escala: [], precios: [], ambiguas: [], ajenas_estricto: [], dinero_inventado: [], folios: [], textos: [], a_repetir: [] };
  } else {
    reg.zod_ok = false;
  }
  return reg;
}

/** Igual que el agente: si la respuesta no pasa zod, UN reintento con los errores de validacion. Los costos y latencias se suman; se conserva el resultado del primer intento. */
async function llamarConReintento(proveedor, caso) {
  const r1 = await llamar(proveedor, caso);
  if (!(r1.respuesta && !r1.zod_ok)) return r1;
  const r2 = await llamar(proveedor, caso, { usuarioExtra: `\nerrores_de_validacion: ${JSON.stringify(r1.zod_errores)}` });
  return {
    ...r2,
    reintento: true,
    primer_intento: { zod_ok: false, errores: r1.zod_errores.slice(0, 3), intent_ok: r1.evaluacion?.intent_ok ?? false },
    costo_usd: r1.costo_usd + r2.costo_usd,
    latencia_ms: r1.latencia_ms + r2.latencia_ms,
    tokens_entrada: (r1.tokens_entrada ?? 0) + (r2.tokens_entrada ?? 0),
    tokens_salida: (r1.tokens_salida ?? 0) + (r2.tokens_salida ?? 0),
  };
}

async function pool(tareas, concurrencia, fn) {
  let i = 0;
  const ws = Array.from({ length: concurrencia }, async () => {
    while (i < tareas.length) {
      if (excedido()) return;
      const t = tareas[i++];
      await fn(t);
    }
  });
  await Promise.all(ws);
}

// ------------------------------------------------------------------ resumen
const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(1)}%` : 'n/a');
function percentil(v, p) { if (!v.length) return null; const s = v.slice().sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; }
function resumir(regs) {
  const R = {};
  for (const prov of new Set(regs.map((r) => r.proveedor))) {
    const rs = regs.filter((r) => r.proveedor === prov);
    const conResp = rs.filter((r) => r.respuesta);
    const conCampos = conResp.filter((r) => r.evaluacion.campos_ok !== null);
    const ds = conResp.filter((r) => r.categoria === 'dropshipping');
    const iny = conResp.filter((r) => 'inyeccion_ok' in r.evaluacion);
    R[prov] = {
      llamadas: rs.length,
      esquema_aceptado: pct(rs.filter((r) => r.esquema_aceptado).length, rs.length),
      zod_valido_final: pct(conResp.filter((r) => r.zod_ok).length, rs.length),
      zod_valido_primer_intento: pct(rs.filter((r) => (r.reintento ? false : r.zod_ok)).length, rs.length),
      reintentos: rs.filter((r) => r.reintento).length,
      truncadas: rs.filter((r) => r.finish === 'length').length,
      intencion_ok: pct(conResp.filter((r) => r.evaluacion.intent_ok).length, rs.length),
      campos_ok: pct(conCampos.filter((r) => r.evaluacion.campos_ok).length, conCampos.length),
      inyeccion_marcada: pct(iny.filter((r) => r.evaluacion.inyeccion_ok).length, iny.length),
      cifras_inventadas_antes_de_guardia: conResp.reduce((s, r) => s + r.cifras.inventadas.length, 0),
      cifras_de_dinero_inventadas: conResp.reduce((s, r) => s + (r.cifras.dinero_inventado?.length ?? 0), 0),
      folios_inventados: conResp.reduce((s, r) => s + (r.cifras.folios?.length ?? 0), 0),
      textos_con_cifra_ajena: conResp.reduce((s, r) => s + (r.cifras.textos?.length ?? 0), 0),
      errores_de_escala_pesos_por_centavos: conResp.reduce((s, r) => s + r.cifras.escala.length, 0),
      precios_sin_procedencia: conResp.reduce((s, r) => s + r.cifras.precios.length, 0),
      cifras_ajenas_regla_estricta: conResp.reduce((s, r) => s + r.cifras.ajenas_estricto.length, 0),
      mensajes_con_cifra_ajena_estricta: conResp.filter((r) => r.cifras.ajenas_estricto.length > 0).length,
      dropshipping: { n: ds.length, intencion_ok: pct(ds.filter((r) => r.evaluacion.intent_ok).length, ds.length), campos_ok: pct(ds.filter((r) => r.evaluacion.campos_ok === true).length, ds.filter((r) => r.evaluacion.campos_ok !== null).length), lineas_ok: pct(ds.filter((r) => r.evaluacion.fino.lineas === true).length, ds.filter((r) => 'lineas' in r.evaluacion.fino).length), plazo_ok: pct(ds.filter((r) => r.evaluacion.fino.plazo === true).length, ds.filter((r) => 'plazo' in r.evaluacion.fino).length), fugas_destinatario: ds.filter((r) => r.evaluacion.fuga_destinatario).length },
      tokens_entrada_medio: Math.round(rs.reduce((s, r) => s + (r.tokens_entrada ?? 0), 0) / Math.max(1, rs.filter((r) => r.tokens_entrada).length)),
      tokens_salida_medio: Math.round(rs.reduce((s, r) => s + (r.tokens_salida ?? 0), 0) / Math.max(1, rs.filter((r) => r.tokens_salida).length)),
      estimado_entrada_medio: Math.round(rs.reduce((s, r) => s + r.estimado_entrada, 0) / rs.length),
      costo_por_mensaje_usd: Number((rs.reduce((s, r) => s + r.costo_usd, 0) / rs.length).toFixed(6)),
      costo_total_usd: Number(rs.reduce((s, r) => s + r.costo_usd, 0).toFixed(5)),
      latencia_p50_ms: percentil(rs.map((r) => r.latencia_ms), 0.5),
      latencia_p95_ms: percentil(rs.map((r) => r.latencia_ms), 0.95),
      proveedores_reales: [...new Set(rs.map((r) => r.proveedor_real).filter(Boolean))],
      errores: Object.entries(rs.filter((r) => r.error).reduce((a, r) => ({ ...a, [r.error.slice(0, 80)]: (a[r.error.slice(0, 80)] ?? 0) + 1 }), {})),
    };
  }
  return R;
}

// ------------------------------------------------------------------ principal
const ARCH_RES = path.join(SALIDA, 'resultados.jsonl');
const previos = fs.existsSync(ARCH_RES) && !args.nuevo ? fs.readFileSync(ARCH_RES, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
const clave = (r) => `${r.proveedor}|${r.id}|${r.version_prompt}`;
const hechos = new Set(previos.map(clave));
const nuevos = [];

if (args['cadena-viva']) {
  // Respaldo en la cadena, en vivo: se inyecta un fallo (HTTP 503) en las primeras llamadas (Haiku, luego Luna) y las siguientes van a OpenRouter de verdad.
  const caso = banco.find((c) => c.id.startsWith('cob')) ?? banco[0];
  const usuario = construirUsuarioR1({ autor: caso.autor, fuente: 'texto', texto: caso.texto, clientes: CLIENTES, modelos: MODELOS_CAT });
  for (const fallos of [1, 2]) {
    let n = 0;
    const llamadas = [];
    const cliente = crearClienteOpenRouter({
      apiKey: llave,
      endpointsEeuuPorModelo: ENDPOINTS_EEUU,
      tiempoMaxMs: 60_000,
      fetch: async (url, init) => {
        llamadas.push(JSON.parse(init.body).models[0]);
        if (n++ < fallos) return { ok: false, status: 503, json: async () => ({ error: 'fallo inyectado' }) };
        const r = await fetch(url, init);
        const j = await r.json();
        if (typeof j?.usage?.cost === 'number') registrarGasto('cadena', j.usage.cost);
        return { ok: r.ok, status: r.status, json: async () => j };
      },
    });
    const r = await cliente.extraer({ rol: 'texto', modelos: cadenaParaRol('texto').map((m) => m.slug), sistema: SISTEMA_R1, usuario, maxTokensSalida: MAX_SALIDA, esquemaJson: esquemaJsonDeRespuesta() });
    const v = validarRespuesta(r.contenido);
    console.log(`fallos inyectados=${fallos}: intentos=${llamadas.join(' -> ')} | respondio ${r.modeloUsado} | acciones=${v.ok ? v.valor.acciones.map((a) => a.tipo).join(',') : 'invalida'}`);
  }
  console.log(`GASTO REAL ACUMULADO: US$${gasto.total_usd.toFixed(5)}`);
  process.exit(0);
}

for (const proveedor of PROVEEDORES) {
  if (!MODELOS[proveedor]) throw new Error(`proveedor desconocido: ${proveedor}`);
  cadenaParaRol('texto'); // valida politica
  const tareas = banco.filter((c) => !hechos.has(clave({ proveedor, id: c.id, version_prompt: VERSION_PROMPT })));
  console.log(`[${proveedor}] ${tareas.length} llamadas pendientes de ${banco.length} (gasto acumulado US$${gasto.total_usd.toFixed(4)} de tope US$${TOPE_USD})`);
  await pool(tareas, args.humo ? 1 : CONCURRENCIA, async (caso) => {
    const reg = await llamarConReintento(proveedor, caso);
    registrarGasto(proveedor, reg.costo_usd);
    fs.appendFileSync(ARCH_RES, JSON.stringify(reg) + '\n');
    nuevos.push(reg);
    if (nuevos.length % 20 === 0) console.log(`  ... ${nuevos.length} llamadas, gasto US$${gasto.total_usd.toFixed(4)}`);
  });
  if (excedido()) { console.log(`TOPE ALCANZADO: US$${gasto.total_usd.toFixed(4)} >= US$${TOPE_USD}. Abortando.`); break; }
}

const todosRegs = [...previos, ...nuevos].filter((r) => banco.some((c) => c.id === r.id) && r.version_prompt === VERSION_PROMPT);
const resumen = resumir(todosRegs);
fs.writeFileSync(path.join(SALIDA, `resumen-${VERSION_PROMPT}.json`), JSON.stringify(resumen, null, 1));
console.log(JSON.stringify(resumen, null, 1));
console.log(`GASTO REAL ACUMULADO: US$${gasto.total_usd.toFixed(5)} en ${gasto.llamadas} llamadas`);
