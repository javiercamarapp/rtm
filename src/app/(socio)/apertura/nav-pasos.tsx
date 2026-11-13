'use client';

import { usePathname } from 'next/navigation';
import { Pestanas } from '@/ui/componentes/controles';
import { PASOS } from '@/dominio/apertura/pasos';

/** Los diez pasos del asistente de apertura. */
export function NavPasos() {
  const ruta = usePathname();
  return (
    <Pestanas
      etiquetaAria="Pasos de la apertura"
      items={[
        { id: 'resumen', etiqueta: 'Resumen', href: '/apertura', activa: ruta === '/apertura', testid: 'apertura-resumen' },
        ...PASOS.map((p) => ({ id: `paso-${p.n}`, etiqueta: `${p.n}. ${p.corto}`, href: `/apertura/paso/${p.n}`, activa: ruta === `/apertura/paso/${p.n}`, testid: `apertura-paso-${p.n}` })),
      ]}
    />
  );
}
