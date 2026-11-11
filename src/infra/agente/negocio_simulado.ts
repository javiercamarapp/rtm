// SERVIDOR SIMULADO de negocio para el agente: hace de las funciones SQL que construyen otras olas (pedido, pago, gasto, aportacion,
// compra, orden de compra, toma de Omar, consultas, deshacer). Aqui se CALCULA todo el dinero, con bigint en centavos; el modelo
// de lenguaje nunca lo toca. Datos ILUSTRATIVOS (ningun dato real). Idempotente por clave.
import { centavosDesdeTexto } from '@/dominio/dinero';
import type { IConsulta, Intencion } from '@/dominio/agente/intenciones';
import { contramovimiento, type HechoAplicado } from '@/dominio/agente/deshacer';
import { normalizar } from '@/dominio/catalogo/normalizar';
import type { CifraServidor, Miembro } from '@/dominio/agente/tipos';
import type { EntradaCatalogo } from '@/dominio/agente/resolutor';
import type {
  AccionResuelta,
  ContextoEjecucion,
  DependenciasDeFolio,
  NegocioAgente,
  RespuestaConsulta,
  Resoluciones,
  ResultadoDeshacer,
  ResultadoEjecutado,
  ResultadoNegocio,
  ResultadoTomaResuelta,
  TomaCaducada,
} from '@/aplicacion/agente/puertos';

export interface ModeloFixture {
  id: string;
  nombre: string;
  alias: string[];
  costoCent: bigint;
  existencia: number;
  precioOmarCent?: bigint;
  sabores?: EntradaCatalogo[];
}

export interface ClienteFixture {
  id: string;
  nombre: string;
  alias: string[];
  /** modeloId -> precio de venta (centavos). */
  tabulador: Record<string, bigint>;
}

export const FIXTURE_MODELOS: ModeloFixture[] = [
  { id: 'm1', nombre: 'Waka Icon 50K', alias: [], costoCent: 23500n, existencia: 12 },
  { id: 'm2', nombre: 'Waka Blast 50K', alias: [], costoCent: 23000n, existencia: 30 },
  { id: 'm3', nombre: 'Waka Jupiter 50K', alias: ['jupiter'], costoCent: 23000n, existencia: 100 },
  { id: 'm4', nombre: 'Waka Sopro 30K', alias: ['sopro', 'titan', 'waka 30'], costoCent: 12000n, existencia: 100 },
  { id: 'm8', nombre: 'Nexa 50K', alias: [], costoCent: 13000n, existencia: 500 },
  {
    id: 'm9',
    nombre: 'Elux Legend 3.5K',
    alias: ['elux'],
    costoCent: 6000n,
    existencia: 50,
    precioOmarCent: 15000n,
    sabores: [
      { id: 's1', nombre: 'Sandia', alias: ['sandia ice'] },
      { id: 's2', nombre: 'Mango', alias: [] },
    ],
  },
];

export const FIXTURE_CLIENTES: ClienteFixture[] = [
  { id: 'c1', nombre: 'Cliente Norte', alias: ['el norte', 'norte'], tabulador: { m1: 25000n, m2: 25000n, m3: 25000n, m4: 15000n, m8: 15000n } },
  { id: 'c2', nombre: 'Cliente Sur', alias: ['sur'], tabulador: { m1: 25000n, m2: 25000n, m3: 24000n, m4: 15000n, m8: 14500n } },
  { id: 'c3', nombre: 'Omar Ejemplo', alias: ['ejemplo omar'], tabulador: { m3: 25000n } },
  { id: 'c5', nombre: 'Gemelo Uno', alias: ['gemelo'], tabulador: { m3: 25000n } },
  { id: 'c6', nombre: 'Gemelo Dos', alias: ['gemelo'], tabulador: { m3: 25000n } },
];

const PREFIJO = { P: 'P', PG: 'PG', G: 'G', A: 'A', C: 'C', OC: 'OC', T: 'T', X: 'X' } as const;
type SerieFolio = keyof typeof PREFIJO;

interface Hecho {
  hecho: HechoAplicado;
  autor: Miembro;
  ejecutadoEn: Date;
  clienteId: string | null;
  deshecho: boolean;
  revertir: () => void;
  resultado: ResultadoEjecutado;
}

