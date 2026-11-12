'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const PAGINAS = [
  { href: '/movimientos', etiqueta: 'Bandeja', id: 'bandeja' },
  { href: '/movimientos/libro', etiqueta: 'Libro', id: 'libro' },
  { href: '/movimientos/importar', etiqueta: 'Pegar o subir', id: 'importar' },
  { href: '/movimientos/resumen', etiqueta: 'Agrupar y utilidad', id: 'resumen' },
] as const;

/** Subpaginas de Movimientos. */
export function SubnavMovimientos() {
  const ruta = usePathname();
  return (
    <nav className="rtm-subnav" aria-label="Movimientos">
      <ul>
        {PAGINAS.map((p) => (
          <li key={p.href}>
            <Link href={p.href} aria-current={ruta === p.href ? 'page' : undefined} data-testid={`movimientos-${p.id}`}>{p.etiqueta}</Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
