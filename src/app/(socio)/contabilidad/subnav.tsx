'use client';

import { usePathname } from 'next/navigation';
import { Pestanas } from '@/ui/componentes/controles';

const PAGINAS = [
  { href: '/contabilidad', etiqueta: 'Valuación' },
  { href: '/contabilidad/valuacion', etiqueta: 'Valuación al detalle' },
  { href: '/contabilidad/valuacion/historial', etiqueta: 'Historial de valuación' },
  { href: '/contabilidad/capital', etiqueta: 'Capital por socio' },
  { href: '/contabilidad/caja', etiqueta: 'Caja y liquidez' },
  { href: '/contabilidad/diario', etiqueta: 'Diario' },
  { href: '/contabilidad/mayor', etiqueta: 'Mayor' },
  { href: '/contabilidad/estado-de-resultados', etiqueta: 'Estado de resultados' },
  { href: '/contabilidad/balance', etiqueta: 'Balance general' },
  { href: '/contabilidad/flujo', etiqueta: 'Flujo de efectivo' },
  { href: '/contabilidad/comprobaciones', etiqueta: 'Comprobaciones' },
  { href: '/contabilidad/proyecciones', etiqueta: 'Proyecciones' },
] as const;

/** Subpaginas de la seccion Contabilidad. */
export function SubnavContabilidad() {
  const ruta = usePathname();
  return (
    <Pestanas
      etiquetaAria="Contabilidad"
      items={PAGINAS.map((p) => {
        const id = p.href.split('/').pop() === 'contabilidad' ? 'valuacion' : (p.href.split('/').pop() as string);
        return { id: p.href, etiqueta: p.etiqueta, href: p.href, activa: ruta === p.href, testid: `conta-${id}` };
      })}
    />
  );
}
