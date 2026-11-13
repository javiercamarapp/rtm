'use server';

import { cerrarSesionYSalir } from '@/composicion/acceso';
import { escritorDeSocio, lectorDeSocio } from '@/composicion/catalogo';
import { operacionDeSocio } from '@/composicion/operacion';
import { CIFRA_CUADRE_SOCIOS, explicarCuadreSocios } from '@/dominio/operacion/cuadre';
import { escritorNotificacionesDeSocio, notificacionesDeSocio } from '@/composicion/inventario';
import type { Disponibilidad, Explicacion } from '@/dominio/catalogo/tipos';
import type { ListaCampana } from '@/dominio/notificaciones/tipos';

export async function salir(): Promise<void> {
  await cerrarSesionYSalir();
}

/** "Explicar este numero": cada accion exige sesion de socio antes de tocar la base. */
export async function explicarCifra(cifra: string): Promise<Explicacion> {
  if (!/^(existencia:modelo:\d+|margen:\d+:\d+|pedido:(total|saldo):\d+|proveedor:saldo:\d+|socio:(deuda|fondos|diferencia):(Angelo|Javier)|socio:neto:(Angelo|Javier)|socios:diferencia|socios:cuadre|cxc:total|proveedor:falta:(Isaac|Karen):\d{4}-\d{2}-\d{2}:(sociedad|todo)|omar:neto:\d{4}-\d{2}-\d{2}|cascada:utilidad:\d{4}-\d{2}-\d{2}:\d{4}-\d{2}-\d{2}|cascada:resultado:(Angelo|Javier):\d{4}-\d{2}-\d{2}:\d{4}-\d{2}-\d{2}:\d+|conta:efectivo|conta:saldo:\d{4}(:\d{4}-\d{2}-\d{2})?|conta:(v0[1-6]|l0[12])(:\d{4}-\d{2}-\d{2})?|conta:utilidad:\d{4}-\d{2}-\d{2}:\d{4}-\d{2}-\d{2}(:(bruta|contribucion|neta))?|inventario:valor|cobertura:modelo:\d+)$/.test(cifra)) throw new Error('cifra no explicable');
  if (cifra === CIFRA_CUADRE_SOCIOS) return explicarCuadreSocios(await (await operacionDeSocio()).cuentaSocios());
  return (await lectorDeSocio()).explicar(cifra);
}

export async function cambiarDisponibilidad(modeloId: number, estado: Disponibilidad, claveIdem: string): Promise<void> {
  if (!Number.isInteger(modeloId) || (estado !== 'disponible' && estado !== 'sin_disponibilidad') || claveIdem.length < 8) throw new Error('solicitud invalida');
  await (await escritorDeSocio()).fijarDisponibilidad(`web:${claveIdem}`, modeloId, estado);
}

/** Campana: lista de avisos (pestañas Todas y Sin leer). Solo socios. */
export async function cargarCampana(filtro: 'todas' | 'sin_leer'): Promise<ListaCampana> {
  if (filtro !== 'todas' && filtro !== 'sin_leer') throw new Error('filtro invalido');
  return (await notificacionesDeSocio()).mis(filtro, 0);
}

export async function marcarLeidaAccion(avisoId: number): Promise<void> {
  if (!Number.isInteger(avisoId) || avisoId <= 0) throw new Error('aviso invalido');
  await (await escritorNotificacionesDeSocio()).marcarLeida(avisoId);
}

export async function marcarTodasLeidasAccion(): Promise<void> {
  await (await escritorNotificacionesDeSocio()).marcarTodasLeidas();
}
