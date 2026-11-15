// Raiz de composicion de las integraciones con base de datos: webhook de Telegram, latido de tareas, inventario de proveedores y reportes.
// Todo recibe sus dependencias externas por parametro (Telegram, IA, fuente de proveedores, Chromium, reloj): las pruebas usan dobles y NINGUNA llama a un servicio real.
import { entornoVentasDb } from '@/infra/agente/entorno_ventas_postgres';
import { AgenteTelegram } from '@/aplicacion/agente/agente';
import { ErrorLlm, type ClienteLlm, type EnviadorTelegram } from '@/aplicacion/agente/puertos';
import { despacharUnaVez } from '@/aplicacion/notificaciones/despachador';
import { ejecutarConfirmacion, ejecutarLecturaHoraria, ejecutarLecturaPromociones, type DepsCiclo } from '@/aplicacion/proveedores/ciclo';
import type { PuertoLecturaProveedor } from '@/aplicacion/proveedores/puertos';
import { correrLatido, type Manejador, type ResumenLatido } from '@/aplicacion/tareas/latido';
import { configPrivada } from '@/config/privada';
import { TAREAS } from '@/config/tareas';
import { fechaNeg, sumarDias } from '@/dominio/calendario';
import { AlmacenAgenteDb, AlmacenPresupuestoDb, AlmacenTokensDb, CatalogoAgenteDb, NegocioAgenteDb } from '@/infra/agente/postgres';
import { crearClienteOpenRouter } from '@/infra/agente/openrouter';
import { crearEnviadorTelegram, type FetchLike } from '@/infra/agente/telegram_api';
import { manejarWebhook, type RespuestaWebhook } from '@/infra/agente/telegram_webhook';
import { PuertoTareasDb, RepositorioEntregasDb } from '@/infra/notificaciones/postgres';
import { enviadorTelegramDeLotes } from '@/infra/notificaciones/telegram_lotes';
import { ejecutarPendientes, ejecutarResumenDiario } from '@/aplicacion/notificaciones/reportes_programados';
import { PuertoReportesDb } from '@/infra/notificaciones/reportes_postgres';
import { llamadaProveedoresServidor } from '@/infra/postgres/proveedores';
import { sqlServidor, type Sql } from '@/infra/postgres/servidor';
import { secretoValido } from '@/infra/agente/telegram_webhook';
export { leerCuerpoAcotado } from '@/infra/agente/telegram_webhook';
import { appUrl } from '@/config/env';

/** La URL de la app es opcional para los avisos: sin ella los textos no llevan enlace. */
function urlAppOpcional(): string | null {
  try {
    return appUrl();
  } catch {
    return null;
  }
}
import { AlmacenConversacionDb, ResumenPedidosDb } from '@/infra/agente/conversacion_postgres';
import { ModuloAprendizaje } from '@/aplicacion/agente/aprendizaje';
import { ModuloCobranza } from '@/aplicacion/agente/cobranza';
import { PuertoCobranzaDb } from '@/infra/agente/cobranza_postgres';
import { PuertoAprendizajeDb } from '@/infra/agente/aprendizaje_postgres';
import { AvisosDb, ContextoNegocioDb, RepositorioProveedorDb } from '@/infra/proveedores/postgres';
import { lectorDesdeEntorno } from '@/infra/proveedores/lector_http';

export interface DepsProduccion {
  sql: Sql;
  ahora?: () => Date;
  /** Doble de Telegram en pruebas; en produccion se arma con el token privado. */
  telegram?: EnviadorTelegram | null;
  llm?: ClienteLlm;
  fetchFn?: FetchLike;
  /** Lector de la fuente de proveedores: en pruebas, un simulador; nunca se lee la fuente real desde aqui salvo con la variable privada. */
  lectorProveedor?: PuertoLecturaProveedor;
  renderizador?: (fecha14: string) => import('@/aplicacion/reportes/puertos').RenderizadorPdf;
  urlApp?: string | null;
  /** Ajustes del agente (por ejemplo el limite de frecuencia en las pruebas). */
  configAgente?: Partial<import('@/aplicacion/agente/agente').ConfigAgente>;
  /** Maquina de conversacion (por omision encendida): el interprete alimenta los slots, el bot pregunta lo que falte y registra por el carril de frenos. `false` conserva el camino anterior. */
  conversacion?: boolean;
  /** Aprendizaje y alta asistida (por omision encendido): alias con confirmacion, sabores parecidos, altas de cliente, sabor y modelo, recargo sugerido. `false` lo apaga. */
  aprendizaje?: boolean;
  /** Cobranza (por omision encendida): respuestas del socio a lo que se debe. Escribe solo con agente_escritura encendido; el reloj y los avisos programados tienen su propio interruptor (cobranza_activa, apagado). `false` la quita. */
  cobranza?: boolean;
  entorno?: Record<string, string | undefined>;
}

