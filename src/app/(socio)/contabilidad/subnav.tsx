'use client';

import { usePathname } from 'next/navigation';
import { Pestanas } from '@/ui/componentes/controles';

// Etiqueta corta (una sola linea de pestanas) y nombre completo en title.
const PAGINAS = [
  { href: '/contabilidad', etiqueta: 'Valuación', titulo: 'Valuación' },
  { href: '/contabilidad/valuacion', etiqueta: 'Detalle', titulo: 'Valuación al detalle' },
  { href: '/contabilidad/valuacion/historial', etiqueta: 'Historial', titulo: 'Historial de valuación' },
  { href: '/contabilidad/capital', etiqueta: 'Capital', titulo: 'Capital por socio' },
  { href: '/contabilidad/caja', etiqueta: 'Caja', titulo: 'Caja y liquidez' },
  { href: '/contabilidad/diario', etiqueta: 'Diario', titulo: 'Diario' },
  { href: '/contabilidad/mayor', etiqueta: 'Mayor', titulo: 'Mayor' },
  { href: '/contabilidad/estado-de-resultados', etiqueta: 'Resultados', titulo: 'Estado de resultados' },
  { href: '/contabilidad/balance', etiqueta: 'Balance', titulo: 'Balance general' },
  { href: '/contabilidad/flujo', etiqueta: 'Flujo', titulo: 'Flujo de efectivo' },
  { href: '/contabilidad/comprobaciones', etiqueta: 'Comprobaciones', titulo: 'Comprobaciones' },
  { href: '/contabilidad/proyecciones', etiqueta: 'Proyecciones', titulo: 'Proyecciones' },
] as const;

/** Subpaginas de la seccion Contabilidad. */
export function SubnavContabilidad() {
  const ruta = usePathname();
  return (
    <Pestanas
      etiquetaAria="Contabilidad"
      items={PAGINAS.map((p) => {
        const id = p.href.split('/').pop() === 'contabilidad' ? 'valuacion' : (p.href.split('/').pop() as string);
        return { id: p.href, etiqueta: p.etiqueta, titulo: p.titulo, href: p.href, activa: ruta === p.href, testid: `conta-${id}` };
      })}
    />
  );
}
