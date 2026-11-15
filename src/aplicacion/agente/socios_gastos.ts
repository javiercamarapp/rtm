// Carril SOCIOS Y GASTOS: textos y tipos de lo que el bot dice despues de mover dinero entre socios, gastos, renta de Omar, actas y tickets.
// Todas las cifras salen de la base (agente.saldos_socios_aviso, agente.ejecutar_ext...); este archivo solo da formato. El modelo no calcula dinero.
import { RegistroCifras } from '@/dominio/agente/cifras';
import { formatearMoneda } from '@/dominio/formato';
import { fraseBannerAgente } from '@/dominio/socios/banner-igualar';
import type { Socio, VistaValuacionAgente } from '@/dominio/socios/valuacion';
import type { MensajeListo } from './plantillas';

export type VistaSaldosSocios = Omit<VistaValuacionAgente, 'socios'> & {
  socios: Array<VistaValuacionAgente['socios'][number] & { reembolso_pendiente_cent: bigint; saldo_socio_cent: bigint; neto_cent: bigint }>;
};

/**
 * Aviso al grupo con AMBOS saldos despues de un movimiento de dinero entre socios (y la frase de igualacion del banner: entregar fondos mas aportar).
 * Sin lenguaje de deuda entre socios: el reembolso pendiente es lo que la sociedad le debe al socio por lo que puso o pago.
 */
export function mensajeSaldosSocios(v: VistaSaldosSocios, encabezado = 'Saldos de los socios después de este movimiento:'): MensajeListo {
  const r = new RegistroCifras();
  const l: string[] = [r.servidor(encabezado)];
  for (const s of v.socios) {
    l.push(`${r.servidor(s.socio)}: valuación ${r.pesos(s.valuacion_cent)}; fondos de la sociedad en su poder ${r.pesos(s.fondos_en_poder_cent)}; reembolso pendiente ${r.pesos(s.reembolso_pendiente_cent)}.`);
  }
  const b = v.banner;
  if (!b || !b.activo || !b.menor) l.push('Valuaciones iguales: los dos están igualados.');
  else {
    // Frase en tercera persona para el grupo: se pide como si preguntara el OTRO socio.
    const yo: Socio = b.menor === 'Angelo' ? 'Javier' : 'Angelo';
    const frase = fraseBannerAgente(b, yo, formatearMoneda);
    if (frase) l.push(r.servidor(frase) + '.');
  }
  return { texto: l.join('\n'), registro: r };
}

export function textoTicketLigado(folio: string): MensajeListo {
  const r = new RegistroCifras();
  return { texto: `La foto del ticket quedó guardada como evidencia del gasto ${r.folio(folio)} (solo su huella; no la leo: el monto es el que tú escribiste).`, registro: r };
}

export function textoTicketDuplicado(folioPrevio: string): MensajeListo {
  const r = new RegistroCifras();
  return { texto: `Esa misma foto ya respalda el gasto ${r.folio(folioPrevio)}: no la guardé otra vez.`, registro: r };
}