interface Toma {
  folio: string;
  lineas: Array<{ modeloId: string; piezas: number }>;
  totalCent: bigint;
  solicitadaEn: Date;
  estado: 'pendiente' | 'autorizada' | 'rechazada' | 'caducada';
  reservadas: boolean;
}

const pesos = (etiqueta: string, centavos: bigint): CifraServidor => ({ tipo: 'pesos', etiqueta, centavos });
const piezas = (etiqueta: string, n: number): CifraServidor => ({ tipo: 'piezas', etiqueta, piezas: n });

/** Mismos digitos en otro orden y distinto monto: sospecha de transposicion (spec: monto casi igual a un saldo abierto). */
function esTransposicion(a: bigint, b: bigint): boolean {
  if (a === b || a <= 0n || b <= 0n) return false;
  const x = a.toString().split('').sort().join('');
  const y = b.toString().split('').sort().join('');
  return x === y;
}

export class NegocioSimulado implements NegocioAgente {
  private readonly modelos = new Map<string, ModeloFixture>();
  private readonly clientes = new Map<string, ClienteFixture>();
  private readonly existencia = new Map<string, number>();
  private readonly reservada = new Map<string, number>();
  private readonly cxc = new Map<string, bigint>();
  /** Saldo con cada proveedor: positivo = a favor de la sociedad; negativo = se le debe. */
  private readonly cuentaProveedor = new Map<string, bigint>([['isaac', 0n], ['karen', 0n]]);
  /** Lo que la sociedad debe a cada socio (reembolsos y devolucion de aportaciones). */
  private readonly deudaConSocio = new Map<string, bigint>([['angelo', 0n], ['javier', 0n]]);
  private saldoOmarCent = 0n;
  private readonly contadores: Record<SerieFolio, number> = { P: 0, PG: 0, G: 0, A: 0, C: 0, OC: 0, T: 0, X: 0 };
  private readonly hechos = new Map<string, Hecho>();
  private readonly porClave = new Map<string, ResultadoEjecutado>();
  private readonly deshechosPorClave = new Map<string, ResultadoDeshacer>();
  private readonly tomas = new Map<string, Toma>();
  private readonly tomasPorClave = new Map<string, ResultadoTomaResuelta>();
  readonly aplicaciones: string[] = [];

  constructor(modelos: ModeloFixture[] = FIXTURE_MODELOS, clientes: ClienteFixture[] = FIXTURE_CLIENTES) {
    for (const m of modelos) {
      this.modelos.set(m.id, m);
      this.existencia.set(m.id, m.existencia);
    }
    for (const c of clientes) {
      this.clientes.set(c.id, c);
      this.cxc.set(c.id, 0n);
    }
  }

  // ---- lectura para pruebas
  existenciaDe(modeloId: string): number {
    return this.existencia.get(modeloId) ?? 0;
  }
  disponibleDe(modeloId: string): number {
    return this.existenciaDe(modeloId) - (this.reservada.get(modeloId) ?? 0);
  }
  saldoCliente(clienteId: string): bigint {
    return this.cxc.get(clienteId) ?? 0n;
  }
  cuentaCon(proveedor: 'isaac' | 'karen'): bigint {
    return this.cuentaProveedor.get(proveedor) ?? 0n;
  }
  ponerSaldoProveedor(proveedor: 'isaac' | 'karen', centavos: bigint): void {
    this.cuentaProveedor.set(proveedor, centavos);
  }
  deudaCon(socio: 'angelo' | 'javier'): bigint {
    return this.deudaConSocio.get(socio) ?? 0n;
  }
  saldoOmar(): bigint {
    return this.saldoOmarCent;
  }
  estadoToma(folio: string): Toma['estado'] | null {
    return this.tomas.get(folio)?.estado ?? null;
  }
  numeroDeHechos(): number {
    return this.hechos.size;
  }
  catalogoClientes(): EntradaCatalogo[] {
    return [...this.clientes.values()].map((c) => ({ id: c.id, nombre: c.nombre, alias: c.alias }));
  }
  catalogoModelos(): EntradaCatalogo[] {
    return [...this.modelos.values()].map((m) => ({ id: m.id, nombre: m.nombre, alias: m.alias }));
  }
  saboresDe(modeloId: string): EntradaCatalogo[] {
    return this.modelos.get(modeloId)?.sabores ?? [];
  }

