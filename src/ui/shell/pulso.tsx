import Link from 'next/link';
import { formatearMoneda, formatearPiezas } from '@/dominio/formato';
import type { Pulso as DatosPulso } from '@/dominio/notificaciones/tipos';
import type { ChipPulso } from '@/dominio/operacion/pulso';
import { CifraComprobada } from '../componentes/cifra';
import { SinDato } from '../componentes/estado-texto';

/** Pulso de 4 indicadores con datos reales (tablero de inicio). Sin ningun hecho que lo respalde se muestra "Sin dato", nunca un cero inventado. */
export function chipsPulso(p: DatosPulso | null): { id: string; etiqueta: string; texto: string | null; href: string; ayuda: string }[] {
  return [
    { id: 'isaac', etiqueta: 'Por pagar a Isaac', texto: p?.por_pagar_isaac_cent == null ? null : formatearMoneda(p.por_pagar_isaac_cent), href: '/proveedores', ayuda: 'Deuda de la empresa con Isaac: el total del Mayor (cuenta 2110) menos los pedidos a costo del socio de menudeo que aún no paga, que van aparte y no son deuda de la empresa. Es la misma cifra de Proveedores' },
    { id: 'cobrar', etiqueta: 'Por cobrar', texto: p?.por_cobrar_cent == null ? null : formatearMoneda(p.por_cobrar_cent), href: '/cuentas-por-cobrar', ayuda: 'Saldo de los pedidos enviados' },
    { id: 'socios', etiqueta: 'Entre socios', texto: p?.entre_socios == null ? null : (p.entre_socios.diferencia_cent === 0n ? 'En paz' : `${p.entre_socios.socio} +${formatearMoneda(p.entre_socios.diferencia_cent)}`), href: '/socios', ayuda: 'Diferencia entre las posiciones netas de los socios' },
    { id: 'bodega', etiqueta: 'En bodega', texto: p?.en_bodega == null ? null : `${formatearPiezas(p.en_bodega.piezas)} · ${formatearMoneda(p.en_bodega.valor_cent)}`, href: '/inventario', ayuda: 'Existencia y su valor a costo promedio' },
  ];
}

/** Un indicador del pulso de la barra: cifra real con "Explicar este numero" cuando la base la sabe explicar; si no, enlace al detalle. Sin datos: "Sin dato", nunca un cero inventado. */
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
