'use server';

import { redirect } from 'next/navigation';
import { procesarConfirmacion } from '@/composicion/acceso';

/** Solo aqui, con el toque de la persona, se consume el enlace (un escaner de correo que abre el GET no llega hasta aqui). */
export async function confirmarAcceso(formData: FormData): Promise<void> {
  const campo = (n: string) => {
    const v = formData.get(n);
    return typeof v === 'string' ? v : null;
  };
  const { destino } = await procesarConfirmacion({ tokenHash: campo('token_hash'), tipo: campo('type'), next: campo('next') });
  redirect(destino);
}
