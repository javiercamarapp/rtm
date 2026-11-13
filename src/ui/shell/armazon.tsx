'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { MARCA } from '@/config/marca';
import { Logo } from '../logo/logo';
import { IconoApertura, IconoAviso, IconoCatalogo, IconoClientes, IconoCobrar, IconoContabilidad, IconoContactos, IconoDevolucion, IconoDropshipping, IconoInicio, IconoInventario, IconoMenu, IconoMovimientos, IconoOmar, IconoPaquete, IconoPedidos, IconoProveedores, IconoReportes, IconoCostos, IconoSocios, IconoTrayecto } from '../iconos';
import { Apariencia } from '../tema/apariencia';
import { BotonTema } from '../tema/boton-tema';
import type { ListaCampana } from '@/dominio/notificaciones/tipos';
import type { Pulso as DatosPulso } from '@/dominio/operacion/pulso';
import { Campana } from './campana';
import { Pulso } from './pulso';

const SECCIONES = [
  { href: '/', etiqueta: 'Inicio', icono: <IconoInicio /> },
  { href: '/pedidos', etiqueta: 'Pedidos y notas', icono: <IconoPedidos /> },
  { href: '/dropshipping', etiqueta: 'Dropshipping', icono: <IconoDropshipping /> },
  { href: '/menudeo', etiqueta: 'Pedidos menudeo', icono: <IconoClientes /> },
  { href: '/devoluciones', etiqueta: 'Devoluciones', icono: <IconoDevolucion /> },
  { href: '/paquetes/por-hacer', etiqueta: 'Paquetes por hacer', icono: <IconoPaquete /> },
  { href: '/paquetes/en-trayecto', etiqueta: 'Paquetes en trayecto', icono: <IconoTrayecto /> },
  { href: '/cuentas-por-cobrar', etiqueta: 'Cuentas por cobrar', icono: <IconoCobrar /> },
  { href: '/catalogo', etiqueta: 'Catálogo y precios', icono: <IconoCatalogo /> },
  { href: '/clientes', etiqueta: 'Clientes', icono: <IconoClientes /> },
  { href: '/contactos', etiqueta: 'Contactos', icono: <IconoContactos /> },
  { href: '/inventario', etiqueta: 'Inventario', icono: <IconoInventario /> },
  { href: '/proveedores', etiqueta: 'Proveedores', icono: <IconoProveedores /> },
  { href: '/socios', etiqueta: 'Cuenta de socios', icono: <IconoSocios /> },
  { href: '/omar', etiqueta: 'Cuenta con Omar', icono: <IconoOmar /> },
  { href: '/pago-renta', etiqueta: 'Pago renta', icono: <IconoOmar /> },
  { href: '/contabilidad', etiqueta: 'Contabilidad', icono: <IconoContabilidad /> },
  { href: '/movimientos', etiqueta: 'Movimientos', icono: <IconoMovimientos /> },
  { href: '/apertura', etiqueta: 'Apertura', icono: <IconoApertura /> },
  { href: '/reportes', etiqueta: 'Reportes', icono: <IconoReportes />, prefetch: false },
  { href: '/costos', etiqueta: 'Costos del sistema', icono: <IconoCostos />, prefetch: false },
  { href: '/avisos', etiqueta: 'Avisos', icono: <IconoAviso /> },
  { href: '/cuentas', etiqueta: 'Cuentas', icono: <IconoSocios /> },
] as const;

function indiceActivo(ruta: string): number {
  const i = SECCIONES.findIndex((s) => (s.href === '/' ? ruta === '/' : ruta === s.href || ruta.startsWith(`${s.href}/`)));
  return i;
}

interface Props {
  children: ReactNode;
  nombreSocio: string;
  accionSalir: () => Promise<void>;
  pulso: DatosPulso;
  noLeidas?: number;
  /** Socio de menudeo: da nombre a la entrada del menu (Pedidos menudeo Angelo). */
  socioMenudeo?: string;
  cargarCampana?: (filtro: 'todas' | 'sin_leer') => Promise<ListaCampana>;
  marcarLeida?: (id: number) => Promise<void>;
  marcarTodasLeidas?: () => Promise<void>;
}

export function Armazon({ children, nombreSocio, accionSalir, pulso, socioMenudeo = 'Angelo', noLeidas = 0, cargarCampana, marcarLeida, marcarTodasLeidas }: Props) {
  const ruta = usePathname();
  const [abierto, setAbierto] = useState(false);
  const activo = indiceActivo(ruta);

  useEffect(() => {
    setAbierto(false);
  }, [ruta]);

  return (
    <div className="rtm-app">
      <aside className="rtm-lateral" data-abierto={abierto} aria-label="Navegación principal">
        <div className="rtm-lateral-marca">
          <Link href="/" aria-label={`${MARCA.nombre}, inicio`} onClick={() => setAbierto(false)}>
            <Logo alto={22} />
          </Link>
        </div>
        <nav aria-label="Secciones" className="rtm-nav-caja">
          {activo >= 0 && <div aria-hidden="true" className="rtm-nav-indicador" data-testid="indicador-nav" data-indice={activo} />}
          <ul className="rtm-nav">
            {SECCIONES.map((s, i) => (
              <li key={s.href}>
                <Link href={s.href} prefetch={'prefetch' in s ? s.prefetch : undefined} className="rtm-nav-item" aria-label={s.href === '/menudeo' ? `${s.etiqueta} ${socioMenudeo}` : undefined} aria-current={i === activo ? 'page' : undefined} onClick={() => setAbierto(false)}>
                  {s.icono}
                  <span>{s.href === '/menudeo' ? `Menudeo ${socioMenudeo}` : s.etiqueta}</span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="rtm-lateral-pie">
          <span className="rtm-lateral-usuario">Sesión de {nombreSocio}</span>
          <form action={accionSalir}>
            <button type="submit" className="rtm-boton rtm-lateral-salir" data-testid="cerrar-sesion">Cerrar sesión</button>
          </form>
        </div>
      </aside>
      {abierto && <button type="button" className="rtm-velo" aria-label="Cerrar menú" onClick={() => setAbierto(false)} />}

      <div className="rtm-region">
        <header className="rtm-barra">
          <button type="button" className="rtm-icono-boton rtm-menu-movil" aria-label="Abrir menú" aria-expanded={abierto} onClick={() => setAbierto(true)}>
            <IconoMenu />
          </button>
          <span className="rtm-migas">
            {MARCA.nombre} / <strong>{activo >= 0 ? SECCIONES[activo]!.etiqueta : 'Diseño'}</strong>
          </span>
          <div className="rtm-pulso" data-desliza="1100">
            <Pulso chips={pulso.chips} />
          </div>
          <div className="rtm-barra-acciones">
            {cargarCampana && marcarLeida && marcarTodasLeidas && <Campana noLeidas={noLeidas} cargar={cargarCampana} marcar={marcarLeida} marcarTodas={marcarTodasLeidas} />}
            <Apariencia />
            <BotonTema />
          </div>
        </header>
        <main className="rtm-panel" id="contenido">
          <div className="rtm-panel-scroll">
            <div className="rtm-pagina">
              <div className="rtm-pulso-movil" data-desliza="767" aria-label="Pulso">
                <Pulso chips={pulso.chips} />
              </div>
              {children}
            </div>
          </div>
          <footer className="rtm-pie">
            <span data-testid="pie-corte">{pulso.corte ? `Corte: al ${pulso.corte}` : 'Corte: sin datos todavía'}</span>
            <span aria-hidden="true">·</span>
            <span>Fuente: libro de eventos</span>
          </footer>
        </main>
      </div>
    </div>
  );
}
