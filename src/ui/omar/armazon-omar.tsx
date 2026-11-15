'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { MARCA } from '@/config/marca';
import { Logo } from '../logo/logo';
import { BotonTema } from '../tema/boton-tema';

export const SECCIONES_OMAR = [
  { href: '/mi-bodega', etiqueta: 'Mi bodega' },
  { href: '/mi-bodega/cuenta', etiqueta: 'Mi cuenta' },
  { href: '/mi-bodega/paquetes', etiqueta: 'Paquetes' },
  { href: '/mi-bodega/pago-renta', etiqueta: 'Pago renta' },
] as const;

/** Seccion activa por ruta: la mas especifica gana ("/mi-bodega/cuenta" no enciende "Mi bodega"). */
export function seccionActiva(ruta: string): number {
  let mejor = -1;
  SECCIONES_OMAR.forEach((s, i) => {
    if ((ruta === s.href || ruta.startsWith(`${s.href}/`)) && (mejor < 0 || s.href.length > SECCIONES_OMAR[mejor]!.href.length)) mejor = i;
  });
  return mejor;
}

interface Props {
  children: ReactNode;
  accionSalir: () => Promise<void>;
}

/** Armazon propio de Omar: barra superior con tres secciones. Sin barra lateral de socios, sin Pulso, sin enlaces a nada del negocio. */
export function ArmazonOmar({ children, accionSalir }: Props) {
  const activo = seccionActiva(usePathname());
  return (
    <div className="omar-app">
      <header className="omar-barra">
        <Link href="/mi-bodega" className="omar-barra-marca" aria-label={`${MARCA.nombre}, mi bodega`}>
          <Logo alto={22} />
        </Link>
        <nav aria-label="Secciones">
          <ul className="omar-nav">
            {SECCIONES_OMAR.map((s, i) => (
              <li key={s.href}>
                <Link href={s.href} aria-current={i === activo ? 'page' : undefined}>{s.etiqueta}</Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="omar-barra-acciones">
          <BotonTema />
          <form action={accionSalir}>
            <button type="submit" className="rtm-boton rtm-boton-chico" data-testid="cerrar-sesion">Cerrar sesión</button>
          </form>
        </div>
      </header>
      <main className="omar-contenido" id="contenido">{children}</main>
      <footer className="omar-pie">Bodega de Mérida · lo que ves aquí es solo tu bodega</footer>
    </div>
  );
}
