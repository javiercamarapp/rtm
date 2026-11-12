'use client';

import { usePathname } from 'next/navigation';
import { Pestanas } from '@/ui/componentes/controles';

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
    <Pestanas
      etiquetaAria="Inventario"
      items={PAGINAS.map((p) => ({ id: p.id, etiqueta: p.etiqueta, href: p.href, activa: ruta === p.href, testid: `inventario-${p.id}` }))}
    />
  );
}
