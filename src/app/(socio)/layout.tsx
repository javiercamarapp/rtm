import type { ReactNode } from 'react';
import { exigirSocio } from '@/composicion/acceso';
import { leerPulso } from '@/composicion/pulso';
import { ExplicarProvider } from '@/ui/componentes/explicar';
import { Armazon } from '@/ui/shell/armazon';
import { explicarCifra, salir } from './acciones';

export const dynamic = 'force-dynamic';

export default async function LayoutSocio({ children }: { children: ReactNode }) {
  // La autoridad es la tabla: sin cuenta activa con rol socio no se renderiza nada de esta zona.
  const { perfil } = await exigirSocio();
  const pulso = await leerPulso();
  // El proveedor del cajon envuelve TODO el armazon: el pulso de la barra tambien explica sus cifras.
  return (
    <ExplicarProvider explicar={explicarCifra}>
      <Armazon nombreSocio={perfil.socio_nombre ?? 'socio'} accionSalir={salir} pulso={pulso}>
        {children}
      </Armazon>
    </ExplicarProvider>
  );
}
