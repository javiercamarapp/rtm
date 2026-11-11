// Modo sin IA: comandos de Telegram interpretados SOLO con codigo (sin modelo). Producen las mismas intenciones que el extractor,
// de modo que resolucion de alias, calculo, eco y deshacer son identicos con o sin IA.
import { normalizar } from '../catalogo/normalizar';
import { centavosDesdeTexto } from '../dinero';
import {
  TIPOS_GASTO,
  type ILineaCompraTexto,
  type Intencion,
  type LineaPedidoTexto,
  type QuienPaga,
  type SocioNombre,
  type TipoGasto,
} from './intenciones';

export const USO_COMANDOS: Readonly<Record<string, string>> = {
  pedido: '/pedido Cliente | modelo 28 | 24 modelo | envio 150',
  pago: '/pago Cliente | 7000',
  gasto: '/gasto guia 500 angelo',
  aporte: '/aporte javier 1000',
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
  sinia: '/sinia',
  conia: '/conia',
  ayuda: '/ayuda',
};

export const LISTA_COMANDOS = '/pedido, /pago, /gasto, /compra, /stock, /saldo, /deshacer, /resumen, /pendientes';

export type ResultadoComando =
  | { ok: true; tipo: 'intencion'; intencion: Intencion }
  | { ok: true; tipo: 'control'; control: 'sinia' | 'conia' }
  | { ok: false; error: 'comando_desconocido' | 'formato'; uso: string };

const PIEZAS_MIN = 1;
const PIEZAS_MAX = 2000;

function fallo(clave: string): ResultadoComando {
  return { ok: false, error: 'formato', uso: USO_COMANDOS[clave] ?? LISTA_COMANDOS };
}

function monto(texto: string): number | null {
  try {
    const c = centavosDesdeTexto(texto);
    return c > 0n && c <= 100_000_000_00n ? Number(c) : null;
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
      return { ok: true, tipo: 'control', control: nombre };
    case 'pendientes':
      return consulta('pendientes');
    case 'stock':
    case 'inventario':
      return consulta('inventario', { modelo_texto: resto === '' ? null : resto });
    case 'saldo': {
      if (resto === '') return fallo('saldo');
      const n = normalizar(resto);
      const esProveedor = n === 'isaac' || n === 'karen' || n === 'vapemate';
      return consulta(esProveedor ? 'saldo_proveedor' : 'saldo', { sujeto_texto: resto });
    }
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
      for (const seg of segmentos) {
        const e = /^env[ií]o\s+(.+)$/i.exec(seg);
        if (e) {
          envio = monto(e[1]!);
          if (envio === null) return fallo('pedido');
          continue;
        }
        const l = parsearLinea(seg);
        if (!l) return fallo('pedido');
        lineas.push({ modelo_texto: l.modelo, sabor_texto: null, piezas: l.piezas, precio_texto: null, fuente_cita: seg.slice(0, 120) });
      }
      if (lineas.length === 0 || lineas.length > 30) return fallo('pedido');
      return { ok: true, tipo: 'intencion', intencion: { tipo: 'pedido', cliente_texto: cliente, destino_texto: null, lineas, envio_cobrado_centavos: envio, fuente_cita: cita } };
    }
    case 'pago': {
      const [cliente, importe] = partes;
      const c = importe === undefined ? null : monto(importe);
      if (!cliente || c === null) return fallo('pago');
      return { ok: true, tipo: 'intencion', intencion: { tipo: 'pago', cliente_texto: cliente, monto_centavos: c, cuenta_destino_texto: null, pedido_folio: null, fuente_cita: cita } };
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
      const [quien, importe, ...motivo] = resto.split(/\s+/);
      const s = quien === undefined ? null : socio(quien);
      const c = importe === undefined ? null : monto(importe);
      if (s === null || c === null) return fallo('aporte');
      return { ok: true, tipo: 'intencion', intencion: { tipo: 'aportacion', socio: s, monto_centavos: c, motivo: motivo.length ? motivo.join(' ') : null, fuente_cita: cita } };
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
        lineas.push({ modelo_texto: l.modelo, sabor_texto: null, piezas: l.piezas });
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
      return { ok: true, tipo: 'intencion', intencion: { tipo: 'pago_proveedor', proveedor_texto: proveedor, monto_centavos: c, pagado_por: q, cliente_texto: null, fuente_cita: cita } };
    }
    case 'toma': {
      if (partes.length === 0) return fallo('toma');
      const lineas: ILineaCompraTexto[] = [];
      for (const seg of partes) {
        const l = parsearLinea(seg);
        if (!l || l.piezas > 200) return fallo('toma');
        lineas.push({ modelo_texto: l.modelo, sabor_texto: null, piezas: l.piezas });
      }
      return { ok: true, tipo: 'intencion', intencion: { tipo: 'toma_omar', lineas, fuente_cita: cita } };
    }
    default:
      return { ok: false, error: 'comando_desconocido', uso: LISTA_COMANDOS };
  }
}
