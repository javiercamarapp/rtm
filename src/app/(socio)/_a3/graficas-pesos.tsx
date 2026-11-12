'use client';

// Envolturas cliente de las graficas de columnas y de area para dinero: reciben centavos y rotulan el eje en pesos abreviados.
// Existen porque una funcion de formato no puede cruzar de un componente de servidor a uno de cliente.
import type { ComponentProps } from 'react';
import { AreaSerie, ColumnasPeriodo, compactoEs } from '@/ui/graficas';

const ejePesos = (centavos: number): string => compactoEs(centavos / 100);

export function ColumnasPesos(props: Omit<ComponentProps<typeof ColumnasPeriodo>, 'formatoEje' | 'unidad'>) {
  return <ColumnasPeriodo {...props} unidad="Pesos" formatoEje={ejePesos} />;
}

export function AreaPesos(props: Omit<ComponentProps<typeof AreaSerie>, 'formatoEje' | 'unidad'>) {
  return <AreaSerie {...props} unidad="Pesos" formatoEje={ejePesos} />;
}
