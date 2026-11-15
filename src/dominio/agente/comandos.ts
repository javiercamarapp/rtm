// Modo sin IA: comandos de Telegram interpretados SOLO con codigo (sin modelo). Producen las mismas intenciones que el extractor,
// de modo que resolucion de alias, calculo, eco y deshacer son identicos con o sin IA.
import { normalizar } from '../catalogo/normalizar';
import { centavosDesdeTexto } from '../dinero';
import { nombreSeguro } from './entrada';
import {
  TIPOS_GASTO,
  type ILineaCompraTexto,
  type ILoteHistorico,
  type Intencion,
  type LineaPedidoTexto,
  type QuienPaga,
  type SocioNombre,
  type TipoGasto,
  type ViaPago,
} from './intenciones';

export const USO_COMANDOS: Readonly<Record<string, string>> = {
  pedido: '/pedido Cliente | modelo 28 | 24 modelo | envio 150 | plazo contado (o plazo 15 dias)',
  pago: '/pago Cliente | 7000 [| cuenta]',
  gasto: '/gasto guia 500 angelo',
  aporte: '/aporte javier 1000 [capital|reembolso] [motivo]',
  reembolso: '/reembolso javier 1000 [transferencia|efectivo]',
  retiro: '/retiro javier 5000 [transferencia|efectivo]',
  devolucion: '/devolucion Cliente | P-0001 | modelo 5 | inventario|merma | motivo',
  paquete: '/paquete perdido|danado P-0001',
  estado: '/estado angelo|javier',
  utilidad: '/utilidad [hoy|semana|mes]',
  cartera: '/cartera',
  porpagar: '/porpagar',
  compra: '/compra karen | modelo 100 | modelo 50',
  oc: '/oc karen | modelo 100 | saldo',
  pagoprov: '/pagoprov karen | 30500 | angelo',
  toma: '/toma modelo 5 | modelo 3',
  stock: '/stock [modelo]',
  saldo: '/saldo omar|isaac|karen|socios|cliente',
  resumen: '/resumen [hoy|ayer|semana]',
  pendientes: '/pendientes',
  deshacer: '/deshacer [folio]',
  explicar: '/explicar folio',
  enviado: '/enviado P-0001 [guia]',
  entregado: '/entregado P-0001',
  cancelar: '/cancelar P-0001 | motivo',
  aprobar: '/aprobar C-0001',
  enviada: '/enviada C-0001',
  llego: '/llego C-0001',
  recibir: '/recibir C-0001 [| modelo/sabor 5 | ...]  (con renglones = llegada parcial, la compra sigue abierta; sin renglones = lo que falta: total si aun no ha llegado nada)',
  servicio: '/servicio openrouter 20usd javier [tc 18.50]  o  /servicio vercel 500 javier',
  merma: '/merma modelo/sabor 3 | motivo',
  conteo: '/conteo modelo/sabor 12 | modelo/sabor 4',
  cliente: '/cliente Nombre del cliente',
  precio: '/precio Cliente | modelo | 250',
  acta: '/acta [AAAA-MM] [retira angelo 1000] [reinvierte javier 500]',
  firmaracta: '/firmaracta [A-0001]',
  lote: '/lote etiqueta  [total 1500]  (una linea por movimiento: 2026-10-03 gasto javier 500 uber | 2026-10-04 cobro Cliente 7000 efectivo)',
  pedidomenudeo: '/pedidomenudeo [karen|isaac] | modelo/sabor 24 | modelo/sabor 10 | cuando el viernes 5pm  (o: sin fecha)',
  pagopedido: '/pagopedido P-0001 | 1000 | [transferencia|deposito|efectivo] | [proveedor|sociedad] | [ref CLAVE] | [ayer]',
  cierre: '/cierre',
  igualar: '/igualar [angelo|javier]',
  cuadra: '/cuadra',
  balance: '/balance',
  diario: '/diario',
  cobertura: '/cobertura [modelo]',
  reporte: '/reporte [semana|mes|hoy]',
  compras: '/compras',
  pedidos: '/pedidos',
  sinia: '/sinia',
  conia: '/conia',
  lectura: '/lectura',
  escritura: '/escritura',
  ayuda: '/ayuda',
};

