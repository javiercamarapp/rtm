// Lo que ve la persona de bodega: que preparar hoy y que llega para guardar. Lista blanca: ningun tipo de este archivo tiene precio, monto, costo,
// margen, saldo, telefono, direccion, nota ni dueno. Solo cliente (nombre), modelo, sabor, piezas, folio, estado de empaque, zona, proveedor, fechas y guia de entrada.

export interface LineaBodega {
  modelo: string;
  sabor: string;
  piezas: number;
}

export interface PedidoPorPreparar {
  folio: string;
  fecha: string;
  deHoy: boolean;
  empacado: boolean;
  /** 'Mérida' o 'Fuera de Mérida' (solo la zona, nunca la direccion). */
  zona: string | null;
  piezas: number;
  lineas: LineaBodega[];
}

export interface ClientePorPreparar {
  cliente: string;
  piezas: number;
  pedidos: PedidoPorPreparar[];
}

export interface Surtido extends LineaBodega {
  existencia: number;
  falta: number;
}

export interface HoyAPreparar {
  fecha: string;
  clientes: ClientePorPreparar[];
  surtido: Surtido[];
  resumen: { pedidos: number; clientes: number; porEmpacar: number; empacados: number; deDiasAnteriores: number; piezas: number };
}

export interface CompraPorRecibir {
  folio: string;
  proveedor: string;
  estado: 'confirmada' | 'enviada' | 'en_trayecto' | 'llego_merida';
  llegadaEstimada: string | null;
  enviadaFecha: string | null;
  diasEnCamino: number | null;
  atrasada: boolean;
  piezas: number;
  guias: { paqueteria: string; numero: string }[];
  lineas: LineaBodega[];
}

export interface Llegadas {
  fecha: string;
  compras: CompraPorRecibir[];
  porGuardar: LineaBodega[];
}

export const ETIQUETA_ESTADO_COMPRA: Record<CompraPorRecibir['estado'], string> = {
  confirmada: 'Confirmada, aún no sale',
  enviada: 'Enviada por el proveedor',
  en_trayecto: 'En camino',
  llego_merida: 'Ya llegó a Mérida: por contar y guardar',
};

type Fila = Record<string, unknown>;
const esFila = (v: unknown): v is Fila => v !== null && typeof v === 'object' && !Array.isArray(v);
const texto = (v: unknown): string => (typeof v === 'string' ? v : '');
const entero = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : 0);
const lista = (v: unknown): Fila[] => (Array.isArray(v) ? v.filter(esFila) : []);
const lineas = (v: unknown): LineaBodega[] => lista(v).map((l) => ({ modelo: texto(l.modelo), sabor: texto(l.sabor), piezas: entero(l.piezas) })).filter((l) => l.modelo !== '' && l.piezas > 0);
const ZONA: Record<string, string> = { merida: 'Mérida', fuera: 'Fuera de Mérida' };

/** Copia SOLO los campos conocidos: una columna de mas en la base (precio, nota, direccion) no cruza esta frontera. */
export function parsearHoy(v: unknown): HoyAPreparar {
  const f = esFila(v) ? v : {};
  const r = esFila(f.resumen) ? f.resumen : {};
  return {
    fecha: texto(f.fecha),
    clientes: lista(f.clientes).map((c) => ({
      cliente: texto(c.cliente), piezas: entero(c.piezas),
      pedidos: lista(c.pedidos).map((p) => ({
        folio: texto(p.folio), fecha: texto(p.fecha), deHoy: p.de_hoy === true, empacado: p.empacado === true,
        zona: ZONA[texto(p.zona)] ?? null, piezas: entero(p.piezas), lineas: lineas(p.lineas),
      })),
    })).filter((c) => c.cliente !== ''),
    surtido: lista(f.surtido).map((s) => ({ modelo: texto(s.modelo), sabor: texto(s.sabor), piezas: entero(s.piezas), existencia: entero(s.existencia), falta: entero(s.falta) })).filter((s) => s.modelo !== ''),
    resumen: { pedidos: entero(r.pedidos), clientes: entero(r.clientes), porEmpacar: entero(r.por_empacar), empacados: entero(r.empacados), deDiasAnteriores: entero(r.de_dias_anteriores), piezas: entero(r.piezas) },
  };
}

const ESTADOS: readonly string[] = ['confirmada', 'enviada', 'en_trayecto', 'llego_merida'];

export function parsearLlegadas(v: unknown): Llegadas {
  const f = esFila(v) ? v : {};
  return {
    fecha: texto(f.fecha),
    compras: lista(f.compras).filter((c) => ESTADOS.includes(texto(c.estado))).map((c) => ({
      folio: texto(c.folio), proveedor: texto(c.proveedor), estado: texto(c.estado) as CompraPorRecibir['estado'],
      llegadaEstimada: texto(c.llegada_estimada) || null, enviadaFecha: texto(c.enviada_fecha) || null,
      diasEnCamino: typeof c.dias_en_camino === 'number' ? Math.trunc(c.dias_en_camino) : null, atrasada: c.atrasada === true,
      piezas: entero(c.piezas),
      guias: lista(c.guias).map((g) => ({ paqueteria: texto(g.paqueteria), numero: texto(g.numero) })).filter((g) => g.numero !== ''),
      lineas: lineas(c.lineas),
    })),
    porGuardar: lineas(f.por_guardar),
  };
}
