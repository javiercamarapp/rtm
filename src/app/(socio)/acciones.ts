'use server';

import { cerrarSesionYSalir } from '@/composicion/acceso';
import { escritorDeSocio, lectorDeSocio } from '@/composicion/catalogo';
import type { Disponibilidad, Explicacion } from '@/dominio/catalogo/tipos';

export async function salir(): Promise<void> {
  await cerrarSesionYSalir();
}

/** "Explicar este numero": cada accion exige sesion de socio antes de tocar la base. */
export async function explicarCifra(cifra: string): Promise<Explicacion> {
  if (!/^(existencia:modelo:\d+|margen:\d+:\d+)$/.test(cifra)) throw new Error('cifra no explicable');
  return (await lectorDeSocio()).explicar(cifra);
}

export async function cambiarDisponibilidad(modeloId: number, estado: Disponibilidad, claveIdem: string): Promise<void> {
  if (!Number.isInteger(modeloId) || (estado !== 'disponible' && estado !== 'sin_disponibilidad') || claveIdem.length < 8) throw new Error('solicitud invalida');
  await (await escritorDeSocio()).fijarDisponibilidad(`web:${claveIdem}`, modeloId, estado);
}
