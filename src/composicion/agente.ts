// Cableado del agente de Telegram. En esta ola solo existe la composicion EN MEMORIA con LLM simulado (ninguna llamada real);
// la composicion de produccion se arma cuando las olas de base de datos entreguen los puertos reales.
import { AgenteTelegram, type ConfigAgente } from '@/aplicacion/agente/agente';
import type { ClienteLlm } from '@/aplicacion/agente/puertos';
import type { EstadoPresupuesto } from '@/dominio/agente/presupuesto';
import type { Miembro } from '@/dominio/agente/tipos';
import { LlmHeuristico } from '@/infra/agente/llm_simulado';
import {
  AlmacenAgenteMemoria,
  AlmacenPresupuestoMemoria,
  AlmacenTokensMemoria,
  CatalogoMemoria,
  EnviadorTelegramMemoria,
} from '@/infra/agente/memoria';
import { NegocioSimulado } from '@/infra/agente/negocio_simulado';
import { ModuloAprendizaje } from '@/aplicacion/agente/aprendizaje';
import { ModuloInventarioBot, type PuertoAvisosInventario } from '@/aplicacion/agente/avisos_inventario';
import { AlmacenConversacionMemoria } from '@/infra/agente/conversacion_memoria';
import { PuertoAprendizajeMemoria } from '@/infra/agente/aprendizaje_memoria';
import { ContadorUpdates, IDS_SIMULADOS } from '@/infra/agente/updates';

export class RelojManual {
  constructor(private ms: number) {}
  ahora = (): Date => new Date(this.ms);
  avanzarMin(min: number): void {
    this.ms += min * 60_000;
  }
  avanzarHoras(h: number): void {
    this.ms += h * 3_600_000;
  }
}

export interface OpcionesAgenteEnMemoria {
  llm?: ClienteLlm;
  reloj?: RelojManual;
  presupuestoInicial?: EstadoPresupuesto;
  config?: Partial<ConfigAgente>;
  negocio?: NegocioSimulado;
  /** Maquina de conversacion en memoria (transporte falso): el bot pregunta lo que falte y registra por el negocio simulado. */
  conversacion?: boolean;
  /** Aprendizaje y alta asistida con el puerto en memoria (sin base ni red). Implica conversacion. */
  aprendizaje?: PuertoAprendizajeMemoria;
  /** Comandos de inventario (/vende, /reponer, /minimo, /avisos) con su puerto (en memoria en pruebas). */
  inventario?: PuertoAvisosInventario;
}

export const MIEMBROS_SIMULADOS: Miembro[] = [
  { telegramUserId: IDS_SIMULADOS.angelo, persona: 'angelo', rol: 'socio' },
  { telegramUserId: IDS_SIMULADOS.javier, persona: 'javier', rol: 'socio' },
  { telegramUserId: IDS_SIMULADOS.omar, persona: 'omar', rol: 'omar' },
];

/** 10-nov-2026 12:00 hora de Merida (18:00 UTC), martes. */
export const INICIO_SIMULADO = Date.UTC(2026, 10, 10, 18, 0, 0);

export function crearAgenteEnMemoria(op: OpcionesAgenteEnMemoria = {}) {
  const negocio = op.negocio ?? new NegocioSimulado();
  const reloj = op.reloj ?? new RelojManual(INICIO_SIMULADO);
  const almacen = new AlmacenAgenteMemoria(MIEMBROS_SIMULADOS, { grupoSocios: IDS_SIMULADOS.grupoSocios, privadoOmar: IDS_SIMULADOS.privadoOmar });
  almacen.reloj = reloj.ahora;
  const presupuesto = new AlmacenPresupuestoMemoria(op.presupuestoInicial);
  const telegram = new EnviadorTelegramMemoria();
  const tokens = new AlmacenTokensMemoria();
  const llm = op.llm ?? new LlmHeuristico();
  const catalogo = new CatalogoMemoria({
    clientes: negocio.catalogoClientes(),
    modelos: negocio.catalogoModelos(),
    sabores: Object.fromEntries(negocio.catalogoModelos().map((m) => [m.id, negocio.saboresDe(m.id)])),
  });
  // Comprobantes de Telegram (solo huella): el negocio simulado los lee del almacen en memoria, y cada uno se usa una sola vez (como agente._evidencia_pendiente).
  const usadas = new Set<number>();
  negocio.evidencia = {
    pendiente: (uid) => almacen.evidencias.find((e) => e.telegramUserId === uid && !usadas.has(e.id))?.id ?? null,
    usar: (id) => void usadas.add(id),
  };
  const aprendizaje = op.aprendizaje ? new ModuloAprendizaje(op.aprendizaje, async () => catalogo.clientes()) : undefined;
  if (op.aprendizaje) op.aprendizaje.ahora = () => reloj.ahora().getTime();
  const conversacion = op.conversacion || op.aprendizaje ? { almacen: new AlmacenConversacionMemoria(reloj.ahora) } : undefined;
  const agente = new AgenteTelegram({ almacen, presupuesto, llm, telegram, tokens, catalogo, negocio, reloj: reloj.ahora, config: op.config, ...(conversacion ? { conversacion } : {}), ...(aprendizaje ? { aprendizaje } : {}), ...(op.inventario ? { inventario: new ModuloInventarioBot(op.inventario) } : {}) });
  return { agente, almacen, presupuesto, telegram, tokens, llm, catalogo, negocio, reloj, aprendizaje: op.aprendizaje, contador: new ContadorUpdates(), ids: IDS_SIMULADOS };
}

export type AgenteEnMemoria = ReturnType<typeof crearAgenteEnMemoria>;
