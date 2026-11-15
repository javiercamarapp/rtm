'use client';

import { usePathname } from 'next/navigation';
import { Pestanas } from '@/ui/componentes/controles';
import { RanuraSubnav } from '@/ui/componentes/ranura-subnav';

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
    <Pestanas
      etiquetaAria="Movimientos"
      lateral={<RanuraSubnav />}
      items={PAGINAS.map((p) => ({ id: p.id, etiqueta: p.etiqueta, href: p.href, activa: ruta === p.href, testid: `movimientos-${p.id}` }))}
    />
  );
}