  private folio(serie: SerieFolio): string {
    this.contadores[serie]++;
    return `${PREFIJO[serie]}-${String(this.contadores[serie]).padStart(4, '0')}`;
  }

  private nombreModelo(id: string): string {
    return this.modelos.get(id)?.nombre ?? id;
  }

  // ---- escritura

  async ejecutar(a: AccionResuelta, ctx: ContextoEjecucion): Promise<ResultadoNegocio> {
    const previo = this.porClave.get(ctx.claveIdem);
    if (previo) return { ...previo, repetido: true };
    const tomaPrevia = [...this.tomas.values()].find((t) => this.tomaClave.get(t.folio) === ctx.claveIdem);
    if (tomaPrevia) {
      return { tipo: 'toma_pendiente', folio: tomaPrevia.folio, titulo: 'Toma de la bodega de Omar', lineas: this.lineasToma(tomaPrevia), resumen: [pesos('Total a su precio', tomaPrevia.totalCent)] };
    }
    const i = a.intencion;
    switch (i.tipo) {
      case 'pedido':
        return this.pedido(i, a.resoluciones, ctx);
      case 'pago':
        return this.pago(i, a.resoluciones, ctx);
      case 'pago_proveedor':
        return this.pagoProveedor(i, a.resoluciones, ctx);
      case 'gasto':
        return this.gasto(i, ctx);
      case 'aportacion':
        return this.aportacion(i, ctx);
      case 'compra':
        return this.compra(i, a.resoluciones, ctx);
      case 'orden_compra':
        return this.ordenCompra(i, a.resoluciones, ctx);
      case 'toma_omar':
        return this.toma(i, a.resoluciones, ctx);
      default:
        return { tipo: 'rechazado', codigo: 'intencion_no_ejecutable', texto: 'Esa indicacion no se ejecuta aqui.' };
    }
  }

  private readonly tomaClave = new Map<string, string>();

  private registrar(entrada: {
    serie: SerieFolio;
    tipo: string;
    ctx: ContextoEjecucion;
    titulo: string;
    lineas: CifraServidor[];
    comprobacion?: CifraServidor[];
    saldos?: CifraServidor[];
    advertencias?: string[];
    clienteId?: string | null;
    detalle: HechoAplicado['lineas'];
    revertir: () => void;
  }): ResultadoEjecutado {
    const folio = this.folio(entrada.serie);
    const resultado: ResultadoEjecutado = {
      tipo: 'ejecutado',
      folio,
      titulo: entrada.titulo,
      lineas: entrada.lineas,
      comprobacion: entrada.comprobacion ?? [],
      saldos: entrada.saldos ?? [],
      advertencias: entrada.advertencias ?? [],
      ejecutadoEn: entrada.ctx.ahora,
      repetido: false,
    };
    this.hechos.set(folio, {
      hecho: { folio, tipo: entrada.tipo, lineas: entrada.detalle, claveIdem: entrada.ctx.claveIdem, corrigeFolio: null },
      autor: entrada.ctx.autor,
      ejecutadoEn: entrada.ctx.ahora,
      clienteId: entrada.clienteId ?? null,
      deshecho: false,
      revertir: entrada.revertir,
      resultado,
    });
    this.porClave.set(entrada.ctx.claveIdem, resultado);
    this.aplicaciones.push(`${entrada.tipo}:${folio}`);
    return resultado;
  }

