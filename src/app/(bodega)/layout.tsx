import type { ReactNode } from 'react';
import { exigirBodega } from '@/composicion/acceso';
import { ArmazonBodega } from '@/ui/bodega/armazon-bodega';
import { salir } from './acciones';

export const dynamic = 'force-dynamic';

export default async function LayoutBodega({ children }: { children: ReactNode }) {
  // La autoridad es la tabla: sin cuenta ACTIVA con rol bodega (o un socio activo en vista previa) no se renderiza nada de esta zona.
  const { vistaPrevia } = await exigirBodega();
  return <ArmazonBodega accionSalir={salir} vistaPrevia={vistaPrevia}>{children}</ArmazonBodega>;
}
