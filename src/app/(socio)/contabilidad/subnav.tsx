'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const PAGINAS = [
  { href: '/contabilidad', etiqueta: 'Valuación' },
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
    <nav className="rtm-subnav" aria-label="Contabilidad">
      <ul>
        {PAGINAS.map((p) => (
          <li key={p.href}>
            <Link href={p.href} aria-current={ruta === p.href ? 'page' : undefined} data-testid={`conta-${p.href.split('/').pop() === 'contabilidad' ? 'valuacion' : p.href.split('/').pop()}`}>{p.etiqueta}</Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