  private pedido(i: Extract<Intencion, { tipo: 'pedido' }>, r: Resoluciones, ctx: ContextoEjecucion): ResultadoNegocio {
    const cliente = this.clientes.get(r.clienteId ?? '');
    if (!cliente) return { tipo: 'rechazado', codigo: 'cliente_desconocido', texto: 'Cliente desconocido.' };
    const lineas: CifraServidor[] = [];
    const detalle: HechoAplicado['lineas'] = [];
    let total = 0n;
    let totalPiezas = 0;
    const salidas: Array<{ modeloId: string; n: number }> = [];
    for (let k = 0; k < i.lineas.length; k++) {
      const l = i.lineas[k]!;
      const modeloId = r.lineas[k]!.modeloId;
      const precio = cliente.tabulador[modeloId];
      if (precio === undefined) {
        return { tipo: 'rechazado', codigo: 'sin_precio', texto: `${cliente.nombre} no tiene precio para ${this.nombreModelo(modeloId)}: cotizalo y se guarda.` };
      }
      if (l.precio_texto !== null && !ctx.confirmado) {
        let dicho: bigint | null;
        try {
          dicho = centavosDesdeTexto(l.precio_texto.replace(/[^\d.,]/g, ''));
        } catch {
          dicho = null;
        }
        if (dicho !== null && dicho !== precio) {
          return { tipo: 'pregunta', motivo: 'precio_fuera_tabulador', texto: `El precio dicho para ${this.nombreModelo(modeloId)} no es el del tabulador.`, cifras: [pesos('Precio dicho', dicho), pesos('Precio del tabulador', precio)] };
        }
      }
      if (l.piezas > this.disponibleDe(modeloId) && !ctx.confirmado) {
        return { tipo: 'pregunta', motivo: 'existencia_insuficiente', texto: `No hay existencia suficiente de ${this.nombreModelo(modeloId)}.`, cifras: [piezas('Disponible', this.disponibleDe(modeloId)), piezas('Pedidas', l.piezas)] };
      }
      const sub = precio * BigInt(l.piezas);
      total += sub;
      totalPiezas += l.piezas;
      salidas.push({ modeloId, n: l.piezas });
      lineas.push(pesos(`${this.nombreModelo(modeloId)}, ${l.piezas} pz x ${precio / 100n}`, sub));
      detalle.push({ concepto: this.nombreModelo(modeloId), piezas: -l.piezas, centavos: sub });
    }
    if (totalPiezas < 20 && !ctx.confirmado) {
      return { tipo: 'pregunta', motivo: 'menos_de_20_piezas', texto: 'El pedido es de menos de 20 piezas.', cifras: [piezas('Piezas del pedido', totalPiezas)] };
    }
    const envio = BigInt(i.envio_cobrado_centavos ?? 0);
    const totalConEnvio = total + envio;
    for (const s of salidas) this.existencia.set(s.modeloId, this.existenciaDe(s.modeloId) - s.n);
    this.cxc.set(cliente.id, this.saldoCliente(cliente.id) + totalConEnvio);
    if (envio > 0n) lineas.push(pesos('Envio cobrado', envio));
    lineas.push(pesos('Total', totalConEnvio));
    return this.registrar({
      serie: 'P',
      tipo: 'pedido',
      ctx,
      titulo: `Pedido de ${cliente.nombre}`,
      lineas,
      comprobacion: [piezas('Piezas por modelo (suma)', totalPiezas), pesos('Piezas x precio (suma)', total)],
      saldos: [pesos(`Saldo de ${cliente.nombre}`, this.saldoCliente(cliente.id))],
      clienteId: cliente.id,
      detalle,
      revertir: () => {
        for (const s of salidas) this.existencia.set(s.modeloId, this.existenciaDe(s.modeloId) + s.n);
        this.cxc.set(cliente.id, this.saldoCliente(cliente.id) - totalConEnvio);
      },
    });
  }

  private pago(i: Extract<Intencion, { tipo: 'pago' }>, r: Resoluciones, ctx: ContextoEjecucion): ResultadoNegocio {
    const cliente = this.clientes.get(r.clienteId ?? '');
    if (!cliente) return { tipo: 'rechazado', codigo: 'cliente_desconocido', texto: 'Cliente desconocido.' };
    const monto = BigInt(i.monto_centavos);
    const saldo = this.saldoCliente(cliente.id);
    if (esTransposicion(monto, saldo) && !ctx.confirmado) {
      return { tipo: 'pregunta', motivo: 'monto_parecido_a_saldo', texto: 'El monto se parece al saldo abierto con digitos en otro orden.', cifras: [pesos('Monto dicho', monto), pesos('Saldo abierto', saldo)] };
    }
    this.cxc.set(cliente.id, saldo - monto);
    return this.registrar({
      serie: 'PG',
      tipo: 'pago',
      ctx,
      titulo: `Pago de ${cliente.nombre}`,
      lineas: [pesos('Pago recibido', monto)],
      saldos: [pesos(`Saldo de ${cliente.nombre}`, saldo - monto)],
      clienteId: cliente.id,
      detalle: [{ concepto: 'pago', piezas: 0, centavos: monto }],
      revertir: () => this.cxc.set(cliente.id, this.saldoCliente(cliente.id) + monto),
    });
  }