export const LISTA_COMANDOS =
  '/pedido, /pago, /pagoprov, /gasto, /aporte, /reembolso, /retiro, /devolucion, /paquete, /compra, /stock, /saldo, /estado, /utilidad, /cartera, /deshacer, /resumen, /pendientes, /enviado, /entregado, /cancelar, /aprobar, /enviada, /llego, /recibir, /servicio, /merma, /conteo, /cliente, /precio, /acta, /firmaracta, /lote, /pedidomenudeo, /pagopedido, /cuadra, /balance, /diario, /cobertura, /reporte, /compras, /pedidos, /socios, /valuacion, /cierre, /igualar, /lectura, /escritura';

export type ResultadoComando =
  | { ok: true; tipo: 'intencion'; intencion: Intencion }
  | { ok: true; tipo: 'control'; control: 'sinia' | 'conia' | 'lectura' | 'escritura' }
  | { ok: false; error: 'comando_desconocido' | 'formato'; uso: string };

const PIEZAS_MIN = 1;
const PIEZAS_MAX = 1_000_000;

function fallo(clave: string): ResultadoComando {
  return { ok: false, error: 'formato', uso: USO_COMANDOS[clave] ?? LISTA_COMANDOS };
}

function monto(texto: string): number | null {
  try {
    const c = centavosDesdeTexto(texto);
    return c > 0n && c <= 10_000_000_000_000n ? Number(c) : null;
  } catch {
    return null;
  }
}

function piezas(texto: string): number | null {
  if (!/^\d+$/.test(texto)) return null;
  const n = Number(texto);
  return n >= PIEZAS_MIN && n <= PIEZAS_MAX ? n : null;
}

/** "28 jupiter" o "jupiter 28" -> piezas y texto de modelo. El primer token numerico entero manda; si no, el ultimo. */
function parsearLinea(segmento: string): { modelo: string; piezas: number } | null {
  const s = segmento.trim();
  const delante = /^(\d+)\s+(\D.*)$/.exec(s);
  if (delante) {
    const p = piezas(delante[1]!);
    return p === null ? null : { modelo: delante[2]!.trim(), piezas: p };
  }
  const detras = /^(.*\S)\s+(\d+)$/.exec(s);
  if (detras) {
    const p = piezas(detras[2]!);
    return p === null ? null : { modelo: detras[1]!.trim(), piezas: p };
  }
  return null;
}

function quienPaga(texto: string): QuienPaga | null {
  const n = normalizar(texto);
  if (n === 'angelo' || n === 'javier' || n === 'sociedad') return n;
  return null;
}

function viaDe(texto: string): ViaPago | null {
  const n = normalizar(texto);
  return n === 'transferencia' || n === 'efectivo' ? n : null;
}

function socio(texto: string): SocioNombre | null {
  const n = normalizar(texto);
  return n === 'angelo' || n === 'javier' ? n : null;
}

function consulta(consulta: Extract<Intencion, { tipo: 'consulta' }>['consulta'], extra: Partial<Extract<Intencion, { tipo: 'consulta' }>> = {}): ResultadoComando {
  return {
    ok: true,
    tipo: 'intencion',
    intencion: { tipo: 'consulta', consulta, modelo_texto: null, sabor_texto: null, sujeto_texto: null, folio: null, periodo: null, ...extra },
  };
}

/** "jupiter/uva" -> modelo y sabor. Sin "/" el sabor queda null (el agente pregunta). */
function modeloSabor(texto: string): { modelo_texto: string; sabor_texto: string | null } {
  const i = texto.indexOf('/');
  if (i <= 0 || i === texto.length - 1) return { modelo_texto: texto.trim(), sabor_texto: null };
  return { modelo_texto: texto.slice(0, i).trim(), sabor_texto: texto.slice(i + 1).trim() };
}

