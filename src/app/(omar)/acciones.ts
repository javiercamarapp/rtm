'use server';

import { cerrarSesionYSalir } from '@/composicion/acceso';
import { explicarDeOmar, solicitarDeOmar } from '@/composicion/omar';
import type { Explicacion } from '@/dominio/catalogo/tipos';
import type { ResultadoSolicitud } from '@/dominio/omar/tipos';

export async function salir(): Promise<void> {
  await cerrarSesionYSalir();
}

/** "Explicar este número" de Omar: solo cifras de su propia cuenta, construidas con lo que su vista le entrega. */
export async function explicarCifra(cifra: string): Promise<Explicacion> {
  return explicarDeOmar(cifra);
}

/** Solicitud de piezas: la composicion exige sesion de Omar activa; el caso de uso valida clave, tope y existencia; la base valida de nuevo. */
export async function solicitarPiezas(entrada: { clave: string; modelo: string; sabor: string; piezas: number }): Promise<ResultadoSolicitud> {
  if (typeof entrada?.modelo !== 'string' || typeof entrada?.sabor !== 'string') return { ok: false, motivo: 'pieza_desconocida', mensaje: 'Datos inválidos.' };
  return solicitarDeOmar({ clave: entrada.clave, modelo: entrada.modelo.slice(0, 120), sabor: entrada.sabor.slice(0, 120), piezas: entrada.piezas });
}
