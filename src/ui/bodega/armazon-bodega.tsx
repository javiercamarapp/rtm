'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { MARCA } from '@/config/marca';
import { Logo } from '../logo/logo';
import { Apariencia } from '../tema/apariencia';
import { BotonTema } from '../tema/boton-tema';

export const SECCIONES_BODEGA = [
  { href: '/bodega', etiqueta: 'Hoy a preparar' },
  { href: '/bodega/llegadas', etiqueta: 'Llegadas' },
] as const;

/** Seccion activa por ruta: la mas especifica gana ("/bodega/llegadas" no enciende "Hoy a preparar"). */
export function seccionActivaBodega(ruta: string): number {
  let mejor = -1;
  SECCIONES_BODEGA.forEach((s, i) => {
    if ((ruta === s.href || ruta.startsWith(`${s.href}/`)) && (mejor < 0 || s.href.length > SECCIONES_BODEGA[mejor]!.href.length)) mejor = i;
  });
  return mejor;
}

interface Props {
  children: ReactNode;
  accionSalir: () => Promise<void>;
  /** Un socio que abre la vista la ve tal como la ve bodega, con su propio regreso. */
  vistaPrevia: boolean;
}

/** Armazon propio de bodega: barra superior con dos secciones. Sin barra lateral de socios, sin Pulso, sin enlaces a nada del negocio. */
export function ArmazonBodega({ children, accionSalir, vistaPrevia }: Props) {
  const activo = seccionActivaBodega(usePathname());
  return (
    <div className="bodega-app">
      <header className="bodega-barra">
        <Link href="/bodega" className="bodega-barra-marca" aria-label={`${MARCA.nombre}, bodega`}>
          <Logo alto={22} />
        </Link>
        <nav aria-label="Secciones">
          <ul className="bodega-nav">
            {SECCIONES_BODEGA.map((s, i) => (
              <li key={s.href}>
                <Link href={s.href} aria-current={i === activo ? 'page' : undefined}>{s.etiqueta}</Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="bodega-barra-acciones">
          <Apariencia />
          <BotonTema />
          {vistaPrevia
            ? <Link className="rtm-boton rtm-boton-chico" href="/cuentas" data-testid="salir-vista-previa">Volver a Cuentas</Link>
            : <form action={accionSalir}><button type="submit" className="rtm-boton rtm-boton-chico" data-testid="cerrar-sesion">Cerrar sesión</button></form>}
        </div>
      </header>
      {vistaPrevia && <p className="bodega-previa" data-testid="vista-previa">Vista previa: así ve esta pantalla la persona de bodega.</p>}
      <main className="bodega-contenido" id="contenido">{children}</main>
      <footer className="bodega-pie">Bodega de Mérida · solo lo que hay que preparar y guardar</footer>
    </div>
  );
}