function lineaDe(seg: string, maxPiezas = PIEZAS_MAX, minPiezas = PIEZAS_MIN): ILineaCompraTexto | null {
  const l = parsearLinea(seg);
  if (!l || l.piezas > maxPiezas || l.piezas < minPiezas) return null;
  return { ...modeloSabor(l.modelo), piezas: l.piezas };
}

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

/** Una linea de lote historico: "2026-10-03 gasto javier 500 uber" | "2026-10-04 cobro Cliente Norte 7000 efectivo" | "aportacion javier 1000 [capital]" | "reembolso|retiro javier 500 [efectivo|transferencia]". */
export function parsearRenglonHistorico(linea: string): ILoteHistorico['renglones'][number] | null {
  const t = linea.trim().split(/\s+/);
  const [fecha, tipoT, ...resto] = t;
  if (!fecha || !FECHA.test(fecha) || !tipoT) return null;
  const tipo = normalizar(tipoT);
  const base = { fecha, socio: null, cliente_texto: null, cuenta_texto: null, concepto: null, intencion: null, via: null } as const;
  if (tipo === 'gasto' || tipo === 'aportacion' || tipo === 'reembolso' || tipo === 'retiro') {
    const s = resto[0] === undefined ? null : socio(resto[0]);
    const c = resto[1] === undefined ? null : monto(resto[1]);
    if (s === null || c === null) return null;
    const extra = resto.slice(2).join(' ');
    const n = normalizar(extra);
    return {
      ...base,
      tipo,
      socio: s,
      monto_centavos: c,
      concepto: tipo === 'gasto' && extra !== '' ? extra.slice(0, 100) : null,
      intencion: tipo === 'aportacion' && n.includes('capital') ? 'capital' : null,
      via: tipo === 'reembolso' || tipo === 'retiro' ? (n.includes('transferencia') ? 'transferencia' : n.includes('efectivo') ? 'efectivo' : null) : null,
    };
  }
  if (tipo === 'cobro') {
    // cobro <cliente...> <monto> [cuenta]
    const i = resto.findIndex((x) => monto(x) !== null);
    if (i <= 0) return null;
    const c = monto(resto[i]!);
    if (c === null) return null;
    return { ...base, tipo: 'cobro', monto_centavos: c, cliente_texto: resto.slice(0, i).join(' '), cuenta_texto: resto[i + 1] ?? null };
  }
  return null;
}

