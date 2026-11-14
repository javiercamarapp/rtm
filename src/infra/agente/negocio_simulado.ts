// SERVIDOR SIMULADO de negocio para el agente: hace de las funciones SQL que construyen otras olas (pedido, pago, gasto, aportacion,
// compra, orden de compra, toma de Omar, consultas, deshacer). Aqui se CALCULA todo el dinero, con bigint en centavos; el modelo
// de lenguaje nunca lo toca. Datos ILUSTRATIVOS (ningun dato real). Idempotente por clave.
import { formatearMoneda } from '@/dominio/formato';
import { respuestaValuacionAgente, type VistaValuacionAgente } from '@/dominio/socios/valuacion';
import { centavosDesdeTexto } from '@/dominio/dinero';
import type { IConsulta, Intencion } from '@/dominio/agente/intenciones';
import { contramovimiento, type HechoAplicado } from '@/dominio/agente/deshacer';
import { normalizar } from '@/dominio/catalogo/normalizar';
import type { CifraServidor, Miembro } from '@/dominio/agente/tipos';
import { formatearFechaPago } from '@/dominio/agente/fecha_pago';
import { ErrorMenudeoSim, MenudeoSimulado, type PedidoMenudeoSim } from './menudeo_simulado';
import type { EntradaCatalogo } from '@/dominio/agente/resolutor';
import type {
  AccionResuelta,
  ContextoEjecucion,
  DependenciasDeFolio,
  Igualacion,
  NegocioAgente,
  RecordatorioMenudeo,
  RespuestaConsulta,
  Resoluciones,
  ResultadoDeshacer,
  ResultadoEjecutado,
  ResultadoNegocio,
  ResultadoTomaResuelta,
  TipoRecordatorio,
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

const PREFIJO = { P: 'P', PG: 'PG', G: 'G', A: 'A', C: 'C', OC: 'OC', T: 'T', X: 'X', R: 'R', D: 'D', K: 'K' } as const;
type SerieFolio = keyof typeof PREFIJO;

interface Hecho {
  hecho: HechoAplicado;
  autor: Miembro;
  ejecutadoEn: Date;
  clienteId: string | null;
  /** Efecto del hecho en la utilidad operativa (centavos, con signo). */
  utilidadCent: bigint;
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
  private readonly contadores: Record<SerieFolio, number> = { P: 0, PG: 0, G: 0, A: 0, C: 0, OC: 0, T: 0, X: 0, R: 0, D: 0, K: 0 };
  /** Capital declarado por cada socio (no es deuda: se devuelve por la cascada, no por reembolso). */
  private readonly capitalSocio = new Map<string, bigint>([['angelo', 0n], ['javier', 0n]]);
  private readonly reembolsadoSocio = new Map<string, bigint>([['angelo', 0n], ['javier', 0n]]);
  private readonly retiradoSocio = new Map<string, bigint>([['angelo', 0n], ['javier', 0n]]);
  /** Utilidad que la cascada ya le asigno a cada socio y todavia no retira (la fija la prueba: el agente no la calcula). */
  private readonly utilidadAsignada = new Map<string, bigint>([['angelo', 0n], ['javier', 0n]]);
  /** Dependencias de otras ramas: mientras sean false, devolucion y paquete perdido responden "dependencia pendiente" y no registran nada. */
  readonly dependencias = { devolucion: false, paquete: false };
  readonly incidentes: Array<{ folio: string; pedido: string; incidente: string }> = [];
  private readonly hechos = new Map<string, Hecho>();
  private readonly porClave = new Map<string, ResultadoEjecutado>();
  private readonly deshechosPorClave = new Map<string, ResultadoDeshacer>();
  private readonly tomas = new Map<string, Toma>();
  private readonly tomasPorClave = new Map<string, ResultadoTomaResuelta>();
  readonly aplicaciones: string[] = [];
  /** Menudeo del socio (espejo de operacion.ds_*): pedidos a costo, avisos de pago, decision del otro socio y recordatorios. */
  readonly menudeo = new MenudeoSimulado();
  /** Comprobantes de Telegram (solo huella): los cablea la composicion en memoria. Sin cablear, nunca hay comprobante. */
  evidencia: { pendiente(telegramUserId: number): number | null; usar(id: number): void } | null = null;

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
  capitalDe(socio: 'angelo' | 'javier'): bigint {
    return this.capitalSocio.get(socio) ?? 0n;
  }
  reembolsadoA(socio: 'angelo' | 'javier'): bigint {
    return this.reembolsadoSocio.get(socio) ?? 0n;
  }
  retiradoPor(socio: 'angelo' | 'javier'): bigint {
    return this.retiradoSocio.get(socio) ?? 0n;
  }
  ponerUtilidadAsignada(socio: 'angelo' | 'javier', centavos: bigint): void {
    this.utilidadAsignada.set(socio, centavos);
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
      case 'reembolso_socio':
        return this.reembolsoSocio(i, ctx);
      case 'retiro_utilidad':
        return this.retiroUtilidad(i, ctx);
      case 'devolucion':
        return this.devolucion(i, a.resoluciones, ctx);
      case 'paquete_perdido':
        return this.paquetePerdido(i, ctx);
      case 'compra':
        return this.compra(i, a.resoluciones, ctx);
      case 'orden_compra':
        return this.ordenCompra(i, a.resoluciones, ctx);
      case 'toma_omar':
        return this.toma(i, a.resoluciones, ctx);
      case 'pedido_menudeo':
        return this.pedidoMenudeo(i, a.resoluciones, ctx);
      case 'pago_pedido_menudeo':
        return this.pagoPedidoMenudeo(i, ctx);
      case 'pedido_envio':
        if (this.menudeo.porFolio(i.pedido_folio)) return this.envioMenudeo(i, ctx);
        return { tipo: 'rechazado', codigo: 'intencion_no_ejecutable', texto: 'Esa indicacion no se ejecuta aqui.' };
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
    utilidad?: bigint;
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
      utilidadCent: entrada.utilidad ?? 0n,
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
    let utilidad = 0n;
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
      utilidad += (precio - (this.modelos.get(modeloId)?.costoCent ?? 0n)) * BigInt(l.piezas);
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
      utilidad,
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
      utilidad: -monto,
      detalle: [{ concepto: `gasto_${i.gasto}`, piezas: 0, centavos: monto }],
      revertir: () => {
        if (socio) this.deudaConSocio.set(socio, this.deudaCon(socio) - monto);
      },
    });
  }

  private aportacion(i: Extract<Intencion, { tipo: 'aportacion' }>, ctx: ContextoEjecucion): ResultadoNegocio {
    const monto = BigInt(i.monto_centavos);
    // Adenda 32: es capital solo si el socio lo declaro; todo lo demas es reembolso (cuenta por pagar al socio).
    if (i.intencion === 'capital') {
      this.capitalSocio.set(i.socio, this.capitalDe(i.socio) + monto);
      return this.registrar({
        serie: 'A',
        tipo: 'aportacion',
        ctx,
        titulo: `Aportacion de capital de ${i.socio}`,
        lineas: [pesos('Aportacion de capital', monto)],
        saldos: [pesos(`Capital aportado por ${i.socio}`, this.capitalDe(i.socio))],
        detalle: [{ concepto: 'aportacion_capital', piezas: 0, centavos: monto }],
        revertir: () => this.capitalSocio.set(i.socio, this.capitalDe(i.socio) - monto),
      });
    }
    this.deudaConSocio.set(i.socio, this.deudaCon(i.socio) + monto);
    return this.registrar({
      serie: 'A',
      tipo: 'aportacion',
      ctx,
      titulo: `Deposito de ${i.socio} como reembolso`,
      lineas: [pesos('Deposito', monto)],
      saldos: [pesos(`Por devolver a ${i.socio}`, this.deudaCon(i.socio))],
      detalle: [{ concepto: 'aportacion_reembolso', piezas: 0, centavos: monto }],
      revertir: () => this.deudaConSocio.set(i.socio, this.deudaCon(i.socio) - monto),
    });
  }

  /** Espejo de operacion.registrar_pago_a_socio(tipo reembolso): no puede exceder lo pendiente (23514). */
  private reembolsoSocio(i: Extract<Intencion, { tipo: 'reembolso_socio' }>, ctx: ContextoEjecucion): ResultadoNegocio {
    const monto = BigInt(i.monto_centavos);
    const pendiente = this.deudaCon(i.socio);
    if (monto > pendiente) {
      return { tipo: 'rechazado', codigo: '23514', texto: 'El reembolso excede lo que la sociedad le debe a ese socio.' };
    }
    this.deudaConSocio.set(i.socio, pendiente - monto);
    this.reembolsadoSocio.set(i.socio, this.reembolsadoA(i.socio) + monto);
    return this.registrar({
      serie: 'R',
      tipo: 'reembolso_socio',
      ctx,
      titulo: `Reembolso a ${i.socio}`,
      lineas: [pesos('Reembolso pagado', monto)],
      saldos: [pesos(`Reembolso pendiente a ${i.socio}`, pendiente - monto)],
      detalle: [{ concepto: 'reembolso_socio', piezas: 0, centavos: monto }],
      revertir: () => {
        this.deudaConSocio.set(i.socio, this.deudaCon(i.socio) + monto);
        this.reembolsadoSocio.set(i.socio, this.reembolsadoA(i.socio) - monto);
      },
    });
  }

  /** Espejo de registrar_pago_a_socio(tipo retiro): solo sale de la utilidad ya asignada (H10). */
  private retiroUtilidad(i: Extract<Intencion, { tipo: 'retiro_utilidad' }>, ctx: ContextoEjecucion): ResultadoNegocio {
    const monto = BigInt(i.monto_centavos);
    const asignada = this.utilidadAsignada.get(i.socio) ?? 0n;
    if (monto > asignada) {
      return { tipo: 'rechazado', codigo: '23514', texto: 'El retiro excede la utilidad que ya se le asigno a ese socio.' };
    }
    this.utilidadAsignada.set(i.socio, asignada - monto);
    this.retiradoSocio.set(i.socio, this.retiradoPor(i.socio) + monto);
    return this.registrar({
      serie: 'R',
      tipo: 'retiro_utilidad',
      ctx,
      titulo: `Retiro de utilidad de ${i.socio}`,
      lineas: [pesos('Retiro', monto)],
      saldos: [pesos(`Utilidad asignada que le queda a ${i.socio}`, asignada - monto)],
      detalle: [{ concepto: 'retiro_utilidad', piezas: 0, centavos: monto }],
      revertir: () => {
        this.utilidadAsignada.set(i.socio, (this.utilidadAsignada.get(i.socio) ?? 0n) + monto);
        this.retiradoSocio.set(i.socio, this.retiradoPor(i.socio) - monto);
      },
    });
  }

  /** Espejo del contrato de lane/devolucion-parcial (operacion.registrar_devolucion_cliente). Apagado hasta que la rama este en la base. */
  private devolucion(i: Extract<Intencion, { tipo: 'devolucion' }>, r: Resoluciones, ctx: ContextoEjecucion): ResultadoNegocio {
    if (!this.dependencias.devolucion) {
      return { tipo: 'rechazado', codigo: 'dependencia_pendiente', texto: 'La devolucion todavia no se registra desde Telegram: depende de la rama de devoluciones. Hazla en el software.' };
    }
    const cliente = this.clientes.get(r.clienteId ?? '');
    if (!cliente) return { tipo: 'rechazado', codigo: 'cliente_desconocido', texto: 'Cliente desconocido.' };
    const destino = i.destino ?? 'inventario';
    let nota = 0n;
    let utilidad = 0n;
    const piezasPorModelo: Array<{ modeloId: string; n: number }> = [];
    const lineas: CifraServidor[] = [];
    for (let k = 0; k < i.lineas.length; k++) {
      const modeloId = r.lineas[k]!.modeloId;
      const precio = cliente.tabulador[modeloId];
      if (precio === undefined) return { tipo: 'rechazado', codigo: 'sin_precio', texto: `${cliente.nombre} no tiene precio para ${this.nombreModelo(modeloId)}.` };
      const n = i.lineas[k]!.piezas;
      nota += precio * BigInt(n);
      utilidad -= destino === 'merma' ? precio * BigInt(n) : (precio - (this.modelos.get(modeloId)?.costoCent ?? 0n)) * BigInt(n);
      piezasPorModelo.push({ modeloId, n });
      lineas.push(piezas(this.nombreModelo(modeloId), n));
    }
    if (destino === 'inventario') for (const p of piezasPorModelo) this.existencia.set(p.modeloId, this.existenciaDe(p.modeloId) + p.n);
    this.cxc.set(cliente.id, this.saldoCliente(cliente.id) - nota);
    return this.registrar({
      serie: 'D',
      tipo: 'devolucion',
      ctx,
      titulo: `Devolucion de ${cliente.nombre} (nota de credito)`,
      lineas: [...lineas, pesos('Nota de credito', nota)],
      saldos: [pesos(`Saldo de ${cliente.nombre}`, this.saldoCliente(cliente.id))],
      clienteId: cliente.id,
      utilidad,
      detalle: [{ concepto: 'devolucion', piezas: 0, centavos: nota }],
      revertir: () => {
        if (destino === 'inventario') for (const p of piezasPorModelo) this.existencia.set(p.modeloId, this.existenciaDe(p.modeloId) - p.n);
        this.cxc.set(cliente.id, this.saldoCliente(cliente.id) + nota);
      },
    });
  }

  /** Espejo del contrato de lane/paquete-perdido (operacion.reportar_paquete_salida). Solo abre el incidente: no mueve dinero. */
  private paquetePerdido(i: Extract<Intencion, { tipo: 'paquete_perdido' }>, ctx: ContextoEjecucion): ResultadoNegocio {
    if (!this.dependencias.paquete) {
      return { tipo: 'rechazado', codigo: 'dependencia_pendiente', texto: 'El paquete perdido todavia no se registra desde Telegram: depende de la rama de paquetes. Hazlo en el software.' };
    }
    const pedido = i.pedido_folio ?? '';
    const folio = this.folio('K');
    this.incidentes.push({ folio, pedido, incidente: i.incidente });
    return this.registrar({
      serie: 'K',
      tipo: 'paquete_perdido',
      ctx,
      titulo: `Incidente de paquete ${i.incidente}`,
      lineas: [{ tipo: 'texto', etiqueta: 'Pedido', texto: pedido }],
      detalle: [{ concepto: 'incidente_paquete', piezas: 0, centavos: 0n }],
      revertir: () => {
        const n = this.incidentes.findIndex((x) => x.folio === folio);
        if (n >= 0) this.incidentes.splice(n, 1);
      },
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

  /** Datos del guion para 'mi valuacion' (en produccion salen de agente.valuacion_socios): cifras del dueno, 13-nov. */
  valuacionSimulada: VistaValuacionAgente = {
    socios: [
      { socio: 'Angelo', valuacion_cent: 10691039n, fondos_en_poder_cent: 3547500n, capital_aportado_cent: 10571500n },
      { socio: 'Javier', valuacion_cent: 15483230n, fondos_en_poder_cent: 0n, capital_aportado_cent: 11816191n },
    ],
    igualacion: {
      igualados: false, faltan_cent: 4792191n, mayor: 'Javier', menor: 'Angelo', componentes: [], suma_componentes_cent: 4792191n,
      por_socio: { Angelo: { entregar_cent: 3547500n, valuacion_tras_entregar_cent: 14238539n, aportar_cent: 1244691n }, Javier: { entregar_cent: 0n, valuacion_tras_entregar_cent: 15483230n, aportar_cent: 0n } },
      diferencia_libro_cent: 4792191n, coincide_con_libro: true, regla: '',
    },
    retiros_desiguales: false, diferencia_retiros_cent: 0n, retiro_mas: null,
  };

  async consultar(c: IConsulta, r: Resoluciones, autor: Miembro, ahora: Date = new Date(0)): Promise<RespuestaConsulta> {
    if (c.consulta === 'valuacion') {
      if (autor.rol !== 'socio') return { titulo: 'Eso lo ven solo los socios', lineas: [] };
      const resp = respuestaValuacionAgente(this.valuacionSimulada, autor.persona === 'angelo' ? 'Angelo' : 'Javier', formatearMoneda);
      if (!resp) return { titulo: 'Todavía no hay valuación para comparar', lineas: [] };
      return { titulo: 'Tu valuación', lineas: [{ tipo: 'pesos', etiqueta: 'Tu valuación', centavos: resp.valuacionCent }, ...resp.textos.map((t) => ({ tipo: 'texto' as const, etiqueta: t.etiqueta, texto: t.texto }))] };
    }
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
      case 'estado_cuenta_socio': {
        const socio = normalizar(c.sujeto_texto ?? '');
        if (socio !== 'angelo' && socio !== 'javier') return { titulo: 'Estado de cuenta', lineas: [{ tipo: 'texto', etiqueta: 'Falta', texto: 'Dime de que socio, Angelo o Javier.' }] };
        return {
          titulo: `Estado de cuenta de ${socio === 'angelo' ? 'Angelo' : 'Javier'}`,
          lineas: [
            pesos('Reembolso pendiente', this.deudaCon(socio)),
            pesos('Reembolsos ya pagados', this.reembolsadoA(socio)),
            pesos('Capital aportado', this.capitalDe(socio)),
            pesos('Utilidad asignada sin retirar', this.utilidadAsignada.get(socio) ?? 0n),
            pesos('Retiros de utilidad', this.retiradoPor(socio)),
          ],
        };
      }
      case 'utilidad': {
        const periodo = c.periodo ?? 'mes';
        const dia = 86_400_000;
        
        const dentro = (d: Date) =>
          periodo === 'hoy' ? ahora.toISOString().slice(0, 10) === d.toISOString().slice(0, 10)
            : periodo === 'ayer' ? ahora.getTime() - d.getTime() < 2 * dia && ahora.toISOString().slice(0, 10) !== d.toISOString().slice(0, 10)
              : periodo === 'semana' ? ahora.getTime() - d.getTime() < 7 * dia
                : ahora.toISOString().slice(0, 7) === d.toISOString().slice(0, 7);
        let total = 0n;
        for (const h of this.hechos.values()) if (!h.deshecho && dentro(h.ejecutadoEn)) total += h.utilidadCent;
        return { titulo: `Utilidad operativa (${periodo})`, lineas: [pesos('Utilidad operativa', total), { tipo: 'texto', etiqueta: 'Nota', texto: 'Aproximacion operativa; la cifra contable esta en el software.' }] };
      }
      case 'cartera': {
        const filas = [...this.clientes.values()].map((cl) => ({ cl, saldo: this.saldoCliente(cl.id) })).filter((x) => x.saldo > 0n);
        return { titulo: 'Cuanto debe cada cliente', lineas: filas.length === 0 ? [{ tipo: 'texto', etiqueta: 'Cartera', texto: 'Ningun cliente debe nada.' }] : filas.map((x) => pesos(x.cl.nombre, x.saldo)) };
      }
      case 'por_pagar': {
        // Espejo en memoria: Karen e Isaac (cuenta negativa = se les debe) y el renglon de Omar aparte.
        const deuda = (c: bigint): bigint => (c < 0n ? -c : 0n);
        const isaac = deuda(this.cuentaCon('isaac'));
        const karen = deuda(this.cuentaCon('karen'));
        return { titulo: 'Por pagar', lineas: [pesos('Isaac', isaac), pesos('Karen', karen), pesos('Renta de Omar', 0n), pesos('Total por pagar', isaac + karen)] };
      }
      default:
        return { titulo: 'Consulta no disponible todavia', lineas: [] };
    }
  }


  // ---- menudeo del socio (espejo de ds_*)

  private pedidoMenudeo(i: Extract<Intencion, { tipo: 'pedido_menudeo' }>, r: Resoluciones, ctx: ContextoEjecucion): ResultadoNegocio {
    try {
      this.menudeo.validarCrear(ctx.autor, i.fecha_compromiso ?? null, ctx.ahora);
      let costo = 0n;
      let total = 0;
      for (let k = 0; k < i.lineas.length; k++) {
        const m = this.modelos.get(r.lineas[k]!.modeloId);
        if (!m) return { tipo: 'rechazado', codigo: 'modelo_desconocido', texto: 'Modelo desconocido.' };
        costo += m.costoCent * BigInt(i.lineas[k]!.piezas);
        total += i.lineas[k]!.piezas;
      }
      const proveedor = i.proveedor_origen === 'isaac_directo' ? 'Isaac' : 'Karen';
      const ref: { p?: PedidoMenudeoSim } = {};
      const res = this.registrar({
        serie: 'P',
        tipo: 'pedido',
        ctx,
        titulo: 'Pedido a costo de menudeo creado y confirmado',
        lineas: [piezas('Piezas', total), pesos('Costo del pedido (lo que se paga al proveedor)', costo), { tipo: 'texto', etiqueta: 'Fecha comprometida de pago', texto: i.fecha_compromiso ? formatearFechaPago(i.fecha_compromiso, i.hora_compromiso ?? null) : 'sin fecha comprometida (queda como alerta)' }],
        advertencias: ['Cuando el proveedor lo envie marcalo con /enviado; los datos de entrega se capturan en la web, nunca por Telegram.'],
        detalle: [{ concepto: 'pedido_menudeo', piezas: total, centavos: costo }],
        revertir: () => { if (ref.p) this.menudeo.cancelar(ref.p); },
      });
      const p = (ref.p = this.menudeo.crear({ folio: res.folio, autor: ctx.autor, proveedor, costoCent: costo, fecha: i.fecha_compromiso ?? null, hora: i.hora_compromiso ?? null, ahora: ctx.ahora }));
      return { ...res, datos: { pedido_id: p.id } };
    } catch (e) {
      if (e instanceof ErrorMenudeoSim) return { tipo: 'rechazado', codigo: e.codigo, texto: e.message };
      throw e;
    }
  }

  private envioMenudeo(i: Extract<Intencion, { tipo: 'pedido_envio' }>, ctx: ContextoEjecucion): ResultadoNegocio {
    const p = this.menudeo.porFolio(i.pedido_folio)!;
    if (p.estado !== 'confirmado') return { tipo: 'rechazado', codigo: 'P0428', texto: `El pedido ${p.folio} ya esta ${p.estado}.` };
    this.menudeo.enviar(p);
    return this.registrar({ serie: 'X', tipo: 'pedido_envio', ctx, titulo: 'Pedido marcado como enviado', lineas: [{ tipo: 'folio', etiqueta: 'Pedido', folio: p.folio }], detalle: [{ concepto: 'pedido_envio', piezas: 0, centavos: 0n }], revertir: () => { p.estado = 'confirmado'; } });
  }

  private pagoPedidoMenudeo(i: Extract<Intencion, { tipo: 'pago_pedido_menudeo' }>, ctx: ContextoEjecucion): ResultadoNegocio {
    try {
      if (i.pedido_folio === null || i.monto_centavos === null) return { tipo: 'rechazado', codigo: 'falta_dato', texto: 'Falta el folio o el monto del pago.' };
      const comprobante = this.evidencia?.pendiente(ctx.autor.telegramUserId) ?? null;
      const { reporte, pedido } = this.menudeo.reportarPago({ autor: ctx.autor, folio: i.pedido_folio, montoCent: BigInt(i.monto_centavos), comprobante: comprobante !== null });
      if (comprobante !== null) this.evidencia!.usar(comprobante);
      const pend = this.menudeo.pendiente(pedido);
      const res = this.registrar({
        serie: 'PG',
        tipo: 'pago',
        ctx,
        titulo: 'Pago de pedido de menudeo avisado',
        lineas: [pesos('Monto', BigInt(i.monto_centavos)), { tipo: 'texto', etiqueta: 'Estado', texto: reporte.aplicado ? 'Aplicado con comprobante' : 'Pago reportado (falta que el otro socio lo confirme)' }, pesos('Pendiente de pago del pedido', pend)],
        detalle: [{ concepto: 'pago_pedido_menudeo', piezas: 0, centavos: BigInt(i.monto_centavos) }],
        revertir: () => { if (reporte.aplicado) pedido.pagadoCent -= reporte.montoCent; reporte.aplicado = false; reporte.decision = 'rechazado'; },
      });
      return { ...res, datos: { reporte_id: reporte.id, aplicado: reporte.aplicado, pendiente_cent: Number(pend), comprobante_telegram: comprobante !== null } };
    } catch (e) {
      if (e instanceof ErrorMenudeoSim) return { tipo: 'rechazado', codigo: e.codigo, texto: e.message };
      throw e;
    }
  }

  async igualacion(): Promise<Igualacion> {
    const aportado = (s: 'angelo' | 'javier') => this.capitalDe(s) + this.deudaCon(s) + this.reembolsadoA(s);
    const a = aportado('angelo');
    const j = aportado('javier');
    if (a === j) return { igualados: true, leTocaAportar: null, llevaMas: null, diferenciaCent: 0n };
    return a > j ? { igualados: false, llevaMas: 'Angelo', leTocaAportar: 'Javier', diferenciaCent: a - j } : { igualados: false, llevaMas: 'Javier', leTocaAportar: 'Angelo', diferenciaCent: j - a };
  }

  async socioMenudeo(): Promise<'angelo' | 'javier'> {
    return this.menudeo.socioMenudeo;
  }

  async envioActivo(): Promise<boolean> {
    return this.menudeo.envioActivo;
  }

  async recordatoriosMenudeo(ahora: Date): Promise<RecordatorioMenudeo[]> {
    return this.menudeo.lista(ahora);
  }

  async reclamarRecordatorio(pedidoId: number, tipo: TipoRecordatorio, ahora: Date): Promise<boolean> {
    return this.menudeo.reclamar(pedidoId, tipo, ahora);
  }

  private resultadoMenudeo(titulo: string, ctx: Date, lineas: CifraServidor[], datos: Record<string, unknown>): ResultadoNegocio {
    return { tipo: 'ejecutado', folio: '', titulo, lineas, comprobacion: [], saldos: [], advertencias: [], ejecutadoEn: ctx, repetido: false, datos };
  }

  private readonly porClaveMenudeo = new Map<string, ResultadoNegocio>();

  async responderRecordatorio(e: { autor: Miembro; claveIdem: string; pedidoId: number; accion: 'pagado' | 'posponer'; fecha?: string; hora?: string | null; motivo?: string }): Promise<ResultadoNegocio> {
    const previo = this.porClaveMenudeo.get(e.claveIdem);
    if (previo && previo.tipo === 'ejecutado') return { ...previo, repetido: true };
    try {
      this.menudeo.exigirSocio(e.autor);
      const p = this.menudeo.pedidos.find((x) => x.id === e.pedidoId);
      if (!p) return { tipo: 'rechazado', codigo: 'P0460', texto: 'No encuentro ese pedido.' };
      let r: ResultadoNegocio;
      if (e.accion === 'posponer') {
        this.menudeo.reprogramar({ autor: e.autor, pedido: p, fecha: e.fecha ?? '', hora: e.hora ?? null, motivo: e.motivo ?? null, ahora: new Date() });
        r = this.resultadoMenudeo('Compromiso de pago reprogramado', new Date(), [], { accion: 'posponer' });
      } else {
        const pend = this.menudeo.pendiente(p);
        if (pend <= 0n) return { tipo: 'rechazado', codigo: 'P0428', texto: 'No hay nada pendiente por reportar.' };
        const { reporte } = this.menudeo.reportarPago({ autor: e.autor, folio: p.folio, montoCent: pend, comprobante: false });
        r = this.resultadoMenudeo('Pago de pedido de menudeo avisado', new Date(), [], { accion: 'pagado', reporte_id: reporte.id, aplicado: false, pendiente_cent: Number(this.menudeo.pendiente(p)) });
      }
      this.porClaveMenudeo.set(e.claveIdem, r);
      return r;
    } catch (err) {
      if (err instanceof ErrorMenudeoSim) return { tipo: 'rechazado', codigo: err.codigo, texto: err.message };
      throw err;
    }
  }

  async decidirPagoMenudeo(e: { autor: Miembro; claveIdem: string; reporteId: number; decision: 'confirmado' | 'rechazado'; motivo?: string }): Promise<ResultadoNegocio> {
    const previo = this.porClaveMenudeo.get(e.claveIdem);
    if (previo && previo.tipo === 'ejecutado') return { ...previo, repetido: true };
    try {
      const { pedido } = this.menudeo.decidir(e);
      const r = this.resultadoMenudeo(e.decision === 'confirmado' ? 'Pago confirmado como recibido' : 'Pago rechazado', new Date(), [], { decision: e.decision, pendiente_cent: Number(this.menudeo.pendiente(pedido)) });
      this.porClaveMenudeo.set(e.claveIdem, r);
      return r;
    } catch (err) {
      if (err instanceof ErrorMenudeoSim) return { tipo: 'rechazado', codigo: err.codigo, texto: err.message };
      throw err;
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