const ahoraDe = (d: DepsProduccion): (() => Date) => d.ahora ?? (() => new Date());

function telegramDe(d: DepsProduccion): EnviadorTelegram | null {
  if (d.telegram !== undefined) return d.telegram;
  const token = configPrivada(d.entorno).TELEGRAM_BOT_TOKEN;
  if (!token) return null;
  return crearEnviadorTelegram({ token, fetch: d.fetchFn ?? ((u, i) => fetch(u, i)) });
}

const SIN_LLAVE: ClienteLlm = { extraer: async () => { throw new ErrorLlm('politica', 'sin llave de IA configurada'); } };

function llmDe(d: DepsProduccion): ClienteLlm {
  if (d.llm) return d.llm;
  const apiKey = configPrivada(d.entorno).OPENROUTER_API_KEY;
  return apiKey ? crearClienteOpenRouter({ apiKey, fetch: d.fetchFn ?? ((u, i) => fetch(u, i)) }) : SIN_LLAVE;
}

/** Agente de produccion: identidad por id de Telegram desde la base (nunca desde el repo), IA detras de un puerto y escrituras por funciones SQL. */
export function crearAgenteProduccion(d: DepsProduccion): AgenteTelegram {
  const tg = telegramDe(d);
  if (!tg) throw new Error('Telegram no esta configurado (falta TELEGRAM_BOT_TOKEN)');
  return new AgenteTelegram({
    almacen: new AlmacenAgenteDb(d.sql), presupuesto: new AlmacenPresupuestoDb(d.sql), llm: llmDe(d), telegram: tg, tokens: new AlmacenTokensDb(d.sql),
    catalogo: new CatalogoAgenteDb(d.sql), negocio: new NegocioAgenteDb(d.sql), reloj: ahoraDe(d), config: { exigirSabor: true, exigirPlazoPedido: true, ...d.configAgente },
    ...(d.conversacion === false ? {} : { conversacion: { almacen: new AlmacenConversacionDb(d.sql), resumenes: new ResumenPedidosDb(d.sql), entorno: entornoVentasDb(d.sql) } }),
    ...(d.cobranza === false ? {} : { cobranza: new ModuloCobranza(new PuertoCobranzaDb(d.sql), () => new CatalogoAgenteDb(d.sql).clientes(), ahoraDe(d)) }),
    ...(d.aprendizaje === false ? {} : { aprendizaje: new ModuloAprendizaje(new PuertoAprendizajeDb(d.sql), () => new CatalogoAgenteDb(d.sql).clientes()) }),
  });
}

/** Webhook: secreto en tiempo constante, 200 siempre salvo secreto invalido, reclamo por update_id dentro del agente. Sin secreto configurado rechaza todo. */
export async function procesarWebhook(d: DepsProduccion, cabeceraSecreto: string | null, cuerpo: string | (() => Promise<string | null>)): Promise<RespuestaWebhook> {
  const secreto = configPrivada(d.entorno).TELEGRAM_WEBHOOK_SECRET ?? '';
  return manejarWebhook({
    cabeceraSecreto, secretoEsperado: secreto, cuerpo,
    procesar: (u) => crearAgenteProduccion(d).procesarUpdate(u),
  });
}

// ---------------------------------------------------------------- tareas

function depsProveedores(d: DepsProduccion, promocionesActivas: boolean): DepsCiclo {
  const db = llamadaProveedoresServidor(d.sql);
  const lector = d.lectorProveedor ?? lectorDesdeEntorno(d.entorno ?? process.env).lector;
  return { lector, repo: new RepositorioProveedorDb(db), contexto: new ContextoNegocioDb(db), avisos: new AvisosDb(db), reloj: ahoraDe(d), promocionesActivas };
}

