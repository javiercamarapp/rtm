import type { Metadata } from 'next';
import { EncabezadoPagina, EstadoVacio } from '@/ui/componentes/pagina';
import { etiquetaHoy } from '../contexto';

export const metadata: Metadata = { title: 'Cuenta con Omar' };

export default function Pagina() {
  return (
    <>
      <EncabezadoPagina
        eyebrow={`Cuenta con Omar · ${etiquetaHoy()}`}
        antes="La cuenta con"
        enfasis="Omar"
        contexto="Renta de bodega por pieza surtida, tomas a su precio y el neto de la semana."
      />
      <p className="rtm-chip rtm-entra rtm-i-1">Omar (bodega) ≠ Omar Aguilar (cliente)</p>
      <EstadoVacio titulo="Sin renta ni tomas" texto="La renta se devenga solo cuando una pieza sale de la Bodega Omar. Todavía no hay movimientos." />
    </>
  );
}
