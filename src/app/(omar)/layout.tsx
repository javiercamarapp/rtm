import type { ReactNode } from 'react';
import { exigirOmar } from '@/composicion/acceso';
import { ExplicarProvider } from '@/ui/componentes/explicar';
import { ArmazonOmar } from '@/ui/omar/armazon-omar';
import { explicarCifra, salir } from './acciones';

export const dynamic = 'force-dynamic';

export default async function LayoutOmar({ children }: { children: ReactNode }) {
  // La autoridad es la tabla: sin cuenta ACTIVA con rol omar (activa: vista propia de Omar) no se renderiza nada de esta zona.
  await exigirOmar();
  return (
    <ArmazonOmar accionSalir={salir}>
      <ExplicarProvider explicar={explicarCifra} modo="omar">{children}</ExplicarProvider>
    </ArmazonOmar>
  );
}
