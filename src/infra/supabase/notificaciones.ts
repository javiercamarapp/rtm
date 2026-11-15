// Implementa los puertos de notificaciones con las funciones api.* (sesion del usuario, llave publica; nunca la de servicio).
import type { EscritorNotificaciones, LectorNotificaciones, ResultadoDepuracion } from '@/aplicacion/notificaciones/puertos';
import { centavosABigint } from '@/dominio/operacion/json';
import { crearClienteServidor } from './cliente-servidor';

async function llamar<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const sb = await crearClienteServidor();
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return centavosABigint<T>(data);
}

export function lectorNotificacionesSupabase(): LectorNotificaciones {
  return {
    mis: (filtro, pagina) => llamar('mis_notificaciones', { p_filtro: filtro, p_pagina: pagina }),
    contarNoLeidas: () => llamar('contar_no_leidas'),
    tuTurno: () => llamar('tu_turno'),
    pulso: () => llamar('pulso'),
  };
}

export function escritorNotificacionesSupabase(): EscritorNotificaciones {
  return {
    async marcarLeida(avisoId) { await llamar('marcar_leida', { p_aviso: avisoId }); },
    async marcarTodasLeidas() { await llamar('marcar_todas_leidas'); },
    depurar: () => llamar<ResultadoDepuracion>('depurar_avisos'),
  };
}
