'use server';

import { cerrarSesionYSalir } from '@/composicion/acceso';

export async function salir(): Promise<void> {
  await cerrarSesionYSalir();
}
