// Texto de cifras para los componentes de grafica. El formato de dinero y piezas vive en dominio/formato; aqui solo se reutiliza.
import { MENOS, formatearMoneda, formatearPiezas } from '@/dominio/formato';

export type TipoCifra = 'entero' | 'moneda' | 'piezas' | 'porcentaje' | 'dias';

function agrupar(enteros: string): string {
  return enteros.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * Texto de una cifra animada. `moneda` recibe centavos enteros; `piezas` y `entero` enteros; `porcentaje` y `dias` admiten decimales.
 * El valor final de un contador siempre pasa por aqui, animado o no, para que el estado final sea identico.
 */
export function textoCifra(valor: number, tipo: TipoCifra, decimales: number = 0): string {
  if (!Number.isFinite(valor)) throw new RangeError('la cifra debe ser finita');
  switch (tipo) {
    case 'moneda':
      return formatearMoneda(BigInt(Math.round(valor)));
    case 'piezas':
      return formatearPiezas(Math.round(valor));
    case 'entero': {
      const n = Math.round(valor);
      return `${n < 0 ? MENOS : ''}${agrupar(String(Math.abs(n)))}`;
    }
    case 'porcentaje':
    case 'dias': {
      const cuerpo = Math.abs(valor).toFixed(decimales);
      const [ent = '0', dec] = cuerpo.split('.');
      const num = `${agrupar(ent)}${dec ? `.${dec}` : ''}`;
      const signo = valor < 0 && Number(cuerpo) !== 0 ? MENOS : '';
      return tipo === 'porcentaje' ? `${signo}${num} %` : `${signo}${num} d`;
    }
  }
}

/** Palabra de un cambio, para lectores de pantalla y para no depender de la flecha. */
export function palabraSentido(sentido: 'sube' | 'baja' | 'igual'): string {
  return sentido === 'sube' ? 'Sube' : sentido === 'baja' ? 'Baja' : 'Sin cambio';
}
