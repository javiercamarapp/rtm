'use server';

import { cerrarSesionYSalir } from '@/composicion/acceso';
import { escritorDeSocio, lectorDeSocio } from '@/composicion/catalogo';
import type { Disponibilidad, Explicacion } from '@/dominio/catalogo/tipos';

export async function salir(): Promise<void> {
  await cerrarSesionYSalir();
}

/** "Explicar este numero": cada accion exige sesion de socio antes de tocar la base. */
export async function explicarCifra(cifra: string): Promise<Explicacion> {
  if (!/^(existencia:modelo:\d+|margen:\d+:\d+|pedido:(total|saldo):\d+|proveedor:saldo:\d+|socio:(deuda|fondos|diferencia):(Angelo|Javier)|socio:neto:(Angelo|Javier)|socios:diferencia|cxc:total|proveedor:falta:(Isaac|Karen):\d{4}-\d{2}-\d{2}:(sociedad|todo)|omar:neto:\d{4}-\d{2}-\d{2}|cascada:utilidad:\d{4}-\d{2}-\d{2}:\d{4}-\d{2}-\d{2}|cascada:resultado:(Angelo|Javier):\d{4}-\d{2}-\d{2}:\d{4}-\d{2}-\d{2}:\d+|conta:saldo:\d{4}(:\d{4}-\d{2}-\d{2})?|conta:(v0[1-6]|l0[12])(:\d{4}-\d{2}-\d{2})?|conta:utilidad:\d{4}-\d{2}-\d{2}:\d{4}-\d{2}-\d{2}(:(bruta|contribucion|neta))?)$/.test(cifra)) throw new Error('cifra no explicable');
  return (await lectorDeSocio()).explicar(cifra);
}

export async function cambiarDisponibilidad(modeloId: number, estado: Disponibilidad, claveIdem: string): Promise<void> {
  if (!Number.isInteger(modeloId) || (estado !== 'disponible' && estado !== 'sin_disponibilidad') || claveIdem.length < 8) throw new Error('solicitud invalida');
  await (await escritorDeSocio()).fijarDisponibilidad(`web:${claveIdem}`, modeloId, estado);
}