async function frescura(d: DepsProduccion): Promise<{ lectura: boolean; promociones: boolean }> {
  const r = await d.sql<{ j: { lectura_activa: boolean; promociones_activas: boolean } }>('select proveedores.frescura() as j');
  return { lectura: r[0]!.j.lectura_activa, promociones: r[0]!.j.promociones_activas };
}

async function paraProveedores(d: DepsProduccion, tipo: 'horaria' | 'confirmacion' | 'promociones'): ReturnType<Manejador> {
  const f = await frescura(d);
  if (!f.lectura) return { estado: 'omitida', detalle: 'interruptor lectura_proveedores apagado' };
  if (tipo === 'promociones' && !f.promociones) return { estado: 'omitida', detalle: 'interruptor promociones_lectura apagado (espera la autorizacion del dueno)' };
  if (!d.lectorProveedor && !configPrivada(d.entorno).INVENTARIO_PROVEEDORES_FUENTE) return { estado: 'omitida', detalle: 'sin fuente configurada' };
  const deps = depsProveedores(d, f.promociones);
  const r = tipo === 'horaria' ? await ejecutarLecturaHoraria(deps) : tipo === 'confirmacion' ? await ejecutarConfirmacion(deps) : await ejecutarLecturaPromociones(deps);
  return { estado: 'ok', detalle: r.estado };
}

/** Semanal: la semana que cerro ayer (lunes a domingo). Mensual: el mes anterior. Ambos con la fecha de negocio de Merida. */
export function periodoDeReporte(tipo: 'semanal' | 'mensual', hoy: string): string {
  if (tipo === 'mensual') {
    const [a, m] = hoy.split('-').map(Number) as [number, number];
    const ant = m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, '0')}`;
    return `${ant}-01`;
  }
  const d = new Date(`${hoy}T12:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // lunes = 0
  return sumarDias(hoy, -(dow + 7));
}

export function manejadoresDeTareas(d: DepsProduccion): Record<string, Manejador> {
  const hoy = () => fechaNeg(ahoraDe(d)());
  const reporte = (tipo: 'semanal' | 'mensual'): Manejador => async () => {
    // Carga diferida: Chromium y las fuentes no entran al grafo del webhook ni de las demas rutas.
    const { generarReporteDeSistema } = await import('./reportes_sistema');
    const r = await generarReporteDeSistema(d, tipo, periodoDeReporte(tipo, hoy()));
    return { estado: 'ok', detalle: r.salio ? r.salio && 'accion' in r ? r.accion : 'ok' : 'no_sale' };
  };
  return {
    'inventario-proveedores': () => paraProveedores(d, 'horaria'),
    'confirmacion-lectura': () => paraProveedores(d, 'confirmacion'),
    'promociones-html': () => paraProveedores(d, 'promociones'),
    'reporte-semanal': reporte('semanal'),
    'reporte-semanal-reintento': reporte('semanal'),
    'reporte-mensual': reporte('mensual'),
    // Mensajes programados al grupo: plantilla sobre cifras SQL, emitidos por la puerta unica; con la regla o el maestro apagados quedan `omitida` y no sale nada.
    'resumen-diario': () => ejecutarResumenDiario(new PuertoReportesDb(d.sql), ahoraDe(d)()),
    'pendientes-diarios': () => ejecutarPendientes(new PuertoReportesDb(d.sql), ahoraDe(d)()),
  };
}

