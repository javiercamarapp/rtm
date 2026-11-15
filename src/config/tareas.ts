// UNICA lista de tareas programadas (spec 26, sec. 10). La lee el latido y la siembra en `notificacion.programacion`; `vercel.json` solo lleva el latido.
// Hora local = America/Merida (UTC-6 fijo). `expresionUtc` es la que ejecuta el latido; una prueba comprueba que ambas coinciden.
// `implementada: false` = la tarea esta programada y reclama su ventana, pero todavia no hace nada (queda `omitida` con ese motivo).
export interface TareaProgramada {
  readonly tarea: string;
  readonly expresionLocal: string;
  readonly expresionUtc: string;
  /** Minuto y hora locales de una tarea diaria o semanal, para comparar contra la expresion UTC. null en las de frecuencia. */
  readonly horaLocal: { readonly hora: number; readonly minuto: number } | null;
  readonly descripcion: string;
  readonly implementada: boolean;
}

export const TAREAS: readonly TareaProgramada[] = [
  { tarea: 'latido', expresionLocal: 'cada 5 minutos', expresionUtc: '*/5 * * * *', horaLocal: null, descripcion: 'Despacha avisos, reintenta, sincroniza, caduca y ejecuta las tareas debidas', implementada: true },
  { tarea: 'inventario-proveedores', expresionLocal: 'cada hora, minuto 02', expresionUtc: '2 * * * *', horaLocal: null, descripcion: 'Una peticion al catalogo del proveedor; detecta cambios; foto diaria a las 06:00', implementada: true },
  { tarea: 'confirmacion-lectura', expresionLocal: 'cada 10 minutos (solo corre si hay candidatos)', expresionUtc: '*/10 * * * *', horaLocal: null, descripcion: 'Confirma un cambio candidato antes de avisar (maximo 6 al dia)', implementada: true },
  { tarea: 'promociones-html', expresionLocal: 'cada 3 horas, minuto 32', expresionUtc: '32 */3 * * *', horaLocal: null, descripcion: 'Lee las promociones del inicio; coleccion maximo 2 al dia; tope de 40 peticiones al dia', implementada: true },
  { tarea: 'vigilancia-telegram', expresionLocal: 'cada hora', expresionUtc: '0 * * * *', horaLocal: null, descripcion: 'Membresia del grupo y cola del webhook', implementada: false },
  { tarea: 'cobertura-reposicion', expresionLocal: 'diaria 06:00', expresionUtc: '0 12 * * *', horaLocal: { hora: 6, minuto: 0 }, descripcion: 'Cobertura por sabor y avisos de reposicion', implementada: false },
  { tarea: 'reporte-semanal', expresionLocal: 'lunes 06:00', expresionUtc: '0 12 * * 1', horaLocal: { hora: 6, minuto: 0 }, descripcion: 'Reporte semanal PRELIMINAR; idempotente', implementada: true },
  { tarea: 'reporte-semanal-reintento', expresionLocal: 'lunes 08:00 y 12:00', expresionUtc: '0 14,18 * * 1', horaLocal: null, descripcion: 'Reintenta el semanal solo si falta', implementada: true },
  { tarea: 'aprobacion-y-omar', expresionLocal: 'lunes 09:00 y 12:00', expresionUtc: '0 15,18 * * 1', horaLocal: null, descripcion: 'Recordatorio de aprobar el periodo y liquidacion de Omar abierta', implementada: false },
  { tarea: 'reporte-mensual', expresionLocal: 'dia 1 06:15', expresionUtc: '15 12 1 * *', horaLocal: { hora: 6, minuto: 15 }, descripcion: 'Reporte mensual (PARCIAL hasta sellar el mes)', implementada: true },
  { tarea: 'isaac-previo', expresionLocal: 'jueves 12:00 y viernes 18:00', expresionUtc: '0 18 * * 4', horaLocal: null, descripcion: 'Cobertura y pendientes antes de la liquidacion del proveedor', implementada: false },
  { tarea: 'integridad', expresionLocal: 'diaria 19:55', expresionUtc: '55 1 * * *', horaLocal: null, descripcion: 'Comprobaciones, inventario y cadena de auditoria', implementada: false },
  { tarea: 'resumen-diario', expresionLocal: 'diaria 20:00', expresionUtc: '0 2 * * *', horaLocal: null, descripcion: 'Resumen diario al grupo (plantilla sobre agente.rep_telegram); idempotente por fecha; apagado por interruptor de regla', implementada: true },
  { tarea: 'liquidacion-isaac', expresionLocal: 'viernes 20:05 (verifica hoy = viernes)', expresionUtc: '5 2 * * 6', horaLocal: null, descripcion: 'Liquidacion semanal con el proveedor', implementada: false },
  { tarea: 'pendientes-diarios', expresionLocal: 'diaria 09:00', expresionUtc: '0 15 * * *', horaLocal: { hora: 9, minuto: 0 }, descripcion: 'Pendientes del dia al grupo (cobros, pagos a proveedor, tareas abiertas); idempotente por fecha; apagado por interruptor de regla', implementada: true },
  { tarea: 'conteo-recordatorio', expresionLocal: 'viernes 15:00', expresionUtc: '0 21 * * 5', horaLocal: { hora: 15, minuto: 0 }, descripcion: 'Recordatorio de conteo semanal', implementada: false },
  { tarea: 'costos-tipo-cambio', expresionLocal: 'diaria 14:00', expresionUtc: '0 20 * * *', horaLocal: { hora: 14, minuto: 0 }, descripcion: 'Tipo de cambio del dia (lector de Banxico pendiente)', implementada: false },
  { tarea: 'retencion', expresionLocal: 'domingo 03:00', expresionUtc: '0 9 * * 0', horaLocal: { hora: 3, minuto: 0 }, descripcion: 'Purga de capturas de 90 dias', implementada: false },
];

/** Lo que va en vercel.json: solo el latido. Aqui no se crea ni se despliega nada. */
export function cronsDeVercel(): { path: string; schedule: string }[] {
  return TAREAS.filter((t) => t.tarea === 'latido').map((t) => ({ path: '/api/tareas/latido', schedule: t.expresionUtc }));
}