  private pagoProveedor(i: Extract<Intencion, { tipo: 'pago_proveedor' }>, r: Resoluciones, ctx: ContextoEjecucion): ResultadoNegocio {
    const prov = r.proveedorId;
    if (!prov) return { tipo: 'rechazado', codigo: 'proveedor_desconocido', texto: 'Proveedor desconocido.' };
    const monto = BigInt(i.monto_centavos);
    const cliente = r.clienteId ? this.clientes.get(r.clienteId) : undefined;
    this.cuentaProveedor.set(prov, this.cuentaCon(prov) + monto);
    if (cliente) this.cxc.set(cliente.id, this.saldoCliente(cliente.id) - monto);
    const nombre = prov === 'karen' ? 'Karen' : 'Isaac';
    const saldo = this.cuentaCon(prov);
    return this.registrar({
      serie: 'PG',
      tipo: 'pago_proveedor',
      ctx,
      titulo: `Pago a ${nombre}`,
      lineas: [pesos(`Pago a ${nombre}`, monto)],
      saldos: [pesos(`Cuenta con ${nombre} (${saldo >= 0n ? 'a favor' : 'se debe'})`, saldo)],
      clienteId: cliente?.id ?? null,
      detalle: [{ concepto: `pago_${prov}`, piezas: 0, centavos: monto }],
      revertir: () => {
        this.cuentaProveedor.set(prov, this.cuentaCon(prov) - monto);
        if (cliente) this.cxc.set(cliente.id, this.saldoCliente(cliente.id) + monto);
      },
    });
  }

  private gasto(i: Extract<Intencion, { tipo: 'gasto' }>, ctx: ContextoEjecucion): ResultadoNegocio {
    const monto = BigInt(i.monto_centavos);
    const socio = i.pagado_por === 'sociedad' ? null : i.pagado_por;
    if (socio) this.deudaConSocio.set(socio, this.deudaCon(socio) + monto);
    return this.registrar({
      serie: 'G',
      tipo: 'gasto',
      ctx,
      titulo: `Gasto: ${i.gasto}`,
      lineas: [pesos('Gasto', monto)],
      saldos: socio ? [pesos(`Reembolso pendiente a ${socio}`, this.deudaCon(socio))] : [],
      detalle: [{ concepto: `gasto_${i.gasto}`, piezas: 0, centavos: monto }],
      revertir: () => {
        if (socio) this.deudaConSocio.set(socio, this.deudaCon(socio) - monto);
      },
    });
  }

  private aportacion(i: Extract<Intencion, { tipo: 'aportacion' }>, ctx: ContextoEjecucion): ResultadoNegocio {
    const monto = BigInt(i.monto_centavos);
    this.deudaConSocio.set(i.socio, this.deudaCon(i.socio) + monto);
    return this.registrar({
      serie: 'A',
      tipo: 'aportacion',
      ctx,
      titulo: `Aportacion de capital de ${i.socio}`,
      lineas: [pesos('Aportacion', monto)],
      saldos: [pesos(`Por devolver a ${i.socio}`, this.deudaCon(i.socio))],
      detalle: [{ concepto: 'aportacion', piezas: 0, centavos: monto }],
      revertir: () => this.deudaConSocio.set(i.socio, this.deudaCon(i.socio) - monto),
    });
  }

