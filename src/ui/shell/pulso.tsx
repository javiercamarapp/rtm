import Link from 'next/link';
import type { ChipPulso } from '@/dominio/operacion/pulso';
import { CifraComprobada } from '../componentes/cifra';
import { SinDato } from '../componentes/estado-texto';

/** Un indicador del pulso: cifra real con "Explicar este numero" cuando la base la sabe explicar; si no, enlace al detalle. Sin datos: "Sin dato", nunca un cero inventado. */
export function ChipDelPulso({ chip }: { chip: ChipPulso }) {
  return (
    <span className="rtm-chip" data-testid={`pulso-${chip.clave}`}>
      {chip.etiqueta}
      <b>
        {chip.texto === null ? (
          chip.href ? <Link className="rtm-chip-enlace" href={chip.href}><SinDato /></Link> : <SinDato />
        ) : chip.cifra ? (
          <CifraComprobada texto={chip.texto} cifra={chip.cifra} comprobacion="cuadra" />
        ) : chip.href ? (
          <Link className="rtm-chip-enlace" href={chip.href} aria-label={`${chip.texto}. Ver el detalle`}>{chip.texto}</Link>
        ) : (
          chip.texto
        )}
      </b>
      {chip.detalle && chip.texto !== null && <span className="rtm-chip-detalle">{chip.detalle}</span>}
    </span>
  );
}

export function Pulso({ chips }: { chips: ChipPulso[] }) {
  return (
    <>
      {chips.map((c) => (
        <ChipDelPulso key={c.clave} chip={c} />
      ))}
    </>
  );
}
