// Ayudas de las conversaciones simuladas: motor + almacen en memoria + ejecutor falso (transporte falso de Telegram: nada sale a la red).
import { MotorConversacion, type BotonConv, type Candidatos, type EntornoConversacion, type EjecutorOperacion, type OperacionCompleta, type ResultadoRegistro, type ResumenPedidos, type Salida } from '@/aplicacion/agente/conversacion';
import type { ResumenPedidoSql } from '@/aplicacion/agente/mensaje_pedido';
import type { OperacionConv } from '@/dominio/agente/slots';
import type { Miembro } from '@/dominio/agente/tipos';
import type { EntradaCatalogo } from '@/dominio/agente/resolutor';
import { AlmacenConversacionMemoria } from '@/infra/agente/conversacion_memoria';

export const ANGELO: Miembro = { telegramUserId: 1001, persona: 'angelo', rol: 'socio' };
export const JAVIER: Miembro = { telegramUserId: 1002, persona: 'javier', rol: 'socio' };
export const CHAT = -5001;

export const CLIENTES: EntradaCatalogo[] = [
  { id: 'c1', nombre: 'Memo Garcia', alias: ['memo garcia'] },
  { id: 'c2', nombre: 'Memo Lopez', alias: ['memo lopez'] },
  { id: 'c3', nombre: 'Lupita Soto', alias: ['lupita'] },
  { id: 'c4', nombre: 'Ariel Gomez', alias: ['ariel'] },
];
export const MODELOS: EntradaCatalogo[] = [
  { id: 'm1', nombre: 'Nexa Ultra 50K', alias: ['nexa'] },
  { id: 'm2', nombre: 'Zafiro 5K', alias: ['zafiro'] },
];
const SABORES: Record<string, EntradaCatalogo[]> = {
  m1: [{ id: 's1', nombre: 'Mango', alias: [] }, { id: 's2', nombre: 'Sandia', alias: ['sandía'] }, { id: 's3', nombre: 'Mora Azul', alias: ['mora'] }],
  m2: [{ id: 's4', nombre: 'Menta', alias: [] }, { id: 's5', nombre: 'Uva', alias: [] }],
};

export class EjecutorFalso implements EjecutorOperacion {
  readonly operaciones: OperacionCompleta[] = [];
  respuesta: (op: OperacionCompleta) => ResultadoRegistro = (op) => ({ tipo: 'registrado', folio: `PG-${String(this.operaciones.length).padStart(4, '0')}`, ...(op.operacion.startsWith('pedido') ? { pedidoId: 77 } : {}) });
  async ejecutarOperacionCompleta(op: OperacionCompleta): Promise<ResultadoRegistro> {
    this.operaciones.push(op);
    return this.respuesta(op);
  }
}

export const RESUMEN_EJEMPLO: ResumenPedidoSql = {
  folio: 'MG-001', cliente: 'Memo Garcia', origen: 'bodega_omar', tipo_venta: 'cliente',
  lineas: [{ modelo: 'NEXA ULTRA 50K', sabor: 'MANGO', piezas: 24, precio_cent: 20000, importe_cent: 480000 }],
  piezas: 24, subtotal_cent: 480000, envio_cent: 0, recargo_cent: 0, descuento_cent: 0, total_cent: 480000, plazo_dias: 15, de_contado: false, vence: '2026-11-30', vence_estimado: true,
  saldo_pedido_cent: 480000, por_cobrar_cliente_cent: 0, por_cobrar_cliente_con_pedido_cent: 480000, proveedor: null, por_pagar_proveedor_cent: null, costo_pedido_estimado_cent: null,
  por_pagar_proveedor_con_pedido_cent: null, utilidad_estimada_cent: 240000, inventario: [{ modelo: 'NEXA ULTRA 50K', sabor: 'MANGO', disponible: 36, piezas_pedidas: 24 }], avisos: [],
};

export class Sim {
  readonly almacen: AlmacenConversacionMemoria;
  readonly ejecutor = new EjecutorFalso();
  readonly motor: MotorConversacion;
  hora = new Date('2026-11-16T15:00:00Z');
  private n = 100;
  /** Todo lo que el bot "envio" (transporte falso). */
  readonly enviados: string[] = [];
  constructor(entorno: Partial<EntornoConversacion> = {}, resumen?: ResumenPedidos, public autor: Miembro = ANGELO) {
    this.almacen = new AlmacenConversacionMemoria(() => this.hora);
    this.motor = new MotorConversacion(
      this.almacen,
      { catalogo: { clientes: async () => CLIENTES, modelos: async () => MODELOS, saboresEnExistencia: async (m) => SABORES[m] ?? [], saboresDe: async (m) => SABORES[m] ?? [] }, ...entorno },
      this.ejecutor,
      resumen ?? { resumen: async () => RESUMEN_EJEMPLO },
    );
  }
  private entrada() {
    this.n += 1;
    return { chatId: CHAT, autor: this.autor, ahora: this.hora, clave: `u${this.n}`, mensajeId: this.n };
  }
  private guardar(s: Salida): Salida {
    if (s.tipo === 'pregunta') this.enviados.push(s.texto);
    else if (s.tipo === 'registrado') this.enviados.push(s.mensaje.texto);
    else if ('texto' in s) this.enviados.push(s.texto);
    return s;
  }
  async instruccion(operacion: OperacionConv, candidatos: Candidatos, cita: string): Promise<Salida> {
    return this.guardar(await this.motor.procesar(this.entrada(), { tipo: 'instruccion', operacion, candidatos, cita }));
  }
  async texto(t: string): Promise<Salida> {
    return this.guardar(await this.motor.procesar(this.entrada(), { tipo: 'texto', texto: t }));
  }
  async boton(valor: string): Promise<Salida> {
    return this.guardar(await this.motor.procesar(this.entrada(), { tipo: 'boton', valor }));
  }
}

export function textoDe(s: Salida): string {
  if (s.tipo === 'pregunta') return s.texto;
  if (s.tipo === 'registrado') return s.mensaje.texto;
  if ('texto' in s) return s.texto;
  return `[${s.tipo}]`;
}

export function valoresBotones(s: Salida): string[] {
  return s.tipo === 'pregunta' ? s.botones.map((b: BotonConv) => b.valor) : [];
}