  private compra(i: Extract<Intencion, { tipo: 'compra' }>, r: Resoluciones, ctx: ContextoEjecucion): ResultadoNegocio {
    const prov = r.proveedorId;
    if (!prov) return { tipo: 'rechazado', codigo: 'proveedor_desconocido', texto: 'Proveedor desconocido.' };
    const lineas: CifraServidor[] = [];
    const entradas: Array<{ modeloId: string; n: number }> = [];
    let total = 0n;
    for (let k = 0; k < i.lineas.length; k++) {
      const modeloId = r.lineas[k]!.modeloId;
      const costo = this.modelos.get(modeloId)?.costoCent ?? 0n;
      const sub = costo * BigInt(i.lineas[k]!.piezas);
      total += sub;
      entradas.push({ modeloId, n: i.lineas[k]!.piezas });
      lineas.push(pesos(`${this.nombreModelo(modeloId)}, ${i.lineas[k]!.piezas} pz`, sub));
    }
    const guia = BigInt(i.guia_centavos ?? 0);
    total += guia;
    for (const e of entradas) this.existencia.set(e.modeloId, this.existenciaDe(e.modeloId) + e.n);
    this.cuentaProveedor.set(prov, this.cuentaCon(prov) - total);
    if (guia > 0n) lineas.push(pesos('Guia', guia));
    lineas.push(pesos('Total de la compra', total));
    return this.registrar({
      serie: 'C',
      tipo: 'compra',
      ctx,
      titulo: `Compra a ${prov === 'karen' ? 'Karen' : 'Isaac'}`,
      lineas,
      saldos: [pesos('Cuenta con el proveedor', this.cuentaCon(prov))],
      detalle: entradas.map((e) => ({ concepto: this.nombreModelo(e.modeloId), piezas: e.n, centavos: 0n })).concat([{ concepto: 'total', piezas: 0, centavos: total }]),
      revertir: () => {
        for (const e of entradas) this.existencia.set(e.modeloId, this.existenciaDe(e.modeloId) - e.n);
        this.cuentaProveedor.set(prov, this.cuentaCon(prov) + total);
      },
    });
  }

  /** Adenda 23: la OC lleva el costo vigente, descuenta primero el saldo a favor y lo que falta deja la cuenta en negativo. */
  private ordenCompra(i: Extract<Intencion, { tipo: 'orden_compra' }>, r: Resoluciones, ctx: ContextoEjecucion): ResultadoNegocio {
    const prov = r.proveedorId;
    if (!prov) return { tipo: 'rechazado', codigo: 'proveedor_desconocido', texto: 'Proveedor desconocido.' };
    const lineas: CifraServidor[] = [];
    let total = 0n;
    for (let k = 0; k < i.lineas.length; k++) {
      const modeloId = r.lineas[k]!.modeloId;
      const costo = this.modelos.get(modeloId)?.costoCent ?? 0n;
      const sub = costo * BigInt(i.lineas[k]!.piezas);
      total += sub;
      lineas.push(pesos(`${this.nombreModelo(modeloId)}, ${i.lineas[k]!.piezas} pz x ${costo / 100n}`, sub));
    }
    lineas.push(pesos('Total de la orden', total));
    const antes = this.cuentaCon(prov);
    const aFavor = antes > 0n ? antes : 0n;
    const aplicado = i.aplicar_saldo ? (aFavor < total ? aFavor : total) : 0n;
    const despues = i.aplicar_saldo ? antes - total : antes;
    this.cuentaProveedor.set(prov, despues);
    const advertencias: string[] = [];
    if (prov === 'karen' && i.aplicar_saldo && despues < 0n) advertencias.push('Karen exige pago completo antes de enviar: la orden queda en borrador.');
    return this.registrar({
      serie: 'OC',
      tipo: 'orden_compra',
      ctx,
      titulo: `Orden de compra a ${prov === 'karen' ? 'Karen' : 'Isaac'}`,
      lineas: [...lineas, pesos('Saldo a favor aplicado', aplicado)],
      saldos: [pesos(`Cuenta con el proveedor (${despues >= 0n ? 'a favor' : 'se debe'})`, despues)],
      advertencias,
      detalle: [{ concepto: 'orden_compra', piezas: 0, centavos: total }],
      revertir: () => this.cuentaProveedor.set(prov, antes),
    });
  }

  private lineasToma(t: Toma): CifraServidor[] {
    return t.lineas.map((l) => piezas(this.nombreModelo(l.modeloId), l.piezas));
  }

