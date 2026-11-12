'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const PAGINAS = [
  { href: '/inventario', etiqueta: 'Existencia y cobertura', id: 'existencia' },
  { href: '/inventario/kardex', etiqueta: 'Kárdex', id: 'kardex' },
  { href: '/inventario/kardex/sabor', etiqueta: 'Kárdex por sabor', id: 'kardex-sabor' },
  { href: '/inventario/marcas', etiqueta: 'Marcas', id: 'marcas' },
  { href: '/inventario/antiguedad', etiqueta: 'Antigüedad', id: 'antiguedad' },
  { href: '/inventario/mermas', etiqueta: 'Mermas', id: 'mermas' },
  { href: '/inventario/conteo', etiqueta: 'Conteo físico', id: 'conteo' },
] as const;

/** Subpaginas de Inventario. */
export function SubnavInventario() {
  const ruta = usePathname();
  return (
    <nav className="rtm-subnav" aria-label="Inventario">
      <ul>
        {PAGINAS.map((p) => (
          <li key={p.href}>
            <Link href={p.href} aria-current={ruta === p.href ? 'page' : undefined} data-testid={`inventario-${p.id}`}>{p.etiqueta}</Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
