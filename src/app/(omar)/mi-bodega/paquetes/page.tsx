import type { Metadata } from 'next';
import { paquetesDeOmar } from '@/composicion/omar';
import { EncabezadoPagina } from '@/ui/componentes/pagina';
import { ListaPaquetes } from '@/ui/omar/paquetes';

export const metadata: Metadata = { title: 'Paquetes' };

export default async function Pagina() {
  const p = await paquetesDeOmar();
  return (
    <>
      <EncabezadoPagina eyebrow="Tus paquetes" antes="Lo que hay que" enfasis="tener listo" contexto="Paquetes por preparar para salir de tu bodega y paquetes que van en camino hacia ella. Los envíos los hacen los socios." />
      <div className="rtm-entra rtm-i-1"><ListaPaquetes lectura={p} /></div>
    </>
  );
}
