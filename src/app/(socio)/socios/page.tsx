import type { Metadata } from 'next';
import { EncabezadoPagina, EstadoVacio } from '@/ui/componentes/pagina';
import { etiquetaHoy } from '../contexto';

export const metadata: Metadata = { title: 'Cuenta de socios' };

export default function Pagina() {
  return (
    <>
      <EncabezadoPagina
        eyebrow={`Cuenta de socios · ${etiquetaHoy()}`}
        antes="La cuenta entre"
        enfasis="socios"
        contexto="Lo que puso cada uno contra la mitad del costo de la sociedad, calculado por dos vías."
      />
      <EstadoVacio titulo="Sin aportaciones registradas" texto="El saldo aparecerá al registrar la compra inicial y las aportaciones de cada socio." />
    </>
  );
}