/** Interpreta un mensaje que empieza con "/". Devuelve null si no es un comando. */
export function parsearComando(texto: string): ResultadoComando | null {
  const limpio = texto.trim();
  const m = /^\/([a-zA-Z]+)(?:@\w+)?(?:\s+([\s\S]*))?$/.exec(limpio);
  if (!m) return null;
  const nombre = m[1]!.toLowerCase();
  const resto = (m[2] ?? '').trim();
  const partes = resto === '' ? [] : resto.split('|').map((p) => p.trim()).filter((p) => p !== '');
  const cita = limpio.slice(0, 120);

  switch (nombre) {
    case 'start':
    case 'ayuda':
      return consulta('ayuda');
    case 'sinia':
    case 'conia':
    case 'lectura':
    case 'escritura':
      return { ok: true, tipo: 'control', control: nombre };
    case 'pendientes':
      return consulta('pendientes');
    case 'stock':
    case 'inventario':
      return consulta('inventario', { modelo_texto: resto === '' ? null : resto });
    case 'saldo': {
      if (resto === '') return fallo('saldo');
      // '/saldo con Karen' y '/saldo de Isaac' dicen lo mismo que '/saldo karen': se quita la preposicion antes de buscar al sujeto.
      const sujeto = resto.replace(/^(?:con|de)\s+/i, '').trim() || resto;
      const n = normalizar(sujeto);
      const esProveedor = n === 'isaac' || n === 'karen' || n === 'vapemate';
      return consulta(esProveedor ? 'saldo_proveedor' : 'saldo', { sujeto_texto: sujeto });
    }
    case 'estado': {
      const s = socio(resto);
      return s === null ? fallo('estado') : consulta('estado_cuenta_socio', { sujeto_texto: s });
    }
    case 'utilidad': {
      const p = normalizar(resto);
      if (p === '') return consulta('utilidad', { periodo: 'mes' });
      return p === 'hoy' || p === 'semana' || p === 'mes' ? consulta('utilidad', { periodo: p }) : fallo('utilidad');
    }
    case 'cartera':
      return consulta('cartera');
    case 'porpagar':
      return consulta('por_pagar');
    case 'resumen': {
      const p = normalizar(resto);
      if (p === '') return consulta('resumen', { periodo: 'hoy' });
      return p === 'hoy' || p === 'ayer' || p === 'semana' ? consulta('resumen', { periodo: p }) : fallo('resumen');
    }
    case 'explicar':
      return resto === '' ? fallo('explicar') : consulta('explicar', { folio: resto.toUpperCase() });
    case 'deshacer':
      return { ok: true, tipo: 'intencion', intencion: { tipo: 'deshacer', folio: resto === '' ? null : resto.toUpperCase() } };

    case 'pedido': {
      const [cliente, ...segmentos] = partes;
      if (!cliente || segmentos.length === 0) return fallo('pedido');
      const lineas: LineaPedidoTexto[] = [];
      let envio: number | null = null;
      let plazo: string | null = null;
      for (const seg of segmentos) {
        const pz = /^(?:plazo|paga|pago)\s+(.+)$/i.exec(seg);
        if (pz) {
          plazo = pz[1]!.trim();
          continue;
        }
        const e = /^env[ií]o\s+(.+)$/i.exec(seg);
        if (e) {
          envio = monto(e[1]!);
          if (envio === null) return fallo('pedido');
          continue;
        }
        const l = parsearLinea(seg);
        if (!l) return fallo('pedido');
        lineas.push({ ...modeloSabor(l.modelo), piezas: l.piezas, precio_texto: null, fuente_cita: seg.slice(0, 120) });
      }
      if (lineas.length === 0 || lineas.length > 30) return fallo('pedido');
      return { ok: true, tipo: 'intencion', intencion: { tipo: 'pedido', cliente_texto: cliente, destino_texto: null, lineas, envio_cobrado_centavos: envio, plazo_texto: plazo, fuente_cita: cita } };
    }
    case 'pago': {
      const [cliente, importe, cuenta] = partes;
      const c = importe === undefined ? null : monto(importe);
      if (!cliente || c === null) return fallo('pago');
      // La cuenta es opcional en el comando: si falta, el bot la PREGUNTA antes de escribir (no hay tarjeta de confirmacion).
      return { ok: true, tipo: 'intencion', intencion: { tipo: 'pago', cliente_texto: cliente, monto_centavos: c, cuenta_destino_texto: cuenta ?? null, pedido_folio: null, fuente_cita: cita } };
    }
    case 'gasto': {
      const t = resto.split(/\s+/);
      const [tipoTexto, importe, quien] = t;
      const tipo = TIPOS_GASTO.find((g) => g === normalizar(tipoTexto ?? '')) as TipoGasto | undefined;
      const c = importe === undefined ? null : monto(importe);
      const q = quien === undefined ? null : quienPaga(quien);
      if (!tipo || c === null || q === null) return fallo('gasto');
      return { ok: true, tipo: 'intencion', intencion: { tipo: 'gasto', gasto: tipo, monto_centavos: c, pagado_por: q, descripcion: null, fuente_cita: cita } };
    }
    case 'aporte': {
      const [quien, importe, ...resta] = resto.split(/\s+/);
      const s = quien === undefined ? null : socio(quien);
      const c = importe === undefined ? null : monto(importe);
      if (s === null || c === null) return fallo('aporte');
      const declarada = resta.length > 0 ? normalizar(resta[0]!) : '';
      const intencion = declarada === 'capital' || declarada === 'reembolso' ? declarada : null;
      const motivo = intencion === null ? resta : resta.slice(1);
      return { ok: true, tipo: 'intencion', intencion: { tipo: 'aportacion', socio: s, monto_centavos: c, motivo: motivo.length ? motivo.join(' ') : null, intencion, fuente_cita: cita } };
    }
    case 'reembolso':
    case 'retiro': {
      const [quien, importe, via] = resto.split(/\s+/);
      const s = quien === undefined ? null : socio(quien);
      const c = importe === undefined ? null : monto(importe);
      const v = via === undefined ? null : viaDe(via);
      if (s === null || c === null || (via !== undefined && v === null)) return fallo(nombre);
      return {
        ok: true,
        tipo: 'intencion',
        intencion: nombre === 'reembolso'
          ? { tipo: 'reembolso_socio', socio: s, monto_centavos: c, via: v, fuente_cita: cita }
          : { tipo: 'retiro_utilidad', socio: s, monto_centavos: c, via: v, fuente_cita: cita },
      };
    }
    case 'devolucion': {
      const [cliente, ...segmentos] = partes;
      if (!cliente || segmentos.length === 0) return fallo('devolucion');
      const lineas: ILineaCompraTexto[] = [];
      let folio: string | null = null;
      let destino: 'inventario' | 'merma' | null = null;
      let motivo: string | null = null;
      for (const seg of segmentos) {
        const n = normalizar(seg);
        if (/^[a-z]{1,3} ?-? ?\d{1,6}$/.test(n) && lineas.length === 0 && folio === null) { folio = seg.toUpperCase().replace(/\s+/g, ''); continue; }
        if (n === 'inventario' || n === 'merma') { destino = n; continue; }
        const l = parsearLinea(seg);
        if (l) { lineas.push({ modelo_texto: l.modelo, sabor_texto: null, piezas: l.piezas }); continue; }
        motivo = seg.slice(0, 100);
      }
      if (lineas.length === 0 || lineas.length > 30) return fallo('devolucion');
      return { ok: true, tipo: 'intencion', intencion: { tipo: 'devolucion', cliente_texto: cliente, pedido_folio: folio, lineas, destino, motivo, fuente_cita: cita } };
    }
    case 'paquete': {
      const [tipoTexto, folio] = resto.split(/\s+/);
      const t = tipoTexto === undefined ? '' : normalizar(tipoTexto);
      const incidente = t === 'perdido' ? 'perdido' : t === 'danado' ? 'danado' : null;
      if (incidente === null || folio === undefined) return fallo('paquete');
      return { ok: true, tipo: 'intencion', intencion: { tipo: 'paquete_perdido', pedido_folio: folio.toUpperCase(), cliente_texto: null, incidente, detalle: null, fuente_cita: cita } };
    }
    case 'compra':
    case 'oc': {
      const [proveedor, ...segmentos] = partes;
      if (!proveedor || segmentos.length === 0) return fallo(nombre);
      let aplicarSaldo = false;
      const lineas: ILineaCompraTexto[] = [];
      for (const seg of segmentos) {
        if (nombre === 'oc' && normalizar(seg) === 'saldo') {
          aplicarSaldo = true;
          continue;
        }
        const l = parsearLinea(seg);
        if (!l) return fallo(nombre);
        lineas.push({ ...modeloSabor(l.modelo), piezas: l.piezas });
      }
      if (lineas.length === 0 || lineas.length > 30) return fallo(nombre);
      return nombre === 'oc'
        ? { ok: true, tipo: 'intencion', intencion: { tipo: 'orden_compra', proveedor_texto: proveedor, lineas, aplicar_saldo: aplicarSaldo, fuente_cita: cita } }
        : { ok: true, tipo: 'intencion', intencion: { tipo: 'compra', proveedor_texto: proveedor, lineas, guia_centavos: null, pagado_por: null, fuente_cita: cita } };
    }
    case 'pagoprov': {
      const [proveedor, importe, quien] = partes;
      const c = importe === undefined ? null : monto(importe);
      const q = quien === undefined ? null : quienPaga(quien);
      if (!proveedor || c === null || q === null) return fallo('pagoprov');
      return { ok: true, tipo: 'intencion', intencion: { tipo: 'pago_proveedor', proveedor_texto: proveedor, monto_centavos: c, pagado_por: q, cliente_texto: null, intencion: null, fuente_cita: cita } };
    }
    case 'toma': {
      if (partes.length === 0) return fallo('toma');
      const lineas: ILineaCompraTexto[] = [];
      for (const seg of partes) {
        const l = parsearLinea(seg);
        if (!l || l.piezas > 200) return fallo('toma');
        lineas.push({ ...modeloSabor(l.modelo), piezas: l.piezas });
      }
      return { ok: true, tipo: 'intencion', intencion: { tipo: 'toma_omar', lineas, fuente_cita: cita } };
    }
    case 'enviado':
    case 'entregado': {
      const [folio, guia] = resto.split(/\s+/);
      if (!folio) return fallo(nombre);
      return { ok: true, tipo: 'intencion', intencion: { tipo: 'pedido_envio', pedido_folio: folio.toUpperCase(), estado: nombre, paqueteria_texto: null, guia_texto: guia ?? null, fuente_cita: cita } };
    }
    case 'cancelar': {
      const [folio, motivo] = partes;
      if (!folio) return fallo('cancelar');
      return { ok: true, tipo: 'intencion', intencion: { tipo: 'pedido_cancelar', pedido_folio: folio.toUpperCase(), motivo: motivo ?? null, fuente_cita: cita } };
    }
    case 'aprobar':
      return resto === '' ? fallo('aprobar') : { ok: true, tipo: 'intencion', intencion: { tipo: 'compra_aprobar', compra_folio: resto.toUpperCase(), fuente_cita: cita } };
    case 'enviada':
    case 'llego':
      return resto === '' ? fallo(nombre) : { ok: true, tipo: 'intencion', intencion: { tipo: 'compra_estado', compra_folio: resto.toUpperCase(), estado: nombre === 'enviada' ? 'enviada' : 'llego_merida', fuente_cita: cita } };
    case 'recibir': {
      const [folio, ...segs] = partes;
      if (!folio) return fallo('recibir');
      const lineas: ILineaCompraTexto[] = [];
      for (const seg of segs) {
        const l = lineaDe(seg);
        if (!l) return fallo('recibir');
        lineas.push(l);
      }
      return { ok: true, tipo: 'intencion', intencion: { tipo: 'compra_recepcion', compra_folio: folio.toUpperCase(), lineas, fuente_cita: cita } };
    }
    case 'servicio': {
      const t = resto.split(/\s+/);
      const [servicio, importe, quien, ...extra] = t;
      const usd = importe === undefined ? null : /^(.+?)\s*usd$/i.exec(importe);
      const c = importe === undefined ? null : monto(usd ? usd[1]! : importe);
      const q = quien === undefined ? null : quienPaga(quien);
      if (!servicio || c === null || q === null || q === 'sociedad') return fallo('servicio');
      let tc: number | null = null;
      if (extra[0] && normalizar(extra[0]) === 'tc' && extra[1]) {
        const m = /^\d+(\.\d{1,6})?$/.exec(extra[1]);
        if (!m) return fallo('servicio');
        const [e, d = ''] = extra[1].split('.');
        tc = Number(e) * 1_000_000 + Number(d.padEnd(6, '0'));
      }
      return { ok: true, tipo: 'intencion', intencion: { tipo: 'gasto_servicio', servicio_texto: servicio, monto_usd_centavos: usd ? c : null, monto_mxn_centavos: usd ? null : c, tipo_cambio_micro: usd ? tc : null, pagado_por: q, fuente_cita: cita } };
    }
    case 'merma': {
      const [item, motivo] = partes;
      const l = item === undefined ? null : lineaDe(item);
      if (!l) return fallo('merma');
      return { ok: true, tipo: 'intencion', intencion: { tipo: 'merma', modelo_texto: l.modelo_texto, sabor_texto: l.sabor_texto, piezas: l.piezas, motivo: motivo ?? null, fuente_cita: cita } };
    }
    case 'conteo': {
      if (partes.length === 0) return fallo('conteo');
      const lineas: ILineaCompraTexto[] = [];
      for (const seg of partes) {
        const l = lineaDe(seg, 5000, 0);
        if (!l) return fallo('conteo');
        lineas.push(l);
      }
      return { ok: true, tipo: 'intencion', intencion: { tipo: 'conteo', lineas, fuente_cita: cita } };
    }
    case 'cliente':
      return resto.length < 2 ? fallo('cliente') : { ok: true, tipo: 'intencion', intencion: { tipo: 'cliente_alta', nombre: nombreSeguro(resto), fuente_cita: cita } };
    case 'precio': {
      const [cliente, modelo, importe] = partes;
      const c = importe === undefined ? null : monto(importe);
      if (!cliente || !modelo || c === null) return fallo('precio');
      return { ok: true, tipo: 'intencion', intencion: { tipo: 'cliente_precio', cliente_texto: cliente, modelo_texto: modelo, precio_centavos: c, fuente_cita: cita } };
    }
    case 'acta': {
      const t = resto.split(/\s+/).filter((x) => x !== '');
      let mes: string | null = null;
      const d = { retira_angelo_centavos: null as number | null, retira_javier_centavos: null as number | null, reinvierte_angelo_centavos: null as number | null, reinvierte_javier_centavos: null as number | null };
      for (let i = 0; i < t.length; i++) {
        if (/^\d{4}-\d{2}$/.test(t[i]!)) { mes = t[i]!; continue; }
        const verbo = normalizar(t[i]!);
        const s = t[i + 1] === undefined ? null : socio(t[i + 1]!);
        const c = t[i + 2] === undefined ? null : monto(t[i + 2]!);
        if ((verbo === 'retira' || verbo === 'reinvierte') && s !== null && c !== null) {
          d[`${verbo}_${s}_centavos` as keyof typeof d] = c;
          i += 2;
          continue;
        }
        return fallo('acta');
      }
      return { ok: true, tipo: 'intencion', intencion: { tipo: 'acta_propuesta', mes, ...d, fuente_cita: cita } };
    }
    case 'firmaracta':
      return { ok: true, tipo: 'intencion', intencion: { tipo: 'acta_firma', acta_folio: resto === '' ? null : resto.toUpperCase(), fuente_cita: cita } };
    case 'lote': {
      let totalDictado: number | null = null;
      const lineasTxt = (m[2] ?? '').split('\n').map((x) => x.trim()).filter((x) => x !== '').filter((x) => {
        const t = /^total\s+(.+)$/i.exec(x);
        if (!t) return true;
        totalDictado = monto(t[1]!);
        return false;
      });
      const [cabecera, ...cuerpo] = lineasTxt;
      const etiqueta = cabecera !== undefined && !FECHA.test(cabecera.split(/\s+/)[0] ?? '') ? cabecera.slice(0, 60) : null;
      const filas = etiqueta === null && cabecera !== undefined ? [cabecera, ...cuerpo] : cuerpo;
      const renglones: ILoteHistorico['renglones'] = [];
      for (const f of filas) {
        const r = parsearRenglonHistorico(f);
        if (!r) return { ok: false, error: 'formato', uso: `${USO_COMANDOS.lote!} (no entendi la linea: ${f.slice(0, 60)})` };
        renglones.push(r);
      }
      if (renglones.length === 0 || renglones.length > 60) return fallo('lote');
      return { ok: true, tipo: 'intencion', intencion: { tipo: 'lote_historico', etiqueta, total_dictado_centavos: totalDictado, renglones, fuente_cita: limpio.slice(0, 120) } };
    }
    case 'pedidomenudeo': {
      const lineas: ILineaCompraTexto[] = [];
      let origen: 'karen_directo' | 'karen_via_isaac' | 'isaac_directo' | null = null;
      let cuando: string | null = null;
      let sinFecha = false;
      for (const seg of partes) {
        const n = normalizar(seg);
        if (n === 'karen' || n === 'vapemate') { origen = 'karen_directo'; continue; }
        if (n === 'isaac') { origen = 'isaac_directo'; continue; }
        if (n === 'karen via isaac') { origen = 'karen_via_isaac'; continue; }
        if (n === 'sin fecha') { sinFecha = true; continue; }
        const c = /^(?:cuando|pago|pago el|paga)\s+(.+)$/i.exec(seg);
        if (c) { cuando = c[1]!.slice(0, 60); continue; }
        const l = lineaDe(seg);
        if (!l) return fallo('pedidomenudeo');
        lineas.push(l);
      }
      if (lineas.length === 0 || lineas.length > 30) return fallo('pedidomenudeo');
      return { ok: true, tipo: 'intencion', intencion: { tipo: 'pedido_menudeo', proveedor_origen: origen, lineas, cuando_texto: cuando, ...(sinFecha ? { sin_fecha: true } : {}), fuente_cita: cita } };
    }
    case 'pagopedido': {
      const [folio, ...resta] = partes;
      if (!folio || !/^[a-zA-Z]{1,3}-?\d{1,6}$/.test(folio.trim())) return fallo('pagopedido');
      let importe: number | null = null;
      let metodo: 'transferencia' | 'deposito' | 'efectivo' | null = null;
      let via: 'proveedor' | 'sociedad' | null = null;
      let referencia: string | null = null;
      let fechaTexto: string | null = null;
      for (const seg of resta) {
        const n = normalizar(seg);
        if (n === 'transferencia' || n === 'deposito' || n === 'efectivo') { metodo = n; continue; }
        if (n === 'proveedor' || n === 'sociedad') { via = n; continue; }
        const r = /^(?:ref|referencia|clave)\s+(.+)$/i.exec(seg);
        if (r) { referencia = r[1]!.slice(0, 120); continue; }
        const c = monto(seg);
        if (importe === null && c !== null) { importe = c; continue; }
        fechaTexto = seg.slice(0, 40);
      }
      return { ok: true, tipo: 'intencion', intencion: { tipo: 'pago_pedido_menudeo', pedido_folio: folio.toUpperCase().replace(/^([A-Z]+)-?(\d+)$/, '$1-$2'), monto_centavos: importe, referencia, fecha_texto: fechaTexto, metodo, via, fuente_cita: cita } };
    }
    case 'cuadra':
    case 'balance':
    case 'diario':
    case 'compras':
    case 'pedidos':
      return consulta(nombre);
    case 'socios':
      return consulta('saldos_socios');
    case 'valuacion':
    case 'estamos':
      return consulta('valuacion');
    case 'cierre':
      return consulta('cierre_mensual');
    case 'igualar': {
      const p = normalizar(resto);
      return p === '' ? consulta('valuacion') : p === 'angelo' || p === 'javier' ? consulta('valuacion', { sujeto_texto: p }) : fallo('igualar');
    }
    case 'cobertura':
      return consulta('cobertura', { modelo_texto: resto === '' ? null : resto });
    case 'reporte': {
      const p = normalizar(resto);
      if (p === '') return consulta('reporte', { periodo: 'semana' });
      return p === 'hoy' || p === 'semana' || p === 'mes' ? consulta('reporte', { periodo: p }) : fallo('reporte');
    }
    default:
      return { ok: false, error: 'comando_desconocido', uso: LISTA_COMANDOS };
  }
}
