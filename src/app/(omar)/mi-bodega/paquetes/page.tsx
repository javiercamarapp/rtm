import type { Metadata } from 'next';
import { paquetesDeOmar } from '@/composicion/omar';
import { EncabezadoPagina, Pagina } from '@/ui/componentes/pagina';
import { ListaPaquetes } from '@/ui/omar/paquetes';

export const metadata: Metadata = { title: 'Paquetes' };

export default async function PaginaPaquetes() {
  const p = await paquetesDeOmar();
  return (
    <Pagina ancho="tablero">
      <EncabezadoPagina eyebrow="Tus paquetes" titulo="Lo que hay que tener listo" descripcion="Paquetes por preparar para salir de tu bodega y paquetes que van en camino hacia ella. Los envíos los hacen los socios." />
      <ListaPaquetes lectura={p} />
    </Pagina>
  );
}