  private toma(i: Extract<Intencion, { tipo: 'toma_omar' }>, r: Resoluciones, ctx: ContextoEjecucion): ResultadoNegocio {
    const lineas: Toma['lineas'] = [];
    let total = 0n;
    for (let k = 0; k < i.lineas.length; k++) {
      const modeloId = r.lineas[k]!.modeloId;
      const m = this.modelos.get(modeloId);
      const n = i.lineas[k]!.piezas;
      if (!m || m.precioOmarCent === undefined) return { tipo: 'rechazado', codigo: 'sin_precio_omar', texto: 'Ese modelo no esta en la lista de la bodega.' };
      if (n > this.disponibleDe(modeloId)) return { tipo: 'rechazado', codigo: 'sin_existencia', texto: 'No hay existencia suficiente para esa toma.' };
      lineas.push({ modeloId, piezas: n });
      total += m.precioOmarCent * BigInt(n);
    }
    // Pendiente = reserva activa, sin kardex ni saldo.
    for (const l of lineas) this.reservada.set(l.modeloId, (this.reservada.get(l.modeloId) ?? 0) + l.piezas);
    const folio = this.folio('T');
    const toma: Toma = { folio, lineas, totalCent: total, solicitadaEn: ctx.ahora, estado: 'pendiente', reservadas: true };
    this.tomas.set(folio, toma);
    this.tomaClave.set(folio, ctx.claveIdem);
    return { tipo: 'toma_pendiente', folio, titulo: 'Toma de la bodega de Omar', lineas: this.lineasToma(toma), resumen: [pesos('Total a su precio', total), pesos('Saldo de Omar si se autoriza', this.saldoOmarCent + total)] };
  }

  async autorizarToma(e: { folio: string; socio: Miembro; autorizar: boolean; claveIdem: string }): Promise<ResultadoTomaResuelta> {
    const previa = this.tomasPorClave.get(e.claveIdem);
    if (previa) return previa.tipo === 'resuelta' ? { ...previa, repetido: true } : previa;
    const t = this.tomas.get(e.folio);
    if (!t) return { tipo: 'no_encontrada' };
    if (t.estado !== 'pendiente') return { tipo: 'ya_resuelta', folio: t.folio, estado: t.estado };
    this.liberarReserva(t);
    if (e.autorizar) {
      for (const l of t.lineas) this.existencia.set(l.modeloId, this.existenciaDe(l.modeloId) - l.piezas);
      this.saldoOmarCent += t.totalCent;
      t.estado = 'autorizada';
    } else {
      t.estado = 'rechazada';
    }
    const res: ResultadoTomaResuelta = {
      tipo: 'resuelta',
      folio: t.folio,
      estado: t.estado,
      lineas: this.lineasToma(t),
      saldoSemanal: e.autorizar ? pesos('Saldo semanal', this.saldoOmarCent) : null,
      repetido: false,
    };
    this.tomasPorClave.set(e.claveIdem, res);
    return res;
  }

  private liberarReserva(t: Toma): void {
    if (!t.reservadas) return;
    for (const l of t.lineas) this.reservada.set(l.modeloId, (this.reservada.get(l.modeloId) ?? 0) - l.piezas);
    t.reservadas = false;
  }

  async caducarTomas(ahora: Date, horas: number): Promise<TomaCaducada[]> {
    const salida: TomaCaducada[] = [];
    for (const t of this.tomas.values()) {
      if (t.estado === 'pendiente' && ahora.getTime() - t.solicitadaEn.getTime() >= horas * 3_600_000) {
        t.estado = 'caducada';
        this.liberarReserva(t);
        salida.push({ folio: t.folio, lineas: this.lineasToma(t) });
      }
    }
    return salida;
  }

  // ---- consultas