/** Trabajo propio del latido: reglas de aviso, caducidades, tomas vencidas y despacho de entregas por Telegram. */
async function propioDelLatido(d: DepsProduccion): Promise<void> {
  await d.sql('select notificacion.latido()');
  const tg = telegramDe(d);
  if (tg) {
    const agente = crearAgenteProduccion({ ...d, telegram: tg });
    try { await agente.caducarTomasVencidas(); } catch { /* una toma que no caduca hoy caduca en la siguiente pasada */ }
    // Recordatorios de pago de menudeo al GRUPO de socios: solo con el interruptor `telegram_envio` encendido; cada aviso se reclama en la base antes de enviarse (idempotente).
    // Barrido de updates reclamados y no terminados (lease vencido) o fallidos: con `telegram_envio` apagado no hace nada; avisa una sola vez de los abandonados.
    try { await agente.barrerUpdates(); } catch { /* el siguiente latido lo reintenta */ }
    try { await agente.enviarRecordatoriosMenudeo(); } catch { /* el siguiente latido lo reintenta: un aviso no reclamado sigue pendiente */ }
  }
  const tokens = new AlmacenTokensDb(d.sql);
  const enviadores = tg ? { telegram: enviadorTelegramDeLotes(tg, tokens, d.urlApp ?? null, ahoraDe(d)) } : {};
  await despacharUnaVez(new RepositorioEntregasDb(d.sql), enviadores, 10);
}

export async function ejecutarLatidoProduccion(d: DepsProduccion): Promise<ResumenLatido> {
  const puerto = new PuertoTareasDb(d.sql);
  await puerto.sembrar(TAREAS);
  return correrLatido({ tareas: TAREAS, puerto, manejadores: manejadoresDeTareas(d), propio: () => propioDelLatido(d), ahora: ahoraDe(d)() });
}

// ---------------------------------------------------------------- entradas de las rutas HTTP (las rutas de app no importan infra)

export function webhookTelegram(cabeceraSecreto: string | null, cuerpo: string | (() => Promise<string | null>)): Promise<RespuestaWebhook> {
  return procesarWebhook({ sql: sqlServidor, urlApp: urlAppOpcional() }, cabeceraSecreto, cuerpo);
}

export type RespuestaTarea = { status: number; cuerpo: unknown };

/** `/api/tareas/<tarea>`: latido (unica entrada de reloj) o una tarea de la lista corrida a mano con su propia ventana. Sin secreto configurado rechaza todo. */
export async function tareaProgramada(tarea: string, autorizacion: string | null, d: Partial<DepsProduccion> = {}): Promise<RespuestaTarea> {
  const esperado = configPrivada(d.entorno).TAREAS_SECRETO ?? '';
  if (!secretoValido(autorizacion?.startsWith('Bearer ') ? autorizacion.slice(7) : null, esperado)) return { status: 401, cuerpo: null };
  const deps: DepsProduccion = { sql: sqlServidor, urlApp: urlAppOpcional(), ...d };
  if (tarea === 'latido') return { status: 200, cuerpo: await ejecutarLatidoProduccion(deps) };
  return correrTareaManual(tarea, deps);
}

/** Corre una tarea de la lista con su propia ventana manual (idempotente por minuto). La autorizacion ya la hizo quien llama (secreto o sesion de socio). */
export async function correrTareaManual(tarea: string, deps: DepsProduccion): Promise<RespuestaTarea> {
  const def = TAREAS.find((t) => t.tarea === tarea);
  const manejador = manejadoresDeTareas(deps)[tarea];
  if (!def || !manejador) return { status: 404, cuerpo: null };
  const puerto = new PuertoTareasDb(deps.sql);
  await puerto.sembrar(TAREAS);
  const ventana = `manual:${ahoraDe(deps)().toISOString().slice(0, 16)}`;
  if (!(await puerto.reclamar(tarea, ventana))) return { status: 200, cuerpo: { estado: 'ya_reclamada' } };
  try {
    const r = await manejador(ventana);
    await puerto.terminar(tarea, ventana, r.estado, r.detalle);
    return { status: 200, cuerpo: r };
  } catch (e) {
    await puerto.terminar(tarea, ventana, 'error', e instanceof Error ? e.name : 'error');
    return { status: 500, cuerpo: { estado: 'error' } };
  }
}

/** "Actualizar ahora" de la pagina de Karen: la misma lectura horaria, con la sesion de un socio ya comprobada por quien llama. Respeta el interruptor y el tope de 40 peticiones. */
export function lecturaManualDeProveedores(d: Partial<DepsProduccion> = {}): Promise<RespuestaTarea> {
  return correrTareaManual('inventario-proveedores', { sql: sqlServidor, urlApp: urlAppOpcional(), ...d });
}
