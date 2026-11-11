import type { ReactNode } from 'react';
import { exigirSocio } from '@/composicion/acceso';
import { Armazon } from '@/ui/shell/armazon';
import { salir } from './acciones';

export const dynamic = 'force-dynamic';

export default async function LayoutSocio({ children }: { children: ReactNode }) {
  // La autoridad es la tabla: sin cuenta activa con rol socio no se renderiza nada de esta zona.
  const { perfil } = await exigirSocio();
  return (
    <Armazon nombreSocio={perfil.socio_nombre ?? 'socio'} accionSalir={salir}>
      {children}
    </Armazon>
  );
}