  async consultar(c: IConsulta, r: Resoluciones, autor: Miembro): Promise<RespuestaConsulta> {
    switch (c.consulta) {
      case 'inventario': {
        const ids = r.modeloId ? [r.modeloId] : [...this.modelos.keys()];
        return { titulo: 'Existencia', lineas: ids.map((id) => piezas(this.nombreModelo(id), this.disponibleDe(id))) };
      }
      case 'saldo': {
        const sujeto = c.sujeto_texto === null ? '' : normalizar(c.sujeto_texto);
        if (sujeto === 'omar' || (sujeto === '' && autor.rol === 'omar')) return { titulo: 'Saldo de la semana', lineas: [pesos('Saldo semanal', this.saldoOmarCent)] };
        if (r.clienteId) return { titulo: 'Saldo del cliente', lineas: [pesos('Saldo abierto', this.saldoCliente(r.clienteId))] };
        if (sujeto === 'socios') {
          return { titulo: 'Cuenta con los socios', lineas: [pesos('Por devolver a Angelo', this.deudaCon('angelo')), pesos('Por devolver a Javier', this.deudaCon('javier'))] };
        }
        return { titulo: 'Saldo', lineas: [] };
      }
      case 'saldo_proveedor': {
        const p = normalizar(c.sujeto_texto ?? '') === 'isaac' ? 'isaac' : 'karen';
        const s = this.cuentaCon(p);
        return { titulo: `Cuenta con ${p === 'karen' ? 'Karen' : 'Isaac'}`, lineas: [pesos(s >= 0n ? 'A favor' : 'Se debe', s)] };
      }
      case 'precio': {
        const cli = r.clienteId ? this.clientes.get(r.clienteId) : undefined;
        if (!cli || !r.modeloId) return { titulo: 'Precio', lineas: [] };
        const precio = cli.tabulador[r.modeloId];
        return { titulo: `Precio de ${cli.nombre}`, lineas: precio === undefined ? [] : [pesos(this.nombreModelo(r.modeloId), precio)] };
      }
      case 'pendientes': {
        const n = [...this.tomas.values()].filter((t) => t.estado === 'pendiente').length;
        return { titulo: 'Pendientes', lineas: [piezas('Tomas por autorizar', n)] };
      }
      default:
        return { titulo: 'Consulta no disponible todavia', lineas: [] };
    }
  }

  // ---- deshacer

  async localizarParaDeshacer(autor: Miembro, folio: string | null): Promise<{ folio: string; ejecutadoEn: Date } | null> {
    if (folio) {
      const h = this.hechos.get(folio);
      return h && !h.deshecho ? { folio: h.hecho.folio, ejecutadoEn: h.ejecutadoEn } : null;
    }
    const mios = [...this.hechos.values()].filter((h) => h.autor.telegramUserId === autor.telegramUserId && !h.deshecho && h.hecho.corrigeFolio === null);
    const ultimo = mios[mios.length - 1];
    return ultimo ? { folio: ultimo.hecho.folio, ejecutadoEn: ultimo.ejecutadoEn } : null;
  }

  async dependenciasDe(folio: string): Promise<DependenciasDeFolio> {
    const h = this.hechos.get(folio);
    if (!h || h.hecho.tipo !== 'pedido' || !h.clienteId) return { cantidad: 0, descripcion: [] };
    const orden = [...this.hechos.keys()];
    const idx = orden.indexOf(folio);
    const pagos = orden.slice(idx + 1).filter((f) => {
      const x = this.hechos.get(f)!;
      return x.hecho.tipo === 'pago' && x.clienteId === h.clienteId && !x.deshecho;
    });
    return { cantidad: pagos.length, descripcion: pagos.map((f) => ({ tipo: 'folio' as const, etiqueta: 'Pago aplicado despues', folio: f })) };
  }

  async deshacer(e: { folio: string; autor: Miembro; claveIdem: string }): Promise<ResultadoDeshacer> {
    const previo = this.deshechosPorClave.get(e.claveIdem);
    if (previo) return previo.tipo === 'deshecho' ? { ...previo, repetido: true } : previo;
    const h = this.hechos.get(e.folio);
    if (!h) return { tipo: 'rechazado', codigo: 'no_existe', texto: 'No existe ese folio.' };
    if (h.deshecho) return { tipo: 'rechazado', codigo: 'ya_deshecho', texto: `El folio ${e.folio} ya estaba deshecho.` };
    const importe = h.hecho.lineas.reduce((acc, l) => acc + (l.centavos < 0n ? -l.centavos : l.centavos), 0n);
    const folioContra = this.folio('X');
    const contra = contramovimiento(h.hecho, folioContra, e.claveIdem);
    h.revertir();
    h.deshecho = true;
    this.hechos.set(folioContra, { ...h, hecho: contra, deshecho: false, revertir: () => undefined });
    this.aplicaciones.push(`${contra.tipo}:${folioContra}`);
    const res: ResultadoDeshacer = {
      tipo: 'deshecho',
      folioContra,
      titulo: `Contramovimiento de ${e.folio}`,
      lineas: [pesos('Importe revertido', importe)],
      repetido: false,
    };
    this.deshechosPorClave.set(e.claveIdem, res);
    return res;
  }
}
